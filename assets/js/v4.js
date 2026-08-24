import {
  accountBalance,
  buildActionPlan,
  buildSmartAlerts,
  calculateForecast,
  calculateFinancialHealth,
  calculatePlannerIntelligence,
  compareForecastScenarios,
  envelopeUsage,
  financialCalendar,
  goalProgress,
  normalizeForecastMonths,
  normalizeProjectionScope,
  recurringExpenseCostByCategory,
  searchTransactions,
  summarizeForecast,
  transactionEffect
} from './v4-engine.js';

const RELEASE_KEY = 'freevValeurWhatsNew_4_3';
let initialized = false;
let searchTimer = null;
let simulatorTimer = null;

const PROJECTION_DESCRIPTIONS = {
  recurring: 'Projection limitée aux revenus et dépenses récurrents.',
  'recurring-scheduled': 'Projection basée sur les récurrences et les opérations futures déjà planifiées.',
  complete: 'Projection basée sur vos habitudes, récurrences et opérations planifiées.'
};

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

function syncPlannerMaintenance() {
  const view = $('planner-view');
  const maintenance = $('v4PlannerMaintenance');
  if (!view || !maintenance) return false;
  const localPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).get('plannerPreview') === '1';
  const enabled = window.FREEV_FEATURE_FLAGS?.plannerMaintenance === true && !localPreview;
  maintenance.hidden = !enabled;
  Array.from(view.children).forEach(child => {
    if (child !== maintenance) child.hidden = enabled;
  });
  return enabled;
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

function monthLabel(month, style = 'short') {
  return new Intl.DateTimeFormat('fr-FR', { month: style, year: 'numeric' })
    .format(new Date(`${month}-01T12:00:00`));
}

function renderForecastInsights(appState, forecast, startingBalance) {
  const container = $('v42ForecastInsights');
  if (!container) return;
  const insight = summarizeForecast(forecast, startingBalance);
  const negative = insight.firstNegativeMonth
    ? `<article class="danger"><i class="fa-solid fa-triangle-exclamation"></i><div><span>Risque de découvert</span><strong>${escapeHTML(monthLabel(insight.firstNegativeMonth))}</strong></div></article>`
    : '<article class="success"><i class="fa-solid fa-shield-halved"></i><div><span>Risque de découvert</span><strong>Aucun sur la période</strong></div></article>';
  container.innerHTML = [
    `<article class="${insight.totalChange >= 0 ? 'success' : 'warning'}"><i class="fa-solid fa-arrow-trend-${insight.totalChange >= 0 ? 'up' : 'down'}"></i><div><span>Variation totale</span><strong>${insight.totalChange >= 0 ? '+' : ''}${escapeHTML(formatMoney(insight.totalChange, appState))}</strong></div></article>`,
    `<article><i class="fa-solid fa-water"></i><div><span>Solde minimum</span><strong>${escapeHTML(formatMoney(insight.lowestBalance, appState))}</strong><small>${insight.lowestMonth ? escapeHTML(monthLabel(insight.lowestMonth)) : 'Maintenant'}</small></div></article>`,
    negative
  ].join('');
}

function renderForecastBreakdown(appState, forecast) {
  const container = $('v43ForecastBreakdown');
  const firstMonth = forecast[0];
  if (!container) return;
  if (!firstMonth) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const amount = value => Number(value) || 0;
  const signedMoney = value => {
    const normalized = amount(value);
    return `${normalized > 0 ? '+' : ''}${formatMoney(normalized, appState)}`;
  };
  const projectionScope = normalizeProjectionScope(firstMonth.projectionScope);
  const rows = [
    {
      icon: 'clock-rotate-left',
      label: 'Habitudes récentes',
      detail: projectionScope === 'complete' ? 'Moyenne mensuelle de vos 3 derniers mois' : 'Exclues par votre filtre de projection',
      value: amount(firstMonth.historicalChange),
      excluded: projectionScope !== 'complete'
    },
    {
      icon: 'arrows-rotate',
      label: 'Récurrences',
      detail: 'Revenus et dépenses qui se répètent ce mois-ci',
      value: amount(firstMonth.recurringChange)
    },
    {
      icon: 'calendar-check',
      label: 'Opérations planifiées',
      detail: projectionScope === 'recurring' ? 'Exclues par votre filtre de projection' : 'Transactions futures déjà enregistrées pour ce mois',
      value: amount(firstMonth.scheduledChange),
      excluded: projectionScope === 'recurring'
    }
  ];
  if (Math.abs(amount(firstMonth.monthlySimulation)) >= 0.005) {
    rows.push({
      icon: 'sliders',
      label: 'Simulation',
      detail: 'Ajustements testés dans le simulateur avancé',
      value: amount(firstMonth.monthlySimulation)
    });
  }
  if (Math.abs(amount(firstMonth.oneTimeAdjustment)) >= 0.005) {
    rows.push({
      icon: 'triangle-exclamation',
      label: 'Imprévu',
      detail: 'Dépense ponctuelle simulée pour ce mois',
      value: amount(firstMonth.oneTimeAdjustment)
    });
  }
  rows.push({
    icon: 'equals',
    label: 'Total mensuel',
    detail: 'Somme utilisée pour calculer le prochain solde',
    value: amount(firstMonth.change),
    total: true
  });

  container.innerHTML = `
    <div class="v43-breakdown-head">
      <div>
        <strong id="v43ForecastBreakdownTitle">D’où vient la prévision de ${escapeHTML(monthLabel(firstMonth.month, 'long'))} ?</strong>
        <span>Les lignes grisées sont exclues du calcul. Les simulations ne modifient pas vos transactions.</span>
      </div>
    </div>
    <dl class="v43-breakdown-grid">
      ${rows.map(row => `<div class="v43-breakdown-row${row.total ? ' total' : ''}${row.excluded ? ' excluded' : ''}" data-v43-breakdown-row>
        <dt><i class="fa-solid fa-${row.icon}" aria-hidden="true"></i><span><strong>${escapeHTML(row.label)}</strong><small>${escapeHTML(row.detail)}</small></span></dt>
        <dd class="${row.value >= 0 ? 'positive-text' : 'negative-text'}">${escapeHTML(signedMoney(row.value))}</dd>
      </div>`).join('')}
    </dl>`;
}

function renderPlannerIntelligence(appState, intelligence) {
  const container = $('v43PlannerIntelligence');
  if (!container) return;
  const runway = intelligence.runwayMonths === null
    ? 'Sans dépense moyenne'
    : `${intelligence.runwayMonths.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`;
  const effort = intelligence.recommendedMonthlyAdjustment > 0
    ? `${formatMoney(intelligence.recommendedMonthlyAdjustment, appState)} / mois`
    : 'Aucun effort requis';
  container.innerHTML = [
    `<article class="${intelligence.risk.level}"><i class="fa-solid fa-shield-halved"></i><div><span>Risque prévisionnel</span><strong>${escapeHTML(intelligence.risk.label)}</strong><small>${escapeHTML(intelligence.risk.detail)}</small></div></article>`,
    `<article><i class="fa-solid fa-life-ring"></i><div><span>Autonomie estimée</span><strong>${escapeHTML(runway)}</strong><small>Trésorerie et épargne face aux dépenses moyennes.</small></div></article>`,
    `<article class="${intelligence.recommendedMonthlyAdjustment > 0 ? 'warning' : 'success'}"><i class="fa-solid fa-bullseye"></i><div><span>Effort de sécurité conseillé</span><strong>${escapeHTML(effort)}</strong><small>Cible : garder ${escapeHTML(formatMoney(intelligence.safetyTarget, appState))} au point le plus bas.</small></div></article>`,
    `<article><i class="fa-solid fa-database"></i><div><span>Confiance des prévisions</span><strong>${intelligence.confidence}% · ${escapeHTML(intelligence.confidenceLabel)}</strong><small>${intelligence.activeMonths}/6 mois documentés, ${intelligence.transactionCount} opération(s) · horizon ${intelligence.horizonMonths} mois.</small></div></article>`
  ].join('');
}

function renderForecastChart(appState, forecast, startingBalance, bands = []) {
  const container = $('v42ForecastChart');
  if (!container) return;
  if (!forecast.length) {
    container.innerHTML = '<p class="v4-empty">Aucune projection à afficher.</p>';
    return;
  }
  const width = 760;
  const height = 245;
  const padding = { left: 18, right: 18, top: 22, bottom: 36 };
  const rows = [{ month: 'Aujourd’hui', balance: startingBalance }, ...forecast];
  const balances = [
    ...rows.map(row => Number(row.balance) || 0),
    ...bands.flatMap(row => [Number(row.optimistic) || 0, Number(row.stress) || 0])
  ];
  const minimum = Math.min(0, ...balances);
  const maximum = Math.max(0, ...balances);
  const spread = Math.max(1, maximum - minimum);
  const x = index => padding.left + (index / Math.max(1, rows.length - 1)) * (width - padding.left - padding.right);
  const y = balance => padding.top + ((maximum - balance) / spread) * (height - padding.top - padding.bottom);
  const points = rows.map((row, index) => `${x(index).toFixed(1)},${y(row.balance).toFixed(1)}`).join(' ');
  const area = `${padding.left},${height - padding.bottom} ${points} ${width - padding.right},${height - padding.bottom}`;
  const bandRows = [{ optimistic: startingBalance, stress: startingBalance }, ...bands];
  const upper = bandRows.map((row, index) => `${x(index).toFixed(1)},${y(row.optimistic).toFixed(1)}`);
  const lower = [...bandRows].reverse().map((row, reverseIndex) => {
    const index = bandRows.length - reverseIndex - 1;
    return `${x(index).toFixed(1)},${y(row.stress).toFixed(1)}`;
  });
  const riskBand = [...upper, ...lower].join(' ');
  const zeroY = y(0).toFixed(1);
  const labelEvery = Math.max(1, Math.ceil((rows.length - 1) / 6));
  const labels = rows.map((row, index) => {
    if (index !== 0 && index !== rows.length - 1 && index % labelEvery !== 0) return '';
    const label = index === 0 ? 'Maint.' : monthLabel(row.month, 'short').replace('.', '');
    return `<text x="${x(index).toFixed(1)}" y="${height - 12}" text-anchor="${index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'}">${escapeHTML(label)}</text>`;
  }).join('');
  const dots = rows.map((row, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(row.balance).toFixed(1)}" r="${index === rows.length - 1 ? 5 : 3}"><title>${escapeHTML(index === 0 ? 'Aujourd’hui' : monthLabel(row.month))} : ${escapeHTML(formatMoney(row.balance, appState))}</title></circle>`).join('');
  container.setAttribute('aria-label', `Solde prévu de ${formatMoney(startingBalance, appState)} à ${formatMoney(forecast.at(-1).balance, appState)} sur ${forecast.length} mois.`);
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false"><defs><linearGradient id="v42ForecastGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb" stop-opacity=".28"/><stop offset="1" stop-color="#2563eb" stop-opacity=".02"/></linearGradient></defs><line class="v42-zero-line" x1="${padding.left}" x2="${width - padding.right}" y1="${zeroY}" y2="${zeroY}"/>${bands.length ? `<polygon class="v43-risk-band" points="${riskBand}"/>` : ''}<polygon class="v42-forecast-area" points="${area}"/><polyline class="v42-forecast-line" points="${points}"/>${dots}${labels}</svg>`;
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

function renderHealth(appState, health) {
  const container = $('v41Health');
  if (!container) return;
  const tone = health.score >= 80 ? 'excellent' : health.score >= 65 ? 'solid' : health.score >= 45 ? 'warning' : 'danger';
  container.innerHTML = `<div class="v41-health-overview"><div class="v41-score-ring ${tone}" style="--score:${health.score}"><div><strong>${health.score}</strong><span>/ 100</span></div></div><div class="v41-health-copy"><span>Santé ${escapeHTML(health.label.toLowerCase())}</span><strong>${health.emergencyMonths.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois de réserve</strong><small>${health.savingsRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}% de capacité d’épargne récente</small></div></div><div class="v41-breakdown">${health.breakdown.map(item => {
    const value = item.value === null ? 'À configurer' : item.unit === '%' ? `${item.value}%` : item.unit === 'mois' ? `${item.value} mois` : formatMoney(item.value, appState);
    const percent = Math.round((item.score / item.max) * 100);
    return `<article><div class="v41-metric-head"><strong>${escapeHTML(item.label)}</strong><span>${item.score}/${item.max}</span></div><div class="v4-progress"><span style="width:${percent}%"></span></div><div class="v41-metric-foot"><span>${escapeHTML(value)}</span><small>${escapeHTML(item.advice)}</small></div></article>`;
  }).join('')}</div>`;
}

function renderScenarios(appState, scenarios) {
  const container = $('v41Scenarios');
  if (!container) return;
  container.innerHTML = scenarios.map(scenario => `<article class="v41-scenario ${scenario.tone}"><span class="v41-scenario-icon"><i class="fa-solid fa-${scenario.id === 'prudent' ? 'seedling' : scenario.id === 'stress' ? 'umbrella' : 'route'}"></i></span><div><strong>${escapeHTML(scenario.label)}</strong><span>${escapeHTML(scenario.detail)}</span></div><div class="v41-scenario-result"><strong>${escapeHTML(formatMoney(scenario.finalBalance, appState))}</strong><small>solde final</small></div><button type="button" class="v4-text-button" data-v41-scenario="${scenario.adjustment}">Utiliser ce scénario</button></article>`).join('');
  container.querySelectorAll('[data-v41-scenario]').forEach(button => button.addEventListener('click', () => applyScenario(button.dataset.v41Scenario)));
}

function renderActionPlan(actions) {
  const container = $('v41Actions');
  if (!container) return;
  container.innerHTML = actions.map((action, index) => `<article class="v41-action ${action.priority}"><span class="v41-action-index">${index + 1}</span><i class="fa-solid fa-${escapeHTML(action.icon)}"></i><div><strong>${escapeHTML(action.title)}</strong><span>${escapeHTML(action.detail)}</span></div></article>`).join('');
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
    const advice = progress.overdue ? `Échéance dépassée · ${formatMoney(progress.remaining, appState)} restent à planifier` : progress.remaining > 0 ? `${formatMoney(progress.monthlyNeeded, appState)} par mois conseillés` : 'Objectif atteint, bravo !';
    return `<article class="v4-goal ${progress.overdue ? 'overdue' : ''}"><div class="v4-goal-head"><div><strong>${escapeHTML(goal.name)}</strong><span>${escapeHTML(deadline)}</span></div><span>${progress.percent}%</span></div><div class="v4-progress"><span style="width:${progress.percent}%"></span></div><div class="v4-goal-numbers"><span>${escapeHTML(formatMoney(progress.current, appState))} épargnés</span><span>${escapeHTML(formatMoney(progress.remaining, appState))} restants</span></div><small>${escapeHTML(advice)}</small><div class="v4-row-actions"><button type="button" class="btn btn-secondary btn-sm" data-v4-contribute="${escapeHTML(goal.id)}"><i class="fa-solid fa-plus"></i> Contribution</button><button type="button" class="btn-icon" data-v4-delete-goal="${escapeHTML(goal.id)}" aria-label="Supprimer l’objectif"><i class="fa-solid fa-trash"></i></button></div></article>`;
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

function renderCalendar(appState, accounts, months) {
  const container = $('v4Calendar');
  if (!container) return;
  const account = currentAccount(appState);
  const visibleLimit = Math.max(15, Math.min(1000, Number(account?.plannerSettings?.calendarVisibleLimit) || 15));
  const events = financialCalendar(accounts, { days: Math.round(months * 30.5), limit: 1000 });
  const description = $('v4CalendarDescription');
  if (description) description.textContent = `Échéances prévues sur les ${months} prochains mois.`;
  if (!events.length) {
    container.innerHTML = `<p class="v4-empty">Aucune échéance prévue dans les ${months} prochains mois.</p>`;
    return;
  }
  const visibleEvents = events.slice(0, visibleLimit);
  container.innerHTML = visibleEvents.map(event => {
    const effect = transactionEffect(event);
    return `<article class="v4-calendar-item"><time datetime="${escapeHTML(event.date)}"><strong>${escapeHTML(new Date(`${event.date}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit' }))}</strong><span>${escapeHTML(new Date(`${event.date}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short' }))}</span></time><div><strong>${escapeHTML(event.desc || event.category || 'Échéance')}</strong><span>${escapeHTML(event.accountName || '')}${event.source === 'recurring' ? ' · Récurrente' : ''}</span></div><b class="${effect >= 0 ? 'positive-text' : 'negative-text'}">${effect >= 0 ? '+' : ''}${escapeHTML(formatMoney(effect, appState))}</b></article>`;
  }).join('') + (events.length > visibleEvents.length
    ? `<button type="button" class="v4-text-button" data-v4-calendar-more>Afficher ${Math.min(15, events.length - visibleEvents.length)} échéance(s) suivante(s)</button>`
    : '');
  container.querySelector('[data-v4-calendar-more]')?.addEventListener('click', () => {
    if (!account) return;
    account.plannerSettings = { ...(account.plannerSettings || {}), calendarVisibleLimit: Math.min(1000, visibleLimit + 15) };
    window.saveData?.();
    render();
  });
}

function renderRecurringExpenseCosts(appState, accounts, months) {
  const container = $('v43RecurringExpenseCosts');
  if (!container) return;
  const costs = recurringExpenseCostByCategory(accounts, { months });
  if (!costs.length) {
    container.hidden = false;
    container.innerHTML = '<div class="v43-recurring-costs-head"><div><strong id="v43RecurringExpenseCostsTitle">Coût des dépenses récurrentes</strong><span>Aucune dépense récurrente à cumuler sur cette période.</span></div></div>';
    return;
  }
  container.hidden = false;
  container.innerHTML = `
    <div class="v43-recurring-costs-head">
      <div><strong id="v43RecurringExpenseCostsTitle">Coût des dépenses récurrentes</strong><span>Total par catégorie sur les ${months} prochains mois.</span></div>
    </div>
    <div class="v43-recurring-costs-list">
      ${costs.map(cost => `<article><div><strong>${escapeHTML(cost.category)}</strong><small>${cost.occurrences} échéance(s) · ${escapeHTML(formatMoney(cost.monthlyAverage, appState))} / mois en moyenne</small></div><b>${escapeHTML(formatMoney(cost.total, appState))}</b></article>`).join('')}
    </div>`;
}

export function render() {
  if (syncPlannerMaintenance()) return;
  const appState = state();
  const accounts = visibleAccounts(appState);
  const account = currentAccount(appState);
  if (!account) return;
  account.goals = Array.isArray(account.goals) ? account.goals : [];
  account.envelopes = account.envelopes && typeof account.envelopes === 'object' && !Array.isArray(account.envelopes) ? account.envelopes : {};
  account.plannerSettings = {
    forecastMonths: 6,
    projectionScope: 'complete',
    monthlyAdjustment: 0,
    incomeAdjustment: 0,
    expenseAdjustment: 0,
    oneTimeExpense: 0,
    oneTimeMonth: 1,
    ...(account.plannerSettings || {})
  };
  const months = Math.max(3, normalizeForecastMonths(account.plannerSettings.forecastMonths));
  account.plannerSettings.forecastMonths = months;
  const projectionScope = normalizeProjectionScope(account.plannerSettings.projectionScope);
  account.plannerSettings.projectionScope = projectionScope;
  const simulator = {
    monthlyAdjustment: Number(account.plannerSettings.monthlyAdjustment) || 0,
    incomeAdjustment: Math.max(0, Number(account.plannerSettings.incomeAdjustment) || 0),
    expenseAdjustment: Math.max(0, Number(account.plannerSettings.expenseAdjustment) || 0),
    oneTimeExpense: Math.max(0, Number(account.plannerSettings.oneTimeExpense) || 0),
    oneTimeMonth: Math.max(1, Math.min(months, Number(account.plannerSettings.oneTimeMonth) || 1))
  };
  const simulatorInputs = {
    v4Adjustment: simulator.monthlyAdjustment,
    v42IncomeAdjustment: simulator.incomeAdjustment,
    v42ExpenseAdjustment: simulator.expenseAdjustment,
    v42OneTimeExpense: simulator.oneTimeExpense
  };
  Object.entries(simulatorInputs).forEach(([id, value]) => {
    const input = $(id);
    if (input && document.activeElement !== input) input.value = String(value);
  });
  const oneTimeMonth = $('v42OneTimeMonth');
  if (oneTimeMonth) {
    oneTimeMonth.innerHTML = Array.from({ length: months }, (_, index) => `<option value="${index + 1}">${escapeHTML(monthLabel(forecastMonth(index + 1)))}</option>`).join('');
    oneTimeMonth.value = String(simulator.oneTimeMonth);
  }
  const projectionScopeInput = $('v43ProjectionScope');
  if (projectionScopeInput && document.activeElement !== projectionScopeInput) projectionScopeInput.value = projectionScope;
  const projectionDescription = $('v43ProjectionDescription');
  if (projectionDescription) projectionDescription.textContent = PROJECTION_DESCRIPTIONS[projectionScope];
  document.querySelectorAll('[data-v4-months]').forEach(button => button.classList.toggle('active', Number(button.dataset.v4Months) === months));
  const forecast = calculateForecast(accounts, { months, projectionScope, ...simulator });
  const intelligence = calculatePlannerIntelligence(accounts, { months, projectionScope, forecast, ...simulator });
  const alerts = buildSmartAlerts(accounts, { month: $('globalMonthPicker')?.value });
  const health = calculateFinancialHealth(accounts, { month: $('globalMonthPicker')?.value });
  const scenarios = compareForecastScenarios(accounts, { months, projectionScope, ...simulator });
  const actions = buildActionPlan(accounts, { month: $('globalMonthPicker')?.value });
  renderSummary(appState, accounts, forecast, alerts);
  renderPlannerIntelligence(appState, intelligence);
  renderHealth(appState, health);
  renderScenarios(appState, scenarios);
  renderActionPlan(actions);
  const startingBalance = accounts.reduce((sum, item) => sum + accountBalance(item, new Date()), 0);
  renderForecastInsights(appState, forecast, startingBalance);
  renderForecastBreakdown(appState, forecast);
  renderRecurringExpenseCosts(appState, accounts, months);
  renderForecastChart(appState, forecast, startingBalance, intelligence.bands);
  renderForecast(appState, forecast);
  renderAlerts(appState, alerts);
  renderGoals(appState, account);
  renderEnvelopes(appState, account);
  renderCalendar(appState, accounts, months);
}

function forecastMonth(offset) {
  const date = new Date();
  return `${new Date(date.getFullYear(), date.getMonth() + Number(offset), 1, 12).getFullYear()}-${String(new Date(date.getFullYear(), date.getMonth() + Number(offset), 1, 12).getMonth() + 1).padStart(2, '0')}`;
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
  account.plannerSettings = {
    ...(account.plannerSettings || {}),
    forecastMonths: Math.max(3, normalizeForecastMonths(months)),
    calendarVisibleLimit: 15
  };
  window.saveData?.();
  render();
}

function setProjectionScope(value) {
  const account = currentAccount();
  if (!account) return;
  const projectionScope = normalizeProjectionScope(value);
  account.plannerSettings = { ...(account.plannerSettings || {}), projectionScope };
  window.saveData?.();
  render();
  notify('Contenu de la projection mis à jour');
}

function setSimulatorSettings() {
  const account = currentAccount();
  if (!account) return;
  const number = id => {
    const value = Number($(id)?.value);
    return Number.isFinite(value) ? value : 0;
  };
  account.plannerSettings = {
    ...(account.plannerSettings || {}),
    monthlyAdjustment: number('v4Adjustment'),
    incomeAdjustment: Math.max(0, number('v42IncomeAdjustment')),
    expenseAdjustment: Math.max(0, number('v42ExpenseAdjustment')),
    oneTimeExpense: Math.max(0, number('v42OneTimeExpense')),
    oneTimeMonth: Math.max(1, number('v42OneTimeMonth') || 1)
  };
  window.saveData?.();
  render();
}

function scheduleSimulatorUpdate() {
  clearTimeout(simulatorTimer);
  simulatorTimer = setTimeout(setSimulatorSettings, 180);
}

function applySimulatorPreset(preset) {
  const account = currentAccount();
  if (!account) return;
  const base = { ...(account.plannerSettings || {}) };
  if (preset === 'save') Object.assign(base, { monthlyAdjustment: 0, incomeAdjustment: 0, expenseAdjustment: 0, oneTimeExpense: 0 }, { incomeAdjustment: 200 });
  if (preset === 'unexpected') Object.assign(base, { monthlyAdjustment: 0, incomeAdjustment: 0, expenseAdjustment: 0, oneTimeExpense: 500, oneTimeMonth: 1 });
  if (preset === 'reset') Object.assign(base, { monthlyAdjustment: 0, incomeAdjustment: 0, expenseAdjustment: 0, oneTimeExpense: 0, oneTimeMonth: 1 });
  account.plannerSettings = base;
  window.saveData?.();
  render();
  notify(preset === 'reset' ? 'Simulation réinitialisée' : 'Simulation appliquée');
}

function downloadForecastCSV() {
  const appState = state();
  const account = currentAccount(appState);
  if (!account) return;
  const accounts = visibleAccounts(appState);
  const settings = { forecastMonths: 6, ...(account.plannerSettings || {}) };
  const forecast = calculateForecast(accounts, { months: Math.max(3, normalizeForecastMonths(settings.forecastMonths)), ...settings });
  const rows = [
    ['Mois', 'Tendance historique', 'Récurrences exactes', 'Transactions planifiées', 'Variation de base', 'Simulation mensuelle', 'Événement ponctuel', 'Variation totale', 'Solde prévu'],
    ...forecast.map(row => [row.month, row.historicalChange, row.recurringChange, row.scheduledChange, row.baselineChange, row.monthlySimulation, row.oneTimeAdjustment, row.change, row.balance])
  ];
  const csv = `\uFEFF${rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `freev-prevision-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  notify('Prévision CSV téléchargée');
}

function applyScenario(adjustment) {
  const account = currentAccount();
  if (!account) return;
  const value = Number(adjustment) || 0;
  account.plannerSettings = { ...(account.plannerSettings || {}), monthlyAdjustment: value };
  window.saveData?.();
  render();
  notify(value === 0 ? 'Tendance actuelle appliquée' : 'Scénario appliqué au simulateur');
  $('v4Adjustment')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  $('v43ProjectionScope')?.addEventListener('change', event => setProjectionScope(event.currentTarget.value));
  ['v4Adjustment', 'v42IncomeAdjustment', 'v42ExpenseAdjustment', 'v42OneTimeExpense']
    .forEach(id => $(id)?.addEventListener('input', scheduleSimulatorUpdate));
  $('v42OneTimeMonth')?.addEventListener('change', setSimulatorSettings);
  document.querySelectorAll('[data-v42-preset]').forEach(button => button.addEventListener('click', () => applySimulatorPreset(button.dataset.v42Preset)));
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

window.FreevV4 = { render, openSearch, closeSearch, showWhatsNew, closeWhatsNew, downloadForecastCSV };
document.addEventListener('DOMContentLoaded', bind, { once: true });
window.addEventListener('freev:ready', () => {
  bind();
  render();
});
