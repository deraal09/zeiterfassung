// Menue-Knopf der Kopfzeile: auf schmalen Bildschirmen klappt er Navigation und
// Benutzerbereich auf (siehe CSS .nav-toggle / .nav-open).
document.addEventListener('DOMContentLoaded', () => {
  const knopf = document.querySelector('.nav-toggle');
  const kopf = document.querySelector('.topbar-inner');
  if (!knopf || !kopf) return;
  knopf.addEventListener('click', () => {
    const offen = kopf.classList.toggle('nav-open');
    knopf.setAttribute('aria-expanded', offen ? 'true' : 'false');
  });
});

// "Neu laden": Browser-Cache, Caches-API und Service Worker leeren und die Seite
// samt CSS und Skripten frisch vom Server holen. Hilft vor allem in der
// installierten App, die keinen Reload-Knopf und kein Strg+F5 hat.
document.addEventListener('DOMContentLoaded', () => {
  const knopf = document.getElementById('app-reload-button');
  if (!knopf) return;

  knopf.addEventListener('click', async () => {
    if (knopf.disabled) return;
    knopf.disabled = true;
    knopf.setAttribute('aria-busy', 'true');
    try {
      if ('serviceWorker' in navigator) {
        const registrierungen = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrierungen.map((r) => r.unregister()));
      }
      if (window.caches) {
        const namen = await window.caches.keys();
        await Promise.all(namen.map((n) => window.caches.delete(n)));
      }
      // cache: 'reload' umgeht den HTTP-Cache und ersetzt dabei den dortigen
      // Eintrag - die folgende Navigation findet dann nur noch frische Dateien.
      const urls = new Set([location.href]);
      document.querySelectorAll('link[rel="stylesheet"][href], script[src]').forEach((el) => {
        urls.add(el.href || el.src);
      });
      await Promise.all([...urls].map((url) => fetch(url, { cache: 'reload' }).catch(() => {})));
    } catch (err) {
      // Auch wenn das Aufraeumen scheitert: neu laden bringt trotzdem etwas.
    }
    // replace statt reload: nach einem POST soll nichts erneut abgeschickt werden.
    location.replace(location.href);
  });
});
