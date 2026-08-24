import test from 'node:test';
import assert from 'node:assert/strict';
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
  recurringExpenseCostByCategory,
  recurringPeriodKey,
  searchTransactions,
  summarizeForecast,
  transactionEffect
} from '../assets/js/v4-engine.js';

const account = {
  id: 'a1', name: 'Courant', initialCapital: 1000,
  transactions: [
    { id: '1', type: 'income', amount: 500, date: '2026-04-02', desc: 'Salaire' },
    { id: '2', type: 'expense', amountBase: 120, date: '2026-04-03', category: 'Courses', desc: 'Marché' },
    { id: '3', type: 'expense', amount: 50, date: '2026-07-10', category: 'Transport', desc: 'Train', tags: ['voyage'] }
  ],
  recurringTransactions: [{ id: 'r1', type: 'expense', amount: 30, frequency: 'monthly', startDate: '2026-01-05', dayOfMonth: 5, desc: 'Internet' }],
  envelopes: { Courses: 100, Transport: 80 }
};

test('les revenus et dépenses ont le bon signe', () => {
  assert.equal(transactionEffect({ type: 'income', amount: 12.345 }), 12.35);
  assert.equal(transactionEffect({ type: 'expense', amountBase: 8.2 }), -8.2);
});

test('le solde respecte la date limite et le capital initial', () => {
  assert.equal(accountBalance(account, '2026-04-30'), 1380);
  assert.equal(accountBalance(account, '2026-07-31'), 1330);
});

test('les objectifs calculent progression et effort mensuel', () => {
  const result = goalProgress({ target: 1200, current: 300, deadline: '2026-11-01' }, '2026-08-01');
  assert.equal(result.percent, 25);
  assert.equal(result.remaining, 900);
  assert.equal(result.monthlyNeeded, 225);
});

test('les enveloppes détectent les dépassements', () => {
  const usage = envelopeUsage(account, '2026-04');
  assert.equal(usage.find(item => item.category === 'Courses').percent, 120);
  assert.equal(usage.find(item => item.category === 'Courses').remaining, -20);
});

test('la prévision produit une trajectoire finie et déterministe', () => {
  const forecast = calculateForecast([account], { months: 3, today: '2026-08-01', monthlyAdjustment: 100 });
  assert.equal(forecast.length, 3);
  assert.ok(forecast.every(item => Number.isFinite(item.balance)));
  assert.equal(forecast[2].month, '2026-11');
});

test('l’utilisateur choisit si les opérations occasionnelles alimentent la projection', () => {
  const occasionalAccount = {
    id: 'occasional',
    initialCapital: 1000,
    transactions: [
      { id: 'exceptional-trip', type: 'expense', amount: 900, date: '2026-07-12', desc: 'Voyage exceptionnel' },
      { id: 'planned-repair', type: 'expense', amount: 100, date: '2026-09-18', desc: 'Réparation planifiée' }
    ],
    recurringTransactions: [
      { id: 'subscription', type: 'expense', amount: 50, frequency: 'monthly', startDate: '2026-01-05', dayOfMonth: 5, desc: 'Abonnement' }
    ]
  };

  const complete = calculateForecast([occasionalAccount], {
    today: '2026-08-01', months: 1, projectionScope: 'complete'
  })[0];
  const recurringAndScheduled = calculateForecast([occasionalAccount], {
    today: '2026-08-01', months: 1, projectionScope: 'recurring-scheduled'
  })[0];
  const recurringOnly = calculateForecast([occasionalAccount], {
    today: '2026-08-01', months: 1, projectionScope: 'recurring'
  })[0];

  assert.deepEqual(
    [complete.historicalChange, complete.recurringChange, complete.scheduledChange, complete.change, complete.balance],
    [-300, -50, -100, -450, -350]
  );
  assert.deepEqual(
    [recurringAndScheduled.historicalChange, recurringAndScheduled.recurringChange, recurringAndScheduled.scheduledChange, recurringAndScheduled.change, recurringAndScheduled.balance],
    [0, -50, -100, -150, -50]
  );
  assert.deepEqual(
    [recurringOnly.historicalChange, recurringOnly.recurringChange, recurringOnly.scheduledChange, recurringOnly.change, recurringOnly.balance],
    [0, -50, 0, -50, 50]
  );
  assert.equal(occasionalAccount.transactions.length, 2, 'la projection ne doit pas modifier les opérations');
});

test('la prévision explique exactement le cas utilisateur à 142 euros', () => {
  const userAccount = {
    id: 'user-case',
    initialCapital: 373.45,
    transactions: [
      { id: 'may', type: 'expense', amount: 92.15, date: '2026-05-10', desc: 'Dépenses mai' },
      { id: 'june', type: 'expense', amount: 92.15, date: '2026-06-10', desc: 'Dépenses juin' },
      { id: 'july', type: 'expense', amount: 92.15, date: '2026-07-10', desc: 'Dépenses juillet' },
      { id: 'august-salary', type: 'income', amount: 45, date: '2026-08-05', desc: 'Salaire' }
    ],
    recurringTransactions: [
      { id: 'salary', type: 'income', amount: 45, frequency: 'monthly', startDate: '2026-08-05', dayOfMonth: 5, desc: 'Salaire' },
      { id: 'bill', type: 'expense', amount: 1, frequency: 'monthly', startDate: '2026-08-13', dayOfMonth: 13, desc: 'Factures' },
      { id: 'leisure-1', type: 'expense', amount: 1.99, frequency: 'monthly', startDate: '2026-08-25', dayOfMonth: 25, desc: 'Loisirs' },
      { id: 'leisure-2', type: 'expense', amount: 2.99, frequency: 'monthly', startDate: '2026-08-28', dayOfMonth: 28, desc: 'Loisirs' }
    ]
  };

  assert.equal(accountBalance(userAccount, '2026-08-05'), 142);
  const forecast = calculateForecast([userAccount], { today: '2026-08-05', months: 3 });

  assert.deepEqual(forecast.map(row => ({
    historicalChange: row.historicalChange,
    recurringChange: row.recurringChange,
    scheduledChange: row.scheduledChange,
    monthlySimulation: row.monthlySimulation,
    oneTimeAdjustment: row.oneTimeAdjustment || 0,
    change: row.change,
    balance: row.balance
  })), [
    { historicalChange: -92.15, recurringChange: 39.02, scheduledChange: 0, monthlySimulation: 0, oneTimeAdjustment: 0, change: -53.13, balance: 88.87 },
    { historicalChange: -92.15, recurringChange: 39.02, scheduledChange: 0, monthlySimulation: 0, oneTimeAdjustment: 0, change: -53.13, balance: 35.74 },
    { historicalChange: -92.15, recurringChange: 39.02, scheduledChange: 0, monthlySimulation: 0, oneTimeAdjustment: 0, change: -53.13, balance: -17.39 }
  ]);
});

test('le simulateur combine revenus, dépenses et imprévu sans toucher aux données', () => {
  const baseline = calculateForecast([account], { months: 3, today: '2026-08-01' });
  const simulated = calculateForecast([account], {
    months: 3,
    today: '2026-08-01',
    incomeAdjustment: 100,
    expenseAdjustment: 40,
    oneTimeExpense: 300,
    oneTimeMonth: 2
  });
  assert.equal(simulated[0].balance, baseline[0].balance + 60);
  assert.equal(simulated[1].balance, baseline[1].balance - 180);
  assert.equal(simulated[2].balance, baseline[2].balance - 120);
  assert.equal(simulated[1].oneTimeAdjustment, -300);
  assert.equal(account.transactions.length, 3);
});

test('le résumé de projection repère le point bas et le premier découvert', () => {
  const summary = summarizeForecast([
    { month: '2026-09', change: -50, balance: 50 },
    { month: '2026-10', change: -80, balance: -30 },
    { month: '2026-11', change: 40, balance: 10 }
  ], 100);
  assert.equal(summary.lowestMonth, '2026-10');
  assert.equal(summary.firstNegativeMonth, '2026-10');
  assert.equal(summary.finalBalance, 10);
  assert.equal(summary.trend, 'down');
});

test('la recherche retrouve une transaction dans tous les comptes', () => {
  const results = searchTransactions([account], 'voyage train');
  assert.equal(results.length, 1);
  assert.equal(results[0].accountName, 'Courant');
});

test('le calendrier ajoute les prochaines échéances récurrentes sans doublon', () => {
  const events = financialCalendar([account], { from: '2026-08-01', days: 40 });
  assert.ok(events.some(event => event.source === 'recurring' && event.date === '2026-08-05'));
});

test('le planificateur cumule les dépenses récurrentes par catégorie sur tout l’horizon', () => {
  const recurringCosts = recurringExpenseCostByCategory([{
    id: 'recurring-costs',
    transactions: [],
    recurringTransactions: [
      { id: 'rent', type: 'expense', amount: 700, category: 'Logement', frequency: 'monthly', startDate: '2026-01-05', dayOfMonth: 5 },
      { id: 'food', type: 'expense', amount: 25, category: 'Alimentation', frequency: 'weekly', startDate: '2026-08-03', skippedPeriods: [recurringPeriodKey('2026-09-14', 'weekly')] },
      { id: 'salary', type: 'income', amount: 2000, category: 'Salaire', frequency: 'monthly', startDate: '2026-01-01', dayOfMonth: 1 }
    ]
  }], { today: '2026-08-01', months: 3 });

  assert.deepEqual(recurringCosts, [
    { category: 'Logement', total: 2100, occurrences: 3, monthlyAverage: 700 },
    { category: 'Alimentation', total: 300, occurrences: 12, monthlyAverage: 100 }
  ]);
});

test('le calendrier long conserve les échéances hebdomadaires jusqu’à 24 mois', () => {
  const weeklyRules = ['a', 'b', 'c'].map((id, index) => ({
    id,
    type: 'expense',
    amount: 10 + index,
    frequency: 'weekly',
    startDate: `2026-08-${String(3 + index).padStart(2, '0')}`
  }));
  const events = financialCalendar([{ id: 'weekly-calendar', recurringTransactions: weeklyRules }], {
    from: '2026-08-01',
    days: 732,
    limit: 400
  });
  assert.ok(events.length > 240);
  assert.ok(events.some(event => event.date.startsWith('2028-')));
});

test('les alertes signalent un budget dépassé', () => {
  const alerts = buildSmartAlerts([account], { month: '2026-04', today: '2026-08-01' });
  assert.ok(alerts.some(alert => alert.title.includes('Courses') && alert.level === 'danger'));
});

test('le score financier reste expliqué et borné sur 100', () => {
  const health = calculateFinancialHealth([account], { today: '2026-08-01', month: '2026-04' });
  assert.ok(health.score >= 0 && health.score <= 100);
  assert.equal(health.breakdown.length, 5);
  assert.equal(health.breakdown.reduce((sum, item) => sum + item.score, 0), health.score);
});

test('les trois scénarios produisent des soldes ordonnés', () => {
  const scenarios = compareForecastScenarios([account], { today: '2026-08-01', months: 6 });
  assert.equal(scenarios.length, 3);
  assert.ok(scenarios[0].finalBalance > scenarios[1].finalBalance);
  assert.ok(scenarios[1].finalBalance > scenarios[2].finalBalance);
});

test('les scénarios comparés respectent le filtre choisi dans le planificateur', () => {
  const occasionalAccount = {
    id: 'scenario-scope',
    initialCapital: 1000,
    transactions: [{ id: 'event', type: 'expense', amount: 600, date: '2026-07-12', desc: 'Événement isolé' }],
    recurringTransactions: [{ id: 'rent', type: 'expense', amount: 40, frequency: 'monthly', startDate: '2026-01-05', dayOfMonth: 5 }]
  };
  const complete = compareForecastScenarios([occasionalAccount], {
    today: '2026-08-01', months: 3, projectionScope: 'complete'
  }).find(scenario => scenario.id === 'current');
  const recurringOnly = compareForecastScenarios([occasionalAccount], {
    today: '2026-08-01', months: 3, projectionScope: 'recurring'
  }).find(scenario => scenario.id === 'current');

  assert.equal(complete.finalBalance, -320);
  assert.equal(recurringOnly.finalBalance, 280);
});

test('le plan d’actions est priorisé à partir des données', () => {
  const actions = buildActionPlan([account], { today: '2026-08-01', month: '2026-04' });
  assert.ok(actions.length >= 1);
  assert.ok(actions.some(action => action.title.includes('enveloppes')));
});

test('la prévision compte les vraies semaines et respecte une échéance ignorée', () => {
  const weekly = {
    id: 'weekly',
    initialCapital: 100,
    transactions: [],
    recurringTransactions: [{
      id: 'weekly-rule', type: 'expense', amount: 10, frequency: 'weekly',
      startDate: '2026-08-31', skippedPeriods: [recurringPeriodKey('2026-09-14', 'weekly')]
    }]
  };
  const forecast = calculateForecast([weekly], { today: '2026-08-02', months: 3 });
  assert.equal(forecast[0].month, '2026-09');
  assert.equal(forecast[0].recurringChange, -30);
  assert.equal(forecast[0].baselineChange, -30);
});

test('un objectif dépassé est signalé sans inventer un mois restant', () => {
  const progress = goalProgress({ target: 1000, current: 250, deadline: '2026-07-01' }, '2026-08-02');
  assert.equal(progress.overdue, true);
  assert.equal(progress.monthsLeft, 0);
  assert.equal(progress.monthlyNeeded, 750);
});

test('le planificateur explique la confiance, le risque et la marge de sécurité', () => {
  const near = calculatePlannerIntelligence([account], { today: '2026-08-01', months: 6 });
  const distant = calculatePlannerIntelligence([account], { today: '2026-08-01', months: 24 });
  assert.ok(near.confidence >= 0 && near.confidence <= 100);
  assert.equal(near.bands.length, 6);
  assert.ok(near.bands.every(row => row.optimistic >= row.base && row.stress <= row.base));
  assert.ok(['danger', 'warning', 'success'].includes(near.risk.level));
  assert.ok(distant.confidence < near.confidence, 'Une projection lointaine doit exprimer davantage d’incertitude');
  assert.equal(distant.bands.length, 24);
});

test('la prévision longue conserve 24 mois exacts sans déplacer un imprévu', () => {
  const forecast = calculateForecast([account], {
    today: '2026-08-01',
    months: 24,
    oneTimeExpense: 300,
    oneTimeMonth: 24
  });

  assert.equal(forecast.length, 24);
  assert.equal(forecast.at(-1).month, '2028-08');
  assert.equal(forecast.at(-1).oneTimeAdjustment, -300);
  assert.equal(forecast.slice(0, -1).some(row => row.oneTimeAdjustment !== 0), false);
});

test('un horizon enregistré hors limites est normalisé de façon déterministe', () => {
  assert.equal(normalizeForecastMonths(1), 1);
  assert.equal(normalizeForecastMonths(999), 24);
  assert.equal(normalizeForecastMonths(0), 6);
  assert.equal(normalizeForecastMonths('invalide'), 6);
});
