/**
 * Ratelimit fuer Login-Versuche, geschluesselt auf den eingegebenen
 * Benutzernamen (unabhaengig davon, ob er tatsaechlich existiert - verhindert
 * auch das Durchprobieren von Passwoertern fuer nicht existierende oder erst
 * spaeter angelegte Benutzernamen).
 *
 * Ab dem 3. Fehlversuch in Folge wird eine Sperre mit fester Basisdauer
 * (30 s) verhaengt. Jeder weitere Fehlversuch NACH Ablauf der vorherigen
 * Sperre verdoppelt die Sperrdauer (30s, 60s, 120s, 240s, ...) - klassischer
 * exponentieller Backoff gegen automatisiertes Durchprobieren.
 *
 * Ein Login-Versuch WAEHREND einer aktiven Sperre wird bewusst nicht als
 * weiterer Fehlversuch gezaehlt und verlaengert die Sperre nicht zusaetzlich
 * - sonst liesse sich ein fremdes Konto durch blosses Weiter-Versuchen
 * beliebig lange sperren (Denial-of-Service gegen die eigentliche
 * Kontoinhaberin).
 *
 * Persistiert in SQLite (Tabelle login_ratelimit, siehe db.js) statt im
 * Arbeitsspeicher, damit die Sperre auch einen App-Neustart uebersteht.
 */
const { db } = require('../db');

const SCHWELLE = 3;
const BASIS_SPERRE_MS = 30 * 1000;

function normiere(schluessel) {
  return String(schluessel || '').trim().toLowerCase();
}

/**
 * Prueft, ob fuer den Schluessel aktuell eine Sperre laeuft. Loest KEINE
 * Anmeldepruefung aus und veraendert den Zustand nicht.
 */
function pruefeSperre(schluessel) {
  const key = normiere(schluessel);
  if (!key) return { gesperrt: false };
  const row = db.prepare('SELECT gesperrt_bis FROM login_ratelimit WHERE schluessel = ?').get(key);
  if (!row || !row.gesperrt_bis || row.gesperrt_bis <= Date.now()) {
    return { gesperrt: false };
  }
  return { gesperrt: true, restSekunden: Math.ceil((row.gesperrt_bis - Date.now()) / 1000) };
}

/** Vermerkt einen Fehlversuch; ab dem 3. in Folge wird (erneut) gesperrt. */
function vermerkeFehlversuch(schluessel) {
  const key = normiere(schluessel);
  if (!key) return;
  const bestehend = db.prepare('SELECT fehlversuche FROM login_ratelimit WHERE schluessel = ?').get(key);
  const fehlversuche = (bestehend ? bestehend.fehlversuche : 0) + 1;
  let gesperrtBis = null;
  if (fehlversuche >= SCHWELLE) {
    const dauerMs = BASIS_SPERRE_MS * 2 ** (fehlversuche - SCHWELLE);
    gesperrtBis = Date.now() + dauerMs;
  }
  db.prepare(
    `INSERT INTO login_ratelimit (schluessel, fehlversuche, gesperrt_bis) VALUES (?,?,?)
     ON CONFLICT(schluessel) DO UPDATE SET fehlversuche=excluded.fehlversuche, gesperrt_bis=excluded.gesperrt_bis`
  ).run(key, fehlversuche, gesperrtBis);
}

/** Setzt den Fehlversuchs-Zaehler nach einer erfolgreichen Anmeldung zurueck. */
function setzeZurueck(schluessel) {
  const key = normiere(schluessel);
  if (!key) return;
  db.prepare('DELETE FROM login_ratelimit WHERE schluessel = ?').run(key);
}

module.exports = { pruefeSperre, vermerkeFehlversuch, setzeZurueck };
