const { db } = require('../db');

// Eine Zuweisung ist gesperrt (keine Aenderung der Verknuepfung mehr
// moeglich), sobald fuer ihre bestaetigte Kategorie bereits Zeiten erfasst
// wurden - damit niemandem nachtraeglich bereits geleistete Arbeit "unter
// den Fuessen weggezogen" wird. Ohne bestaetigte Kategorie ist eine
// Zuweisung nie gesperrt.
function istGesperrt(zuweisung) {
  if (!zuweisung.category_id) return false;
  return !!db.prepare('SELECT 1 FROM time_entries WHERE category_id=? LIMIT 1').get(zuweisung.category_id);
}

// Schlaegt eine (neue oder geaenderte) Verknuepfung vor. rolle ist 'admin'
// oder 'lehrkraft'. categoryId=null bedeutet "Verknuepfung aufheben"
// vorschlagen. Ueberschreibt einen eigenen noch offenen Vorschlag, wird
// aber abgelehnt (false), wenn die Zuweisung gesperrt ist oder die jeweils
// andere Seite gerade einen offenen Vorschlag hat - der muss zuerst per
// annehmen()/ablehnen() aufgeloest werden.
function vorschlagen(zuweisung, rolle, categoryId) {
  if (istGesperrt(zuweisung)) return false;
  if (zuweisung.vorschlag_von && zuweisung.vorschlag_von !== rolle) return false;

  db.prepare('UPDATE zuweisungen SET vorschlag_category_id=?, vorschlag_von=? WHERE id=?').run(
    categoryId || null,
    rolle,
    zuweisung.id
  );
  return true;
}

// Nimmt den offenen Vorschlag der jeweils anderen Seite an: die
// vorgeschlagene Kategorie wird zur bestaetigten Verknuepfung, der Vorschlag
// wird geloescht. rolle muss die Gegenseite von vorschlag_von sein (niemand
// bestaetigt seinen eigenen Vorschlag selbst).
function annehmen(zuweisung, rolle) {
  if (!zuweisung.vorschlag_von || zuweisung.vorschlag_von === rolle) return false;

  db.prepare('UPDATE zuweisungen SET category_id=?, vorschlag_category_id=NULL, vorschlag_von=NULL WHERE id=?').run(
    zuweisung.vorschlag_category_id,
    zuweisung.id
  );
  return true;
}

// Lehnt den offenen Vorschlag der jeweils anderen Seite ab: der Vorschlag
// wird verworfen, die bisherige bestaetigte Verknuepfung bleibt unveraendert
// (die ablehnende Seite kann anschliessend selbst einen neuen Vorschlag
// machen).
function ablehnen(zuweisung, rolle) {
  if (!zuweisung.vorschlag_von || zuweisung.vorschlag_von === rolle) return false;

  db.prepare('UPDATE zuweisungen SET vorschlag_category_id=NULL, vorschlag_von=NULL WHERE id=?').run(zuweisung.id);
  return true;
}

module.exports = { istGesperrt, vorschlagen, annehmen, ablehnen };
