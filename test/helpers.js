const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// Jede Testdatei arbeitet auf einer eigenen, frischen SQLite-Datei. src/db.js
// haelt die Verbindung als Modul-Singleton, das beim Import anhand von
// DB_PATH aufgebaut wird - deshalb muss der require-Cache fuer src/ zwischen
// zwei Datenbanken geleert werden, sonst zeigt das zweite Szenario noch auf
// die Datei des ersten.
function frischeUmgebung() {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'zeiterfassung-test-'));
  const dbPfad = path.join(verzeichnis, 'test.db');

  process.env.DB_PATH = dbPfad;
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.SESSION_SECRET = 'testsecret-mindestens-16-zeichen';

  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC)) delete require.cache[key];
  }

  return { dbPfad, verzeichnis };
}

function ladeSrc(relativ) {
  return require(path.join(SRC, relativ));
}

// Roh-Datenbank (ohne die Schema-Logik der App), um Altbestaende
// nachzubauen, wie sie vor einer Migration ausgesehen haben.
function oeffneRoh(dbPfad) {
  const Database = require('better-sqlite3');
  return new Database(dbPfad);
}

module.exports = { frischeUmgebung, ladeSrc, oeffneRoh };
