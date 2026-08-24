import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('les contrôles animés restent accessibles et respectent les mouvements réduits', async () => {
  const css = await readFile(new URL('../assets/css/app.css', import.meta.url), 'utf8');

  assert.match(css, /Uiverse component adaptation: Switch by m1her/);
  assert.match(css, /\.btn:focus-visible/);
  assert.match(css, /\.form-select\s*\{[\s\S]*appearance:\s*none/);
  assert.match(css, /\.form-select:hover/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.freev-motion-button/);
});
