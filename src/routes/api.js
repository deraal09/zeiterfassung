const router = require('express').Router();
const { db } = require('../db');
const { encrypt, decrypt } = require('../util/crypto');
const { aktuellesSchuljahr, istSchuljahr } = require('../util/schuljahr');
const { nowLocalString, formatLocal, diffMinutes, normalisiereZeitstempel, parseDatumEingabe, MAX_DAUER_MINUTEN } = require('../util/time');
const { resolveUnterprojektId } = require('../util/unterprojekte');
const { hashToken, tokenAusHeader } = require('../util/api-token');

// REST-API fuer Programme, die im Namen einer Lehrkraft Zeiten lesen und
// schreiben (z. B. der Abgleich mit Claude-Code-Sitzungen, siehe tools/).
//
// Anders als die Oberflaeche arbeitet sie ohne Session und ohne CSRF-Token:
// jeder Aufruf traegt "Authorization: Bearer <Token>". Das Token gehoert genau
// einer Lehrkraft und gibt nur Zugriff auf deren eigene Aufgabenbereiche und
// Zeiten - nie auf den Admin-Bereich oder andere Personen. Eingehaengt wird
// der Router in app.js VOR der Session-/CSRF-Middleware.

const MAX_BESCHREIBUNG = 1000;
const MAX_EXTERNAL_ID = 200;
const MAX_BATCH = 200;

const FEHLER = {
  'token-fehlt': 'Authorization-Header mit "Bearer <Token>" fehlt.',
  'token-ungueltig': 'Das Token ist unbekannt oder wurde widerrufen.',
  'ungueltige-anfrage': 'Der Anfragekoerper muss ein JSON-Objekt sein.',
  'aufgabenbereich-fehlt': 'aufgabenbereich_id fehlt.',
  'aufgabenbereich-unbekannt': 'Der Aufgabenbereich existiert nicht oder gehoert nicht zu diesem Konto.',
  'unterprojekt-unbekannt': 'Das Unterprojekt gehoert nicht zu diesem Aufgabenbereich.',
  'ungueltiger-zeitpunkt':
    'beginn/ende muessen ein gueltiger Zeitpunkt sein: "YYYY-MM-DD HH:MM" (Serverzeit) oder ISO 8601 mit Zone, z. B. "2026-10-08T09:30:00Z".',
  'zeitpunkt-fehlt': 'beginn und ende sind erforderlich.',
  'ende-vor-beginn': 'Das Ende muss nach dem Beginn liegen.',
  'zu-lang': `Ein einzelner Eintrag kann hoechstens ${MAX_DAUER_MINUTEN / 60} Stunden umfassen. Laengere Zeitraeume bitte aufteilen.`,
  'beschreibung-ungueltig': `beschreibung muss ein Text mit hoechstens ${MAX_BESCHREIBUNG} Zeichen sein.`,
  'external-id-ungueltig': `external_id muss ein nichtleerer Text mit hoechstens ${MAX_EXTERNAL_ID} Zeichen sein.`,
  'titel-ungueltig': 'titel muss ein nichtleerer Text mit hoechstens 200 Zeichen sein.',
  'schuljahr-ungueltig': 'schuljahr muss im Format "2026/27" angegeben werden.',
  'eintrag-unbekannt': 'Der Eintrag existiert nicht oder gehoert nicht zu diesem Konto.',
  'eintrag-laeuft': 'Der Eintrag laeuft noch - bitte ueber /timer/stop beenden.',
  'timer-laeuft': 'Es laeuft bereits eine Zeiterfassung. Bitte zuerst stoppen.',
  'kein-timer': 'Es laeuft keine Zeiterfassung.',
  'liste-ungueltig': `eintraege muss eine Liste mit 1 bis ${MAX_BATCH} Eintraegen sein.`,
  'nicht-gefunden': 'Unbekannter Endpunkt.',
  'serverfehler': 'Ein Fehler ist aufgetreten.',
};

class ApiFehler extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function antwortFehler(res, status, code, extra = {}) {
  return res.status(status).json({ fehler: { code, nachricht: FEHLER[code] || code, ...extra } });
}

// --- Authentifizierung ------------------------------------------------------

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function requireToken(req, res, next) {
  const token = tokenAusHeader(req.get('authorization'));
  if (!token) return antwortFehler(res, 401, 'token-fehlt');

  const zeile = db
    .prepare(
      `SELECT t.id AS token_id, u.id, u.username, u.display_name, u.auto_sync
       FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?`
    )
    .get(hashToken(token));
  if (!zeile) return antwortFehler(res, 401, 'token-ungueltig');

  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(zeile.token_id);
  req.apiUser = { id: zeile.id, username: zeile.username, displayName: zeile.display_name, autoSync: !!zeile.auto_sync };
  next();
}

router.use(requireToken);

// Der Body wird von express.json() in app.js gelesen; ein Array oder eine
// nackte Zahl waeren zwar gueltiges JSON, aber kein brauchbarer Eintrag.
function objektKoerper(req) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiFehler(400, 'ungueltige-anfrage');
  return body;
}

// --- Hilfsfunktionen --------------------------------------------------------

function eintragJson(e) {
  return {
    id: e.id,
    aufgabenbereich_id: e.category_id,
    unterprojekt_id: e.unterprojekt_id,
    unterprojekt: e.unterprojekt_title || null,
    beschreibung: decrypt(e.beschreibung),
    beginn: e.start_time,
    ende: e.end_time,
    dauer_minuten: e.duration_minutes,
    laeuft: !e.end_time,
    quelle: e.source,
    external_id: e.external_id,
    synchronisiert: !!e.synced,
  };
}

function ladeEintrag(id, userId) {
  return db
    .prepare(
      `SELECT te.*, up.title AS unterprojekt_title FROM time_entries te
       LEFT JOIN unterprojekte up ON up.id = te.unterprojekt_id
       WHERE te.id = ? AND te.user_id = ?`
    )
    .get(id, userId);
}

function eigenerBereich(userId, id) {
  const zahl = Number(id);
  if (!Number.isInteger(zahl)) return null;
  return db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(zahl, userId) || null;
}

// Akzeptiert "YYYY-MM-DD HH:MM[:SS]" (Serverzeit, wie in der Oberflaeche) und
// ISO 8601 mit Zone ("...Z", "+02:00"). Letzteres wird in die Serverzeit
// umgerechnet - so kann ein Client, der in UTC rechnet (etwa Claude-Code-
// Transkripte), seine Zeitstempel unveraendert schicken. Sekunden werden
// verworfen: alle Eintraege der Anwendung haben Minutengenauigkeit.
const ISO_MIT_ZONE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

function zeitpunktEingabe(wert) {
  if (typeof wert !== 'string') return null;
  const s = wert.trim();
  const mitZone = ISO_MIT_ZONE.exec(s);
  let lokal;
  if (mitZone) {
    const zone = mitZone[4].toUpperCase().replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    const datum = new Date(`${mitZone[1]}T${mitZone[2]}${mitZone[3] || ':00'}${zone}`);
    if (Number.isNaN(datum.getTime())) return null;
    lokal = formatLocal(datum);
  } else {
    lokal = normalisiereZeitstempel(s);
  }
  return lokal ? `${lokal.slice(0, 16)}:00` : null;
}

function baueZeitraum(beginn, ende) {
  if (beginn === undefined || beginn === null || ende === undefined || ende === null) {
    throw new ApiFehler(422, 'zeitpunkt-fehlt');
  }
  const start = zeitpunktEingabe(beginn);
  const end = zeitpunktEingabe(ende);
  if (!start || !end) throw new ApiFehler(422, 'ungueltiger-zeitpunkt');
  const dauer = diffMinutes(start, end);
  if (!(dauer > 0)) throw new ApiFehler(422, 'ende-vor-beginn');
  if (dauer > MAX_DAUER_MINUTEN) throw new ApiFehler(422, 'zu-lang');
  return { start, end, dauer };
}

function pruefeBeschreibung(wert) {
  if (wert === undefined || wert === null) return 'Taetigkeit';
  if (typeof wert !== 'string' || wert.length > MAX_BESCHREIBUNG) throw new ApiFehler(422, 'beschreibung-ungueltig');
  return wert.trim() || 'Taetigkeit';
}

function pruefeExternalId(wert) {
  if (wert === undefined || wert === null) return null;
  if (typeof wert !== 'string' || !wert.trim() || wert.length > MAX_EXTERNAL_ID) {
    throw new ApiFehler(422, 'external-id-ungueltig');
  }
  return wert.trim();
}

// Anders als die Oberflaeche (die eine unbekannte Auswahl stillschweigend auf
// "Allgemein" zurueckfallen laesst) meldet die API ein unbekanntes
// Unterprojekt als Fehler: ein Programm kann nicht sehen, dass seine Angabe
// ins Leere ging, und buchte sonst dauerhaft auf das falsche Unterprojekt.
// Ohne Angabe gilt wie ueberall die Auffang-Regel (resolveUnterprojektId).
function loeseUnterprojekt(cat, body) {
  let gewaehlt = null;
  if (body.unterprojekt_id !== undefined && body.unterprojekt_id !== null) {
    const up = db
      .prepare('SELECT id FROM unterprojekte WHERE id = ? AND category_id = ?')
      .get(Number(body.unterprojekt_id), cat.id);
    if (!up) throw new ApiFehler(422, 'unterprojekt-unbekannt');
    gewaehlt = up.id;
  } else if (typeof body.unterprojekt === 'string' && body.unterprojekt.trim()) {
    const up = db
      .prepare('SELECT id FROM unterprojekte WHERE category_id = ? AND title = ? COLLATE NOCASE')
      .get(cat.id, body.unterprojekt.trim());
    if (!up) throw new ApiFehler(422, 'unterprojekt-unbekannt');
    gewaehlt = up.id;
  }
  return resolveUnterprojektId(cat.id, gewaehlt);
}

// Legt einen abgeschlossenen Eintrag an oder aktualisiert ihn (wenn eine
// external_id des Benutzers schon existiert). Gemeinsame Grundlage fuer
// POST /eintraege und den Sammelabgleich.
//
// War ein Eintrag schon synchronisiert und aendert sich, gilt er wieder als
// Entwurf (ausser bei aktivem Auto-Sync) - dieselbe Regel wie beim Bearbeiten
// in der Oberflaeche, damit der Admin keinen veralteten Wert sieht.
function speichereEintrag(user, body) {
  const externalId = pruefeExternalId(body.external_id);
  const bestehend = externalId
    ? db.prepare('SELECT * FROM time_entries WHERE user_id = ? AND external_id = ?').get(user.id, externalId)
    : null;

  const bereichId = body.aufgabenbereich_id ?? (bestehend ? bestehend.category_id : undefined);
  if (bereichId === undefined || bereichId === null) throw new ApiFehler(422, 'aufgabenbereich-fehlt');
  const cat = eigenerBereich(user.id, bereichId);
  if (!cat) throw new ApiFehler(404, 'aufgabenbereich-unbekannt');

  const zeitraum = baueZeitraum(body.beginn, body.ende);
  const beschreibung = pruefeBeschreibung(body.beschreibung);
  const unterprojektId = loeseUnterprojekt(cat, body);

  if (!bestehend) {
    const info = db
      .prepare(
        `INSERT INTO time_entries
           (category_id, user_id, unterprojekt_id, beschreibung, start_time, end_time, duration_minutes, source, synced, synced_at, external_id)
         VALUES (?,?,?,?,?,?,?,'api',?,?,?)`
      )
      .run(
        cat.id,
        user.id,
        unterprojektId,
        encrypt(beschreibung),
        zeitraum.start,
        zeitraum.end,
        zeitraum.dauer,
        user.autoSync ? 1 : 0,
        user.autoSync ? nowLocalString() : null,
        externalId
      );
    return { status: 'angelegt', id: Number(info.lastInsertRowid) };
  }

  const unveraendert =
    bestehend.category_id === cat.id &&
    bestehend.unterprojekt_id === unterprojektId &&
    bestehend.start_time === zeitraum.start &&
    bestehend.end_time === zeitraum.end &&
    decrypt(bestehend.beschreibung) === beschreibung;
  if (unveraendert) return { status: 'unveraendert', id: bestehend.id };

  db.prepare(
    `UPDATE time_entries SET category_id=?, unterprojekt_id=?, beschreibung=?, start_time=?, end_time=?,
       duration_minutes=?, synced=?, synced_at=? WHERE id=?`
  ).run(
    cat.id,
    unterprojektId,
    encrypt(beschreibung),
    zeitraum.start,
    zeitraum.end,
    zeitraum.dauer,
    user.autoSync ? 1 : 0,
    user.autoSync ? nowLocalString() : null,
    bestehend.id
  );
  return { status: 'aktualisiert', id: bestehend.id };
}

// --- Konto ------------------------------------------------------------------

router.get('/me', (req, res) => {
  const laufend = db.prepare('SELECT 1 FROM time_entries WHERE user_id = ? AND end_time IS NULL').get(req.apiUser.id);
  res.json({
    benutzername: req.apiUser.username,
    anzeigename: req.apiUser.displayName,
    aktuelles_schuljahr: aktuellesSchuljahr(),
    auto_sync: req.apiUser.autoSync,
    timer_laeuft: !!laufend,
    serverzeit: nowLocalString(),
  });
});

// --- Aufgabenbereiche -------------------------------------------------------

function bereichJson(c, unterprojekte) {
  return {
    id: c.id,
    titel: c.title,
    schuljahr: c.schuljahr,
    archiviert: !!c.archived,
    erfasst_stunden: Math.round(((c.minuten || 0) / 60) * 100) / 100,
    unterprojekte: unterprojekte.map((u) => ({ id: u.id, titel: u.title })),
  };
}

// GET /aufgabenbereiche?schuljahr=2026/27|alle&archiviert=1
// Ohne Angabe: nur das laufende Schuljahr, ohne archivierte.
router.get('/aufgabenbereiche', (req, res) => {
  const wunsch = req.query.schuljahr;
  if (wunsch && wunsch !== 'alle' && !istSchuljahr(wunsch)) throw new ApiFehler(422, 'schuljahr-ungueltig');
  const schuljahr = wunsch === 'alle' ? null : wunsch || aktuellesSchuljahr();

  const bedingungen = ['c.user_id = ?'];
  const params = [req.apiUser.id];
  if (schuljahr) {
    bedingungen.push('c.schuljahr = ?');
    params.push(schuljahr);
  }
  if (req.query.archiviert !== '1') bedingungen.push('c.archived = 0');

  const bereiche = db
    .prepare(
      `SELECT c.*, COALESCE((SELECT SUM(te.duration_minutes) FROM time_entries te
                             WHERE te.category_id = c.id AND te.end_time IS NOT NULL), 0) AS minuten
       FROM categories c WHERE ${bedingungen.join(' AND ')} ORDER BY c.schuljahr DESC, c.title COLLATE NOCASE`
    )
    .all(...params);
  const unterprojekte = db.prepare('SELECT id, title FROM unterprojekte WHERE category_id = ? ORDER BY created_at ASC');

  res.json({ aufgabenbereiche: bereiche.map((c) => bereichJson(c, unterprojekte.all(c.id))) });
});

// POST /aufgabenbereiche {titel, schuljahr?} - legt einen Aufgabenbereich an
// oder liefert den gleichnamigen des Schuljahres zurueck. Das macht die
// Zuordnung "Projekt -> Aufgabenbereich" wiederholbar, ohne dass der
// Aufrufer vorher nachsehen muss, ob es ihn schon gibt.
router.post('/aufgabenbereiche', (req, res) => {
  const body = objektKoerper(req);
  const titel = typeof body.titel === 'string' ? body.titel.trim() : '';
  if (!titel || titel.length > 200) throw new ApiFehler(422, 'titel-ungueltig');
  if (body.schuljahr !== undefined && !istSchuljahr(body.schuljahr)) throw new ApiFehler(422, 'schuljahr-ungueltig');
  const schuljahr = body.schuljahr || aktuellesSchuljahr();

  let cat = db
    .prepare(
      `SELECT c.*, 0 AS minuten FROM categories c
       WHERE c.user_id = ? AND c.schuljahr = ? AND c.title = ? COLLATE NOCASE
       ORDER BY c.archived ASC, c.id ASC LIMIT 1`
    )
    .get(req.apiUser.id, schuljahr, titel);
  let angelegt = false;
  if (!cat) {
    const info = db
      .prepare('INSERT INTO categories (user_id, title, schuljahr) VALUES (?,?,?)')
      .run(req.apiUser.id, titel, schuljahr);
    cat = { ...db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid), minuten: 0 };
    angelegt = true;
  }
  const unterprojekte = db.prepare('SELECT id, title FROM unterprojekte WHERE category_id = ?').all(cat.id);
  res.status(angelegt ? 201 : 200).json({ ...bereichJson(cat, unterprojekte), angelegt });
});

// --- Eintraege --------------------------------------------------------------

// GET /eintraege?aufgabenbereich_id=&von=YYYY-MM-DD&bis=YYYY-MM-DD&quelle=&external_id=&limit=&offset=
// "von"/"bis" filtern auf das Datum des Beginns (beide inklusive).
router.get('/eintraege', (req, res) => {
  const bedingungen = ['te.user_id = ?'];
  const params = [req.apiUser.id];

  if (req.query.aufgabenbereich_id !== undefined) {
    bedingungen.push('te.category_id = ?');
    params.push(Number(req.query.aufgabenbereich_id));
  }
  for (const [feld, op] of [['von', '>='], ['bis', '<=']]) {
    if (req.query[feld] === undefined) continue;
    const datum = parseDatumEingabe(req.query[feld]);
    if (!datum) throw new ApiFehler(422, 'ungueltiger-zeitpunkt');
    bedingungen.push(`date(te.start_time) ${op} date(?)`);
    params.push(datum);
  }
  if (typeof req.query.quelle === 'string') {
    bedingungen.push('te.source = ?');
    params.push(req.query.quelle);
  }
  if (typeof req.query.external_id === 'string') {
    bedingungen.push('te.external_id = ?');
    params.push(req.query.external_id);
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const zeilen = db
    .prepare(
      `SELECT te.*, up.title AS unterprojekt_title FROM time_entries te
       LEFT JOIN unterprojekte up ON up.id = te.unterprojekt_id
       WHERE ${bedingungen.join(' AND ')} ORDER BY te.start_time ASC, te.id ASC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({ eintraege: zeilen.map(eintragJson), limit, offset });
});

router.get('/eintraege/:id', (req, res) => {
  const e = ladeEintrag(req.params.id, req.apiUser.id);
  if (!e) throw new ApiFehler(404, 'eintrag-unbekannt');
  res.json(eintragJson(e));
});

// POST /eintraege - legt einen abgeschlossenen Eintrag an. Mit external_id
// idempotent: derselbe Schluessel aktualisiert den vorhandenen Eintrag.
router.post('/eintraege', (req, res) => {
  const ergebnis = speichereEintrag(req.apiUser, objektKoerper(req));
  const eintrag = eintragJson(ladeEintrag(ergebnis.id, req.apiUser.id));
  res.status(ergebnis.status === 'angelegt' ? 201 : 200).json({ status: ergebnis.status, eintrag });
});

// POST /eintraege/abgleich {eintraege: [...]} - mehrere Eintraege auf einmal,
// jeder mit external_id. Ein fehlerhafter Eintrag bricht die uebrigen nicht ab;
// das Ergebnis nennt je Eintrag Status oder Fehler. Alles in einer
// Transaktion, damit ein Abbruch mittendrin keinen halben Stand hinterlaesst.
router.post('/eintraege/abgleich', (req, res) => {
  const body = objektKoerper(req);
  if (!Array.isArray(body.eintraege) || body.eintraege.length < 1 || body.eintraege.length > MAX_BATCH) {
    throw new ApiFehler(422, 'liste-ungueltig');
  }

  const verarbeite = db.transaction((liste) =>
    liste.map((roh, index) => {
      const externalId = roh && typeof roh === 'object' ? roh.external_id ?? null : null;
      try {
        if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw new ApiFehler(400, 'ungueltige-anfrage');
        if (externalId === null) throw new ApiFehler(422, 'external-id-ungueltig');
        const ergebnis = speichereEintrag(req.apiUser, roh);
        return { index, external_id: externalId, status: ergebnis.status, id: ergebnis.id };
      } catch (err) {
        if (!(err instanceof ApiFehler)) throw err;
        return { index, external_id: externalId, status: 'fehler', fehler: { code: err.code, nachricht: FEHLER[err.code] } };
      }
    })
  );
  const ergebnisse = verarbeite(body.eintraege);

  const zaehler = { angelegt: 0, aktualisiert: 0, unveraendert: 0, fehler: 0 };
  ergebnisse.forEach((r) => { zaehler[r.status] += 1; });
  res.json({ zusammenfassung: zaehler, ergebnisse });
});

// PATCH /eintraege/:id - Beschreibung, Zeitraum oder Unterprojekt eines
// abgeschlossenen Eintrags aendern. Nur uebergebene Felder werden geaendert.
router.patch('/eintraege/:id', (req, res) => {
  const body = objektKoerper(req);
  const user = req.apiUser;
  const e = ladeEintrag(req.params.id, user.id);
  if (!e) throw new ApiFehler(404, 'eintrag-unbekannt');
  if (!e.end_time) throw new ApiFehler(409, 'eintrag-laeuft');

  const cat = eigenerBereich(user.id, e.category_id);
  const zeitraum = baueZeitraum(body.beginn ?? e.start_time, body.ende ?? e.end_time);
  const beschreibung = body.beschreibung === undefined ? decrypt(e.beschreibung) : pruefeBeschreibung(body.beschreibung);
  const aendertUnterprojekt = body.unterprojekt_id !== undefined || body.unterprojekt !== undefined;
  const unterprojektId = aendertUnterprojekt ? loeseUnterprojekt(cat, body) : e.unterprojekt_id;

  db.prepare(
    `UPDATE time_entries SET unterprojekt_id=?, beschreibung=?, start_time=?, end_time=?, duration_minutes=?,
       synced=?, synced_at=? WHERE id=?`
  ).run(
    unterprojektId,
    encrypt(beschreibung),
    zeitraum.start,
    zeitraum.end,
    zeitraum.dauer,
    user.autoSync ? 1 : 0,
    user.autoSync ? nowLocalString() : null,
    e.id
  );
  res.json(eintragJson(ladeEintrag(e.id, user.id)));
});

router.delete('/eintraege/:id', (req, res) => {
  const e = ladeEintrag(req.params.id, req.apiUser.id);
  if (!e) throw new ApiFehler(404, 'eintrag-unbekannt');
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(e.id);
  res.status(204).end();
});

// --- Timer ------------------------------------------------------------------

function laufenderEintrag(userId) {
  return db
    .prepare(
      `SELECT te.*, up.title AS unterprojekt_title FROM time_entries te
       LEFT JOIN unterprojekte up ON up.id = te.unterprojekt_id
       WHERE te.user_id = ? AND te.end_time IS NULL`
    )
    .get(userId);
}

router.get('/timer', (req, res) => {
  const e = laufenderEintrag(req.apiUser.id);
  res.json(e ? { laeuft: true, eintrag: eintragJson(e) } : { laeuft: false });
});

// POST /timer/start {aufgabenbereich_id, beschreibung?, unterprojekt(_id)?, external_id?}
router.post('/timer/start', (req, res) => {
  const body = objektKoerper(req);
  const user = req.apiUser;
  if (body.aufgabenbereich_id === undefined || body.aufgabenbereich_id === null) {
    throw new ApiFehler(422, 'aufgabenbereich-fehlt');
  }
  const cat = eigenerBereich(user.id, body.aufgabenbereich_id);
  if (!cat) throw new ApiFehler(404, 'aufgabenbereich-unbekannt');

  const laufend = laufenderEintrag(user.id);
  if (laufend) {
    return antwortFehler(res, 409, 'timer-laeuft', { eintrag: eintragJson(laufend) });
  }

  const externalId = pruefeExternalId(body.external_id);
  if (externalId && db.prepare('SELECT 1 FROM time_entries WHERE user_id = ? AND external_id = ?').get(user.id, externalId)) {
    throw new ApiFehler(422, 'external-id-ungueltig');
  }
  const beschreibung = pruefeBeschreibung(body.beschreibung);
  const unterprojektId = loeseUnterprojekt(cat, body);

  const info = db
    .prepare(
      `INSERT INTO time_entries (category_id, user_id, unterprojekt_id, beschreibung, start_time, source, external_id)
       VALUES (?,?,?,?,?,'api',?)`
    )
    .run(cat.id, user.id, unterprojektId, encrypt(beschreibung), nowLocalString(), externalId);
  res.status(201).json({ laeuft: true, eintrag: eintragJson(ladeEintrag(info.lastInsertRowid, user.id)) });
});

router.post('/timer/stop', (req, res) => {
  const user = req.apiUser;
  const laufend = laufenderEintrag(user.id);
  if (!laufend) throw new ApiFehler(409, 'kein-timer');

  const ende = nowLocalString();
  const dauer = Math.max(diffMinutes(laufend.start_time, ende), 0);
  db.prepare('UPDATE time_entries SET end_time=?, duration_minutes=?, synced=?, synced_at=? WHERE id=?').run(
    ende,
    dauer,
    user.autoSync ? 1 : 0,
    user.autoSync ? nowLocalString() : null,
    laufend.id
  );
  res.json({ laeuft: false, eintrag: eintragJson(ladeEintrag(laufend.id, user.id)) });
});

// --- Fehlerbehandlung -------------------------------------------------------

router.use((req, res) => antwortFehler(res, 404, 'nicht-gefunden'));

// Express erkennt Fehlerbehandler an den vier Parametern.
router.use((err, req, res, next) => {
  if (err instanceof ApiFehler) return antwortFehler(res, err.status, err.code);
  if (err && err.type === 'entity.parse.failed') return antwortFehler(res, 400, 'ungueltige-anfrage');
  console.error(err);
  return antwortFehler(res, 500, 'serverfehler');
});

module.exports = router;
