const router = require('express').Router();
const multer = require('multer');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { nowLocalString, diffMinutes, parseDatumEingabe, parseZeitEingabe } = require('../util/time');
const { parseCsv } = require('../util/csv');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

const ERROR_MESSAGES = {
  'timer-laeuft': 'Es laeuft bereits eine Zeiterfassung. Bitte zuerst stoppen.',
  'felder-fehlen': 'Bitte alle Felder ausfuellen.',
  'ungueltige-zeit': 'Die Endzeit muss nach der Startzeit liegen.',
  'keine-datei': 'Bitte eine CSV-Datei auswaehlen.',
};

function getOwnedCategory(id, userId) {
  return db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(id, userId);
}

function benoetigteStunden(categoryId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(z.ausgleichsstunden * COALESCE(sf.zeitstunden_pro_woche * sf.schulwochen,0)),0) as h
       FROM zuweisungen z LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       WHERE z.category_id=?`
    )
    .get(categoryId).h;
}

// Legt einen manuellen Zeiteintrag an (Datum + Von + Bis, Dauer wird daraus
// berechnet). Gibt die Dauer in Minuten zurueck, oder null bei ungueltiger
// Zeitspanne (Bis <= Von). Wird sowohl vom einzelnen Nachtragen-Formular
// als auch vom CSV-Import verwendet.
function insertManualEntry(cat, userId, { beschreibung, datum, von, bis }, autoSync) {
  const startStr = `${datum} ${von}:00`;
  const endStr = `${datum} ${bis}:00`;
  const duration = diffMinutes(startStr, endStr);
  if (!(duration > 0)) return null;

  db.prepare(
    `INSERT INTO time_entries
       (category_id, user_id, beschreibung, start_time, end_time, duration_minutes, source, synced, synced_at)
     VALUES (?,?,?,?,?,?,'manual',?,?)`
  ).run(
    cat.id,
    userId,
    (beschreibung || '').trim() || 'Taetigkeit',
    startStr,
    endStr,
    duration,
    autoSync ? 1 : 0,
    autoSync ? nowLocalString() : null
  );
  return duration;
}

router.get('/categories/:id', requireAuth, (req, res) => {
  const cat = getOwnedCategory(req.params.id, req.session.user.id);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const entries = db.prepare('SELECT * FROM time_entries WHERE category_id=? ORDER BY start_time DESC').all(cat.id);
  const finished = entries.filter((e) => e.end_time);
  const sumMinutes = finished.reduce((a, e) => a + e.duration_minutes, 0);
  const running = entries.find((e) => !e.end_time) || null;

  const importiert = parseInt(req.query.importiert, 10);
  const uebersprungen = parseInt(req.query.uebersprungen, 10);

  const hatZuweisung = !!db
    .prepare('SELECT 1 FROM zuweisungen WHERE category_id=? LIMIT 1')
    .get(cat.id);

  res.render('category', {
    category: cat,
    entries: finished,
    running,
    erfassteStunden: sumMinutes / 60,
    benoetigteStunden: benoetigteStunden(cat.id),
    hatZuweisung,
    error: ERROR_MESSAGES[req.query.error] || null,
    importInfo: Number.isInteger(importiert) ? { importiert, uebersprungen: uebersprungen || 0 } : null,
  });
});

router.post('/categories/:id/start', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const cat = getOwnedCategory(req.params.id, userId);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const already = db.prepare('SELECT id FROM time_entries WHERE user_id=? AND end_time IS NULL').get(userId);
  if (already) return res.redirect(`/categories/${cat.id}?error=timer-laeuft`);

  const beschreibung = (req.body.beschreibung || '').trim() || 'Taetigkeit';
  db.prepare(
    "INSERT INTO time_entries (category_id, user_id, beschreibung, start_time, source) VALUES (?,?,?,?,'timer')"
  ).run(cat.id, userId, beschreibung, nowLocalString());

  res.redirect(`/categories/${cat.id}`);
});

router.post('/entries/:id/stop', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const entry = db.prepare('SELECT * FROM time_entries WHERE id=? AND user_id=?').get(req.params.id, userId);
  if (!entry) return res.status(404).render('error', { message: 'Eintrag nicht gefunden.' });
  if (entry.end_time) return res.redirect(`/categories/${entry.category_id}`);

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  const endTime = nowLocalString();
  const duration = Math.max(diffMinutes(entry.start_time, endTime), 0);

  db.prepare('UPDATE time_entries SET end_time=?, duration_minutes=?, synced=?, synced_at=? WHERE id=?').run(
    endTime,
    duration,
    user.auto_sync ? 1 : 0,
    user.auto_sync ? nowLocalString() : null,
    entry.id
  );

  res.redirect(`/categories/${entry.category_id}`);
});

router.post('/categories/:id/entries', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const cat = getOwnedCategory(req.params.id, userId);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const { beschreibung, datum, von, bis } = req.body;
  if (!datum || !von || !bis) return res.redirect(`/categories/${cat.id}?error=felder-fehlen`);

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  const duration = insertManualEntry(cat, userId, { beschreibung, datum, von, bis }, !!user.auto_sync);
  if (duration === null) return res.redirect(`/categories/${cat.id}?error=ungueltige-zeit`);

  res.redirect(`/categories/${cat.id}`);
});

router.post('/categories/:id/import', requireAuth, upload.single('csv_file'), (req, res) => {
  const userId = req.session.user.id;
  const cat = getOwnedCategory(req.params.id, userId);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });
  if (!req.file) return res.redirect(`/categories/${cat.id}?error=keine-datei`);

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  const rows = parseCsv(req.file.buffer.toString('utf8'));

  let importiert = 0;
  let uebersprungen = 0;

  const importieren = db.transaction((zeilen) => {
    for (const row of zeilen) {
      const datum = parseDatumEingabe(row['datum'] ?? row['date']);
      const von = parseZeitEingabe(row['von'] ?? row['start']);
      const bis = parseZeitEingabe(row['bis'] ?? row['ende'] ?? row['end']);
      const beschreibung = row['beschreibung'] ?? row['taetigkeit'] ?? '';

      if (!datum || !von || !bis) {
        uebersprungen++;
        continue;
      }
      const duration = insertManualEntry(cat, userId, { beschreibung, datum, von, bis }, !!user.auto_sync);
      if (duration === null) {
        uebersprungen++;
        continue;
      }
      importiert++;
    }
  });
  importieren(rows);

  res.redirect(`/categories/${cat.id}?importiert=${importiert}&uebersprungen=${uebersprungen}`);
});

router.post('/categories/:id/sichtbarkeit', requireAuth, (req, res) => {
  const cat = getOwnedCategory(req.params.id, req.session.user.id);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const sichtbar = req.body.sichtbar === 'on' ? 1 : 0;
  db.prepare('UPDATE categories SET visible_for_admin=? WHERE id=?').run(sichtbar, cat.id);
  res.redirect(`/categories/${cat.id}`);
});

module.exports = router;
