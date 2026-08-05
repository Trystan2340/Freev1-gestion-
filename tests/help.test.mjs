import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('le guide intégré documente les versions 4.3 et 5.1 avec des exemples accessibles', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'assets/js/help.js'), 'utf8');

  assert.match(html, /id="freevHelpOverlay"[^>]+role="dialog"[^>]+aria-modal="true"/);
  assert.match(html, /data-freev-help-tab="planner"/);
  assert.match(html, /data-freev-help-tab="smart"/);
  assert.match(html, /Exemple : tester un imprévu/);
  assert.match(html, /Exemple : classer automatiquement Netflix/);
  assert.match(html, /Date;Description;Montant;Catégorie/);
  assert.match(script, /lastFocused/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /trapFocus/);
});
