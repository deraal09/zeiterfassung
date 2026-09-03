const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { nowLocalString } = require('../util/time');
const { aktuellesSchuljahr } = require('../util/schuljahr');

const ERROR_MESSAGES = {
  'titel-fehlt': 'Bitte einen Titel fuer die Kategorie eingeben.',
  'keine-kategorie': 'Bitte eine Kategorie auswaehlen.',
  'ungueltiges-ziel': 'Bitte eine gueltige Anzahl Zeitstunden eingeben.',
};

function activeTimer(userId) {
  return db
    .prepare(
      `SELECT te.*, c.title as category_title FROM time_entries te
       JOIN categories c ON c.id = te.category_id
       WHERE te.user_id = ? AND te.end_time IS NULL`
    )
    .get(userId);
}

// Solange keine Zuweisung mit der Kategorie verknuepft ist, gilt das von der
// Lehrkraft selbst eingetragene ziel_zeitstunden als vorlaeufiges Ziel.
// Sobald mindestens eine Zuweisung verknuepft ist, zaehlt nur noch die
// offizielle Berechnung (Ausgleichsstunden x Schuljahr-Faktor, summiert).
function benoetigteStunden(category) {
  const summe = db
    .prepare(
      `SELECT COALESCE(SUM(z.ausgleichsstunden * COALESCE(sf.zeitstunden_pro_woche * sf.schulwochen,0)),0) as h,
              COUNT(*) as anzahl
       FROM zuweisungen z LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       WHERE z.category_id=?`
    )
    .get(category.id);
  if (summe.anzahl > 0) return summe.h;
  return category.ziel_zeitstunden || 0;
}

router.get('/', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const schuljahr = aktuellesSchuljahr();

  const categories = db
    .prepare('SELECT * FROM categories WHERE user_id = ? AND schuljahr = ? AND archived = 0 ORDER BY created_at DESC')
    .all(userId, schuljahr);

  const stats = categories.map((cat) => {
    const sumMinutes = db
      .prepare('SELECT COALESCE(SUM(duration_minutes),0) as minutes FROM time_entries WHERE category_id = ? AND end_time IS NOT NULL')
      .get(cat.id).minutes;
    return {
      ...cat,
      erfassteStunden: sumMinutes / 60,
      benoetigteStunden: benoetigteStunden(cat),
    };
  });

  // Alle Zuweisungen der Lehrkraft (offen und bereits verknuepft) - die
  // Verknuepfung laesst sich hier jederzeit setzen, aendern oder aufheben,
  // nicht nur einmalig beim ersten Verknuepfen.
  const zuweisungen = db
    .prepare(
      `SELECT z.*, COALESCE(sf.zeitstunden_pro_woche * sf.schulwochen,0) as faktor, c.title as category_title
       FROM zuweisungen z
       LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       LEFT JOIN categories c ON c.id = z.category_id
       WHERE z.user_id=? ORDER BY z.created_at DESC`
    )
    .all(userId);

  const unsyncedCount = db
    .prepare('SELECT COUNT(*) as c FROM time_entries WHERE user_id=? AND synced=0 AND end_time IS NOT NULL')
    .get(userId).c;

  res.render('dashboard', {
    categories: stats,
    zuweisungen,
    schuljahr,
    timer: activeTimer(userId),
    unsyncedCount,
    error: ERROR_MESSAGES[req.query.error] || null,
  });
});

router.post('/categories', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.redirect('/?error=titel-fehlt');

  const zielRoh = req.body.ziel_zeitstunden;
  let ziel = null;
  if (zielRoh) {
    const wert = parseFloat(String(zielRoh).replace(',', '.'));
    if (wert > 0) ziel = wert;
  }

  db.prepare('INSERT INTO categories (user_id, title, schuljahr, ziel_zeitstunden) VALUES (?,?,?,?)').run(
    req.session.user.id,
    title,
    aktuellesSchuljahr(),
    ziel
  );
  res.redirect('/');
});

// Verknuepfung setzen, aendern oder aufheben (leere category_id = trennen).
// Nicht mehr nur beim ersten Verknuepfen moeglich - falls sich jemand
// verschrieben oder die falsche Kategorie gewaehlt hat, laesst sich das
// jederzeit korrigieren.
router.post('/zuweisungen/:id/link', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=? AND user_id=?').get(req.params.id, userId);
  if (!zuweisung) return res.redirect('/');

  if (!req.body.category_id) {
    db.prepare('UPDATE zuweisungen SET category_id=NULL WHERE id=?').run(zuweisung.id);
    return res.redirect('/');
  }

  const category = db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(req.body.category_id, userId);
  if (!category) return res.redirect('/?error=keine-kategorie');

  db.prepare('UPDATE zuweisungen SET category_id=? WHERE id=?').run(category.id, zuweisung.id);
  res.redirect('/');
});

router.post('/zuweisungen/:id/uebernehmen', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=? AND user_id=?').get(req.params.id, userId);
  if (!zuweisung || zuweisung.category_id) return res.redirect('/');

  const title = (req.body.title || '').trim() || `Ausgleichsstunden ${zuweisung.schuljahr}`;
  const info = db
    .prepare('INSERT INTO categories (user_id, title, schuljahr) VALUES (?,?,?)')
    .run(userId, title, zuweisung.schuljahr);
  db.prepare('UPDATE zuweisungen SET category_id=? WHERE id=?').run(info.lastInsertRowid, zuweisung.id);
  res.redirect('/');
});

router.post('/sync', requireAuth, (req, res) => {
  db.prepare("UPDATE time_entries SET synced=1, synced_at=? WHERE user_id=? AND synced=0 AND end_time IS NOT NULL").run(
    nowLocalString(),
    req.session.user.id
  );
  res.redirect(req.get('referer') || '/');
});

router.post('/settings/auto-sync', requireAuth, (req, res) => {
  const enabled = req.body.enabled === 'on' ? 1 : 0;
  db.prepare('UPDATE users SET auto_sync=? WHERE id=?').run(enabled, req.session.user.id);
  req.session.user.autoSync = !!enabled;
  res.redirect('/');
});

module.exports = router;
