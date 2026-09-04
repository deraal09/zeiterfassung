const test = require('node:test');
const assert = require('node:assert');
const { frischeUmgebung, ladeSrc, oeffneRoh } = require('./helpers');

// Die CREATE-TABLE-Anweisungen in db.js tragen immer das AKTUELLE Schema.
// Migrationen duerfen deshalb nie in Spalten schreiben, die es inzwischen
// nicht mehr gibt - sonst bricht der Start jeder Installation ab, die vor
// dem jeweiligen Umbau produktiv lief. Diese Tests bauen je einen solchen
// Altbestand nach und lassen initDb() darauf laufen.

const SPALTEN = (db, tabelle) => db.prepare(`PRAGMA table_info(${tabelle})`).all().map((c) => c.name);

test('Altbestand mit ausgleichsstunden/faktor an der Kategorie migriert', () => {
  const { dbPfad } = frischeUmgebung();

  const alt = oeffneRoh(dbPfad);
  alt.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL, email TEXT, is_admin INTEGER NOT NULL DEFAULT 0,
      auto_sync INTEGER NOT NULL DEFAULT 0, created_at TEXT, last_login TEXT);
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      title TEXT NOT NULL, ausgleichsstunden REAL NOT NULL, faktor REAL NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT);
    CREATE TABLE time_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, beschreibung TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT,
      duration_minutes REAL, source TEXT, synced INTEGER NOT NULL DEFAULT 0, synced_at TEXT, created_at TEXT);
    INSERT INTO users (username, display_name) VALUES ('lehrer1','Lehrer Eins');
    INSERT INTO categories (user_id, title, ausgleichsstunden, faktor) VALUES (1,'Moodle',2,68);
    INSERT INTO time_entries (category_id, user_id, beschreibung, start_time, end_time, duration_minutes)
      VALUES (1,1,'Kurs gebaut','2025-09-01 08:00:00','2025-09-01 10:00:00',120);
  `);
  alt.close();

  const { db, initDb } = ladeSrc('db');
  assert.doesNotThrow(() => initDb());

  const zuweisung = db.prepare('SELECT * FROM zuweisungen').get();
  assert.equal(zuweisung.ausgleichsstunden, 2, 'Ausgleichsstunden wandern in die Zuweisung');
  assert.equal(zuweisung.category_id, 1, 'Zuweisung bleibt mit ihrer Kategorie verknuepft');

  const faktor = db.prepare('SELECT * FROM schuljahr_faktoren').get();
  assert.equal(faktor.zeitstunden_pro_woche * faktor.schulwochen, 68, 'Faktor bleibt rechnerisch unveraendert');
  assert.equal(faktor.schuljahr, zuweisung.schuljahr);

  assert.ok(!SPALTEN(db, 'categories').includes('ausgleichsstunden'), 'alte Spalte ist entfernt');
  assert.ok(db.prepare('SELECT schuljahr FROM categories').get().schuljahr, 'Kategorie hat ein Schuljahr bekommen');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM time_entries').get().c, 1, 'Zeiten bleiben erhalten');
});

test('Altbestand mit faktor an der Zuweisung migriert in den zentralen Schuljahr-Faktor', () => {
  const { dbPfad } = frischeUmgebung();

  const alt = oeffneRoh(dbPfad);
  alt.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL, email TEXT, is_admin INTEGER NOT NULL DEFAULT 0,
      auto_sync INTEGER NOT NULL DEFAULT 0, created_at TEXT, last_login TEXT);
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      title TEXT NOT NULL, schuljahr TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT);
    CREATE TABLE zuweisungen (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      schuljahr TEXT NOT NULL, ausgleichsstunden REAL NOT NULL, faktor REAL NOT NULL,
      category_id INTEGER, created_by TEXT, created_at TEXT);
    CREATE TABLE time_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, beschreibung TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT,
      duration_minutes REAL, source TEXT, synced INTEGER NOT NULL DEFAULT 0, synced_at TEXT, created_at TEXT);
    INSERT INTO users (username, display_name) VALUES ('lehrer1','Lehrer Eins');
    INSERT INTO categories (user_id, title, schuljahr) VALUES (1,'Moodle','2025/26');
    INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, faktor, category_id)
      VALUES (1,'2025/26',2,68,1);
  `);
  alt.close();

  const { db, initDb } = ladeSrc('db');
  assert.doesNotThrow(() => initDb());

  const faktor = db.prepare("SELECT * FROM schuljahr_faktoren WHERE schuljahr='2025/26'").get();
  assert.ok(faktor, 'Schuljahr-Faktor wurde angelegt');
  assert.equal(faktor.zeitstunden_pro_woche * faktor.schulwochen, 68, 'Faktor bleibt rechnerisch unveraendert');
  assert.ok(!SPALTEN(db, 'zuweisungen').includes('faktor'), 'alte Spalte ist entfernt');
});

test('Altbestand mit fertigem faktor in schuljahr_faktoren migriert', () => {
  const { dbPfad } = frischeUmgebung();

  const alt = oeffneRoh(dbPfad);
  alt.exec(`
    CREATE TABLE schuljahr_faktoren (schuljahr TEXT PRIMARY KEY, faktor REAL NOT NULL,
      updated_by TEXT, updated_at TEXT);
    INSERT INTO schuljahr_faktoren (schuljahr, faktor) VALUES ('2025/26', 68);
  `);
  alt.close();

  const { db, initDb } = ladeSrc('db');
  assert.doesNotThrow(() => initDb());

  const faktor = db.prepare("SELECT * FROM schuljahr_faktoren WHERE schuljahr='2025/26'").get();
  assert.equal(faktor.zeitstunden_pro_woche * faktor.schulwochen, 68, 'Faktor bleibt rechnerisch unveraendert');
  assert.ok(!SPALTEN(db, 'schuljahr_faktoren').includes('faktor'));
});

test('initDb ist auf einer frischen Datenbank wiederholbar', () => {
  frischeUmgebung();
  const { initDb } = ladeSrc('db');
  assert.doesNotThrow(() => initDb());
  assert.doesNotThrow(() => initDb(), 'zweiter Start darf nicht scheitern');
});

test('repariert krumme Zeitstempel, erfindet aber keine Daten', () => {
  const { dbPfad } = frischeUmgebung();
  const { db, initDb } = ladeSrc('db');
  initDb();

  db.prepare("INSERT INTO users (username, display_name) VALUES ('l1','L1')").run();
  db.prepare("INSERT INTO categories (user_id,title,schuljahr) VALUES (1,'Kat','2026/27')").run();

  // So sahen Eintraege aus, bevor die Eingaben geprueft wurden: Datum und
  // Uhrzeit wurden ungeprueft zum String zusammengesetzt.
  const einfuegen = db.prepare(
    `INSERT INTO time_entries (category_id,user_id,beschreibung,start_time,end_time,duration_minutes)
     VALUES (1,1,'x',?,?,120)`
  );
  einfuegen.run('2026-09-01 9:5:00', '2026-09-01 11:5:00');
  einfuegen.run('2026-13-45 08:00:00', '2026-13-45 10:00:00');
  einfuegen.run('2026-09-02 08:00:00', '2026-09-02 10:00:00');

  // initDb laeuft bei jedem Start - die Reparatur haengt daran.
  delete require.cache[require.resolve(require('path').join(__dirname, '..', 'src', 'db'))];
  process.env.DB_PATH = dbPfad;
  ladeSrc('db').initDb();

  const geprueft = ladeSrc('db').db;
  const zeilen = geprueft.prepare('SELECT id, start_time, datetime(start_time) as lesbar FROM time_entries ORDER BY id').all();

  assert.equal(zeilen[0].start_time, '2026-09-01 09:05:00', 'krumme Schreibweise wird normalisiert');
  assert.ok(zeilen[0].lesbar, 'und ist danach fuer SQLite ein Zeitpunkt');

  assert.equal(zeilen[1].start_time, '2026-13-45 08:00:00', 'ein erfundenes Datum bleibt unangetastet');
  assert.equal(zeilen[1].lesbar, null);

  assert.equal(zeilen[2].start_time, '2026-09-02 08:00:00', 'gueltige Werte bleiben unveraendert');
});
