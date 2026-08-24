const SAFE_STATES = new Set(['not_connected', 'ready', 'syncing', 'action_required', 'error']);
const MAX_INSTITUTION_LENGTH = 80;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_ACCOUNT_LABEL_LENGTH = 80;
const SAFE_BANK_ACCOUNT_TYPES = new Set(['current', 'savings', 'credit', 'other']);

function safeIdentifier(value) {
  const identifier = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{1,160}$/.test(identifier) ? identifier : '';
}

function safeLabel(value, fallback) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_ACCOUNT_LABEL_LENGTH) || fallback;
}

export function normalizeBankConnectionStatus(payload) {
  const state = SAFE_STATES.has(payload?.state) ? payload.state : 'not_connected';
  const institution = String(payload?.institution || '').trim().slice(0, MAX_INSTITUTION_LENGTH);
  const lastSync = typeof payload?.lastSync === 'string' && !Number.isNaN(Date.parse(payload.lastSync))
    ? payload.lastSync
    : '';
  const pendingCount = Number.isInteger(payload?.pendingCount) && payload.pendingCount >= 0
    ? Math.min(payload.pendingCount, 999)
    : 0;

  return { state, institution, lastSync, pendingCount };
}

export function isSafeBankRedirect(url) {
  try {
    return new URL(String(url)).protocol === 'https:';
  } catch {
    return false;
  }
}

export function bankStatusCopy(status) {
  const safe = normalizeBankConnectionStatus(status);
  if (safe.state === 'ready') {
    const synced = safe.lastSync ? `Dernière synchronisation : ${new Date(safe.lastSync).toLocaleString('fr-FR')}.` : 'Synchronisation prête.';
    return { label: safe.institution || 'Banque connectée', detail: `${synced} ${safe.pendingCount ? `${safe.pendingCount} opération(s) à vérifier.` : 'Aucune opération en attente.'}` };
  }
  if (safe.state === 'syncing') return { label: 'Synchronisation en cours', detail: 'Freev vérifie les nouvelles opérations sans modifier votre historique.' };
  if (safe.state === 'action_required') return { label: 'Votre validation est nécessaire', detail: 'Ouvrez votre banque pour renouveler votre consentement sécurisé.' };
  if (safe.state === 'error') return { label: 'Connexion à vérifier', detail: 'Aucune donnée n’a été ajoutée. Réessayez après avoir vérifié votre banque.' };
  return { label: 'Aucune banque connectée', detail: 'Connectez votre banque pour recevoir des opérations à valider dans Freev.' };
}

export function normalizeBankAccount(payload) {
  const id = safeIdentifier(payload?.id);
  if (!id) return null;
  const type = SAFE_BANK_ACCOUNT_TYPES.has(payload?.type) ? payload.type : 'other';
  const currency = /^[A-Z]{3}$/.test(String(payload?.currency || '').toUpperCase()) ? String(payload.currency).toUpperCase() : 'EUR';
  const maskedIban = String(payload?.maskedIban || '').replace(/[^A-Za-z0-9*•\s-]/g, '').trim().slice(0, 42);
  return { id, name: safeLabel(payload?.name, 'Compte bancaire'), type, currency, maskedIban };
}

export function normalizeFreevAccount(payload) {
  const id = safeIdentifier(payload?.id);
  if (!id) return null;
  return { id, name: safeLabel(payload?.name, 'Compte Freev') };
}

export function normalizeBankMappings(mappings, bankAccounts, freevAccounts) {
  const validBankIds = new Set((bankAccounts || []).map(normalizeBankAccount).filter(Boolean).map(account => account.id));
  const validFreevIds = new Set((freevAccounts || []).map(normalizeFreevAccount).filter(Boolean).map(account => account.id));
  const usedBankIds = new Set();
  const usedFreevIds = new Set();

  return (Array.isArray(mappings) ? mappings : []).reduce((result, mapping) => {
    const bankAccountId = safeIdentifier(mapping?.bankAccountId);
    const freevAccountId = safeIdentifier(mapping?.freevAccountId);
    if (!validBankIds.has(bankAccountId) || !validFreevIds.has(freevAccountId) || usedBankIds.has(bankAccountId) || usedFreevIds.has(freevAccountId)) return result;
    usedBankIds.add(bankAccountId);
    usedFreevIds.add(freevAccountId);
    result.push({ bankAccountId, freevAccountId });
    return result;
  }, []);
}

export function buildBankMappingRows(bankAccounts, freevAccounts, mappings) {
  const external = (bankAccounts || []).map(normalizeBankAccount).filter(Boolean);
  const internal = (freevAccounts || []).map(normalizeFreevAccount).filter(Boolean);
  const validMappings = normalizeBankMappings(mappings, external, internal);
  const targetByBankId = new Map(validMappings.map(mapping => [mapping.bankAccountId, mapping.freevAccountId]));
  return external.map(bankAccount => ({ bankAccount, freevAccountId: targetByBankId.get(bankAccount.id) || '' }));
}
