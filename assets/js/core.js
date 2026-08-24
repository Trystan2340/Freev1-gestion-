// Stockage (profil supprimé : un seul espace de données)
const STORAGE_KEY = 'freevData';
// Compat : si l’ancienne version utilisait des profils, on récupère le dernier profil sélectionné
const LEGACY_PROFILE_ID = localStorage.getItem('freevCurrentProfile') || 'default';
const LEGACY_STORAGE_KEY = `freevData_${LEGACY_PROFILE_ID}`;

function getStorageKey() { return STORAGE_KEY; }

// State
let transactions = [];
let recurringTransactions = [];
let monthlyBudget = 0;
let budgetsByCategory = {}; // {Cat: number}
let initialCapital = 0;
let savingsAccounts = {};
let debts = []; // {id, person, direction, amount, date, note, startDate, endDate, initialAmount, remainingAmount}
let historyLog = []; // {ts, action, entity, before, after}
let settings = { baseCurrency: 'EUR', defaultMode: 'personal' };
let customCategories = []; // ✅ FIX : global, partagé entre tous les comptes
const DEFAULT_RECONCILE_COLOR = '#059669';
let uiSettings = { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR }; // couleurs personnalisables de l'UI
let savingsMeta = {};  // { 'Livret A': { color: '#059669' }, ... }

let currentView = 'dashboard';
let charts = { trend: null, category: null, analytics: null, analyticsMonthly: null, daily: null, weekday: null };
// 🐛 FIX: today n'est plus figée au chargement — on utilise un getter dynamique
// Cela évite les calculs erronés si l'app reste ouverte plusieurs jours.
function getToday() { return new Date(); }
// Compatibilité : les fonctions qui utilisent encore `today` directement (date picker init, etc.)
// sont patchées ci-dessous. Les calculs critiques passent par getToday().
let today = new Date(); // conservé uniquement pour la compatibilité des non-calculs (init, label date)
// Rafraîchissement automatique de `today` toutes les minutes
setInterval(() => { today = new Date(); }, 60000);

// ---------- Helpers ----------


// ======================
// THEME CHART.JS (UI PRO)
// ======================
const CHART_THEME = {
  text: '#334155',        // slate-700
  muted: '#64748b',       // slate-500
  grid: 'rgba(148,163,184,0.25)', // slate-400 25%
  border: 'rgba(226,232,240,1)',  // slate-200
  bg: '#ffffff',
  brand: '#3b82f6',       // blue-500
  brandDark: '#2563eb',   // blue-600
  success: '#10b981',     // emerald-500
  danger: '#ef4444',      // red-500
  violet: '#8b5cf6',
  cyan: '#06b6d4',
  amber: '#f59e0b',
};

function setChartDefaults() {
  if (!window.Chart) return;

  Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  Chart.defaults.color = CHART_THEME.muted;

  // Interactions plus fluides
  Chart.defaults.interaction = { mode: 'index', intersect: false };

  // Animations smooth
  Chart.defaults.animation = { duration: 650, easing: 'easeOutQuart' };

  // Légende cohérente
  Chart.defaults.plugins.legend.labels = {
    usePointStyle: true,
    pointStyle: 'circle',
    boxWidth: 8,
    boxHeight: 8,
    padding: 16,
    color: CHART_THEME.muted,
    font: { weight: '600' }
  };

  // Tooltip moderne
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: 'rgba(15, 23, 42, 0.92)', // slate-900
    titleColor: '#fff',
    bodyColor: '#fff',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    padding: 12,
    cornerRadius: 12,
    displayColors: true,
  });

  // Responsive crisp
  Chart.defaults.devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
}

// Plugin: texte au centre du doughnut (total dépenses)
const donutCenterTextPlugin = {
  id: 'donutCenterTextPlugin',
  afterDraw(chart, args, pluginOptions) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data.length) return;

    const x = meta.data[0].x;
    const y = meta.data[0].y;

    const lines = pluginOptions?.lines || [];
    if (!lines.length) return;

    // ✅ FIX : recalcule dynamiquement le total des segments VISIBLES
    // (quand l'utilisateur clique sur une légende pour masquer une catégorie)
    const dataset = chart.data.datasets[0];
    let visibleTotal = 0;
    dataset.data.forEach((val, i) => {
      if (!meta.data[i]?.hidden) {
        visibleTotal += Number(val) || 0;
      }
    });
    const displayValue = pluginOptions.formatter
      ? pluginOptions.formatter(visibleTotal)
      : lines[1];

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const title = lines[0] || '';

    ctx.fillStyle = CHART_THEME.muted;
    ctx.font = '600 12px Inter';
    ctx.fillText(title, x, y - 10);

    ctx.fillStyle = CHART_THEME.text;
    ctx.font = '800 16px Inter';
    ctx.fillText(displayValue, x, y + 10);

    ctx.restore();
  }
};
function drawEmptyOnCanvas(canvas, message) {
  try {
    const c = canvas?.getContext?.('2d');
    if (!c) return;
    const w = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
    const h = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    c.save();
    c.scale((window.devicePixelRatio || 1), (window.devicePixelRatio || 1));
    c.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    c.fillStyle = '#94a3b8';
    c.font = '600 14px Inter';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(message || 'Aucune donnée', canvas.clientWidth/2, canvas.clientHeight/2);
    c.restore();
  } catch(e) { /* noop */ }
}

function escapeHTML(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatCurrency(n, currency = (settings.baseCurrency || 'EUR'), decimals = 2) {
  const num = Number(n || 0);
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      maximumFractionDigits: decimals
    }).format(num);
  } catch {
    return `${num.toFixed(decimals)} ${currency}`;
  }
}

function isoDate(d = new Date()) {
  // Local-safe YYYY-MM-DD (évite les décalages liés à UTC/toISOString)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isoMonth(d = new Date()) {
  // Local-safe YYYY-MM
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function safeNumber(v, fallback = NaN) {
  // ✅ FIX CRITIQUE : chaîne vide → fallback.
  // Number('')===0 et isFinite(0)===true faisait que txMax vide
  // appliquait 'amount <= 0' et vidait la vue Transactions.
  const s = String(v ?? '').replace(',', '.').trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

// Arrondi monétaire fiable (évite 0.1+0.2 = 0.30000000000000004)
function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Génération d'ID universel sans collision (utilise crypto.randomUUID si dispo)
function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback pour les vieux navigateurs
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function normalizeType(t) {
  const s = String(t || '').toLowerCase();
  if (s.includes('transfer') || s.includes('transfert')) return 'transfer';
  return (s.includes('rev') || s.includes('income')) ? 'income' : 'expense';
}

function normalizeCategory(c) {
  const s = String(c || '').trim();
  return s || 'Autre';
}

function parseTags(str) {
  return String(str || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      // ✅ FIX : supprimer tous les # de début avant d'en ajouter un seul
      // Évite "# tag" → "##tag", et "#tag" → "##tag"
      const clean = s.replace(/^#+/, '').replaceAll(' ', '');
      return clean ? ('#' + clean) : null;
    })
    .filter(Boolean)
    .slice(0, 15);
}

function showToast(message, type='success', withUndo=false, undoCb=null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  let bgClass = 'bg-slate-800';
  let icon = 'fa-check';
  if (type === 'success') { bgClass = 'bg-emerald-600'; icon = 'fa-check-circle'; }
  if (type === 'error') { bgClass = 'bg-rose-600'; icon = 'fa-circle-xmark'; }
  if (type === 'info') { bgClass = 'bg-blue-600'; icon = 'fa-circle-info'; }
  if (type === 'neutral') { bgClass = 'bg-slate-700'; icon = 'fa-trash-can'; }

  el.className = `toast ${bgClass}`;

  const safeMsg = escapeHTML(message);
  el.innerHTML = `<i class="fa-solid ${icon}"></i> <span style="flex:1;">${safeMsg}</span>`;

  if (withUndo && typeof undoCb === 'function') {
    const btn = document.createElement('button');
    btn.textContent = 'ANNULER';
    btn.className = 'btn btn-secondary btn-sm';
    btn.style.marginLeft = '0.75rem';
    btn.onclick = () => {
      try { undoCb(); } catch(e) { console.error(e); }
      el.remove();
    };
    el.appendChild(btn);
  }

  container.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, 4500);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Certains navigateurs ont encore besoin de l'URL durant la tâche suivante.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function logAction(action, entity, before=null, after=null) {
  // ✅ FIX : stocker un résumé texte au lieu de l'objet brut
  // Évite [object Object] dans l'historique + réduit la taille du log
  function summarize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const parts = [];
    if (obj.category)  parts.push(obj.category);
    if (obj.type)      parts.push(obj.type);
    if (obj.amount !== undefined || obj.amountBase !== undefined) {
      const amt = obj.amountBase ?? obj.amount;
      parts.push(formatCurrencySimple(amt, obj.currency || settings?.baseCurrency || 'EUR'));
    }
    if (obj.date)      parts.push(obj.date);
    if (obj.desc)      parts.push(obj.desc);
    if (obj.person)    parts.push(obj.person);   // dettes
    if (obj.name)      parts.push(obj.name);     // comptes
    if (obj.target)    parts.push('→ ' + obj.target);
    return parts.length ? parts.join(' · ') : JSON.stringify(obj).slice(0, 120);
  }
  historyLog.unshift({
    ts: new Date().toISOString(),
    action,
    entity,
    before: summarize(before),
    after:  summarize(after)
  });
  historyLog = historyLog.slice(0, 500);
}

// ---------- Dark mode ----------
let _isDarkMode = false;

function toggleDarkMode() {
  _isDarkMode = !_isDarkMode;
  applyDarkMode(_isDarkMode);
  localStorage.setItem('freevDarkMode', _isDarkMode ? '1' : '0');
}

function applyDarkMode(dark) {
  _isDarkMode = dark;
  document.body.classList.toggle('dark-mode', dark);

  // Mettre à jour le bouton toggle
  const btn   = document.getElementById('darkModeToggle');
  const label = document.getElementById('darkModeLabel');
  const icon  = btn?.querySelector('[data-theme-icon]');
  if (icon)  icon.className  = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  if (label) label.textContent = dark ? 'Mode clair' : 'Mode sombre';
  if (btn) {
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? 'Activer le mode clair' : 'Activer le mode sombre');
  }

  // Mettre à jour le thème Chart.js
  if (window.Chart) {
    const textColor  = dark ? '#cbd5e1' : '#64748b';
    const gridColor  = dark ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.25)';
    Chart.defaults.color = textColor;
    Chart.defaults.plugins.tooltip.backgroundColor = dark
      ? 'rgba(15,23,42,0.95)'
      : 'rgba(15,23,42,0.92)';
    if (CHART_THEME) {
      CHART_THEME.muted = textColor;
      CHART_THEME.grid  = gridColor;
    }
  }

  // Redessiner les graphiques actifs pour appliquer les nouveaux thèmes
  if (currentView === 'dashboard') {
    setTimeout(() => renderDashboardCharts(), 0);
  } else if (currentView === 'analytics') {
    setTimeout(() => renderAnalytics(), 0);
  }
}

function initDarkMode() {
  const saved = localStorage.getItem('freevDarkMode');
  // Respecter aussi la préférence système si pas de préférence enregistrée
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  const shouldBeDark = saved !== null ? saved === '1' : prefersDark;
  if (shouldBeDark) applyDarkMode(true);

  // Écouter les changements de préférence système (seulement si pas de préférence manuelle)
  window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener('change', e => {
    if (localStorage.getItem('freevDarkMode') === null) applyDarkMode(e.matches);
  });
}


// ---------- Storage (multi-compte) ----------
function loadData() {
  loadAccountSystem();
}

function saveData() {
  // Purge défensive avant toute sauvegarde : règles récurrentes dupliquées,
  // puis occurrences générées en double.
  dedupeRecurringRules();
  dedupeRecurringOccurrences();
  saveAccountSystem();
}

// ---------- Auto backup ----------
const AUTO_BACKUP_KEY = 'freevAutoBackup_v2';

function buildCompleteBackupSnapshot() {
  saveCurrentGlobalsToAccount();
  return {
    schemaVersion: SCHEMA_VERSION,
    accounts,
    currentAccountId,
    multiViewMode,
    selectedGroupIds: [...selectedGroupIds],
    customCategories: customCategories || [],
    uiSettings: uiSettings || {},
    savingsMeta: savingsMeta || {}
  };
}

function manualAutoBackup() {
  try {
    const snapshot = JSON.stringify(buildCompleteBackupSnapshot());
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ ts: new Date().toISOString(), data: snapshot }));
    updateAutoBackupStatus();
    showToast('Backup effectué', 'success');
  } catch(e) { showToast('Erreur backup', 'error'); }
}

function autoBackupSilent() {
  try {
    const snapshot = JSON.stringify(buildCompleteBackupSnapshot());
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ ts: new Date().toISOString(), data: snapshot }));
    updateAutoBackupStatus();
  } catch(e) { console.warn('Auto-backup failed', e); }
}

function restoreFromAutoBackup() {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) { showToast('Aucun backup trouvé', 'info'); return; }
    const { ts, data } = JSON.parse(raw);
    const dateStr = new Date(ts).toLocaleString('fr-FR');
    if (!confirm(`Restaurer le backup du ${dateStr} ?\n\n⚠️ Les données actuelles seront remplacées.`)) return;
    const parsed = JSON.parse(data);
    accounts = (parsed.accounts || []).map(a => ({ ...createAccountObj(a.name, a.id), ...a }));
    currentAccountId = parsed.currentAccountId;
    multiViewMode = parsed.multiViewMode || 'individual';
    selectedGroupIds = new Set(parsed.selectedGroupIds || []);
    customCategories = parsed.customCategories || [];
    uiSettings = { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR, ...(parsed.uiSettings || {}) };
    savingsMeta = parsed.savingsMeta || {};
    if (!accounts.find(a => a.id === currentAccountId)) currentAccountId = accounts[0]?.id || null;
    loadCurrentAccountIntoGlobals();
    saveAccountSystem();
    generateRecurringOccurrences();
    syncAllUI();
    renderAccountsSidebar();
    updateViewModeUI();
    showToast(`Backup du ${dateStr} restauré`, 'success');
  } catch(e) { console.error(e); showToast('Erreur de restauration', 'error'); }
}

function checkAutoBackup() {
  try {
    // Si cloud sync actif → pas besoin du backup local, on ne propose pas la restauration
    const cloudActive = typeof _cloudSyncEnabled !== 'undefined' && _cloudSyncEnabled;
    if (cloudActive) { updateAutoBackupStatus(); return; }
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return;
    const { ts } = JSON.parse(raw);
    const d = new Date(ts);
    const now = new Date();
    const diffH = (now - d) / 3600000;
    // Only propose restore if backup is recent (less than 24h) AND there's an anomaly
    if (diffH < 24 && accounts.reduce((s, a) => s + (a.transactions || []).length, 0) === 0) {
      const dateStr = d.toLocaleString('fr-FR');
      if (confirm(`Un backup récent (${dateStr}) a été trouvé mais vos données semblent vides. Restaurer ?`)) {
        restoreFromAutoBackup();
      }
    }
    updateAutoBackupStatus();
  } catch(e) {}
}

function updateAutoBackupStatus() {
  const el = document.getElementById('autoBackupStatus');
  if (!el) return;
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) { el.textContent = 'Aucun backup disponible.'; return; }
    const { ts } = JSON.parse(raw);
    el.innerHTML = `<i class="fa-solid fa-check-circle" style="color:#10b981;"></i> Dernier backup : <strong>${new Date(ts).toLocaleString('fr-FR')}</strong>`;
  } catch(e) { el.textContent = 'Statut inconnu.'; }
}





// ---------- Views ----------
function switchView(view) {
  // Sauvegarder les données du compte courant avant de changer de vue
  saveCurrentGlobalsToAccount();

  currentView = view;
  ['dashboard', 'transactions', 'recurring', 'analytics', 'planner', 'smart', 'savings', 'debts', 'history', 'settings'].forEach(v => {
    const el = document.getElementById(`${v}-view`);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(`${view}-view`);
  if (target) target.classList.remove('hidden');

  // nav active
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    const onclick = item.getAttribute('onclick') || '';
    if (onclick.includes(`'${view}'`) || onclick.includes(`\"${view}\"`)) item.classList.add('active');
  });

  // Scroll to top smoothly
  const contentArea = document.querySelector('.content-area');
  if (contentArea && typeof contentArea.scrollTo === 'function') contentArea.scrollTo({ top: 0, behavior: 'smooth' });

  // Animate the view entering
  if (target) {
    target.classList.remove('view-enter');
    void target.offsetWidth; // force reflow
    target.classList.add('view-enter');
    setTimeout(() => target.classList.remove('view-enter'), 400);
  }

  if (view === 'transactions') { refreshCategoryFilter(); renderAllTransactions(); }
  if (view === 'recurring') renderRecurringList();
  if (view === 'analytics') setTimeout(() => renderAnalytics(), 0);
  if (view === 'planner') window.FreevV4?.render?.();
  if (view === 'smart') window.FreevV5?.render?.();
  if (view === 'savings') { refreshSavingsSelect(); renderSavingsList(); }
  if (view === 'debts') renderDebts();
  if (view === 'history') renderHistory();
  if (view === 'settings') { loadSettingsUI(); renderDataHealth(); }
  if (view === 'dashboard') updateDashboard();
  // close mobile sidebar after navigation
  const sb = document.querySelector('.sidebar');
  if (sb && window.innerWidth <= 768) sb.classList.remove('open');
}
// ---------- Computations ----------
function getMonthTransactions(month, txList = null) {
  const src = txList !== null ? txList : (multiViewMode === 'individual' ? transactions : getDisplayTransactions());
  return src.filter(t => (t.date || '').startsWith(month) && !t.isRecurring);
}

function getDisplayRecurringRules() {
  if (multiViewMode === 'individual') return recurringTransactions;
  return getViewAccounts().flatMap(a =>
    (a.recurringTransactions || []).map(r => ({
      ...r,
      _accountId: a.id,
      _accountName: a.name,
      _accountIdx: getAccountIndex(a.id)
    }))
  );
}

function getProjectedRecurringTransactions(month, txList = null) {
  const currentMonth = isoMonth(getToday());
  if (!month || month < currentMonth) return [];

  const allOccurrences = multiViewMode === 'individual' ? transactions : getDisplayTransactions();
  const rules = getDisplayRecurringRules();
  const todayStr = isoDate(getToday());
  const projected = [];

  const hasExistingOccurrence = (rule, key) => {
    return allOccurrences.some(t => {
      if (String(t.parentId || '') !== String(rule.id)) return false;
      if (rule._accountId && t._accountId && String(t._accountId) !== String(rule._accountId)) return false;
      const txKey = t.periodKey || (t.date ? periodKey(t.date, rule.frequency) : '');
      return txKey === key;
    });
  };

  rules.forEach(rule => {
    recurringDatesForMonth(rule, month).forEach(dateStr => {
      if (month === currentMonth && dateStr <= todayStr) return;
      const key = periodKey(dateStr, rule.frequency);
      if (isRecurringPeriodSkipped(rule, key) || hasExistingOccurrence(rule, key)) return;
      projected.push(buildRecurringOccurrence(rule, dateStr, {
        id: `__projected_${rule._accountId || 'current'}_${rule.id}_${key}`,
        projected: true,
        _accountId: rule._accountId,
        _accountName: rule._accountName,
        _accountIdx: rule._accountIdx
      }));
    });
  });

  return projected.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

function getProjectedLookupMonths() {
  const months = new Set();
  const selectedMonth = document.getElementById('globalMonthPicker')?.value || isoMonth();
  if (selectedMonth) months.add(selectedMonth);

  let from = document.getElementById('txFrom')?.value || '';
  let to = document.getElementById('txTo')?.value || '';
  if (from || to) {
    if (!from) from = `${selectedMonth}-01`;
    if (!to) {
      const [year, month] = selectedMonth.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      to = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
    }
    monthsBetweenISO(from, to).forEach(m => months.add(m));
  }

  return [...months];
}

function findProjectedTransactionById(id) {
  const targetId = String(id || '');
  if (!targetId) return null;

  for (const month of getProjectedLookupMonths()) {
    const base = getMonthTransactions(month);
    const found = getProjectedRecurringTransactions(month, base)
      .find(t => String(t.id) === targetId);
    if (found) return found;
  }

  return null;
}

function ensureProjectedAccount(projected) {
  if (!projected?._accountId || String(projected._accountId) === String(currentAccountId)) return true;
  switchAccount(projected._accountId);
  return true;
}

function getProjectedRule(projected) {
  if (!projected) return null;
  ensureProjectedAccount(projected);
  return recurringTransactions.find(r => String(r.id) === String(projected.parentId));
}

function materializeProjectedTransaction(id, opts = {}) {
  const projected = findProjectedTransactionById(id);
  if (!projected) {
    showToast('Transaction prévue introuvable', 'error');
    return null;
  }

  ensureProjectedAccount(projected);
  const rule = recurringTransactions.find(r => String(r.id) === String(projected.parentId));
  const freq = rule?.frequency || 'monthly';
  const existing = transactions.find(t => {
    if (String(t.parentId || '') !== String(projected.parentId)) return false;
    const key = t.periodKey || (t.date ? periodKey(t.date, freq) : '');
    return key === (projected.periodKey || '');
  });
  if (existing) {
    if (opts.reconciled) existing.reconciled = true;
    saveData();
    syncAllUI();
    return existing;
  }

  const tx = {
    ...projected,
    id: genId(),
    projected: false,
    _accountId: undefined,
    _accountName: undefined,
    _accountIdx: undefined,
    reconciled: !!opts.reconciled,
    reconcileColor: opts.reconcileColor || projected.reconcileColor || ''
  };

  transactions.push(tx);
  applyOccurrenceSideEffects(tx);

  logAction(opts.reconciled ? 'reconcile_projected' : 'create_projected', 'transaction', null, tx);
  saveData();
  syncAllUI();
  return tx;
}

function editProjectedRecurring(id) {
  const projected = findProjectedTransactionById(id);
  const rule = getProjectedRule(projected);
  if (!rule) return showToast('Règle récurrente introuvable', 'error');
  openRecurringRuleModal(rule, projected);
}

function deleteProjectedRecurring(id) {
  const projected = findProjectedTransactionById(id);
  if (!projected) return showToast('Échéance prévue introuvable', 'error');
  ensureProjectedAccount(projected);
  if (!skipProjectedRecurringOccurrence(projected)) showToast('Impossible d’ignorer cette échéance', 'error');
}

function duplicateProjectedTransaction(id) {
  const projected = findProjectedTransactionById(id);
  if (!projected) return showToast('Transaction prévue introuvable', 'error');
  ensureProjectedAccount(projected);

  const copy = {
    ...projected,
    id: genId(),
    projected: false,
    parentId: '',
    periodKey: '',
    source: 'manual',
    _accountId: undefined,
    _accountName: undefined,
    _accountIdx: undefined,
    desc: (projected.desc || '').replace(' (copie)', '') + ' (copie)',
    reconciled: false
  };

  transactions.push(copy);
  copy._effectsApplied = false;
  applyOccurrenceSideEffects(copy);
  logAction('duplicate_projected', 'transaction', projected, copy);
  saveData();
  syncAllUI();
  showToast('Transaction prévue dupliquée', 'success');
}

function reconcileProjectedTransaction(id) {
  const tx = materializeProjectedTransaction(id, { reconciled: true });
  if (tx) showToast('Transaction prévue créée et vérifiée ✓', 'success');
}

function renderProjectedActionButtons(t) {
  const id = escapeHTML(String(t.id || ''));
  const parentId = escapeHTML(String(t.parentId || ''));
  const accountId = escapeHTML(String(t._accountId || ''));
  const data = `data-id="${id}" data-parent-id="${parentId}" data-account-id="${accountId}"`;
  const reconcileStyle = getReconcileColorStyle(t);
  return `
    <button class="btn-icon js-edit-projected" ${data} aria-label="Modifier la récurrente" title="Modifier la récurrente"><i class="fa-solid fa-edit"></i></button>
    <button class="btn-icon js-del-projected" ${data} aria-label="Ignorer cette échéance" title="Ignorer seulement cette échéance"><i class="fa-solid fa-forward"></i></button>
    <button class="btn-icon js-dup-projected" ${data} aria-label="Dupliquer en transaction" title="Dupliquer en transaction"><i class="fa-solid fa-clone"></i></button>
    <button class="btn-icon js-rec-projected" ${data} aria-label="Créer et vérifier" title="Créer et vérifier" style="color:${reconcileStyle};"><i class="fa-solid fa-check"></i></button>
  `;
}

function monthsBetweenISO(fromDate, toDate) {
  if (!fromDate || !toDate) return [];
  const start = new Date(fromDate.slice(0, 7) + '-01T00:00:00');
  const end = new Date(toDate.slice(0, 7) + '-01T00:00:00');
  const months = [];
  for (let d = new Date(start); d <= end && months.length < 36; d.setMonth(d.getMonth() + 1)) {
    months.push(isoMonth(d));
  }
  return months;
}

function sumByType(type) {
  return transactions.filter(t => t.type === type && !t.isRecurring).reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
}

function getAllIncomes() { 
  // Compter uniquement les revenus jusqu'à aujourd'hui (pas les transactions futures)
  const todayISO = isoDate(getToday());
  return transactions
    .filter(t => t.type === 'income' && !t.isRecurring && (t.date || '') <= todayISO)
    .reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
}

function getAllExpenses() { 
  // Compter uniquement les dépenses jusqu'à aujourd'hui (pas les transactions futures)
  const todayISO = isoDate(getToday());
  return transactions
    .filter(t => t.type === 'expense' && !t.isRecurring && (t.date || '') <= todayISO)
    .reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
}

function getAllTransfers() {
  // Compter uniquement les transferts jusqu'à aujourd'hui (pas les transactions futures)
  const todayISO = isoDate(getToday());
  return transactions
    .filter(t => t.type === 'transfer' && !t.isRecurring && (t.date || '') <= todayISO)
    .reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
}

function getMonthCashNet(month) {
  const mt = getMonthTransactions(month);
  const income = mt.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
  const expenses = mt.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
  const transfers = mt.filter(t => t.type === 'transfer').reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
  return { income: roundMoney(income), expenses: roundMoney(expenses), transfers: roundMoney(transfers), net: roundMoney(income - expenses - transfers) };
}

function computeBalance(upToMonth = null) {
  if (multiViewMode !== 'individual') {
    return getViewAccounts().reduce((sum, acc) => {
      return sum + computeAccountBalanceUpTo(acc, upToMonth);
    }, 0);
  }

  let cutoffDate;
  if (upToMonth) {
    const [year, month] = upToMonth.split('-').map(Number);
    cutoffDate = isoDate(new Date(year, month, 0));
  } else {
    cutoffDate = isoDate(getToday());
  }

  // ✅ FIX : ne rien afficher avant le premier mois de données
  // (évite le solde fantôme = capital initial dans tout le passé)
  if (upToMonth) {
    const allDates = transactions
      .filter(t => !t.isRecurring && t.date)
      .map(t => t.date.slice(0, 7))
      .sort();
    const firstDataMonth = allDates[0];
    // Si on n'a jamais de transactions ET pas de capital : 0
    if (!firstDataMonth && !initialCapital) return 0;
    // Si le mois demandé est strictement avant le premier mois avec données : 0
    if (firstDataMonth && upToMonth < firstDataMonth) return 0;
  }

  const txsUpTo = transactions.filter(t => !t.isRecurring && (t.date || '') <= cutoffDate);
  const income    = txsUpTo.filter(t => t.type === 'income')  .reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
  const expenses  = txsUpTo.filter(t => t.type === 'expense') .reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
  const transfers = txsUpTo.filter(t => t.type === 'transfer').reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);

  return roundMoney((Number(initialCapital) || 0) + income - expenses - transfers);
}

function computeAccountBalanceUpTo(acc, upToMonth = null) {
  let cutoffDate;
  if (upToMonth) {
    const [year, month] = upToMonth.split('-').map(Number);
    cutoffDate = isoDate(new Date(year, month, 0));
  } else {
    cutoffDate = isoDate(getToday());
  }

  if (upToMonth) {
    const allDates = (acc.transactions || [])
      .filter(t => !t.isRecurring && t.date)
      .map(t => t.date.slice(0, 7))
      .sort();
    const firstDataMonth = allDates[0];
    if (!firstDataMonth && !acc.initialCapital) return 0;
    if (firstDataMonth && upToMonth < firstDataMonth) return 0;
  }

  const txs = acc.transactions || [];
  const txsUpTo = txs.filter(t => !t.isRecurring && (t.date || '') <= cutoffDate);
  const income    = txsUpTo.filter(t => t.type === 'income')  .reduce((s,t) => s + (Number(t.amountBase ?? t.amount)||0), 0);
  const expenses  = txsUpTo.filter(t => t.type === 'expense') .reduce((s,t) => s + (Number(t.amountBase ?? t.amount)||0), 0);
  const transfers = txsUpTo.filter(t => t.type === 'transfer').reduce((s,t) => s + (Number(t.amountBase ?? t.amount)||0), 0);
  return roundMoney((Number(acc.initialCapital)||0) + income - expenses - transfers);
}

function computeSavingsTotal(upToMonth = null) {
  const currentMonth = isoMonth(getToday());

  // Mode multi-compte
  if (multiViewMode !== 'individual') {
    const displaySav = getDisplaySavingsAccounts();
    if (!upToMonth || upToMonth >= currentMonth) {
      return Object.values(displaySav).reduce((s, v) => s + (Number(v) || 0), 0);
    }
    return getViewAccounts().reduce((sum, acc) => {
      return sum + computeAccountSavingsUpTo(acc, upToMonth);
    }, 0);
  }

  // Mois actuel ou futur → solde réel (inclut les ajouts manuels)
  if (!upToMonth || upToMonth >= currentMonth) {
    return Object.values(savingsAccounts || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  }

  // Mois passé :
  // On trouve le premier mois où l'utilisateur a des données (transactions ou capital)
  const allDates = transactions
    .filter(t => !t.isRecurring && t.date)
    .map(t => t.date.slice(0, 7))
    .sort();
  const firstDataMonth = allDates[0] || currentMonth;

  // Si le mois demandé est antérieur à toutes les données → 0
  if (upToMonth < firstDataMonth) return 0;

  // Sinon : solde actuel − transferts effectués APRÈS ce mois
  // Cette méthode est la seule qui inclut les ajouts manuels (sans transaction)
  const [year, month] = upToMonth.split('-').map(Number);
  const cutoffDate = isoDate(new Date(year, month, 0));
  const currentTotal = Object.values(savingsAccounts || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const savingsDeltaAfter = transactions
    .filter(t => !t.isRecurring && (t.date || '') > cutoffDate && t._effectsApplied !== false)
    .reduce((sum, transaction) => {
      const amount = Number(transaction.amountBase ?? transaction.amount) || 0;
      if (transaction.type === 'transfer') return sum + amount;
      if (transaction.fromSavings) return sum - amount;
      return sum;
    }, 0);

  return Math.max(0, roundMoney(currentTotal - savingsDeltaAfter));
}

function computeAccountSavingsUpTo(acc, upToMonth) {
  const currentMonth = isoMonth(getToday());
  const [year, month] = upToMonth.split('-').map(Number);
  const cutoffDate = isoDate(new Date(year, month, 0));

  // Premier mois de données pour ce compte
  const allDates = (acc.transactions || [])
    .filter(t => !t.isRecurring && t.date)
    .map(t => t.date.slice(0, 7))
    .sort();
  const firstDataMonth = allDates[0] || currentMonth;

  if (upToMonth < firstDataMonth) return 0;

  const currentTotal = Object.values(acc.savingsAccounts || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const savingsDeltaAfter = (acc.transactions || [])
    .filter(t => !t.isRecurring && (t.date || '') > cutoffDate && t._effectsApplied !== false)
    .reduce((sum, transaction) => {
      const amount = Number(transaction.amountBase ?? transaction.amount) || 0;
      if (transaction.type === 'transfer') return sum + amount;
      if (transaction.fromSavings) return sum - amount;
      return sum;
    }, 0);

  return Math.max(0, roundMoney(currentTotal - savingsDeltaAfter));
}
