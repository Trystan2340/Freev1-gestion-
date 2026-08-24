import test from 'node:test';
import assert from 'node:assert/strict';
import { bankStatusCopy, buildBankMappingRows, isSafeBankRedirect, normalizeBankConnectionStatus, normalizeBankMappings } from '../assets/js/bank-sync-engine.js';

test('la connexion bancaire normalise les états reçus du serveur', () => {
  assert.deepEqual(normalizeBankConnectionStatus({ state: 'ready', institution: ' Banque de test ', pendingCount: 2, lastSync: '2026-08-24T10:00:00.000Z' }), {
    state: 'ready', institution: 'Banque de test', pendingCount: 2, lastSync: '2026-08-24T10:00:00.000Z'
  });
  assert.equal(normalizeBankConnectionStatus({ state: 'unknown', pendingCount: -3 }).state, 'not_connected');
});

test('la redirection bancaire exige HTTPS', () => {
  assert.equal(isSafeBankRedirect('https://consent.example/authorize'), true);
  assert.equal(isSafeBankRedirect('http://consent.example/authorize'), false);
  assert.equal(isSafeBankRedirect('javascript:alert(1)'), false);
});

test('le statut ne promet pas d’import automatique silencieux', () => {
  assert.match(bankStatusCopy({ state: 'ready', pendingCount: 3 }).detail, /à vérifier/);
});

test('chaque compte bancaire est associé à un seul compte Freev valide', () => {
  const banks = [{ id: 'bank-current', name: 'Compte courant', type: 'current' }, { id: 'bank-savings', name: 'Livret A', type: 'savings' }];
  const freev = [{ id: 'freev-main', name: 'Compte principal' }, { id: 'freev-savings', name: 'Épargne' }];
  const mappings = normalizeBankMappings([
    { bankAccountId: 'bank-current', freevAccountId: 'freev-main' },
    { bankAccountId: 'bank-savings', freevAccountId: 'freev-main' },
    { bankAccountId: 'unknown', freevAccountId: 'freev-savings' }
  ], banks, freev);
  assert.deepEqual(mappings, [{ bankAccountId: 'bank-current', freevAccountId: 'freev-main' }]);
  assert.deepEqual(buildBankMappingRows(banks, freev, [{ bankAccountId: 'bank-savings', freevAccountId: 'freev-savings' }]).map(row => [row.bankAccount.name, row.freevAccountId]), [
    ['Compte courant', ''], ['Livret A', 'freev-savings']
  ]);
});
