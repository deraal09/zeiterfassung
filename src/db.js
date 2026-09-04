const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const { aktuellesSchuljahr } = require('./util/schuljahr');
const { encrypt, isEncrypted } = require('./util/crypto');
const { normalisiereZeitstempel } = require('./util/time');

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
    -- sind, ergibt sich normalerweise aus den verknuepften Zuweisungen
    -- (siehe unten). Solange noch keine Zuweisung verknuepft ist, kann die
    -- Lehrkraft mit ziel_zeitstunden selbst ein vorlaeufiges Ziel eintragen
    -- (analog zur Admin-Eingabe) - sobald verknuepft wird, ist dieses Feld
    -- gesperrt (die offizielle Berechnung uebernimmt), bleibt aber sichtbar.
    --
    -- Kategorien sind fuer den Admin standardmaessig NICHT sichtbar (Privat-
    -- sphaere der Lehrkraft). Sichtbar wird eine Kategorie erst, wenn die
    -- Lehrkraft visible_for_admin explizit setzt ODER eine Zuweisung mit ihr
    -- verknuepft ist (dynamisch geprueft, siehe admin.js) - dann handelt es
    -- sich ja bereits um vom Admin vergebene, offizielle Stunden.
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      schuljahr TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      visible_for_admin INTEGER NOT NULL DEFAULT 0,
      ziel_zeitstunden REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Zuweisungen: Admin vergibt Ausgleichsstunden fuer ein Schuljahr an
    -- eine Lehrkraft, zunaechst ohne Kategorie (category_id NULL =
    -- "offen"/noch nicht verknuepft). Der Faktor steht NICHT hier, sondern
    -- zentral in schuljahr_faktoren - einmal pro Schuljahr, gilt fuer alle
    -- Zuweisungen dieses Schuljahres.
    --
    -- Die Verknuepfung mit einer Kategorie laeuft ueber Vorschlag +
    -- Bestaetigung (siehe util/zuweisungen.js): category_id ist die
    -- BESTAETIGTE Verknuepfung, vorschlag_category_id/vorschlag_von ein noch
    -- offener Vorschlag der jeweils anderen Seite ('admin' oder
    -- 'lehrkraft'), der erst durch die Gegenseite wirksam wird. Solange die
    -- bestaetigte Kategorie noch keine Zeiten hat, kann die Verknuepfung
    -- noch per neuem Vorschlag geaendert werden - danach ist sie fest.
    CREATE TABLE IF NOT EXISTS zuweisungen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      schuljahr TEXT NOT NULL,
      ausgleichsstunden REAL NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      vorschlag_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      vorschlag_von TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Ein Faktor je Schuljahr, zentral vom Admin gepflegt - berechnet aus
    -- Zeitstunden pro Woche x Schulwochen (z. B. 1,7 x 40 = 68 Zeitstunden
    -- je Ausgleichsstunde und Schuljahr). Aendert sich einer der beiden
    -- Werte, wirkt sich das sofort auf alle Zuweisungen dieses Schuljahres
    -- aus (wird bei der Berechnung live nachgeschlagen, nicht in der
    -- Zuweisung eingefroren).
    CREATE TABLE IF NOT EXISTS schuljahr_faktoren (
      schuljahr TEXT PRIMARY KEY,
      zeitstunden_pro_woche REAL NOT NULL,
      schulwochen REAL NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Unterprojekte gliedern die Zeiten INNERHALB einer Kategorie weiter
    -- (z. B. "Kurs A", "Kurs B"). Rein optional - eine Kategorie ohne
    -- Unterprojekte funktioniert unveraendert wie bisher. Sobald das erste
    -- Unterprojekt einer Kategorie angelegt wird, werden alle bis dahin
    -- nicht zugeordneten Zeiten automatisch dem Unterprojekt "Allgemein"
    -- zugeordnet (siehe categories.js) - danach hat in dieser Kategorie
    -- jede Zeit ein Unterprojekt.
    CREATE TABLE IF NOT EXISTS unterprojekte (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_unterprojekte_category ON unterprojekte(category_id);

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unterprojekt_id INTEGER REFERENCES unterprojekte(id) ON DELETE SET NULL,
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

    -- Ratelimit fuer Login-Versuche (src/auth/login-ratelimit.js): ab dem 3.
    -- Fehlversuch in Folge fuer einen Benutzernamen wird die Anmeldung fuer
    -- eine Weile gesperrt, jeder weitere Fehlversuch danach verdoppelt die
    -- Sperrdauer (exponentieller Backoff gegen automatisiertes
    -- Durchprobieren von Passwoertern).
    CREATE TABLE IF NOT EXISTS login_ratelimit (
      schluessel TEXT PRIMARY KEY,
      fehlversuche INTEGER NOT NULL DEFAULT 0,
      gesperrt_bis INTEGER,
      letzter_versuch INTEGER
    );
  `);

  // Migration fuer Datenbanken vor Einfuehrung der Admin-Sichtbarkeit:
  // bestehende Kategorien starten unsichtbar (0) - Kategorien mit bereits
  // verknuepfter Zuweisung sind ueber die dynamische Pruefung in admin.js
  // trotzdem sofort sichtbar, ohne dass hier etwas nachgezogen werden muss.
  const categoryColumnsFuerSichtbarkeit = db.prepare('PRAGMA table_info(categories)').all().map((c) => c.name);
  if (!categoryColumnsFuerSichtbarkeit.includes('visible_for_admin')) {
    db.exec('ALTER TABLE categories ADD COLUMN visible_for_admin INTEGER NOT NULL DEFAULT 0');
  }
  if (!categoryColumnsFuerSichtbarkeit.includes('ziel_zeitstunden')) {
    db.exec('ALTER TABLE categories ADD COLUMN ziel_zeitstunden REAL');
  }

  // Migration fuer Datenbanken, die vor Einfuehrung des lokalen
  // Admin-Logins (/setup) angelegt wurden.
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userColumns.includes('auth_source')) {
    db.exec("ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'ldap'");
  }
  if (!userColumns.includes('password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }

  // Migration fuer Datenbanken vor Einfuehrung von Zeitstunden/Schulwochen:
  // schuljahr_faktoren trug bisher einen fertigen Faktor direkt. Um den
  // bisher berechneten Wert nicht zu veraendern, wird er unveraendert als
  // zeitstunden_pro_woche uebernommen (Schulwochen = 1) - der Admin kann
  // ihn anschliessend ueber die neue Eingabe sauber in beide Werte
  // aufteilen.
  //
  // Dieser Schritt laeuft BEWUSST vor den beiden Faktor-Migrationen weiter
  // unten: die schreiben ihrerseits in schuljahr_faktoren und muessen die
  // Tabelle deshalb schon im Zielschema vorfinden.
  const faktorColumns = db.prepare('PRAGMA table_info(schuljahr_faktoren)').all().map((c) => c.name);
  if (faktorColumns.includes('faktor')) {
    if (!faktorColumns.includes('zeitstunden_pro_woche')) {
      db.exec('ALTER TABLE schuljahr_faktoren ADD COLUMN zeitstunden_pro_woche REAL');
    }
    if (!faktorColumns.includes('schulwochen')) {
      db.exec('ALTER TABLE schuljahr_faktoren ADD COLUMN schulwochen REAL');
    }
    db.exec(
      `UPDATE schuljahr_faktoren
       SET zeitstunden_pro_woche = COALESCE(zeitstunden_pro_woche, faktor),
           schulwochen = COALESCE(schulwochen, 1)`
    );
    db.exec('ALTER TABLE schuljahr_faktoren DROP COLUMN faktor');
  }

  // Uebernimmt einen alten, bereits fertig gerechneten Faktor als zentralen
  // Schuljahr-Faktor (zeitstunden_pro_woche = Faktor, schulwochen = 1), damit
  // sich der bisher angezeigte Wert durch die Migration nicht veraendert.
  // Je Schuljahr gewinnt der erste Wert - der Faktor ist seit dem Umbau
  // zentral, ein Schuljahr kann also nur noch genau einen tragen.
  function uebernehmeAltenFaktor(schuljahr, faktor) {
    if (!(faktor > 0)) return;
    db.prepare(
      `INSERT OR IGNORE INTO schuljahr_faktoren (schuljahr, zeitstunden_pro_woche, schulwochen)
       VALUES (?,?,1)`
    ).run(schuljahr, faktor);
  }

  // Migration fuer Datenbanken vor Einfuehrung von Zuweisungen: Kategorien
  // trugen bisher ausgleichsstunden/faktor direkt. Jede bestehende Kategorie
  // wird 1:1 zu einer verknuepften Zuweisung mit dem aktuellen Schuljahr.
  // Der Faktor wandert dabei nicht in die Zuweisung (dort gibt es ihn seit
  // dem Umbau nicht mehr), sondern direkt in den zentralen Schuljahr-Faktor.
  const categoryColumns = db.prepare('PRAGMA table_info(categories)').all().map((c) => c.name);
  if (categoryColumns.includes('ausgleichsstunden')) {
    const schuljahr = aktuellesSchuljahr();
    const alteKategorien = db.prepare('SELECT * FROM categories').all();
    const insertZuweisung = db.prepare(
      // COALESCE beim Zeitstempel: zuweisungen.created_at ist NOT NULL, eine
      // alte Kategorie kann aber ohne created_at in der Datenbank stehen -
      // daran darf die Migration nicht scheitern.
      `INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, category_id, created_by, created_at)
       VALUES (?,?,?,?,?,COALESCE(?, datetime('now')))`
    );
    const migriereKategorien = db.transaction((kategorien) => {
      for (const cat of kategorien) {
        insertZuweisung.run(
          cat.user_id,
          schuljahr,
          cat.ausgleichsstunden,
          cat.id,
          cat.created_by || null,
          cat.created_at
        );
        uebernehmeAltenFaktor(schuljahr, cat.faktor);
      }
      if (!categoryColumns.includes('schuljahr')) {
        db.exec('ALTER TABLE categories ADD COLUMN schuljahr TEXT');
      }
      db.prepare('UPDATE categories SET schuljahr = ? WHERE schuljahr IS NULL').run(schuljahr);
    });
    migriereKategorien(alteKategorien);

    // Der Faktor war frueher pro Kategorie frei waehlbar, ist jetzt aber pro
    // Schuljahr zentral. Gab es abweichende Werte, geht dabei zwangslaeufig
    // einer verloren - das darf nicht stillschweigend passieren, sonst stehen
    // hinterher falsche Stundenziele in der Oberflaeche.
    const abweichendeFaktoren = [...new Set(alteKategorien.map((c) => c.faktor).filter((f) => f > 0))];
    if (abweichendeFaktoren.length > 1) {
      console.warn(
        `Migration: Die Kategorien trugen unterschiedliche Faktoren (${abweichendeFaktoren.join(', ')}). ` +
          `Uebernommen wurde ${abweichendeFaktoren[0]} als zentraler Faktor fuer ${schuljahr}. ` +
          'Bitte im Admin-Bereich pruefen und korrigieren.'
      );
    }

    db.exec('ALTER TABLE categories DROP COLUMN ausgleichsstunden');
    db.exec('ALTER TABLE categories DROP COLUMN faktor');
  }

  // Migration fuer Datenbanken vor Einfuehrung des zentralen
  // Schuljahr-Faktors: der Faktor stand bisher direkt in jeder Zuweisung.
  // Fuer jedes Schuljahr wird der Faktor der jeweils ersten Zuweisung als
  // Startwert fuer schuljahr_faktoren uebernommen; danach wird die Spalte
  // aus zuweisungen entfernt.
  const zuweisungColumns = db.prepare('PRAGMA table_info(zuweisungen)').all().map((c) => c.name);
  if (zuweisungColumns.includes('faktor')) {
    const proSchuljahr = db
      .prepare(
        `SELECT schuljahr, faktor FROM zuweisungen
         WHERE id IN (SELECT MIN(id) FROM zuweisungen GROUP BY schuljahr)`
      )
      .all();
    const migriereFaktoren = db.transaction((zeilen) => {
      for (const row of zeilen) {
        uebernehmeAltenFaktor(row.schuljahr, row.faktor);
      }
    });
    migriereFaktoren(proSchuljahr);
    db.exec('ALTER TABLE zuweisungen DROP COLUMN faktor');
  }

  // Migration fuer Datenbanken vor Einfuehrung des Vorschlag/Bestaetigen-
  // Workflows fuer die Zuweisung<->Kategorie-Verknuepfung (siehe Kommentar
  // an der zuweisungen-Tabelle oben sowie util/zuweisungen.js). Bestehende,
  // bereits verknuepfte Zuweisungen bleiben unveraendert bestaetigt.
  const zuweisungColumnsFuerVorschlag = db.prepare('PRAGMA table_info(zuweisungen)').all().map((c) => c.name);
  if (!zuweisungColumnsFuerVorschlag.includes('vorschlag_category_id')) {
    db.exec('ALTER TABLE zuweisungen ADD COLUMN vorschlag_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL');
  }
  if (!zuweisungColumnsFuerVorschlag.includes('vorschlag_von')) {
    db.exec('ALTER TABLE zuweisungen ADD COLUMN vorschlag_von TEXT');
  }

  // Migration fuer Datenbanken vor Einfuehrung der Unterprojekte: die neue
  // unterprojekte-Tabelle wird oben bereits per CREATE TABLE IF NOT EXISTS
  // angelegt, hier fehlt nur noch die Spalte auf time_entries.
  const timeEntryColumns = db.prepare('PRAGMA table_info(time_entries)').all().map((c) => c.name);
  if (!timeEntryColumns.includes('unterprojekt_id')) {
    db.exec('ALTER TABLE time_entries ADD COLUMN unterprojekt_id INTEGER REFERENCES unterprojekte(id) ON DELETE SET NULL');
  }

  // Migration fuer Datenbanken vor Einfuehrung des Zaehlerverfalls beim
  // Login-Ratelimit: ohne den Zeitpunkt des letzten Fehlversuchs liesse sich
  // nicht entscheiden, ob eine Zaehlung noch zusammenhaengt (siehe
  // auth/login-ratelimit.js). Bestehende Zeilen starten ohne Wert und
  // beginnen damit beim naechsten Fehlversuch neu zu zaehlen.
  const ratelimitColumns = db.prepare('PRAGMA table_info(login_ratelimit)').all().map((c) => c.name);
  if (!ratelimitColumns.includes('letzter_versuch')) {
    db.exec('ALTER TABLE login_ratelimit ADD COLUMN letzter_versuch INTEGER');
  }

  // Reparatur von Zeitstempeln, die vor der Eingabepruefung entstanden sind:
  // Datum und Uhrzeit wurden frueher ungeprueft zum gespeicherten String
  // zusammengesetzt. Werte wie "2026-09-01 9:5:00" kann SQLite nicht als
  // Zeitpunkt lesen - solche Eintraege fielen aus jedem Datumsfilter heraus,
  // zaehlten aber weiter in die Stundensummen, sodass Tabelle und
  // Fortschrittsbalken sich widersprachen.
  //
  // Nur eindeutig normalisierbare Werte werden korrigiert (gleicher
  // Zeitpunkt, nur andere Schreibweise). Werte ohne echten Kalendertag
  // ("2026-13-45") bleiben bewusst unangetastet und werden gemeldet - sie
  // liessen sich nur raten, und die betroffene Zeile ist in der Oberflaeche
  // weiterhin sichtbar und korrigierbar.
  const krummeZeitstempel = db
    .prepare(
      `SELECT id, start_time, end_time FROM time_entries
       WHERE datetime(start_time) IS NULL
          OR (end_time IS NOT NULL AND datetime(end_time) IS NULL)`
    )
    .all();
  if (krummeZeitstempel.length > 0) {
    const updateZeiten = db.prepare('UPDATE time_entries SET start_time=?, end_time=? WHERE id=?');
    const nichtReparierbar = [];
    const repariere = db.transaction((zeilen) => {
      for (const zeile of zeilen) {
        const start = normalisiereZeitstempel(zeile.start_time);
        const ende = zeile.end_time === null ? null : normalisiereZeitstempel(zeile.end_time);
        if (!start || (zeile.end_time !== null && !ende)) {
          nichtReparierbar.push(zeile.id);
          continue;
        }
        updateZeiten.run(start, ende, zeile.id);
      }
    });
    repariere(krummeZeitstempel);

    const repariert = krummeZeitstempel.length - nichtReparierbar.length;
    if (repariert > 0) {
      console.log(`Migration: ${repariert} Zeiteintraege mit krummer Zeitschreibweise normalisiert.`);
    }
    if (nichtReparierbar.length > 0) {
      console.warn(
        `Migration: ${nichtReparierbar.length} Zeiteintraege tragen kein gueltiges Datum und wurden nicht ` +
          `veraendert (IDs: ${nichtReparierbar.join(', ')}). Sie erscheinen in keinem Datumsfilter - bitte in ` +
          'der jeweiligen Kategorie korrigieren oder loeschen.'
      );
    }
  }

  // Migration fuer Datenbanken vor Einfuehrung der Feldverschluesselung:
  // beschreibung wird serverseitig mit ENCRYPTION_KEY verschluesselt
  // gespeichert (siehe util/crypto.js), damit die Tätigkeitsbeschreibungen
  // selbst bei einem Server-/Hosterwechsel oder einem Zugriff auf die reine
  // DB-Datei ohne den separat aufbewahrten Schluessel nicht lesbar sind.
  // Laeuft bei jedem Start, ist aber idempotent (isEncrypted ueberspringt
  // bereits verschluesselte Zeilen) und daher auch bei grossem Bestand
  // unkritisch.
  const unverschluesselt = db
    .prepare('SELECT id, beschreibung FROM time_entries')
    .all()
    .filter((row) => !isEncrypted(row.beschreibung));
  if (unverschluesselt.length > 0) {
    const updateBeschreibung = db.prepare('UPDATE time_entries SET beschreibung=? WHERE id=?');
    const verschluesseln = db.transaction((rows) => {
      for (const row of rows) {
        updateBeschreibung.run(encrypt(row.beschreibung), row.id);
      }
    });
    verschluesseln(unverschluesselt);
  }
}

module.exports = { db, initDb };
