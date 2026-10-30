const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { frischeUmgebung, ladeSrc } = require('./helpers');

// Startet die Admin-Routen auf einem freien Port. Die Sitzung wird ersetzt:
// der Header x-rolle waehlt zwischen Admin und normaler Lehrkraft, ein
// CSRF-Token ist fest vorgegeben (die echte Pruefung ist in csrf.js getestet
// und hier nur fuer den Upload relevant, der sie selbst aufruft).
async function aufbau() {
  const env = frischeUmgebung();
  const { db, initDb } = ladeSrc('db');
  initDb();
  const express = require('express');

  db.prepare("INSERT INTO users (username, display_name, is_admin) VALUES ('admin','Admin Eins',1)").run();
  db.prepare("INSERT INTO users (username, display_name) VALUES ('anna','Anna Meyer'), ('bernd','Bernd Koch')").run();
  db.prepare("INSERT INTO schuljahr_faktoren (schuljahr, zeitstunden_pro_woche, schulwochen) VALUES ('2026/27', 1.7, 40)").run();
  db.prepare("INSERT INTO pools (schuljahr, name, stunden) VALUES ('2026/27','Digitalisierung',10), ('2026/27','Schulentwicklung',4)").run();
  db.prepare("INSERT INTO bereiche (schuljahr, name) VALUES ('2026/27','Technik'), ('2026/27','Verwaltung')").run();

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.assetVersion = 'test';
  app.locals.zahl = (w) => (Math.round(Number(w) * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    const admin = req.get('x-rolle') !== 'lehrkraft';
    req.session = {
      csrfToken: 'tok',
      user: admin
        ? { id: 1, username: 'admin', displayName: 'Admin Eins', isAdmin: true }
        : { id: 2, username: 'anna', displayName: 'Anna Meyer', isAdmin: false },
    };
    res.locals.user = req.session.user;
    res.locals.csrfToken = 'tok';
    res.locals.cspNonce = 'nonce';
    next();
  });
  app.use(ladeSrc('middleware/admin-kontext').adminKontext);
  app.use('/admin', ladeSrc('routes/admin'));
  app.use('/admin', ladeSrc('routes/admin-pools'));
  app.use('/admin', ladeSrc('routes/admin-dokumente'));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const basis = `http://127.0.0.1:${server.address().port}`;

  async function aufruf(methode, pfad, { form, multipart, rolle } = {}) {
    const headers = {};
    if (rolle) headers['x-rolle'] = rolle;
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: 'tok', ...form }).toString();
    } else if (multipart) {
      body = multipart;
    }
    const res = await fetch(basis + pfad, { method: methode, headers, body, redirect: 'manual' });
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      ort: res.headers.get('location'),
      header: res.headers,
      text: buffer.toString('utf8'),
      buffer,
    };
  }

  const zuweisen = (nutzerId, form) => aufruf('POST', `/admin/users/${nutzerId}/zuweisungen`, { form: { schuljahr: '2026/27', ...form } });

  return { db, env, aufruf, zuweisen, ende: () => server.close() };
}

function dateiFormular({ art, zielId, schuljahr = '2026/27', inhalt, name = 'scan.pdf', quelle = '' }) {
  const form = new FormData();
  form.append('_csrf', 'tok');
  form.append('art', art);
  form.append('ziel_id', zielId === null || zielId === undefined ? '' : String(zielId));
  form.append('schuljahr', schuljahr);
  form.append('quelle', quelle);
  if (inhalt) form.append('datei', new Blob([inhalt]), name);
  return form;
}

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj<<>>endobj\n%%EOF')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

test('Admin-Seiten sind nur fuer Admins erreichbar', async () => {
  const { aufruf, ende } = await aufbau();
  try {
    for (const pfad of ['/admin/pools', '/admin/bereiche', '/admin/dokumente', '/admin/druck/uebersicht', '/admin/pools/1', '/admin/dokumente/1/datei']) {
      const res = await aufruf('GET', pfad, { rolle: 'lehrkraft' });
      assert.equal(res.status, 403, `${pfad} muss fuer Lehrkraefte gesperrt sein`);
    }
    assert.equal((await aufruf('POST', '/admin/pools', { rolle: 'lehrkraft', form: { name: 'X', stunden: '5' } })).status, 403);
  } finally {
    ende();
  }
});

test('alle Admin-Seiten rendern ohne Fehler', async () => {
  const { aufruf, zuweisen, ende } = await aufbau();
  try {
    await zuweisen(2, { ausgleichsstunden: '2.5', pool_id: '1', bereich_id: '1' });
    const seiten = [
      ['/admin', 'Gesamtpool'],
      ['/admin?schuljahr=2026/27', 'Digitalisierung'],
      ['/admin/pools', 'Neuen Pool anlegen'],
      ['/admin/pools/1', 'Vergeben aus diesem Pool'],
      ['/admin/bereiche', 'Neuen Bereich anlegen'],
      ['/admin/bereiche/1', 'Zugeordnete Ausgleichsstunden'],
      ['/admin/lehrkraefte', 'Anna Meyer'],
      ['/admin/zuweisen', 'Ausgleichsstunden zuweisen'],
      ['/admin/faktor', 'Zeitstunden pro Woche'],
      ['/admin/uebersicht', 'Alle Pools'],
      ['/admin/dokumente', 'Was unterschrieben werden muss'],
      ['/admin/users/2', 'Anna Meyer'],
    ];
    for (const [pfad, text] of seiten) {
      const res = await aufruf('GET', pfad);
      assert.equal(res.status, 200, `${pfad}: Status ${res.status}\n${res.text.slice(0, 300)}`);
      assert.ok(res.text.includes(text), `${pfad} zeigt "${text}"`);
    }
    // Die Pool-Leiste (Gesamtpool oben rechts) steht auf jeder Admin-Seite.
    const start = await aufruf('GET', '/admin/bereiche');
    assert.match(start.text, /pool-badge/);
    assert.match(start.text, /14 h/, 'Gesamtpool = 10 + 4 Stunden');
    assert.match(start.text, /2,5 vergeben/);
    assert.match(start.text, /11,5 frei/);
  } finally {
    ende();
  }
});

test('es wird nie mehr vergeben, als der Pool enthaelt', async () => {
  const { db, aufruf, zuweisen, ende } = await aufbau();
  try {
    const ok = await zuweisen(2, { ausgleichsstunden: '6', pool_id: '1' });
    assert.equal(ok.status, 302);
    assert.doesNotMatch(ok.ort, /error=/);

    const zuViel = await zuweisen(3, { ausgleichsstunden: '4.25', pool_id: '1' });
    assert.match(zuViel.ort, /error=pool-voll&frei=4/, 'nennt, wie viel noch frei ist');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM zuweisungen').get().n, 1, 'nichts wurde angelegt');

    const genau = await zuweisen(3, { ausgleichsstunden: '4', pool_id: '1' });
    assert.doesNotMatch(genau.ort, /error=/, 'bis zur Grenze ist erlaubt');
    assert.equal((await zuweisen(3, { ausgleichsstunden: '0.25', pool_id: '1' })).ort.includes('error=pool-voll'), true);

    // Fehlermeldung auf der Seite
    const seite = await aufruf('GET', '/admin/users/3?error=pool-voll&frei=0');
    assert.match(seite.text, /nicht genug Ausgleichsstunden uebrig/);
    assert.match(seite.text, /nur noch 0 Ausgleichsstunden frei/);
  } finally {
    ende();
  }
});

test('Pool ist Pflicht, und Pool und Bereich muessen zum Schuljahr passen', async () => {
  const { db, zuweisen, ende } = await aufbau();
  try {
    db.prepare("INSERT INTO pools (schuljahr, name, stunden) VALUES ('2027/28','Fremdes Jahr',9)").run();
    db.prepare("INSERT INTO bereiche (schuljahr, name) VALUES ('2027/28','Fremder Bereich')").run();
    db.prepare("INSERT INTO schuljahr_faktoren (schuljahr, zeitstunden_pro_woche, schulwochen) VALUES ('2027/28', 1, 40)").run();

    assert.match((await zuweisen(2, { ausgleichsstunden: '1' })).ort, /error=pool-fehlt/);
    assert.match((await zuweisen(2, { ausgleichsstunden: '1', pool_id: '999' })).ort, /error=pool-unbekannt/);
    assert.match((await zuweisen(2, { ausgleichsstunden: '1', pool_id: '3' })).ort, /error=pool-schuljahr/, 'Pool eines anderen Jahres');
    assert.match((await zuweisen(2, { ausgleichsstunden: '1', pool_id: '1', bereich_id: '3' })).ort, /error=bereich-ungueltig/);
    assert.match((await zuweisen(2, { ausgleichsstunden: '0', pool_id: '1' })).ort, /error=ungueltige-eingabe/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM zuweisungen').get().n, 0);

    const gutes = await zuweisen(2, { schuljahr: '2027/28', ausgleichsstunden: '2', pool_id: '3', bereich_id: '3' });
    assert.doesNotMatch(gutes.ort, /error=/);
    assert.equal(db.prepare('SELECT pool_id, bereich_id FROM zuweisungen').get().pool_id, 3);
  } finally {
    ende();
  }
});

test('Ohne Faktor keine Zuweisung', async () => {
  const { db, zuweisen, ende } = await aufbau();
  try {
    db.prepare('DELETE FROM schuljahr_faktoren').run();
    assert.match((await zuweisen(2, { ausgleichsstunden: '1', pool_id: '1' })).ort, /error=kein-faktor/);
  } finally {
    ende();
  }
});

test('Zuweisen an eine neue Person: bei vollem Pool entsteht kein verwaistes Konto', async () => {
  const { db, aufruf, ende } = await aufbau();
  try {
    const voll = await aufruf('POST', '/admin/assign', {
      form: { schuljahr: '2026/27', username: 'neue.person', ausgleichsstunden: '99', pool_id: '1' },
    });
    assert.match(voll.ort, /\/admin\/zuweisen\?error=pool-voll/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE username='neue.person'").get().n, 0);

    const ok = await aufruf('POST', '/admin/assign', {
      form: { schuljahr: '2026/27', username: 'neue.person', displayName: 'Neu Person', ausgleichsstunden: '3', pool_id: '1', bereich_id: '2' },
    });
    assert.match(ok.ort, /^\/admin\/users\/\d+/);
    const z = db.prepare("SELECT z.* FROM zuweisungen z JOIN users u ON u.id=z.user_id WHERE u.username='neue.person'").get();
    assert.equal(z.pool_id, 1);
    assert.equal(z.bereich_id, 2);
  } finally {
    ende();
  }
});

test('Aendern einer Zuweisung beachtet die Pool-Grenze (ohne sich selbst doppelt zu zaehlen)', async () => {
  const { db, aufruf, zuweisen, ende } = await aufbau();
  try {
    await zuweisen(2, { ausgleichsstunden: '8', pool_id: '1' });
    const id = db.prepare('SELECT id FROM zuweisungen').get().id;
    const edit = (form) => aufruf('POST', `/admin/zuweisungen/${id}/edit`, { form });

    assert.doesNotMatch((await edit({ ausgleichsstunden: '10', pool_id: '1' })).ort, /error=/, 'auf die volle Poolgroesse erhoehen');
    assert.match((await edit({ ausgleichsstunden: '10.25', pool_id: '1' })).ort, /error=pool-voll&frei=10/);
    assert.match((await edit({ ausgleichsstunden: '5', pool_id: '2' })).ort, /error=pool-voll&frei=4/, 'der andere Pool hat nur 4');
    assert.doesNotMatch((await edit({ ausgleichsstunden: '3', pool_id: '2', bereich_id: '2' })).ort, /error=/);

    const z = db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(id);
    assert.deepEqual([z.ausgleichsstunden, z.pool_id, z.bereich_id], [3, 2, 2]);
  } finally {
    ende();
  }
});

test('Pools: anlegen, Namen eindeutig, nicht unter das Vergebene verkleinern, loeschen', async () => {
  const { db, aufruf, zuweisen, ende } = await aufbau();
  try {
    const neu = await aufruf('POST', '/admin/pools', { form: { schuljahr: '2026/27', name: 'Fortbildung', stunden: '6,5' } });
    assert.match(neu.ort, /ok=angelegt/);
    assert.equal(db.prepare("SELECT stunden FROM pools WHERE name='Fortbildung'").get().stunden, 6.5);

    assert.match((await aufruf('POST', '/admin/pools', { form: { schuljahr: '2026/27', name: 'fortbildung', stunden: '1' } })).ort, /error=name-vergeben/);
    assert.match((await aufruf('POST', '/admin/pools', { form: { schuljahr: '2026/27', name: '', stunden: '1' } })).ort, /error=name-fehlt/);
    assert.match((await aufruf('POST', '/admin/pools', { form: { schuljahr: '2026/27', name: 'Null', stunden: '0' } })).ort, /error=stunden-ungueltig/);

    await zuweisen(2, { ausgleichsstunden: '7', pool_id: '1' });
    assert.match((await aufruf('POST', '/admin/pools/1/edit', { form: { name: 'Digitalisierung', stunden: '6.75' } })).ort, /error=pool-zu-klein/);
    assert.match((await aufruf('POST', '/admin/pools/1/edit', { form: { name: 'Digitalisierung', stunden: '7' } })).ort, /ok=gespeichert/);

    assert.match((await aufruf('POST', '/admin/pools/1/delete')).ort, /error=pool-nicht-leer/);
    const id = db.prepare("SELECT id FROM pools WHERE name='Fortbildung'").get().id;
    assert.match((await aufruf('POST', `/admin/pools/${id}/delete`)).ort, /ok=geloescht/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM pools WHERE id=?').get(id).n, 0);
  } finally {
    ende();
  }
});

test('Bereiche: anlegen, umbenennen, nur leere loeschen', async () => {
  const { db, aufruf, zuweisen, ende } = await aufbau();
  try {
    assert.match((await aufruf('POST', '/admin/bereiche', { form: { schuljahr: '2026/27', name: 'Pflege' } })).ort, /ok=angelegt/);
    assert.match((await aufruf('POST', '/admin/bereiche', { form: { schuljahr: '2026/27', name: 'technik' } })).ort, /error=name-vergeben/);
    assert.match((await aufruf('POST', '/admin/bereiche/1/edit', { form: { name: 'Technik und IT' } })).ort, /ok=gespeichert/);

    await zuweisen(2, { ausgleichsstunden: '1', pool_id: '1', bereich_id: '1' });
    assert.match((await aufruf('POST', '/admin/bereiche/1/delete')).ort, /error=bereich-nicht-leer/);
    const leer = db.prepare("SELECT id FROM bereiche WHERE name='Pflege'").get().id;
    assert.match((await aufruf('POST', `/admin/bereiche/${leer}/delete`)).ort, /ok=geloescht/);
  } finally {
    ende();
  }
});

test('Uebernahme ins naechste Schuljahr per Formular', async () => {
  const { db, aufruf, zuweisen, ende } = await aufbau();
  try {
    await zuweisen(2, { ausgleichsstunden: '3', pool_id: '1', bereich_id: '1' });
    const res = await aufruf('POST', '/admin/schuljahr/uebernehmen', { form: { von: '2026/27', nach: '2027/28', mit_zuweisungen: '1' } });
    assert.match(res.ort, /schuljahr=2027%2F28&ok=uebernommen&p=2&b=2&z=1&u=0/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM pools WHERE schuljahr='2027/28'").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM zuweisungen WHERE schuljahr='2027/28'").get().n, 1);

    const seite = await aufruf('GET', '/admin/pools?schuljahr=2027/28&ok=uebernommen&p=2&b=2&z=1&u=0');
    assert.match(seite.text, /Uebernommen: 2 Pools, 2 Bereiche, 1 Zuweisung\./);

    assert.match((await aufruf('POST', '/admin/schuljahr/uebernehmen', { form: { von: '2026/27', nach: '2026/27' } })).ort, /error=schuljahr-ungueltig/);
    assert.match((await aufruf('POST', '/admin/schuljahr/uebernehmen', { form: { von: '2020/21', nach: '2027/28' } })).ort, /error=nichts-zu-uebernehmen/);
  } finally {
    ende();
  }
});

test('Druckansichten enthalten unten Schulleitung (links) und OePR (rechts)', async () => {
  const { aufruf, zuweisen, ende } = await aufbau();
  try {
    await zuweisen(2, { ausgleichsstunden: '2.5', pool_id: '1', bereich_id: '1' });
    for (const pfad of ['/admin/druck/pool/1', '/admin/druck/bereich/1', '/admin/druck/uebersicht?schuljahr=2026/27']) {
      const res = await aufruf('GET', pfad);
      assert.equal(res.status, 200, pfad);
      const links = res.text.indexOf('Schulleitung');
      const rechts = res.text.indexOf('ÖPR (Örtlicher Personalrat)');
      assert.ok(links > 0 && rechts > links, `${pfad}: Schulleitung steht vor (links von) dem OePR`);
      assert.match(res.text, /class="unterschriften"/);
      assert.match(res.text, /Schuljahr 2026\/27/);
    }
    const pool = (await aufruf('GET', '/admin/druck/pool/1')).text;
    assert.match(pool, /Anna Meyer/);
    assert.match(pool, /2,5/);
    assert.match(pool, /7,5/, 'noch frei: 10 - 2,5');
    assert.match(pool, /Zeitstunden/, 'mit Faktor wird die Zeitstunden-Spalte gedruckt');
    const uebersicht = (await aufruf('GET', '/admin/druck/uebersicht?schuljahr=2026/27')).text;
    assert.match(uebersicht, /Gesamtpool/);
    assert.match(uebersicht, /Schulentwicklung/);

    assert.equal((await aufruf('GET', '/admin/druck/pool/999')).status, 404);
    assert.equal((await aufruf('GET', '/admin/druck/bereich/999')).status, 404);
  } finally {
    ende();
  }
});

test('Upload: PDF und Bild werden angenommen, eingeordnet, ausgeliefert und geloescht', async () => {
  const { db, env, aufruf, ende } = await aufbau();
  try {
    const pdf = await aufruf('POST', '/admin/dokumente', { multipart: dateiFormular({ art: 'pool', zielId: 1, inhalt: PDF, name: 'pool-unterschrieben.pdf', quelle: 'detail' }) });
    assert.match(pdf.ort, /\/admin\/pools\/1\?ok=hochgeladen/);
    const png = await aufruf('POST', '/admin/dokumente', { multipart: dateiFormular({ art: 'uebersicht', zielId: null, inhalt: PNG, name: 'scan.png' }) });
    assert.match(png.ort, /\/admin\/uebersicht\?schuljahr=2026%2F27&ok=hochgeladen/);

    const zeilen = db.prepare('SELECT * FROM admin_dokumente ORDER BY id').all();
    assert.equal(zeilen.length, 2);
    assert.deepEqual([zeilen[0].art, zeilen[0].ziel_id, zeilen[0].schuljahr, zeilen[0].mime], ['pool', 1, '2026/27', 'application/pdf']);
    assert.equal(zeilen[1].mime, 'image/png');
    assert.equal(zeilen[1].ziel_id, null);
    assert.match(zeilen[0].datei, /^[0-9a-f]{32}\.pdf$/, 'Zufallsname statt Originalname');

    const speicherort = path.join(path.dirname(env.dbPfad), 'uploads', zeilen[0].datei);
    assert.ok(fs.existsSync(speicherort));

    const datei = await aufruf('GET', `/admin/dokumente/${zeilen[0].id}/datei`);
    assert.equal(datei.status, 200);
    assert.equal(datei.header.get('content-type'), 'application/pdf');
    assert.match(datei.header.get('content-disposition'), /^inline/);
    assert.equal(datei.header.get('content-security-policy'), null);
    assert.deepEqual(datei.buffer, PDF);
    assert.match((await aufruf('GET', `/admin/dokumente/${zeilen[0].id}/datei?download=1`)).header.get('content-disposition'), /^attachment/);

    const seite = await aufruf('GET', '/admin/dokumente');
    assert.match(seite.text, /2 Dateien|Alle hochgeladenen Dateien/);
    assert.match(seite.text, /pool-unterschrieben\.pdf/);
    assert.match(seite.text, /2 von 5/, 'Uebersicht + 2 Pools + 2 Bereiche = 5; zwei davon haben ein Dokument');

    assert.match((await aufruf('POST', `/admin/dokumente/${zeilen[0].id}/loeschen`)).ort, /ok=geloescht/);
    assert.equal(fs.existsSync(speicherort), false, 'die Datei ist auch auf der Platte weg');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_dokumente').get().n, 1);
  } finally {
    ende();
  }
});

test('Upload: falsche Dateitypen, fehlende Datei, falsches Ziel und zu grosse Dateien werden abgelehnt', async () => {
  const { db, aufruf, ende } = await aufbau();
  try {
    const html = await aufruf('POST', '/admin/dokumente', {
      multipart: dateiFormular({ art: 'pool', zielId: 1, inhalt: Buffer.from('<html><script>alert(1)</script></html>'), name: 'scan.pdf' }),
    });
    assert.match(html.ort, /error=falscher-typ/, 'HTML mit .pdf-Endung wird am Inhalt erkannt');

    const exe = await aufruf('POST', '/admin/dokumente', {
      multipart: dateiFormular({ art: 'pool', zielId: 1, inhalt: Buffer.from('MZ\x90\x00'), name: 'x.png' }),
    });
    assert.match(exe.ort, /error=falscher-typ/);

    assert.match(
      (await aufruf('POST', '/admin/dokumente', { multipart: dateiFormular({ art: 'pool', zielId: 1 }) })).ort,
      /error=keine-datei/
    );
    assert.match(
      (await aufruf('POST', '/admin/dokumente', { multipart: dateiFormular({ art: 'pool', zielId: 999, inhalt: PDF }) })).ort,
      /error=ziel-unbekannt/
    );
    assert.match(
      (await aufruf('POST', '/admin/dokumente', { multipart: dateiFormular({ art: 'pool', zielId: 1, schuljahr: '2027/28', inhalt: PDF }) })).ort,
      /error=ziel-unbekannt/,
      'Pool gehoert zu einem anderen Schuljahr'
    );
    assert.match(
      (await aufruf('POST', '/admin/dokumente', { multipart: dateiFormular({ art: 'geheim', zielId: 1, inhalt: PDF }) })).ort,
      /error=ungueltige-eingabe/
    );

    const gross = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(15 * 1024 * 1024 + 10)]);
    assert.match(
      (await aufruf('POST', '/admin/dokumente', { multipart: dateiFormular({ art: 'pool', zielId: 1, inhalt: gross }) })).ort,
      /error=zu-gross/
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_dokumente').get().n, 0, 'nichts wurde gespeichert');
  } finally {
    ende();
  }
});

test('Upload ohne gueltiges CSRF-Token wird abgewiesen', async () => {
  const { db, aufruf, ende } = await aufbau();
  try {
    const form = dateiFormular({ art: 'pool', zielId: 1, inhalt: PDF });
    form.set('_csrf', 'falsch');
    const res = await aufruf('POST', '/admin/dokumente', { multipart: form });
    assert.equal(res.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_dokumente').get().n, 0);
  } finally {
    ende();
  }
});

test('Pools und Bereiche mit hinterlegtem Dokument lassen sich nicht loeschen', async () => {
  const { aufruf, ende } = await aufbau();
  try {
    await aufruf('POST', '/admin/dokumente', { multipart: dateiFormular({ art: 'pool', zielId: 2, inhalt: PDF }) });
    await aufruf('POST', '/admin/dokumente', { multipart: dateiFormular({ art: 'bereich', zielId: 2, inhalt: PDF }) });
    assert.match((await aufruf('POST', '/admin/pools/2/delete')).ort, /error=hat-dokumente/);
    assert.match((await aufruf('POST', '/admin/bereiche/2/delete')).ort, /error=hat-dokumente/);
  } finally {
    ende();
  }
});

test('Lehrkraft loest ihre Verknuepfung ueber die Route - nur die eigene', async () => {
  const { db, ende } = await aufbau();
  try {
    // Eigene kleine App mit dem Dashboard-Router: Lehrkraft Anna (id 2).
    const express = require('express');
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use((req, res, next) => {
      req.session = { csrfToken: 'tok', user: { id: Number(req.get('x-user')), isAdmin: false } };
      next();
    });
    app.use('/', ladeSrc('routes/dashboard'));
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const basis = `http://127.0.0.1:${server.address().port}`;
      db.prepare("INSERT INTO categories (user_id,title,schuljahr) VALUES (2,'Meins','2026/27')").run();
      db.prepare("INSERT INTO zuweisungen (user_id,schuljahr,ausgleichsstunden,pool_id,category_id) VALUES (2,'2026/27',3,1,1)").run();
      db.prepare(
        "INSERT INTO time_entries (category_id,user_id,beschreibung,start_time,end_time,duration_minutes) VALUES (1,2,'x','2026-10-01 08:00:00','2026-10-01 09:00:00',60)"
      ).run();

      const post = (nutzer) => fetch(`${basis}/zuweisungen/1/loesen`, { method: 'POST', headers: { 'x-user': String(nutzer) }, redirect: 'manual' });
      await post(3); // Bernd darf die Zuweisung von Anna nicht loesen
      assert.equal(db.prepare('SELECT category_id FROM zuweisungen WHERE id=1').get().category_id, 1);

      const res = await post(2);
      assert.equal(res.status, 302);
      assert.equal(db.prepare('SELECT category_id FROM zuweisungen WHERE id=1').get().category_id, null);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM time_entries').get().n, 1, 'Zeit bleibt erhalten');
    } finally {
      server.close();
    }
  } finally {
    ende();
  }
});
