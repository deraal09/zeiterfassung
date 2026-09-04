/**
 * Ratelimit fuer Login-Versuche.
 *
 * Gezaehlt wird auf zwei Schluesseln gleichzeitig: dem eingegebenen
 * Benutzernamen und der Adresse, von der die Anfrage kommt. Der Name allein
 * genuegt nicht - wer viele verschiedene Namen mit demselben Passwort
 * durchprobiert (Password Spraying), loest pro Name nie genug Fehlversuche
 * aus. Die Adresse allein genuegt auch nicht, weil ein Angriff aus mehreren
 * Netzen kommen kann.
 *
 * Die Schwellen sind bewusst verschieden: hinter der Schul-Adresse sitzen
 * viele Menschen, von denen sich regelmaessig jemand vertippt. Waere sie so
 * streng wie der Benutzername, sperrten ein paar Tippfehler das ganze
 * Kollegium aus.
 *
 * Ab der Schwelle wird gesperrt, jeder weitere Fehlversuch nach Ablauf einer
 * Sperre verdoppelt die Dauer - allerdings bis zu einer Obergrenze und nur,
 * solange die Fehlversuche zusammenhaengen: nach einer ruhigen Phase faellt
 * der Zaehler zurueck auf null. Ohne diese beiden Grenzen liesse sich ein
 * fremdes Konto dauerhaft aussperren, indem jemand nach jedem Ablauf einen
 * einzelnen Fehlversuch nachschiebt und die Sperre so immer weiter
 * verdoppelt (Denial-of-Service gegen die eigentliche Kontoinhaberin).
 *
 * Ein Versuch WAEHREND einer laufenden Sperre zaehlt nicht mit und
 * verlaengert sie nicht.
 *
 * Persistiert in SQLite (Tabelle login_ratelimit, siehe db.js), damit die
 * Sperre auch einen Neustart uebersteht.
 */
const { db } = require('../db');

const BASIS_SPERRE_MS = 30 * 1000;
const MAX_SPERRE_MS = 15 * 60 * 1000;
// Nach dieser Zeit ohne neuen Fehlversuch beginnt die Zaehlung von vorn.
const VERFALL_MS = 15 * 60 * 1000;

const SCHWELLE_BENUTZER = 3;
const SCHWELLE_ADRESSE = 20;

function normiere(wert) {
  return String(wert || '').trim().toLowerCase();
}

// Beide Schluessel liegen in derselben Tabelle; das Praefix haelt einen
// Benutzernamen und eine Adresse auseinander, die zufaellig gleich heissen.
function schluessel(benutzername, adresse) {
  const liste = [];
  const name = normiere(benutzername);
  const ip = normiere(adresse);
  if (name) liste.push({ key: `benutzer:${name}`, schwelle: SCHWELLE_BENUTZER });
  if (ip) liste.push({ key: `adresse:${ip}`, schwelle: SCHWELLE_ADRESSE });
  return liste;
}

function hole(key) {
  return db.prepare('SELECT fehlversuche, gesperrt_bis, letzter_versuch FROM login_ratelimit WHERE schluessel = ?').get(key);
}

/**
 * Prueft, ob aktuell eine Sperre laeuft. Veraendert den Zustand nicht.
 * Gibt die laengste laufende Sperre der beteiligten Schluessel zurueck.
 */
function pruefeSperre(benutzername, adresse) {
  const jetzt = Date.now();
  let restMs = 0;

  for (const { key } of schluessel(benutzername, adresse)) {
    const row = hole(key);
    if (row && row.gesperrt_bis && row.gesperrt_bis > jetzt) {
      restMs = Math.max(restMs, row.gesperrt_bis - jetzt);
    }
  }

  if (restMs === 0) return { gesperrt: false };
  return { gesperrt: true, restSekunden: Math.ceil(restMs / 1000) };
}

/** Vermerkt einen Fehlversuch auf beiden Schluesseln. */
function vermerkeFehlversuch(benutzername, adresse) {
  const jetzt = Date.now();
  const schreibe = db.prepare(
    `INSERT INTO login_ratelimit (schluessel, fehlversuche, gesperrt_bis, letzter_versuch) VALUES (?,?,?,?)
     ON CONFLICT(schluessel) DO UPDATE SET
       fehlversuche=excluded.fehlversuche,
       gesperrt_bis=excluded.gesperrt_bis,
       letzter_versuch=excluded.letzter_versuch`
  );

  for (const { key, schwelle } of schluessel(benutzername, adresse)) {
    const row = hole(key);

    // Liegt der letzte Fehlversuch lange genug zurueck, faengt die Zaehlung
    // von vorn an - sonst summierten sich ueber Wochen verteilte Vertipper
    // zu einer immer laengeren Sperre auf.
    const zusammenhaengend = row && row.letzter_versuch && jetzt - row.letzter_versuch < VERFALL_MS;
    const fehlversuche = (zusammenhaengend ? row.fehlversuche : 0) + 1;

    let gesperrtBis = null;
    if (fehlversuche >= schwelle) {
      const dauerMs = Math.min(BASIS_SPERRE_MS * 2 ** (fehlversuche - schwelle), MAX_SPERRE_MS);
      gesperrtBis = jetzt + dauerMs;
    }
    schreibe.run(key, fehlversuche, gesperrtBis, jetzt);
  }
}

/** Setzt die Zaehler nach einer erfolgreichen Anmeldung zurueck. */
function setzeZurueck(benutzername, adresse) {
  const loesche = db.prepare('DELETE FROM login_ratelimit WHERE schluessel = ?');
  for (const { key } of schluessel(benutzername, adresse)) {
    loesche.run(key);
  }
}

/**
 * Entfernt Eintraege, deren Sperre abgelaufen und deren letzter Fehlversuch
 * verfallen ist. Ohne das waechst die Tabelle mit jedem je eingetippten
 * Benutzernamen weiter, ohne dass die Zeilen noch eine Wirkung haetten.
 */
function raeumeAuf() {
  const grenze = Date.now() - VERFALL_MS;
  return db
    .prepare(
      `DELETE FROM login_ratelimit
       WHERE (gesperrt_bis IS NULL OR gesperrt_bis < ?)
         AND (letzter_versuch IS NULL OR letzter_versuch < ?)`
    )
    .run(Date.now(), grenze).changes;
}

module.exports = {
  pruefeSperre,
  vermerkeFehlversuch,
  setzeZurueck,
  raeumeAuf,
  SCHWELLE_BENUTZER,
  SCHWELLE_ADRESSE,
  MAX_SPERRE_MS,
  VERFALL_MS,
};
