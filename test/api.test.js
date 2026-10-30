const test = require('node:test');
const assert = require('node:assert');
const { frischeUmgebung, ladeSrc } = require('./helpers');

// Startet die API auf einem freien Port, mit zwei Lehrkraeften (je eigenes
// Token), um auch die Trennung der Konten zu pruefen.
async function aufbau() {
  frischeUmgebung();
  const { db, initDb } = ladeSrc('db');
  initDb();
  const express = require('express');
  const { neuesToken } = ladeSrc('util/api-token');

  db.prepare("INSERT INTO users (username, display_name) VALUES ('anna','Anna')").run();
  db.prepare("INSERT INTO users (username, display_name) VALUES ('bernd','Bernd')").run();
  db.prepare("INSERT INTO categories (user_id,title,schuljahr) VALUES (1,'Medienkonzept','2026/27')").run();
  db.prepare("INSERT INTO categories (user_id,title,schuljahr) VALUES (2,'Fremder Bereich','2026/27')").run();

  const tokens = {};
  for (const [name, userId] of [['anna', 1], ['bernd', 2]]) {
    const t = neuesToken();
    db.prepare('INSERT INTO api_tokens (user_id,name,token_hash,token_prefix) VALUES (?,?,?,?)').run(userId, name, t.hash, t.anzeige);
    tokens[name] = t.token;
  }

  const app = express();
  app.use('/api/v1', express.json({ limit: '1mb' }), ladeSrc('routes/api'));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const basis = `http://127.0.0.1:${server.address().port}/api/v1`;

  async function aufruf(methode, pfad, { token = tokens.anna, body, rohBody } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || rohBody !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(basis + pfad, {
      method: methode,
      headers,
      body: rohBody !== undefined ? rohBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  return { db, tokens, aufruf, ende: () => server.close() };
}

const BASIS_EINTRAG = {
  aufgabenbereich_id: 1,
  beschreibung: 'Claude Code: zeiterfassung',
  beginn: '2026-10-08 09:00',
  ende: '2026-10-08 10:30',
};

test('ohne oder mit falschem Token gibt es 401', async () => {
  const { aufruf, ende } = await aufbau();
  try {
    assert.equal((await aufruf('GET', '/me', { token: null })).status, 401);
    const falsch = await aufruf('GET', '/me', { token: 'zt_falsch' });
    assert.equal(falsch.status, 401);
    assert.equal(falsch.json.fehler.code, 'token-ungueltig');
  } finally {
    ende();
  }
});

test('ein widerrufenes Token verliert sofort den Zugriff', async () => {
  const { aufruf, db, ende } = await aufbau();
  try {
    assert.equal((await aufruf('GET', '/me')).status, 200);
    db.prepare('DELETE FROM api_tokens WHERE user_id=1').run();
    assert.equal((await aufruf('GET', '/me')).status, 401);
  } finally {
    ende();
  }
});

test('Aufgabenbereiche: nur die eigenen, und anlegen ist idempotent', async () => {
  const { aufruf, ende } = await aufbau();
  try {
    const liste = await aufruf('GET', '/aufgabenbereiche?schuljahr=2026/27');
    assert.deepEqual(liste.json.aufgabenbereiche.map((b) => b.titel), ['Medienkonzept']);

    const neu = await aufruf('POST', '/aufgabenbereiche', { body: { titel: 'Schulentwicklung', schuljahr: '2026/27' } });
    assert.equal(neu.status, 201);
    assert.equal(neu.json.angelegt, true);

    const nochmal = await aufruf('POST', '/aufgabenbereiche', { body: { titel: 'schulentwicklung', schuljahr: '2026/27' } });
    assert.equal(nochmal.status, 200, 'gleichnamig (ohne Gross-/Kleinschreibung) wird wiederverwendet');
    assert.equal(nochmal.json.id, neu.json.id);
    assert.equal(nochmal.json.angelegt, false);

    assert.equal((await aufruf('POST', '/aufgabenbereiche', { body: { titel: '  ' } })).status, 422);
    assert.equal((await aufruf('GET', '/aufgabenbereiche?schuljahr=quatsch')).status, 422);
  } finally {
    ende();
  }
});

test('Eintrag anlegen, lesen; Beschreibung liegt verschluesselt in der Datenbank', async () => {
  const { aufruf, db, ende } = await aufbau();
  try {
    const res = await aufruf('POST', '/eintraege', { body: BASIS_EINTRAG });
    assert.equal(res.status, 201);
    assert.equal(res.json.eintrag.dauer_minuten, 90);
    assert.equal(res.json.eintrag.beginn, '2026-10-08 09:00:00');
    assert.equal(res.json.eintrag.quelle, 'api');

    const roh = db.prepare('SELECT beschreibung FROM time_entries WHERE id=?').get(res.json.eintrag.id);
    assert.notEqual(roh.beschreibung, BASIS_EINTRAG.beschreibung);

    const liste = await aufruf('GET', '/eintraege?von=2026-10-08&bis=2026-10-08');
    assert.equal(liste.json.eintraege.length, 1);
    assert.equal(liste.json.eintraege[0].beschreibung, BASIS_EINTRAG.beschreibung);
  } finally {
    ende();
  }
});

test('ISO-Zeitstempel mit Zone werden in die Serverzeit umgerechnet (Sommer- und Winterzeit)', async () => {
  const { aufruf, ende } = await aufbau();
  try {
    const sommer = await aufruf('POST', '/eintraege', {
      body: { ...BASIS_EINTRAG, beginn: '2026-10-08T07:30:00Z', ende: '2026-10-08T09:00:30.123Z' },
    });
    assert.equal(sommer.json.eintrag.beginn, '2026-10-08 09:30:00', 'MESZ = UTC+2');
    assert.equal(sommer.json.eintrag.ende, '2026-10-08 11:00:00', 'Sekunden werden verworfen');

    const winter = await aufruf('POST', '/eintraege', {
      body: { ...BASIS_EINTRAG, beginn: '2026-12-01T08:00:00Z', ende: '2026-12-01T09:00:00+00:00' },
    });
    assert.equal(winter.json.eintrag.beginn, '2026-12-01 09:00:00', 'MEZ = UTC+1');
  } finally {
    ende();
  }
});

test('mit external_id ist das Eintragen wiederholbar: unveraendert, dann aktualisiert', async () => {
  const { aufruf, db, ende } = await aufbau();
  try {
    const body = { ...BASIS_EINTRAG, external_id: 'claude:abc:1' };
    const erster = await aufruf('POST', '/eintraege', { body });
    assert.equal(erster.json.status, 'angelegt');

    const zweiter = await aufruf('POST', '/eintraege', { body });
    assert.equal(zweiter.status, 200);
    assert.equal(zweiter.json.status, 'unveraendert');
    assert.equal(zweiter.json.eintrag.id, erster.json.eintrag.id);

    // Die Sitzung wurde laenger: derselbe Schluessel, spaeteres Ende.
    db.prepare('UPDATE time_entries SET synced=1 WHERE id=?').run(erster.json.eintrag.id);
    const dritter = await aufruf('POST', '/eintraege', { body: { ...body, ende: '2026-10-08 11:00' } });
    assert.equal(dritter.json.status, 'aktualisiert');
    assert.equal(dritter.json.eintrag.dauer_minuten, 120);
    assert.equal(dritter.json.eintrag.synchronisiert, false, 'eine Aenderung macht den Eintrag wieder zum Entwurf');

    assert.equal(db.prepare('SELECT COUNT(*) n FROM time_entries').get().n, 1);
  } finally {
    ende();
  }
});

test('dieselbe external_id bei zwei Benutzern kollidiert nicht', async () => {
  const { aufruf, tokens, ende } = await aufbau();
  try {
    const a = await aufruf('POST', '/eintraege', { body: { ...BASIS_EINTRAG, external_id: 'gleich' } });
    const b = await aufruf('POST', '/eintraege', {
      token: tokens.bernd,
      body: { ...BASIS_EINTRAG, aufgabenbereich_id: 2, external_id: 'gleich' },
    });
    assert.equal(a.json.status, 'angelegt');
    assert.equal(b.json.status, 'angelegt');
    assert.notEqual(a.json.eintrag.id, b.json.eintrag.id);
  } finally {
    ende();
  }
});

test('fremde Aufgabenbereiche und Eintraege sind unsichtbar', async () => {
  const { aufruf, tokens, ende } = await aufbau();
  try {
    const fremd = await aufruf('POST', '/eintraege', { body: { ...BASIS_EINTRAG, aufgabenbereich_id: 2 } });
    assert.equal(fremd.status, 404);
    assert.equal(fremd.json.fehler.code, 'aufgabenbereich-unbekannt');

    const meiner = await aufruf('POST', '/eintraege', { body: BASIS_EINTRAG });
    const id = meiner.json.eintrag.id;
    assert.equal((await aufruf('GET', `/eintraege/${id}`, { token: tokens.bernd })).status, 404);
    assert.equal((await aufruf('PATCH', `/eintraege/${id}`, { token: tokens.bernd, body: { beschreibung: 'x' } })).status, 404);
    assert.equal((await aufruf('DELETE', `/eintraege/${id}`, { token: tokens.bernd })).status, 404);
    assert.equal((await aufruf('GET', '/eintraege', { token: tokens.bernd })).json.eintraege.length, 0);
  } finally {
    ende();
  }
});

test('ungueltige Zeiten werden abgelehnt', async () => {
  const { aufruf, ende } = await aufbau();
  try {
    const faelle = [
      [{ ...BASIS_EINTRAG, ende: '2026-10-08 08:00' }, 'ende-vor-beginn'],
      [{ ...BASIS_EINTRAG, ende: '2026-10-10 10:00' }, 'zu-lang'],
      [{ ...BASIS_EINTRAG, beginn: 'gestern' }, 'ungueltiger-zeitpunkt'],
      [{ ...BASIS_EINTRAG, beginn: '2026-13-45 10:00' }, 'ungueltiger-zeitpunkt'],
      [{ ...BASIS_EINTRAG, beginn: undefined }, 'zeitpunkt-fehlt'],
      [{ ...BASIS_EINTRAG, aufgabenbereich_id: undefined }, 'aufgabenbereich-fehlt'],
      [{ ...BASIS_EINTRAG, beschreibung: 5 }, 'beschreibung-ungueltig'],
      [{ ...BASIS_EINTRAG, external_id: '' }, 'external-id-ungueltig'],
    ];
    for (const [body, code] of faelle) {
      const res = await aufruf('POST', '/eintraege', { body });
      assert.equal(res.json.fehler.code, code);
      assert.ok(res.status >= 400 && res.status < 500, `${code}: Status ${res.status}`);
    }
    assert.equal((await aufruf('POST', '/eintraege', { rohBody: '[1,2]' })).status, 400);
  } finally {
    ende();
  }
});

test('Unterthema per Titel; unbekannte Angaben sind ein Fehler, keine stille Umbuchung', async () => {
  const { aufruf, db, ende } = await aufbau();
  try {
    db.prepare("INSERT INTO unterprojekte (category_id,title,ist_auffang) VALUES (1,'Allgemein',1)").run();
    db.prepare("INSERT INTO unterprojekte (category_id,title) VALUES (1,'Kurs B')").run();

    const ohne = await aufruf('POST', '/eintraege', { body: BASIS_EINTRAG });
    assert.equal(ohne.json.eintrag.unterprojekt, 'Allgemein', 'ohne Angabe gilt die Auffang-Regel');

    const mit = await aufruf('POST', '/eintraege', { body: { ...BASIS_EINTRAG, unterprojekt: 'kurs b' } });
    assert.equal(mit.json.eintrag.unterprojekt, 'Kurs B');

    const unbekannt = await aufruf('POST', '/eintraege', { body: { ...BASIS_EINTRAG, unterprojekt: 'Gibt es nicht' } });
    assert.equal(unbekannt.status, 422);
    assert.equal(unbekannt.json.fehler.code, 'unterprojekt-unbekannt');
  } finally {
    ende();
  }
});

test('Sammelabgleich: ein fehlerhafter Eintrag bricht die anderen nicht ab', async () => {
  const { aufruf, db, ende } = await aufbau();
  try {
    const res = await aufruf('POST', '/eintraege/abgleich', {
      body: {
        eintraege: [
          { ...BASIS_EINTRAG, external_id: 'a' },
          { ...BASIS_EINTRAG, external_id: 'b', ende: '2026-10-08 08:00' },
          { ...BASIS_EINTRAG, external_id: 'c', beginn: '2026-10-09 09:00', ende: '2026-10-09 10:00' },
          { ...BASIS_EINTRAG },
        ],
      },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.zusammenfassung, { angelegt: 2, aktualisiert: 0, unveraendert: 0, fehler: 2 });
    assert.equal(res.json.ergebnisse[1].fehler.code, 'ende-vor-beginn');
    assert.equal(res.json.ergebnisse[3].fehler.code, 'external-id-ungueltig', 'im Abgleich ist external_id Pflicht');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM time_entries').get().n, 2);

    const nochmal = await aufruf('POST', '/eintraege/abgleich', {
      body: { eintraege: [{ ...BASIS_EINTRAG, external_id: 'a' }] },
    });
    assert.equal(nochmal.json.zusammenfassung.unveraendert, 1);

    assert.equal((await aufruf('POST', '/eintraege/abgleich', { body: { eintraege: [] } })).status, 422);
  } finally {
    ende();
  }
});

test('Eintrag aendern und loeschen', async () => {
  const { aufruf, ende } = await aufbau();
  try {
    const e = (await aufruf('POST', '/eintraege', { body: BASIS_EINTRAG })).json.eintrag;
    const geaendert = await aufruf('PATCH', `/eintraege/${e.id}`, { body: { ende: '2026-10-08 12:00', beschreibung: 'Neu' } });
    assert.equal(geaendert.json.dauer_minuten, 180);
    assert.equal(geaendert.json.beschreibung, 'Neu');
    assert.equal(geaendert.json.beginn, '2026-10-08 09:00:00', 'nicht uebergebene Felder bleiben');

    assert.equal((await aufruf('PATCH', `/eintraege/${e.id}`, { body: { ende: '2026-10-08 08:00' } })).status, 422);
    assert.equal((await aufruf('DELETE', `/eintraege/${e.id}`)).status, 204);
    assert.equal((await aufruf('GET', `/eintraege/${e.id}`)).status, 404);
  } finally {
    ende();
  }
});

test('Timer: starten, doppelt starten verboten, stoppen', async () => {
  const { aufruf, ende } = await aufbau();
  try {
    assert.equal((await aufruf('GET', '/timer')).json.laeuft, false);
    assert.equal((await aufruf('POST', '/timer/stop')).status, 409);

    const start = await aufruf('POST', '/timer/start', { body: { aufgabenbereich_id: 1, beschreibung: 'Live' } });
    assert.equal(start.status, 201);
    assert.equal(start.json.eintrag.laeuft, true);
    assert.equal((await aufruf('GET', '/me')).json.timer_laeuft, true);

    const doppelt = await aufruf('POST', '/timer/start', { body: { aufgabenbereich_id: 1 } });
    assert.equal(doppelt.status, 409);
    assert.equal(doppelt.json.fehler.code, 'timer-laeuft');
    assert.equal(doppelt.json.fehler.eintrag.id, start.json.eintrag.id);

    assert.equal((await aufruf('PATCH', `/eintraege/${start.json.eintrag.id}`, { body: { beschreibung: 'x' } })).status, 409);

    const stopp = await aufruf('POST', '/timer/stop');
    assert.equal(stopp.json.eintrag.laeuft, false);
    assert.ok(stopp.json.eintrag.dauer_minuten >= 0);
    assert.equal((await aufruf('GET', '/timer')).json.laeuft, false);
  } finally {
    ende();
  }
});

test('unbekannter Endpunkt liefert JSON statt HTML', async () => {
  const { aufruf, ende } = await aufbau();
  try {
    const res = await aufruf('GET', '/gibt-es-nicht');
    assert.equal(res.status, 404);
    assert.equal(res.json.fehler.code, 'nicht-gefunden');
  } finally {
    ende();
  }
});
