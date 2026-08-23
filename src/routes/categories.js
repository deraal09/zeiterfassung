const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { nowLocalString, diffMinutes } = require('../util/time');

const ERROR_MESSAGES = {
  'timer-laeuft': 'Es laeuft bereits eine Zeiterfassung. Bitte zuerst stoppen.',
  'felder-fehlen': 'Bitte alle Felder ausfuellen.',
  'ungueltige-zeit': 'Die Endzeit muss nach der Startzeit liegen.',
};

function getOwnedCategory(id, userId) {
  return db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(id, userId);
}

router.get('/categories/:id', requireAuth, (req, res) => {
  const cat = getOwnedCategory(req.params.id, req.session.user.id);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const entries = db.prepare('SELECT * FROM time_entries WHERE category_id=? ORDER BY start_time DESC').all(cat.id);
  const finished = entries.filter((e) => e.end_time);
  const sumMinutes = finished.reduce((a, e) => a + e.duration_minutes, 0);
  const running = entries.find((e) => !e.end_time) || null;

  res.render('category', {
    category: cat,
    entries: finished,
    running,
    erfassteStunden: sumMinutes / 60,
    benoetigteStunden: cat.ausgleichsstunden * cat.faktor,
    error: ERROR_MESSAGES[req.query.error] || null,
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

  const startStr = `${datum} ${von}:00`;
  const endStr = `${datum} ${bis}:00`;
  const duration = diffMinutes(startStr, endStr);
  if (!(duration > 0)) return res.redirect(`/categories/${cat.id}?error=ungueltige-zeit`);

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  db.prepare(
    `INSERT INTO time_entries
       (category_id, user_id, beschreibung, start_time, end_time, duration_minutes, source, synced, synced_at)
     VALUES (?,?,?,?,?,?,'manual',?,?)`
  ).run(
    cat.id,
    userId,
    (beschreibung || 'Taetigkeit').trim(),
    startStr,
    endStr,
    duration,
    user.auto_sync ? 1 : 0,
    user.auto_sync ? nowLocalString() : null
  );

  res.redirect(`/categories/${cat.id}`);
});

module.exports = router;
