// Minimaler Service Worker. Er cacht bewusst nichts - die App ist
// session-/CSRF-basiert und dynamisch, ein Offline-Cache der Seiten wuerde
// schnell veraltete Formulare oder abgelaufene CSRF-Tokens ausliefern. Der
// Worker existiert nur, damit Chrome/Edge/Android die App ueberhaupt als
// installierbar einstufen (Installierbarkeits-Kriterium: registrierter
// Service Worker mit fetch-Handler) - der fetch-Handler reicht jede
// Anfrage unveraendert an das Netzwerk durch.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
