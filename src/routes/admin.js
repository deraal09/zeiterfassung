const router = require('express').Router();
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const ldap = require('../ldap');
const { aktuellesSchuljahr, istSchuljahr } = require('../util/schuljahr');
const { vorschlagen, annehmen, ablehnen, istGesperrt } = require('../util/zuweisungen');
const { zielZeitstunden } = require('../util/stunden');

const ERROR_MESSAGES = {
  'ungueltige-eingabe': 'Bitte eine gueltige Anzahl Ausgleichsstunden eingeben.',
  'kein-benutzer': 'Bitte zuerst eine Lehrkraft aus der LDAP-Suche auswaehlen.',
  'keine-kategorie': 'Bitte eine Kategorie dieser Lehrkraft auswaehlen.',
  'kein-faktor': 'Bitte zuerst Zeitstunden pro Woche und Schulwochen fuer dieses Schuljahr festlegen.',
  'ungueltiger-faktor': 'Bitte gueltige Zeitstunden pro Woche und Schulwochen eingeben.',
  'ungueltiges-schuljahr': 'Bitte ein Schuljahr in der Schreibweise 2026/27 angeben.',
  'schuljahr-passt-nicht': 'Die Kategorie gehoert zu einem anderen Schuljahr als die Zuweisung.',
  'gesperrt': 'Diese Zuweisung ist bereits verknuepft und es wurden dafuer schon Zeiten erfasst - die Verknuepfung kann nicht mehr geaendert werden.',
  'kein-vorschlag': 'Es liegt aktuell kein zu bestaetigender Vorschlag der Lehrkraft vor.',
  'vorschlag-ungueltig': 'Die vorgeschlagene Kategorie existiert nicht mehr. Bitte den Vorschlag ablehnen und neu vorschlagen.',
  'benutzer-nicht-leer':
    'Dieses Konto laesst sich nicht entfernen: es hat bereits Zuweisungen, Kategorien oder erfasste Zeiten, oder es war schon einmal angemeldet.',
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

  // Alle gepflegten Schuljahre, damit sich ein Vorjahr korrigieren und ein
  // kommendes vorbereiten laesst.
  const alleFaktoren = db
    .prepare(
      `SELECT sf.*, sf.zeitstunden_pro_woche * sf.schulwochen as faktor,
              (SELECT COUNT(*) FROM zuweisungen z WHERE z.schuljahr = sf.schuljahr) as zuweisungen
       FROM schuljahr_faktoren sf ORDER BY sf.schuljahr DESC`
    )
    .all();

  // Schuljahre mit Zuweisungen, fuer die noch kein Faktor gepflegt ist -
  // dort steht das Stundenziel sonst stillschweigend auf "unbekannt".
  const faktorFehlt = db
    .prepare(
      `SELECT z.schuljahr, COUNT(*) as zuweisungen FROM zuweisungen z
       LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       WHERE sf.schuljahr IS NULL GROUP BY z.schuljahr ORDER BY z.schuljahr DESC`
    )
    .all();

  res.render('admin/index', {
    users,
    schuljahr,
    faktorSettings: faktorSettingsFuer(schuljahr),
    alleFaktoren,
    faktorFehlt,
    error: ERROR_MESSAGES[req.query.error] || null,
  });
});

router.post('/faktor', requireAdmin, (req, res) => {
  // Frueher wurde immer das laufende Schuljahr geschrieben - ein Vorjahr
  // liess sich damit nicht mehr korrigieren und ein kommendes nicht
  // vorbereiten.
  const schuljahr = req.body.schuljahr || aktuellesSchuljahr();
  if (!istSchuljahr(schuljahr)) return res.redirect('/admin?error=ungueltiges-schuljahr');

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
  ).run(schuljahr, zeitstunden, schulwochen, req.session.user.username);

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
    const ziel = zielZeitstunden(cat);
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
      ziel,
      syncedHours: row.synced_minutes / 60,
      unsyncedHours: row.unsynced_minutes / 60,
    };
  });

  const zuweisungen = db
    .prepare(
      `SELECT z.*, sf.zeitstunden_pro_woche * sf.schulwochen as faktor,
              c.title as category_title, vc.title as vorschlag_category_title,
              EXISTS(SELECT 1 FROM time_entries te WHERE te.category_id = z.category_id) as gesperrt
       FROM zuweisungen z
       LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       LEFT JOIN categories c ON c.id = z.category_id
       LEFT JOIN categories vc ON vc.id = z.vorschlag_category_id
       WHERE z.user_id=? ORDER BY z.created_at DESC`
    )
    .all(teacher.id);

  const zaehleFuerTeacher = (tabelle) =>
    db.prepare(`SELECT COUNT(*) as c FROM ${tabelle} WHERE user_id=?`).get(teacher.id).c;
  const kontoEntfernbar =
    !teacher.last_login &&
    teacher.id !== req.session.user.id &&
    zaehleFuerTeacher('zuweisungen') === 0 &&
    zaehleFuerTeacher('categories') === 0 &&
    zaehleFuerTeacher('time_entries') === 0;

  res.render('admin/user', {
    teacher,
    kontoEntfernbar,
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
      .prepare('SELECT id FROM categories WHERE id=? AND user_id=? AND schuljahr=?')
      .get(req.body.category_id, teacher.id, schuljahr);
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
    // Wie im Dashboard: die Kategorie muss zum Schuljahr der Zuweisung
    // gehoeren, sonst passen Faktor und Stundenziel nicht zusammen.
    const category = db
      .prepare('SELECT id FROM categories WHERE id=? AND user_id=? AND schuljahr=?')
      .get(req.body.category_id, zuweisung.user_id, zuweisung.schuljahr);
    if (!category) return res.redirect(`/admin/users/${zuweisung.user_id}?error=schuljahr-passt-nicht`);
    categoryId = category.id;
  }

  const ergebnis = vorschlagen(zuweisung, 'admin', categoryId);
  if (!ergebnis.ok) {
    return res.redirect(`/admin/users/${zuweisung.user_id}?error=${ergebnis.fehler}`);
  }
  res.redirect(`/admin/users/${zuweisung.user_id}`);
});

// Nimmt einen offenen Verknuepfungsvorschlag der Lehrkraft an.
router.post('/zuweisungen/:id/annehmen', requireAdmin, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(req.params.id);
  if (!zuweisung) return res.status(404).render('error', { message: 'Zuweisung nicht gefunden.' });
  const ergebnis = annehmen(zuweisung, 'admin');
  if (!ergebnis.ok) return res.redirect(`/admin/users/${zuweisung.user_id}?error=${ergebnis.fehler}`);
  res.redirect(`/admin/users/${zuweisung.user_id}`);
});

// Lehnt einen offenen Verknuepfungsvorschlag der Lehrkraft ab - die
// Lehrkraft kann anschliessend einen anderen Vorschlag machen.
router.post('/zuweisungen/:id/ablehnen', requireAdmin, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(req.params.id);
  if (!zuweisung) return res.status(404).render('error', { message: 'Zuweisung nicht gefunden.' });
  const ergebnis = ablehnen(zuweisung, 'admin');
  if (!ergebnis.ok) return res.redirect(`/admin/users/${zuweisung.user_id}?error=${ergebnis.fehler}`);
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

// Entfernt ein Konto, das durch einen Vertipper im Benutzernamen entstanden
// ist. Bewusst nur fuer echte Karteileichen: sobald daran Zuweisungen,
// Kategorien oder Zeiten haengen oder sich jemand damit angemeldet hat,
// bleibt es stehen - ON DELETE CASCADE wuerde sonst stillschweigend erfasste
// Arbeitszeit mitloeschen.
router.post('/users/:id/delete', requireAdmin, (req, res) => {
  const teacher = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!teacher) return res.status(404).render('error', { message: 'Lehrkraft nicht gefunden.' });

  const zaehle = (tabelle) =>
    db.prepare(`SELECT COUNT(*) as c FROM ${tabelle} WHERE user_id=?`).get(teacher.id).c;

  const unberuehrt =
    !teacher.last_login &&
    teacher.id !== req.session.user.id &&
    zaehle('zuweisungen') === 0 &&
    zaehle('categories') === 0 &&
    zaehle('time_entries') === 0;

  if (!unberuehrt) return res.redirect(`/admin/users/${teacher.id}?error=benutzer-nicht-leer`);

  db.prepare('DELETE FROM users WHERE id=?').run(teacher.id);
  res.redirect('/admin');
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
