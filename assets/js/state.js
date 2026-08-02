// ======================
// Freev Valeur - ULTRA (Audit Fixes + PRO Features)
// ======================

const APP_VERSION = '4.0.0-planner';
const SCHEMA_VERSION = '2026-08-02';

// ============================================================
// ===== SYSTÈME MULTI-COMPTES =================================
// ============================================================

const ACCOUNTS_STORAGE_KEY = 'freevMultiAccounts_v2';

// State multi-comptes
let accounts = [];
let currentAccountId = null;
let multiViewMode = 'individual'; // 'individual' | 'group' | 'global'
let selectedGroupIds = new Set();

// ── Bridge Firebase→variables locales ──────────────────────────
// Le module Firebase (type="module") ne peut pas accéder aux `let`
// ci-dessus. Cette fonction est exposée sur window pour combler ce gap.
window._applyCloudData = function(parsed) {
  accounts         = (parsed.accounts || []).map(a => ({...createAccountObj(a.name, a.id), ...a}));
  currentAccountId = parsed.currentAccountId;
  multiViewMode    = parsed.multiViewMode || 'individual';
  selectedGroupIds = new Set(parsed.selectedGroupIds || []);
  customCategories = parsed.customCategories || [];
  uiSettings       = { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR, ...(parsed.uiSettings || {}) };
  savingsMeta      = parsed.savingsMeta || {};
  if (!accounts.find(a => a.id === currentAccountId))
    currentAccountId = accounts[0]?.id || null;
  accounts.forEach(acc => {
    (acc.debts || []).forEach(d => {
      if (d.remainingAmount === undefined) d.remainingAmount = d.amount;
      if (d.initialAmount   === undefined) d.initialAmount   = d.amount;
    });
  });
  loadCurrentAccountIntoGlobals();
};

// Expose les variables en lecture pour le module Firebase
window._getAppState = function() {
  saveCurrentGlobalsToAccount?.();
  return { accounts, currentAccountId, multiViewMode,
           selectedGroupIds, customCategories, uiSettings, savingsMeta };
};

// Expose les fonctions critiques pour le module Firebase
window.loadCurrentAccountIntoGlobals = loadCurrentAccountIntoGlobals;
window.loadAccountSystem = loadAccountSystem;
window.saveAccountSystem = saveAccountSystem;
window.saveCurrentGlobalsToAccount = saveCurrentGlobalsToAccount;
window.createAccountObj = createAccountObj;

// Expose toutes les fonctions d'init UI pour le module Firebase
window._runPostAuthInit = function() {
  if (window.__freevBooted) return;
  window.__freevBooted = true;
  setChartDefaults?.();
  if (window.Chart) { try { Chart.register(donutCenterTextPlugin); } catch(_) {} }
  const mp = document.getElementById('globalMonthPicker');
  if (mp) mp.value = isoMonth(today);
  const di = document.getElementById('transDate');
  if (di) di.value = isoDate(today);
  const ts = document.getElementById('transType');
  if (ts) ts.addEventListener('change', handleTypeChange);
  generateRecurringOccurrences?.();
  setupShortcuts?.(); setupSidebarToggle?.();
  refreshSavingsSelect?.(); refreshCategoryFilter?.();
  loadSettingsUI?.(); renderAccountsSidebar?.(); updateViewModeUI?.();
  initDarkMode?.(); populateCategorySelects?.();
  loadFabColor?.(); loadReconcileColor?.();
  checkAutoBackup?.();
  if (!window.__freevAutoBackupTimer) {
    window.__freevAutoBackupTimer = setInterval(() => autoBackupSilent?.(), 5 * 60 * 1000);
  }
  if (!settings?.ratesUpdatedAt || (Date.now() - new Date(settings.ratesUpdatedAt)) > 3600000)
    fetchExchangeRates?.().catch(() => {});
  updateDashboard?.();
  window.dispatchEvent(new CustomEvent('freev:ready'));
};

// Palettes de couleurs pour les avatars de comptes
const ACCOUNT_COLORS = [
  'linear-gradient(135deg,#1e3a8a,#3b82f6)',
  'linear-gradient(135deg,#064e3b,#059669)',
  'linear-gradient(135deg,#7c2d12,#ea580c)',
  'linear-gradient(135deg,#4c1d95,#7c3aed)',
  'linear-gradient(135deg,#701a75,#c026d3)',
  'linear-gradient(135deg,#831843,#db2777)',
  'linear-gradient(135deg,#1e3a5f,#06b6d4)',
  'linear-gradient(135deg,#365314,#65a30d)',
];

function getAccountColor(idx) {
  // Si le compte a une couleur personnalisée, l'utiliser
  const acc = accounts[idx];
  if (acc?.color) return acc.color;
  return ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length];
}

function getAccountIndex(id) {
  return accounts.findIndex(a => a.id === id);
}

// Crée un objet compte vide avec toutes les données par défaut
function createAccountObj(name, id = null) {
  const newId = id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  return {
    id: newId,
    name: name || 'Compte',
    createdAt: new Date().toISOString(),
    transactions: [],
    recurringTransactions: [],
    monthlyBudget: 0,
    budgetsByCategory: {},
    initialCapital: 0,
    savingsAccounts: {},
    goals: [],
    envelopes: {},
    plannerSettings: { forecastMonths: 6, monthlyAdjustment: 0 },
    debts: [],
    historyLog: [],
    settings: { baseCurrency: 'EUR', defaultMode: 'personal' }
  };
}

// Retourne le compte courant
function getCurrentAccount() {
  return accounts.find(a => a.id === currentAccountId) || accounts[0] || null;
}

// Retourne les comptes à afficher selon le mode vue
function getViewAccounts() {
  if (multiViewMode === 'global') return accounts;
  if (multiViewMode === 'group') {
    const selected = accounts.filter(a => selectedGroupIds.has(a.id));
    return selected.length ? selected : [getCurrentAccount()].filter(Boolean);
  }
  const ca = getCurrentAccount();
  return ca ? [ca] : [];
}

// ===== COUCHE D'ACCÈS AUX DONNÉES (DATA ACCESS LAYER) =====

// Transactions à afficher selon le mode vue
function getDisplayTransactions() {
  if (multiViewMode === 'individual') return transactions;
  return getViewAccounts().flatMap((a, idx) =>
    (a.transactions || []).map(t => ({
      ...t,
      _accountId: a.id,
      _accountName: a.name,
      _accountIdx: getAccountIndex(a.id)
    }))
  );
}

// Capital initial combiné selon le mode vue
function getDisplayCapital() {
  if (multiViewMode === 'individual') return initialCapital;
  return getViewAccounts().reduce((s, a) => s + (Number(a.initialCapital) || 0), 0);
}

// Comptes d'épargne combinés selon le mode vue
function getDisplaySavingsAccounts() {
  if (multiViewMode === 'individual') return savingsAccounts;
  const merged = {};
  getViewAccounts().forEach(a => {
    Object.entries(a.savingsAccounts || {}).forEach(([k, v]) => {
      merged[k] = (merged[k] || 0) + (Number(v) || 0);
    });
  });
  return merged;
}

// ===== CHARGEMENT / SAUVEGARDE MULTI-COMPTES =====

function loadAccountSystem() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      accounts = (parsed.accounts || []).map(a => ({
        ...createAccountObj(a.name, a.id),
        ...a
      }));
      currentAccountId = parsed.currentAccountId;
      multiViewMode = parsed.multiViewMode || 'individual';
      selectedGroupIds = new Set(parsed.selectedGroupIds || []);
      // FIX : charger les categories globales
      customCategories = parsed.customCategories || [];
      uiSettings = { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR, ...(parsed.uiSettings || {}) };
      savingsMeta = parsed.savingsMeta || {};
    }

    // FIX : Migration depuis l'ancien format par-compte
    if (!customCategories.length) {
      accounts.forEach(acc => {
        const cats = acc.settings?.customCategories || [];
        cats.forEach(c => {
          if (!customCategories.find(x => x.name.toLowerCase() === c.name.toLowerCase())) {
            customCategories.push(c);
          }
        });
      });
    }

    // Migration : si pas de comptes, migrer l'ancien freevData
    if (!accounts.length) {
      const legacyRaw = localStorage.getItem('freevData') ||
                        localStorage.getItem('freevData_' + (localStorage.getItem('freevCurrentProfile') || 'default'));
      const defaultAcc = createAccountObj('Compte principal');
      if (legacyRaw) {
        try {
          const parsed = JSON.parse(legacyRaw);
          defaultAcc.transactions = parsed.transactions || [];
          defaultAcc.recurringTransactions = parsed.recurringTransactions || [];
          defaultAcc.monthlyBudget = parsed.monthlyBudget || 0;
          defaultAcc.budgetsByCategory = parsed.budgetsByCategory || {};
          defaultAcc.initialCapital = parsed.initialCapital || 0;
          defaultAcc.savingsAccounts = parsed.savingsAccounts || {};
          defaultAcc.debts = parsed.debts || [];
          defaultAcc.historyLog = parsed.historyLog || [];
          defaultAcc.settings = parsed.settings || { baseCurrency: 'EUR', defaultMode: 'personal' };
          // FIX : migration legacy customCategories
          if (!customCategories.length && parsed.settings?.customCategories) {
            customCategories = parsed.settings.customCategories;
          }
        } catch(e) { console.warn('Migration legacy data failed', e); }
      }
      accounts = [defaultAcc];
      currentAccountId = defaultAcc.id;
    }

    // Vérifier que currentAccountId est valide
    if (!accounts.find(a => a.id === currentAccountId)) {
      currentAccountId = accounts[0]?.id || null;
    }

    // Migrer les dettes dans chaque compte
    accounts.forEach(acc => {
      (acc.debts || []).forEach(debt => {
        if (debt.remainingAmount === undefined) debt.remainingAmount = debt.amount;
        if (debt.initialAmount === undefined) debt.initialAmount = debt.amount;
      });
    });

    // Charger les données du compte courant dans les variables globales
    loadCurrentAccountIntoGlobals();

  } catch(e) {
    console.error('loadAccountSystem error', e);
  }
}

function saveAccountSystem() {
  // Sauvegarder les globales dans le compte courant
  saveCurrentGlobalsToAccount();
  // Sauvegarder tout
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify({
      schemaVersion: '2026-multi-v2',
      accounts,
      currentAccountId,
      multiViewMode,
      selectedGroupIds: [...selectedGroupIds],
      customCategories: customCategories || [], // ✅ FIX : sauvegarde globale
      uiSettings: uiSettings || { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR },
      savingsMeta: savingsMeta || {},
      lastSaved: new Date().toISOString()
    }));
  } catch(e) {
    console.error('saveAccountSystem error', e);
    if (typeof showToast === 'function') showToast('Erreur lors de la sauvegarde', 'error');
  }
}

function loadCurrentAccountIntoGlobals() {
  const acc = getCurrentAccount();
  if (!acc) return;
  transactions = acc.transactions ? [...acc.transactions] : [];
  recurringTransactions = acc.recurringTransactions ? [...acc.recurringTransactions] : [];
  monthlyBudget = acc.monthlyBudget || 0;
  budgetsByCategory = acc.budgetsByCategory || {};
  initialCapital = acc.initialCapital || 0;
  savingsAccounts = acc.savingsAccounts || {};
  debts = acc.debts || [];
  historyLog = acc.historyLog || [];
  settings = acc.settings || { baseCurrency: 'EUR', defaultMode: 'personal' };

  // Nettoyage défensif des doublons au chargement du compte.
  dedupeRecurringRules();
  dedupeRecurringOccurrences();
}

function saveCurrentGlobalsToAccount() {
  const acc = getCurrentAccount();
  if (!acc) return;
  acc.transactions = transactions;
  acc.recurringTransactions = recurringTransactions;
  acc.monthlyBudget = monthlyBudget;
  acc.budgetsByCategory = budgetsByCategory;
  acc.initialCapital = initialCapital;
  acc.savingsAccounts = savingsAccounts;
  acc.debts = debts;
  acc.historyLog = historyLog;
  acc.settings = settings;
}

// ===== CRUD COMPTES =====

function switchAccount(id) {
  if (id === currentAccountId && multiViewMode === 'individual') return;
  saveCurrentGlobalsToAccount();
  saveAccountSystem();
  currentAccountId = id;
  multiViewMode = 'individual';
  selectedGroupIds.clear();
  loadCurrentAccountIntoGlobals();
  try { generateRecurringOccurrences(); } catch(e) {}
  syncAllUI();
  renderAccountsSidebar();
  updateViewModeUI();
  const acc = getCurrentAccount();
  showToast(`Compte "${acc?.name}" activé`, 'success');
}

function createAccount(name) {
  saveCurrentGlobalsToAccount();
  const acc = createAccountObj(name);
  accounts.push(acc);
  saveAccountSystem();
  renderAccountsSidebar();
  return acc;
}

function deleteAccount(id) {
  if (accounts.length <= 1) {
    showToast('Impossible de supprimer le seul compte', 'error');
    return;
  }
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  const txCount = (acc.transactions || []).filter(t => !t.isRecurring && !t.parentId).length;

  // Custom confirm modal instead of browser confirm
  if (!confirm(`Supprimer le compte "${acc.name}" ?\n\n${txCount} transaction(s) seront perdues.\nUn bouton ANNULER apparaîtra pendant 8 secondes.`)) return;

  // Snapshot complet pour undo
  const backup = JSON.parse(JSON.stringify(acc));
  const prevAccountId = currentAccountId;

  accounts = accounts.filter(a => a.id !== id);
  selectedGroupIds.delete(id);

  if (currentAccountId === id) {
    currentAccountId = accounts[0].id;
    multiViewMode = 'individual';
    loadCurrentAccountIntoGlobals();
    try { generateRecurringOccurrences(); } catch(e) {}
    syncAllUI();
  }
  saveAccountSystem();
  renderAccountsSidebar();
  renderAccountsModalList();

  showToast(`Compte "${acc.name}" supprimé`, 'neutral', true, () => {
    // Restaurer le compte
    accounts.push(backup);
    selectedGroupIds.add(id);
    currentAccountId = id;
    multiViewMode = 'individual';
    loadCurrentAccountIntoGlobals();
    try { generateRecurringOccurrences(); } catch(e) {}
    saveAccountSystem();
    syncAllUI();
    renderAccountsSidebar();
    renderAccountsModalList();
    showToast(`Compte "${acc.name}" restauré`, 'success');
  });
}

function renameAccount(id, newName) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  acc.name = newName.trim();
  saveAccountSystem();
  renderAccountsSidebar();
  renderAccountsModalList();
  updateViewModeUI();
  showToast(`Compte renommé en "${newName}"`, 'success');
}

function setViewMode(mode) {
  saveCurrentGlobalsToAccount();
  multiViewMode = mode;
  if (mode === 'group' && selectedGroupIds.size === 0) {
    // Auto-sélectionner le compte courant en mode groupe
    selectedGroupIds.add(currentAccountId);
  }
  updateViewModeUI();
  syncAllUI();
  saveAccountSystem();
}

function toggleGroupAccount(id) {
  if (selectedGroupIds.has(id)) {
    selectedGroupIds.delete(id);
    if (selectedGroupIds.size === 0) selectedGroupIds.add(currentAccountId);
  } else {
    selectedGroupIds.add(id);
  }
  updateViewModeUI();
  syncAllUI();
  saveAccountSystem();
  renderAccountsSidebar();
}

// ===== RENDU UI COMPTES =====

function renderAccountsSidebar() {
  const container = document.getElementById('accountsSidebarList');
  if (!container) return;

  container.innerHTML = accounts.map((acc, idx) => {
    const isActive = acc.id === currentAccountId;
    const isGroupSelected = selectedGroupIds.has(acc.id);
    const isGroupMode = multiViewMode === 'group';
    const isGlobal = multiViewMode === 'global';
    const color = getAccountColor(idx);

    let itemClass = 'account-sidebar-item';
    if (isActive && multiViewMode === 'individual') itemClass += ' active';
    if (isGroupSelected && isGroupMode) itemClass += ' group-selected';
    if (isGlobal) itemClass += ' group-selected';

    let checkIcon = '';
    if (isActive && multiViewMode === 'individual') {
      checkIcon = '<i class="fa-solid fa-check account-sidebar-check"></i>';
    } else if ((isGroupSelected && isGroupMode) || isGlobal) {
      checkIcon = '<i class="fa-solid fa-check account-sidebar-check" style="color:#10b981;"></i>';
    }

    // ✅ FIX XSS : data-accid + event delegation
    const clickFn = multiViewMode === 'group' ? 'js-acc-toggle' : 'js-acc-switch';

    return `
      <div class="${itemClass} ${clickFn}" data-accid="${acc.id}" title="${escapeHTML(acc.name)}">
        <div class="account-avatar" style="background:${color};font-size:0.65rem;">
          ${escapeHTML(acc.name.charAt(0).toUpperCase())}
        </div>
        <span class="account-sidebar-name">${escapeHTML(acc.name)}</span>
        ${checkIcon}
      </div>
    `;
  }).join('');

  // Bind events via delegation (pas d'inline onclick = pas de XSS)
  container.querySelectorAll('.js-acc-switch').forEach(el =>
    el.addEventListener('click', () => switchAccount(el.dataset.accid))
  );
  container.querySelectorAll('.js-acc-toggle').forEach(el =>
    el.addEventListener('click', () => toggleGroupAccount(el.dataset.accid))
  );
}
function updateViewModeUI() {
  // Mettre à jour les tabs
  ['individual', 'group', 'global'].forEach(mode => {
    const btn = document.getElementById(`viewMode-${mode}`);
    if (btn) btn.classList.toggle('active-mode', multiViewMode === mode);
  });

  // Bannière groupe/global
  const banner = document.getElementById('groupViewBanner');
  const label = document.getElementById('groupViewLabel');
  const chips = document.getElementById('groupViewChips');

  if (!banner) return;

  if (multiViewMode === 'individual') {
    banner.style.display = 'none';
  } else {
    banner.style.display = 'flex';
    const viewAccs = getViewAccounts();

    if (multiViewMode === 'global') {
      banner.className = 'group-view-banner global';
      if (label) label.textContent = `Vue globale — ${accounts.length} compte(s)`;
    } else {
      banner.className = 'group-view-banner';
      if (label) label.textContent = `Vue groupée — ${viewAccs.length} compte(s) :`;
    }

    if (chips) {
      chips.innerHTML = viewAccs.map((a, idx) => {
        const color = getAccountColor(getAccountIndex(a.id));
        return `<span class="group-account-chip">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;"></span>
          ${escapeHTML(a.name)}
        </span>`;
      }).join('');
    }
  }

  // Mettre à jour la sidebar
  renderAccountsSidebar();
}

// ===== MODAL COMPTES =====

function openAccountsModal() {
  const modal = document.getElementById('accountsModal');
  if (modal) modal.classList.remove('hidden');
  renderAccountsModalList();
  updateAccountsModalInfo();
}

function closeAccountsModal() {
  const modal = document.getElementById('accountsModal');
  if (modal) modal.classList.add('hidden');
}

function updateAccountsModalInfo() {
  const el = document.getElementById('accountsModalSubtitle');
  if (el) el.textContent = `${accounts.length} compte(s) • Cliquer sur un compte pour le sélectionner`;
  const info = document.getElementById('accountsModalInfo');
  if (info) {
    const total = accounts.reduce((s, a) => s + (a.transactions || []).filter(t => !t.isRecurring && !t.parentId).length, 0);
    info.textContent = `Total : ${total} transaction(s) sur tous les comptes`;
  }
}

function renderAccountsModalList() {
  const container = document.getElementById('accountsModalList');
  if (!container) return;

  container.innerHTML = accounts.map((acc, idx) => {
    const isActive = acc.id === currentAccountId;
    const color = getAccountColor(idx);
    const txCount = (acc.transactions || []).filter(t => !t.isRecurring && !t.parentId).length;
    const balance = computeAccountBalance(acc);
    const cur = (acc.settings?.baseCurrency || 'EUR');

    return `
      <div class="account-card-modal ${isActive ? 'active-account' : ''}">
        <div class="account-avatar-lg" style="background:${color};">
          ${escapeHTML(acc.name.charAt(0).toUpperCase())}
        </div>
        <div class="account-info">
          <div class="account-info-name">
            ${escapeHTML(acc.name)}
            ${isActive ? '<span class="account-active-pill">Actif</span>' : ''}
          </div>
          <div class="account-info-stats">
            ${txCount} transaction(s) &bull; Solde: ${formatCurrencySimple(balance, cur)}
          </div>
        </div>
        <div class="account-card-actions">
          <!-- Couleur du compte -->
          <input type="color" value="${acc.color || color}" class="js-modal-color"
            data-accid="${acc.id}"
            title="Couleur du compte"
            style="width:32px;height:32px;padding:1px;border-radius:0.4rem;border:1px solid #e2e8f0;cursor:pointer;">
          <button class="btn-icon js-modal-rename" data-accid="${acc.id}" title="Renommer">
            <i class="fa-solid fa-pencil"></i>
          </button>
          ${!isActive ? `<button class="btn-icon js-modal-switch" data-accid="${acc.id}" title="Activer ce compte">
            <i class="fa-solid fa-right-to-bracket"></i>
          </button>` : ''}
          ${accounts.length > 1 ? `<button class="btn-icon js-modal-delete" data-accid="${acc.id}" style="color:#ef4444;" title="Supprimer">
            <i class="fa-solid fa-trash"></i>
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // ✅ FIX XSS : bind les events via JS, pas d'inline onclick avec IDs
  container.querySelectorAll('.js-modal-color').forEach(input => {
    input.addEventListener('change', () => {
      const acc = accounts.find(a => a.id === input.dataset.accid);
      if (acc) {
        acc.color = input.value;
        saveData();
        renderAccountsModalList();
        renderAccountsSidebar();
        showToast('Couleur du compte mise à jour', 'success');
      }
    });
  });
  container.querySelectorAll('.js-modal-rename').forEach(btn =>
    btn.addEventListener('click', () => promptRenameAccount(btn.dataset.accid))
  );
  container.querySelectorAll('.js-modal-switch').forEach(btn =>
    btn.addEventListener('click', () => { switchAccount(btn.dataset.accid); closeAccountsModal(); })
  );
  container.querySelectorAll('.js-modal-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteAccount(btn.dataset.accid))
  );
}

function computeAccountBalance(acc) {
  if (!acc) return 0;
  const todayISO = isoDate(new Date());
  const income = (acc.transactions || [])
    .filter(t => t.type === 'income' && !t.isRecurring && (t.date || '') <= todayISO)
    .reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
  const expenses = (acc.transactions || [])
    .filter(t => t.type === 'expense' && !t.isRecurring && (t.date || '') <= todayISO)
    .reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
  const transfers = (acc.transactions || [])
    .filter(t => t.type === 'transfer' && !t.isRecurring && (t.date || '') <= todayISO)
    .reduce((s, t) => s + (Number(t.amountBase ?? t.amount) || 0), 0);
  return Math.round(((Number(acc.initialCapital) || 0) + income - expenses - transfers) * 100) / 100;
}

function formatCurrencySimple(n, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(n || 0));
  } catch { return `${Number(n || 0).toFixed(2)} ${currency}`; }
}

function promptRenameAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  const newName = prompt('Nouveau nom du compte :', acc.name);
  if (newName && newName.trim() && newName.trim() !== acc.name) {
    renameAccount(id, newName.trim());
    updateAccountsModalInfo();
  }
}

function promptCreateAccount() {
  const name = prompt('Nom du nouveau compte :', 'Nouveau compte');
  if (name && name.trim()) {
    const acc = createAccount(name.trim());
    showToast(`Compte "${name.trim()}" créé`, 'success');
    renderAccountsModalList();
    updateAccountsModalInfo();
  }
}

function createAccountFromModal() {
  const input = document.getElementById('newAccountNameInput');
  const name = input?.value?.trim();
  if (!name) { showToast('Entrez un nom de compte', 'error'); return; }
  createAccount(name);
  showToast(`Compte "${name}" créé`, 'success');
  if (input) input.value = '';
  renderAccountsModalList();
  updateAccountsModalInfo();
}

// ============================================================
// ===== FIN SYSTÈME MULTI-COMPTES ============================
// ============================================================
