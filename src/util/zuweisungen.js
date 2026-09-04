const { db } = require('../db');

// Ergebnis der drei Zustandswechsel unten. Bei Misserfolg traegt `fehler`
// einen Code, den die Routen direkt als ?error=... weiterreichen (siehe
// ERROR_MESSAGES in routes/dashboard.js und routes/admin.js).
const OK = { ok: true };
const fehler = (code) => ({ ok: false, fehler: code });

function ladeZuweisung(id) {
  return db.prepare('SELECT * FROM zuweisungen WHERE id=?').get(id);
}

// Eine Zuweisung ist gesperrt (keine Aenderung der Verknuepfung mehr
// moeglich), sobald fuer ihre bestaetigte Kategorie bereits Zeiten erfasst
// wurden - damit niemandem nachtraeglich bereits geleistete Arbeit "unter
// den Fuessen weggezogen" wird. Ohne bestaetigte Kategorie ist eine
// Zuweisung nie gesperrt.
function istGesperrt(zuweisung) {
  if (!zuweisung.category_id) return false;
  return !!db.prepare('SELECT 1 FROM time_entries WHERE category_id=? LIMIT 1').get(zuweisung.category_id);
}

// Alle drei Zustandswechsel laden die Zuweisung innerhalb der Transaktion
// noch einmal frisch und pruefen erst dann. Sonst koennte zwischen dem Laden
// in der Route und dem Schreiben hier ein anderer Request den Zustand
// veraendert haben (z. B. inzwischen erfasste Zeiten), und die Pruefung
// liefe gegen einen veralteten Stand.

// Schlaegt eine (neue oder geaenderte) Verknuepfung vor. rolle ist 'admin'
// oder 'lehrkraft'. categoryId=null bedeutet "Verknuepfung aufheben"
// vorschlagen. Ueberschreibt einen eigenen noch offenen Vorschlag, wird
// aber abgelehnt, wenn die Zuweisung gesperrt ist oder die jeweils andere
// Seite gerade einen offenen Vorschlag hat - der muss zuerst per
// annehmen()/ablehnen() aufgeloest werden.
const vorschlagen = db.transaction((zuweisung, rolle, categoryId) => {
  const aktuell = ladeZuweisung(zuweisung.id);
  if (!aktuell) return fehler('kein-vorschlag');
  if (istGesperrt(aktuell)) return fehler('gesperrt');
  if (aktuell.vorschlag_von && aktuell.vorschlag_von !== rolle) return fehler('gesperrt');

  db.prepare('UPDATE zuweisungen SET vorschlag_category_id=?, vorschlag_von=? WHERE id=?').run(
    categoryId || null,
    rolle,
    aktuell.id
  );
  return OK;
});

// Nimmt den offenen Vorschlag der jeweils anderen Seite an: die
// vorgeschlagene Kategorie wird zur bestaetigten Verknuepfung, der Vorschlag
// wird geloescht. rolle muss die Gegenseite von vorschlag_von sein (niemand
// bestaetigt seinen eigenen Vorschlag selbst).
//
// Die Sperre wird hier genauso geprueft wie beim Vorschlagen: zwischen
// Vorschlag und Bestaetigung koennen fuer die bereits bestaetigte Kategorie
// Zeiten erfasst worden sein. Ohne diese Pruefung liesse sich die Sperre
// aushebeln, und die erfassten Zeiten haetten hinterher keine Zuweisung mehr
// - genau der Datenverlust, den die Sperre verhindern soll. Ein in diesem
// Zustand festhaengender Vorschlag laesst sich weiterhin ablehnen.
const annehmen = db.transaction((zuweisung, rolle) => {
  const aktuell = ladeZuweisung(zuweisung.id);
  if (!aktuell) return fehler('kein-vorschlag');
  if (!aktuell.vorschlag_von || aktuell.vorschlag_von === rolle) return fehler('kein-vorschlag');
  if (istGesperrt(aktuell)) return fehler('gesperrt');

  // Die vorgeschlagene Kategorie muss noch existieren und derselben
  // Lehrkraft gehoeren wie die Zuweisung. Ein leerer Vorschlag ist dagegen
  // gueltig: er bedeutet ausdruecklich "Verknuepfung aufheben".
  //
  // Bekannte Grenze: Wird die vorgeschlagene Kategorie geloescht, setzt
  // ON DELETE SET NULL vorschlag_category_id auf NULL - vom ausdruecklichen
  // "Verknuepfung aufheben" ist das im Schema nicht zu unterscheiden. Der
  // Fall ist derzeit nicht erreichbar (Kategorien werden nur archiviert, nie
  // geloescht); sollte einmal eine Loeschroute dazukommen, muss sie einen
  // offenen Vorschlag auf diese Kategorie gleich mit zuruecksetzen.
  if (aktuell.vorschlag_category_id) {
    const kategorie = db
      .prepare('SELECT id FROM categories WHERE id=? AND user_id=?')
      .get(aktuell.vorschlag_category_id, aktuell.user_id);
    if (!kategorie) return fehler('vorschlag-ungueltig');
  }

  db.prepare('UPDATE zuweisungen SET category_id=?, vorschlag_category_id=NULL, vorschlag_von=NULL WHERE id=?').run(
    aktuell.vorschlag_category_id,
    aktuell.id
  );
  return OK;
});

// Lehnt den offenen Vorschlag der jeweils anderen Seite ab: der Vorschlag
// wird verworfen, die bisherige bestaetigte Verknuepfung bleibt unveraendert
// (die ablehnende Seite kann anschliessend selbst einen neuen Vorschlag
// machen). Bewusst auch bei gesperrter Zuweisung moeglich - sonst bliebe ein
// nicht mehr annehmbarer Vorschlag fuer immer offen stehen.
const ablehnen = db.transaction((zuweisung, rolle) => {
  const aktuell = ladeZuweisung(zuweisung.id);
  if (!aktuell) return fehler('kein-vorschlag');
  if (!aktuell.vorschlag_von || aktuell.vorschlag_von === rolle) return fehler('kein-vorschlag');

  db.prepare('UPDATE zuweisungen SET vorschlag_category_id=NULL, vorschlag_von=NULL WHERE id=?').run(aktuell.id);
  return OK;
});

module.exports = { istGesperrt, vorschlagen, annehmen, ablehnen };
