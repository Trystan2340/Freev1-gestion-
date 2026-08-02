import {
  applyAutomationRules,
  buildLocalAlerts,
  calculateNetWorth,
  detectSubscriptions,
  merchantKey,
  parseCSVStatement,
  parseQIFStatement,
  partitionDuplicates,
  suggestAutomationRules
} from './v5-engine.js';

const RELEASE_KEY = 'freevValeurWhatsNew_5_0';
let initialized = false;
let activeTab = 'overview';
let pendingImport = null;

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

function appState() {
  return window._getAppState?.() || { accounts: [], currentAccountId: null };
}

function currentAccount(state = appState()) {
  return state.accounts.find(account => account.id === state.currentAccountId) || state.accounts[0] || null;
}

function formatMoney(value, account = currentAccount()) {
  const currency = account?.settings?.baseCurrency || 'EUR';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function notify(message, type = 'success') {
  window.showToast?.(message, type);
}

function mutate(mutator) {
  const account = currentAccount();
  if (!account) return null;
  const result = window._mutateAccountData?.(account.id, mutator);
  render();
  window.updateDashboard?.();
  return result;
}

function accountCollections(account) {
  account.automationRules = Array.isArray(account.automationRules) ? account.automationRules : [];
  account.plannerScenarios = Array.isArray(account.plannerScenarios) ? account.plannerScenarios : [];
  account.wealthAssets = Array.isArray(account.wealthAssets) ? account.wealthAssets : [];
  account.ignoredSubscriptionKeys = Array.isArray(account.ignoredSubscriptionKeys) ? account.ignoredSubscriptionKeys : [];
  return account;
}

function getSubscriptions(account) {
  const ignored = new Set(account.ignoredSubscriptionKeys || []);
  return detectSubscriptions(account.transactions, account.recurringTransactions).filter(subscription => !ignored.has(subscription.key));
}

function renderSummary(account, subscriptions, suggestions) {
  const container = $('v5Summary');
  if (!container) return;
  const unclassified = account.transactions.filter(transaction => transaction.category === 'À classer' || !transaction.category).length;
  const yearlySubscriptions = subscriptions.reduce((sum, subscription) => sum + subscription.yearlyCost, 0);
  const worth = calculateNetWorth(account);
  container.innerHTML = [
    ['wand-magic-sparkles', 'Règles actives', account.automationRules.filter(rule => rule.enabled !== false).length, `${suggestions.length} suggestion(s)`],
    ['repeat', 'Abonnements détectés', subscriptions.length, `${formatMoney(yearlySubscriptions, account)} par an`],
    ['inbox', 'À classer', unclassified, unclassified ? 'Des opérations demandent votre attention' : 'Tout est classé'],
    ['scale-balanced', 'Patrimoine net', formatMoney(worth.netWorth, account), `${formatMoney(worth.assets + worth.savings, account)} d’actifs suivis`]
  ].map(([icon, label, value, detail]) => `<article><i class="fa-solid fa-${icon}"></i><div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(detail)}</small></div></article>`).join('');
}

function renderOverview(account, subscriptions, suggestions) {
  const container = $('v5Overview');
  if (!container) return;
  const increases = subscriptions.filter(subscription => subscription.priceChange >= 5);
  const yearly = subscriptions.reduce((sum, subscription) => sum + subscription.yearlyCost, 0);
  const worth = calculateNetWorth(account);
  const insights = [];
  if (suggestions.length) insights.push({ tone: 'info', icon: 'wand-magic-sparkles', title: `${suggestions.length} automatisation(s) possible(s)`, detail: 'Freev a retrouvé des commerçants classés régulièrement dans la même catégorie.', action: 'rules', label: 'Créer les règles' });
  if (increases.length) insights.push({ tone: 'warning', icon: 'arrow-trend-up', title: `${increases.length} abonnement(s) en hausse`, detail: `La plus forte hausse détectée atteint ${Math.max(...increases.map(item => item.priceChange)).toLocaleString('fr-FR')} %.`, action: 'subscriptions', label: 'Vérifier' });
  if (subscriptions.length) insights.push({ tone: 'neutral', icon: 'calendar-check', title: `${formatMoney(yearly, account)} d’abonnements par an`, detail: 'Ce total combine les récurrences configurées et les paiements périodiques détectés.', action: 'subscriptions', label: 'Voir le détail' });
  insights.push({ tone: worth.netWorth >= 0 ? 'success' : 'danger', icon: 'scale-balanced', title: `Patrimoine net ${formatMoney(worth.netWorth, account)}`, detail: `${formatMoney(worth.liabilities, account)} de dettes restantes sont déduites.`, action: 'wealth', label: 'Gérer le patrimoine' });
  container.innerHTML = insights.map(item => `<article class="${item.tone}"><i class="fa-solid fa-${item.icon}"></i><div><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.detail)}</span></div><button type="button" data-v5-open-tab="${item.action}">${escapeHTML(item.label)}</button></article>`).join('');
}

function ruleHTML(rule) {
  return `<article class="v5-rule"><div><strong>Si le libellé contient « ${escapeHTML(rule.contains)} »</strong><span>Classer dans ${escapeHTML(rule.category)}${rule.type ? ` · ${escapeHTML(rule.type === 'income' ? 'Revenu' : 'Dépense')}` : ''}</span></div><label class="v5-switch"><input type="checkbox" data-v5-toggle-rule="${escapeHTML(rule.id)}" ${rule.enabled !== false ? 'checked' : ''}><span></span></label><button type="button" class="btn-icon" data-v5-delete-rule="${escapeHTML(rule.id)}" aria-label="Supprimer la règle"><i class="fa-solid fa-trash"></i></button></article>`;
}

function renderRules(account, suggestions) {
  const rules = $('v5RulesList');
  const suggested = $('v5RuleSuggestions');
  if (rules) rules.innerHTML = account.automationRules.length ? account.automationRules.map(ruleHTML).join('') : '<p class="v5-empty">Aucune règle. Créez-en une ou utilisez une suggestion de Freev.</p>';
  if (suggested) {
    const existing = new Set(account.automationRules.map(rule => `${rule.contains}|${rule.category}`));
    const remaining = suggestions.filter(suggestion => !existing.has(`${suggestion.contains}|${suggestion.category}`));
    suggested.innerHTML = remaining.length ? remaining.map(suggestion => `<article><div><strong>${escapeHTML(suggestion.contains)}</strong><span>${escapeHTML(suggestion.category)} · ${suggestion.confidence}% de confiance · ${suggestion.count} opérations</span></div><button type="button" class="btn btn-secondary btn-sm" data-v5-add-suggestion="${escapeHTML(suggestion.contains)}" data-category="${escapeHTML(suggestion.category)}">Créer la règle</button></article>`).join('') : '<p class="v5-empty">Aucune nouvelle suggestion fiable pour le moment.</p>';
  }
}

function renderSubscriptions(account, subscriptions) {
  const container = $('v5Subscriptions');
  const total = $('v5SubscriptionTotal');
  if (total) total.textContent = formatMoney(subscriptions.reduce((sum, item) => sum + item.yearlyCost, 0), account);
  if (!container) return;
  if (!subscriptions.length) {
    container.innerHTML = '<p class="v5-empty">Aucun paiement périodique détecté. Deux occurrences au minimum sont nécessaires.</p>';
    return;
  }
  container.innerHTML = subscriptions.map(subscription => `<article class="v5-subscription"><span class="v5-subscription-icon"><i class="fa-solid fa-repeat"></i></span><div><strong>${escapeHTML(subscription.merchant)}</strong><span>${subscription.frequency === 'yearly' ? 'Annuel' : subscription.frequency === 'weekly' ? 'Hebdomadaire' : 'Mensuel'} · ${subscription.source === 'recurring' ? 'Récurrence configurée' : `${subscription.occurrences} paiements détectés`}</span></div><div class="v5-subscription-price"><strong>${escapeHTML(formatMoney(subscription.monthlyCost, account))}<small>/mois</small></strong><span>${escapeHTML(formatMoney(subscription.yearlyCost, account))}/an</span>${subscription.priceChange >= 5 ? `<b>+${subscription.priceChange}%</b>` : ''}</div><div class="v5-row-actions">${subscription.source === 'detected' ? `<button type="button" class="btn btn-secondary btn-sm" data-v5-convert-subscription="${escapeHTML(subscription.key)}">Créer la récurrence</button>` : ''}<button type="button" class="btn-icon" data-v5-ignore-subscription="${escapeHTML(subscription.key)}" aria-label="Ignorer"><i class="fa-solid fa-eye-slash"></i></button></div></article>`).join('');
}

function renderScenarios(account) {
  const container = $('v5Scenarios');
  if (!container) return;
  if (!account.plannerScenarios.length) {
    container.innerHTML = '<p class="v5-empty">Configurez le Planificateur, puis enregistrez sa configuration comme scénario.</p>';
    return;
  }
  container.innerHTML = account.plannerScenarios.map(scenario => `<article class="v5-scenario"><i class="fa-solid fa-route"></i><div><strong>${escapeHTML(scenario.name)}</strong><span>${scenario.settings.forecastMonths || 6} mois · revenus +${escapeHTML(formatMoney(scenario.settings.incomeAdjustment || 0, account))} · dépenses +${escapeHTML(formatMoney(scenario.settings.expenseAdjustment || 0, account))}</span><small>Créé le ${new Date(scenario.createdAt).toLocaleDateString('fr-FR')}</small></div><button type="button" class="btn btn-primary btn-sm" data-v5-load-scenario="${escapeHTML(scenario.id)}">Utiliser</button><button type="button" class="btn-icon" data-v5-delete-scenario="${escapeHTML(scenario.id)}" aria-label="Supprimer"><i class="fa-solid fa-trash"></i></button></article>`).join('');
}

function renderWealth(account) {
  const container = $('v5WealthAssets');
  const summary = $('v5WealthSummary');
  const worth = calculateNetWorth(account);
  if (summary) summary.innerHTML = `<article><span>Trésorerie</span><strong>${escapeHTML(formatMoney(worth.cash, account))}</strong></article><article><span>Épargne</span><strong>${escapeHTML(formatMoney(worth.savings, account))}</strong></article><article><span>Autres actifs</span><strong>${escapeHTML(formatMoney(worth.assets, account))}</strong></article><article class="danger"><span>Dettes</span><strong>−${escapeHTML(formatMoney(worth.liabilities, account))}</strong></article><article class="primary"><span>Patrimoine net</span><strong>${escapeHTML(formatMoney(worth.netWorth, account))}</strong></article>`;
  if (!container) return;
  container.innerHTML = account.wealthAssets.length ? account.wealthAssets.map(asset => `<article><span class="v5-asset-icon"><i class="fa-solid fa-${asset.type === 'property' ? 'house' : asset.type === 'vehicle' ? 'car' : asset.type === 'investment' ? 'chart-line' : 'gem'}"></i></span><div><strong>${escapeHTML(asset.name)}</strong><span>${escapeHTML({ property: 'Immobilier', vehicle: 'Véhicule', investment: 'Investissement', other: 'Autre actif' }[asset.type] || 'Actif')}</span></div><b>${escapeHTML(formatMoney(asset.value, account))}</b><button type="button" class="btn-icon" data-v5-delete-asset="${escapeHTML(asset.id)}" aria-label="Supprimer"><i class="fa-solid fa-trash"></i></button></article>`).join('') : '<p class="v5-empty">Ajoutez vos biens ou investissements pour calculer le patrimoine net.</p>';
}

function localCacheBytes() {
  return new Blob(Object.keys(localStorage).filter(key => key.startsWith('freev')).flatMap(key => [key, localStorage.getItem(key) || ''])).size;
}

function renderSecurity() {
  const trusted = window.isTrustedDeviceCacheEnabled?.() || false;
  const trustedInput = $('v5TrustedDevice');
  if (trustedInput) trustedInput.checked = trusted;
  const cache = $('v5CacheSize');
  if (cache) cache.textContent = `${(localCacheBytes() / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
  const notification = $('v5NotificationStatus');
  if (notification) notification.textContent = !('Notification' in window) ? 'Non pris en charge' : Notification.permission === 'granted' ? 'Autorisées' : Notification.permission === 'denied' ? 'Refusées' : 'À activer';
  document.querySelectorAll('[data-v5-network]').forEach(network => {
    network.textContent = navigator.onLine ? 'En ligne' : 'Hors connexion';
    network.dataset.offline = navigator.onLine ? 'false' : 'true';
  });
  const sessions = $('v5Sessions');
  if (sessions) {
    let values = [];
    try { values = JSON.parse(localStorage.getItem('freevDeviceSessions') || '[]'); } catch (_) {}
    sessions.innerHTML = values.length ? values.map(session => `<article><i class="fa-solid fa-${session.label?.includes('Ordinateur') ? 'laptop' : 'mobile-screen'}"></i><div><strong>${escapeHTML(session.label || 'Appareil')}</strong><span>Vu le ${new Date(session.lastSeen).toLocaleString('fr-FR')}</span></div>${session.current ? '<b>Appareil actuel</b>' : ''}</article>`).join('') : '<p class="v5-empty">La liste locale des appareils apparaîtra après la prochaine connexion.</p>';
  }
}

function renderImportPreview() {
  const container = $('v5ImportPreview');
  if (!container) return;
  if (!pendingImport) {
    container.innerHTML = '<p class="v5-empty">Choisissez un relevé CSV ou QIF. L’import ajoute les nouvelles opérations sans remplacer vos comptes.</p>';
    return;
  }
  const { accepted, duplicates, errors } = pendingImport;
  container.innerHTML = `<div class="v5-import-stats"><span><strong>${accepted.length}</strong> nouvelles</span><span><strong>${duplicates.length}</strong> doublons évités</span><span><strong>${errors.length}</strong> lignes ignorées</span></div>${accepted.length ? `<div class="v5-import-table">${accepted.slice(0, 8).map(transaction => `<div><time>${escapeHTML(transaction.date)}</time><span>${escapeHTML(transaction.desc)}</span><b>${transaction.type === 'income' ? '+' : '−'}${escapeHTML(formatMoney(transaction.amount))}</b></div>`).join('')}</div><button type="button" id="v5ConfirmImport" class="btn btn-primary"><i class="fa-solid fa-file-import"></i> Importer ${accepted.length} opération(s)</button>` : '<p class="v5-empty">Aucune nouvelle opération à importer.</p>'}`;
}

export function render() {
  const account = currentAccount();
  if (!account) return;
  accountCollections(account);
  const subscriptions = getSubscriptions(account);
  const suggestions = suggestAutomationRules(account.transactions);
  renderSummary(account, subscriptions, suggestions);
  renderOverview(account, subscriptions, suggestions);
  renderRules(account, suggestions);
  renderSubscriptions(account, subscriptions);
  renderScenarios(account);
  renderWealth(account);
  renderSecurity();
  renderImportPreview();
  setActiveTab(activeTab);
}

function setActiveTab(tab) {
  activeTab = ['overview', 'rules', 'subscriptions', 'imports', 'scenarios', 'wealth', 'security'].includes(tab) ? tab : 'overview';
  document.querySelectorAll('[data-v5-tab]').forEach(button => {
    const active = button.dataset.v5Tab === activeTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-v5-panel]').forEach(panel => panel.hidden = panel.dataset.v5Panel !== activeTab);
}

function addRule(contains, category, type = '', applyNow = false) {
  const cleanContains = String(contains || '').trim().slice(0, 80);
  const cleanCategory = String(category || '').trim().slice(0, 60);
  if (cleanContains.length < 2 || !cleanCategory) return notify('Mot-clé et catégorie requis', 'error');
  let applied = 0;
  mutate(account => {
    accountCollections(account);
    const rule = { id: crypto.randomUUID?.() || `rule-${Date.now()}`, contains: cleanContains, category: cleanCategory, type, enabled: true, createdAt: new Date().toISOString() };
    account.automationRules.push(rule);
    if (applyNow) {
      const result = applyAutomationRules(account.transactions, account.automationRules);
      account.transactions = result.transactions;
      applied = result.changed;
    }
  });
  notify(applyNow ? `Règle créée et ${applied} opération(s) classée(s)` : 'Règle créée');
}

function handleRuleSubmit(event) {
  event.preventDefault();
  addRule($('v5RuleContains')?.value, $('v5RuleCategory')?.value, $('v5RuleType')?.value, $('v5RuleApplyNow')?.checked);
  event.currentTarget.reset();
}

async function loadStatement(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    notify('Le relevé dépasse la limite de 5 Mo', 'error');
    input.value = '';
    return;
  }
  const text = await file.text();
  const parsed = file.name.toLocaleLowerCase('fr').endsWith('.qif') ? parseQIFStatement(text) : parseCSVStatement(text);
  const account = currentAccount();
  const currency = account?.settings?.baseCurrency || 'EUR';
  const imported = parsed.transactions.map(transaction => ({ ...transaction, currency }));
  const partition = partitionDuplicates(account?.transactions || [], imported);
  pendingImport = { ...partition, errors: parsed.errors, filename: file.name };
  renderImportPreview();
  input.value = '';
}

function confirmImport() {
  if (!pendingImport?.accepted?.length) return;
  const count = pendingImport.accepted.length;
  mutate(account => {
    const classified = applyAutomationRules(pendingImport.accepted, account.automationRules || []);
    account.transactions = [...account.transactions, ...classified.transactions];
  });
  pendingImport = null;
  renderImportPreview();
  notify(`${count} opération(s) importée(s) sans doublon`);
}

function saveScenario(event) {
  event.preventDefault();
  const name = $('v5ScenarioName')?.value.trim().slice(0, 60);
  if (!name) return notify('Donnez un nom au scénario', 'error');
  mutate(account => {
    accountCollections(account);
    account.plannerScenarios.push({ id: crypto.randomUUID?.() || `scenario-${Date.now()}`, name, settings: { ...(account.plannerSettings || {}) }, createdAt: new Date().toISOString() });
  });
  event.currentTarget.reset();
  notify('Scénario enregistré');
}

function addAsset(event) {
  event.preventDefault();
  const name = $('v5AssetName')?.value.trim().slice(0, 80);
  const value = Number($('v5AssetValue')?.value);
  const type = $('v5AssetType')?.value || 'other';
  if (!name || !Number.isFinite(value) || value <= 0) return notify('Nom et valeur positive requis', 'error');
  mutate(account => {
    accountCollections(account);
    account.wealthAssets.push({ id: crypto.randomUUID?.() || `asset-${Date.now()}`, name, value: Math.round(value * 100) / 100, type, updatedAt: new Date().toISOString() });
  });
  event.currentTarget.reset();
  notify('Actif ajouté au patrimoine');
}

async function requestNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return notify('Notifications indisponibles sur ce navigateur', 'error');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    renderSecurity();
    return notify('Notifications non autorisées', 'info');
  }
  try {
    await sendLocalReminders(true);
  } catch (_) {}
  renderSecurity();
  notify('Notifications activées');
}

async function sendLocalReminders(force = false) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return false;
  const today = new Date().toISOString().slice(0, 10);
  const reminderKey = `freevReminder:${window.__freevUserId || 'device'}`;
  if (!force && localStorage.getItem(reminderKey) === today) return false;
  const alerts = buildLocalAlerts(currentAccount(), today);
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('Freev Valeur', {
    body: alerts.length ? `${alerts.length} point(s) financier(s) demandent votre attention. Ouvrez Freev pour les consulter.` : 'Les alertes financières locales sont activées sur cet appareil.',
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: `freev-local-alerts-${today}`,
    data: { url: './index.html?source=notification&view=smart' }
  });
  localStorage.setItem(reminderKey, today);
  return true;
}

function handleTrustedDevice(input) {
  if (input.checked) {
    window.setTrustedDeviceCache?.(true);
    notify('Cache hors connexion activé sur cet appareil');
  } else {
    if (!confirm('Désactiver le cache sur cet appareil et effacer les copies financières locales ? Les données Firebase ne seront pas supprimées.')) {
      input.checked = true;
      return;
    }
    window.setTrustedDeviceCache?.(false);
    window.clearSensitiveLocalCache?.();
    notify('Copies financières locales effacées', 'info');
  }
  renderSecurity();
}

function showWhatsNew(force = false) {
  const key = `${RELEASE_KEY}:${window.__freevUserId || 'device'}`;
  if (!force && localStorage.getItem(key) === 'seen') return;
  const overlay = $('v5WhatsNew');
  if (overlay) overlay.hidden = false;
}

function closeWhatsNew(openCenter = false) {
  localStorage.setItem(`${RELEASE_KEY}:${window.__freevUserId || 'device'}`, 'seen');
  const overlay = $('v5WhatsNew');
  if (overlay) overlay.hidden = true;
  if (openCenter) window.switchView?.('smart');
}

function bind() {
  if (initialized) return;
  initialized = true;
  $('v5RuleForm')?.addEventListener('submit', handleRuleSubmit);
  $('v5ScenarioForm')?.addEventListener('submit', saveScenario);
  $('v5AssetForm')?.addEventListener('submit', addAsset);
  $('v5StatementFile')?.addEventListener('change', event => loadStatement(event.currentTarget));
  $('v5TrustedDevice')?.addEventListener('change', event => handleTrustedDevice(event.currentTarget));
  $('v5NotificationButton')?.addEventListener('click', requestNotifications);
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-v5-tab], [data-v5-open-tab], [data-v5-add-suggestion], [data-v5-delete-rule], [data-v5-toggle-rule], [data-v5-convert-subscription], [data-v5-ignore-subscription], [data-v5-load-scenario], [data-v5-delete-scenario], [data-v5-delete-asset], #v5ConfirmImport');
    if (!target) return;
    if (target.dataset.v5Tab) setActiveTab(target.dataset.v5Tab);
    if (target.dataset.v5OpenTab) setActiveTab(target.dataset.v5OpenTab);
    if (target.dataset.v5AddSuggestion) addRule(target.dataset.v5AddSuggestion, target.dataset.category, '', true);
    if (target.dataset.v5ToggleRule) mutate(account => { const rule = account.automationRules.find(item => item.id === target.dataset.v5ToggleRule); if (rule) rule.enabled = target.checked; });
    if (target.dataset.v5DeleteRule && confirm('Supprimer cette règle automatique ?')) mutate(account => { account.automationRules = account.automationRules.filter(rule => rule.id !== target.dataset.v5DeleteRule); });
    if (target.id === 'v5ConfirmImport') confirmImport();
    if (target.dataset.v5IgnoreSubscription) mutate(account => { account.ignoredSubscriptionKeys = [...new Set([...(account.ignoredSubscriptionKeys || []), target.dataset.v5IgnoreSubscription])]; });
    if (target.dataset.v5ConvertSubscription) {
      const account = currentAccount();
      const subscription = getSubscriptions(account).find(item => item.key === target.dataset.v5ConvertSubscription);
      if (subscription && confirm(`Créer une récurrence ${subscription.frequency === 'yearly' ? 'annuelle' : subscription.frequency === 'weekly' ? 'hebdomadaire' : 'mensuelle'} pour ${subscription.merchant} ?`)) mutate(item => {
        const alreadyExists = item.recurringTransactions.some(rule => merchantKey(rule) === subscription.key && rule.type !== 'income');
        if (!alreadyExists) item.recurringTransactions.push({ id: crypto.randomUUID?.() || `rec-${Date.now()}`, desc: subscription.merchant, category: 'Abonnements', type: 'expense', amount: subscription.latestAmount, amountBase: subscription.latestAmount, frequency: subscription.frequency, startDate: subscription.lastDate || new Date().toISOString().slice(0, 10), dayOfMonth: Number(String(subscription.lastDate || '').slice(8, 10)) || 1, source: 'smart-detection' });
      });
    }
    if (target.dataset.v5LoadScenario) {
      const scenario = currentAccount()?.plannerScenarios.find(item => item.id === target.dataset.v5LoadScenario);
      if (scenario) mutate(account => { account.plannerSettings = { ...account.plannerSettings, ...scenario.settings }; });
      window.switchView?.('planner');
      window.FreevV4?.render?.();
      notify('Scénario chargé dans le Planificateur');
    }
    if (target.dataset.v5DeleteScenario && confirm('Supprimer ce scénario enregistré ?')) mutate(account => { account.plannerScenarios = account.plannerScenarios.filter(scenario => scenario.id !== target.dataset.v5DeleteScenario); });
    if (target.dataset.v5DeleteAsset && confirm('Retirer cet actif du patrimoine ?')) mutate(account => { account.wealthAssets = account.wealthAssets.filter(asset => asset.id !== target.dataset.v5DeleteAsset); });
  });
  window.addEventListener('online', renderSecurity);
  window.addEventListener('offline', renderSecurity);
}

window.FreevV5 = { render, setActiveTab, showWhatsNew, closeWhatsNew, requestNotifications, sendLocalReminders };
document.addEventListener('DOMContentLoaded', bind, { once: true });
window.addEventListener('freev:ready', () => {
  bind();
  render();
  window.setTimeout(() => sendLocalReminders(false).catch(() => {}), 1500);
  window.setTimeout(() => showWhatsNew(false), 500);
});
