const router = require('express').Router();
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const ldap = require('../ldap');
const { aktuellesSchuljahr } = require('../util/schuljahr');
const { vorschlagen, annehmen, ablehnen, istGesperrt } = require('../util/zuweisungen');

const ERROR_MESSAGES = {
  'ungueltige-eingabe': 'Bitte eine gueltige Anzahl Ausgleichsstunden eingeben.',
  'kein-benutzer': 'Bitte zuerst eine Lehrkraft aus der LDAP-Suche auswaehlen.',
  'keine-kategorie': 'Bitte eine Kategorie dieser Lehrkraft auswaehlen.',
  'kein-faktor': 'Bitte zuerst Zeitstunden pro Woche und Schulwochen fuer dieses Schuljahr festlegen.',
  'ungueltiger-faktor': 'Bitte gueltige Zeitstunden pro Woche und Schulwochen eingeben.',
  'gesperrt': 'Diese Zuweisung ist bereits verknuepft und es wurden dafuer schon Zeiten erfasst - die Verknuepfung kann nicht mehr geaendert werden.',
  'kein-vorschlag': 'Es liegt aktuell kein zu bestaetigender Vorschlag der Lehrkraft vor.',
  'nicht-loeschbar': 'Fuer diese Zuweisung sind bereits Zeiten erfasst - sie kann nicht mehr geloescht werden. Bitte die Lehrkraft bitten, die Zeiten auf eine andere Kategorie zu uebertragen oder die Verknuepfung zu loesen.',
};

function parseNumber(value) {
  return parseFloat(String(value).replace(',', '.'));
}

// Der Faktor wird nicht direkt eingegeben, sondern aus Zeitstunden pro
// Woche x Schulwochen berechnet (z. B. 1,7 x 40 = 68 Zeitstunden je
// Ausgleichsstunde und Schuljahr).
function faktorSettingsFuer(schuljahr) {
  const row = db
    .prepare('SELECT zeitstunden_pro_woche, schulwochen FROM schuljahr_faktoren WHERE schuljahr=?')
    .get(schuljahr);
  if (!row) return null;
  return {
    zeitstundenProWoche: row.zeitstunden_pro_woche,
    schulwochen: row.schulwochen,
    faktor: row.zeitstunden_pro_woche * row.schulwochen,
  };
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
    faktorSettings: faktorSettingsFuer(schuljahr),
    error: ERROR_MESSAGES[req.query.error] || null,
  });
});

router.post('/faktor', requireAdmin, (req, res) => {
  const zeitstunden = parseNumber(req.body.zeitstunden);
  const schulwochen = parseNumber(req.body.schulwochen);
  if (!(zeitstunden > 0) || !(schulwochen > 0)) {
    return res.redirect('/admin?error=ungueltiger-faktor');
  }

  db.prepare(
    `INSERT INTO schuljahr_faktoren (schuljahr, zeitstunden_pro_woche, schulwochen, updated_by, updated_at)
     VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(schuljahr) DO UPDATE SET
       zeitstunden_pro_woche=excluded.zeitstunden_pro_woche,
       schulwochen=excluded.schulwochen,
       updated_by=excluded.updated_by,
       updated_at=excluded.updated_at`
  ).run(aktuellesSchuljahr(), zeitstunden, schulwochen, req.session.user.username);

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

  // Kategorien sind Privatsache der Lehrkraft, solange sie weder explizit
  // freigegeben (visible_for_admin) noch mit einer Zuweisung verknuepft
  // sind (letzteres macht sie automatisch "offiziell") - und werden
  // zusaetzlich sichtbar, sobald die Lehrkraft sie als Verknuepfung
  // vorschlaegt (der Admin muss den Titel ja sehen koennen, um den
  // Vorschlag zu beurteilen).
  const rawCategories = db
    .prepare(
      `SELECT * FROM categories
       WHERE user_id=?
         AND (visible_for_admin=1
              OR EXISTS(SELECT 1 FROM zuweisungen z WHERE z.category_id = categories.id)
              OR EXISTS(SELECT 1 FROM zuweisungen z WHERE z.vorschlag_category_id = categories.id AND z.vorschlag_von='lehrkraft'))
       ORDER BY archived ASC, created_at DESC`
    )
    .all(teacher.id);

  const hiddenCategoryCount = db
    .prepare(
      `SELECT COUNT(*) as c FROM categories
       WHERE user_id=? AND visible_for_admin=0
         AND NOT EXISTS(SELECT 1 FROM zuweisungen z WHERE z.category_id = categories.id)
         AND NOT EXISTS(SELECT 1 FROM zuweisungen z WHERE z.vorschlag_category_id = categories.id AND z.vorschlag_von='lehrkraft')`
    )
    .get(teacher.id).c;

  const categories = rawCategories.map((cat) => {
    // Solange keine Zuweisung verknuepft ist, zeigt auch der Admin das von
    // der Lehrkraft selbst eingetragene vorlaeufige Ziel (ziel_zeitstunden).
    const summe = db
      .prepare(
        `SELECT COALESCE(SUM(z.ausgleichsstunden * COALESCE(sf.zeitstunden_pro_woche * sf.schulwochen,0)),0) as h,
                COUNT(*) as anzahl
         FROM zuweisungen z LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
         WHERE z.category_id=?`
      )
      .get(cat.id);
    const required = summe.anzahl > 0 ? summe.h : cat.ziel_zeitstunden || 0;
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
      `SELECT z.*, COALESCE(sf.zeitstunden_pro_woche * sf.schulwochen,0) as faktor,
              c.title as category_title, vc.title as vorschlag_category_title,
              EXISTS(SELECT 1 FROM time_entries te WHERE te.category_id = z.category_id) as gesperrt
       FROM zuweisungen z
       LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       LEFT JOIN categories c ON c.id = z.category_id
       LEFT JOIN categories vc ON vc.id = z.vorschlag_category_id
       WHERE z.user_id=? ORDER BY z.created_at DESC`
    )
    .all(teacher.id);

  res.render('admin/user', {
    teacher,
    categories,
    hiddenCategoryCount,
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
  if (faktorSettingsFuer(schuljahr) === null) {
    return res.redirect(`/admin/users/${teacher.id}?error=kein-faktor`);
  }

  // Verknuepfung mit einer Kategorie der Lehrkraft ist optional - der Admin
  // kann direkt eine Kategorie vorschlagen, muss aber nicht (dann erledigt
  // es die Lehrkraft selbst im Dashboard). Auch ein direkt bei der
  // Zuweisung angegebener Vorschlag muss von der Lehrkraft noch bestaetigt
  // werden, bevor er wirksam wird (category_id).
  let vorschlagCategoryId = null;
  if (req.body.category_id) {
    const category = db
      .prepare('SELECT id FROM categories WHERE id=? AND user_id=?')
      .get(req.body.category_id, teacher.id);
    if (category) vorschlagCategoryId = category.id;
  }

  db.prepare(
    'INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, vorschlag_category_id, vorschlag_von, created_by) VALUES (?,?,?,?,?,?)'
  ).run(teacher.id, schuljahr, h, vorschlagCategoryId, vorschlagCategoryId ? 'admin' : null, req.session.user.username);

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

// Schlaegt eine (neue oder geaenderte) Verknuepfung vor - wird erst wirksam,
// wenn die Lehrkraft sie annimmt (siehe /zuweisungen/:id/annehmen). Leere
// category_id = Aufhebung der Verknuepfung vorschlagen.
router.post('/zuweisungen/:id/link', requireAdmin, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(req.params.id);
  if (!zuweisung) return res.status(404).render('error', { message: 'Zuweisung nicht gefunden.' });

  let categoryId = null;
  if (req.body.category_id) {
    const category = db
      .prepare('SELECT id FROM categories WHERE id=? AND user_id=?')
      .get(req.body.category_id, zuweisung.user_id);
    if (!category) return res.redirect(`/admin/users/${zuweisung.user_id}?error=keine-kategorie`);
    categoryId = category.id;
  }

  if (!vorschlagen(zuweisung, 'admin', categoryId)) {
    return res.redirect(`/admin/users/${zuweisung.user_id}?error=gesperrt`);
  }
  res.redirect(`/admin/users/${zuweisung.user_id}`);
});

// Nimmt einen offenen Verknuepfungsvorschlag der Lehrkraft an.
router.post('/zuweisungen/:id/annehmen', requireAdmin, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(req.params.id);
  if (!zuweisung) return res.status(404).render('error', { message: 'Zuweisung nicht gefunden.' });
  if (!annehmen(zuweisung, 'admin')) return res.redirect(`/admin/users/${zuweisung.user_id}?error=kein-vorschlag`);
  res.redirect(`/admin/users/${zuweisung.user_id}`);
});

// Lehnt einen offenen Verknuepfungsvorschlag der Lehrkraft ab - die
// Lehrkraft kann anschliessend einen anderen Vorschlag machen.
router.post('/zuweisungen/:id/ablehnen', requireAdmin, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(req.params.id);
  if (!zuweisung) return res.status(404).render('error', { message: 'Zuweisung nicht gefunden.' });
  if (!ablehnen(zuweisung, 'admin')) return res.redirect(`/admin/users/${zuweisung.user_id}?error=kein-vorschlag`);
  res.redirect(`/admin/users/${zuweisung.user_id}`);
});

// Loescht eine faelschlicherweise angelegte Zuweisung wieder vollstaendig -
// nur moeglich, solange dafuer noch keine Zeiten erfasst wurden. Sind
// bereits Zeiten drin, muss die Lehrkraft sie zuerst auf eine andere
// Kategorie uebertragen oder die Verknuepfung loesen (Vorschlag "keine
// Verknuepfung", vom Admin anzunehmen), bevor die Zuweisung geloescht
// werden kann.
router.post('/zuweisungen/:id/delete', requireAdmin, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(req.params.id);
  if (!zuweisung) return res.status(404).render('error', { message: 'Zuweisung nicht gefunden.' });
  if (istGesperrt(zuweisung)) {
    return res.redirect(`/admin/users/${zuweisung.user_id}?error=nicht-loeschbar`);
  }

  db.prepare('DELETE FROM zuweisungen WHERE id=?').run(zuweisung.id);
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
  if (faktorSettingsFuer(schuljahr) === null) {
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
