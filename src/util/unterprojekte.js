const { db } = require('../db');

// Holt (oder legt bei Bedarf an) das Auffang-Unterprojekt einer Kategorie -
// dorthin wandern Zeiten, die keinem konkreten Unterprojekt zugeordnet
// wurden, sobald die Kategorie ueberhaupt Unterprojekte hat.
//
// Erkannt wird es am Kennzeichen ist_auffang, nicht mehr am Titel: sonst
// wuerde ein von der Lehrkraft selbst "Allgemein" genanntes Unterprojekt
// ungewollt zum Auffang, und ein Umbenennen erzeugte ein zweites.
function auffangUnterprojekt(categoryId) {
  let up = db.prepare('SELECT * FROM unterprojekte WHERE category_id=? AND ist_auffang=1').get(categoryId);
  if (!up) {
    const info = db
      .prepare('INSERT INTO unterprojekte (category_id, title, ist_auffang) VALUES (?,?,1)')
      .run(categoryId, 'Allgemein');
    up = db.prepare('SELECT * FROM unterprojekte WHERE id=?').get(info.lastInsertRowid);
  }
  return up;
}

// Loest die zu speichernde unterprojekt_id auf. Unterprojekte sind komplett
// optional: hat die Kategorie noch keine, bleibt der Eintrag unzugeordnet
// (null). Hat sie welche, zaehlt entweder das explizit gewaehlte (wenn es
// zu dieser Kategorie gehoert) oder sonst automatisch "Allgemein" - damit
// hat in einer Kategorie mit Unterprojekten am Ende jede Zeit eins
// zugeordnet.
function resolveUnterprojektId(categoryId, submittedId) {
  const hatUnterprojekte = !!db.prepare('SELECT 1 FROM unterprojekte WHERE category_id=? LIMIT 1').get(categoryId);
  if (!hatUnterprojekte) return null;
  if (submittedId) {
    const up = db.prepare('SELECT id FROM unterprojekte WHERE id=? AND category_id=?').get(submittedId, categoryId);
    if (up) return up.id;
  }
  return auffangUnterprojekt(categoryId).id;
}

module.exports = { auffangUnterprojekt, resolveUnterprojektId };
