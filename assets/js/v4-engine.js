// Freev Valeur 4.0 — moteur financier pur, sans dépendance au DOM.
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
  const adjustment = toAmount(options.monthlyAdjustment);
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
    const change = toAmount(monthlyBase + adjustment + scheduled);
    balance = toAmount(balance + change);
    return { month: key, change, balance };
  });
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
