// ─── EduCFP Lambanyi — Service Worker PWA ─────────────────────────────────────
// Version du cache — incrémentez à chaque mise à jour de l'application
const CACHE_NAME = "educfp-v1.0";

// Fichiers à mettre en cache pour le mode hors-ligne
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// ─── INSTALLATION — mise en cache des ressources ──────────────────────────────
self.addEventListener("install", (event) => {
  console.log("[SW] Installation du service worker EduCFP...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Mise en cache des ressources...");
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn("[SW] Certains fichiers n'ont pas pu être mis en cache :", err);
      });
    })
  );
  // Forcer l'activation immédiate sans attendre la fermeture des onglets
  self.skipWaiting();
});

// ─── ACTIVATION — nettoyage des anciens caches ────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log("[SW] Activation du service worker EduCFP...");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log("[SW] Suppression de l'ancien cache :", name);
            return caches.delete(name);
          })
      );
    })
  );
  // Prendre le contrôle de toutes les pages immédiatement
  self.clients.claim();
});

// ─── FETCH — stratégie Cache First (priorité au cache, fallback réseau) ───────
self.addEventListener("fetch", (event) => {
  // Ignorer les requêtes non-GET et les requêtes vers d'autres domaines
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Si trouvé dans le cache, retourner la version cached
      if (cachedResponse) {
        return cachedResponse;
      }

      // Sinon, récupérer depuis le réseau et mettre en cache
      return fetch(event.request)
        .then((networkResponse) => {
          // Ne mettre en cache que les réponses valides
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => {
          // En cas d'erreur réseau, retourner la page d'accueil cachée
          if (event.request.destination === "document") {
            return caches.match("/index.html");
          }
        });
    })
  );
});

// ─── MESSAGE — mise à jour manuelle du cache ──────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
