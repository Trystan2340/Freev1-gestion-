// ---------- Moteur unifié des transactions récurrentes ----------
// Toutes les vues utilisent ces helpers afin d'éviter des calculs divergents.

function normalizeRecurringFrequency(value) {
  return ['monthly', 'weekly', 'yearly'].includes(value) ? value : 'monthly';
}

function periodKey(dateISO, frequency) {
  const d = new Date(`${dateISO}T00:00:00`);
  const freq = normalizeRecurringFrequency(frequency);
  if (freq === 'weekly') {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
  if (freq === 'yearly') return String(d.getFullYear());
  return dateISO.slice(0, 7);
}

function recurringDatesForMonth(rule, month) {
  if (!rule || !/^\d{4}-\d{2}$/.test(String(month || ''))) return [];
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const startDate = rule.startDate || isoDate(getToday());
  const start = new Date(`${startDate}T00:00:00`);
  const frequency = normalizeRecurringFrequency(rule.frequency);
  const dates = [];

  if (frequency === 'monthly') {
    const requestedDay = Math.max(1, Math.min(31, Number(rule.dayOfMonth) || start.getDate() || 1));
    dates.push(`${month}-${String(Math.min(requestedDay, lastDay)).padStart(2, '0')}`);
  } else if (frequency === 'weekly') {
    const weekday = start.getDay();
    for (let day = 1; day <= lastDay; day++) {
      const target = new Date(year, mon - 1, day);
      if (target.getDay() === weekday) dates.push(`${month}-${String(day).padStart(2, '0')}`);
    }
  } else if (start.getMonth() === mon - 1) {
    // Le 29 février devient le dernier jour de février lors des années non bissextiles.
    dates.push(`${month}-${String(Math.min(start.getDate(), lastDay)).padStart(2, '0')}`);
  }

  return dates.filter(dateISO => new Date(`${dateISO}T00:00:00`) >= start);
}

function normalizeSkippedPeriods(rule) {
  if (!rule) return [];
  const normalized = [...new Set((Array.isArray(rule.skippedPeriods) ? rule.skippedPeriods : [])
    .map(String).filter(Boolean))];
  rule.skippedPeriods = normalized;
  return normalized;
}

function isRecurringPeriodSkipped(rule, key) {
  return normalizeSkippedPeriods(rule).includes(String(key || ''));
}

function addRecurringSkippedPeriod(rule, key) {
  if (!rule || !key) return false;
  const skipped = normalizeSkippedPeriods(rule);
  if (skipped.includes(String(key))) return false;
  rule.skippedPeriods = [...skipped, String(key)];
  return true;
}

function removeRecurringSkippedPeriod(rule, key) {
  if (!rule || !key) return false;
  const before = normalizeSkippedPeriods(rule);
  const after = before.filter(item => item !== String(key));
  rule.skippedPeriods = after;
  return after.length !== before.length;
}

function occurrenceExists(parentId, key, accountId = '') {
  return transactions.some(t => {
    if (String(t.parentId || '') !== String(parentId || '')) return false;
    if (accountId && t._accountId && String(t._accountId) !== String(accountId)) return false;
    return String(t.periodKey || '') === String(key || '');
  });
}

function isUserProtectedOccurrence(t) {
  return !!(t && (
    t.reconciled ||
    t._manuallyEdited ||
    (t.source && t.source !== 'recurring')
  ));
}

function recurringRuleSignature(rule) {
  if (!rule) return '';
  return [String(rule.id || ''), normalizeRecurringFrequency(rule.frequency)].join('|');
}

// Seuls les doublons d'identifiant sont fusionnés. Deux abonnements identiques
// avec des identifiants différents sont légitimes et doivent rester distincts.
function dedupeRecurringRules() {
  if (!Array.isArray(recurringTransactions)) recurringTransactions = [];
  const seen = new Map();
  recurringTransactions.forEach(rule => {
    if (!rule) return;
    if (!rule.id) rule.id = genId();
    rule.frequency = normalizeRecurringFrequency(rule.frequency);
    normalizeSkippedPeriods(rule);
    const key = String(rule.id);
    if (!seen.has(key)) seen.set(key, rule);
    else Object.assign(seen.get(key), rule);
  });
  recurringTransactions = [...seen.values()];
}

function recurringOccurrenceKey(t) {
  if (!t?.parentId) return '';
  const rule = recurringTransactions.find(r => String(r.id) === String(t.parentId));
  const frequency = normalizeRecurringFrequency(rule?.frequency);
  if (!t.periodKey && t.date) t.periodKey = periodKey(t.date, frequency);
  const accountKey = t._accountId || currentAccountId || 'current';
  return `${String(accountKey)}|${String(t.parentId)}|${t.periodKey || t.date || ''}`;
}

function occurrenceProtectionScore(t) {
  if (!t) return 0;
  return (t.reconciled ? 8 : 0) + ((t._manuallyEdited && t.reconcileColor) ? 4 : 0) +
    (t._manuallyEdited ? 2 : 0) + ((t.source && t.source !== 'recurring') ? 1 : 0);
}

function dedupeRecurringOccurrences() {
  if (!Array.isArray(transactions)) transactions = [];
  const seen = new Map();
  const keep = [];
  transactions.forEach(t => {
    if (!t?.parentId) {
      keep.push(t);
      return;
    }
    const key = recurringOccurrenceKey(t);
    if (!key || !seen.has(key)) {
      seen.set(key, keep.length);
      keep.push(t);
      return;
    }
    const index = seen.get(key);
    const current = keep[index];
    if (occurrenceProtectionScore(t) > occurrenceProtectionScore(current)) keep[index] = t;
  });
  transactions = keep;
}

function buildRecurringOccurrence(rule, dateISO, extra = {}) {
  const amountBase = roundMoney(Number(rule.amountBase ?? rule.amount) || 0);
  const fromSavings = !!rule.fromSavings;
  return {
    id: genId(),
    parentId: rule.id,
    periodKey: periodKey(dateISO, rule.frequency),
    type: fromSavings ? 'income' : (rule.type || 'expense'),
    fromSavings: fromSavings || undefined,
    category: rule.category || 'Autre',
    amount: amountBase,
    amountBase,
    originalAmount: Number(rule.originalAmount ?? amountBase) || amountBase,
    currency: rule.currency || settings.baseCurrency || 'EUR',
    fxRate: rule.fxRate || null,
    date: dateISO,
    desc: rule.desc || '',
    tags: Array.isArray(rule.tags) ? [...rule.tags] : [],
    mode: rule.mode || settings.defaultMode || 'personal',
    transferTarget: rule.transferTarget || '',
    source: 'recurring',
    isRecurring: false,
    linkedDebtId: rule.linkedDebtId || null,
    linkedDebtAccountId: rule.linkedDebtAccountId || '',
    reconcileColor: rule.reconcileColor || '',
    _effectsApplied: false,
    ...extra
  };
}

function occurrenceHasSideEffects(tx) {
  return !!(tx && (tx.type === 'transfer' || tx.fromSavings || tx.linkedDebtId));
}

function applyOccurrenceSideEffects(tx) {
  if (!occurrenceHasSideEffects(tx)) return false;
  if (!tx.date || tx.date > isoDate(getToday())) {
    if (tx._effectsApplied === undefined) tx._effectsApplied = false;
    return false;
  }
  if (tx._effectsApplied === true) return false;
  const amount = Number(tx.amountBase ?? tx.amount) || 0;
  const debtAmount = Number(tx.linkedDebtAmount ?? amount) || 0;
  if (tx.type === 'transfer') applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), amount);
  if (tx.fromSavings) applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), -amount);
  if (tx.linkedDebtId && debtAmount > 0) decreaseDebt(tx.linkedDebtId, debtAmount, tx.linkedDebtAccountId || '', false);
  tx._effectsApplied = true;
  return true;
}

function revertOccurrenceSideEffects(tx) {
  if (!occurrenceHasSideEffects(tx)) return false;
  if (!tx.date || tx.date > isoDate(getToday()) || tx._effectsApplied === false) return false;
  const amount = Number(tx.amountBase ?? tx.amount) || 0;
  const debtAmount = Number(tx.linkedDebtAmount ?? amount) || 0;
  if (tx.type === 'transfer') applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), -amount);
  if (tx.fromSavings) applyTransferToSavings(tx.transferTarget || defaultSavingsTarget(), amount);
  if (tx.linkedDebtId && debtAmount > 0) increaseDebt(tx.linkedDebtId, debtAmount, tx.linkedDebtAccountId || '', false);
  tx._effectsApplied = false;
  return true;
}

function activateDueTransactionEffects() {
  transactions.forEach(tx => {
    if (tx?._effectsApplied === false && tx.date && tx.date <= isoDate(getToday())) {
      applyOccurrenceSideEffects(tx);
    }
  });
}

function getNextRecurringDate(rule, fromDate = null, monthsAhead = 36) {
  if (!rule) return '';
  const startISO = fromDate || isoDate(getToday());
  const cursor = new Date(`${startISO.slice(0, 7)}-01T00:00:00`);
  for (let offset = 0; offset <= monthsAhead; offset++) {
    const monthDate = new Date(cursor);
    monthDate.setMonth(monthDate.getMonth() + offset);
    const month = isoMonth(monthDate);
    const dates = recurringDatesForMonth(rule, month);
    for (const dateISO of dates) {
      const key = periodKey(dateISO, rule.frequency);
      if (dateISO >= startISO && !isRecurringPeriodSkipped(rule, key)) return dateISO;
    }
  }
  return '';
}

// ── Garde contre les appels réentrants simultanés ──────────────
let _generatingOccurrences = false;

function generateRecurringOccurrences(baseMonth = null, monthsBack = 18, monthsForward = 0) {
  if (_generatingOccurrences) return 0;
  _generatingOccurrences = true;
  let created = 0;
  try {
    const todayStr = isoDate(getToday());
    const referenceMonth = baseMonth || isoMonth(getToday());
    const base = new Date(`${referenceMonth}-01T00:00:00`);
    dedupeRecurringRules();
    dedupeRecurringOccurrences();

    // Les anciennes versions créaient des opérations futures réelles. Elles
    // redeviennent des prévisions, sauf si l'utilisateur les avait déjà modifiées.
    transactions = transactions.filter(tx => {
      const isFutureAuto = tx?.parentId && tx.date > todayStr && !isUserProtectedOccurrence(tx);
      return !isFutureAuto;
    });

    activateDueTransactionEffects();

    const months = [];
    for (let offset = -Math.max(0, monthsBack); offset <= Math.max(0, monthsForward); offset++) {
      const date = new Date(base);
      date.setMonth(date.getMonth() + offset);
      months.push(isoMonth(date));
    }

    [...new Set(months)].forEach(month => {
      recurringTransactions.forEach(rule => {
        recurringDatesForMonth(rule, month).forEach(dateISO => {
          if (dateISO > todayStr) return;
          const key = periodKey(dateISO, rule.frequency);
          if (isRecurringPeriodSkipped(rule, key) || occurrenceExists(rule.id, key)) return;
          const occurrence = buildRecurringOccurrence(rule, dateISO);
          transactions.push(occurrence);
          applyOccurrenceSideEffects(occurrence);
          created += 1;
        });
      });
    });

    dedupeRecurringOccurrences();
    return created;
  } finally {
    _generatingOccurrences = false;
  }
}

function getUpcomingRecurringOccurrences(daysAhead = 5) {
  const start = isoDate(getToday());
  const limitDate = new Date(getToday());
  limitDate.setDate(limitDate.getDate() + Math.max(0, Number(daysAhead) || 0));
  const end = isoDate(limitDate);
  const months = monthsBetweenISO(start, end);
  const results = [];
  months.forEach(month => {
    getProjectedRecurringTransactions(month).forEach(tx => {
      if (tx.date > start && tx.date <= end) results.push({ ...tx, nextDate: tx.date });
    });
  });
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

function openRecurringCreationModal() {
  openModal();
  const checkbox = document.getElementById('isRecurring');
  if (checkbox) checkbox.checked = true;
  toggleRecurOptions();
}

function renderRecurringList() {
  const container = document.getElementById('recurringList');
  const summary = document.getElementById('recurringSummary');
  if (!container) return;

  const tomorrow = new Date(getToday());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = isoDate(tomorrow);
  const upcoming = getUpcomingRecurringOccurrences(30);
  const upcomingIncome = upcoming.filter(t => t.type === 'income').reduce((sum, t) => sum + (Number(t.amountBase ?? t.amount) || 0), 0);
  const upcomingOutflow = upcoming.filter(t => t.type !== 'income').reduce((sum, t) => sum + (Number(t.amountBase ?? t.amount) || 0), 0);
  const skippedCount = recurringTransactions.reduce((sum, rule) => sum + normalizeSkippedPeriods(rule).length, 0);

  if (summary) {
    summary.innerHTML = `
      <div class="recurring-stat"><span>Règles actives</span><strong>${recurringTransactions.length}</strong></div>
      <div class="recurring-stat"><span>30 prochains jours</span><strong>${upcoming.length}</strong></div>
      <div class="recurring-stat recurring-stat-income"><span>Revenus prévus</span><strong>+${formatCurrency(upcomingIncome)}</strong></div>
      <div class="recurring-stat recurring-stat-outflow"><span>Sorties prévues</span><strong>-${formatCurrency(upcomingOutflow)}</strong></div>
      <div class="recurring-stat"><span>Échéances ignorées</span><strong>${skippedCount}</strong></div>
    `;
  }

  if (!recurringTransactions.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-repeat"></i><p>Aucune transaction récurrente</p><button class="btn btn-primary btn-sm" onclick="openRecurringCreationModal()"><i class="fa-solid fa-plus"></i> Créer une récurrence</button></div>`;
    return;
  }

  container.innerHTML = `
    <div class="table-container">
      <table class="table recurring-table">
        <thead><tr><th>Transaction</th><th>Montant</th><th>Rythme</th><th>Prochaine échéance</th><th>État</th><th>Actions</th></tr></thead>
        <tbody>
          ${recurringTransactions.map(rule => {
            const typeLabel = rule.type === 'income' ? (rule.fromSavings ? 'Retrait épargne' : 'Revenu') : (rule.type === 'transfer' ? 'Transfert' : 'Dépense');
            const badge = rule.type === 'income' ? 'badge-income' : (rule.type === 'transfer' ? 'badge-transfer' : 'badge-expense');
            const frequency = normalizeRecurringFrequency(rule.frequency);
            const freqLabel = frequency === 'monthly' ? 'Mensuelle' : (frequency === 'weekly' ? 'Hebdomadaire' : 'Annuelle');
            const nextDate = getNextRecurringDate(rule, tomorrowISO);
            const skipped = normalizeSkippedPeriods(rule).length;
            const startDate = rule.startDate ? new Date(`${rule.startDate}T12:00:00`).toLocaleDateString('fr-FR') : '—';
            return `
              <tr>
                <td><div class="recurring-name"><span class="badge ${badge}">${escapeHTML(typeLabel)}</span><strong>${escapeHTML(rule.desc || rule.category || 'Sans description')}</strong><small>${escapeHTML(rule.category || 'Autre')} · depuis le ${escapeHTML(startDate)}</small></div></td>
                <td class="font-semibold">${formatCurrency(Number(rule.amountBase ?? rule.amount) || 0)}</td>
                <td>${escapeHTML(freqLabel)}</td>
                <td>${nextDate ? `<strong>${escapeHTML(new Date(`${nextDate}T12:00:00`).toLocaleDateString('fr-FR'))}</strong>` : '<span class="text-slate-400">Aucune</span>'}</td>
                <td>${skipped ? `<span class="badge recurring-skipped-badge"><i class="fa-solid fa-forward"></i> ${skipped} ignorée${skipped > 1 ? 's' : ''}</span>` : '<span class="badge recurring-active-badge"><i class="fa-solid fa-circle-check"></i> Active</span>'}</td>
                <td class="recurring-actions">
                  <button class="btn-icon js-edit-rule" data-id="${escapeHTML(String(rule.id))}" aria-label="Modifier" title="Modifier la série"><i class="fa-solid fa-edit"></i></button>
                  ${skipped ? `<button class="btn-icon js-restore-skipped" data-id="${escapeHTML(String(rule.id))}" aria-label="Rétablir les échéances ignorées" title="Rétablir les échéances ignorées"><i class="fa-solid fa-clock-rotate-left"></i></button>` : ''}
                  <button class="btn-icon js-del" data-id="${escapeHTML(String(rule.id))}" aria-label="Supprimer" title="Supprimer toute la série"><i class="fa-solid fa-trash"></i></button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('.js-edit-rule').forEach(button => button.addEventListener('click', () => {
    const rule = recurringTransactions.find(item => String(item.id) === String(button.dataset.id));
    if (rule) openRecurringRuleModal(rule);
  }));
  container.querySelectorAll('.js-restore-skipped').forEach(button => button.addEventListener('click', () => restoreSkippedRecurringPeriods(button.dataset.id)));
  container.querySelectorAll('.js-del').forEach(button => button.addEventListener('click', () => deleteRecurring(button.dataset.id)));
}

function skipRecurringOccurrenceById(id) {
  const index = transactions.findIndex(t => String(t.id) === String(id));
  const occurrence = index >= 0 ? transactions[index] : null;
  if (!occurrence?.parentId) return false;
  const rule = recurringTransactions.find(r => String(r.id) === String(occurrence.parentId));
  if (!rule) return false;
  const key = occurrence.periodKey || periodKey(occurrence.date, rule.frequency);
  const backup = JSON.parse(JSON.stringify(occurrence));
  addRecurringSkippedPeriod(rule, key);
  revertOccurrenceSideEffects(occurrence);
  transactions.splice(index, 1);
  logAction('skip_occurrence', 'recurring', backup, { ruleId: rule.id, periodKey: key });
  saveData();
  syncAllUI();
  showToast('Cette échéance a été ignorée', 'neutral', true, () => {
    removeRecurringSkippedPeriod(rule, key);
    transactions.splice(Math.min(index, transactions.length), 0, backup);
    applyOccurrenceSideEffects(backup);
    logAction('undo_skip_occurrence', 'recurring', null, backup);
    saveData();
    syncAllUI();
    showToast('Échéance rétablie', 'success');
  });
  return true;
}

function skipProjectedRecurringOccurrence(projected) {
  const rule = getProjectedRule(projected);
  if (!rule) return false;
  const key = projected.periodKey || periodKey(projected.date, rule.frequency);
  if (!addRecurringSkippedPeriod(rule, key)) return false;
  logAction('skip_projected_occurrence', 'recurring', projected, { ruleId: rule.id, periodKey: key });
  saveData();
  syncAllUI();
  showToast(`Échéance du ${new Date(`${projected.date}T12:00:00`).toLocaleDateString('fr-FR')} ignorée`, 'neutral', true, () => {
    removeRecurringSkippedPeriod(rule, key);
    logAction('undo_skip_projected_occurrence', 'recurring', null, projected);
    saveData();
    syncAllUI();
    showToast('Échéance rétablie', 'success');
  });
  return true;
}

function restoreSkippedRecurringPeriods(id) {
  const rule = recurringTransactions.find(r => String(r.id) === String(id));
  if (!rule) return;
  const skipped = [...normalizeSkippedPeriods(rule)];
  if (!skipped.length) return;
  if (!confirm(`Rétablir ${skipped.length} échéance(s) ignorée(s) ?`)) return;
  rule.skippedPeriods = [];
  generateRecurringOccurrences();
  logAction('restore_skipped_periods', 'recurring', skipped, rule);
  saveData();
  syncAllUI();
  showToast('Échéances ignorées rétablies', 'success');
}

function deleteRecurring(id) {
  const rule = recurringTransactions.find(r => String(r.id) === String(id));
  if (!rule) return;
  if (!confirm(`Supprimer toute la série « ${rule.desc || rule.category || 'Récurrente'} » ?\n\nLes échéances déjà créées seront également supprimées.`)) return;
  const backupRule = JSON.parse(JSON.stringify(rule));
  const backupOccurrences = transactions
    .filter(t => String(t.parentId || '') === String(id))
    .map(t => JSON.parse(JSON.stringify(t)));

  backupOccurrences.forEach(revertOccurrenceSideEffects);
  recurringTransactions = recurringTransactions.filter(r => String(r.id) !== String(id));
  transactions = transactions.filter(t => String(t.parentId || '') !== String(id));
  logAction('delete', 'recurring', rule, null);
  saveData();
  syncAllUI();

  showToast(`Série « ${backupRule.desc || backupRule.category} » supprimée`, 'neutral', true, () => {
    recurringTransactions.push(backupRule);
    backupOccurrences.forEach(t => {
      t._effectsApplied = false;
      transactions.push(t);
      applyOccurrenceSideEffects(t);
    });
    logAction('undo_delete', 'recurring', null, backupRule);
    saveData();
    syncAllUI();
    showToast('Suppression annulée', 'success');
  });
}
