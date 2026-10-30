const router = require('express').Router();
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const ldap = require('../ldap');
const { aktuellesSchuljahr, istSchuljahr, schuljahrVerschoben } = require('../util/schuljahr');
const { vorschlagen, annehmen, ablehnen, istGesperrt } = require('../util/zuweisungen');
const { zielZeitstunden } = require('../util/stunden');
const { gesamtPool, poolsMitStand, poolsFuerAuswahl, pruefeZuweisung, bereicheListe, bereicheMitStand } = require('../util/pools');
const { dokumentStatus } = require('../util/dokumente');

const ERROR_MESSAGES = {
  'ungueltige-eingabe': 'Bitte eine gueltige Anzahl Ausgleichsstunden eingeben.',
  'kein-benutzer': 'Bitte zuerst eine Lehrkraft aus der LDAP-Suche auswaehlen.',
  'keine-kategorie': 'Bitte einen Aufgabenbereich dieser Lehrkraft auswaehlen.',
  'kein-faktor': 'Bitte zuerst Zeitstunden pro Woche und Schulwochen fuer dieses Schuljahr festlegen.',
  'ungueltiger-faktor': 'Bitte gueltige Zeitstunden pro Woche und Schulwochen eingeben.',
  'pool-fehlt': 'Bitte einen Pool auswaehlen - jede vergebene Ausgleichsstunde muss einem Pool zugeordnet sein.',
  'pool-unbekannt': 'Der ausgewaehlte Pool existiert nicht.',
  'pool-schuljahr': 'Der Pool gehoert zu einem anderen Schuljahr als die Zuweisung.',
  'pool-voll': 'Im ausgewaehlten Pool sind nicht genug Ausgleichsstunden uebrig.',
  'bereich-ungueltig': 'Der ausgewaehlte Bereich existiert nicht oder gehoert zu einem anderen Schuljahr.',
  'ungueltiges-schuljahr': 'Bitte ein Schuljahr in der Schreibweise 2026/27 angeben.',
  'schuljahr-passt-nicht': 'Der Aufgabenbereich gehoert zu einem anderen Schuljahr als die Zuweisung.',
  'gesperrt': 'Diese Zuweisung ist bereits verknuepft und es wurden dafuer schon Zeiten erfasst - die Verknuepfung kann nur noch die Lehrkraft loesen und danach neu vorschlagen.',
  'kein-vorschlag': 'Es liegt aktuell kein zu bestaetigender Vorschlag der Lehrkraft vor.',
  'vorschlag-ungueltig': 'Der vorgeschlagene Aufgabenbereich existiert nicht mehr. Bitte den Vorschlag ablehnen und neu vorschlagen.',
  'benutzer-nicht-leer':
    'Dieses Konto laesst sich nicht entfernen: es hat bereits Zuweisungen, Aufgabenbereiche oder erfasste Zeiten, oder es war schon einmal angemeldet.',
  'nicht-loeschbar': 'Fuer diese Zuweisung sind bereits Zeiten erfasst - sie kann nicht mehr geloescht werden. Bitte die Lehrkraft bitten, die Verknuepfung zu loesen - die Zeiten bleiben dabei erhalten.',
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

// Meldungstext zu ?error=...; bei einem vollen Pool nennt er zusaetzlich, wie
// viel dort noch frei ist (?frei=...), damit die Korrektur nicht geraten werden muss.
function fehlerMeldung(query) {
  const text = ERROR_MESSAGES[query.error];
  if (!text) return null;
  const frei = parseFloat(query.frei);
  if (query.error === 'pool-voll' && Number.isFinite(frei)) {
    return `${text} Es ${frei === 1 ? 'ist' : 'sind'} nur noch ${frei.toLocaleString('de-DE')} Ausgleichsstunden frei.`;
  }
  return text;
}

// Gemeinsame Pruefung fuer das Vergeben neuer Ausgleichsstunden (Seite
// "Zuweisen" und Lehrkraft-Seite): Stunden, Faktor, Pool samt Restmenge und
// Bereich. Gibt { ok: true, werte } oder { ok: false, fehler, frei } zurueck;
// geschrieben wird erst danach, damit bei einem Fehler nichts halb angelegt ist.
function pruefeNeueZuweisung(body) {
  const h = parseNumber(body.ausgleichsstunden);
  if (!(h > 0)) return { ok: false, fehler: 'ungueltige-eingabe' };

  const schuljahr = istSchuljahr(body.schuljahr) ? body.schuljahr : aktuellesSchuljahr();
  if (faktorSettingsFuer(schuljahr) === null) return { ok: false, fehler: 'kein-faktor' };

  const pool = pruefeZuweisung({ poolId: Number(body.pool_id) || null, schuljahr, stunden: h });
  if (!pool.ok) return { ok: false, fehler: pool.fehler, frei: pool.frei };

  let bereichId = null;
  if (body.bereich_id) {
    const bereich = db.prepare('SELECT id FROM bereiche WHERE id=? AND schuljahr=?').get(Number(body.bereich_id), schuljahr);
    if (!bereich) return { ok: false, fehler: 'bereich-ungueltig' };
    bereichId = bereich.id;
  }
  return { ok: true, werte: { h, schuljahr, poolId: pool.pool.id, bereichId } };
}

function fehlerUrl(basis, ergebnis, schuljahr) {
  const teile = [`error=${ergebnis.fehler}`];
  if (ergebnis.frei !== undefined) teile.push(`frei=${ergebnis.frei}`);
  if (schuljahr) teile.push(`schuljahr=${encodeURIComponent(schuljahr)}`);
  return `${basis}?${teile.join('&')}`;
}

// Startseite des Admin-Bereichs: wenige Kennzahlen und Kacheln zu den
// Ansichten, damit jede Aufgabe mit einem Klick erreichbar ist, ohne dass die
// Seite selbst voll wird. Das Schuljahr kommt aus ?schuljahr (siehe
// middleware/admin-kontext.js).
router.get('/', requireAdmin, (req, res) => {
  const schuljahr = res.locals.adminSchuljahr;
  const zaehle = (sql) => db.prepare(sql).get(schuljahr).n;
  const faktor = faktorSettingsFuer(schuljahr);

  res.render('admin/index', {
    schuljahr,
    gesamt: gesamtPool(schuljahr),
    pools: poolsMitStand(schuljahr),
    anzahlBereiche: zaehle('SELECT COUNT(*) AS n FROM bereiche WHERE schuljahr=?'),
    anzahlLehrkraefte: zaehle('SELECT COUNT(DISTINCT user_id) AS n FROM zuweisungen WHERE schuljahr=?'),
    offeneZuweisungen: zaehle('SELECT COUNT(*) AS n FROM zuweisungen WHERE schuljahr=? AND category_id IS NULL'),
    dokumente: dokumentStatus(schuljahr),
    naechstesSchuljahr: schuljahrVerschoben(schuljahr, 1),
    faktorSettings: faktor,
    error: fehlerMeldung(req.query),
  });
});

// Alle Lehrkraefte mit ihren vergebenen Ausgleichsstunden im gewaehlten
// Schuljahr (Kachelansicht, jede Kachel fuehrt zur Detailseite).
router.get('/lehrkraefte', requireAdmin, (req, res) => {
  const schuljahr = res.locals.adminSchuljahr;
  const users = db
    .prepare(
      `SELECT u.*,
        (SELECT COUNT(*) FROM zuweisungen z WHERE z.user_id=u.id AND z.schuljahr=? AND z.category_id IS NULL) AS offene_zuweisungen,
        (SELECT COALESCE(SUM(z.ausgleichsstunden),0) FROM zuweisungen z WHERE z.user_id=u.id AND z.schuljahr=?) AS summe_ausgleichsstunden,
        (SELECT COUNT(*) FROM zuweisungen z WHERE z.user_id=u.id) AS alle_zuweisungen
       FROM users u ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(schuljahr, schuljahr);
  res.render('admin/lehrkraefte', { schuljahr, users, error: fehlerMeldung(req.query) });
});

// Formular zum Vergeben von Ausgleichsstunden: Person, Stunden, Pool (mit
// Anzeige, wie viel dort schon vergeben und noch frei ist) und Bereich.
router.get('/zuweisen', requireAdmin, (req, res) => {
  const schuljahr = res.locals.adminSchuljahr;
  res.render('admin/zuweisen', {
    schuljahr,
    pools: poolsFuerAuswahl(schuljahr),
    bereiche: bereicheListe(schuljahr),
    faktorSettings: faktorSettingsFuer(schuljahr),
    error: fehlerMeldung(req.query),
  });
});

// Faktor-Pflege (frueher Teil der Startseite): pro Schuljahr Zeitstunden je
// Woche x Schulwochen.
router.get('/faktor', requireAdmin, (req, res) => {
  const schuljahr = res.locals.adminSchuljahr;
  const alleFaktoren = db
    .prepare(
      `SELECT sf.*, sf.zeitstunden_pro_woche * sf.schulwochen AS faktor,
              (SELECT COUNT(*) FROM zuweisungen z WHERE z.schuljahr = sf.schuljahr) AS zuweisungen
       FROM schuljahr_faktoren sf ORDER BY sf.schuljahr DESC`
    )
    .all();
  // Schuljahre mit Zuweisungen, fuer die noch kein Faktor gepflegt ist -
  // dort steht das Stundenziel sonst stillschweigend auf "unbekannt".
  const faktorFehlt = db
    .prepare(
      `SELECT z.schuljahr, COUNT(*) AS zuweisungen FROM zuweisungen z
       LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       WHERE sf.schuljahr IS NULL GROUP BY z.schuljahr ORDER BY z.schuljahr DESC`
    )
    .all();
  res.render('admin/faktor', {
    schuljahr,
    faktorSettings: faktorSettingsFuer(schuljahr),
    alleFaktoren,
    faktorFehlt,
    error: fehlerMeldung(req.query),
  });
});

// Tabellarische Uebersicht der vergebenen Ausgleichsstunden - einmal je
// Kategorie, einmal je Lehrkraft, jeweils fuer ein wählbares Schuljahr.
// Zuweisungen ohne Kategorie-Verknuepfung (category_id NULL) laufen in der
// Kategorie-Tabelle unter einer Sammelzeile "– nicht verknüpft –" je
// Lehrkraft, statt einfach zu fehlen - so ergibt die Summe beider Tabellen
// fuer ein Schuljahr immer denselben Gesamtwert.
router.get('/uebersicht', requireAdmin, (req, res) => {
  const schuljahr = res.locals.adminSchuljahr;
  const schuljahre = res.locals.adminSchuljahre;
  const faktorSettings = faktorSettingsFuer(schuljahr);

  const proKategorie = db
    .prepare(
      `SELECT c.title as kategorie_titel, u.display_name, u.username,
              SUM(z.ausgleichsstunden) as summe
       FROM zuweisungen z
       JOIN categories c ON c.id = z.category_id
       JOIN users u ON u.id = z.user_id
       WHERE z.schuljahr = ?
       GROUP BY c.id
       UNION ALL
       SELECT NULL as kategorie_titel, u.display_name, u.username,
              SUM(z.ausgleichsstunden) as summe
       FROM zuweisungen z
       JOIN users u ON u.id = z.user_id
       WHERE z.schuljahr = ? AND z.category_id IS NULL
       GROUP BY z.user_id
       ORDER BY display_name COLLATE NOCASE, kategorie_titel COLLATE NOCASE`
    )
    .all(schuljahr, schuljahr)
    .map((row) => ({
      ...row,
      zeitstunden: faktorSettings ? row.summe * faktorSettings.faktor : null,
    }));

  const proPerson = db
    .prepare(
      `SELECT u.display_name, u.username,
              SUM(z.ausgleichsstunden) as summe,
              SUM(CASE WHEN z.category_id IS NOT NULL THEN z.ausgleichsstunden ELSE 0 END) as summe_verknuepft,
              SUM(CASE WHEN z.category_id IS NULL THEN z.ausgleichsstunden ELSE 0 END) as summe_offen
       FROM zuweisungen z
       JOIN users u ON u.id = z.user_id
       WHERE z.schuljahr = ?
       GROUP BY u.id
       ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(schuljahr)
    .map((row) => ({
      ...row,
      zeitstunden: faktorSettings ? row.summe * faktorSettings.faktor : null,
    }));

  const gesamt = (zeilen) => zeilen.reduce((s, z) => s + z.summe, 0);

  res.render('admin/uebersicht', {
    schuljahr,
    schuljahre,
    aktuellesSchuljahr: aktuellesSchuljahr(),
    faktorSettings,
    gesamt: gesamtPool(schuljahr),
    pools: poolsMitStand(schuljahr),
    bereiche: bereicheMitStand(schuljahr),
    dokumente: dokumentStatus(schuljahr),
    proKategorie,
    proPerson,
    gesamtKategorie: gesamt(proKategorie),
    gesamtPerson: gesamt(proPerson),
  });
});

router.post('/faktor', requireAdmin, (req, res) => {
  // Frueher wurde immer das laufende Schuljahr geschrieben - ein Vorjahr
  // liess sich damit nicht mehr korrigieren und ein kommendes nicht
  // vorbereiten.
  const schuljahr = req.body.schuljahr || aktuellesSchuljahr();
  if (!istSchuljahr(schuljahr)) return res.redirect('/admin/faktor?error=ungueltiges-schuljahr');

  const zeitstunden = parseNumber(req.body.zeitstunden);
  const schulwochen = parseNumber(req.body.schulwochen);
  if (!(zeitstunden > 0) || !(schulwochen > 0)) {
    return res.redirect(`/admin/faktor?error=ungueltiger-faktor&schuljahr=${encodeURIComponent(schuljahr)}`);
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

  res.redirect(`/admin/faktor?schuljahr=${encodeURIComponent(schuljahr)}`);
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
              p.name AS pool_name, b.name AS bereich_name,
              EXISTS(SELECT 1 FROM time_entries te WHERE te.category_id = z.category_id) as gesperrt
       FROM zuweisungen z
       LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       LEFT JOIN categories c ON c.id = z.category_id
       LEFT JOIN categories vc ON vc.id = z.vorschlag_category_id
       LEFT JOIN pools p ON p.id = z.pool_id
       LEFT JOIN bereiche b ON b.id = z.bereich_id
       WHERE z.user_id=? ORDER BY z.schuljahr DESC, z.created_at DESC`
    )
    .all(teacher.id)
    // Je Zuweisung die Pools und Bereiche IHRES Schuljahres; bei den Pools
    // gilt als frei, was ohne diese eine Zuweisung noch uebrig waere.
    .map((z) => ({
      ...z,
      poolOptionen: poolsFuerAuswahl(z.schuljahr, z),
      bereichOptionen: bereicheListe(z.schuljahr),
    }));

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
    schuljahr: res.locals.adminSchuljahr,
    pools: poolsFuerAuswahl(res.locals.adminSchuljahr),
    bereiche: bereicheListe(res.locals.adminSchuljahr),
    error: fehlerMeldung(req.query),
  });
});

router.post('/users/:id/zuweisungen', requireAdmin, (req, res) => {
  const teacher = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!teacher) return res.status(404).render('error', { message: 'Lehrkraft nicht gefunden.' });

  const zurueck = `/admin/users/${teacher.id}`;
  const pruefung = pruefeNeueZuweisung(req.body);
  if (!pruefung.ok) return res.redirect(fehlerUrl(zurueck, pruefung, req.body.schuljahr));
  const { h, schuljahr, poolId, bereichId } = pruefung.werte;

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
    `INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, pool_id, bereich_id, vorschlag_category_id, vorschlag_von, created_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(teacher.id, schuljahr, h, poolId, bereichId, vorschlagCategoryId, vorschlagCategoryId ? 'admin' : null, req.session.user.username);

  res.redirect(`${zurueck}?schuljahr=${encodeURIComponent(schuljahr)}`);
});

// Aendert Stunden, Pool und Bereich einer Zuweisung. Auch hier gilt die
// Grenze des Pools - die bisherigen Stunden dieser Zuweisung zaehlen dabei
// nicht doppelt (ausserId).
router.post('/zuweisungen/:id/edit', requireAdmin, (req, res) => {
  const zuweisung = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(req.params.id);
  if (!zuweisung) return res.status(404).render('error', { message: 'Zuweisung nicht gefunden.' });

  const zurueck = `/admin/users/${zuweisung.user_id}`;
  const h = parseNumber(req.body.ausgleichsstunden);
  if (!(h > 0)) return res.redirect(fehlerUrl(zurueck, { fehler: 'ungueltige-eingabe' }, zuweisung.schuljahr));

  const poolId = req.body.pool_id ? Number(req.body.pool_id) : zuweisung.pool_id;
  const pool = pruefeZuweisung({ poolId, schuljahr: zuweisung.schuljahr, stunden: h, ausserId: zuweisung.id });
  if (!pool.ok) return res.redirect(fehlerUrl(zurueck, pool, zuweisung.schuljahr));

  let bereichId = null;
  if (req.body.bereich_id) {
    const bereich = db
      .prepare('SELECT id FROM bereiche WHERE id=? AND schuljahr=?')
      .get(Number(req.body.bereich_id), zuweisung.schuljahr);
    if (!bereich) return res.redirect(fehlerUrl(zurueck, { fehler: 'bereich-ungueltig' }, zuweisung.schuljahr));
    bereichId = bereich.id;
  }

  db.prepare('UPDATE zuweisungen SET ausgleichsstunden=?, pool_id=?, bereich_id=? WHERE id=?').run(
    h,
    pool.pool.id,
    bereichId,
    zuweisung.id
  );
  res.redirect(`${zurueck}?schuljahr=${encodeURIComponent(zuweisung.schuljahr)}`);
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
  res.redirect('/admin/lehrkraefte');
});

router.post('/categories/:id/archive', requireAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!cat) return res.status(404).render('error', { message: 'Aufgabenbereich nicht gefunden.' });
  db.prepare('UPDATE categories SET archived = CASE archived WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(cat.id);
  res.redirect(`/admin/users/${cat.user_id}`);
});

// Vergibt Ausgleichsstunden an eine Person (auch an eine noch nicht erfasste -
// sie wird dabei angelegt) aus einem Pool. Erst pruefen, dann schreiben: ein
// Fehler (z. B. voller Pool) darf kein verwaistes Konto hinterlassen.
router.post('/assign', requireAdmin, (req, res) => {
  const { username, displayName, email } = req.body;
  const schuljahr = istSchuljahr(req.body.schuljahr) ? req.body.schuljahr : aktuellesSchuljahr();
  if (!username) return res.redirect(fehlerUrl('/admin/zuweisen', { fehler: 'kein-benutzer' }, schuljahr));

  const pruefung = pruefeNeueZuweisung({ ...req.body, schuljahr });
  if (!pruefung.ok) return res.redirect(fehlerUrl('/admin/zuweisen', pruefung, schuljahr));

  let user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) {
    const info = db
      .prepare('INSERT INTO users (username, display_name, email) VALUES (?,?,?)')
      .run(username, displayName || username, email || null);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  }

  const { h, poolId, bereichId } = pruefung.werte;
  db.prepare(
    'INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, pool_id, bereich_id, created_by) VALUES (?,?,?,?,?,?)'
  ).run(user.id, schuljahr, h, poolId, bereichId, req.session.user.username);

  res.redirect(`/admin/users/${user.id}?schuljahr=${encodeURIComponent(schuljahr)}`);
});

module.exports = router;
