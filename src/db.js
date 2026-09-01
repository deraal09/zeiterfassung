const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

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

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      ausgleichsstunden REAL NOT NULL,
      faktor REAL NOT NULL DEFAULT 1,
      archived INTEGER NOT NULL DEFAULT 0,
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
  `);

  // Migration fuer Datenbanken, die vor Einfuehrung des lokalen
  // Admin-Logins (/setup) angelegt wurden.
  const columns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!columns.includes('auth_source')) {
    db.exec("ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'ldap'");
  }
  if (!columns.includes('password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
}

module.exports = { db, initDb };
