import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = await initializeTestEnvironment({
  projectId: 'freev-valeur-rules-test',
  firestore: {
    host: '127.0.0.1',
    port: 8080,
    rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
  }
});

try {
  const owner = environment.authenticatedContext('owner').firestore();
  const intruder = environment.authenticatedContext('intruder').firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  const ownerDocument = doc(owner, 'users/owner');

  await assertSucceeds(setDoc(ownerDocument, { accounts: [], schemaVersion: '2026-08-02-v5' }));
  await assertSucceeds(getDoc(ownerDocument));
  await assertSucceeds(updateDoc(ownerDocument, { currentAccountId: 'account-1' }));
  await assertFails(getDoc(doc(intruder, 'users/owner')));
  await assertFails(setDoc(doc(intruder, 'users/owner'), { accounts: ['stolen'] }));
  await assertFails(getDoc(doc(anonymous, 'users/owner')));
  await assertFails(setDoc(doc(owner, 'publicProfiles/owner'), { ownerUid: 'owner' }));
  await assertSucceeds(deleteDoc(ownerDocument));
  console.log('Règles Firestore vérifiées : propriétaire autorisé, accès croisés et anonymes refusés.');
} finally {
  await environment.cleanup();
}
