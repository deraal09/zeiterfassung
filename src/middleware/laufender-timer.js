const { db } = require('../db');
const { decrypt } = require('../util/crypto');

// Stellt der Navigation den gerade laufenden Timer der angemeldeten Person
// bereit, damit "Laeuft: ... 00:12:31 / Stopp" auf jeder Seite oben steht und
// nicht nur auf der Seite des Aufgabenbereichs. Nur fuer GET: Formular-Posts
// leiten ohnehin weiter.
function laufenderTimer(req, res, next) {
  const user = req.session && req.session.user;
  res.locals.laufenderTimer = null;
  if (!user || req.method !== 'GET') return next();

  const timer = db
    .prepare(
      `SELECT te.id, te.category_id, te.beschreibung, te.start_time, c.title AS category_title
       FROM time_entries te
       JOIN categories c ON c.id = te.category_id
       WHERE te.user_id = ? AND te.end_time IS NULL
       LIMIT 1`
    )
    .get(user.id);
  if (timer) timer.beschreibung = decrypt(timer.beschreibung);
  res.locals.laufenderTimer = timer || null;
  next();
}

module.exports = { laufenderTimer };
