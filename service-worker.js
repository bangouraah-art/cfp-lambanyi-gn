// ─── EduCFP Lambanyi — Service Worker PWA ──────────────────────────────────
// !! Incrémentez CACHE_VERSION à chaque déploiement pour forcer la mise à jour
const CACHE_VERSION = "educfp-v2.1";

// Fichiers statiques mis en cache (jamais app.js — toujours frais depuis réseau)
const STATIC_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/firebase-layer.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// Ces fichiers sont TOUJOURS récupérés depuis le réseau (jamais mis en cache)
const NETWORK_ONLY = [
  "/app.js",
  "/api/ia",
  "firebasestorage",
  "firebaseio.com",
  "googleapis.com",
  "gstatic.com",
  "anthropic.com"
];

// ─── INSTALLATION ────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(STATIC_CACHE).catch((err) => {
        console.warn("[SW] Cache partiel :", err);
      });
    })
  );
  self.skipWaiting(); // activer immédiatement
});

// ─── ACTIVATION — supprimer les anciens caches ───────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── FETCH — Network First pour app.js, Cache First pour le reste ────────────
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;

  // Toujours réseau pour app.js et les APIs
  const isNetworkOnly = NETWORK_ONLY.some((p) => url.includes(p));
  if (isNetworkOnly) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Hors-ligne : retourner app.js depuis cache si disponible
        return caches.match(event.request);
      })
    );
    return;
  }

  // Cache First pour les ressources statiques
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic")
            return response;
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone));
          return response;
        })
        .catch(() => {
          if (event.request.destination === "document")
            return caches.match("/index.html");
        });
    })
  );
});

// ─── MESSAGE — forcer mise à jour depuis l'app ───────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
