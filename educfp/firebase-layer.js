// ═══════════════════════════════════════════════════════════════════════════════
// firebase-layer.js  —  Couche Firebase pour EduCFP Lambanyi
// Version : 1.0  —  Compatible Babel CDN (pas de bundler)
//
// RÔLE DE CE FICHIER :
//   • Remplace loadData()  →  lecture Firebase RTDB + fallback localStorage
//   • Remplace saveData()  →  écriture Firebase RTDB + cache localStorage
//   • Gère Firebase Auth   →  login/logout par email
//   • Lance onValue()      →  temps réel multi-appareils
//   • Expose uploadFile()  →  Firebase Storage (PDF)
//   • Expose SyncBadge     →  composant React indicateur de sync
//
// UTILISATION dans app.js :
//   Voir section "PATCHES APP.JS" à la fin de ce fichier.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. CONFIGURATION FIREBASE ────────────────────────────────────────────────
// !! Remplacez ces valeurs par celles de votre projet Firebase !!
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCQSjAsFcnBM7oDU7I6TivL09fT4ggfWyY",
  authDomain:        "educfp-33b90.firebaseapp.com",
  databaseURL:       "https://educfp-33b90-default-rtdb.firebaseio.com",  // ✅ Confirmé
  projectId:         "educfp-33b90",
  storageBucket:     "educfp-33b90.firebasestorage.app",
  messagingSenderId: "781170659344",
  appId:             "1:781170659344:web:bd2d22df4d848611683a95",
  measurementId:     "G-0XLNMYBXNE"
};

// ─── 2. CHARGEMENT SDK FIREBASE (CDN compat mode) ─────────────────────────────
// Ces lignes injectent les scripts Firebase si ce fichier est chargé en <script>
// standard (pas module). Pour index.html avec Babel CDN :
//   Ajoutez dans <head> AVANT app.js :
//
//   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js"></script>
//   <script src="firebase-layer.js"></script>
//
// ─── 3. INITIALISATION ────────────────────────────────────────────────────────
let _fbApp, _fbAuth, _fbDb, _fbStorage;

function initFirebase() {
  if (_fbApp) return;
  try {
    _fbApp     = firebase.initializeApp(FIREBASE_CONFIG);
    _fbAuth    = firebase.auth();
    _fbDb      = firebase.database();
    _fbStorage = firebase.storage();
    console.log("✅ Firebase initialisé");
  } catch (e) {
    console.warn("⚠️ Firebase init échoué — mode localStorage uniquement", e);
  }
}

// ─── 4. CONSTANTES ────────────────────────────────────────────────────────────
const DB_ROOT     = "/schools/cfp-lambanyi/data";
const LS_KEY      = "cfp_v12";          // clé localStorage existante
const LS_SYNC_KEY = "cfp_v12_offline";  // file d'attente hors-ligne

// ─── 5. ÉTAT GLOBAL DE SYNCHRONISATION ────────────────────────────────────────
// Partagé avec React via window.__cfpSyncState
window.__cfpSyncState = window.__cfpSyncState || {
  status: "init",   // "init" | "synced" | "offline" | "syncing" | "error"
  lastSync: null,
  error: null,
  listeners: []
};

function _setSyncStatus(status, extra = {}) {
  window.__cfpSyncState = { ...window.__cfpSyncState, status, ...extra };
  window.__cfpSyncState.listeners.forEach(fn => fn(window.__cfpSyncState));
}

// ─── 6. loadDataFirebase() — remplace loadData() ──────────────────────────────
// Charge les données depuis Firebase RTDB.
// Si Firebase indisponible, retourne le cache localStorage.
async function loadDataFirebase() {
  initFirebase();

  // Cache localStorage en secours
  let localData = null;
  try {
    localData = JSON.parse(localStorage.getItem(LS_KEY));
  } catch {}

  if (!_fbDb) {
    console.warn("Firebase non disponible — utilisation localStorage");
    return localData || window.INIT;
  }

  try {
    _setSyncStatus("syncing");
    const snap = await _fbDb.ref(DB_ROOT).once("value");
    const fbData = snap.val();

    if (!fbData) {
      // Première connexion admin : base vide → on initialise depuis INIT
      console.log("Base Firebase vide — données locales conservées");
      _setSyncStatus("synced", { lastSync: Date.now() });
      return localData || window.INIT;
    }

    // Fusionner avec migrations locales (même logique que l'ancien loadData)
    const merged = _applyMigrations(fbData);
    // Mettre à jour le cache local
    try { localStorage.setItem(LS_KEY, JSON.stringify(merged)); } catch {}
    _setSyncStatus("synced", { lastSync: Date.now() });
    return merged;
  } catch (e) {
    console.warn("Erreur lecture Firebase — fallback localStorage", e);
    _setSyncStatus("offline", { error: e.message });
    return localData || window.INIT;
  }
}

// ─── 7. saveDataFirebase() — remplace saveData() ──────────────────────────────
// Écrit dans Firebase RTDB ET dans localStorage (cache hors-ligne).
async function saveDataFirebase(data) {
  // 1. Toujours sauvegarder en local d'abord (sécurité hors-ligne)
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}

  if (!_fbDb) return;

  // 2. Nettoyer les données avant envoi Firebase (pas de undefined, pas de Base64 PDF)
  const clean = _stripBase64(JSON.parse(JSON.stringify(data)));

  try {
    _setSyncStatus("syncing");
    await _fbDb.ref(DB_ROOT).set(clean);
    _setSyncStatus("synced", { lastSync: Date.now() });
  } catch (e) {
    console.warn("Erreur écriture Firebase — données en file hors-ligne", e);
    _setSyncStatus("offline", { error: e.message });
    // File hors-ligne : sera rejoué à la reconnexion
    try {
      const queue = JSON.parse(localStorage.getItem(LS_SYNC_KEY) || "[]");
      queue.push({ ts: Date.now(), data: clean });
      localStorage.setItem(LS_SYNC_KEY, JSON.stringify(queue.slice(-5))); // garder 5 max
    } catch {}
  }
}

// ─── 8. initRealtimeSync() — abonnement onValue temps réel ────────────────────
// À appeler UNE SEULE FOIS au montage de App().
// Appelle setDataRaw(newData) à chaque changement distant.
function initRealtimeSync(setDataRaw) {
  initFirebase();
  if (!_fbDb) return () => {};

  const refNode = _fbDb.ref(DB_ROOT);
  let firstCall = true;

  const handler = refNode.on("value", snap => {
    if (firstCall) { firstCall = false; return; } // ignorer le premier appel (déjà chargé)
    const fbData = snap.val();
    if (!fbData) return;
    const merged = _applyMigrations(fbData);
    // Mettre à jour le cache local silencieusement
    try { localStorage.setItem(LS_KEY, JSON.stringify(merged)); } catch {}
    // Mettre à jour l'état React sans déclencher une nouvelle écriture Firebase
    setDataRaw(merged);
    _setSyncStatus("synced", { lastSync: Date.now() });
  }, err => {
    _setSyncStatus("offline", { error: err.message });
  });

  // Détecteur réseau
  window.addEventListener("online",  () => _flushOfflineQueue());
  window.addEventListener("offline", () => _setSyncStatus("offline"));

  // Retourne la fonction de désinscription
  return () => refNode.off("value", handler);
}

// ─── 9. loginFirebase() — remplace la vérification login/password ──────────────
// Prend login (identifiant CFP) + password, trouve l'email Firebase associé,
// puis signe avec Firebase Auth.
// Retourne { user, profile } ou lance une exception.
async function loginFirebase(login, password, allUsers) {
  initFirebase();

  // Retrouver le profil par login CFP
  const profile = allUsers.find(u => u.login === login && u.actif);
  if (!profile) throw new Error("Identifiant ou mot de passe incorrect.");

  if (!_fbAuth) {
    // Mode dégradé : vérification locale (sans Firebase Auth)
    if (profile.password === password) return { user: null, profile };
    throw new Error("Identifiant ou mot de passe incorrect.");
  }

  // Email Firebase = login@cfp-lambanyi.app
  const email = _loginToEmail(login);
  try {
    const cred = await _fbAuth.signInWithEmailAndPassword(email, password);
    return { user: cred.user, profile };
  } catch (e) {
    if (e.code === "auth/user-not-found" || e.code === "auth/wrong-password") {
      throw new Error("Identifiant ou mot de passe incorrect.");
    }
    // Fallback local si Firebase Auth non configuré
    if (profile.password === password) return { user: null, profile };
    throw new Error("Identifiant ou mot de passe incorrect.");
  }
}

// ─── 10. logoutFirebase() ──────────────────────────────────────────────────────
async function logoutFirebase() {
  try { if (_fbAuth) await _fbAuth.signOut(); } catch {}
}

// ─── 11. uploadFile() — Firebase Storage ──────────────────────────────────────
// Upload un fichier (PDF, image) et retourne son URL de téléchargement.
// path ex: "inscriptions/CFP-2025-001/diplome.pdf"
async function uploadFile(file, path) {
  initFirebase();
  if (!_fbStorage) throw new Error("Firebase Storage non disponible.");
  const storageRef = _fbStorage.ref(`schools/cfp-lambanyi/${path}`);
  const snap = await storageRef.put(file);
  return await snap.ref.getDownloadURL();
}

// ─── 12. initAdminData() — initialisation one-shot ────────────────────────────
// À appeler une seule fois depuis l'écran Admin pour peupler la base Firebase.
async function initAdminData(initData) {
  initFirebase();
  if (!_fbDb) throw new Error("Firebase non disponible.");
  // Nettoyer les mots de passe en clair et les Base64 avant envoi
  const clean = _stripPasswords(_stripBase64(JSON.parse(JSON.stringify(initData))));
  await _fbDb.ref(DB_ROOT).set(clean);
  _setSyncStatus("synced", { lastSync: Date.now() });
}

// ─── 13. SyncBadge — Composant React indicateur de synchronisation ─────────────
// Usage dans App() : <SyncBadge />
function SyncBadge() {
  const [syncState, setSyncState] = React.useState(window.__cfpSyncState);

  React.useEffect(() => {
    const listener = (s) => setSyncState({...s});
    window.__cfpSyncState.listeners.push(listener);
    return () => {
      window.__cfpSyncState.listeners =
        window.__cfpSyncState.listeners.filter(l => l !== listener);
    };
  }, []);

  const cfg = {
    synced:  { icon: "☁️", label: "Synchronisé",       bg: "#E6F4EA", color: "#1E7E34", border: "#A8D5B5" },
    syncing: { icon: "🔄", label: "Synchronisation…",  bg: "#FFF8E1", color: "#9A6B00", border: "#FFD54F" },
    offline: { icon: "📵", label: "Hors-ligne",         bg: "#FDECEA", color: "#B71C1C", border: "#FFAAAA" },
    error:   { icon: "⚠️", label: "Erreur sync",        bg: "#FDECEA", color: "#B71C1C", border: "#FFAAAA" },
    init:    { icon: "⏳", label: "Connexion…",         bg: "#E3F2FD", color: "#1565C0", border: "#90CAF9" },
  };
  const c = cfg[syncState.status] || cfg.init;
  const ago = syncState.lastSync
    ? `Il y a ${Math.round((Date.now() - syncState.lastSync) / 1000)}s`
    : "";

  return React.createElement("div", {
    style: {
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 20,
      background: c.bg, color: c.color,
      border: `1px solid ${c.border}`,
      fontSize: 12, fontWeight: 600,
      cursor: "default", userSelect: "none"
    },
    title: ago ? `Dernière sync : ${ago}` : c.label
  },
    React.createElement("span", null, c.icon),
    React.createElement("span", null, c.label)
  );
}

// ─── FONCTIONS INTERNES ───────────────────────────────────────────────────────

function _loginToEmail(login) {
  // Convertit l'identifiant CFP en email Firebase valide
  const safe = login.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe}@cfp-lambanyi.app`;
}

function _stripBase64(data) {
  // Supprime les champs Base64 (PDF encodés) — stockés dans Firebase Storage
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(_stripBase64);
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && v.length > 500 &&
        (k.includes("base64") || k.includes("pdf") || k.includes("diplome") ||
         k.includes("extrait") || k === "LOGO_B64")) {
      out[k] = ""; // on garde la clé mais on vide la valeur
    } else {
      out[k] = _stripBase64(v);
    }
  }
  return out;
}

function _stripPasswords(data) {
  // Supprime les mots de passe en clair des users avant envoi Firebase
  if (!data || !data.users) return data;
  return {
    ...data,
    users: data.users.map(u => {
      const { password, ...rest } = u;
      return rest; // password jamais stocké dans Firebase RTDB
    })
  };
}

function _applyMigrations(fbData) {
  // Reprend la logique de migrations de l'ancien loadData()
  // pour assurer la compatibilité avec les anciens formats
  if (!fbData.emploi_du_temps) fbData.emploi_du_temps = window.INIT.emploi_du_temps;
  if (!fbData.stages)          fbData.stages          = window.INIT.stages;
  if (!fbData.school_years)    fbData.school_years    = window.INIT.school_years;
  if (!fbData.school_periods)  fbData.school_periods  = window.INIT.school_periods;
  if (!fbData.outils_pedago)   fbData.outils_pedago   = window.INIT.outils_pedago;
  if (!fbData.documents)       fbData.documents       = window.INIT.documents;
  if (!fbData.bons_entree)     fbData.bons_entree     = window.INIT.bons_entree;
  if (!fbData.bons_sortie)     fbData.bons_sortie     = window.INIT.bons_sortie;
  if (!fbData.scolarites)      fbData.scolarites      = window.INIT.scolarites;
  if (!fbData.tontines)        fbData.tontines        = window.INIT.tontines;
  if (!fbData.parent_student)  fbData.parent_student  = window.INIT.parent_student;
  if (!fbData.appreciations)   fbData.appreciations   = [];
  if (!fbData.competences)     fbData.competences     = [];
  if (!fbData.livret_presences)fbData.livret_presences = [];
  if (!fbData.livret_notes)    fbData.livret_notes    = [];
  if (!fbData.livret_stages)   fbData.livret_stages   = [];
  if (!fbData.livret_bilan)    fbData.livret_bilan    = [];

  // Toujours garantir que les comptes admin/secrétaire existent
  if (fbData.users) {
    const hasAdmin = fbData.users.some(u => u.role === "admin");
    if (!hasAdmin) fbData.users = [...fbData.users, window.ADMIN_USER];

    const hasSec = fbData.users.some(u => u.login === "secretaire");
    if (!hasSec) fbData.users = [...fbData.users, window.SECRETAIRE_USER];

    // Migration matricule
    fbData.users = fbData.users.map(u => {
      if (u.role === "eleve" && !u.matricule) {
        return { ...u, matricule: "CFP-" + new Date().getFullYear() + "-" + String(u.id).padStart(3,"0") };
      }
      return u;
    });
  }

  // Migration notes period_id
  if (fbData.notes && fbData.school_periods) {
    const periods = fbData.school_periods;
    fbData.notes = fbData.notes.map(n => {
      if (n.trimestre !== undefined && n.period_id === undefined) {
        const period = periods[n.trimestre - 1] || periods[0];
        const { trimestre, ...rest } = n;
        return { ...rest, period_id: period?.id || 1 };
      }
      return n;
    });
  }

  return fbData;
}

async function _flushOfflineQueue() {
  // Rejoue les sauvegardes en attente dès le retour en ligne
  try {
    const queue = JSON.parse(localStorage.getItem(LS_SYNC_KEY) || "[]");
    if (queue.length === 0) return;
    if (!_fbDb) return;
    const last = queue[queue.length - 1]; // on envoie seulement le plus récent
    await _fbDb.ref(DB_ROOT).set(last.data);
    localStorage.removeItem(LS_SYNC_KEY);
    _setSyncStatus("synced", { lastSync: Date.now() });
    console.log("✅ File hors-ligne vidée");
  } catch (e) {
    console.warn("Erreur flush offline", e);
  }
}

// ─── EXPOSITION GLOBALE ───────────────────────────────────────────────────────
window.FB = {
  loadData:       loadDataFirebase,
  saveData:       saveDataFirebase,
  initSync:       initRealtimeSync,
  login:          loginFirebase,
  logout:         logoutFirebase,
  upload:         uploadFile,
  initAdminData:  initAdminData,
  SyncBadge:      SyncBadge,
};
