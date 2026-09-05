const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { nowLocalString } = require('../util/time');
const { aktuellesSchuljahr, istSchuljahr } = require('../util/schuljahr');
const { decrypt } = require('../util/crypto');
const { vorschlagen, annehmen, ablehnen } = require('../util/zuweisungen');
const { zielZeitstunden, fortschrittProzent } = require('../util/stunden');
const { interneZielseite } = require('../util/redirect');

const ERROR_MESSAGES = {
  'titel-fehlt': 'Bitte einen Titel fuer die Kategorie eingeben.',
  'keine-kategorie': 'Bitte eine Kategorie auswaehlen.',
  'ungueltiges-ziel': 'Bitte eine gueltige Anzahl Zeitstunden eingeben.',
  'gesperrt': 'Diese Zuweisung ist bereits verknuepft und es wurden dafuer schon Zeiten erfasst - die Verknuepfung kann nicht mehr geaendert werden.',
  'kein-vorschlag': 'Es liegt aktuell kein zu bestaetigender Vorschlag der Schulleitung vor.',
  'vorschlag-ungueltig': 'Die vorgeschlagene Kategorie existiert nicht mehr. Bitte den Vorschlag ablehnen und neu vorschlagen.',
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

// Schuljahre, in denen die Lehrkraft ueberhaupt etwas hat, plus das aktuelle
// (auch wenn dort noch nichts angelegt wurde). Ohne diese Liste waere alles
// ausserhalb des laufenden Schuljahres nach dem 1. August unerreichbar -
// samt der bereits erfassten Zeiten.
function schuljahreFuer(userId) {
  const zeilen = db
    .prepare(
      `SELECT schuljahr FROM categories WHERE user_id = ?
       UNION SELECT schuljahr FROM zuweisungen WHERE user_id = ?`
    )
    .all(userId, userId)
    .map((r) => r.schuljahr);

  return [...new Set([...zeilen, aktuellesSchuljahr()])].filter(Boolean).sort().reverse();
}

router.get('/', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const schuljahre = schuljahreFuer(userId);

  // Ein unbekanntes oder unsinniges Schuljahr in der Adresse faellt auf das
  // laufende zurueck, statt eine leere Seite zu zeigen.
  const gewaehlt = String(req.query.schuljahr || '');
  const schuljahr = istSchuljahr(gewaehlt) && schuljahre.includes(gewaehlt) ? gewaehlt : aktuellesSchuljahr();

  const categories = db
    .prepare('SELECT * FROM categories WHERE user_id = ? AND schuljahr = ? AND archived = 0 ORDER BY created_at DESC')
    .all(userId, schuljahr);

  const stats = categories.map((cat) => {
    const sumMinutes = db
      .prepare('SELECT COALESCE(SUM(duration_minutes),0) as minutes FROM time_entries WHERE category_id = ? AND end_time IS NOT NULL')
      .get(cat.id).minutes;
    const ziel = zielZeitstunden(cat);
    return {
      ...cat,
      erfassteStunden: sumMinutes / 60,
      ziel,
      fortschritt: fortschrittProzent(sumMinutes / 60, ziel.stunden),
    };
  });

  // Alle Zuweisungen der Lehrkraft (offen und bereits verknuepft). Solange
  // die bestaetigte Kategorie noch keine Zeiten hat (gesperrt=0), laesst
  // sich die Verknuepfung per Vorschlag/Bestaetigung noch aendern oder
  // aufheben (siehe util/zuweisungen.js).
  const zuweisungen = db
    .prepare(
      `SELECT z.*, sf.zeitstunden_pro_woche * sf.schulwochen as faktor,
              c.title as category_title, vc.title as vorschlag_category_title,
              EXISTS(SELECT 1 FROM time_entries te WHERE te.category_id = z.category_id) as gesperrt
       FROM zuweisungen z
       LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       LEFT JOIN categories c ON c.id = z.category_id
       LEFT JOIN categories vc ON vc.id = z.vorschlag_category_id
       WHERE z.user_id=? AND z.schuljahr=? ORDER BY z.created_at DESC`
    )
    .all(userId, schuljahr);

  // Zuweisungen ausserhalb des gezeigten Schuljahres gehen sonst unter -
  // besonders offene, die noch auf eine Verknuepfung warten.
  const zuweisungenAndereJahre = db
    .prepare(
      `SELECT schuljahr, COUNT(*) as anzahl,
              SUM(CASE WHEN category_id IS NULL THEN 1 ELSE 0 END) as offen
       FROM zuweisungen WHERE user_id=? AND schuljahr<>? GROUP BY schuljahr ORDER BY schuljahr DESC`
    )
    .all(userId, schuljahr);

  const unsyncedCount = db
    .prepare('SELECT COUNT(*) as c FROM time_entries WHERE user_id=? AND synced=0 AND end_time IS NOT NULL')
    .get(userId).c;

  res.render('dashboard', {
    categories: stats,
    zuweisungen,
    zuweisungenAndereJahre,
    schuljahr,
    schuljahre,
    aktuellesSchuljahr: aktuellesSchuljahr(),
    timer: activeTimer(userId),
    unsyncedCount,
    error: ERROR_MESSAGES[req.query.error] || null,
  });
});

router.post('/categories', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  // Das Schuljahr kommt aus der gerade gezeigten Ansicht: wer im Vorjahr
  // etwas nachtraegt, will die Kategorie dort und nicht im laufenden Jahr.
  const schuljahr = istSchuljahr(req.body.schuljahr) ? req.body.schuljahr : aktuellesSchuljahr();
  const zurueck = `/?schuljahr=${encodeURIComponent(schuljahr)}`;
  if (!title) return res.redirect(`${zurueck}&error=titel-fehlt`);

  const zielRoh = req.body.ziel_zeitstunden;
  let ziel = null;
  if (zielRoh) {
    const wert = parseFloat(String(zielRoh).replace(',', '.'));
    if (wert > 0) ziel = wert;
  }

  db.prepare('INSERT INTO categories (user_id, title, schuljahr, ziel_zeitstunden) VALUES (?,?,?,?)').run(
    req.session.user.id,
    title,
    schuljahr,
    ziel
  );
  res.redirect(zurueck);
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
    // Die Kategorie muss zum Schuljahr der Zuweisung gehoeren: der Faktor
    // haengt am Schuljahr der Zuweisung, das Ziel wird ueber die Kategorie
    // angezeigt - ueber Jahresgrenzen hinweg verknuepft ergaebe das Zahlen,
    // die zu keinem der beiden Jahre passen.
    const category = db
      .prepare('SELECT id FROM categories WHERE id=? AND user_id=? AND schuljahr=?')
      .get(req.body.category_id, userId, zuweisung.schuljahr);
    if (!category) return res.redirect('/?error=keine-kategorie');
    categoryId = category.id;
  }

  const ergebnis = vorschlagen(zuweisung, 'lehrkraft', categoryId);
  if (!ergebnis.ok) return res.redirect(`/?error=${ergebnis.fehler}`);
  res.redirect('/');
});

// Nimmt einen offenen Verknuepfungsvorschlag der Schulleitung an.
router.post('/zuweisungen/:id/annehmen', requireAuth, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=? AND user_id=?').get(req.params.id, req.session.user.id);
  if (!zuweisung) return res.redirect('/');
  const ergebnis = annehmen(zuweisung, 'lehrkraft');
  if (!ergebnis.ok) return res.redirect(`/?error=${ergebnis.fehler}`);
  res.redirect('/');
});

// Lehnt einen offenen Verknuepfungsvorschlag der Schulleitung ab - danach
// kann selbst ein anderer Vorschlag gemacht werden.
router.post('/zuweisungen/:id/ablehnen', requireAuth, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=? AND user_id=?').get(req.params.id, req.session.user.id);
  if (!zuweisung) return res.redirect('/');
  const ergebnis = ablehnen(zuweisung, 'lehrkraft');
  if (!ergebnis.ok) return res.redirect(`/?error=${ergebnis.fehler}`);
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

  // Scheitert der Vorschlag doch noch (z. B. weil parallel schon einer
  // eingegangen ist), darf die gerade angelegte Kategorie nicht verwaist
  // stehen bleiben - sie war nur Mittel zum Zweck dieses Vorschlags.
  const ergebnis = vorschlagen(zuweisung, 'lehrkraft', info.lastInsertRowid);
  if (!ergebnis.ok) {
    db.prepare('DELETE FROM categories WHERE id=?').run(info.lastInsertRowid);
    return res.redirect(`/?error=${ergebnis.fehler}`);
  }
  res.redirect('/');
});

router.post('/sync', requireAuth, (req, res) => {
  db.prepare("UPDATE time_entries SET synced=1, synced_at=? WHERE user_id=? AND synced=0 AND end_time IS NOT NULL").run(
    nowLocalString(),
    req.session.user.id
  );
  res.redirect(interneZielseite(req.get('referer')));
});

router.post('/settings/auto-sync', requireAuth, (req, res) => {
  const enabled = req.body.enabled === 'on' ? 1 : 0;
  db.prepare('UPDATE users SET auto_sync=? WHERE id=?').run(enabled, req.session.user.id);
  req.session.user.autoSync = !!enabled;
  res.redirect('/');
});

module.exports = router;
