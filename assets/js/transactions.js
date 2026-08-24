// ---------- Transactions rendering + filters ----------
let transactionRenderLimit = 100;
function refreshCategoryFilter() {
  const sel = document.getElementById('txCategoryFilter');
  if (!sel) return;
  const srcTx = (typeof multiViewMode !== 'undefined' && multiViewMode !== 'individual')
    ? getDisplayTransactions() : transactions;
  const usedCats = Array.from(new Set(srcTx.filter(t => !t.isRecurring).map(t => t.category || 'Autre')));
  const allDefinedCats = getAllCategories().map(c => c.name);
  const cats = Array.from(new Set([...usedCats, ...allDefinedCats])).sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">Toutes catégories</option>' + cats.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  if (current) sel.value = current;
}

function applyTxFilters() {
  transactionRenderLimit = 100;
  renderAllTransactions();
}

function clearTxFilters() {
  transactionRenderLimit = 100;
  ['txSearch','txTypeFilter','txModeFilter','txCategoryFilter','txMin','txMax','txFrom','txTo'].forEach(id=>{
    const el=document.getElementById(id);
    if (!el) return;
    el.value = '';
  });
  renderAllTransactions();
}

function getFilteredTransactions() {
  // En mode multi-compte, on utilise les transactions de tous les comptes visibles
  const baseList = (multiViewMode === 'individual' ? transactions : getDisplayTransactions())
    .filter(t => !t.isRecurring);
  let list = baseList.slice();

  const q = (document.getElementById('txSearch')?.value || '').toLowerCase().trim();
  const typeF = document.getElementById('txTypeFilter')?.value || '';
  const modeF = document.getElementById('txModeFilter')?.value || '';
  const catF = document.getElementById('txCategoryFilter')?.value || '';
  const minV = safeNumber(document.getElementById('txMin')?.value, NaN);
  const maxV = safeNumber(document.getElementById('txMax')?.value, NaN);
  let from = document.getElementById('txFrom')?.value || '';
  let to = document.getElementById('txTo')?.value || '';

  if (!from && !to) {
    const selectedMonth = document.getElementById('globalMonthPicker')?.value || isoMonth();
    const [year, month] = selectedMonth.split('-').map(Number);
    from = `${selectedMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    to = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
  }

  monthsBetweenISO(from, to).forEach(m => {
    list.push(...getProjectedRecurringTransactions(m, baseList));
  });

  if (q) list = list.filter(t => {
    const hay = `${t.desc||''} ${t.category||''} ${(t.tags||[]).join(' ')} ${(t.mode||'')} ${t._accountName||''}`.toLowerCase();
    return hay.includes(q);
  });
  if (typeF) list = list.filter(t => t.type === typeF);
  if (modeF) list = list.filter(t => (t.mode||'personal') === modeF);
  if (catF) list = list.filter(t => (t.category||'') === catF);
  if (Number.isFinite(minV)) list = list.filter(t => (Number(t.amountBase ?? t.amount) || 0) >= minV);
  if (Number.isFinite(maxV)) list = list.filter(t => (Number(t.amountBase ?? t.amount) || 0) <= maxV);
  if (from) list = list.filter(t => (t.date||'') >= from);
  if (to) list = list.filter(t => (t.date||'') <= to);

  const info = document.getElementById('txFilterInfo');
  if (info) {
    let txt = `${list.length} transaction(s) affichée(s)`;
    if (multiViewMode !== 'individual') {
      const accNames = getViewAccounts().map(a => a.name).join(', ');
      txt += ` · ${multiViewMode === 'global' ? 'Tous les comptes' : accNames}`;
    }
    info.textContent = txt;
  }

  return list;
}

// Calcule le solde cumulatif après chaque opération réelle ou prévue.
// Les prévisions ne sont jamais sauvegardées ici : elles servent uniquement à
// afficher la trajectoire correcte du solde dans les tableaux.
function computeBalanceMap(additionalTransactions = []) {
  const seen = new Set();
  const sorted = [...transactions, ...(additionalTransactions || [])]
    .filter(t => t && !t.isRecurring)
    .filter(t => {
      const key = String(t.id || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
    const d = (a.date || '').localeCompare(b.date || '');
    return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
  });
  let bal = Number(initialCapital) || 0;
  const map = {};
  sorted.forEach(t => {
    const amt = Number(t.amountBase ?? t.amount) || 0;
    if (t.type === 'income') bal = roundMoney(bal + amt);
    else bal = roundMoney(bal - amt);
    map[t.id] = bal;
  });
  return map;
}

function getProjectedBalanceTransactionsThrough(month) {
  const currentMonth = isoMonth(getToday());
  const lastMonth = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : currentMonth;
  if (lastMonth < currentMonth) return [];
  return monthsBetweenISO(`${currentMonth}-01`, `${lastMonth}-01`)
    .flatMap(targetMonth => getProjectedRecurringTransactions(targetMonth));
}

function renderTransactionBalance(t, balance) {
  if (balance === undefined) return '<span class="text-slate-400">—</span>';
  const title = t.projected ? ' title="Solde projeté après cette transaction"' : '';
  return `<span class="font-semibold ${balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}"${title}>${formatCurrency(balance)}</span>`;
}

function renderRecentTransactions() {
  const container = document.getElementById('recentTransactions');
  if (!container) return;

  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();
  const baseMonthTrans = getMonthTransactions(month);
  const monthTrans = baseMonthTrans.concat(getProjectedRecurringTransactions(month, baseMonthTrans)).sort((a,b)=> {
    const d = (b.date||'').localeCompare(a.date||'');
    // Même date : ordre inverse d'insertion (ID DESC) pour que le solde soit cohérent ligne par ligne
    return d !== 0 ? d : String(b.id).localeCompare(String(a.id));
  });

  if (!monthTrans.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>Aucune transaction ce mois-ci</p></div>`;
    return;
  }

  const balMap = multiViewMode === 'individual'
    ? computeBalanceMap(getProjectedBalanceTransactionsThrough(month))
    : {};

  const rows = monthTrans.map(t => {
    const typeLabel = t.type === 'income' ? 'Revenu' : (t.type === 'transfer' ? 'Transfert' : 'Dépense');
    const badge = t.type === 'income' ? 'badge-income' : (t.type === 'transfer' ? 'badge-transfer' : 'badge-expense');
    const cls = t.type === 'income' ? 'text-emerald-600' : (t.type === 'transfer' ? 'text-brand-600' : 'text-rose-600');
    const tags = (t.tags||[]).slice(0,3).map(x=>`<span class="badge" style="background:#e2e8f0;color:#334155;">${escapeHTML(x)}</span>`).join(' ');
    const autoBadge = t.parentId ? '<span class="badge" style="background:#60a5fa;color:white;font-size:0.65rem;"><i class="fa-solid fa-repeat"></i> Auto</span>' : '';
    const projectedBadge = t.projected ? '<span class="badge" style="background:#f59e0b;color:white;font-size:0.65rem;"><i class="fa-solid fa-clock"></i> Prévu</span>' : '';
    const reconcileStyle = getReconcileColorStyle(t);
    const reconcileData = `data-id="${escapeHTML(String(t.id || ''))}" data-account-id="${escapeHTML(String(t._accountId || currentAccountId || ''))}"`;
    const reconciledBadge = t.reconciled
      ? `<span class="badge badge-reconciled" style="background:${reconcileStyle};color:#fff;"><i class="fa-solid fa-check-double"></i> ✓</span>`
      : '';
    const bal = balMap[t.id];
    const balHtml = renderTransactionBalance(t, bal);
    const actionBtns = t.projected
      ? renderProjectedActionButtons(t)
      : `<button class="btn-icon js-edit" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Modifier"><i class="fa-solid fa-edit"></i></button>
          <button class="btn-icon js-del" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Supprimer"><i class="fa-solid fa-trash"></i></button>
          <button class="btn-icon js-dup" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Dupliquer"><i class="fa-solid fa-clone"></i></button>
          <button class="btn-icon js-rec" ${reconcileData} aria-label="${t.reconciled?'Annuler vérification':'Marquer vérifiée'}" title="${t.reconciled?'Annuler':'Marquer vérifiée'}" style="${t.reconciled?`background:${reconcileStyle};color:#fff;border-radius:0.5rem;`:`color:${reconcileStyle};`}"><i class="fa-solid fa-${t.reconciled?'check-double':'check'}"></i></button>`;
    return `
      <tr data-reconciled="${t.reconciled ? '1' : ''}" style="${t.projected ? 'background:#fffbeb;' : (t.reconciled ? 'opacity:0.7;' : '')}">
        <td>${escapeHTML(new Date(t.date + 'T12:00:00').toLocaleDateString('fr-FR'))}</td>
        <td><span class="badge ${badge}">${escapeHTML(t.category||'Autre')}</span> ${autoBadge} ${projectedBadge} ${reconciledBadge} ${tags}</td>
        <td class="text-slate-600">${escapeHTML(t.desc||'-')}</td>
        <td class="text-right font-semibold ${cls}">${t.type==='income'?'+':(t.type==='transfer'?'↔':'-')} ${formatCurrency(Number(t.amountBase ?? t.amount)||0)}</td>
        <td class="text-right col-solde">${balHtml}</td>
        <td>${actionBtns}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="table-container">
      <table class="table">
        <thead><tr><th>Date</th><th>Catégorie</th><th>Description</th><th class="text-right">Montant</th><th class="text-right col-solde">Solde</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  // Animation volontairement limitée : des centaines de transitions bloquaient les mobiles.
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  container.querySelectorAll('tbody tr').forEach((row, i) => {
    if (reduceMotion || i >= 12) return;
    row.style.opacity = '0';
    row.style.transform = 'translateX(-8px)';
    row.style.transition = `opacity 0.25s ease ${i * 24}ms, transform 0.25s ease ${i * 24}ms`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      row.style.opacity = row.dataset.reconciled ? '0.7' : '1';
      row.style.transform = 'translateX(0)';
    }));
  });

  container.querySelectorAll('.js-edit').forEach(btn => btn.addEventListener('click', () => openModalById(btn.dataset.id)));
  container.querySelectorAll('.js-del').forEach(btn => btn.addEventListener('click', () => deleteTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-dup').forEach(btn => btn.addEventListener('click', () => duplicateTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-rec').forEach(btn => btn.addEventListener('click', () => toggleReconcile(btn.dataset.id, btn.dataset.accountId || '')));
  container.querySelectorAll('.js-edit-projected').forEach(btn => btn.addEventListener('click', () => editProjectedRecurring(btn.dataset.id)));
  container.querySelectorAll('.js-del-projected').forEach(btn => btn.addEventListener('click', () => deleteProjectedRecurring(btn.dataset.id)));
  container.querySelectorAll('.js-dup-projected').forEach(btn => btn.addEventListener('click', () => duplicateProjectedTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-rec-projected').forEach(btn => btn.addEventListener('click', () => reconcileProjectedTransaction(btn.dataset.id)));
}

function renderAllTransactions() {
  const container = document.getElementById('allTransactions');
  if (!container) return;

  const completeList = getFilteredTransactions().slice().sort((a,b)=> {
    const d = (b.date||'').localeCompare(a.date||'');
    return d !== 0 ? d : String(b.id).localeCompare(String(a.id));
  });
  if (!completeList.length) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>Aucune transaction</p></div>`;
    return;
  }

  const list = completeList.slice(0, transactionRenderLimit);
  const isMultiMode = multiViewMode !== 'individual';
  const latestVisibleMonth = list.reduce((latest, t) => {
    const month = String(t.date || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(month) && month > latest ? month : latest;
  }, isoMonth(getToday()));
  const balMap = !isMultiMode
    ? computeBalanceMap(getProjectedBalanceTransactionsThrough(latestVisibleMonth))
    : {};

  const rows = list.map(t => {
    const typeLabel = t.type === 'income' ? 'Revenu' : (t.type === 'transfer' ? 'Transfert' : 'Dépense');
    const badge = t.type === 'income' ? 'badge-income' : (t.type === 'transfer' ? 'badge-transfer' : 'badge-expense');
    const cls = t.type === 'income' ? 'text-emerald-600' : (t.type === 'transfer' ? 'text-brand-600' : 'text-rose-600');
    const sign = t.type === 'income' ? '+' : (t.type === 'transfer' ? '↔' : '-');
    const tags = (t.tags||[]).slice(0,4).map(x=>`<span class="badge" style="background:#e2e8f0;color:#334155;">${escapeHTML(x)}</span>`).join(' ');
    const autoBadge = t.parentId ? '<span class="badge" style="background:#60a5fa;color:white;font-size:0.65rem;"><i class="fa-solid fa-repeat"></i> Auto</span>' : '';
    const projectedBadge = t.projected ? '<span class="badge" style="background:#f59e0b;color:white;font-size:0.65rem;"><i class="fa-solid fa-clock"></i> Prévu</span>' : '';
    // Badge compte en mode multi
    let accBadge = '';
    if (isMultiMode && t._accountName) {
      const color = getAccountColor(t._accountIdx ?? 0);
      accBadge = `<span class="account-badge" style="background:${color};margin-left:0.25rem;">${escapeHTML(t._accountName.charAt(0))}</span>`;
    }
    // Badge rapprochement
    const reconcileStyle = getReconcileColorStyle(t);
    const reconcileData = `data-id="${escapeHTML(String(t.id || ''))}" data-account-id="${escapeHTML(String(t._accountId || currentAccountId || ''))}"`;
    const reconciledBadge = t.reconciled
      ? `<span class="badge badge-reconciled" title="Vérifiée" style="background:${reconcileStyle};color:#fff;"><i class="fa-solid fa-check-double"></i> ✓</span>`
      : '';
    // En mode multi, les boutons éditer/supprimer sont désactivés (chaque tx appartient à son compte)
    const editBtn = t.projected
      ? renderProjectedActionButtons(t)
      : isMultiMode
      ? `<button class="btn-icon js-switch-account" title="Basculer sur ce compte pour modifier" data-account-id="${escapeHTML(String(t._accountId || currentAccountId || ''))}"><i class="fa-solid fa-right-to-bracket"></i></button>`
      : `<button class="btn-icon js-edit" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Modifier"><i class="fa-solid fa-edit"></i></button>
         <button class="btn-icon js-del" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Supprimer"><i class="fa-solid fa-trash"></i></button>
         <button class="btn-icon js-dup" data-id="${escapeHTML(String(t.id || ''))}" aria-label="Dupliquer"><i class="fa-solid fa-clone"></i></button>
         <button class="btn-icon js-rec" ${reconcileData} aria-label="${t.reconciled?'Annuler vérification':'Marquer vérifiée'}" title="${t.reconciled?'Annuler vérification':'Marquer vérifiée'}" style="${t.reconciled?`background:${reconcileStyle};color:#fff;border-radius:0.5rem;`:`color:${reconcileStyle};`}"><i class="fa-solid fa-${t.reconciled?'check-double':'check'}"></i></button>`;
    const bal = balMap[t.id];
    const balHtml = renderTransactionBalance(t, bal);
    return `
      <tr style="${t.projected ? 'background:#fffbeb;' : (t.reconciled ? 'opacity:0.75;' : '')}">
        <td>${escapeHTML(new Date(t.date + 'T12:00:00').toLocaleDateString('fr-FR'))}</td>
        <td><span class="badge ${badge}"><i class="fa-solid fa-${t.type==='income'?'arrow-up':(t.type==='transfer'?'right-left':'arrow-down')}"></i> ${escapeHTML(typeLabel)}</span></td>
        <td>${escapeHTML(t.category||'Autre')} ${autoBadge} ${projectedBadge} ${accBadge} ${reconciledBadge} ${tags}</td>
        <td class="text-slate-600">${escapeHTML(t.desc||'-')}</td>
        <td class="text-right font-semibold ${cls}">${sign} ${formatCurrency(Number(t.amountBase ?? t.amount)||0)}</td>
        <td class="text-right col-solde">${balHtml}</td>
        <td>${editBtn}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="table-container">
      <table class="table">
        <thead><tr><th>Date</th><th>Type</th><th>Catégorie</th><th>Description</th><th class="text-right">Montant</th><th class="text-right col-solde">Solde</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${completeList.length > list.length ? `<div class="transaction-load-more"><p>${list.length} sur ${completeList.length} opérations</p><button type="button" class="btn btn-secondary" onclick="showMoreTransactions()"><i class="fa-solid fa-chevron-down"></i> Afficher 100 de plus</button></div>` : ''}
  `;

  if (!isMultiMode) {
    container.querySelectorAll('.js-edit').forEach(btn => btn.addEventListener('click', () => openModalById(btn.dataset.id)));
    container.querySelectorAll('.js-del').forEach(btn => btn.addEventListener('click', () => deleteTransaction(btn.dataset.id)));
    container.querySelectorAll('.js-dup').forEach(btn => btn.addEventListener('click', () => duplicateTransaction(btn.dataset.id)));
    container.querySelectorAll('.js-rec').forEach(btn => btn.addEventListener('click', () => toggleReconcile(btn.dataset.id, btn.dataset.accountId || '')));
  }
  container.querySelectorAll('.js-edit-projected').forEach(btn => btn.addEventListener('click', () => editProjectedRecurring(btn.dataset.id)));
  container.querySelectorAll('.js-del-projected').forEach(btn => btn.addEventListener('click', () => deleteProjectedRecurring(btn.dataset.id)));
  container.querySelectorAll('.js-dup-projected').forEach(btn => btn.addEventListener('click', () => duplicateProjectedTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-rec-projected').forEach(btn => btn.addEventListener('click', () => reconcileProjectedTransaction(btn.dataset.id)));
  container.querySelectorAll('.js-switch-account').forEach(btn => btn.addEventListener('click', () => switchAccount(btn.dataset.accountId || '')));
}

function showMoreTransactions() {
  transactionRenderLimit += 100;
  renderAllTransactions();
}

function duplicateTransaction(id) {
  const t = transactions.find(x => String(x.id) === String(id));
  if (!t) return;
  const copy = {
    ...t,
    id: genId(),
    date: isoDate(new Date()),   // date du jour par défaut
    desc: (t.desc || '').replace(' (copie)', '') + ' (copie)',
    reconciled: false,           // remet à zéro la vérification
    parentId: '',                // n'est plus liée à une récurrente
    periodKey: '',
    linkedTransferId: '',
    linkedAccountId: '',
    linkedTransferRole: '',
    linkedTransferRate: null,
    source: 'manual',
    _effectsApplied: false
  };
  transactions.push(copy);
  applyOccurrenceSideEffects(copy);
  logAction('duplicate', 'transaction', t, copy);
  saveData();
  updateDashboard();
  if (currentView === 'transactions') renderAllTransactions();
  showToast('Transaction dupliquée — date mise à aujourd\'hui', 'success');
}

// ---------- Transaction modal / validation / currency ----------
let lastFocusedEl = null;

function toggleFxRate() {
  const curr = document.getElementById('transCurrency')?.value || settings.baseCurrency;
  const grp = document.getElementById('fxRateGroup');
  if (!grp) return;
  if (curr !== settings.baseCurrency) grp.classList.remove('hidden');
  else grp.classList.add('hidden');
}

function toggleDebtSelect() {
  const category = document.getElementById('transCategory')?.value || '';
  const grp = document.getElementById('debtSelectGroup');
  if (!grp) return;
  if (category === 'Remboursement dette') {
    grp.classList.remove('hidden');
    refreshDebtSelect();
  } else {
    grp.classList.add('hidden');
  }
}

function refreshDebtSelect() {
  const sel = document.getElementById('transLinkedDebt');
  if (!sel) return;
  
  // Filtrer les dettes qui ont un montant restant > 0
  const unpaidDebts = debts.filter(d => {
    const remaining = Number(d.remainingAmount ?? d.amount) || 0;
    return remaining > 0;
  });
  
  if (unpaidDebts.length === 0) {
    sel.innerHTML = '<option value="">Aucune dette à rembourser</option>';
    return;
  }
  
  const options = unpaidDebts.map(d => {
    const remaining = Number(d.remainingAmount ?? d.amount) || 0;
    const label = d.direction === 'they_owe_me' ? `${d.person} me doit` : `Je dois à ${d.person}`;
    return `<option value="${d.id}">${escapeHTML(label)} - ${formatCurrency(remaining)}</option>`;
  }).join('');
  
  sel.innerHTML = '<option value="">Sélectionner une dette...</option>' + options;
}

function refreshSavingsSelect() {
  const sel = document.getElementById('transferSavingsTarget');
  if (!sel) return;
  const keys = Object.keys(savingsAccounts || {});
  const base = keys.length ? keys : ['Livret A'];
  sel.innerHTML = base.map(k => `<option value="${escapeHTML(k)}">${escapeHTML(k)}</option>`).join('');
}

function resetRecurringDateScopeContext() {
  ['editRuleOriginalDate', 'editOccurrenceId', 'editOccurrencePeriodKey', 'editOccurrenceOriginalDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const group = document.getElementById('recurDateScopeGroup');
  if (group) group.classList.add('hidden');
  const all = document.getElementById('recurDateScopeAll');
  const single = document.getElementById('recurDateScopeSingle');
  if (all) all.checked = true;
  if (single) single.checked = false;
}

function setupRecurringDateScopeContext(occurrence) {
  resetRecurringDateScopeContext();
  if (!occurrence) return;

  const occurrenceDate = occurrence.date || '';
  const frequency = occurrence.frequency || recurringTransactions.find(r => String(r.id) === String(occurrence.parentId))?.frequency || 'monthly';
  const key = occurrence.periodKey || (occurrenceDate ? periodKey(occurrenceDate, frequency) : '');

  const idEl = document.getElementById('editOccurrenceId');
  const keyEl = document.getElementById('editOccurrencePeriodKey');
  const dateEl = document.getElementById('editOccurrenceOriginalDate');
  if (idEl) idEl.value = occurrence.id || '';
  if (keyEl) keyEl.value = key;
  if (dateEl) dateEl.value = occurrenceDate;

  const group = document.getElementById('recurDateScopeGroup');
  if (group) group.classList.remove('hidden');
  const all = document.getElementById('recurDateScopeAll');
  if (all) all.checked = true;
}

function getRecurringDateScope() {
  return document.querySelector('input[name="recurDateScope"]:checked')?.value || 'all';
}

function setTransactionColorScopeHint(message='') {
  const hint = document.getElementById('transReconcileScopeHint');
  if (hint) hint.textContent = message || 'Cette couleur s’applique uniquement à cette transaction. « D » utilise la couleur globale des paramètres.';
}

function applyRecurringOccurrenceColorOverride(ruleId, occurrenceId, occurrencePeriodKey, occurrenceDate, color) {
  const cleanColor = /^#[0-9a-f]{6}$/i.test(String(color || '').trim()) ? String(color).trim() : '';
  let target = transactions.find(t => String(t.id) === String(occurrenceId || ''));
  if (!target && occurrencePeriodKey) {
    target = transactions.find(t => String(t.parentId || '') === String(ruleId) && String(t.periodKey || '') === String(occurrencePeriodKey));
  }
  if (!target && occurrenceDate) {
    target = transactions.find(t => String(t.parentId || '') === String(ruleId) && String(t.date || '') === String(occurrenceDate));
  }
  if (!target) return false;

  const before = { ...target };
  target.reconcileColor = cleanColor;
  target._manuallyEdited = true;
  logAction('update_reconcile_color', 'transaction', before, target);
  return true;
}

function openModal(transaction=null) {
  lastFocusedEl = document.activeElement;
  const modal = document.getElementById('transactionModal');
  const form = document.getElementById('transactionForm');
  if (!modal || !form) return;

  // ✅ Toujours repeupler les catégories (incluant les perso)
  populateCategorySelects();
  refreshSavingsSelect();
  refreshDebtSelect();
  resetRecurringDateScopeContext();

  if (transaction) {
    document.getElementById('modalTitle').textContent = 'Modifier la transaction';
    document.getElementById('editId').value = transaction.id;
    document.getElementById('transType').value = transaction.fromSavings ? 'savings_withdrawal' : (transaction.type || 'expense');
    document.getElementById('transCategory').value = transaction.category || 'Autre';
    document.getElementById('transAmount').value = transaction.originalAmount ?? transaction.amount;
    document.getElementById('transDate').value = transaction.date;
    document.getElementById('transDesc').value = transaction.desc || '';
    document.getElementById('transTags') && (document.getElementById('transTags').value = (transaction.tags||[]).join(', '));
    document.getElementById('transMode') && (document.getElementById('transMode').value = transaction.mode || settings.defaultMode || 'personal');

    // linked debt
    if (transaction.linkedDebtId && document.getElementById('transLinkedDebt')) {
      document.getElementById('transLinkedDebt').value = transaction.linkedDebtId;
    }
    toggleDebtSelect();

    // recurring toggle
    document.getElementById('isRecurring').checked = !!transaction.isRecurring;
    if (transaction.isRecurring) {
      document.getElementById('recurFreq').value = transaction.frequency || 'monthly';
      document.getElementById('recurDay').value = transaction.dayOfMonth || 1;
      toggleRecurOptions();
    } else {
      document.getElementById('recurOptions').classList.add('hidden');
    }

    // ✅ Couleur de validation par transaction
    setTransReconcileColor(transaction.reconcileColor || '');
    setTransactionColorScopeHint('Cette couleur s’applique uniquement à cette transaction. « D » utilise la couleur globale des paramètres.');

    // currency
    const curr = transaction.currency || settings.baseCurrency;
    document.getElementById('transCurrency') && (document.getElementById('transCurrency').value = curr);
    document.getElementById('transFxRate') && (document.getElementById('transFxRate').value = transaction.fxRate || '');
    toggleFxRate();

    // transfer target
    const transferGrp = document.getElementById('transferSavingsGroup');
    if (transferGrp) {
      if ((transaction.type||'') === 'transfer') transferGrp.classList.remove('hidden');
      else transferGrp.classList.add('hidden');
    }
    if (document.getElementById('transferSavingsTarget')) {
      document.getElementById('transferSavingsTarget').value = transaction.transferTarget || defaultSavingsTarget();
    }

  } else {
    document.getElementById('modalTitle').textContent = 'Nouvelle transaction';
    form.reset();
    document.getElementById('transDate').value = isoDate(today);
    document.getElementById('editId').value = '';
    document.getElementById('recurOptions').classList.add('hidden');
    document.getElementById('transMode') && (document.getElementById('transMode').value = settings.defaultMode || 'personal');
    document.getElementById('transCurrency') && (document.getElementById('transCurrency').value = settings.baseCurrency || 'EUR');
    toggleFxRate();
    toggleDebtSelect();
    const transferGrp = document.getElementById('transferSavingsGroup');
    if (transferGrp) transferGrp.classList.add('hidden');
    // ✅ Réinitialiser la couleur de validation sur "Défaut"
    setTransReconcileColor('');
    setTransactionColorScopeHint('Choisissez la couleur du symbole de validation de cette nouvelle transaction. « D » utilise la couleur globale.');
  }

  modal.classList.remove('hidden');
  renderFavoriteTagsInModal();
  setTimeout(()=>document.getElementById('transType')?.focus(),0);
}

function openModalById(id) {
  const t = transactions.find(x => String(x.id) === String(id));
  if (!t) return;
  if (t.linkedTransferId) {
    showToast('Ce transfert est lié à un autre compte. Supprimez-le puis recréez-le via « Entre comptes » pour conserver les deux écritures cohérentes.', 'info');
    return;
  }
  if (t.linkedDebtAccountId && String(t.linkedDebtAccountId) !== String(currentAccountId)) {
    showToast('Ce remboursement agit sur une dette d’un autre compte. Supprimez-le puis recréez-le via « Entre comptes » pour conserver la dette cohérente.', 'info');
    return;
  }
  // Si c'est une occurrence auto d'une règle récurrente, ouvrir la règle parente
  if (t.parentId) {
    const rule = recurringTransactions.find(r => String(r.id) === String(t.parentId));
    if (rule) { openRecurringRuleModal(rule, t); return; }
  }
  openModal(t);
}

// Ouvre le modal pré-rempli pour modifier une RÈGLE récurrente (pas une occurrence)
function openRecurringRuleModal(rule, occurrence=null) {
  lastFocusedEl = document.activeElement;
  const modal = document.getElementById('transactionModal');
  const form  = document.getElementById('transactionForm');
  if (!modal || !form) return;

  populateCategorySelects();
  refreshSavingsSelect();
  refreshDebtSelect();

  document.getElementById('modalTitle').textContent = occurrence ? 'Modifier cette récurrente' : 'Modifier la récurrente';
  // On stocke l'id de la RÈGLE dans editId — préfixé pour le distinguer
  document.getElementById('editId').value = '__rule__' + String(rule.id);
  document.getElementById('transType').value = rule.type || 'expense';
  document.getElementById('transCategory').value = rule.category || 'Autre';
  document.getElementById('transAmount').value = rule.originalAmount ?? rule.amount;
  document.getElementById('transDate').value = occurrence?.date || rule.startDate || isoDate(getToday());
  document.getElementById('transDesc').value = rule.desc || '';
  document.getElementById('transTags') && (document.getElementById('transTags').value = (rule.tags||[]).join(', '));
  document.getElementById('transMode') && (document.getElementById('transMode').value = rule.mode || settings.defaultMode || 'personal');
  setupRecurringDateScopeContext(occurrence);
  const ruleDateEl = document.getElementById('editRuleOriginalDate');
  if (ruleDateEl) ruleDateEl.value = rule.startDate || '';

  if (rule.linkedDebtId && document.getElementById('transLinkedDebt')) {
    document.getElementById('transLinkedDebt').value = rule.linkedDebtId;
  }
  toggleDebtSelect();

  // Cocher isRecurring et pré-remplir les options
  document.getElementById('isRecurring').checked = true;
  document.getElementById('recurFreq').value = rule.frequency || 'monthly';
  document.getElementById('recurDay').value = rule.dayOfMonth || 1;
  toggleRecurOptions();

  const isStoredOccurrence = Boolean(occurrence && !occurrence.projected);
  setTransReconcileColor(isStoredOccurrence ? (occurrence.reconcileColor || '') : (rule.reconcileColor || ''));
  if (isStoredOccurrence) {
    const dateLabel = occurrence.date ? new Date(`${occurrence.date}T12:00:00`).toLocaleDateString('fr-FR') : '';
    setTransactionColorScopeHint(`Cette couleur s’applique uniquement à la transaction${dateLabel ? ` du ${dateLabel}` : ''}. « D » utilise la couleur globale.`);
  } else {
    setTransactionColorScopeHint('Cette couleur devient la couleur par défaut de cette transaction récurrente. « D » utilise la couleur globale.');
  }

  const curr = rule.currency || settings.baseCurrency;
  document.getElementById('transCurrency') && (document.getElementById('transCurrency').value = curr);
  document.getElementById('transFxRate') && (document.getElementById('transFxRate').value = rule.fxRate || '');
  toggleFxRate();

  const transferGrp = document.getElementById('transferSavingsGroup');
  if (transferGrp) {
    if ((rule.type||'') === 'transfer') transferGrp.classList.remove('hidden');
    else transferGrp.classList.add('hidden');
  }
  if (document.getElementById('transferSavingsTarget')) {
    document.getElementById('transferSavingsTarget').value = rule.transferTarget || defaultSavingsTarget();
  }

  modal.classList.remove('hidden');
  renderFavoriteTagsInModal();
  setTimeout(()=>document.getElementById('transType')?.focus(), 0);
}

function closeModal() {
  document.getElementById('transactionModal')?.classList.add('hidden');
  document.getElementById('transactionForm')?.reset();
  document.getElementById('recurOptions')?.classList.add('hidden');
  resetRecurringDateScopeContext();
  if (lastFocusedEl?.focus) setTimeout(()=>lastFocusedEl.focus(), 0);
}

function toggleRecurOptions() {
  const el = document.getElementById('recurOptions');
  const chk = document.getElementById('isRecurring');
  if (!el || !chk) return;
  chk.checked ? el.classList.remove('hidden') : el.classList.add('hidden');
  updateRecurringFrequencyUI();
}

function updateRecurringFrequencyUI() {
  const frequency = document.getElementById('recurFreq')?.value || 'monthly';
  const dayGroup = document.getElementById('recurDayGroup');
  const hint = document.getElementById('recurFrequencyHint');
  if (dayGroup) dayGroup.classList.toggle('hidden', frequency !== 'monthly');
  if (!hint) return;
  if (frequency === 'weekly') hint.textContent = 'La transaction se répète le même jour de la semaine que la date de début.';
  else if (frequency === 'yearly') hint.textContent = 'La transaction se répète chaque année à la date de début (29 février ajusté si nécessaire).';
  else hint.textContent = 'Le dernier jour du mois est utilisé automatiquement si nécessaire.';
}

function handleTypeChange() {
  const type = document.getElementById('transType')?.value || 'expense';
  const transferGrp = document.getElementById('transferSavingsGroup');
  const hint = document.getElementById('transferSavingsHint');

  // Si inter-comptes sélectionné : fermer ce modal et ouvrir le bon
  if (type === 'inter_account') {
    closeModal();
    openInterAccountModal();
    return;
  }

  if (transferGrp) {
    if (type === 'transfer' || type === 'savings_withdrawal') {
      transferGrp.classList.remove('hidden');
      if (hint) {
        hint.textContent = type === 'transfer'
          ? 'Les transferts vers l\'épargne ne sont pas comptés comme des dépenses de consommation.'
          : 'Le montant sera retiré du livret sélectionné et ajouté à votre solde.';
      }
    } else {
      transferGrp.classList.add('hidden');
    }
  }
}

function saveTransaction(event) {
  event.preventDefault();

  const id = document.getElementById('editId').value;
  const type = document.getElementById('transType').value;
  const category = normalizeCategory(document.getElementById('transCategory').value);
  const amountInput = safeNumber(document.getElementById('transAmount').value, NaN);
  const date = document.getElementById('transDate').value;
  const desc = document.getElementById('transDesc').value || '';
  const tags = parseTags(document.getElementById('transTags')?.value || '');
  const mode = document.getElementById('transMode')?.value || (settings.defaultMode || 'personal');
  let linkedDebtId = document.getElementById('transLinkedDebt')?.value || null;

  const curr = document.getElementById('transCurrency')?.value || settings.baseCurrency;
  const fxRate = safeNumber(document.getElementById('transFxRate')?.value, NaN);

  const isRecurring = document.getElementById('isRecurring').checked;

  if (!Number.isFinite(amountInput) || amountInput <= 0) return showToast('Montant invalide', 'error');
  if (!date) return showToast('Date invalide', 'error');

  // Optional sanity: date too far in future
  const dt = new Date(date + 'T00:00:00');
  const maxFuture = new Date(); maxFuture.setFullYear(maxFuture.getFullYear() + 1);
  if (dt > maxFuture) {
    if (!confirm('Cette date est très dans le futur. Continuer ?')) return;
  }

  let amountBase = amountInput;
  if (curr !== settings.baseCurrency) {
    if (!Number.isFinite(fxRate) || fxRate <= 0) return showToast('Taux de change requis', 'error');
    amountBase = amountInput * fxRate;
  }
  amountBase = roundMoney(amountBase);

  // Si aucun remboursement n'est explicitement lié, mémoriser la première dette
  // encore ouverte afin que modification, suppression et annulation restent réversibles.
  if (category === 'Remboursement dette' && !linkedDebtId) {
    linkedDebtId = debts.find(d => (Number(d.remainingAmount ?? d.amount) || 0) > 0)?.id || null;
  }
  
  // ✅ DÉTECTION DE DOUBLONS : vérifier si une transaction similaire existe déjà
  if (!id && !isRecurring) { // Seulement pour les nouvelles transactions manuelles
    const tolerance = 0.01; // tolérance de 1 centime
    const duplicates = transactions.filter(t => 
      t.date === date &&
      t.type === type &&
      t.category === category &&
      Math.abs((Number(t.amountBase ?? t.amount) || 0) - amountBase) < tolerance
    );
    
    if (duplicates.length > 0) {
      const duplicate = duplicates[0];
      const isFromRecurring = duplicate.parentId ? ' (générée automatiquement)' : '';
      const msg = `⚠️ Une transaction similaire existe déjà pour cette date :\n\n` +
        `Type: ${duplicate.type}\n` +
        `Catégorie: ${duplicate.category}\n` +
        `Montant: ${formatCurrency(Number(duplicate.amountBase ?? duplicate.amount) || 0)}\n` +
        `Description: ${duplicate.desc || '-'}${isFromRecurring}\n\n` +
        `Voulez-vous quand même créer cette transaction ?`;
      
      if (!confirm(msg)) {
        return;
      }
    }
  }
  
  // TRANSFERT : ne pas compter comme dépense, mais mettre à jour l'épargne proprement
  let transferTarget = '';

  // Si on modifie une transaction existante : annuler exactement son effet précédent.
  // La fonction tient compte de la date et évite les doubles applications.
  const isEdit = !!id;
  const existing = isEdit ? transactions.find(t => String(t.id) === String(id)) : null;
  if (existing) revertOccurrenceSideEffects(existing);

  if (type === 'transfer' || type === 'savings_withdrawal') {
    transferTarget = document.getElementById('transferSavingsTarget')?.value || defaultSavingsTarget();
  }

  if (isRecurring) {
    const frequency = normalizeRecurringFrequency(document.getElementById('recurFreq').value);
    let dayOfMonth = parseInt(document.getElementById('recurDay').value, 10) || 1;

    // Déterminer si c'est une MISE À JOUR d'une règle existante ou une création
    // id peut être '__rule__<ruleId>' (édition via openRecurringRuleModal) ou un id classique
    let ruleId;
    let isRuleUpdate = false;
    if (id && id.startsWith('__rule__')) {
      ruleId = id.replace('__rule__', '');
      isRuleUpdate = true;
    } else if (id) {
      // Cas hérité : on vérif si l'id correspond à une règle existante
      const existingRule = recurringTransactions.find(r => String(r.id) === String(id));
      if (existingRule) { ruleId = id; isRuleUpdate = true; }
      else ruleId = id; // conversion manuelle → récurrente (cas rare)
    } else {
      ruleId = Date.now();
    }

    const before = recurringTransactions.find(r => String(r.id) === String(ruleId));
    const occurrenceId = document.getElementById('editOccurrenceId')?.value || '';
    const occurrencePeriodKey = document.getElementById('editOccurrencePeriodKey')?.value || '';
    const occurrenceOriginalDate = document.getElementById('editOccurrenceOriginalDate')?.value || '';
    const ruleOriginalDate = document.getElementById('editRuleOriginalDate')?.value || '';
    const selectedReconcileColor = (document.getElementById('transReconcileColor')?.dataset.customColor) || '';
    const occurrenceDateChanged = !!occurrenceOriginalDate && date !== occurrenceOriginalDate;
    const directRuleDateChanged = !occurrenceOriginalDate && !!ruleOriginalDate && date !== ruleOriginalDate;

    if (isRuleUpdate && before && occurrenceDateChanged && getRecurringDateScope() === 'single') {
      const changed = applySingleRecurringDateChange(before, occurrenceId, occurrencePeriodKey, occurrenceOriginalDate, date);
      if (!changed) return showToast('Occurrence récurrente introuvable', 'error');
      applyRecurringOccurrenceColorOverride(ruleId, occurrenceId, occurrencePeriodKey, date, selectedReconcileColor);
      saveData();
      closeModal();
      syncAllUI();
      showToast('Date modifiée seulement pour ce mois. Le montant reste inchangé.', 'success');
      return;
    }

    if (isRuleUpdate && (occurrenceDateChanged || directRuleDateChanged) && frequency === 'monthly') {
      const dateDay = parseInt(String(date).slice(8, 10), 10);
      if (Number.isFinite(dateDay) && dateDay >= 1 && dateDay <= 31) dayOfMonth = dateDay;
    }

    const ruleStartDate = occurrenceOriginalDate && !occurrenceDateChanged
      ? (before?.startDate || date)
      : date;

    const isSavingsWithdrawal = type === 'savings_withdrawal';
    const rule = {
      id: ruleId,
      type: isSavingsWithdrawal ? 'income' : type,
      fromSavings: isSavingsWithdrawal || undefined,
      category,
      amount: amountBase,
      amountBase,
      originalAmount: amountInput,
      currency: curr,
      fxRate: curr !== settings.baseCurrency ? fxRate : null,
      desc,
      tags,
      mode,
      transferTarget,
      frequency,
      dayOfMonth,
      startDate: ruleStartDate,
      isRecurring: true,
      linkedDebtId,
      reconcileColor: occurrenceId ? (before?.reconcileColor || '') : selectedReconcileColor,
      skippedPeriods: before?.skippedPeriods || [],
      createdAt: before?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const idx = recurringTransactions.findIndex(r => String(r.id) === String(rule.id));
    if (idx > -1) recurringTransactions[idx] = rule; else recurringTransactions.push(rule);
    logAction(idx > -1 ? 'update' : 'create', 'recurring', before, rule);

    if (isRuleUpdate) {
      // ✅ SÉCURITÉ : on ne reconstruit QUE les occurrences futures (mois courant inclus)
      // Les mois passés ne sont PAS touchés pour préserver les données historiques.
      rebuildOccurrencesForRuleFutureOnly(rule.id);
    } else {
      // Nouvelle règle ou conversion manuelle→récurrente : reconstruction complète
      if (id) {
        const origIdx = transactions.findIndex(t => String(t.id) === String(id) && !t.parentId);
        if (origIdx > -1) {
          transactions.splice(origIdx, 1);
        }
      }
      rebuildOccurrencesForRule(rule.id);
    }

    if (occurrenceId) {
      applyRecurringOccurrenceColorOverride(rule.id, occurrenceId, occurrencePeriodKey, date, selectedReconcileColor);
    }

  } else {
    // ✅ FIX savings_withdrawal : convertir en revenu + soustraire de l'épargne
    const isSavingsWithdrawal = type === 'savings_withdrawal';
    const tx = {
      id: id || (genId()),
      type: isSavingsWithdrawal ? 'income' : type,
      fromSavings: isSavingsWithdrawal || undefined,
      category,
      amount: amountBase,
      amountBase: amountBase,
      originalAmount: amountInput,
      currency: curr,
      fxRate: curr !== settings.baseCurrency ? fxRate : null,
      date,
      desc,
      tags,
      mode,
      transferTarget,
      isRecurring: false,
      // ✅ FIX : si l'utilisateur édite une occurrence récurrente (parentId présent),
      // on efface parentId et periodKey pour la rendre indépendante.
      parentId: '',
      periodKey: '',
      linkedDebtId,
      _effectsApplied: false,
      // ✅ Couleur de validation personnalisée par transaction
      reconcileColor: (document.getElementById('transReconcileColor')?.dataset.customColor) || ''
    };

    const before = transactions.find(t => String(t.id) === String(tx.id));
    const idx = transactions.findIndex(t => String(t.id) === String(tx.id));
    if (idx > -1) transactions[idx] = { ...transactions[idx], ...tx }; else transactions.push(tx);
    logAction(idx > -1 ? 'update' : 'create', 'transaction', before, tx);

    const effectsApplied = applyOccurrenceSideEffects(tx);
    if (effectsApplied && tx.type === 'transfer') logAction('transfer_to_savings', 'savings', { target: transferTarget }, { added: amountBase });
    if (effectsApplied && isSavingsWithdrawal) logAction('savings_withdrawal', 'savings', { target: transferTarget }, { removed: amountBase });
  }

  saveData();
  closeModal();
  syncAllUI();
  showToast('Enregistré', 'success');
}

let lastDeleted = null;
function deleteTransaction(id) {
  const idx = transactions.findIndex(t => String(t.id) === String(id));
  if (idx === -1) return;

  if (transactions[idx]?.linkedTransferId && deleteLinkedTransferPair(id)) return;

  // Une occurrence récurrente supprimée devient une exception de la série ;
  // elle ne réapparaîtra donc pas lors de la prochaine synchronisation.
  if (transactions[idx]?.parentId && skipRecurringOccurrenceById(id)) return;

  const removed = transactions.splice(idx, 1)[0];
  revertOccurrenceSideEffects(removed);
  lastDeleted = { item: removed, index: idx, ts: Date.now() };
  logAction('delete', 'transaction', removed, null);
  saveData();
  syncAllUI();

  showToast('Transaction supprimée', 'neutral', true, () => {
    if (!lastDeleted) return;
    transactions.splice(lastDeleted.index, 0, lastDeleted.item);
    applyOccurrenceSideEffects(lastDeleted.item);
    logAction('undo_delete', 'transaction', null, lastDeleted.item);
    lastDeleted = null;
    saveData();
    syncAllUI();
    showToast('Suppression annulée', 'success');
  });
}

// Remove and regenerate occurrences for a given recurring rule (keeps savings consistent)
function rebuildOccurrencesForRule(ruleId) {
  const occ = transactions.filter(t => String(t.parentId || '') === String(ruleId));
  occ.forEach(revertOccurrenceSideEffects);
  transactions = transactions.filter(t => String(t.parentId || '') !== String(ruleId));
  generateRecurringOccurrences();
  // saveData() est appelé par l'appelant (saveTransaction → saveData)
}

// ✅ SÉCURITÉ MOIS PASSÉS : reconstruit UNIQUEMENT les occurrences non verrouillées
// du mois courant et futur. Les occurrences passées ou validées par l'utilisateur
// sont conservées telles quelles (historique protégé).
function rebuildOccurrencesForRuleFutureOnly(ruleId) {
  const todayStr = isoDate(getToday());
  const currentMonthStr = todayStr.slice(0, 7); // 'YYYY-MM'

  // Supprimer uniquement les occurrences non protégées du mois courant et des mois futurs
  const toRemove = transactions.filter(t => {
    if (String(t.parentId || '') !== String(ruleId)) return false;
    const txMonth = (t.date || '').slice(0, 7);
    return txMonth >= currentMonthStr && !isUserProtectedOccurrence(t);
  });
  toRemove.forEach(revertOccurrenceSideEffects);
  transactions = transactions.filter(t => {
    if (String(t.parentId || '') !== String(ruleId)) return true;
    const txMonth = (t.date || '').slice(0, 7);
    return txMonth < currentMonthStr || isUserProtectedOccurrence(t); // garder les mois passés + validés
  });

  // Régénérer uniquement les périodes qui restent manquantes à partir du mois courant
  generateRecurringOccurrences();
}

function applySingleRecurringDateChange(rule, occurrenceId, occurrencePeriodKey, originalDate, newDate) {
  if (!rule || !newDate) return false;

  const frequency = rule.frequency || 'monthly';
  const key = occurrencePeriodKey || (originalDate ? periodKey(originalDate, frequency) : '');
  if (!key) return false;

  let tx = transactions.find(t => String(t.id) === String(occurrenceId || ''));
  if (!tx) {
    tx = transactions.find(t => {
      if (String(t.parentId || '') !== String(rule.id)) return false;
      const txKey = t.periodKey || (t.date ? periodKey(t.date, frequency) : '');
      return txKey === key;
    });
  }

  if (!tx) {
    tx = buildRecurringOccurrence(rule, originalDate || newDate, { periodKey: key });
    transactions.push(tx);
  }

  const before = JSON.parse(JSON.stringify(tx));
  revertOccurrenceSideEffects(tx);
  tx.date = newDate;
  tx.parentId = rule.id;
  tx.periodKey = key;
  tx.source = 'recurring';
  tx.isRecurring = false;
  tx._manuallyEdited = true;
  tx._dateOverride = true;
  tx._effectsApplied = false;
  applyOccurrenceSideEffects(tx);

  logAction('update_date_single', 'transaction', before, tx);
  return true;
}
