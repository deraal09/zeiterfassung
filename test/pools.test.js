const test = require('node:test');
const assert = require('node:assert');
const { frischeUmgebung, ladeSrc } = require('./helpers');

function aufbau() {
  frischeUmgebung();
  const { db, initDb } = ladeSrc('db');
  initDb();
  const pools = ladeSrc('util/pools');
  db.prepare("INSERT INTO users (username, display_name) VALUES ('anna','Anna'), ('bernd','Bernd')").run();
  db.prepare("INSERT INTO pools (schuljahr, name, stunden) VALUES ('2026/27','Digitalisierung',10), ('2026/27','Schulentwicklung',4)").run();
  db.prepare("INSERT INTO bereiche (schuljahr, name) VALUES ('2026/27','Technik')").run();
  const zuweise = (userId, stunden, poolId, bereichId = null) =>
    db
      .prepare('INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, pool_id, bereich_id) VALUES (?,?,?,?,?)')
      .run(userId, '2026/27', stunden, poolId, bereichId).lastInsertRowid;
  return { db, zuweise, ...pools };
}

test('Pool-Stand zaehlt vergebene Stunden und freie Reste', () => {
  const { zuweise, poolsMitStand, gesamtPool } = aufbau();
  zuweise(1, 2.5, 1);
  zuweise(2, 3, 1);
  const [digital, entwicklung] = poolsMitStand('2026/27');
  assert.equal(digital.name, 'Digitalisierung');
  assert.equal(digital.vergeben, 5.5);
  assert.equal(digital.frei, 4.5);
  assert.equal(entwicklung.vergeben, 0);

  const gesamt = gesamtPool('2026/27');
  assert.deepEqual(
    { anzahl: gesamt.anzahl, stunden: gesamt.stunden, vergeben: gesamt.vergeben, frei: gesamt.frei },
    { anzahl: 2, stunden: 14, vergeben: 5.5, frei: 8.5 }
  );
});

test('es laesst sich nicht mehr vergeben, als der Pool enthaelt', () => {
  const { zuweise, pruefeZuweisung } = aufbau();
  zuweise(1, 8, 1);

  assert.equal(pruefeZuweisung({ poolId: 1, schuljahr: '2026/27', stunden: 2 }).ok, true, 'genau bis zur Grenze');
  const zuViel = pruefeZuweisung({ poolId: 1, schuljahr: '2026/27', stunden: 2.25 });
  assert.equal(zuViel.ok, false);
  assert.equal(zuViel.fehler, 'pool-voll');
  assert.equal(zuViel.frei, 2);
});

test('beim Aendern zaehlt die eigene Zuweisung nicht doppelt', () => {
  const { zuweise, pruefeZuweisung } = aufbau();
  const id = zuweise(1, 8, 1);
  assert.equal(pruefeZuweisung({ poolId: 1, schuljahr: '2026/27', stunden: 10, ausserId: id }).ok, true);
  assert.equal(pruefeZuweisung({ poolId: 1, schuljahr: '2026/27', stunden: 10.25, ausserId: id }).fehler, 'pool-voll');
  assert.equal(pruefeZuweisung({ poolId: 1, schuljahr: '2026/27', stunden: 10 }).fehler, 'pool-voll', 'ohne ausserId zaehlt sie mit');
});

test('Wechsel in einen anderen Pool prueft dessen Rest, nicht den alten', () => {
  const { zuweise, pruefeZuweisung } = aufbau();
  const id = zuweise(1, 5, 1);
  assert.equal(pruefeZuweisung({ poolId: 2, schuljahr: '2026/27', stunden: 5, ausserId: id }).fehler, 'pool-voll');
  assert.equal(pruefeZuweisung({ poolId: 2, schuljahr: '2026/27', stunden: 4, ausserId: id }).ok, true);
});

test('Pflicht und Schuljahr: ohne Pool, unbekannter Pool, falsches Schuljahr', () => {
  const { pruefeZuweisung } = aufbau();
  assert.equal(pruefeZuweisung({ poolId: null, schuljahr: '2026/27', stunden: 1 }).fehler, 'pool-fehlt');
  assert.equal(pruefeZuweisung({ poolId: 99, schuljahr: '2026/27', stunden: 1 }).fehler, 'pool-unbekannt');
  assert.equal(pruefeZuweisung({ poolId: 1, schuljahr: '2025/26', stunden: 1 }).fehler, 'pool-schuljahr');
});

test('Gleitkomma-Reste verhindern keine Vergabe bis zur Grenze', () => {
  const { db, zuweise, pruefeZuweisung } = aufbau();
  db.prepare('UPDATE pools SET stunden=0.3 WHERE id=1').run();
  zuweise(1, 0.1, 1);
  zuweise(2, 0.2, 1);
  assert.equal(pruefeZuweisung({ poolId: 1, schuljahr: '2026/27', stunden: 0.01 }).fehler, 'pool-voll');
  assert.equal(ladePoolFrei(), 0);
  function ladePoolFrei() {
    return ladeSrc('util/pools').ladePool(1).frei;
  }
});

test('Pool- und Bereichsnamen sind je Schuljahr eindeutig (ohne Gross-/Kleinschreibung)', () => {
  const { db } = aufbau();
  assert.throws(() => db.prepare("INSERT INTO pools (schuljahr,name,stunden) VALUES ('2026/27','digitalisierung',1)").run(), /UNIQUE/);
  assert.doesNotThrow(() => db.prepare("INSERT INTO pools (schuljahr,name,stunden) VALUES ('2027/28','Digitalisierung',1)").run());
  assert.throws(() => db.prepare("INSERT INTO bereiche (schuljahr,name) VALUES ('2026/27','TECHNIK')").run(), /UNIQUE/);
});

test('Uebernahme ins naechste Schuljahr: Pools, Bereiche, Zuweisungen - und wiederholbar', () => {
  const { db, zuweise, uebernehmen, poolsMitStand } = aufbau();
  zuweise(1, 3, 1, 1);
  zuweise(2, 1, 2, null);

  const erst = uebernehmen({ von: '2026/27', nach: '2027/28', mitZuweisungen: true, angelegtVon: 'admin' });
  assert.deepEqual(erst, { pools: 2, bereiche: 1, zuweisungen: 2, uebersprungen: 0 });

  const neu = poolsMitStand('2027/28');
  assert.deepEqual(neu.map((p) => [p.name, p.stunden, p.vergeben]), [['Digitalisierung', 10, 3], ['Schulentwicklung', 4, 1]]);
  const z = db.prepare("SELECT * FROM zuweisungen WHERE schuljahr='2027/28' AND user_id=1").get();
  assert.equal(z.category_id, null, 'keine Verknuepfung mit Aufgabenbereichen des Vorjahres');
  assert.equal(db.prepare('SELECT schuljahr FROM bereiche WHERE id=?').get(z.bereich_id).schuljahr, '2027/28');

  const nochmal = uebernehmen({ von: '2026/27', nach: '2027/28', mitZuweisungen: true, angelegtVon: 'admin' });
  assert.deepEqual(nochmal, { pools: 0, bereiche: 0, zuweisungen: 0, uebersprungen: 2 }, 'nichts wird doppelt angelegt');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM zuweisungen WHERE schuljahr='2027/28'").get().n, 2);
});

test('Uebernahme ohne Zuweisungen legt nur die Struktur an, und ein kleinerer Ziel-Pool begrenzt', () => {
  const { db, zuweise, uebernehmen } = aufbau();
  zuweise(1, 3, 1);
  const nurStruktur = uebernehmen({ von: '2026/27', nach: '2027/28', mitZuweisungen: false, angelegtVon: 'admin' });
  assert.equal(nurStruktur.zuweisungen, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM zuweisungen WHERE schuljahr='2027/28'").get().n, 0);

  db.prepare("UPDATE pools SET stunden=2 WHERE schuljahr='2027/28' AND name='Digitalisierung'").run();
  const begrenzt = uebernehmen({ von: '2026/27', nach: '2027/28', mitZuweisungen: true, angelegtVon: 'admin' });
  assert.equal(begrenzt.zuweisungen, 0, '3 Stunden passen nicht in einen Pool mit 2');
  assert.equal(begrenzt.uebersprungen, 1);
});

test('Adminauswahl der Schuljahre enthaelt laufendes, naechstes und alle vorhandenen', () => {
  const { adminSchuljahre } = aufbau();
  const { aktuellesSchuljahr, schuljahrVerschoben } = ladeSrc('util/schuljahr');
  const jahre = adminSchuljahre();
  assert.ok(jahre.includes(aktuellesSchuljahr()));
  assert.ok(jahre.includes(schuljahrVerschoben(aktuellesSchuljahr(), 1)));
  assert.ok(jahre.includes('2026/27'));
  assert.deepEqual(jahre, [...jahre].sort().reverse(), 'neuestes zuerst');
});
