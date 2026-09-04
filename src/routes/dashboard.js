const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { nowLocalString } = require('../util/time');
const { aktuellesSchuljahr } = require('../util/schuljahr');
const { decrypt } = require('../util/crypto');
const { vorschlagen, annehmen, ablehnen } = require('../util/zuweisungen');

const ERROR_MESSAGES = {
  'titel-fehlt': 'Bitte einen Titel fuer die Kategorie eingeben.',
  'keine-kategorie': 'Bitte eine Kategorie auswaehlen.',
  'ungueltiges-ziel': 'Bitte eine gueltige Anzahl Zeitstunden eingeben.',
  'gesperrt': 'Diese Zuweisung ist bereits verknuepft und es wurden dafuer schon Zeiten erfasst - die Verknuepfung kann nicht mehr geaendert werden.',
  'kein-vorschlag': 'Es liegt aktuell kein zu bestaetigender Vorschlag der Schulleitung vor.',
};

function activeTimer(userId) {
  const timer = db
    .prepare(
      `SELECT te.*, c.title as category_title FROM time_entries te
       JOIN categories c ON c.id = te.category_id
       WHERE te.user_id = ? AND te.end_time IS NULL`
    )
    .get(userId);
  if (timer) timer.beschreibung = decrypt(timer.beschreibung);
  return timer;
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

  // Alle Zuweisungen der Lehrkraft (offen und bereits verknuepft). Solange
  // die bestaetigte Kategorie noch keine Zeiten hat (gesperrt=0), laesst
  // sich die Verknuepfung per Vorschlag/Bestaetigung noch aendern oder
  // aufheben (siehe util/zuweisungen.js).
  const zuweisungen = db
    .prepare(
      `SELECT z.*, COALESCE(sf.zeitstunden_pro_woche * sf.schulwochen,0) as faktor,
              c.title as category_title, vc.title as vorschlag_category_title,
              EXISTS(SELECT 1 FROM time_entries te WHERE te.category_id = z.category_id) as gesperrt
       FROM zuweisungen z
       LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       LEFT JOIN categories c ON c.id = z.category_id
       LEFT JOIN categories vc ON vc.id = z.vorschlag_category_id
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

// Schlaegt eine (neue oder geaenderte) Verknuepfung vor (leere category_id =
// Aufhebung vorschlagen) - wird erst wirksam, wenn der Admin sie annimmt
// (siehe /zuweisungen/:id/annehmen). Nicht mehr moeglich, sobald die
// Zuweisung gesperrt ist (bereits Zeiten erfasst) oder der Admin gerade
// selbst einen offenen Vorschlag hat.
router.post('/zuweisungen/:id/link', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=? AND user_id=?').get(req.params.id, userId);
  if (!zuweisung) return res.redirect('/');

  let categoryId = null;
  if (req.body.category_id) {
    const category = db.prepare('SELECT id FROM categories WHERE id=? AND user_id=?').get(req.body.category_id, userId);
    if (!category) return res.redirect('/?error=keine-kategorie');
    categoryId = category.id;
  }

  if (!vorschlagen(zuweisung, 'lehrkraft', categoryId)) {
    return res.redirect('/?error=gesperrt');
  }
  res.redirect('/');
});

// Nimmt einen offenen Verknuepfungsvorschlag der Schulleitung an.
router.post('/zuweisungen/:id/annehmen', requireAuth, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=? AND user_id=?').get(req.params.id, req.session.user.id);
  if (!zuweisung) return res.redirect('/');
  if (!annehmen(zuweisung, 'lehrkraft')) return res.redirect('/?error=kein-vorschlag');
  res.redirect('/');
});

// Lehnt einen offenen Verknuepfungsvorschlag der Schulleitung ab - danach
// kann selbst ein anderer Vorschlag gemacht werden.
router.post('/zuweisungen/:id/ablehnen', requireAuth, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=? AND user_id=?').get(req.params.id, req.session.user.id);
  if (!zuweisung) return res.redirect('/');
  if (!ablehnen(zuweisung, 'lehrkraft')) return res.redirect('/?error=kein-vorschlag');
  res.redirect('/');
});

// Legt direkt eine neue, eigene Kategorie an und schlaegt sie sofort als
// Verknuepfung fuer diese Zuweisung vor (muss vom Admin noch bestaetigt
// werden). Nur moeglich, solange weder eine bestaetigte Kategorie noch ein
// offener Vorschlag vorliegt.
router.post('/zuweisungen/:id/uebernehmen', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=? AND user_id=?').get(req.params.id, userId);
  if (!zuweisung || zuweisung.category_id || zuweisung.vorschlag_von) return res.redirect('/');

  const title = (req.body.title || '').trim() || `Ausgleichsstunden ${zuweisung.schuljahr}`;
  const info = db
    .prepare('INSERT INTO categories (user_id, title, schuljahr) VALUES (?,?,?)')
    .run(userId, title, zuweisung.schuljahr);
  vorschlagen(zuweisung, 'lehrkraft', info.lastInsertRowid);
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
