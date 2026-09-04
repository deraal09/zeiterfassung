const test = require('node:test');
const assert = require('node:assert');
const { frischeUmgebung, ladeSrc } = require('./helpers');

function aufbau() {
  frischeUmgebung();
  const { db, initDb } = ladeSrc('db');
  initDb();
  const { zielZeitstunden, fortschrittProzent } = ladeSrc('util/stunden');

  db.prepare("INSERT INTO users (username, display_name) VALUES ('lehrer1','Lehrer Eins')").run();
  const kategorie = (ziel) =>
    db.prepare("INSERT INTO categories (user_id,title,schuljahr,ziel_zeitstunden) VALUES (1,'Kat','2026/27',?)").run(ziel)
      .lastInsertRowid;
  const hole = (id) => db.prepare('SELECT * FROM categories WHERE id=?').get(id);

  return { db, zielZeitstunden, fortschrittProzent, kategorie, hole };
}

test('ohne Zuweisung gilt das eigene Ziel der Lehrkraft', () => {
  const { zielZeitstunden, kategorie, hole } = aufbau();
  const id = kategorie(10);
  assert.deepEqual(zielZeitstunden(hole(id)), { stunden: 10, quelle: 'eigenes-ziel' });
});

test('ohne Zuweisung und ohne eigenes Ziel gibt es kein Ziel', () => {
  const { zielZeitstunden, kategorie, hole } = aufbau();
  const id = kategorie(null);
  assert.deepEqual(zielZeitstunden(hole(id)), { stunden: null, quelle: 'ohne-ziel' });
});

test('mit Zuweisung und Faktor zaehlt die offizielle Berechnung', () => {
  const { db, zielZeitstunden, kategorie, hole } = aufbau();
  const id = kategorie(10);
  db.prepare("INSERT INTO schuljahr_faktoren (schuljahr,zeitstunden_pro_woche,schulwochen) VALUES ('2026/27',1.7,40)").run();
  db.prepare("INSERT INTO zuweisungen (user_id,schuljahr,ausgleichsstunden,category_id) VALUES (1,'2026/27',2,?)").run(id);

  // 2 x 1,7 x 40 = 136 - das eigene Ziel von 10 wird ignoriert.
  assert.deepEqual(zielZeitstunden(hole(id)), { stunden: 136, quelle: 'zuweisung' });
});

test('ein fehlender Schuljahr-Faktor ergibt kein Ziel von 0', () => {
  const { db, zielZeitstunden, fortschrittProzent, kategorie, hole } = aufbau();
  const id = kategorie(null);
  // Zuweisung ohne gepflegten Faktor fuer ihr Schuljahr.
  db.prepare("INSERT INTO zuweisungen (user_id,schuljahr,ausgleichsstunden,category_id) VALUES (1,'2026/27',2,?)").run(id);

  const ziel = zielZeitstunden(hole(id));
  assert.deepEqual(ziel, { stunden: null, quelle: 'kein-faktor' });

  // Frueher stand hier 0, woraus der Balken erfasst/0 = Infinity und damit
  // 100 % machte - bei in Wahrheit unbekanntem Ziel.
  assert.equal(fortschrittProzent(5, ziel.stunden), null);
});

test('der Fortschritt wird bei 100 Prozent gedeckelt', () => {
  const { fortschrittProzent } = aufbau();
  assert.equal(fortschrittProzent(0, 10), 0);
  assert.equal(fortschrittProzent(5, 10), 50);
  assert.equal(fortschrittProzent(20, 10), 100);
  assert.equal(fortschrittProzent(5, 0), null, 'ein Ziel von 0 ist kein Ziel');
});
