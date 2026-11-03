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
