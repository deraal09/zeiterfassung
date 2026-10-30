const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { frischeUmgebung, ladeSrc } = require('./helpers');

// CSV-Import und -Export der Unterthemen (frueher "Unterprojekte"): der Export
// nennt die Spalte jetzt "Unterthema", der Import versteht beide Namen, damit
// aeltere Exportdateien weiter funktionieren.
async function aufbau() {
  frischeUmgebung();
  const { db, initDb } = ladeSrc('db');
  initDb();
  const express = require('express');
  db.prepare("INSERT INTO users (username, display_name) VALUES ('anna','Anna')").run();
  db.prepare("INSERT INTO categories (user_id,title,schuljahr) VALUES (1,'Medienkonzept','2026/27')").run();
  db.prepare("INSERT INTO unterprojekte (category_id,title,ist_auffang) VALUES (1,'Allgemein',1), (1,'Kurs B',0)").run();

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.assetVersion = 'test';
  app.locals.zahl = (w) => String(w);
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.session = { csrfToken: 'tok', user: { id: 1, username: 'anna', displayName: 'Anna', isAdmin: false } };
    res.locals.user = req.session.user;
    res.locals.csrfToken = 'tok';
    res.locals.cspNonce = 'n';
    next();
  });
  app.use('/', ladeSrc('routes/categories'));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return { db, basis: `http://127.0.0.1:${server.address().port}`, ende: () => server.close() };
}

async function importiere(basis, csv) {
  const form = new FormData();
  form.append('_csrf', 'tok');
  form.append('csv_file', new Blob([csv]), 'zeiten.csv');
  return fetch(`${basis}/categories/1/import`, { method: 'POST', body: form, redirect: 'manual' });
}

test('Import versteht die Spalte "Unterthema" und die alte "Unterprojekt"', async () => {
  const { db, basis, ende } = await aufbau();
  try {
    const neu = await importiere(basis, 'Datum;Von;Bis;Beschreibung;Unterthema\n2026-10-01;08:00;09:00;Neu;Kurs B\n');
    assert.match(neu.headers.get('location'), /importiert=1/);
    const alt = await importiere(basis, 'Datum;Von;Bis;Beschreibung;Unterprojekt\n2026-10-02;08:00;09:30;Alt;Kurs B\n');
    assert.match(alt.headers.get('location'), /importiert=1/);

    const zeilen = db
      .prepare('SELECT te.duration_minutes, up.title FROM time_entries te JOIN unterprojekte up ON up.id = te.unterprojekt_id ORDER BY te.start_time')
      .all();
    assert.deepEqual(zeilen.map((z) => [z.title, z.duration_minutes]), [['Kurs B', 60], ['Kurs B', 90]]);
  } finally {
    ende();
  }
});

test('Export nennt die Spalte "Unterthema" und die Seite spricht nicht mehr von Unterprojekten', async () => {
  const { db, basis, ende } = await aufbau();
  try {
    await importiere(basis, 'Datum;Von;Bis;Beschreibung;Unterthema\n2026-10-01;08:00;09:00;Neu;Kurs B\n');
    const csv = await (await fetch(`${basis}/categories/1/export`)).text();
    assert.match(csv, /Beschreibung;Unterthema;Status/);
    assert.match(csv, /Kurs B/);

    const seite = await (await fetch(`${basis}/categories/1`)).text();
    assert.match(seite, /Unterthemen/);
    assert.doesNotMatch(seite, /Unterprojekt/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM unterprojekte').get().n, 2, 'Tabelle und Daten bleiben unveraendert');
  } finally {
    ende();
  }
});
