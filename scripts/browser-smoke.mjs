import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightModule.startsWith('.') || path.isAbsolute(playwrightModule)
  ? pathToFileURL(path.resolve(playwrightModule)).href
  : playwrightModule);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(target).pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function prepare(page) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.FreevV4 && window._applyCloudData), null, { timeout: 15_000 });
  await page.addStyleTag({ content: '#authOverlay, #authLoadingScreen { display: none !important; pointer-events: none !important; }' });
  await page.evaluate(() => {
    const month = new Date().toISOString().slice(0, 7);
    const day = `${month}-02`;
    window._applyCloudData({
      currentAccountId: 'test-account',
      accounts: [{
        id: 'test-account', name: 'Compte test', initialCapital: 1500,
        transactions: [
          { id: 'income', type: 'income', amount: 2100, amountBase: 2100, date: day, desc: 'Salaire', category: 'Revenus' },
          { id: 'food', type: 'expense', amount: 185, amountBase: 185, date: day, desc: 'Courses du mois', category: 'Alimentation', tags: ['famille'] }
        ],
        recurringTransactions: [{ id: 'internet', type: 'expense', amount: 35, frequency: 'monthly', startDate: '2026-01-05', dayOfMonth: 5, desc: 'Internet', category: 'Abonnements' }],
        monthlyBudget: 1200, budgetsByCategory: {}, savingsAccounts: {}, debts: [], historyLog: [],
        goals: [{ id: 'goal-1', name: 'Fonds d’urgence', target: 3000, current: 600, deadline: '2027-01-01' }],
        envelopes: { Alimentation: 150 }, plannerSettings: { forecastMonths: 6, monthlyAdjustment: 50 },
        settings: { baseCurrency: 'EUR', defaultMode: 'personal' }
      }]
    });
    document.getElementById('authOverlay')?.style.setProperty('display', 'none');
    document.getElementById('authLoadingScreen')?.style.setProperty('display', 'none');
    window.switchView('planner');
    window.FreevV4.render();
  });
  await page.waitForSelector('#planner-view:not(.hidden)');
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const chartRequests = [];
  desktop.on('request', request => { if (request.url().includes('chart.js')) chartRequests.push(request.url()); });
  await prepare(desktop);
  assert.equal(chartRequests.length, 0, 'Chart.js ne doit pas être téléchargé avant une vue qui utilise des graphiques');
  assert.equal(await desktop.locator('#v4Summary .v4-summary-card').count(), 4);
  assert.equal(await desktop.locator('#v4Forecast .v4-forecast-row').count(), 6);
  assert.equal(await desktop.locator('#v4Goals .v4-goal').count(), 1);
  assert.equal(await desktop.locator('#v41Health .v41-breakdown article').count(), 5);
  assert.equal(await desktop.locator('#v41Scenarios .v41-scenario').count(), 3);
  assert.ok(await desktop.locator('#v41Actions .v41-action').count() >= 1);
  await desktop.locator('[data-v41-scenario]').first().click();
  assert.ok(Number(await desktop.inputValue('#v4Adjustment')) > 0);
  const lazyChartRequest = desktop.waitForRequest(request => request.url().includes('chart.min.js'));
  await desktop.evaluate(() => window.switchView('dashboard'));
  await lazyChartRequest;
  await desktop.waitForFunction(() => Boolean(window.Chart), null, { timeout: 15_000 });
  assert.equal(chartRequests.length, 1, 'Chart.js doit être chargé une seule fois à l’ouverture du tableau de bord');
  await desktop.evaluate(() => window.switchView('planner'));
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-planner-desktop.png'), fullPage: true });
  await desktop.evaluate(() => window.FreevV4.openSearch());
  await desktop.fill('#v4SearchInput', 'courses');
  await desktop.waitForSelector('#v4SearchResults .v4-search-result');
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-desktop.png'), fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await prepare(mobile);
  const dimensions = await mobile.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, `Débordement horizontal mobile : ${dimensions.scroll}px pour ${dimensions.width}px`);
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-planner-mobile.png'), fullPage: true });
  await mobile.evaluate(() => window.FreevV4.showWhatsNew(true));
  await mobile.waitForSelector('#v4WhatsNew:not([hidden])');
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-mobile.png'), fullPage: true });
  console.log('Test navigateur réussi : planificateur, recherche, popup et affichage mobile vérifiés.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
