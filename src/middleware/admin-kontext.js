const { gesamtPool, adminSchuljahre } = require('../util/pools');
const { aktuellesSchuljahr, istSchuljahr } = require('../util/schuljahr');

// Stellt Admin-Seiten (und der Navigation) bereit, welches Schuljahr gerade
// gewaehlt ist und wie voll der Gesamtpool dieses Schuljahres ist - die
// Anzeige oben rechts steht auf jeder Seite, solange ein Admin angemeldet ist.
//
// Das Schuljahr kommt aus ?schuljahr=...; ohne gueltige Angabe gilt das
// laufende. Nur fuer GET-Anfragen: Formular-Posts leiten ohnehin weiter, und
// die Berechnung muss nicht bei jedem Schreibzugriff laufen.
function adminKontext(req, res, next) {
  const user = req.session && req.session.user;
  if (!user || !user.isAdmin || req.method !== 'GET') return next();

  const wunsch = String(req.query.schuljahr || '').trim();
  const schuljahr = istSchuljahr(wunsch) ? wunsch : aktuellesSchuljahr();
  const schuljahre = adminSchuljahre();
  if (!schuljahre.includes(schuljahr)) schuljahre.push(schuljahr);

  res.locals.adminSchuljahr = schuljahr;
  res.locals.adminSchuljahre = schuljahre.sort().reverse();
  res.locals.poolBadge = gesamtPool(schuljahr);
  next();
}

module.exports = { adminKontext };
