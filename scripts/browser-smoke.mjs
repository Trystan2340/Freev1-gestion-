import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
const playwrightImport = await import(playwrightModule.startsWith('.') || path.isAbsolute(playwrightModule)
  ? pathToFileURL(path.resolve(playwrightModule)).href
  : playwrightModule);
const { chromium } = playwrightImport.chromium ? playwrightImport : playwrightImport.default;

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
  await page.waitForFunction(() => Boolean(window.FreevV4 && window.FreevV5 && window._applyCloudData), null, { timeout: 15_000 });
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
          { id: 'food', type: 'expense', amount: 185, amountBase: 185, date: day, desc: 'Courses du mois', category: 'Alimentation', tags: ['famille'] },
          { id: 'market-1', type: 'expense', amount: 52, amountBase: 52, date: '2026-06-03', desc: 'CB Carrefour', category: 'Alimentation' },
          { id: 'market-2', type: 'expense', amount: 48, amountBase: 48, date: '2026-07-03', desc: 'Carrefour Market', category: 'Alimentation' },
          { id: 'netflix-1', type: 'expense', amount: 15, amountBase: 15, date: '2026-05-05', desc: 'Netflix', category: 'Abonnements' },
          { id: 'netflix-2', type: 'expense', amount: 15, amountBase: 15, date: '2026-06-05', desc: 'Netflix', category: 'Abonnements' },
          { id: 'netflix-3', type: 'expense', amount: 18, amountBase: 18, date: '2026-07-05', desc: 'Netflix', category: 'Abonnements' },
          { id: 'spotify', type: 'expense', amount: 11, amountBase: 11, date: '2026-07-08', desc: 'Spotify', category: 'À classer' }
        ],
        recurringTransactions: [{ id: 'internet', type: 'expense', amount: 35, frequency: 'monthly', startDate: '2026-01-05', dayOfMonth: 5, desc: 'Internet', category: 'Abonnements' }],
        monthlyBudget: 1200, budgetsByCategory: {}, savingsAccounts: {}, debts: [], historyLog: [],
        goals: [{ id: 'goal-1', name: 'Fonds d’urgence', target: 3000, current: 600, deadline: '2027-01-01' }],
        envelopes: { Alimentation: 150 }, plannerSettings: { forecastMonths: 6, monthlyAdjustment: 50, incomeAdjustment: 0, expenseAdjustment: 0, oneTimeExpense: 0, oneTimeMonth: 1 },
        automationRules: [], plannerScenarios: [], wealthAssets: [], ignoredSubscriptionKeys: [], documentIndex: [],
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
  const pageErrors = [];
  desktop.on('pageerror', error => pageErrors.push(`ordinateur: ${error.message}`));
  const chartRequests = [];
  desktop.on('request', request => { if (request.url().includes('chart.js')) chartRequests.push(request.url()); });
  await prepare(desktop);
  assert.equal(chartRequests.length, 0, 'Chart.js ne doit pas être téléchargé avant une vue qui utilise des graphiques');
  assert.equal(await desktop.locator('#v4Summary .v4-summary-card').count(), 4);
  assert.equal(await desktop.locator('#v4Forecast .v4-forecast-row').count(), 6);
  assert.equal(await desktop.locator('#v42ForecastInsights article').count(), 3);
  assert.equal(await desktop.locator('#v42ForecastChart svg').count(), 1);
  assert.equal(await desktop.locator('#v43PlannerIntelligence article').count(), 4);
  assert.equal(await desktop.locator('#v42ForecastChart .v43-risk-band').count(), 1);
  assert.equal(await desktop.locator('#v4Goals .v4-goal').count(), 1);
  await desktop.locator('#v4HelpButton').click();
  await desktop.waitForSelector('#freevHelpOverlay:not([hidden])');
  assert.equal(await desktop.locator('#freevHelpTabPlanner').getAttribute('aria-selected'), 'true');
  assert.ok((await desktop.textContent('#freevHelpPanelPlanner')).includes('tester un imprévu'));
  await desktop.waitForTimeout(250);
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-help-planner-desktop.png'), fullPage: true });
  await desktop.locator('#freevHelpTabPlanner').press('ArrowRight');
  assert.equal(await desktop.locator('#freevHelpTabSmart').getAttribute('aria-selected'), 'true');
  assert.ok((await desktop.textContent('#freevHelpPanelSmart')).includes('classer automatiquement Netflix'));
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-help-smart-desktop.png'), fullPage: true });
  await desktop.keyboard.press('Escape');
  assert.equal(await desktop.locator('#freevHelpOverlay').getAttribute('hidden'), '');
  assert.equal(await desktop.evaluate(() => document.activeElement?.id), 'v4HelpButton');
  assert.equal(await desktop.locator('#v41Health .v41-breakdown article').count(), 5);
  assert.equal(await desktop.locator('#v41Scenarios .v41-scenario').count(), 3);
  assert.ok(await desktop.locator('#v41Actions .v41-action').count() >= 1);
  await desktop.locator('[data-v41-scenario]').first().click();
  assert.ok(Number(await desktop.inputValue('#v4Adjustment')) > 0);
  await desktop.locator('[data-v42-preset="unexpected"]').click();
  assert.equal(Number(await desktop.inputValue('#v42OneTimeExpense')), 500);
  const downloadPromise = desktop.waitForEvent('download');
  await desktop.locator('.v42-chart-head button').click();
  const forecastDownload = await downloadPromise;
  assert.ok(forecastDownload.suggestedFilename().endsWith('.csv'));
  const lazyChartRequest = desktop.waitForRequest(request => request.url().includes('chart.min.js'));
  await desktop.evaluate(() => {
    window.__freevCloudState = 'synced';
    window.switchView('dashboard');
  });
  await lazyChartRequest;
  await desktop.waitForFunction(() => Boolean(window.Chart), null, { timeout: 15_000 });
  assert.equal(chartRequests.length, 1, 'Chart.js doit être chargé une seule fois à l’ouverture du tableau de bord');
  await desktop.waitForFunction(() => Boolean(window.Chart.getChart(document.getElementById('trendChart'))));
  const cashflowTypes = await desktop.evaluate(() => window.Chart.getChart(document.getElementById('trendChart')).data.datasets.map(dataset => dataset.type));
  assert.ok(cashflowTypes.includes('bar'), 'La vue Flux doit utiliser des barres lisibles');
  await desktop.locator('[data-dashboard-mode="balance"]').click();
  const balanceGraph = await desktop.evaluate(() => {
    const dataset = window.Chart.getChart(document.getElementById('trendChart')).data.datasets[0];
    return { label: dataset.label, data: dataset.data };
  });
  assert.ok(balanceGraph.label.includes('Solde'));
  assert.ok(balanceGraph.data.some(value => value === null), 'Les mois sans historique doivent rester vides');
  assert.ok(balanceGraph.data.some(value => Number.isFinite(value)), 'Les mois qui possèdent un historique doivent être dessinés');
  assert.ok(!(await desktop.textContent('#dashboardAlerts')).includes('Synchronisation suspendue'));
  assert.equal(await desktop.locator('#categoryChartEmpty:not(.hidden)').count(), 0);
  await desktop.waitForTimeout(300);
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v42-dashboard-desktop.png'), fullPage: true });
  await desktop.evaluate(() => window.switchView('planner'));
  await desktop.waitForTimeout(300);
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-planner-desktop.png'), fullPage: true });

  await desktop.evaluate(() => {
    window.switchView('smart');
    window.FreevV5.render();
  });
  await desktop.waitForSelector('#smart-view:not(.hidden)');
  assert.equal(await desktop.locator('#v5Summary article').count(), 4);
  assert.equal(await desktop.locator('[data-v5-tab]').count(), 7);
  assert.equal(await desktop.locator('#v51IntelligenceBrief .v51-score').count(), 1);
  assert.equal(await desktop.locator('#v51ChangeGrid article').count(), 4);
  assert.ok(await desktop.locator('#v5Overview article').count() >= 1);
  await desktop.locator('#v5HelpButton').click();
  await desktop.waitForSelector('#freevHelpOverlay:not([hidden])');
  assert.equal(await desktop.locator('#freevHelpTabSmart').getAttribute('aria-selected'), 'true');
  await desktop.locator('[data-freev-help-target="smart"]').click();
  assert.equal(await desktop.locator('#freevHelpOverlay').getAttribute('hidden'), '');
  assert.equal(await desktop.locator('#smart-view:not(.hidden)').count(), 1);
  await desktop.waitForTimeout(650);
  await desktop.evaluate(() => window.FreevV5.closeWhatsNew(false));
  const visibleOverlays = await desktop.locator('.v4-overlay').evaluateAll(overlays => overlays
    .filter(overlay => getComputedStyle(overlay).display !== 'none')
    .map(overlay => ({ id: overlay.id, hidden: overlay.hidden, display: getComputedStyle(overlay).display })));
  assert.deepEqual(visibleOverlays, [], `Une fenêtre reste visuellement ouverte : ${JSON.stringify(visibleOverlays)}`);
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v51-overview-desktop.png'), fullPage: true });

  await desktop.locator('[data-v5-tab="overview"]').focus();
  await desktop.keyboard.press('ArrowRight');
  assert.equal(await desktop.locator('[data-v5-tab="rules"]').getAttribute('aria-selected'), 'true');
  assert.ok(await desktop.locator('#v5RuleSuggestions article').count() >= 1);
  await desktop.fill('#v5RuleContains', 'Spotify');
  await desktop.fill('#v5RuleCategory', 'Abonnements');
  await desktop.locator('#v5RuleForm button[type="submit"]').click();
  assert.equal(await desktop.locator('#v5RulesList .v5-rule').count(), 1);
  await desktop.fill('#v5RuleContains', 'spotify');
  await desktop.fill('#v5RuleCategory', 'Abonnements');
  await desktop.locator('#v5RuleForm button[type="submit"]').click();
  assert.equal(await desktop.locator('#v5RulesList .v5-rule').count(), 1, 'Une règle identique ne doit pas être dupliquée');
  const classifiedCategory = await desktop.evaluate(() => window._getAppState().accounts[0].transactions.find(item => item.id === 'spotify').category);
  assert.equal(classifiedCategory, 'Abonnements');

  await desktop.locator('[data-v5-tab="subscriptions"]').click();
  assert.ok(await desktop.locator('#v5Subscriptions .v5-subscription').count() >= 2);
  assert.ok((await desktop.textContent('#v5SubscriptionTotal')).includes('€'));

  await desktop.locator('[data-v5-tab="scenarios"]').click();
  await desktop.fill('#v5ScenarioName', 'Projet test');
  await desktop.locator('#v5ScenarioForm button[type="submit"]').click();
  assert.equal(await desktop.locator('#v5Scenarios .v5-scenario').count(), 1);

  await desktop.locator('[data-v5-tab="wealth"]').click();
  await desktop.fill('#v5AssetName', 'Appartement test');
  await desktop.fill('#v5AssetValue', '120000');
  await desktop.locator('#v5AssetForm button[type="submit"]').click();
  assert.equal(await desktop.locator('#v5WealthAssets article').count(), 1);
  assert.ok((await desktop.textContent('#v5WealthSummary')).includes('120'));

  await desktop.locator('[data-v5-tab="imports"]').click();
  await desktop.locator('#v5StatementFile').setInputFiles({
    name: 'releve-test.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Date;Description;Montant;Catégorie\n${new Date().toISOString().slice(0, 7)}-02;Courses du mois;-185;Alimentation\n2026-07-20;Cinéma;-14,50;Loisirs`)
  });
  await desktop.waitForSelector('#v5ConfirmImport');
  assert.ok((await desktop.textContent('#v5ImportPreview')).includes('1 doublons évités'));
  await desktop.locator('#v5ConfirmImport').click();
  const cinemaImported = await desktop.evaluate(() => window._getAppState().accounts[0].transactions.some(item => item.desc === 'Cinéma'));
  assert.equal(cinemaImported, true);

  await desktop.locator('[data-v5-tab="security"]').click();
  assert.equal(await desktop.locator('#v5TrustedDevice').count(), 1);
  assert.equal(await desktop.locator('[data-v5-network]').count(), 2);
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v5-smart-desktop.png'), fullPage: true });
  await desktop.evaluate(() => window.FreevV5.showWhatsNew(true));
  await desktop.waitForSelector('#v5WhatsNew:not([hidden])');
  assert.equal(await desktop.locator('#v5WhatsNew .v4-feature-grid article').count(), 6);
  await desktop.evaluate(() => window.FreevV5.closeWhatsNew(false));

  await desktop.evaluate(() => window.switchView('planner'));
  await desktop.evaluate(() => window.FreevV4.openSearch());
  await desktop.fill('#v4SearchInput', 'courses');
  await desktop.waitForSelector('#v4SearchResults .v4-search-result');
  await desktop.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-desktop.png'), fullPage: true });

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  });
  mobile.on('pageerror', error => pageErrors.push(`iPhone: ${error.message}`));
  await prepare(mobile);
  await mobile.evaluate(() => {
    window.switchView('smart');
    window.FreevV5.render();
  });
  await mobile.waitForSelector('#smart-view:not(.hidden)');
  await mobile.waitForTimeout(350);
  const dimensions = await mobile.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, `Débordement horizontal mobile : ${dimensions.scroll}px pour ${dimensions.width}px`);
  assert.ok(await mobile.locator('.v5-tabs').evaluate(element => element.scrollWidth > 0));
  assert.equal(await mobile.locator('#v51ChangeGrid article').count(), 4);
  const renderDuration = await mobile.evaluate(() => {
    const start = performance.now();
    for (let index = 0; index < 15; index += 1) window.FreevV5.render();
    return performance.now() - start;
  });
  assert.ok(renderDuration < 1200, `Rendu Centre 5.1 trop lent sur mobile simulé : ${renderDuration.toFixed(1)} ms`);
  await mobile.locator('#v5PanelOverview').scrollIntoViewIfNeeded();
  await mobile.locator('#v5PanelOverview').screenshot({ path: path.join(os.tmpdir(), 'freev-v51-overview-mobile-detail.png') });
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v5-smart-mobile.png'), fullPage: true });
  await mobile.evaluate(() => window.switchView('planner'));
  await mobile.locator('#v4HelpButton').click();
  await mobile.waitForSelector('#freevHelpOverlay:not([hidden])');
  const helpDimensions = await mobile.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(helpDimensions.scroll <= helpDimensions.width + 1, `Débordement de l’aide mobile : ${helpDimensions.scroll}px pour ${helpDimensions.width}px`);
  await mobile.waitForTimeout(250);
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-help-mobile.png'), fullPage: true });
  await mobile.keyboard.press('Escape');
  await mobile.evaluate(() => window.FreevPWA.openGuide());
  await mobile.waitForSelector('#pwaInstallModal:not([hidden])');
  assert.ok((await mobile.textContent('#pwaInstallTitle')).includes('iPhone'));
  assert.equal(await mobile.locator('#pwaInstallSteps li').count(), 3);
  await mobile.waitForTimeout(300);
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v42-install-iphone.png'), fullPage: true });
  await mobile.evaluate(() => window.FreevPWA.closeGuide());
  await mobile.evaluate(() => window.FreevPWA.showBanner(true));
  assert.equal(await mobile.locator('#pwaInstallBanner:not([hidden])').count(), 1);
  await mobile.evaluate(() => window.FreevPWA.dismissBanner());
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-planner-mobile.png'), fullPage: true });
  const plannerDimensions = await mobile.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(plannerDimensions.scroll <= plannerDimensions.width + 1, `Débordement du Planificateur mobile : ${plannerDimensions.scroll}px pour ${plannerDimensions.width}px`);
  await mobile.locator('.v4-forecast-card').scrollIntoViewIfNeeded();
  await mobile.waitForTimeout(250);
  await mobile.locator('.v4-forecast-card').screenshot({ path: path.join(os.tmpdir(), 'freev-v42-planner-mobile-card.png') });
  await mobile.evaluate(() => window.FreevV4.showWhatsNew(true));
  await mobile.waitForSelector('#v4WhatsNew:not([hidden])');
  await mobile.screenshot({ path: path.join(os.tmpdir(), 'freev-v4-mobile.png'), fullPage: true });
  assert.deepEqual(pageErrors, [], `Erreurs JavaScript détectées : ${pageErrors.join(' | ')}`);
  console.log('Test navigateur réussi : Planificateur 4.3, Centre 5.1, aide intégrée, performance mobile, import sécurisé et installation iPhone vérifiés.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
