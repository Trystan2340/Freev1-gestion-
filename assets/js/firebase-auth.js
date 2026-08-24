
(async function bootFirebaseIntegration() {
let initializeApp;
let getAuth;
let onAuthStateChanged;
let createUserWithEmailAndPassword;
let signInWithEmailAndPassword;
let signOut;
let sendPasswordResetEmail;
let getFirestore;
let initializeFirestore;
let persistentLocalCache;
let persistentMultipleTabManager;
let doc;
let setDoc;
let getDoc;
let firebaseBootError = null;

if (window.FIREBASE_CONFIGURED) {
  try {
    const modules = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
    ]);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Délai Firebase dépassé')), 8000)
    );
    const [appModule, authModule, firestoreModule] = await Promise.race([modules, timeout]);
    ({ initializeApp } = appModule);
    ({
      getAuth,
      onAuthStateChanged,
      createUserWithEmailAndPassword,
      signInWithEmailAndPassword,
      signOut,
      sendPasswordResetEmail
    } = authModule);
    ({ getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc } = firestoreModule);
  } catch (error) {
    console.error('[Freev] Connexion Firebase impossible :', error);
    firebaseBootError = error;
  }
}

// ─── Helpers UI (partagés avec le script principal via window) ───
function showErr(msg)  { const e=document.getElementById('authError');   if(e){e.textContent=msg;e.style.display='block';} }
function showOk(msg)   { const e=document.getElementById('authSuccess'); if(e){e.textContent=msg;e.style.display='block';} }
function clearMsgs()   { ['authError','authSuccess'].forEach(id=>{ const e=document.getElementById(id); if(e) e.style.display='none'; }); }

function errMsg(code) {
  return ({
    'auth/email-already-in-use': 'Cette adresse email est déjà utilisée.',
    'auth/invalid-email':        'Adresse email invalide.',
    'auth/weak-password':        'Mot de passe trop faible (min. 6 caractères).',
    'auth/user-not-found':       'Aucun compte avec cet email.',
    'auth/wrong-password':       'Mot de passe incorrect.',
    'auth/too-many-requests':    'Trop de tentatives. Réessaie dans quelques minutes.',
    'auth/network-request-failed':'Problème de connexion réseau.',
    'auth/invalid-credential':   'Email ou mot de passe incorrect.',
  })[code] ?? `Erreur : ${code}`;
}

// ─── Badge cloud ─────────────────────────────────────────────────
window._fbShowBadge = (state) => {
  window.__freevCloudState = state;
  const el = document.getElementById('cloudSyncBadge');
  if (!el) return;
  el.className = 'cloud-sync-badge ' + state;
  if (state === 'synced')  el.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Synchronisé';
  if (state === 'syncing') el.innerHTML = '<span class="auth-spinner" style="width:10px;height:10px;border-width:1.5px;"></span> Sync...';
  if (state === 'offline') el.innerHTML = '<i class="fa-solid fa-cloud-slash"></i> Hors-ligne';
  el.style.display = 'inline-flex';
};

// ─── Sidebar user info ───────────────────────────────────────────
window._fbUpdateSidebar = (user) => {
  const info    = document.getElementById('sidebarUserInfo');
  const logout  = document.getElementById('sidebarLogoutBtn');
  const loginBtn= document.getElementById('sidebarLoginBtn');
  if (!info) return;
  if (user) {
    const email = String(user.email || 'Utilisateur');
    const avatar = document.createElement('div');
    avatar.className = 'sidebar-user-avatar';
    avatar.textContent = email[0].toUpperCase();
    const label = document.createElement('div');
    label.className = 'sidebar-user-email';
    label.title = email;
    label.textContent = email;
    info.replaceChildren(avatar, label);
    info.style.display   = 'flex';
    if (logout)   logout.style.display   = 'flex';
    if (loginBtn) loginBtn.style.display = 'none';
  } else {
    info.style.display   = 'none';
    if (logout)   logout.style.display   = 'none';
    if (loginBtn) loginBtn.style.display = 'flex';
  }
};

// ─── onglet login/register ───────────────────────────────────────
let _tab = 'login';
window._fbSwitchTab = (tab) => {
  _tab = tab;
  document.getElementById('authTabLogin')?.classList.toggle('active', tab==='login');
  document.getElementById('authTabRegister')?.classList.toggle('active', tab==='register');
  const p2  = document.getElementById('authPass2Group');
  const btn = document.getElementById('authSubmitBtn');
  const fgt = document.getElementById('authForgotBtn');
  if (p2)  p2.style.display  = tab==='register' ? 'block' : 'none';
  if (btn) btn.textContent   = tab==='login'     ? 'Se connecter' : 'Créer mon compte';
  if (fgt) fgt.style.display = tab==='login'     ? 'block' : 'none';
  clearMsgs();
};
window._fbAuthSubmit = () => { if (_tab==='login') window._fbAuthLogin(); else window._fbAuthRegister(); };

// ─── Init Firebase (SDK v10 modulaire) ──────────────────────────
if (!window.FIREBASE_CONFIGURED || firebaseBootError) {
  // Firebase est obligatoire : aucune ouverture locale de l'application.
  const showFirebaseRequired = () => {
    const loading = document.getElementById('authLoadingScreen');
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) authOverlay.style.display = 'none';
    if (!loading) return;
    loading.style.display = 'flex';
    loading.innerHTML = `
      <div style="max-width:460px;padding:2rem;text-align:center;color:white;">
        <div style="font-size:2.25rem;margin-bottom:1rem;">☁️</div>
        <div style="font-size:1.35rem;font-weight:800;margin-bottom:.65rem;">Connexion Firebase obligatoire</div>
        <div style="color:#cbd5e1;line-height:1.6;margin-bottom:1.35rem;">
          Freev Valeur ne peut pas fonctionner sans Firebase. Vérifiez votre connexion Internet et la configuration du projet.
        </div>
        <button type="button" onclick="location.reload()" class="btn btn-primary" style="margin:auto;">
          <i class="fa-solid fa-rotate-right"></i> Réessayer
        </button>
      </div>`;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFirebaseRequired);
  else showFirebaseRequired();
} else {
  const app  = initializeApp(window.FIREBASE_CONFIG);
  const auth = getAuth(app);
  let db;
  if (window.isTrustedDeviceCacheEnabled?.() && initializeFirestore && persistentLocalCache) {
    try {
      const cacheOptions = persistentMultipleTabManager
        ? { tabManager: persistentMultipleTabManager() }
        : {};
      db = initializeFirestore(app, {
        localCache: persistentLocalCache(cacheOptions)
      });
    } catch (error) {
      console.info('[Freev] Cache Firestore persistant indisponible :', error?.message || error);
      db = getFirestore(app);
    }
  } else db = getFirestore(app);
  const LAST_FIREBASE_UID_KEY = 'freevLastFirebaseUid';
  let cloudSavePromise = null;
  let cloudSavePending = false;
  let cloudHealthy = true;
  let authSessionGeneration = 0;

  function isCurrentAuthSession(uid, generation) {
    return authSessionGeneration === generation && auth.currentUser?.uid === uid;
  }

  function localCacheBelongsTo(uid) {
    const ownerUid = window.getLocalAccountCacheOwnerUid?.() || '';
    const lastUid = localStorage.getItem(LAST_FIREBASE_UID_KEY) || '';
    // Migration contrôlée : un ancien cache non étiqueté reste récupérable
    // seulement s'il n'a jamais été associé à un autre compte Firebase.
    return ownerUid ? ownerUid === uid : (!lastUid || lastUid === uid);
  }

  function applyFreshAccountState() {
    const fresh = window.createAccountObj?.('Compte principal');
    if (fresh) window._applyCloudData?.({ accounts: [fresh], currentAccountId: fresh.id, multiViewMode: 'individual', selectedGroupIds: [] });
  }

  function loadOwnedLocalState(uid, generation) {
    if (!isCurrentAuthSession(uid, generation)) return false;
    if (!localCacheBelongsTo(uid)) {
      applyFreshAccountState();
      return false;
    }
    return window.loadAccountSystem?.(uid) !== false && isCurrentAuthSession(uid, generation);
  }

  // ── Sauvegarde cloud ──────────────────────────────────────────
  window._fbSaveCloud = (expectedUid = '') => {
    if (expectedUid && auth.currentUser?.uid !== expectedUid) return Promise.resolve(false);
    cloudSavePending = true;
    if (cloudSavePromise) return cloudSavePromise;

    cloudSavePromise = (async () => {
      while (cloudSavePending) {
        cloudSavePending = false;
        const user = auth.currentUser;
        if (!user || (expectedUid && user.uid !== expectedUid)) return false;
        try {
          if (expectedUid && auth.currentUser?.uid !== expectedUid) return false;
          window._fbShowBadge('syncing');
          const state = window._getAppState();
          const payload = {
            schemaVersion: '2026-08-02-v5',
            ...state,
            selectedGroupIds: [...(state.selectedGroupIds || [])],
            lastSaved: new Date().toISOString()
          };
          // merge évite d'écraser les futurs champs de profil stockés dans le même document.
          await setDoc(doc(db, 'users', user.uid), {
            accountData: JSON.stringify(payload),
            schemaVersion: payload.schemaVersion,
            updatedAt: payload.lastSaved
          }, { merge: true });
          cloudHealthy = true;
          localStorage.setItem(LAST_FIREBASE_UID_KEY, user.uid);
          window._fbShowBadge('synced');
        } catch(e) {
          console.warn('[Freev] Cloud save failed:', e);
          cloudHealthy = false;
          window._fbShowBadge('offline');
          break;
        }
      }
    })().finally(() => {
      cloudSavePromise = null;
      if (cloudSavePending) window._fbSaveCloud();
    });
    return cloudSavePromise;
  };

  // ── Chargement cloud + fin d'init ────────────────────────────
  async function loadCloudAndInit(uid, generation) {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (!isCurrentAuthSession(uid, generation)) return false;
      cloudHealthy = true;
      if (snap.exists() && snap.data().accountData) {
        const parsed = JSON.parse(snap.data().accountData);
        if (!isCurrentAuthSession(uid, generation)) return false;
        const localRaw = localStorage.getItem('freevMultiAccounts_v2');
        const localParsed = localRaw ? JSON.parse(localRaw) : null;
        const lastUid = localStorage.getItem(LAST_FIREBASE_UID_KEY);
        const cloudTs = Date.parse(parsed.lastSaved || '') || 0;
        const localTs = Date.parse(localParsed?.lastSaved || '') || 0;
        const localIsNewerForSameUser = localCacheBelongsTo(uid) && lastUid === uid && localTs > cloudTs;

        if (localIsNewerForSameUser) {
          // Une fermeture rapide ou une panne réseau a pu laisser une sauvegarde
          // locale plus récente : elle est prioritaire uniquement pour le même UID.
          if (!loadOwnedLocalState(uid, generation)) return false;
          window.loadCurrentAccountIntoGlobals?.();
          await window._fbSaveCloud(uid);
          if (!isCurrentAuthSession(uid, generation)) return false;
          localStorage.setItem(LAST_FIREBASE_UID_KEY, uid);
        } else {
          // Vérifie que le cloud a vraiment des données
          const hasData = (parsed.accounts || []).some(a => (a.transactions||[]).length > 0);
          if (hasData || parsed.accounts?.length > 0) {
            if (!isCurrentAuthSession(uid, generation)) return false;
            window._applyCloudData(parsed);
            window.saveAccountSystem?.(); // met à jour le cache localStorage
            localStorage.setItem(LAST_FIREBASE_UID_KEY, uid);
          } else {
            // Cloud vide ou corrompu → charge localStorage et re-sauvegarde
            if (!loadOwnedLocalState(uid, generation)) {
              if (!isCurrentAuthSession(uid, generation)) return false;
              window.saveAccountSystem?.();
              await window._fbSaveCloud(uid);
              return isCurrentAuthSession(uid, generation);
            }
            window.loadCurrentAccountIntoGlobals?.(); // ← CRITIQUE : charge les globals avant de sauvegarder
            await window._fbSaveCloud(uid);
            if (!isCurrentAuthSession(uid, generation)) return false;
          }
        }
      } else {
        // Premier login : charge localStorage et sauvegarde dans le cloud
        if (!loadOwnedLocalState(uid, generation)) {
          if (!isCurrentAuthSession(uid, generation)) return false;
          window.saveAccountSystem?.();
          await window._fbSaveCloud(uid);
          return isCurrentAuthSession(uid, generation);
        }
        window.loadCurrentAccountIntoGlobals?.(); // ← CRITIQUE
        await window._fbSaveCloud(uid);
        if (!isCurrentAuthSession(uid, generation)) return false;
      }
    } catch(e) {
      if (!isCurrentAuthSession(uid, generation)) return false;
      cloudHealthy = false;
      console.warn('[Freev] Cloud load failed, using localStorage:', e);
      if (localCacheBelongsTo(uid)) {
        window.loadAccountSystem?.(uid);
        window.loadCurrentAccountIntoGlobals?.();
      } else {
        // Ne jamais afficher le cache local d'un autre utilisateur Firebase.
        applyFreshAccountState();
      }
    }
    // Fin init UI via bridge
    if (!isCurrentAuthSession(uid, generation)) return false;
    document.getElementById('authLoadingScreen').style.display = 'none';
    window._runPostAuthInit?.();
    return cloudHealthy;
  }

  // ── Listener d'état de connexion (JWT Firebase Auth v10) ─────
  onAuthStateChanged(auth, async (user) => {
    const generation = ++authSessionGeneration;
    // Met à jour les let locaux du script principal via le bridge
    window._fbSetAuthState?.(user);
    window.__freevUserId = user?.uid || '';
    if (user) {
      window._fbGetCurrentUser = () => auth.currentUser;
      try {
        const sessions = JSON.parse(localStorage.getItem('freevDeviceSessions') || '[]');
        const current = {
          id: `${navigator.platform || 'appareil'}-${screen.width}x${screen.height}`,
          label: /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone ou iPad' : /Android/i.test(navigator.userAgent) ? 'Appareil Android' : 'Ordinateur',
          lastSeen: new Date().toISOString(),
          current: true
        };
        const next = [current, ...sessions.filter(session => session.id !== current.id).map(session => ({ ...session, current: false }))].slice(0, 8);
        localStorage.setItem('freevDeviceSessions', JSON.stringify(next));
      } catch (_) {}
      document.getElementById('authOverlay').style.display = 'none';
      window._fbUpdateSidebar(user);
      window._fbShowBadge('syncing');
      const cloudOk = await loadCloudAndInit(user.uid, generation);
      if (!isCurrentAuthSession(user.uid, generation)) return;
      window._fbShowBadge(cloudOk ? 'synced' : 'offline');
    } else {
      document.getElementById('authLoadingScreen').style.display = 'none';
      document.getElementById('authOverlay').style.display = 'flex';
      window._fbUpdateSidebar(null);
    }
  });

  // ── Actions auth exposées à window (appelées par les onclick HTML) ──
  window._fbAuthLogin = async () => {
    const email = document.getElementById('authEmail')?.value?.trim();
    const pass  = document.getElementById('authPassword')?.value;
    const btn   = document.getElementById('authSubmitBtn');
    clearMsgs();
    if (!email || !pass) return showErr('Remplis tous les champs.');
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span>Connexion...';
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      // onAuthStateChanged prend le relais
    } catch(e) {
      btn.disabled = false; btn.textContent = 'Se connecter';
      showErr(errMsg(e.code));
    }
  };

  window._fbAuthRegister = async () => {
    const email = document.getElementById('authEmail')?.value?.trim();
    const pass  = document.getElementById('authPassword')?.value;
    const pass2 = document.getElementById('authPassword2')?.value;
    const btn   = document.getElementById('authSubmitBtn');
    clearMsgs();
    if (!email || !pass)    return showErr('Remplis tous les champs.');
    if (pass !== pass2)     return showErr('Les mots de passe ne correspondent pas.');
    if (pass.length < 6)    return showErr('Le mot de passe doit faire au moins 6 caractères.');
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span>Création...';
    try {
      await createUserWithEmailAndPassword(auth, email, pass);
    } catch(e) {
      btn.disabled = false; btn.textContent = 'Créer mon compte';
      showErr(errMsg(e.code));
    }
  };

  window._fbAuthLogout = async () => {
    if (!confirm('Se déconnecter ? Tes données sont sauvegardées dans le cloud.')) return;
    try { await window._fbSaveCloud?.(); } catch (_) {}
    if (!window.isTrustedDeviceCacheEnabled?.()) window.clearSensitiveLocalCache?.();
    await signOut(auth);
    location.reload();
  };

  window._fbAuthReset = async () => {
    const email = document.getElementById('authEmail')?.value?.trim();
    if (!email) return showErr('Saisis ton email d\'abord.');
    clearMsgs();
    try {
      await sendPasswordResetEmail(auth, email);
      showOk('Email envoyé ! Vérifie ta boîte mail.');
    } catch(e) { showErr(errMsg(e.code)); }
  };

  // Afficher l'écran de chargement tant qu'on attend onAuthStateChanged
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('authLoadingScreen').style.display = 'flex';
  });
}
})();
