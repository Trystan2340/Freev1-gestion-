import {
  accountBalance,
  buildSmartAlerts,
  calculateForecast,
  envelopeUsage,
  financialCalendar,
  goalProgress,
  searchTransactions,
  transactionEffect
} from './v4-engine.js';

const RELEASE_KEY = 'freevValeurWhatsNew_4_0';
let initialized = false;
let searchTimer = null;

const $ = id => document.getElementById(id);
const releaseKey = () => `${RELEASE_KEY}:${window.__freevUserId || 'device'}`;
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

function state() {
  return window._getAppState?.() || { accounts: [], currentAccountId: null, multiViewMode: 'individual', selectedGroupIds: new Set() };
}

function currentAccount(appState = state()) {
  return appState.accounts.find(account => account.id === appState.currentAccountId) || appState.accounts[0] || null;
}

function visibleAccounts(appState = state()) {
  if (appState.multiViewMode === 'global') return appState.accounts;
  if (appState.multiViewMode === 'group') {
    const selected = appState.selectedGroupIds instanceof Set
      ? appState.selectedGroupIds
      : new Set(appState.selectedGroupIds || []);
    const group = appState.accounts.filter(account => selected.has(account.id));
    if (group.length) return group;
  }
  const account = currentAccount(appState);
  return account ? [account] : [];
}

function currency(appState = state()) {
  return currentAccount(appState)?.settings?.baseCurrency || 'EUR';
}

function formatMoney(value, appState = state()) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency(appState), maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDate(value) {
  const date = new Date(`${String(value || '').slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Date inconnue' : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function notify(message, type = 'success') {
  window.showToast?.(message, type);
}

function persist() {
  window.saveData?.();
  window.renderAccountsSidebar?.();
  render();
}

function summaryCard(icon, label, value, detail, tone = '') {
  return `<article class="v4-summary-card ${tone}"><span class="v4-summary-icon"><i class="fa-solid fa-${icon}"></i></span><div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(detail)}</small></div></article>`;
}

function renderSummary(appState, accounts, forecast, alerts) {
  const container = $('v4Summary');
  if (!container) return;
  const balance = accounts.reduce((sum, account) => sum + accountBalance(account, new Date()), 0);
  const finalBalance = forecast.at(-1)?.balance ?? balance;
  const goals = accounts.reduce((sum, account) => sum + (account.goals?.length || 0), 0);
  const scope = accounts.length > 1 ? `${accounts.length} comptes dans cette vue` : (accounts[0]?.name || 'Aucun compte');
  container.innerHTML = [
    summaryCard('wallet', 'Solde actuel', formatMoney(balance, appState), scope, balance < 0 ? 'danger' : ''),
    summaryCard('arrow-trend-up', 'Solde prévu', formatMoney(finalBalance, appState), `Dans ${forecast.length} mois`, finalBalance < balance ? 'warning' : 'success'),
    summaryCard('bullseye', 'Objectifs actifs', String(goals), goals ? 'Continuez votre progression' : 'Créez votre premier objectif'),
    summaryCard('bell', 'Points à surveiller', String(alerts.length), alerts.length ? 'Consultez les alertes ci-dessous' : 'Tout semble sous contrôle', alerts.length ? 'warning' : 'success')
  ].join('');
}

function renderForecast(appState, forecast) {
  const container = $('v4Forecast');
  if (!container) return;
  if (!forecast.length) {
    container.innerHTML = '<p class="v4-empty">Ajoutez des transactions pour démarrer une prévision.</p>';
    return;
  }
  const largest = Math.max(...forecast.map(item => Math.abs(item.balance)), 1);
  container.innerHTML = forecast.map(item => {
    const width = Math.max(6, Math.round((Math.abs(item.balance) / largest) * 100));
    const positive = item.balance >= 0;
    const label = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' }).format(new Date(`${item.month}-01T12:00:00`));
    return `<div class="v4-forecast-row"><span>${escapeHTML(label)}</span><div class="v4-forecast-track"><span class="${positive ? 'positive' : 'negative'}" style="width:${width}%"></span></div><strong>${escapeHTML(formatMoney(item.balance, appState))}</strong><small class="${item.change >= 0 ? 'positive-text' : 'negative-text'}">${item.change >= 0 ? '+' : ''}${escapeHTML(formatMoney(item.change, appState))}</small></div>`;
  }).join('');
}

function renderAlerts(appState, alerts) {
  const container = $('v4Alerts');
  const count = $('v4AlertCount');
  if (count) count.textContent = String(alerts.length);
  if (!container) return;
  if (!alerts.length) {
    container.innerHTML = '<div class="v4-empty v4-empty-success"><i class="fa-solid fa-circle-check"></i><strong>Aucune alerte importante</strong><span>Vos comptes et budgets sont sous contrôle.</span></div>';
    return;
  }
  container.innerHTML = alerts.map(alert => {
    const icon = alert.level === 'danger' ? 'triangle-exclamation' : alert.level === 'warning' ? 'bell' : 'circle-info';
    return `<article class="v4-alert ${alert.level}"><i class="fa-solid fa-${icon}"></i><div><strong>${escapeHTML(alert.title)}</strong><span>${escapeHTML(alert.detail)}</span></div></article>`;
  }).join('');
}

function renderGoals(appState, account) {
  const container = $('v4Goals');
  if (!container) return;
  const goals = Array.isArray(account?.goals) ? account.goals : [];
  if (!goals.length) {
    container.innerHTML = '<p class="v4-empty">Aucun objectif. Ajoutez un projet comme un voyage, un achat ou un fonds d’urgence.</p>';
    return;
  }
  container.innerHTML = goals.map(goal => {
    const progress = goalProgress(goal);
    const deadline = goal.deadline ? `Échéance ${formatDate(goal.deadline)}` : 'Sans date limite';
    return `<article class="v4-goal"><div class="v4-goal-head"><div><strong>${escapeHTML(goal.name)}</strong><span>${escapeHTML(deadline)}</span></div><span>${progress.percent}%</span></div><div class="v4-progress"><span style="width:${progress.percent}%"></span></div><div class="v4-goal-numbers"><span>${escapeHTML(formatMoney(progress.current, appState))} épargnés</span><span>${escapeHTML(formatMoney(progress.remaining, appState))} restants</span></div><small>${progress.remaining > 0 ? `${formatMoney(progress.monthlyNeeded, appState)} par mois conseillés` : 'Objectif atteint, bravo !'}</small><div class="v4-row-actions"><button type="button" class="btn btn-secondary btn-sm" data-v4-contribute="${escapeHTML(goal.id)}"><i class="fa-solid fa-plus"></i> Contribution</button><button type="button" class="btn-icon" data-v4-delete-goal="${escapeHTML(goal.id)}" aria-label="Supprimer l’objectif"><i class="fa-solid fa-trash"></i></button></div></article>`;
  }).join('');
  container.querySelectorAll('[data-v4-contribute]').forEach(button => button.addEventListener('click', () => contributeGoal(button.dataset.v4Contribute)));
  container.querySelectorAll('[data-v4-delete-goal]').forEach(button => button.addEventListener('click', () => deleteGoal(button.dataset.v4DeleteGoal)));
}

function renderEnvelopes(appState, account) {
  const container = $('v4Envelopes');
  if (!container) return;
  const entries = envelopeUsage(account, $('globalMonthPicker')?.value);
  if (!entries.length) {
    container.innerHTML = '<p class="v4-empty">Aucune enveloppe. Définissez par exemple 300 € pour les courses.</p>';
    return;
  }
  container.innerHTML = entries.map(item => {
    const capped = Math.min(100, Math.max(0, item.percent));
    const tone = item.percent >= 100 ? 'danger' : item.percent >= 80 ? 'warning' : 'success';
    return `<article class="v4-envelope"><div class="v4-envelope-head"><strong>${escapeHTML(item.category)}</strong><span class="${tone}">${item.percent}%</span></div><div class="v4-progress ${tone}"><span style="width:${capped}%"></span></div><div class="v4-goal-numbers"><span>${escapeHTML(formatMoney(item.used, appState))} utilisés</span><span>sur ${escapeHTML(formatMoney(item.limit, appState))}</span></div><button type="button" class="v4-text-button" data-v4-delete-envelope="${escapeHTML(item.category)}">Retirer cette enveloppe</button></article>`;
  }).join('');
  container.querySelectorAll('[data-v4-delete-envelope]').forEach(button => button.addEventListener('click', () => deleteEnvelope(button.dataset.v4DeleteEnvelope)));
}

function renderCalendar(appState, accounts) {
  const container = $('v4Calendar');
  if (!container) return;
  const events = financialCalendar(accounts, { days: 90 }).slice(0, 15);
  if (!events.length) {
    container.innerHTML = '<p class="v4-empty">Aucune échéance prévue dans les 90 prochains jours.</p>';
    return;
  }
  container.innerHTML = events.map(event => {
    const effect = transactionEffect(event);
    return `<article class="v4-calendar-item"><time datetime="${escapeHTML(event.date)}"><strong>${escapeHTML(new Date(`${event.date}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit' }))}</strong><span>${escapeHTML(new Date(`${event.date}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short' }))}</span></time><div><strong>${escapeHTML(event.desc || event.category || 'Échéance')}</strong><span>${escapeHTML(event.accountName || '')}${event.source === 'recurring' ? ' · Récurrente' : ''}</span></div><b class="${effect >= 0 ? 'positive-text' : 'negative-text'}">${effect >= 0 ? '+' : ''}${escapeHTML(formatMoney(effect, appState))}</b></article>`;
  }).join('');
}

export function render() {
  const appState = state();
  const accounts = visibleAccounts(appState);
  const account = currentAccount(appState);
  if (!account) return;
  account.goals = Array.isArray(account.goals) ? account.goals : [];
  account.envelopes = account.envelopes && typeof account.envelopes === 'object' && !Array.isArray(account.envelopes) ? account.envelopes : {};
  account.plannerSettings = { forecastMonths: 6, monthlyAdjustment: 0, ...(account.plannerSettings || {}) };
  const months = Math.max(3, Number(account.plannerSettings.forecastMonths) || 6);
  const adjustment = Number(account.plannerSettings.monthlyAdjustment) || 0;
  const adjustmentInput = $('v4Adjustment');
  if (adjustmentInput && document.activeElement !== adjustmentInput) adjustmentInput.value = String(adjustment);
  document.querySelectorAll('[data-v4-months]').forEach(button => button.classList.toggle('active', Number(button.dataset.v4Months) === months));
  const forecast = calculateForecast(accounts, { months, monthlyAdjustment: adjustment });
  const alerts = buildSmartAlerts(accounts, { month: $('globalMonthPicker')?.value });
  renderSummary(appState, accounts, forecast, alerts);
  renderForecast(appState, forecast);
  renderAlerts(appState, alerts);
  renderGoals(appState, account);
  renderEnvelopes(appState, account);
  renderCalendar(appState, accounts);
}

function addGoal(event) {
  event.preventDefault();
  const appState = state();
  const account = currentAccount(appState);
  if (!account) return;
  const name = $('v4GoalName')?.value.trim();
  const target = Number($('v4GoalTarget')?.value);
  if (!name || !Number.isFinite(target) || target <= 0) return notify('Nom et montant d’objectif requis', 'error');
  account.goals = Array.isArray(account.goals) ? account.goals : [];
  account.goals.push({
    id: crypto.randomUUID?.() || `goal-${Date.now()}`,
    name,
    target: Math.round(target * 100) / 100,
    current: 0,
    deadline: $('v4GoalDeadline')?.value || '',
    createdAt: new Date().toISOString()
  });
  event.currentTarget.reset();
  persist();
  notify('Objectif ajouté');
}

function contributeGoal(id) {
  const account = currentAccount();
  const goal = account?.goals?.find(item => String(item.id) === String(id));
  if (!goal) return;
  const amount = Number(prompt(`Montant à ajouter à « ${goal.name} » :`, '50'));
  if (!Number.isFinite(amount) || amount <= 0) return;
  goal.current = Math.round(((Number(goal.current) || 0) + amount) * 100) / 100;
  persist();
  notify('Contribution enregistrée');
}

function deleteGoal(id) {
  const account = currentAccount();
  const goal = account?.goals?.find(item => String(item.id) === String(id));
  if (!goal || !confirm(`Supprimer l’objectif « ${goal.name} » ?`)) return;
  account.goals = account.goals.filter(item => String(item.id) !== String(id));
  persist();
  notify('Objectif supprimé', 'info');
}

function saveEnvelope(event) {
  event.preventDefault();
  const account = currentAccount();
  if (!account) return;
  const category = $('v4EnvelopeCategory')?.value.trim();
  const limit = Number($('v4EnvelopeLimit')?.value);
  if (!category || !Number.isFinite(limit) || limit <= 0) return notify('Catégorie et limite requises', 'error');
  account.envelopes = account.envelopes && typeof account.envelopes === 'object' ? account.envelopes : {};
  account.envelopes[category] = Math.round(limit * 100) / 100;
  event.currentTarget.reset();
  persist();
  notify('Enveloppe enregistrée');
}

function deleteEnvelope(category) {
  const account = currentAccount();
  if (!account?.envelopes || !confirm(`Retirer l’enveloppe « ${category} » ?`)) return;
  delete account.envelopes[category];
  persist();
  notify('Enveloppe retirée', 'info');
}

function setForecastMonths(months) {
  const account = currentAccount();
  if (!account) return;
  account.plannerSettings = { ...(account.plannerSettings || {}), forecastMonths: Number(months) };
  window.saveData?.();
  render();
}

function setAdjustment() {
  const account = currentAccount();
  if (!account) return;
  const adjustment = Number($('v4Adjustment')?.value);
  account.plannerSettings = { ...(account.plannerSettings || {}), monthlyAdjustment: Number.isFinite(adjustment) ? adjustment : 0 };
  window.saveData?.();
  render();
}

function openSearch() {
  const overlay = $('v4SearchOverlay');
  if (!overlay) return;
  overlay.hidden = false;
  document.body.classList.add('v4-modal-open');
  requestAnimationFrame(() => $('v4SearchInput')?.focus());
}

function closeSearch() {
  const overlay = $('v4SearchOverlay');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('v4-modal-open');
}

function renderSearch() {
  const query = $('v4SearchInput')?.value.trim() || '';
  const container = $('v4SearchResults');
  if (!container) return;
  if (query.length < 2) {
    container.innerHTML = '<p class="v4-empty">Saisissez au moins deux caractères.</p>';
    return;
  }
  const appState = state();
  const results = searchTransactions(appState.accounts, query, 50);
  if (!results.length) {
    container.innerHTML = `<p class="v4-empty">Aucun résultat pour « ${escapeHTML(query)} ».</p>`;
    return;
  }
  container.innerHTML = results.map(result => `<button type="button" class="v4-search-result" data-account-id="${escapeHTML(result.accountId)}"><span class="v4-search-result-icon"><i class="fa-solid fa-${result.type === 'income' ? 'arrow-up' : 'arrow-down'}"></i></span><span><strong>${escapeHTML(result.desc || result.category || 'Transaction')}</strong><small>${escapeHTML(result.accountName)} · ${escapeHTML(formatDate(result.date))} · ${escapeHTML(result.category || 'Autre')}</small></span><b class="${result.type === 'income' ? 'positive-text' : 'negative-text'}">${result.type === 'income' ? '+' : '-'}${escapeHTML(formatMoney(Math.abs(transactionEffect(result)), appState))}</b></button>`).join('');
  container.querySelectorAll('[data-account-id]').forEach(button => button.addEventListener('click', () => {
    closeSearch();
    window.switchAccount?.(button.dataset.accountId);
    window.switchView?.('transactions');
  }));
}

function showWhatsNew(force = false) {
  if (!force && localStorage.getItem(releaseKey()) === 'seen') return;
  const overlay = $('v4WhatsNew');
  if (!overlay) return;
  overlay.hidden = false;
  document.body.classList.add('v4-modal-open');
}

function closeWhatsNew(openPlanner = false) {
  localStorage.setItem(releaseKey(), 'seen');
  const overlay = $('v4WhatsNew');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('v4-modal-open');
  if (openPlanner) window.switchView?.('planner');
}

function bind() {
  if (initialized) return;
  initialized = true;
  $('v4GoalForm')?.addEventListener('submit', addGoal);
  $('v4EnvelopeForm')?.addEventListener('submit', saveEnvelope);
  document.querySelectorAll('[data-v4-months]').forEach(button => button.addEventListener('click', () => setForecastMonths(button.dataset.v4Months)));
  $('v4Adjustment')?.addEventListener('change', setAdjustment);
  $('v4SearchInput')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 100);
  });
  [$('v4SearchOverlay'), $('v4WhatsNew')].forEach(overlay => overlay?.addEventListener('click', event => {
    if (event.target !== overlay) return;
    if (overlay.id === 'v4SearchOverlay') closeSearch();
    else closeWhatsNew(false);
  }));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
    if (event.key === 'Escape') {
      closeSearch();
      if (!$('v4WhatsNew')?.hidden) closeWhatsNew(false);
    }
  });
}

window.FreevV4 = { render, openSearch, closeSearch, showWhatsNew, closeWhatsNew };
document.addEventListener('DOMContentLoaded', bind, { once: true });
window.addEventListener('freev:ready', () => {
  bind();
  render();
  setTimeout(() => showWhatsNew(false), 350);
});
