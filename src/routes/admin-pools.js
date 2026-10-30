const router = require('express').Router();
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { aktuellesSchuljahr, istSchuljahr } = require('../util/schuljahr');
const { gesamtPool, poolsMitStand, bereicheMitStand, ladePool, uebernehmen, rund } = require('../util/pools');
const { dokumentStatus } = require('../util/dokumente');

// Pools und Bereiche des Admin-Bereichs: anlegen, aendern, loeschen,
// ins naechste Schuljahr uebernehmen - und die Druckansichten fuer die
// Unterschrift. Das Schuljahr kommt aus ?schuljahr (siehe
// middleware/admin-kontext.js); auf Detailseiten gilt das Schuljahr des
// jeweiligen Pools bzw. Bereichs.

const FEHLER = {
  'name-fehlt': 'Bitte einen Namen eingeben.',
  'name-vergeben': 'In diesem Schuljahr gibt es schon einen Eintrag mit diesem Namen.',
  'stunden-ungueltig': 'Bitte eine gueltige Anzahl Ausgleichsstunden eingeben (groesser als 0).',
  'pool-zu-klein': 'Der Pool kann nicht kleiner sein als die Ausgleichsstunden, die schon daraus vergeben wurden.',
  'pool-nicht-leer': 'Aus diesem Pool sind schon Ausgleichsstunden vergeben - er laesst sich erst loeschen, wenn keine Zuweisung mehr darauf zeigt.',
  'bereich-nicht-leer': 'Diesem Bereich sind noch Zuweisungen zugeordnet - er laesst sich erst loeschen, wenn keine mehr darauf zeigt.',
  'hat-dokumente': 'Zu diesem Eintrag sind unterschriebene Dokumente hinterlegt. Bitte zuerst unter "Dokumente" loeschen.',
  'schuljahr-ungueltig': 'Bitte gueltige, voneinander verschiedene Schuljahre angeben.',
  'nichts-zu-uebernehmen': 'Im ausgewaehlten Schuljahr gibt es nichts zu uebernehmen.',
};

function parseNumber(value) {
  return parseFloat(String(value).replace(',', '.'));
}

function meldungen(query) {
  const fehler = FEHLER[query.error] || null;
  let ok = null;
  if (query.ok === 'uebernommen') {
    const n = (k) => Number(query[k]) || 0;
    ok =
      `Uebernommen: ${n('p')} Pool${n('p') === 1 ? '' : 's'}, ${n('b')} Bereich${n('b') === 1 ? '' : 'e'}, ` +
      `${n('z')} Zuweisung${n('z') === 1 ? '' : 'en'}` +
      (n('u') ? ` (${n('u')} uebersprungen: schon vorhanden oder ohne Platz im Pool)` : '') +
      '.';
  } else if (query.ok === 'gespeichert') ok = 'Gespeichert.';
  else if (query.ok === 'angelegt') ok = 'Angelegt.';
  else if (query.ok === 'geloescht') ok = 'Geloescht.';
  return { error: fehler, ok };
}

// Auf Detailseiten gilt das Schuljahr des angezeigten Eintrags - die
// Unternavigation und die Pool-Anzeige oben rechts sollen dazu passen.
function schuljahrSetzen(res, schuljahr) {
  res.locals.adminSchuljahr = schuljahr;
  if (!res.locals.adminSchuljahre.includes(schuljahr)) res.locals.adminSchuljahre.push(schuljahr);
  res.locals.adminSchuljahre.sort().reverse();
  res.locals.poolBadge = gesamtPool(schuljahr);
}

function zurueck(res, pfad, schuljahr, extra = '') {
  return res.redirect(`/admin/${pfad}?schuljahr=${encodeURIComponent(schuljahr)}${extra}`);
}

function schuljahrAusBody(body) {
  return istSchuljahr(body.schuljahr) ? body.schuljahr : aktuellesSchuljahr();
}

function dokumenteZu(art, zielId) {
  return db
    .prepare('SELECT * FROM admin_dokumente WHERE art=? AND ziel_id IS ? ORDER BY hochgeladen_am DESC, id DESC')
    .all(art, zielId);
}

function faktorFuer(schuljahr) {
  const row = db.prepare('SELECT zeitstunden_pro_woche * schulwochen AS faktor FROM schuljahr_faktoren WHERE schuljahr=?').get(schuljahr);
  return row ? row.faktor : null;
}

// --- Pools ------------------------------------------------------------------

router.get('/pools', requireAdmin, (req, res) => {
  const schuljahr = res.locals.adminSchuljahr;
  const status = dokumentStatus(schuljahr);

  // Quellen fuer "aus einem anderen Schuljahr uebernehmen": alle Schuljahre
  // ausser dem gewaehlten, in denen es Pools oder Bereiche gibt.
  const quellen = db
    .prepare(
      `SELECT schuljahr FROM pools UNION SELECT schuljahr FROM bereiche`
    )
    .all()
    .map((r) => r.schuljahr)
    .filter((s) => s !== schuljahr)
    .sort()
    .reverse();

  res.render('admin/pools', {
    schuljahr,
    pools: poolsMitStand(schuljahr).map((p) => ({
      ...p,
      dokument: (status.proPool.find((x) => x.id === p.id) || {}).dokument || null,
    })),
    gesamt: gesamtPool(schuljahr),
    quellen,
    uebernehmenOffen: req.query.uebernehmen === '1',
    ...meldungen(req.query),
  });
});

router.post('/pools', requireAdmin, (req, res) => {
  const schuljahr = schuljahrAusBody(req.body);
  const name = String(req.body.name || '').trim().slice(0, 100);
  const stunden = parseNumber(req.body.stunden);
  if (!name) return zurueck(res, 'pools', schuljahr, '&error=name-fehlt');
  if (!(stunden > 0)) return zurueck(res, 'pools', schuljahr, '&error=stunden-ungueltig');

  try {
    db.prepare('INSERT INTO pools (schuljahr, name, stunden) VALUES (?,?,?)').run(schuljahr, name, stunden);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return zurueck(res, 'pools', schuljahr, '&error=name-vergeben');
    throw err;
  }
  zurueck(res, 'pools', schuljahr, '&ok=angelegt');
});

router.post('/pools/:id/edit', requireAdmin, (req, res) => {
  const pool = ladePool(req.params.id);
  if (!pool) return res.status(404).render('error', { message: 'Pool nicht gefunden.' });

  const name = String(req.body.name || '').trim().slice(0, 100);
  const stunden = parseNumber(req.body.stunden);
  const rueck = req.body.zurueck === 'detail' ? `pools/${pool.id}` : 'pools';
  if (!name) return zurueck(res, rueck, pool.schuljahr, '&error=name-fehlt');
  if (!(stunden > 0)) return zurueck(res, rueck, pool.schuljahr, '&error=stunden-ungueltig');
  // Ein Pool darf nie unter das schrumpfen, was schon vergeben ist - sonst
  // waere er nachtraeglich ueberzogen.
  if (rund(stunden) < pool.vergeben) return zurueck(res, rueck, pool.schuljahr, '&error=pool-zu-klein');

  try {
    db.prepare('UPDATE pools SET name=?, stunden=? WHERE id=?').run(name, stunden, pool.id);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return zurueck(res, rueck, pool.schuljahr, '&error=name-vergeben');
    throw err;
  }
  zurueck(res, rueck, pool.schuljahr, '&ok=gespeichert');
});

router.post('/pools/:id/delete', requireAdmin, (req, res) => {
  const pool = ladePool(req.params.id);
  if (!pool) return res.status(404).render('error', { message: 'Pool nicht gefunden.' });
  if (pool.anzahlZuweisungen > 0) return zurueck(res, 'pools', pool.schuljahr, '&error=pool-nicht-leer');
  if (db.prepare("SELECT 1 FROM admin_dokumente WHERE art='pool' AND ziel_id=? LIMIT 1").get(pool.id)) {
    return zurueck(res, 'pools', pool.schuljahr, '&error=hat-dokumente');
  }
  db.prepare('DELETE FROM pools WHERE id=?').run(pool.id);
  zurueck(res, 'pools', pool.schuljahr, '&ok=geloescht');
});

router.get('/pools/:id', requireAdmin, (req, res) => {
  const pool = ladePool(req.params.id);
  if (!pool) return res.status(404).render('error', { message: 'Pool nicht gefunden.' });
  schuljahrSetzen(res, pool.schuljahr);

  const faktor = faktorFuer(pool.schuljahr);
  const zuweisungen = db
    .prepare(
      `SELECT z.id, z.ausgleichsstunden, u.id AS user_id, u.display_name, u.username, b.name AS bereich_name
       FROM zuweisungen z JOIN users u ON u.id = z.user_id LEFT JOIN bereiche b ON b.id = z.bereich_id
       WHERE z.pool_id=? ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(pool.id)
    .map((z) => ({ ...z, zeitstunden: faktor ? z.ausgleichsstunden * faktor : null }));

  res.render('admin/pool', {
    pool,
    schuljahr: pool.schuljahr,
    zuweisungen,
    faktor,
    dokumente: dokumenteZu('pool', pool.id),
    ...meldungen(req.query),
  });
});

// --- Bereiche ---------------------------------------------------------------

router.get('/bereiche', requireAdmin, (req, res) => {
  const schuljahr = res.locals.adminSchuljahr;
  const status = dokumentStatus(schuljahr);
  res.render('admin/bereiche', {
    schuljahr,
    bereiche: bereicheMitStand(schuljahr).map((b) => ({
      ...b,
      dokument: (status.proBereich.find((x) => x.id === b.id) || {}).dokument || null,
    })),
    ...meldungen(req.query),
  });
});

router.post('/bereiche', requireAdmin, (req, res) => {
  const schuljahr = schuljahrAusBody(req.body);
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!name) return zurueck(res, 'bereiche', schuljahr, '&error=name-fehlt');
  try {
    db.prepare('INSERT INTO bereiche (schuljahr, name) VALUES (?,?)').run(schuljahr, name);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return zurueck(res, 'bereiche', schuljahr, '&error=name-vergeben');
    throw err;
  }
  zurueck(res, 'bereiche', schuljahr, '&ok=angelegt');
});

router.post('/bereiche/:id/edit', requireAdmin, (req, res) => {
  const bereich = db.prepare('SELECT * FROM bereiche WHERE id=?').get(req.params.id);
  if (!bereich) return res.status(404).render('error', { message: 'Bereich nicht gefunden.' });
  const name = String(req.body.name || '').trim().slice(0, 100);
  const rueck = req.body.zurueck === 'detail' ? `bereiche/${bereich.id}` : 'bereiche';
  if (!name) return zurueck(res, rueck, bereich.schuljahr, '&error=name-fehlt');
  try {
    db.prepare('UPDATE bereiche SET name=? WHERE id=?').run(name, bereich.id);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return zurueck(res, rueck, bereich.schuljahr, '&error=name-vergeben');
    throw err;
  }
  zurueck(res, rueck, bereich.schuljahr, '&ok=gespeichert');
});

router.post('/bereiche/:id/delete', requireAdmin, (req, res) => {
  const bereich = db.prepare('SELECT * FROM bereiche WHERE id=?').get(req.params.id);
  if (!bereich) return res.status(404).render('error', { message: 'Bereich nicht gefunden.' });
  if (db.prepare('SELECT 1 FROM zuweisungen WHERE bereich_id=? LIMIT 1').get(bereich.id)) {
    return zurueck(res, 'bereiche', bereich.schuljahr, '&error=bereich-nicht-leer');
  }
  if (db.prepare("SELECT 1 FROM admin_dokumente WHERE art='bereich' AND ziel_id=? LIMIT 1").get(bereich.id)) {
    return zurueck(res, 'bereiche', bereich.schuljahr, '&error=hat-dokumente');
  }
  db.prepare('DELETE FROM bereiche WHERE id=?').run(bereich.id);
  zurueck(res, 'bereiche', bereich.schuljahr, '&ok=geloescht');
});

router.get('/bereiche/:id', requireAdmin, (req, res) => {
  const bereich = db.prepare('SELECT * FROM bereiche WHERE id=?').get(req.params.id);
  if (!bereich) return res.status(404).render('error', { message: 'Bereich nicht gefunden.' });
  schuljahrSetzen(res, bereich.schuljahr);

  const faktor = faktorFuer(bereich.schuljahr);
  const zuweisungen = db
    .prepare(
      `SELECT z.id, z.ausgleichsstunden, u.id AS user_id, u.display_name, u.username, p.name AS pool_name
       FROM zuweisungen z JOIN users u ON u.id = z.user_id LEFT JOIN pools p ON p.id = z.pool_id
       WHERE z.bereich_id=? ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(bereich.id)
    .map((z) => ({ ...z, zeitstunden: faktor ? z.ausgleichsstunden * faktor : null }));

  res.render('admin/bereich', {
    bereich,
    schuljahr: bereich.schuljahr,
    zuweisungen,
    summe: rund(zuweisungen.reduce((s, z) => s + z.ausgleichsstunden, 0)),
    faktor,
    dokumente: dokumenteZu('bereich', bereich.id),
    ...meldungen(req.query),
  });
});

// --- Ins naechste Schuljahr uebernehmen -------------------------------------

router.post('/schuljahr/uebernehmen', requireAdmin, (req, res) => {
  const nach = schuljahrAusBody({ schuljahr: req.body.nach });
  const von = req.body.von;
  if (!istSchuljahr(von) || von === nach) return zurueck(res, 'pools', nach, '&error=schuljahr-ungueltig');

  const hatInhalt =
    db.prepare('SELECT 1 FROM pools WHERE schuljahr=? LIMIT 1').get(von) ||
    db.prepare('SELECT 1 FROM bereiche WHERE schuljahr=? LIMIT 1').get(von);
  if (!hatInhalt) return zurueck(res, 'pools', nach, '&error=nichts-zu-uebernehmen');

  const e = uebernehmen({ von, nach, mitZuweisungen: req.body.mit_zuweisungen === '1', angelegtVon: req.session.user.username });
  zurueck(res, 'pools', nach, `&ok=uebernommen&p=${e.pools}&b=${e.bereiche}&z=${e.zuweisungen}&u=${e.uebersprungen}`);
});

// --- Druckansichten ---------------------------------------------------------
//
// Eigenstaendige, fuers Papier gestaltete Seiten (views/admin/druck.ejs). Sie
// werden im Browser gedruckt oder als PDF gespeichert, ausgedruckt von der
// Schulleitung und dem OePR unterschrieben und danach als Scan wieder
// hochgeladen (siehe routes/admin-dokumente.js).

function heute() {
  return new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function zahl(wert) {
  return rund(wert).toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

function druckSeite(res, { titel, schuljahr, kennzahlen, tabellen, zurueck: zurueckLink, art, zielId }) {
  const dateiname = `${titel} ${schuljahr}`.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  res.render('admin/druck', { titel, schuljahr, kennzahlen, tabellen, stand: heute(), zurueck: zurueckLink, art, zielId, dateiname });
}

router.get('/druck/pool/:id', requireAdmin, (req, res) => {
  const pool = ladePool(req.params.id);
  if (!pool) return res.status(404).render('error', { message: 'Pool nicht gefunden.' });
  const faktor = faktorFuer(pool.schuljahr);

  const zeilen = db
    .prepare(
      `SELECT u.display_name, u.username, b.name AS bereich, z.ausgleichsstunden
       FROM zuweisungen z JOIN users u ON u.id = z.user_id LEFT JOIN bereiche b ON b.id = z.bereich_id
       WHERE z.pool_id=? ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(pool.id);

  druckSeite(res, {
    titel: `Pool ${pool.name}`,
    schuljahr: pool.schuljahr,
    art: 'pool',
    zielId: pool.id,
    zurueck: `/admin/pools/${pool.id}`,
    kennzahlen: [
      ['Ausgleichsstunden im Pool', zahl(pool.stunden)],
      ['Davon vergeben', zahl(pool.vergeben)],
      ['Noch frei', zahl(pool.frei)],
    ],
    tabellen: [
      {
        ueberschrift: 'Vergebene Ausgleichsstunden',
        spalten: ['Lehrkraft', 'Bereich', 'Ausgleichsstunden', ...(faktor ? ['Zeitstunden'] : [])],
        zahlenspalten: faktor ? [2, 3] : [2],
        zeilen: zeilen.map((z) => [
          `${z.display_name} (${z.username})`,
          z.bereich || '–',
          zahl(z.ausgleichsstunden),
          ...(faktor ? [zahl(z.ausgleichsstunden * faktor)] : []),
        ]),
        summe: ['Summe', '', zahl(pool.vergeben), ...(faktor ? [zahl(pool.vergeben * faktor)] : [])],
        leer: 'Aus diesem Pool sind noch keine Ausgleichsstunden vergeben.',
      },
    ],
  });
});

router.get('/druck/bereich/:id', requireAdmin, (req, res) => {
  const bereich = db.prepare('SELECT * FROM bereiche WHERE id=?').get(req.params.id);
  if (!bereich) return res.status(404).render('error', { message: 'Bereich nicht gefunden.' });
  const faktor = faktorFuer(bereich.schuljahr);

  const zeilen = db
    .prepare(
      `SELECT u.display_name, u.username, p.name AS pool, z.ausgleichsstunden
       FROM zuweisungen z JOIN users u ON u.id = z.user_id LEFT JOIN pools p ON p.id = z.pool_id
       WHERE z.bereich_id=? ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(bereich.id);
  const summe = rund(zeilen.reduce((s, z) => s + z.ausgleichsstunden, 0));
  const personen = new Set(zeilen.map((z) => z.username)).size;

  druckSeite(res, {
    titel: `Bereich ${bereich.name}`,
    schuljahr: bereich.schuljahr,
    art: 'bereich',
    zielId: bereich.id,
    zurueck: `/admin/bereiche/${bereich.id}`,
    kennzahlen: [
      ['Personen', String(personen)],
      ['Ausgleichsstunden insgesamt', zahl(summe)],
    ],
    tabellen: [
      {
        ueberschrift: 'Vergebene Ausgleichsstunden',
        spalten: ['Lehrkraft', 'Pool', 'Ausgleichsstunden', ...(faktor ? ['Zeitstunden'] : [])],
        zahlenspalten: faktor ? [2, 3] : [2],
        zeilen: zeilen.map((z) => [
          `${z.display_name} (${z.username})`,
          z.pool || '–',
          zahl(z.ausgleichsstunden),
          ...(faktor ? [zahl(z.ausgleichsstunden * faktor)] : []),
        ]),
        summe: ['Summe', '', zahl(summe), ...(faktor ? [zahl(summe * faktor)] : [])],
        leer: 'Diesem Bereich sind noch keine Ausgleichsstunden zugeordnet.',
      },
    ],
  });
});

router.get('/druck/uebersicht', requireAdmin, (req, res) => {
  const schuljahr = res.locals.adminSchuljahr;
  const gesamt = gesamtPool(schuljahr);
  const pools = poolsMitStand(schuljahr);
  const bereiche = bereicheMitStand(schuljahr);
  const ohneBereich = db
    .prepare('SELECT COUNT(DISTINCT user_id) AS personen, COALESCE(SUM(ausgleichsstunden),0) AS stunden FROM zuweisungen WHERE schuljahr=? AND bereich_id IS NULL')
    .get(schuljahr);

  const bereichZeilen = bereiche.map((b) => [b.name, String(b.anzahl_personen), zahl(b.stunden)]);
  if (ohneBereich.stunden > 0) bereichZeilen.push(['ohne Bereich', String(ohneBereich.personen), zahl(ohneBereich.stunden)]);

  druckSeite(res, {
    titel: 'Übersicht aller Pools',
    schuljahr,
    art: 'uebersicht',
    zielId: null,
    zurueck: `/admin/uebersicht?schuljahr=${encodeURIComponent(schuljahr)}`,
    kennzahlen: [
      ['Gesamtpool', `${zahl(gesamt.stunden)} Ausgleichsstunden`],
      ['Davon vergeben', zahl(gesamt.vergeben)],
      ['Noch frei', zahl(gesamt.frei)],
    ],
    tabellen: [
      {
        ueberschrift: 'Pools',
        spalten: ['Pool', 'Ausgleichsstunden', 'Vergeben', 'Frei'],
        zahlenspalten: [1, 2, 3],
        zeilen: pools.map((p) => [p.name, zahl(p.stunden), zahl(p.vergeben), zahl(p.frei)]),
        summe: ['Gesamtpool', zahl(gesamt.stunden), zahl(gesamt.vergeben), zahl(gesamt.frei)],
        leer: 'In diesem Schuljahr gibt es noch keinen Pool.',
      },
      {
        ueberschrift: 'Vergebene Ausgleichsstunden je Bereich',
        spalten: ['Bereich', 'Personen', 'Ausgleichsstunden'],
        zahlenspalten: [1, 2],
        zeilen: bereichZeilen,
        summe: null,
        leer: 'Es sind noch keine Ausgleichsstunden vergeben.',
      },
    ],
  });
});

module.exports = router;
