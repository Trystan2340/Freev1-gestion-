// Freev Valeur 5.0 — moteur pur pour imports, règles, abonnements et patrimoine.
// Aucune fonction de ce fichier ne modifie directement les données de l’utilisateur.

const roundMoney = value => Math.round((Number(value) || 0) * 100) / 100;
const MAX_IMPORT_ROWS = 10_000;

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/\b(cb|carte|paiement|prelevement|prlv|virement|vir|sepa)\b/g, ' ')
    .replace(/\d{2,}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function merchantKey(transaction) {
  const normalized = normalizeText(transaction?.merchant || transaction?.desc || transaction?.label);
  const genericWords = new Set(['market', 'store', 'shop', 'france', 'sas', 'sarl', 'sa', 'eu']);
  return normalized.split(' ').filter(word => word.length > 1 && !genericWords.has(word)).slice(0, 4).join(' ') || 'operation';
}

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let clean = String(value || '').trim().replace(/[€$£CHF]/gi, '').replace(/\s/g, '');
  if (!clean) return 0;
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.lastIndexOf(',') > clean.lastIndexOf('.')
      ? clean.replaceAll('.', '').replace(',', '.')
      : clean.replaceAll(',', '');
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  }
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  const raw = String(value || '').trim();
  const toValidISO = (year, month, day) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = new Date(`${iso}T12:00:00`);
    return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day ? iso : '';
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return toValidISO(year, month, day);
  }
  const parts = raw.split(/[/.\-]/).map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return '';
  let [first, second, third] = parts;
  if (first > 1900) return toValidISO(first, second, third);
  const year = third < 100 ? 2000 + third : third;
  return toValidISO(year, second, first);
}

function detectDelimiter(firstLine) {
  const candidates = [';', ',', '\t'];
  return candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}

function parseDelimitedLine(line, delimiter) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = '';
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

const HEADER_ALIASES = {
  date: ['date', 'date operation', 'date de l operation', 'booking date'],
  description: ['description', 'libelle', 'libelle operation', 'operation', 'nom', 'payee', 'merchant', 'memo'],
  amount: ['montant', 'amount', 'valeur', 'somme'],
  debit: ['debit', 'montant debit', 'depense', 'sortie'],
  credit: ['credit', 'montant credit', 'revenu', 'entree'],
  category: ['categorie', 'category'],
  type: ['type', 'sens']
};

function resolveHeaders(headers) {
  const normalized = headers.map(normalizeText);
  return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [
    key,
    normalized.findIndex(header => aliases.includes(header))
  ]));
}

export function parseCSVStatement(text) {
  const allLines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  const lines = allLines.slice(0, MAX_IMPORT_ROWS + 1);
  if (lines.length < 2) return { transactions: [], errors: ['Le relevé CSV est vide.'], delimiter: ';' };
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter);
  const columns = resolveHeaders(headers);
  if (columns.date < 0 || columns.description < 0 || (columns.amount < 0 && columns.debit < 0 && columns.credit < 0)) {
    return { transactions: [], errors: ['Colonnes requises : date, description et montant (ou débit/crédit).'], delimiter };
  }

  const transactions = [];
  const errors = allLines.length > MAX_IMPORT_ROWS + 1
    ? [`Import limité aux ${MAX_IMPORT_ROWS.toLocaleString('fr-FR')} premières opérations.`]
    : [];
  lines.slice(1).forEach((line, rowIndex) => {
    const cells = parseDelimitedLine(line, delimiter);
    const date = parseDate(cells[columns.date]);
    const description = String(cells[columns.description] || '').trim();
    const amountValue = columns.amount >= 0 ? parseMoney(cells[columns.amount]) : 0;
    const debit = columns.debit >= 0 ? Math.abs(parseMoney(cells[columns.debit])) : 0;
    const credit = columns.credit >= 0 ? Math.abs(parseMoney(cells[columns.credit])) : 0;
    const explicitType = normalizeText(columns.type >= 0 ? cells[columns.type] : '');
    let type = amountValue < 0 || debit > 0 || /debit|depense|sortie/.test(explicitType) ? 'expense' : 'income';
    const amount = roundMoney(debit || credit || Math.abs(amountValue));
    if (!date || !description || amount <= 0) {
      errors.push(`Ligne ${rowIndex + 2} ignorée : date, description ou montant invalide.`);
      return;
    }
    if (credit > 0) type = 'income';
    transactions.push({
      id: `import-${date}-${rowIndex}-${Math.random().toString(36).slice(2, 8)}`,
      date,
      desc: description.slice(0, 180),
      merchant: merchantKey({ desc: description }),
      type,
      amount,
      amountBase: amount,
      category: String(columns.category >= 0 ? cells[columns.category] : '').trim().slice(0, 60) || 'À classer',
      currency: 'EUR',
      source: 'statement-import',
      reconciled: false,
      importedAt: new Date().toISOString()
    });
  });
  return { transactions, errors, delimiter };
}

export function parseQIFStatement(text) {
  const allRecords = String(text || '').split(/^\^\s*$/m).map(record => record.trim()).filter(Boolean);
  const records = allRecords.slice(0, MAX_IMPORT_ROWS + 1);
  const transactions = [];
  const errors = allRecords.length > MAX_IMPORT_ROWS + 1
    ? [`Import limité aux ${MAX_IMPORT_ROWS.toLocaleString('fr-FR')} premières opérations.`]
    : [];
  records.forEach((record, index) => {
    const recordLines = record.split(/\r?\n/).filter(line => !line.startsWith('!Type'));
    if (!recordLines.length) return;
    const fields = {};
    recordLines.forEach(line => {
      if (line.length > 1) fields[line[0]] = line.slice(1).trim();
    });
    const date = parseDate(fields.D);
    const signedAmount = parseMoney(fields.T);
    const description = fields.P || fields.M || 'Opération importée';
    if (!date || !signedAmount) {
      errors.push(`Opération QIF ${index + 1} ignorée.`);
      return;
    }
    const amount = roundMoney(Math.abs(signedAmount));
    transactions.push({
      id: `qif-${date}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      date,
      desc: description.slice(0, 180),
      merchant: merchantKey({ desc: description }),
      type: signedAmount < 0 ? 'expense' : 'income',
      amount,
      amountBase: amount,
      category: String(fields.L || 'À classer').replace(/^\[/, '').replace(/\]$/, '').slice(0, 60),
      currency: 'EUR',
      source: 'statement-import',
      reconciled: false,
      importedAt: new Date().toISOString()
    });
  });
  return { transactions, errors };
}

export function transactionFingerprint(transaction) {
  return [
    String(transaction?.date || '').slice(0, 10),
    transaction?.type || 'expense',
    roundMoney(transaction?.amountBase ?? transaction?.amount).toFixed(2),
    merchantKey(transaction)
  ].join('|');
}

export function partitionDuplicates(existing, incoming) {
  const known = new Set((existing || []).map(transactionFingerprint));
  const accepted = [];
  const duplicates = [];
  (incoming || []).forEach(transaction => {
    const fingerprint = transactionFingerprint(transaction);
    if (known.has(fingerprint)) duplicates.push(transaction);
    else {
      known.add(fingerprint);
      accepted.push(transaction);
    }
  });
  return { accepted, duplicates };
}

export function applyAutomationRules(transactions, rules) {
  let changed = 0;
  const appliedByRule = {};
  const result = (transactions || []).map(transaction => {
    const haystack = normalizeText([transaction.desc, transaction.merchant, transaction.category].join(' '));
    const rule = (rules || []).find(candidate => candidate?.enabled !== false && normalizeText(candidate?.contains) && haystack.includes(normalizeText(candidate.contains)));
    if (!rule) return { ...transaction };
    const next = { ...transaction };
    if (rule.category && next.category !== rule.category) {
      next.category = String(rule.category).slice(0, 60);
      changed += 1;
      appliedByRule[rule.id] = (appliedByRule[rule.id] || 0) + 1;
    }
    if (rule.type === 'income' || rule.type === 'expense') next.type = rule.type;
    next.automationRuleId = rule.id;
    return next;
  });
  return { transactions: result, changed, appliedByRule };
}

export function suggestAutomationRules(transactions) {
  const groups = new Map();
  (transactions || []).forEach(transaction => {
    if (!transaction?.desc || !transaction?.category || transaction.category === 'À classer') return;
    const key = merchantKey(transaction);
    if (key.length < 3) return;
    const group = groups.get(key) || { merchant: key, total: 0, categories: {} };
    group.total += 1;
    group.categories[transaction.category] = (group.categories[transaction.category] || 0) + 1;
    groups.set(key, group);
  });
  return [...groups.values()].map(group => {
    const [category, count] = Object.entries(group.categories).sort((a, b) => b[1] - a[1])[0] || [];
    return { contains: group.merchant, category, count, confidence: group.total ? Math.round((count / group.total) * 100) : 0 };
  }).filter(suggestion => suggestion.count >= 2 && suggestion.confidence >= 70).sort((a, b) => b.count - a.count).slice(0, 12);
}

function daysBetween(first, second) {
  return Math.round(Math.abs(new Date(`${second}T12:00:00`) - new Date(`${first}T12:00:00`)) / 86_400_000);
}

export function detectSubscriptions(transactions, recurringRules = []) {
  const results = [];
  const recurringMerchants = new Set();
  (recurringRules || []).filter(rule => rule.type !== 'income').forEach(rule => {
    const merchant = merchantKey(rule);
    recurringMerchants.add(merchant);
    const amount = Math.abs(roundMoney(rule.amountBase ?? rule.amount));
    const monthly = rule.frequency === 'weekly' ? amount * 52 / 12 : rule.frequency === 'yearly' ? amount / 12 : amount;
    results.push({
      id: `rule-${rule.id}`,
      merchant: rule.desc || rule.category || merchant,
      key: merchant,
      source: 'recurring',
      frequency: rule.frequency || 'monthly',
      latestAmount: amount,
      monthlyCost: roundMoney(monthly),
      yearlyCost: roundMoney(monthly * 12),
      nextDate: rule.nextDate || '',
      priceChange: 0,
      occurrences: null
    });
  });

  const groups = new Map();
  (transactions || []).filter(transaction => transaction.type === 'expense' && !transaction.projected && transaction.date).forEach(transaction => {
    const key = merchantKey(transaction);
    const group = groups.get(key) || [];
    group.push(transaction);
    groups.set(key, group);
  });

  groups.forEach((group, key) => {
    if (group.length < 2 || recurringMerchants.has(key)) return;
    const sorted = [...group].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const uniqueMonths = new Set(sorted.map(transaction => String(transaction.date).slice(0, 7)));
    if (uniqueMonths.size < 2) return;
    const intervals = sorted.slice(1).map((transaction, index) => daysBetween(sorted[index].date, transaction.date));
    const averageDays = intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length);
    const frequency = averageDays >= 330 ? 'yearly' : averageDays >= 20 && averageDays <= 45 ? 'monthly' : averageDays >= 5 && averageDays <= 9 ? 'weekly' : '';
    if (!frequency) return;
    const amounts = sorted.map(transaction => Math.abs(roundMoney(transaction.amountBase ?? transaction.amount)));
    const latestAmount = amounts.at(-1);
    const previousAmount = amounts.at(-2);
    const priceChange = previousAmount > 0 ? roundMoney(((latestAmount - previousAmount) / previousAmount) * 100) : 0;
    const monthlyCost = frequency === 'weekly' ? latestAmount * 52 / 12 : frequency === 'yearly' ? latestAmount / 12 : latestAmount;
    results.push({
      id: `detected-${key}`,
      merchant: sorted.at(-1).desc || key,
      key,
      source: 'detected',
      frequency,
      latestAmount,
      monthlyCost: roundMoney(monthlyCost),
      yearlyCost: roundMoney(monthlyCost * 12),
      lastDate: sorted.at(-1).date,
      priceChange,
      occurrences: sorted.length
    });
  });
  return results.sort((a, b) => b.yearlyCost - a.yearlyCost);
}

export function calculateNetWorth(account) {
  const transactionNet = (account?.transactions || []).reduce((sum, transaction) => {
    const amount = Math.abs(roundMoney(transaction.amountBase ?? transaction.amount));
    return sum + (transaction.type === 'income' ? amount : transaction.type === 'expense' ? -amount : 0);
  }, 0);
  const cash = roundMoney((Number(account?.initialCapital) || 0) + transactionNet);
  const savings = roundMoney(Object.values(account?.savingsAccounts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0));
  const assets = roundMoney((account?.wealthAssets || []).reduce((sum, asset) => sum + Math.max(0, Number(asset.value) || 0), 0));
  const liabilities = roundMoney((account?.debts || []).filter(debt => debt.direction === 'i_owe_them').reduce((sum, debt) => sum + Math.max(0, Number(debt.remainingAmount ?? debt.amount) || 0), 0));
  return { cash, savings, assets, liabilities, netWorth: roundMoney(cash + savings + assets - liabilities) };
}

export function buildLocalAlerts(account, today = new Date().toISOString().slice(0, 10)) {
  const alerts = [];
  const todayDate = new Date(`${today}T12:00:00`);
  const daysUntil = value => Math.ceil((new Date(`${value}T12:00:00`) - todayDate) / 86_400_000);

  detectSubscriptions(account?.transactions, account?.recurringTransactions)
    .filter(subscription => subscription.priceChange >= 5)
    .forEach(subscription => alerts.push({
      id: `subscription-${subscription.key}`,
      level: 'warning',
      title: `Hausse détectée pour ${subscription.merchant}`,
      detail: `Le dernier montant est supérieur de ${subscription.priceChange.toLocaleString('fr-FR')} %.`
    }));

  (account?.debts || []).forEach(debt => {
    const remaining = Math.max(0, Number(debt.remainingAmount ?? debt.amount) || 0);
    const delay = debt.endDate ? daysUntil(debt.endDate) : Number.POSITIVE_INFINITY;
    if (remaining > 0 && delay >= 0 && delay <= 7) alerts.push({
      id: `debt-${debt.id}`,
      level: delay <= 2 ? 'danger' : 'warning',
      title: `Échéance de dette dans ${delay === 0 ? 'la journée' : `${delay} jour(s)`}`,
      detail: debt.person ? `Échéance liée à ${debt.person}.` : 'Une dette arrive bientôt à échéance.'
    });
  });

  const month = today.slice(0, 7);
  Object.entries(account?.envelopes || {}).forEach(([category, limitValue]) => {
    const limit = Number(limitValue) || 0;
    if (limit <= 0) return;
    const spent = (account?.transactions || []).filter(transaction =>
      transaction.type === 'expense' && String(transaction.date).startsWith(month) && transaction.category === category
    ).reduce((sum, transaction) => sum + Math.abs(Number(transaction.amountBase ?? transaction.amount) || 0), 0);
    const percent = Math.round((spent / limit) * 100);
    if (percent >= 80) alerts.push({
      id: `envelope-${normalizeText(category)}`,
      level: percent >= 100 ? 'danger' : 'warning',
      title: percent >= 100 ? `Budget ${category} dépassé` : `Budget ${category} utilisé à ${percent} %`,
      detail: percent >= 100 ? 'Cette enveloppe mérite votre attention.' : 'La limite mensuelle approche.'
    });
  });

  const order = { danger: 0, warning: 1, info: 2 };
  return alerts.sort((first, second) => (order[first.level] ?? 9) - (order[second.level] ?? 9)).slice(0, 6);
}
