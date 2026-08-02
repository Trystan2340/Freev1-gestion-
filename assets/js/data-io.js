// ---------- Export/Import JSON (multi-comptes complet) ----------

// Neutralise les cellules qu'Excel pourrait interpréter comme des formules.
function spreadsheetSafeRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value !== 'string' || !/^[=+\-@\t\r]/.test(value.trimStart())) return [key, value];
    return [key, `'${value}`];
  })));
}

function exportAllAccountsJSON() {
  // ✅ FIX Multi-comptes : exporter TOUS les comptes + leur configuration
  saveCurrentGlobalsToAccount();
  const payload = {
    schemaVersion: '2026-multi-v2',
    exportedAt: new Date().toISOString(),
    accounts,
    currentAccountId,
    multiViewMode,
    selectedGroupIds: [...selectedGroupIds],
    customCategories: customCategories || [],
    uiSettings: uiSettings || {},
    savingsMeta: savingsMeta || {}
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const name = `freev-sauvegarde-${isoDate(getToday())}.json`;
  downloadBlob(name, blob);
  showToast(`Sauvegarde complète exportée (${accounts.length} compte(s))`, 'success');
}

function importAllAccountsJSON(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);

      // Validation stricte du fichier
      try {
        validateImportData(parsed);
      } catch(validErr) {
        showToast(`Import annulé : ${validErr.message}`, 'error');
        input.value = '';
        return;
      }

      const count = parsed.accounts.length;
      const totalTx = parsed.accounts.reduce((s, a) => s + (a.transactions || []).length, 0);

      if (!confirm(`Importer ${count} compte(s) avec ${totalTx} transactions ?\n\n⚠️ Cela REMPLACE tous vos comptes actuels.\nUn backup automatique sera fait avant l'import.`)) {
        input.value = '';
        return;
      }

      // Backup automatique avant import
      autoBackupSilent();

      accounts = parsed.accounts.map(a => ({ ...createAccountObj(a.name, a.id), ...a }));
      currentAccountId = parsed.currentAccountId;
      multiViewMode = parsed.multiViewMode || 'individual';
      selectedGroupIds = new Set(parsed.selectedGroupIds || []);
      customCategories = parsed.customCategories || [];
      uiSettings = { fabColor: '#10b981', reconcileColor: DEFAULT_RECONCILE_COLOR, ...(parsed.uiSettings || {}) };
      savingsMeta = parsed.savingsMeta || {};

      // Vérifier validité du compte courant
      if (!accounts.find(a => a.id === currentAccountId)) currentAccountId = accounts[0]?.id;

      // Migrer les dettes
      accounts.forEach(acc => {
        (acc.debts || []).forEach(debt => {
          if (debt.remainingAmount === undefined) debt.remainingAmount = debt.amount;
          if (debt.initialAmount === undefined) debt.initialAmount = debt.amount;
        });
      });

      loadCurrentAccountIntoGlobals();
      generateRecurringOccurrences();
      saveAccountSystem();
      syncAllUI(true);
      renderAccountsSidebar();
      updateViewModeUI();
      showToast(`${count} compte(s) importé(s) avec succès`, 'success');
    } catch(err) {
      console.error(err);
      showToast('Erreur lors de l\'import JSON : fichier corrompu ou format invalide', 'error');
    }
    input.value = '';
  };
  reader.readAsText(file);
}


async function exportToExcel() {
  // ✅ Avertir l'utilisateur si plusieurs comptes existent
  if (accounts.length > 1) {
    const accName = getCurrentAccount()?.name || 'compte actif';
    if (!confirm(`⚠️ L'export Excel ne contient que les données du compte "${accName}".\n\nPour sauvegarder TOUS vos comptes, utilisez le bouton "Sauvegarder tout (JSON)".\n\nContinuer l'export Excel ?`)) return;
  }
  try {
    showToast('Chargement du module Excel…', 'info');
    await ensureXLSX();
    const wb = XLSX.utils.book_new();

    // Meta
    const wsMeta = XLSX.utils.aoa_to_sheet([
      ['app','Freev Valeur'],
      ['appVersion', APP_VERSION],
      ['schemaVersion', SCHEMA_VERSION],      ['exportedAt', new Date().toISOString()],
    ]);
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Meta');

    // Settings
    const wsParams = XLSX.utils.aoa_to_sheet([
      ['Devise de base', settings.baseCurrency || 'EUR'],
      ['Mode par défaut', settings.defaultMode || 'personal'],
      ['Capital initial', initialCapital],
      ['Budget mensuel', monthlyBudget]
    ]);
    XLSX.utils.book_append_sheet(wb, wsParams, 'Paramètres');

    // Budgets by category
    const wsBud = XLSX.utils.aoa_to_sheet([['Catégorie','Budget']]);
    const budRows = Object.entries(budgetsByCategory||{}).map(([k,v])=>({ 'Catégorie':k, 'Budget':v }));
    if (budRows.length) XLSX.utils.sheet_add_json(wsBud, spreadsheetSafeRows(budRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsBud, 'Budgets');

    // Savings
    const wsSav = XLSX.utils.aoa_to_sheet([['Livret','Montant']]);
    const savRows = Object.entries(savingsAccounts||{}).map(([k,v])=>({Livret:k, Montant:v}));
    if (savRows.length) XLSX.utils.sheet_add_json(wsSav, spreadsheetSafeRows(savRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsSav, 'Épargne');

    // Recurring
    const wsRecur = XLSX.utils.aoa_to_sheet([['ID','Type','Catégorie','MontantBase','Devise','MontantOriginal','FxRate','Fréquence','Jour','Date début','Description','Mode','Tags','TransfertCible','RetraitEpargne','DetteLiee','CouleurValidation','OccurrencesIgnorees']]);
    const recurRows = recurringTransactions.map(r=>({
      ID:r.id,
      Type:r.type,
      'Catégorie':r.category,
      MontantBase:Number(r.amountBase ?? r.amount ?? 0),
      Devise:r.currency||settings.baseCurrency,
      MontantOriginal:Number(r.originalAmount ?? r.amount ?? 0),
      FxRate:r.fxRate||'',
      'Fréquence':r.frequency,
      Jour:r.dayOfMonth,
      'Date début':r.startDate,
      Description:r.desc||'',
      Mode:r.mode||'personal',
      Tags:(r.tags||[]).join(', '),
      TransfertCible:r.transferTarget||'',
      RetraitEpargne:r.fromSavings?'oui':'',
      DetteLiee:r.linkedDebtId||'',
      CouleurValidation:r.reconcileColor||'',
      OccurrencesIgnorees:(r.skippedPeriods||[]).join(',')
    }));
    if (recurRows.length) XLSX.utils.sheet_add_json(wsRecur, spreadsheetSafeRows(recurRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsRecur, 'Récurrentes');

    // Transactions
    const wsTx = XLSX.utils.aoa_to_sheet([['ID','Date','Type','Catégorie','MontantBase','Devise','MontantOriginal','FxRate','Mode','Tags','Note','ParentID','PeriodKey','TransfertCible','Verifie','CouleurValidation','Source','RetraitEpargne','DetteLiee','CompteDetteLiee','MontantDetteLiee','TransfertLie','CompteLie','RoleTransfert','TauxTransfert','EffetsAppliques','ModifieManuellement']]);
    const txRows = transactions.filter(t=>!t.isRecurring).map(t=>({
      ID:t.id,
      Date:t.date,
      Type:t.type,
      'Catégorie':t.category,
      MontantBase:Number(t.amountBase ?? t.amount ?? 0),
      Devise:t.currency||settings.baseCurrency,
      MontantOriginal:Number(t.originalAmount ?? t.amount ?? 0),
      FxRate:t.fxRate||'',
      Mode:t.mode||'personal',
      Tags:(t.tags||[]).join(', '),
      Note:t.desc||'',
      ParentID:t.parentId||'',
      PeriodKey:t.periodKey||'',
      TransfertCible:t.transferTarget||'',
      Verifie:t.reconciled ? 'oui' : '',
      CouleurValidation:t.reconcileColor||'',
      Source:t.source||'manual',
      RetraitEpargne:t.fromSavings?'oui':'',
      DetteLiee:t.linkedDebtId||'',
      CompteDetteLiee:t.linkedDebtAccountId||'',
      MontantDetteLiee:t.linkedDebtAmount||'',
      TransfertLie:t.linkedTransferId||'',
      CompteLie:t.linkedAccountId||'',
      RoleTransfert:t.linkedTransferRole||'',
      TauxTransfert:t.linkedTransferRate||'',
      EffetsAppliques:t._effectsApplied===true?'oui':(t._effectsApplied===false?'non':''),
      ModifieManuellement:t._manuallyEdited?'oui':''
    }));
    if (txRows.length) XLSX.utils.sheet_add_json(wsTx, spreadsheetSafeRows(txRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions');

    // Debts
    const wsDebt = XLSX.utils.aoa_to_sheet([['ID','Date','Personne','Direction','MontantInitial','MontantRestant','DateDebut','DateFin','Note']]);
    const dRows = debts.map(d=>({
      ID: d.id,
      Date: d.date,
      Personne: d.person,
      Direction: d.direction,
      MontantInitial: Number(d.initialAmount ?? d.amount) || 0,
      MontantRestant: Number(d.remainingAmount ?? d.amount) || 0,
      DateDebut: d.startDate || '',
      DateFin: d.endDate || '',
      Note: d.note || ''
    }));
    if (dRows.length) XLSX.utils.sheet_add_json(wsDebt, spreadsheetSafeRows(dRows), {origin:'A2', skipHeader:true});
    XLSX.utils.book_append_sheet(wb, wsDebt, 'Dettes');

    XLSX.writeFile(wb, `Freev_Export_ULTRA_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast('Export Excel réussi', 'success');

  } catch(e) {
    console.error(e);
    showToast('Erreur export Excel', 'error');
  }
}

async function importFromExcel(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    showToast('Chargement du module Excel…', 'info');
    await ensureXLSX();
  } catch (error) {
    console.error(error);
    showToast('Module Excel indisponible. Vérifiez votre connexion.', 'error');
    input.value = '';
    return;
  }
  const mode = prompt('Import Excel : 1=REMPLACER, 2=FUSIONNER', '1');
  const merge = String(mode||'1').trim()==='2';

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type:'array' });
      const names = wb.SheetNames.map(n=>n.toLowerCase());
      const find = (k) => {
        const idx = names.findIndex(n=>n.includes(k));
        return idx>=0 ? wb.SheetNames[idx] : null;
      };

      const txSheet = find('transac');
        if (!txSheet) {
          showToast('Feuille Transactions introuvable dans le fichier Excel', 'error');
          return;
        }
      const wsTx = wb.Sheets[txSheet];
      const txJson = XLSX.utils.sheet_to_json(wsTx, { defval:'' });

      const excelDateToISO = (val) => {
        if (typeof val === 'number' && !isNaN(val)) {
          const d = XLSX.SSF.parse_date_code(val);
          if (d && d.y && d.m && d.d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
        }
        if (typeof val === 'string') {
          const s = val.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
        }
        return '';
      };

      const excelBoolean = value => ['1', 'oui', 'yes', 'true', 'vrai'].includes(String(value ?? '').trim().toLowerCase());

      const importedTx = txJson.map(r => {
        const date = excelDateToISO(r.Date || r.date);
        const currency = String(r.Devise || settings.baseCurrency || 'EUR');
        const fxRate = r.FxRate ? safeNumber(r.FxRate, null) : null;

        // ✅ FIX Cohérence amount/amountBase avec fxRate :
        // Priorité : MontantBase (déjà en devise de base)
        // Sinon : si fxRate présent ET devise ≠ base → Montant * fxRate
        // Sinon : Montant tel quel (déjà en devise de base)
        const rawAmount = safeNumber(r.MontantOriginal ?? r['Montant original'] ?? r.Montant ?? r.Amount ?? 0, 0);
        let amountBase;
        if (r.MontantBase !== undefined && r.MontantBase !== '') {
          amountBase = safeNumber(r.MontantBase, rawAmount);
        } else if (fxRate && Number.isFinite(fxRate) && fxRate > 0 && currency !== (settings.baseCurrency || 'EUR')) {
          amountBase = roundMoney(rawAmount * fxRate);
        } else {
          amountBase = rawAmount;
        }
        const originalAmount = rawAmount || amountBase;
        const type = normalizeType(r.Type || r.type);
        return {
          id: r.ID || (genId()),
          date,
          type,
          category: normalizeCategory(r.Catégorie || r.Categorie || r.Category || r.category),
          amount: amountBase,
          amountBase: amountBase,
          originalAmount,
          currency,
          fxRate: fxRate,
          mode: (String(r.Mode||'personal').toLowerCase().includes('bus') ? 'business' : (String(r.Mode||'personal').toLowerCase().includes('pro') ? 'business' : (r.Mode || settings.defaultMode || 'personal'))),
          tags: parseTags(r.Tags || ''),
          desc: r.Note || r.Description || r.desc || '',
          parentId: r.ParentID || '',
          periodKey: r.PeriodKey || '',
          transferTarget: r.TransfertCible || r.TransferTarget || '',
          reconciled: excelBoolean(r.Verifie),
          reconcileColor: r.CouleurValidation || '',
          source: r.Source || (r.ParentID ? 'recurring' : 'manual'),
          fromSavings: excelBoolean(r.RetraitEpargne) || undefined,
          linkedDebtId: r.DetteLiee || null,
          linkedDebtAccountId: r.CompteDetteLiee || '',
          linkedDebtAmount: r.MontantDetteLiee ? safeNumber(r.MontantDetteLiee, null) : null,
          linkedTransferId: r.TransfertLie || '',
          linkedAccountId: r.CompteLie || '',
          linkedTransferRole: r.RoleTransfert || '',
          linkedTransferRate: r.TauxTransfert ? safeNumber(r.TauxTransfert, null) : null,
          _effectsApplied: String(r.EffetsAppliques || '').trim() ? excelBoolean(r.EffetsAppliques) : undefined,
          _manuallyEdited: excelBoolean(r.ModifieManuellement) || undefined,
          isRecurring: false
        };
      }).filter(t => t.date && Number(t.amount) > 0);

      // other sheets
      const paramsSheet = find('param');
      let importedCapital=null, importedBudget=null, importedBaseCurrency=null, importedDefaultMode=null;
      if (paramsSheet) {
        const wsP = wb.Sheets[paramsSheet];
        const rows = XLSX.utils.sheet_to_json(wsP, { header:1, defval:'' });
        rows.forEach(r => {
          const k = String(r[0]||'').toLowerCase();
          if (k.includes('capital')) importedCapital = safeNumber(r[1], null);
          if (k.includes('budget')) importedBudget = safeNumber(r[1], null);
          if (k.includes('devise')) importedBaseCurrency = String(r[1]||'').trim();
          if (k.includes('mode')) importedDefaultMode = String(r[1]||'').trim();
        });
      }

      const savSheet = find('épargne') || find('epargne');
      let importedSavings=null;
      if (savSheet) {
        const wsS=wb.Sheets[savSheet];
        const jsonS=XLSX.utils.sheet_to_json(wsS, {defval:''});
        const obj={};
        jsonS.forEach(r=>{
          const key=String(r.Livret||r.Compte||r.Account||'').trim();
          const val=safeNumber(r.Montant||r.Amount||0, NaN);
          if (key && Number.isFinite(val)) obj[key]=val;
        });
        if (Object.keys(obj).length) importedSavings=obj;
      }

      const recurSheet = find('récurrent') || find('recurrent');
      let importedRecur=null;
      if (recurSheet) {
        const wsR=wb.Sheets[recurSheet];
        const jsonR=XLSX.utils.sheet_to_json(wsR, {defval:''});
        importedRecur = jsonR.map(r=>{
          const amountBase = safeNumber(r.MontantBase ?? r.Montant ?? 0, 0);
          const fromSavings = excelBoolean(r.RetraitEpargne);
          return {
            id: r.ID || (genId()),
            type: fromSavings ? 'income' : normalizeType(r.Type||r.type),
            fromSavings: fromSavings || undefined,
            category: normalizeCategory(r['Catégorie']||r.Catégorie||r.category),
            amount: amountBase,
            amountBase,
            originalAmount: safeNumber(r.MontantOriginal ?? amountBase, amountBase),
            currency: r.Devise || settings.baseCurrency || 'EUR',
            fxRate: r.FxRate ? safeNumber(r.FxRate, null) : null,
            frequency: normalizeRecurringFrequency(String(r['Fréquence']||r.Frequence||r.frequency||'monthly')),
            dayOfMonth: Math.max(1, Math.min(31, parseInt(r.Jour||1,10)||1)),
            startDate: excelDateToISO(r['Date début']||r['Date debut']||r.startDate||r.Date),
            mode: (String(r.Mode||settings.defaultMode||'personal').toLowerCase().includes('bus')?'business':(r.Mode||settings.defaultMode||'personal')),
            tags: parseTags(r.Tags||''),
            desc: r.Description||r.Note||'',
            transferTarget: r.TransfertCible||'',
            linkedDebtId: r.DetteLiee||null,
            reconcileColor: r.CouleurValidation||'',
            skippedPeriods: String(r.OccurrencesIgnorees||'').split(',').map(item=>item.trim()).filter(Boolean),
            isRecurring:true
          };
        }).filter(r=>r.amount>0 && r.startDate);
        if (!importedRecur.length) importedRecur=null;
      }

      const debtSheet = find('dette');
      let importedDebts=null;
      if (debtSheet) {
        const wsD=wb.Sheets[debtSheet];
        const jsonD=XLSX.utils.sheet_to_json(wsD, {defval:''});
        importedDebts = jsonD.map(r => {
          const initial = safeNumber(r.MontantInitial ?? r.Montant ?? 0, 0);
          const remaining = safeNumber(r.MontantRestant ?? r.MontantInitial ?? r.Montant ?? 0, 0);
          return {
            id: r.ID || (genId()),
            date: excelDateToISO(r.Date || r.date),
            person: r.Personne || r.person || '',
            direction: r.Direction || r.direction || 'they_owe_me',
            amount: initial,
            initialAmount: initial,
            remainingAmount: remaining,
            startDate: r.DateDebut || r.startDate || '',
            endDate: r.DateFin || r.endDate || '',
            note: r.Note || ''
          };
        }).filter(d => d.person && d.amount > 0 && d.date);
        if (!importedDebts.length) importedDebts=null;
      }

      // Apply
      if (!merge) {
        transactions = importedTx;
        if (importedRecur) recurringTransactions = importedRecur;
        if (importedSavings) savingsAccounts = importedSavings;
        if (importedDebts) debts = importedDebts;
        if (importedCapital !== null) initialCapital = importedCapital;
        if (importedBudget !== null) monthlyBudget = importedBudget;
        if (importedBaseCurrency) settings.baseCurrency = importedBaseCurrency;
        if (importedDefaultMode) settings.defaultMode = importedDefaultMode;
      } else {
        const mapTx = new Map(transactions.map(t=>[String(t.id), t]));
        importedTx.forEach(t=>mapTx.set(String(t.id), t));
        transactions = Array.from(mapTx.values());

        if (importedRecur) {
          const mapR = new Map(recurringTransactions.map(r=>[String(r.id), r]));
          importedRecur.forEach(r=>mapR.set(String(r.id), r));
          recurringTransactions = Array.from(mapR.values());
        }
        if (importedSavings) savingsAccounts = { ...(savingsAccounts||{}), ...importedSavings };
        if (importedDebts) debts = [...(debts||[]), ...importedDebts];

        if (importedCapital !== null) initialCapital = importedCapital;
        if (importedBudget !== null) monthlyBudget = importedBudget;
        if (importedBaseCurrency) settings.baseCurrency = importedBaseCurrency;
        if (importedDefaultMode) settings.defaultMode = importedDefaultMode;
      }

      generateRecurringOccurrences();

      // ✅ FIX : logique de reconstruction de l'épargne corrigée
      //
      // PROBLÈME PRÉCÉDENT : en mode REMPLACER, on faisait toujours savingsAccounts = {}
      // puis on recalculait depuis les transferts — ce qui ignorait les livrets alimentés
      // MANUELLEMENT via "Gérer l'épargne" (ajouts directs sans transaction de transfert).
      //
      // NOUVELLE LOGIQUE :
      // • Feuille "Épargne" présente dans l'Excel → utiliser ces soldes directement
      //   (ils représentent l'état final exporté, incluant les ajouts manuels ET transferts)
      // • Feuille "Épargne" absente → reconstruire depuis les transferts (fallback)
      const todayStr = isoDate(getToday());
      if (!merge) {
        if (importedSavings && Object.keys(importedSavings).length > 0) {
          // Cas normal : la feuille Épargne est présente → soldes exacts du fichier
          savingsAccounts = { ...importedSavings };
        } else {
          // Fallback : pas de feuille Épargne → reconstruire depuis les transferts
          savingsAccounts = {};
          transactions
            .filter(t => t.type === 'transfer' && !t.isRecurring && (t.date || '') <= todayStr)
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
            .forEach(t => applyTransferToSavings(t.transferTarget || defaultSavingsTarget(), Number(t.amountBase ?? t.amount) || 0));
        }
      } else {
        // Mode FUSIONNER : appliquer uniquement les nouveaux transferts importés
        importedTx
          .filter(t => t.type === 'transfer' && (t.date || '') <= todayStr)
          .forEach(t => applyTransferToSavings(t.transferTarget || defaultSavingsTarget(), Number(t.amount) || 0));
      }

      saveData();
      syncAllUI();
      showToast('Import Excel réussi', 'success');

    } catch(err) {
      console.error(err);
      showToast('Erreur import Excel', 'error');
    }
    input.value='';
  };

  reader.readAsArrayBuffer(file);
}

// ---------- PDF export (month report) — ouvre rapport-mensuel.html ----------
function exportToPDF() {
  const month = document.getElementById('globalMonthPicker')?.value || isoMonth();
  const accId = (multiViewMode === 'individual') ? (currentAccountId || '') : '__all__';
  const params = new URLSearchParams({ month, account: accId });
  window.open('rapport-mensuel.html?' + params.toString(), '_blank');
}

// ---------- Rapprochement bancaire ----------
function toggleReconcile(id, accountId='') {
  let t = null;
  if (accountId) {
    const acc = accounts.find(a => String(a.id) === String(accountId));
    t = (acc?.transactions || []).find(x => String(x.id) === String(id));
  }
  if (!t) t = transactions.find(x => String(x.id) === String(id));
  if (!t) return;
  t.reconciled = !t.reconciled;
  if (t.reconciled && t.reconcileColor === undefined) t.reconcileColor = '';
  logAction(t.reconciled ? 'reconcile' : 'unreconcile', 'transaction', null, { id, accountId });
  saveData();
  if (currentView === 'transactions') renderAllTransactions();
  if (currentView === 'dashboard') renderRecentTransactions();
  showToast(t.reconciled ? 'Transaction vérifiée ✓' : 'Vérification annulée', t.reconciled ? 'success' : 'neutral');
}


function validateImportData(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Format invalide : fichier non reconnu');
  if (!Array.isArray(parsed.accounts)) throw new Error('Champ "accounts" manquant ou invalide');
  if (parsed.accounts.length === 0) throw new Error('Le fichier ne contient aucun compte');
  parsed.accounts.forEach((acc, i) => {
    if (!acc.id || !acc.name) throw new Error(`Compte #${i + 1} invalide (id ou nom manquant)`);
    if (!Array.isArray(acc.transactions)) throw new Error(`Transactions manquantes sur le compte "${acc.name}"`);
  });
  return true;
}


function setupShortcuts() {
  window.addEventListener('keydown', (e) => {
    // '+' opens modal
    if (e.key === '+' || (e.key === '=' && e.shiftKey)) {
      e.preventDefault();
      openModal();
      return;
    }

    // Ctrl+F focuses search (in transactions)
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      const s = document.getElementById('txSearch');
      if (s) { e.preventDefault(); switchView('transactions'); setTimeout(()=>s.focus(), 0); }
    }

    // Ctrl+Shift+S export Excel
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      exportToExcel();
    }

    // Escape closes modals
    if (e.key === 'Escape') {
      ['transactionModal','budgetModal','capitalModal','savingsModal','debtModal','interAccountModal','accountsModal'].forEach(id => {
        const m = document.getElementById(id);
        if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
      });
    }
  });
}

// ---------- Mobile sidebar ----------
function setupSidebarToggle() {
  const sidebar = document.querySelector('.sidebar');
  const btn = document.getElementById('sidebarToggle');

  // show button on small screens
  const update = () => {
    const small = window.innerWidth <= 768;
    if (btn) btn.style.display = small ? 'inline-flex' : 'none';
  };
  window.addEventListener('resize', update);
  update();

  if (btn && sidebar) {
    btn.addEventListener('click', () => {
      const isOpen = sidebar.classList.contains('open');
      isOpen ? closeSidebarMobile() : openSidebarMobile();
    });
  }
}

// ---------- Month picker change ----------
function onMonthPickerChange() {
  // When user selects a month directly, ensure recurring occurrences exist for that period
  generateRecurringOccurrences();
  syncAllUI();
}

// ---------- Month navigation ----------
function changeMonth(offset) {
  const input = document.getElementById('globalMonthPicker');
  const cur = (input?.value || isoMonth());
  const parts = cur.split('-').map(Number);
  const y = parts[0] || new Date().getFullYear();
  const m = parts[1] || (new Date().getMonth() + 1);
  const date = new Date(y, m - 1, 1); // local-safe
  date.setMonth(date.getMonth() + offset);
  if (input) input.value = isoMonth(date);
  generateRecurringOccurrences();
  syncAllUI();
}

// ---------- Utility refresh ----------
// ✅ FIX Performance : syncAllUI ne redessine que la vue active,
// ce qui était déjà le cas — on ajoute en plus un debounce pour éviter
// les appels en rafale (ex: sauvegarde qui appelait syncAllUI plusieurs fois de suite).
let _syncTimer = null;
function syncAllUI(immediate = false) {
  if (immediate) {
    _doSyncAllUI();
  } else {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_doSyncAllUI, 16); // un seul rendu par frame (≈60fps)
  }
}

function _doSyncAllUI() {
  refreshSavingsSelect();
  refreshCategoryFilter();
  populateCategorySelects(); // ✅ Rafraîchit les catégories perso après changement de compte

  if (currentView === 'transactions') renderAllTransactions();
  if (currentView === 'recurring') renderRecurringList();
  if (currentView === 'analytics') setTimeout(() => renderAnalytics(), 0);
  if (currentView === 'planner') window.FreevV4?.render?.();
  if (currentView === 'savings') renderSavingsList();
  if (currentView === 'debts') renderDebts();
  if (currentView === 'history') renderHistory();
  if (currentView === 'settings') { loadSettingsUI(); renderDataHealth(); }

  // Les graphiques sont coûteux sur mobile : ne pas les recréer lorsqu'ils sont cachés.
  if (currentView === 'dashboard') updateDashboard();
  renderAccountsSidebar();
}

// Mise à jour légère : uniquement le dashboard et la sidebar (pas les listes)
// Utilisée après des actions simples (ex: changement de capital, budget)
function syncDashboard() {
  updateDashboard();
  renderAccountsSidebar();
}



// ---------- Duplicate month ----------
function duplicateMonthPrompt() {
  const from = prompt('Dupliquer depuis quel mois ? (YYYY-MM)', document.getElementById('globalMonthPicker')?.value || isoMonth());
  if (!from) return;
  const to = prompt('Dupliquer vers quel mois ? (YYYY-MM)', document.getElementById('globalMonthPicker')?.value || isoMonth());
  if (!to) return;
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    showToast('Format mois invalide', 'error');
    return;
  }
  if (from === to) {
    showToast('Les mois sont identiques', 'info');
    return;
  }
  const ok = confirm(`Dupliquer les transactions manuelles de ${from} vers ${to} ?`);
  if (!ok) return;
  const count = duplicateMonth(from, to);
  saveData();
  syncAllUI();
  showToast(`${count} transaction(s) dupliquée(s)`, 'success');
}

function duplicateMonth(fromMonth, toMonth) {
  const fromList = transactions.filter(t => !t.isRecurring && (t.date || '').startsWith(fromMonth) && !t.parentId);

  // determine last day of target month
  const [y, m] = toMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();

  let created = 0;
  fromList.forEach(t => {
    const day = parseInt(String(t.date).slice(8,10), 10) || 1;
    const dd = String(Math.min(day, lastDay)).padStart(2,'0');
    const newDate = `${toMonth}-${dd}`;

    // avoid duplicates with same date+amount+category+desc
    const signature = `${newDate}|${t.type}|${t.category}|${Number(t.amountBase ?? t.amount)}|${t.desc||''}`;
    const exists = transactions.some(x => `${x.date}|${x.type}|${x.category}|${Number(x.amountBase ?? x.amount)}|${x.desc||''}` === signature);
    if (exists) return;

    const copy = {
      ...t,
      id: genId(),
      date: newDate,
      desc: (t.desc || '') + ' (mois dupliqué)',
      parentId: '',
      periodKey: '',
      linkedTransferId: '',
      linkedAccountId: '',
      linkedTransferRole: '',
      linkedTransferRate: null,
      source: 'manual',
      reconciled: false,
      _effectsApplied: false
    };
    transactions.push(copy);
    applyOccurrenceSideEffects(copy);
    logAction('duplicate_month', 'transaction', t, copy);
    created++;
  });
  return created;
}
