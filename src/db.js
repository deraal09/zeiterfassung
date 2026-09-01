const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const { aktuellesSchuljahr } = require('./util/schuljahr');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      email TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      auto_sync INTEGER NOT NULL DEFAULT 0,
      auth_source TEXT NOT NULL DEFAULT 'ldap',
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    );

    -- Kategorien werden von der Lehrkraft selbst angelegt (freier Titel,
    -- z. B. "Administration Moodle"). Wie viele Zeitstunden dafuer noetig
    -- sind, ergibt sich aus den verknuepften Zuweisungen (siehe unten), nicht
    -- aus einem eigenen Ausgleichsstunden/Faktor-Feld.
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      schuljahr TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Zuweisungen: Admin vergibt Ausgleichsstunden + Faktor fuer ein
    -- Schuljahr an eine Lehrkraft, zunaechst ohne Kategorie (category_id
    -- NULL = "offen"/noch nicht verknuepft). Die Lehrkraft verknuepft sie
    -- anschliessend mit einer eigenen Kategorie oder uebernimmt sie direkt
    -- (was ebenfalls eine Kategorie anlegt und sofort verknuepft).
    CREATE TABLE IF NOT EXISTS zuweisungen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      schuljahr TEXT NOT NULL,
      ausgleichsstunden REAL NOT NULL,
      faktor REAL NOT NULL DEFAULT 1,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      beschreibung TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration_minutes REAL,
      source TEXT NOT NULL DEFAULT 'timer',
      synced INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_entries_category ON time_entries(category_id);
    CREATE INDEX IF NOT EXISTS idx_entries_user ON time_entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_zuweisungen_user ON zuweisungen(user_id);
    CREATE INDEX IF NOT EXISTS idx_zuweisungen_category ON zuweisungen(category_id);
  `);

  // Migration fuer Datenbanken, die vor Einfuehrung des lokalen
  // Admin-Logins (/setup) angelegt wurden.
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userColumns.includes('auth_source')) {
    db.exec("ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'ldap'");
  }
  if (!userColumns.includes('password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }

  // Migration fuer Datenbanken vor Einfuehrung von Zuweisungen: Kategorien
  // trugen bisher ausgleichsstunden/faktor direkt. Jede bestehende Kategorie
  // wird 1:1 zu einer verknuepften Zuweisung mit dem aktuellen Schuljahr.
  const categoryColumns = db.prepare('PRAGMA table_info(categories)').all().map((c) => c.name);
  if (categoryColumns.includes('ausgleichsstunden')) {
    const schuljahr = aktuellesSchuljahr();
    const alteKategorien = db.prepare('SELECT * FROM categories').all();
    const insertZuweisung = db.prepare(
      `INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, faktor, category_id, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const cat of alteKategorien) {
      insertZuweisung.run(
        cat.user_id,
        schuljahr,
        cat.ausgleichsstunden,
        cat.faktor,
        cat.id,
        cat.created_by || null,
        cat.created_at
      );
    }
    if (!categoryColumns.includes('schuljahr')) {
      db.exec('ALTER TABLE categories ADD COLUMN schuljahr TEXT');
    }
    db.prepare('UPDATE categories SET schuljahr = ? WHERE schuljahr IS NULL').run(schuljahr);
    db.exec('ALTER TABLE categories DROP COLUMN ausgleichsstunden');
    db.exec('ALTER TABLE categories DROP COLUMN faktor');
  }
}

module.exports = { db, initDb };
