const router = require('express').Router();
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const ldap = require('../ldap');
const { aktuellesSchuljahr } = require('../util/schuljahr');

const ERROR_MESSAGES = {
  'ungueltige-eingabe': 'Bitte eine gueltige Anzahl Ausgleichsstunden eingeben.',
  'kein-benutzer': 'Bitte zuerst eine Lehrkraft aus der LDAP-Suche auswaehlen.',
  'keine-kategorie': 'Bitte eine Kategorie dieser Lehrkraft auswaehlen.',
  'kein-faktor': 'Bitte zuerst den Faktor fuer dieses Schuljahr festlegen.',
  'ungueltiger-faktor': 'Bitte einen gueltigen Faktor eingeben.',
};

function parseNumber(value) {
  return parseFloat(String(value).replace(',', '.'));
}

function faktorFuer(schuljahr) {
  const row = db.prepare('SELECT faktor FROM schuljahr_faktoren WHERE schuljahr=?').get(schuljahr);
  return row ? row.faktor : null;
}

router.get('/', requireAdmin, (req, res) => {
  const users = db
    .prepare(
      `SELECT u.*,
        (SELECT COUNT(*) FROM zuweisungen z WHERE z.user_id=u.id AND z.category_id IS NULL) as offene_zuweisungen
       FROM users u ORDER BY u.display_name COLLATE NOCASE`
    )
    .all();
  const schuljahr = aktuellesSchuljahr();
  res.render('admin/index', {
    users,
    schuljahr,
    faktor: faktorFuer(schuljahr),
    error: ERROR_MESSAGES[req.query.error] || null,
  });
});

router.post('/faktor', requireAdmin, (req, res) => {
  const f = parseNumber(req.body.faktor);
  if (!(f > 0)) return res.redirect('/admin?error=ungueltiger-faktor');

  db.prepare(
    `INSERT INTO schuljahr_faktoren (schuljahr, faktor, updated_by, updated_at)
     VALUES (?,?,?,datetime('now'))
     ON CONFLICT(schuljahr) DO UPDATE SET faktor=excluded.faktor, updated_by=excluded.updated_by, updated_at=excluded.updated_at`
  ).run(aktuellesSchuljahr(), f, req.session.user.username);

  res.redirect('/admin');
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
    const required = db
      .prepare(
        `SELECT COALESCE(SUM(z.ausgleichsstunden * COALESCE(sf.faktor,0)),0) as h
         FROM zuweisungen z LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
         WHERE z.category_id=?`
      )
      .get(cat.id).h;
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
      requiredHours: required,
      syncedHours: row.synced_minutes / 60,
      unsyncedHours: row.unsynced_minutes / 60,
    };
  });

  const zuweisungen = db
    .prepare(
      `SELECT z.*, COALESCE(sf.faktor,0) as faktor, c.title as category_title
       FROM zuweisungen z
       LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       LEFT JOIN categories c ON c.id = z.category_id
       WHERE z.user_id=? ORDER BY z.created_at DESC`
    )
    .all(teacher.id);

  res.render('admin/user', {
    teacher,
    categories,
    zuweisungen,
    aktuellesSchuljahr: aktuellesSchuljahr(),
    error: ERROR_MESSAGES[req.query.error] || null,
  });
});

router.post('/users/:id/zuweisungen', requireAdmin, (req, res) => {
  const teacher = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!teacher) return res.status(404).render('error', { message: 'Lehrkraft nicht gefunden.' });

  const h = parseNumber(req.body.ausgleichsstunden);
  if (!(h > 0)) return res.redirect(`/admin/users/${teacher.id}?error=ungueltige-eingabe`);

  const schuljahr = aktuellesSchuljahr();
  if (faktorFuer(schuljahr) === null) {
    return res.redirect(`/admin/users/${teacher.id}?error=kein-faktor`);
  }

  // Verknuepfung mit einer Kategorie der Lehrkraft ist optional - der Admin
  // kann die Zuweisung direkt zuordnen, muss aber nicht (dann erledigt es
  // die Lehrkraft selbst im Dashboard ueber "Verknuepfen"/"Uebernehmen").
  let categoryId = null;
  if (req.body.category_id) {
    const category = db
      .prepare('SELECT id FROM categories WHERE id=? AND user_id=?')
      .get(req.body.category_id, teacher.id);
    if (category) categoryId = category.id;
  }

  db.prepare(
    'INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, category_id, created_by) VALUES (?,?,?,?,?)'
  ).run(teacher.id, schuljahr, h, categoryId, req.session.user.username);

  res.redirect(`/admin/users/${teacher.id}`);
});

router.post('/zuweisungen/:id/edit', requireAdmin, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(req.params.id);
  if (!zuweisung) return res.status(404).render('error', { message: 'Zuweisung nicht gefunden.' });

  const h = parseNumber(req.body.ausgleichsstunden);
  if (!(h > 0)) return res.redirect(`/admin/users/${zuweisung.user_id}?error=ungueltige-eingabe`);

  db.prepare('UPDATE zuweisungen SET ausgleichsstunden=? WHERE id=?').run(h, zuweisung.id);
  res.redirect(`/admin/users/${zuweisung.user_id}`);
});

router.post('/zuweisungen/:id/link', requireAdmin, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(req.params.id);
  if (!zuweisung) return res.status(404).render('error', { message: 'Zuweisung nicht gefunden.' });
  if (zuweisung.category_id) return res.redirect(`/admin/users/${zuweisung.user_id}`);

  const category = db
    .prepare('SELECT * FROM categories WHERE id=? AND user_id=?')
    .get(req.body.category_id, zuweisung.user_id);
  if (!category) return res.redirect(`/admin/users/${zuweisung.user_id}?error=keine-kategorie`);

  db.prepare('UPDATE zuweisungen SET category_id=? WHERE id=?').run(category.id, zuweisung.id);
  res.redirect(`/admin/users/${zuweisung.user_id}`);
});

router.post('/categories/:id/archive', requireAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });
  db.prepare('UPDATE categories SET archived = CASE archived WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(cat.id);
  res.redirect(`/admin/users/${cat.user_id}`);
});

router.post('/assign', requireAdmin, (req, res) => {
  const { username, displayName, email, ausgleichsstunden } = req.body;
  if (!username) return res.redirect('/admin?error=kein-benutzer');

  let user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) {
    const info = db
      .prepare('INSERT INTO users (username, display_name, email) VALUES (?,?,?)')
      .run(username, displayName || username, email || null);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  }

  const h = parseNumber(ausgleichsstunden);
  if (!(h > 0)) return res.redirect(`/admin/users/${user.id}?error=ungueltige-eingabe`);

  const schuljahr = aktuellesSchuljahr();
  if (faktorFuer(schuljahr) === null) {
    return res.redirect(`/admin/users/${user.id}?error=kein-faktor`);
  }

  db.prepare('INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, created_by) VALUES (?,?,?,?)').run(
    user.id,
    schuljahr,
    h,
    req.session.user.username
  );

  res.redirect(`/admin/users/${user.id}`);
});

module.exports = router;
