const router = require('express').Router();
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const ldap = require('../ldap');

const ERROR_MESSAGES = {
  'ungueltige-eingabe': 'Bitte Titel, Ausgleichsstunden und Faktor gueltig ausfuellen.',
  'kein-benutzer': 'Bitte zuerst eine Lehrkraft aus der LDAP-Suche auswaehlen.',
};

function parseNumber(value) {
  return parseFloat(String(value).replace(',', '.'));
}

router.get('/', requireAdmin, (req, res) => {
  const users = db
    .prepare(
      `SELECT u.*,
        (SELECT COUNT(*) FROM categories c WHERE c.user_id=u.id AND c.archived=0) as category_count
       FROM users u ORDER BY u.display_name COLLATE NOCASE`
    )
    .all();
  res.render('admin/index', { users, error: ERROR_MESSAGES[req.query.error] || null });
});

router.get('/ldap-search', requireAdmin, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const results = await ldap.searchUsers(q);
    res.json(results);
  } catch (err) {
    console.error('LDAP-Suche fehlgeschlagen:', err.message);
    res.status(500).json({ error: 'LDAP-Suche fehlgeschlagen' });
  }
});

router.get('/users/:id', requireAdmin, (req, res) => {
  const teacher = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!teacher) return res.status(404).render('error', { message: 'Lehrkraft nicht gefunden.' });

  const rawCategories = db
    .prepare('SELECT * FROM categories WHERE user_id=? ORDER BY archived ASC, created_at DESC')
    .all(teacher.id);

  const categories = rawCategories.map((cat) => {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN synced=1 THEN duration_minutes ELSE 0 END),0) as synced_minutes,
           COALESCE(SUM(CASE WHEN synced=0 AND end_time IS NOT NULL THEN duration_minutes ELSE 0 END),0) as unsynced_minutes
         FROM time_entries WHERE category_id=?`
      )
      .get(cat.id);
    return {
      ...cat,
      requiredHours: cat.ausgleichsstunden * cat.faktor,
      syncedHours: row.synced_minutes / 60,
      unsyncedHours: row.unsynced_minutes / 60,
    };
  });

  res.render('admin/user', { teacher, categories, error: ERROR_MESSAGES[req.query.error] || null });
});

router.post('/users/:id/categories', requireAdmin, (req, res) => {
  const teacher = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!teacher) return res.status(404).render('error', { message: 'Lehrkraft nicht gefunden.' });

  const { title, ausgleichsstunden, faktor } = req.body;
  const h = parseNumber(ausgleichsstunden);
  const f = parseNumber(faktor);
  if (!title || !(h > 0) || !(f > 0)) {
    return res.redirect(`/admin/users/${teacher.id}?error=ungueltige-eingabe`);
  }

  db.prepare('INSERT INTO categories (user_id, title, ausgleichsstunden, faktor, created_by) VALUES (?,?,?,?,?)').run(
    teacher.id,
    title.trim(),
    h,
    f,
    req.session.user.username
  );

  res.redirect(`/admin/users/${teacher.id}`);
});

router.post('/categories/:id/archive', requireAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });
  db.prepare('UPDATE categories SET archived = CASE archived WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(cat.id);
  res.redirect(`/admin/users/${cat.user_id}`);
});

router.post('/assign', requireAdmin, (req, res) => {
  const { username, displayName, email, title, ausgleichsstunden, faktor } = req.body;
  if (!username) return res.redirect('/admin?error=kein-benutzer');

  let user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) {
    const info = db
      .prepare('INSERT INTO users (username, display_name, email) VALUES (?,?,?)')
      .run(username, displayName || username, email || null);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  }

  const h = parseNumber(ausgleichsstunden);
  const f = parseNumber(faktor);
  if (!title || !(h > 0) || !(f > 0)) {
    return res.redirect(`/admin/users/${user.id}?error=ungueltige-eingabe`);
  }

  db.prepare('INSERT INTO categories (user_id, title, ausgleichsstunden, faktor, created_by) VALUES (?,?,?,?,?)').run(
    user.id,
    title.trim(),
    h,
    f,
    req.session.user.username
  );

  res.redirect(`/admin/users/${user.id}`);
});

module.exports = router;
