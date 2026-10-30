const { db } = require('../db');

// Stand der unterschriebenen Ausdrucke eines Schuljahres: zu jedem Pool, jedem
// Bereich und zur Gesamtuebersicht das jeweils neueste hochgeladene Dokument
// (oder null, wenn noch keines vorliegt). Mehrere Uploads zum selben Ziel sind
// moeglich - etwa ein neuer Scan nach einer Korrektur - es zaehlt der letzte.
function dokumentStatus(schuljahr) {
  const docs = db
    .prepare('SELECT * FROM admin_dokumente WHERE schuljahr=? ORDER BY hochgeladen_am DESC, id DESC')
    .all(schuljahr);
  const neuestes = (art, zielId) =>
    docs.find((d) => d.art === art && (d.ziel_id ?? null) === (zielId ?? null)) || null;

  const proPool = db
    .prepare('SELECT id, name FROM pools WHERE schuljahr=? ORDER BY name COLLATE NOCASE')
    .all(schuljahr)
    .map((p) => ({ ...p, dokument: neuestes('pool', p.id) }));
  const proBereich = db
    .prepare('SELECT id, name FROM bereiche WHERE schuljahr=? ORDER BY name COLLATE NOCASE')
    .all(schuljahr)
    .map((b) => ({ ...b, dokument: neuestes('bereich', b.id) }));
  const uebersicht = neuestes('uebersicht', null);

  const alle = [...proPool, ...proBereich, { dokument: uebersicht }];
  return {
    proPool,
    proBereich,
    uebersicht,
    noetig: alle.length,
    vorhanden: alle.filter((a) => a.dokument).length,
    anzahlDateien: docs.length,
  };
}

module.exports = { dokumentStatus };
