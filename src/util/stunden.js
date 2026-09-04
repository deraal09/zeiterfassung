const { db } = require('../db');

// Wie viele Zeitstunden fuer eine Kategorie zu leisten sind.
//
// Sobald mindestens eine Zuweisung mit der Kategorie verknuepft ist, zaehlt
// nur noch die offizielle Berechnung (Ausgleichsstunden x Schuljahr-Faktor,
// summiert). Ohne Zuweisung gilt das von der Lehrkraft selbst eingetragene
// vorlaeufige Ziel (ziel_zeitstunden).
//
// `stunden` ist bewusst null, wenn sich das Ziel nicht bestimmen laesst -
// frueher stand hier eine 0, die von einem echten Ziel von 0 nicht zu
// unterscheiden war: bei fehlendem Schuljahr-Faktor zeigte der
// Fortschrittsbalken deshalb 100 % (erfasst/0 -> Infinity), obwohl das Ziel
// in Wahrheit unbekannt war.
//
// `quelle` sagt, woher der Wert stammt, damit die Ansichten den Unterschied
// benennen koennen:
//   'zuweisung'   - offiziell berechnet
//   'eigenes-ziel'- vorlaeufiges Ziel der Lehrkraft
//   'kein-faktor' - Zuweisung vorhanden, aber fuer ihr Schuljahr fehlt der
//                   Faktor (der Admin muss ihn erst festlegen)
//   'ohne-ziel'   - weder Zuweisung noch eigenes Ziel
function zielZeitstunden(category) {
  const summe = db
    .prepare(
      `SELECT COUNT(*) as anzahl,
              SUM(CASE WHEN sf.zeitstunden_pro_woche IS NULL OR sf.schulwochen IS NULL THEN 1 ELSE 0 END) as ohne_faktor,
              COALESCE(SUM(z.ausgleichsstunden * sf.zeitstunden_pro_woche * sf.schulwochen),0) as h
       FROM zuweisungen z LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       WHERE z.category_id=?`
    )
    .get(category.id);

  if (summe.anzahl > 0) {
    if (summe.ohne_faktor > 0) return { stunden: null, quelle: 'kein-faktor' };
    return { stunden: summe.h, quelle: 'zuweisung' };
  }

  if (category.ziel_zeitstunden > 0) {
    return { stunden: category.ziel_zeitstunden, quelle: 'eigenes-ziel' };
  }
  return { stunden: null, quelle: 'ohne-ziel' };
}

// Fuellstand des Fortschrittsbalkens in Prozent, oder null wenn es kein
// bekanntes Ziel gibt (dann zeigen die Ansichten gar keinen Balken).
function fortschrittProzent(erfassteStunden, ziel) {
  if (ziel === null || !(ziel > 0)) return null;
  return Math.min(100, (erfassteStunden / ziel) * 100);
}

module.exports = { zielZeitstunden, fortschrittProzent };
