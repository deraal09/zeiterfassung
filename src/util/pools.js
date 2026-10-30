const { db } = require('../db');
const { aktuellesSchuljahr, schuljahrVerschoben } = require('./schuljahr');

// Pools und Bereiche der Ausgleichsstunden (siehe Tabellen in db.js).
//
// Zentrale Regel: aus einem Pool wird nie mehr vergeben, als er enthaelt.
// Alle Wege, die Ausgleichsstunden vergeben oder veraendern, gehen ueber
// pruefeZuweisung(), damit die Grenze an genau einer Stelle gilt.

// Ausgleichsstunden werden in Viertelschritten vergeben; gerundet wird nur
// gegen Gleitkomma-Reste (0.1 + 0.2), nicht fachlich.
function rund(zahl) {
  return Math.round(zahl * 100) / 100;
}

function poolStand(pool) {
  const vergeben = db
    .prepare('SELECT COALESCE(SUM(ausgleichsstunden),0) AS s, COUNT(*) AS n FROM zuweisungen WHERE pool_id=?')
    .get(pool.id);
  return {
    ...pool,
    vergeben: rund(vergeben.s),
    frei: rund(pool.stunden - vergeben.s),
    anzahlZuweisungen: vergeben.n,
  };
}

function poolsMitStand(schuljahr) {
  return db
    .prepare('SELECT * FROM pools WHERE schuljahr=? ORDER BY name COLLATE NOCASE')
    .all(schuljahr)
    .map(poolStand);
}

function ladePool(id) {
  const zeile = db.prepare('SELECT * FROM pools WHERE id=?').get(Number(id));
  return zeile ? poolStand(zeile) : null;
}

// Gesamtpool eines Schuljahres: die Summe aller seiner Pools.
function gesamtPool(schuljahr) {
  const pools = poolsMitStand(schuljahr);
  const summe = (feld) => rund(pools.reduce((s, p) => s + p[feld], 0));
  return {
    schuljahr,
    anzahl: pools.length,
    stunden: summe('stunden'),
    vergeben: summe('vergeben'),
    frei: summe('frei'),
  };
}

// Prueft, ob eine Zuweisung mit diesen Werten zulaessig ist. ausserId nimmt
// die eigene, bereits gespeicherte Zuweisung aus der Rechnung - beim Aendern
// zaehlt ihr bisheriger Wert sonst doppelt.
function pruefeZuweisung({ poolId, schuljahr, stunden, ausserId = null }) {
  if (!poolId) return { ok: false, fehler: 'pool-fehlt' };
  const pool = ladePool(poolId);
  if (!pool) return { ok: false, fehler: 'pool-unbekannt' };
  if (pool.schuljahr !== schuljahr) return { ok: false, fehler: 'pool-schuljahr' };

  const eigene = ausserId
    ? (db.prepare('SELECT ausgleichsstunden AS h FROM zuweisungen WHERE id=? AND pool_id=?').get(ausserId, pool.id) || { h: 0 }).h
    : 0;
  const frei = rund(pool.frei + eigene);
  if (rund(stunden) > frei) return { ok: false, fehler: 'pool-voll', frei, pool };
  return { ok: true, pool, frei };
}

// Pools eines Schuljahres fuer eine Auswahlliste: "frei" ist der Wert, der
// bei dieser Zuweisung tatsaechlich zur Verfuegung steht (ohne die eigene).
function poolsFuerAuswahl(schuljahr, ausserZuweisung = null) {
  return poolsMitStand(schuljahr).map((p) => {
    const eigene = ausserZuweisung && ausserZuweisung.pool_id === p.id ? ausserZuweisung.ausgleichsstunden : 0;
    return { ...p, freiFuerAuswahl: rund(p.frei + eigene) };
  });
}

function bereicheListe(schuljahr) {
  return db.prepare('SELECT * FROM bereiche WHERE schuljahr=? ORDER BY name COLLATE NOCASE').all(schuljahr);
}

// Bereiche eines Schuljahres mit der Zahl ihrer Personen und den insgesamt
// zugeordneten Ausgleichsstunden.
function bereicheMitStand(schuljahr) {
  return db
    .prepare(
      `SELECT b.*, COUNT(z.id) AS anzahl_zuweisungen, COUNT(DISTINCT z.user_id) AS anzahl_personen,
              COALESCE(SUM(z.ausgleichsstunden),0) AS stunden
       FROM bereiche b LEFT JOIN zuweisungen z ON z.bereich_id = b.id
       WHERE b.schuljahr=? GROUP BY b.id ORDER BY b.name COLLATE NOCASE`
    )
    .all(schuljahr)
    .map((b) => ({ ...b, stunden: rund(b.stunden) }));
}

// Alle Schuljahre, die der Admin auswaehlen kann: jedes, zu dem es etwas gibt,
// dazu das laufende und das naechste (zum Vorbereiten, bevor es beginnt).
function adminSchuljahre() {
  const quellen = ['pools', 'bereiche', 'zuweisungen', 'schuljahr_faktoren', 'admin_dokumente'];
  const jahre = new Set([aktuellesSchuljahr(), schuljahrVerschoben(aktuellesSchuljahr(), 1)]);
  for (const tabelle of quellen) {
    for (const r of db.prepare(`SELECT DISTINCT schuljahr FROM ${tabelle}`).all()) jahre.add(r.schuljahr);
  }
  return [...jahre].filter(Boolean).sort().reverse();
}

// Kopiert Pools und Bereiche (und auf Wunsch die Zuweisungen) in ein anderes
// Schuljahr. Bereits vorhandene Namen bleiben unberuehrt - der Vorgang ist
// damit wiederholbar und ueberschreibt nie etwas. Zuweisungen werden ohne
// Verknuepfung zu einem Aufgabenbereich uebernommen (die gehoeren zum alten
// Schuljahr) und nur, soweit der Pool des Zieljahres sie noch fasst.
const uebernehmen = db.transaction(({ von, nach, mitZuweisungen, angelegtVon }) => {
  const ergebnis = { pools: 0, bereiche: 0, zuweisungen: 0, uebersprungen: 0 };

  const poolZuordnung = new Map();
  for (const p of db.prepare('SELECT * FROM pools WHERE schuljahr=?').all(von)) {
    const info = db.prepare('INSERT OR IGNORE INTO pools (schuljahr, name, stunden) VALUES (?,?,?)').run(nach, p.name, p.stunden);
    if (info.changes) ergebnis.pools += 1;
    poolZuordnung.set(p.id, db.prepare('SELECT id FROM pools WHERE schuljahr=? AND name=? COLLATE NOCASE').get(nach, p.name).id);
  }

  const bereichZuordnung = new Map();
  for (const b of db.prepare('SELECT * FROM bereiche WHERE schuljahr=?').all(von)) {
    const info = db.prepare('INSERT OR IGNORE INTO bereiche (schuljahr, name) VALUES (?,?)').run(nach, b.name);
    if (info.changes) ergebnis.bereiche += 1;
    bereichZuordnung.set(b.id, db.prepare('SELECT id FROM bereiche WHERE schuljahr=? AND name=? COLLATE NOCASE').get(nach, b.name).id);
  }

  if (mitZuweisungen) {
    // Nur Zuweisungen uebernehmen, die im Zieljahr noch nicht vorhanden sind
    // (gleiche Person im selben Pool) - sonst verdoppelte ein zweiter Lauf sie.
    const vorhanden = db.prepare('SELECT 1 FROM zuweisungen WHERE schuljahr=? AND user_id=? AND pool_id=?');
    for (const z of db.prepare('SELECT * FROM zuweisungen WHERE schuljahr=? AND pool_id IS NOT NULL ORDER BY id').all(von)) {
      const zielPool = poolZuordnung.get(z.pool_id);
      if (!zielPool || vorhanden.get(nach, z.user_id, zielPool)) {
        ergebnis.uebersprungen += 1;
        continue;
      }
      if (!pruefeZuweisung({ poolId: zielPool, schuljahr: nach, stunden: z.ausgleichsstunden }).ok) {
        ergebnis.uebersprungen += 1;
        continue;
      }
      db.prepare(
        'INSERT INTO zuweisungen (user_id, schuljahr, ausgleichsstunden, pool_id, bereich_id, created_by) VALUES (?,?,?,?,?,?)'
      ).run(z.user_id, nach, z.ausgleichsstunden, zielPool, z.bereich_id ? bereichZuordnung.get(z.bereich_id) : null, angelegtVon);
      ergebnis.zuweisungen += 1;
    }
  }
  return ergebnis;
});

module.exports = {
  rund,
  poolStand,
  poolsMitStand,
  ladePool,
  gesamtPool,
  pruefeZuweisung,
  poolsFuerAuswahl,
  bereicheListe,
  bereicheMitStand,
  adminSchuljahre,
  uebernehmen,
};
