import { bankStatusCopy, buildBankMappingRows, isSafeBankRedirect, normalizeBankConnectionStatus, normalizeBankMappings } from './bank-sync-engine.js';

const endpoint = String(window.FREEV_BANK_SYNC_ENDPOINT || '').replace(/\/$/, '');
let currentStatus = normalizeBankConnectionStatus();
let currentMappingPayload = { bankAccounts: [], mappings: [] };

function element(id) { return document.getElementById(id); }

function configuredEndpoint() {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

function setBusy(busy) {
  const connect = element('bankSyncConnectButton');
  const refresh = element('bankSyncRefreshButton');
  const saveMappings = element('bankSyncSaveMappingsButton');
  if (connect) connect.disabled = busy;
  if (refresh) refresh.disabled = busy;
  if (saveMappings) saveMappings.disabled = busy;
}

function render(status = currentStatus) {
  currentStatus = normalizeBankConnectionStatus(status);
  const copy = bankStatusCopy(currentStatus);
  const statusNode = element('bankSyncStatus');
  const detailNode = element('bankSyncDetail');
  const connect = element('bankSyncConnectButton');
  const refresh = element('bankSyncRefreshButton');
  const hasEndpoint = Boolean(configuredEndpoint());

  if (statusNode) {
    statusNode.dataset.state = hasEndpoint ? currentStatus.state : 'unavailable';
    statusNode.textContent = hasEndpoint ? copy.label : 'Service bancaire à configurer';
  }
  if (detailNode) detailNode.textContent = hasEndpoint ? copy.detail : 'Freev est prêt, mais le serveur Open Banking sécurisé doit encore être relié.';
  if (connect) {
    connect.hidden = currentStatus.state === 'ready' && hasEndpoint;
    connect.textContent = hasEndpoint ? 'Connecter ma banque' : 'Service bientôt disponible';
  }
  if (refresh) refresh.hidden = !(currentStatus.state === 'ready' && hasEndpoint);
}

function freevAccounts() {
  return Array.isArray(window._getAppState?.().accounts) ? window._getAppState().accounts : [];
}

function renderAccountMappings(payload = currentMappingPayload) {
  currentMappingPayload = {
    bankAccounts: Array.isArray(payload?.bankAccounts) ? payload.bankAccounts : [],
    mappings: Array.isArray(payload?.mappings) ? payload.mappings : []
  };
  const section = element('bankSyncAccountMapping');
  const rowsContainer = element('bankSyncMappingRows');
  const hasEndpoint = Boolean(configuredEndpoint());
  const rows = buildBankMappingRows(currentMappingPayload.bankAccounts, freevAccounts(), currentMappingPayload.mappings);
  if (!section || !rowsContainer) return;
  section.hidden = !hasEndpoint || !rows.length;
  if (section.hidden) return;

  rowsContainer.replaceChildren(...rows.map(({ bankAccount, freevAccountId }) => {
    const row = document.createElement('div');
    row.className = 'v5-bank-map-row';
    const source = document.createElement('div');
    source.className = 'v5-bank-map-source';
    const icon = document.createElement('i');
    icon.className = `fa-solid fa-${bankAccount.type === 'savings' ? 'piggy-bank' : bankAccount.type === 'credit' ? 'credit-card' : 'building-columns'}`;
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = bankAccount.name;
    const details = document.createElement('small');
    details.textContent = [bankAccount.maskedIban, bankAccount.currency].filter(Boolean).join(' · ') || 'Compte bancaire';
    copy.append(name, details);
    source.append(icon, copy);

    const arrow = document.createElement('i');
    arrow.className = 'fa-solid fa-arrow-right v5-bank-map-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    const select = document.createElement('select');
    select.className = 'form-select v5-bank-map-select';
    select.dataset.bankAccountId = bankAccount.id;
    select.setAttribute('aria-label', `Associer ${bankAccount.name} à un compte Freev`);
    const none = new Option('Ne pas synchroniser ce compte', '');
    select.add(none);
    freevAccounts().forEach(account => select.add(new Option(account.name || 'Compte Freev', account.id)));
    select.value = freevAccountId;
    row.append(source, arrow, select);
    return row;
  }));
}

async function authenticatedRequest(path, options = {}) {
  const base = configuredEndpoint();
  const user = window._fbGetCurrentUser?.();
  if (!base || !user) throw new Error('not-ready');
  const idToken = await user.getIdToken();
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'omit',
    headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`request-${response.status}`);
  return response.json();
}

async function refresh() {
  if (!configuredEndpoint() || !window._fbGetCurrentUser?.()) {
    render();
    renderAccountMappings();
    return;
  }
  setBusy(true);
  try {
    render({ ...currentStatus, state: 'syncing' });
    const payload = await authenticatedRequest('/v1/bank-connections/status');
    render(payload);
    renderAccountMappings(payload);
  } catch (error) {
    console.warn('[Freev] État bancaire indisponible :', error?.name || 'erreur');
    render({ state: 'error' });
    renderAccountMappings();
  } finally {
    setBusy(false);
  }
}

async function completeBankCallback() {
  const currentUrl = new URL(window.location.href);
  const state = currentUrl.searchParams.get('state');
  const connectionId = currentUrl.searchParams.get('connection_id');
  const code = currentUrl.searchParams.get('code');
  const error = currentUrl.searchParams.get('error');
  if (!state || (!connectionId && !code && !error) || !configuredEndpoint() || !window._fbGetCurrentUser?.()) return;

  try {
    await authenticatedRequest('/v1/bank-connections/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    });
    if (error) window.showToast?.('La connexion bancaire a été annulée ou doit être vérifiée.', 'info');
    else window.showToast?.('Retour bancaire reçu. Freev vérifie les comptes disponibles.', 'success');
  } catch (callbackError) {
    console.warn('[Freev] Retour bancaire invalide :', callbackError?.name || 'erreur');
    window.showToast?.('Le retour bancaire n’a pas pu être validé. Aucun compte n’a été ajouté.', 'error');
  } finally {
    currentUrl.search = '';
    window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.hash}`);
  }
}

async function saveMappings(event) {
  event?.preventDefault();
  const rows = [...document.querySelectorAll('#bankSyncMappingRows select[data-bank-account-id]')];
  const requested = rows.filter(select => select.value).map(select => ({ bankAccountId: select.dataset.bankAccountId, freevAccountId: select.value }));
  const mappings = normalizeBankMappings(requested, currentMappingPayload.bankAccounts, freevAccounts());
  if (requested.length !== mappings.length) {
    window.showToast?.('Un compte Freev ne peut être relié qu’à un seul compte bancaire.', 'error');
    return;
  }
  setBusy(true);
  try {
    const payload = await authenticatedRequest('/v1/bank-connections/mappings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings })
    });
    render(payload.status || payload);
    renderAccountMappings(payload);
    window.showToast?.('Associations bancaires enregistrées.', 'success');
  } catch (error) {
    console.warn('[Freev] Associations bancaires refusées :', error?.name || 'erreur');
    window.showToast?.('Les associations n’ont pas été enregistrées. Aucune opération n’a été modifiée.', 'error');
  } finally {
    setBusy(false);
  }
}

async function begin() {
  if (!configuredEndpoint()) {
    window.showToast?.('La connexion bancaire sera activée après la configuration du service sécurisé.', 'info');
    return;
  }
  if (!window._fbGetCurrentUser?.()) {
    window.showToast?.('Connectez-vous à Freev avant de relier votre banque.', 'info');
    window.showAuthModal?.();
    return;
  }
  setBusy(true);
  try {
    const result = await authenticatedRequest('/v1/bank-connections/start', { method: 'POST' });
    if (!isSafeBankRedirect(result?.redirectUrl)) throw new Error('unsafe-redirect');
    window.location.assign(result.redirectUrl);
  } catch (error) {
    console.warn('[Freev] Démarrage bancaire refusé :', error?.name || 'erreur');
    window.showToast?.('La connexion bancaire n’a pas pu démarrer. Aucune donnée n’a été modifiée.', 'error');
  } finally {
    setBusy(false);
  }
}

function init() {
  element('bankSyncConnectButton')?.addEventListener('click', begin);
  element('bankSyncRefreshButton')?.addEventListener('click', refresh);
  element('bankSyncMappingForm')?.addEventListener('submit', saveMappings);
  element('bankSyncManageAccountsButton')?.addEventListener('click', () => window.openAccountsModal?.());
  element('bankSyncRefreshFreevAccountsButton')?.addEventListener('click', () => renderAccountMappings());
  render();
  renderAccountMappings();
  window.addEventListener('freev:ready', async () => {
    await completeBankCallback();
    await refresh();
  }, { once: true });
}

window.FreevBankSync = Object.freeze({ refresh, begin, saveMappings });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
