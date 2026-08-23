const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { nowLocalString } = require('../util/time');

function activeTimer(userId) {
  return db
    .prepare(
      `SELECT te.*, c.title as category_title FROM time_entries te
       JOIN categories c ON c.id = te.category_id
       WHERE te.user_id = ? AND te.end_time IS NULL`
    )
    .get(userId);
}

router.get('/', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const categories = db
    .prepare('SELECT * FROM categories WHERE user_id = ? AND archived = 0 ORDER BY created_at DESC')
    .all(userId);

  const stats = categories.map((cat) => {
    const sumMinutes = db
      .prepare('SELECT COALESCE(SUM(duration_minutes),0) as minutes FROM time_entries WHERE category_id = ? AND end_time IS NOT NULL')
      .get(cat.id).minutes;
    const benoetigteStunden = cat.ausgleichsstunden * cat.faktor;
    return {
      ...cat,
      erfassteStunden: sumMinutes / 60,
      benoetigteStunden,
    };
  });

  const unsyncedCount = db
    .prepare('SELECT COUNT(*) as c FROM time_entries WHERE user_id=? AND synced=0 AND end_time IS NOT NULL')
    .get(userId).c;

  res.render('dashboard', {
    categories: stats,
    timer: activeTimer(userId),
    unsyncedCount,
  });
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
