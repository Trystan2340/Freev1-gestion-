
      window.FIREBASE_CONFIG = {
        apiKey:            "AIzaSyAdscyjqx7dcKmMr3T5v8jyKBtG3p3W6Uo",
        authDomain:        "freev-valeur.firebaseapp.com",
        projectId:         "freev-valeur",
        storageBucket:     "freev-valeur.firebasestorage.app",
        messagingSenderId: "55923211941",
        appId:             "1:55923211941:web:5ffecff4202172c332574c"
      };
      window.FIREBASE_CONFIGURED = !window.FIREBASE_CONFIG.apiKey.includes('COLLE_');
      window.FIREBASE_REQUIRED = true;

      // URL publique du serveur Open Banking. Ne jamais y mettre une clé, un secret
      // ou un jeton bancaire : ceux-ci restent exclusivement côté serveur.
      window.FREEV_BANK_SYNC_ENDPOINT = 'https://freev-bank-sync.freevunited.workers.dev';

      // Interrupteurs publics réversibles. Le code de la fonction reste présent.
      window.FREEV_FEATURE_FLAGS = Object.freeze({
        plannerMaintenance: false
      });
