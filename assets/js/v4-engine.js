// Freev Valeur 4.2 — moteur financier pur, sans dépendance au DOM.
// Garder les calculs ici permet de les tester et de les réutiliser sur mobile.

const DAY_MS = 86_400_000;

export function toAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function localDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

export function isoDate(value = new Date()) {
  const date = localDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function monthKey(value = new Date()) {
  return isoDate(value).slice(0, 7);
}

export function addMonths(value, offset) {
  const date = localDate(value);
  return new Date(date.getFullYear(), date.getMonth() + Number(offset || 0), 1, 12);
}

export function transactionEffect(transaction) {
  const amount = toAmount(transaction?.amountBase ?? transaction?.amount);
  return transaction?.type === 'income' ? amount : -amount;
}

export function accountBalance(account, throughDate = null) {
  const limit = throughDate ? isoDate(throughDate) : null;
  const transactions = Array.isArray(account?.transactions) ? account.transactions : [];
  return toAmount(toAmount(account?.initialCapital) + transactions.reduce((sum, transaction) => {
    if (limit && String(transaction?.date || '') > limit) return sum;
    return sum + transactionEffect(transaction);
  }, 0));
}

function recurringMonthlyEffect(rule) {
  const effect = transactionEffect(rule);
  if (rule?.frequency === 'weekly') return effect * 52 / 12;
  if (rule?.frequency === 'yearly') return effect / 12;
  return effect;
}

function historicalManualNet(account, today, months = 3) {
  const totals = [];
  for (let offset = months; offset >= 1; offset -= 1) {
    const key = monthKey(addMonths(today, -offset));
    const total = (account?.transactions || []).reduce((sum, transaction) => {
      if (String(transaction?.date || '').slice(0, 7) !== key) return sum;
      if (transaction?.parentId || transaction?.projected) return sum;
      return sum + transactionEffect(transaction);
    }, 0);
    totals.push(total);
  }
  return totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : 0;
}

export function calculateForecast(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const months = Math.max(1, Math.min(24, Number(options.months) || 6));
  const today = localDate(options.today || new Date());
  const todayISO = isoDate(today);
  // `monthlyAdjustment` reste pris en charge pour les données créées en 4.1.
  const adjustment = toAmount(options.monthlyAdjustment);
  const incomeAdjustment = Math.max(0, toAmount(options.incomeAdjustment));
  const expenseAdjustment = Math.max(0, toAmount(options.expenseAdjustment));
  const oneTimeExpense = Math.max(0, toAmount(options.oneTimeExpense));
  const oneTimeMonth = Math.max(1, Math.min(months, Number(options.oneTimeMonth) || 1));
  let balance = toAmount(source.reduce((sum, account) => sum + accountBalance(account, today), 0));

  const monthlyBase = source.reduce((sum, account) => {
    const recurring = (account?.recurringTransactions || []).reduce(
      (subtotal, rule) => subtotal + recurringMonthlyEffect(rule), 0
    );
    return sum + historicalManualNet(account, today, 3) + recurring;
  }, 0);

  return Array.from({ length: months }, (_, index) => {
    const date = addMonths(today, index + 1);
    const key = monthKey(date);
    const scheduled = source.reduce((sum, account) => sum + (account?.transactions || []).reduce((subtotal, transaction) => {
      const dateISO = String(transaction?.date || '');
      if (dateISO <= todayISO || dateISO.slice(0, 7) !== key || transaction?.parentId) return subtotal;
      return subtotal + transactionEffect(transaction);
    }, 0), 0);
    const monthlySimulation = toAmount(adjustment + incomeAdjustment - expenseAdjustment);
    const oneTimeAdjustment = index + 1 === oneTimeMonth ? -oneTimeExpense : 0;
    const change = toAmount(monthlyBase + monthlySimulation + scheduled + oneTimeAdjustment);
    balance = toAmount(balance + change);
    return {
      month: key,
      change,
      balance,
      baselineChange: toAmount(monthlyBase + scheduled),
      monthlySimulation,
      oneTimeAdjustment,
      projected: true
    };
  });
}

export function summarizeForecast(forecast, startingBalance = 0) {
  const rows = Array.isArray(forecast) ? forecast.filter(row => Number.isFinite(Number(row?.balance))) : [];
  const start = toAmount(startingBalance);
  if (!rows.length) {
    return {
      startingBalance: start,
      finalBalance: start,
      totalChange: 0,
      lowestBalance: start,
      lowestMonth: null,
      firstNegativeMonth: null,
      bestMonth: null,
      worstMonth: null,
      trend: 'stable'
    };
  }

  const lowest = rows.reduce((current, row) => Number(row.balance) < Number(current.balance) ? row : current, rows[0]);
  const best = rows.reduce((current, row) => Number(row.change) > Number(current.change) ? row : current, rows[0]);
  const worst = rows.reduce((current, row) => Number(row.change) < Number(current.change) ? row : current, rows[0]);
  const finalBalance = toAmount(rows.at(-1).balance);
  const totalChange = toAmount(finalBalance - start);
  return {
    startingBalance: start,
    finalBalance,
    totalChange,
    lowestBalance: toAmount(lowest.balance),
    lowestMonth: lowest.month,
    firstNegativeMonth: rows.find(row => Number(row.balance) < 0)?.month || null,
    bestMonth: { month: best.month, change: toAmount(best.change) },
    worstMonth: { month: worst.month, change: toAmount(worst.change) },
    trend: totalChange > 0 ? 'up' : totalChange < 0 ? 'down' : 'stable'
  };
}

export function goalProgress(goal, today = new Date()) {
  const target = Math.max(0, toAmount(goal?.target));
  const current = Math.max(0, toAmount(goal?.current));
  const remaining = Math.max(0, toAmount(target - current));
  const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const deadline = goal?.deadline ? localDate(goal.deadline) : null;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - localDate(today).getTime()) / DAY_MS) : null;
  const monthsLeft = daysLeft === null ? null : Math.max(1, Math.ceil(daysLeft / 30.44));
  const monthlyNeeded = monthsLeft ? toAmount(remaining / monthsLeft) : remaining;
  return { target, current, remaining, percent, daysLeft, monthlyNeeded };
}

export function envelopeUsage(account, month = monthKey()) {
  const budgets = account?.envelopes && typeof account.envelopes === 'object' && !Array.isArray(account.envelopes)
    ? account.envelopes
    : account?.budgetsByCategory || {};
  const spent = (account?.transactions || []).reduce((map, transaction) => {
    if (transaction?.type === 'income' || String(transaction?.date || '').slice(0, 7) !== month) return map;
    const category = String(transaction?.category || 'Autre');
    map[category] = toAmount((map[category] || 0) + Math.abs(transactionEffect(transaction)));
    return map;
  }, {});

  return Object.entries(budgets).map(([category, rawLimit]) => {
    const limit = Math.max(0, toAmount(rawLimit));
    const used = spent[category] || 0;
    const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
    return { category, limit, used, remaining: toAmount(limit - used), percent };
  }).sort((a, b) => b.percent - a.percent);
}

function recurringDates(rule, from, until) {
  const start = localDate(rule?.startDate || from);
  const cursor = new Date(Math.max(start.getTime(), from.getTime()));
  const dates = [];
  const max = 200;
  if (rule?.frequency === 'weekly') {
    while (cursor.getDay() !== start.getDay()) cursor.setDate(cursor.getDate() + 1);
    while (cursor <= until && dates.length < max) {
      dates.push(isoDate(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return dates;
  }

  const startMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  for (let month = startMonth; month <= until && dates.length < max; month = addMonths(month, 1)) {
    if (rule?.frequency === 'yearly' && month.getMonth() !== start.getMonth()) continue;
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const day = Math.min(Number(rule?.dayOfMonth) || start.getDate(), lastDay);
    const candidate = new Date(month.getFullYear(), month.getMonth(), day, 12);
    if (candidate >= from && candidate <= until && candidate >= start) dates.push(isoDate(candidate));
  }
  return dates;
}

export function financialCalendar(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const from = localDate(options.from || new Date());
  const until = new Date(from.getTime() + Math.max(7, Number(options.days) || 90) * DAY_MS);
  const fromISO = isoDate(from);
  const untilISO = isoDate(until);
  const events = [];

  source.forEach(account => {
    (account?.transactions || []).forEach(transaction => {
      const date = String(transaction?.date || '');
      if (date >= fromISO && date <= untilISO) {
        events.push({ ...transaction, accountId: account.id, accountName: account.name, source: 'transaction' });
      }
    });
    (account?.recurringTransactions || []).forEach(rule => {
      recurringDates(rule, from, until).forEach(date => {
        const alreadyExists = (account?.transactions || []).some(transaction =>
          String(transaction?.parentId || '') === String(rule?.id || '') && transaction?.date === date
        );
        if (!alreadyExists) events.push({ ...rule, date, accountId: account.id, accountName: account.name, source: 'recurring' });
      });
    });
  });
  return events.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 80);
}

export function searchTransactions(accounts, query, limit = 50) {
  const terms = String(query || '').toLocaleLowerCase('fr').trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  (Array.isArray(accounts) ? accounts : []).forEach(account => {
    (account?.transactions || []).forEach(transaction => {
      const haystack = [transaction?.desc, transaction?.category, transaction?.type, transaction?.date,
        ...(Array.isArray(transaction?.tags) ? transaction.tags : []), account?.name]
        .join(' ').toLocaleLowerCase('fr');
      if (terms.every(term => haystack.includes(term))) results.push({ ...transaction, accountId: account.id, accountName: account.name });
    });
  });
  return results.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, limit);
}

export function buildSmartAlerts(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const month = options.month || monthKey(options.today || new Date());
  const lowBalance = toAmount(options.lowBalance ?? 100);
  const alerts = [];

  source.forEach(account => {
    const balance = accountBalance(account, options.today || new Date());
    if (balance < 0) alerts.push({ level: 'danger', accountId: account.id, title: `${account.name} est à découvert`, detail: `Solde actuel : ${balance}` });
    else if (balance < lowBalance) alerts.push({ level: 'warning', accountId: account.id, title: `Solde faible sur ${account.name}`, detail: `Solde actuel : ${balance}` });

    envelopeUsage(account, month).forEach(envelope => {
      if (envelope.percent >= 100) alerts.push({ level: 'danger', accountId: account.id, title: `Budget ${envelope.category} dépassé`, detail: `${envelope.used} sur ${envelope.limit}` });
      else if (envelope.percent >= 80) alerts.push({ level: 'warning', accountId: account.id, title: `Budget ${envelope.category} bientôt atteint`, detail: `${envelope.percent}% utilisé` });
    });

    const expenses = (account?.transactions || []).filter(transaction =>
      transaction?.type !== 'income' && String(transaction?.date || '').slice(0, 7) === month
    ).map(transaction => Math.abs(transactionEffect(transaction)));
    if (expenses.length >= 4) {
      const average = expenses.reduce((sum, value) => sum + value, 0) / expenses.length;
      const unusual = (account?.transactions || []).find(transaction =>
        transaction?.type !== 'income' && String(transaction?.date || '').slice(0, 7) === month &&
        Math.abs(transactionEffect(transaction)) > Math.max(average * 3, 100)
      );
      if (unusual) alerts.push({ level: 'info', accountId: account.id, title: 'Dépense inhabituelle détectée', detail: unusual.desc || unusual.category || 'Transaction' });
    }
  });
  return alerts.slice(0, 12);
}

function recentMonthlyStats(accounts, today = new Date(), months = 3) {
  const source = Array.isArray(accounts) ? accounts : [];
  const totals = Array.from({ length: months }, (_, index) => {
    const key = monthKey(addMonths(today, -(index + 1)));
    return source.reduce((result, account) => {
      (account?.transactions || []).forEach(transaction => {
        if (String(transaction?.date || '').slice(0, 7) !== key || transaction?.projected) return;
        const amount = Math.abs(transactionEffect(transaction));
        if (transaction?.type === 'income') result.income += amount;
        else result.expenses += amount;
      });
      return result;
    }, { income: 0, expenses: 0 });
  });
  const divisor = Math.max(1, totals.length);
  return {
    income: toAmount(totals.reduce((sum, item) => sum + item.income, 0) / divisor),
    expenses: toAmount(totals.reduce((sum, item) => sum + item.expenses, 0) / divisor)
  };
}

export function calculateFinancialHealth(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const today = options.today || new Date();
  const month = options.month || monthKey(today);
  const stats = recentMonthlyStats(source, today, 3);
  const balance = toAmount(source.reduce((sum, account) => sum + accountBalance(account, today), 0));
  const savings = toAmount(source.reduce((sum, account) => sum + Object.values(account?.savingsAccounts || {})
    .reduce((subtotal, value) => subtotal + Math.max(0, toAmount(value)), 0), 0));
  const debts = toAmount(source.reduce((sum, account) => sum + (account?.debts || [])
    .filter(debt => debt?.direction === 'i_owe_them')
    .reduce((subtotal, debt) => subtotal + Math.max(0, toAmount(debt?.remainingAmount ?? debt?.amount)), 0), 0));
  const savingsRate = stats.income > 0 ? ((stats.income - stats.expenses) / stats.income) * 100 : 0;
  const emergencyMonths = stats.expenses > 0 ? (Math.max(0, balance) + savings) / stats.expenses : (balance + savings > 0 ? 6 : 0);
  const envelopes = source.flatMap(account => envelopeUsage(account, month));
  const envelopeAverage = envelopes.length
    ? envelopes.reduce((sum, envelope) => sum + Math.max(0, envelope.percent), 0) / envelopes.length
    : null;
  const annualIncome = stats.income * 12;
  const debtRatio = annualIncome > 0 ? debts / annualIncome : (debts > 0 ? 1 : 0);

  const balanceScore = balance < 0 ? 0 : balance >= stats.expenses ? 20 : 12;
  const savingsScore = stats.income > 0 ? Math.round(Math.max(0, Math.min(20, savingsRate))) : 5;
  const reserveScore = Math.round(Math.max(0, Math.min(25, (emergencyMonths / 3) * 25)));
  const budgetScore = envelopeAverage === null ? 10 : Math.round(Math.max(0, Math.min(20, 28 - envelopeAverage * 0.1)));
  const debtScore = debts <= 0 ? 15 : Math.round(Math.max(0, 15 * (1 - Math.min(1, debtRatio / 0.5))));
  const score = Math.max(0, Math.min(100, balanceScore + savingsScore + reserveScore + budgetScore + debtScore));
  const label = score >= 80 ? 'Excellente' : score >= 65 ? 'Solide' : score >= 45 ? 'À renforcer' : 'Fragile';

  return {
    score,
    label,
    balance,
    savings,
    debts,
    monthlyIncome: stats.income,
    monthlyExpenses: stats.expenses,
    savingsRate: toAmount(savingsRate),
    emergencyMonths: toAmount(emergencyMonths),
    debtRatio: toAmount(debtRatio * 100),
    breakdown: [
      { key: 'balance', label: 'Solde', score: balanceScore, max: 20, value: balance, advice: balance < 0 ? 'Revenir à un solde positif en priorité.' : 'Votre trésorerie immédiate est positive.' },
      { key: 'savings', label: 'Capacité d’épargne', score: savingsScore, max: 20, value: toAmount(savingsRate), unit: '%', advice: savingsRate < 10 ? 'Viser progressivement 10 % des revenus.' : 'Votre rythme d’épargne est bien orienté.' },
      { key: 'reserve', label: 'Réserve de sécurité', score: reserveScore, max: 25, value: toAmount(emergencyMonths), unit: 'mois', advice: emergencyMonths < 3 ? 'Construire trois mois de dépenses de réserve.' : 'Votre réserve couvre au moins trois mois.' },
      { key: 'budget', label: 'Maîtrise des budgets', score: budgetScore, max: 20, value: envelopeAverage === null ? null : Math.round(envelopeAverage), unit: '%', advice: envelopeAverage === null ? 'Créer des enveloppes pour mesurer ce critère.' : envelopeAverage > 100 ? 'Réduire les catégories qui dépassent leur enveloppe.' : 'Les enveloppes sont globalement maîtrisées.' },
      { key: 'debt', label: 'Endettement', score: debtScore, max: 15, value: debts, advice: debts > 0 ? 'Prioriser les dettes les plus coûteuses.' : 'Aucune dette à rembourser enregistrée.' }
    ]
  };
}

export function compareForecastScenarios(accounts, options = {}) {
  const source = Array.isArray(accounts) ? accounts : [];
  const months = Math.max(3, Math.min(24, Number(options.months) || 6));
  const stats = recentMonthlyStats(source, options.today || new Date(), 3);
  const savingStep = Math.max(50, toAmount(stats.expenses * 0.05));
  const stressStep = Math.max(100, toAmount(stats.expenses * 0.15));
  return [
    { id: 'prudent', label: 'Prudent', detail: `+${savingStep} par mois`, adjustment: savingStep, tone: 'success' },
    { id: 'current', label: 'Tendance actuelle', detail: 'Habitudes inchangées', adjustment: 0, tone: 'brand' },
    { id: 'stress', label: 'Imprévu', detail: `-${stressStep} par mois`, adjustment: -stressStep, tone: 'danger' }
  ].map(scenario => {
    const forecast = calculateForecast(source, { months, today: options.today, monthlyAdjustment: scenario.adjustment });
    return { ...scenario, forecast, finalBalance: forecast.at(-1)?.balance || 0, totalChange: toAmount(scenario.adjustment * months) };
  });
}

export function buildActionPlan(accounts, options = {}) {
  const health = calculateFinancialHealth(accounts, options);
  const alerts = buildSmartAlerts(accounts, options);
  const actions = [];
  if (health.balance < 0) actions.push({ priority: 'urgent', icon: 'wallet', title: 'Rétablir un solde positif', detail: `Il manque ${Math.abs(health.balance)} pour revenir à zéro.` });
  const exceeded = alerts.filter(alert => alert.title.includes('dépassé'));
  if (exceeded.length) actions.push({ priority: 'urgent', icon: 'gauge-high', title: 'Corriger les enveloppes dépassées', detail: `${exceeded.length} catégorie(s) sont au-dessus de leur limite.` });
  if (health.emergencyMonths < 3) {
    const target = toAmount(Math.max(0, health.monthlyExpenses * 3 - Math.max(0, health.balance) - health.savings));
    actions.push({ priority: 'important', icon: 'shield-heart', title: 'Construire la réserve de sécurité', detail: `${target} restent à constituer pour couvrir trois mois.` });
  }
  if (health.savingsRate < 10 && health.monthlyIncome > 0) {
    const suggested = toAmount(Math.max(10, health.monthlyIncome * 0.1 - Math.max(0, health.monthlyIncome - health.monthlyExpenses)));
    actions.push({ priority: 'important', icon: 'piggy-bank', title: 'Atteindre 10 % d’épargne', detail: `Essayez de dégager ${suggested} supplémentaires par mois.` });
  }
  if (health.debts > 0) actions.push({ priority: 'normal', icon: 'hand-holding-dollar', title: 'Accélérer le remboursement', detail: `${health.debts} de dettes restantes sont enregistrées.` });
  if (!actions.length) actions.push({ priority: 'normal', icon: 'circle-check', title: 'Maintenir votre trajectoire', detail: 'Aucun point prioritaire détecté pour le moment.' });
  return actions.slice(0, 5);
}
