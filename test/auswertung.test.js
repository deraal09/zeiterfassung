const test = require('node:test');
const assert = require('node:assert');
const { nizeMax, achse, balkenDaten, kategorieFarbe, kategorienBalkenDaten } = require('../src/util/auswertung');

test('nizeMax rundet auf 1/2/5/10 x 10^n auf', () => {
  assert.equal(nizeMax(7), 10);
  assert.equal(nizeMax(4), 5);
  assert.equal(nizeMax(17.3), 20);
  assert.equal(nizeMax(10), 10, 'ein bereits rundes Maximum wird nicht unnoetig hochgerundet');
  assert.equal(nizeMax(0.5), 0.5, 'funktioniert auch unter 1 Stunde');
});

test('nizeMax faengt 0 und negative Werte ab', () => {
  assert.equal(nizeMax(0), 1);
  assert.equal(nizeMax(-5), 1);
});

test('achse liefert gleich grosse Schritte von 0 bis zum aufgerundeten Maximum', () => {
  assert.deepEqual(achse(17.3), { max: 20, ticks: [0, 5, 10, 15, 20] });
  assert.deepEqual(achse(8, 2), { max: 10, ticks: [0, 5, 10] });
});

test('balkenDaten liefert null, wenn keine Kategorie Zeiten hat', () => {
  assert.equal(balkenDaten([{ title: 'A', synced: 0, entwurf: 0 }], 200), null);
  assert.equal(balkenDaten([], 200), null);
});

test('balkenDaten laesst Kategorien ohne erfasste Zeit weg', () => {
  const ergebnis = balkenDaten(
    [
      { title: 'Leer', synced: 0, entwurf: 0 },
      { title: 'Mit Zeiten', synced: 2, entwurf: 0 },
    ],
    200
  );
  assert.equal(ergebnis.balken.length, 1);
  assert.equal(ergebnis.balken[0].title, 'Mit Zeiten');
});

test('balkenDaten zeigt auch sehr kleine Werte noch als sichtbares Segment', () => {
  // 5 Minuten (~0,083h) auf einer Achse mit Maximum 10h wuerden gerundet
  // 0px ergeben - das Segment soll trotzdem sichtbar bleiben (>= 2px).
  const ergebnis = balkenDaten(
    [
      { title: 'Gross', synced: 8, entwurf: 0 },
      { title: 'Winzig', synced: 5 / 60, entwurf: 0 },
    ],
    200
  );
  const winzig = ergebnis.balken.find((b) => b.title === 'Winzig');
  assert.equal(winzig.syncedPx >= 2, true);
  assert.equal(winzig.entwurfPx, 0, 'ein echter Wert von 0 bleibt 0px');
});

test('balkenDaten mit alleZeilen behaelt Nullwerte als Luecke im Balken', () => {
  // Zeitleiste: Monate ohne Zeit (z. B. Sommerferien) sollen als 0h-Balken
  // sichtbar bleiben statt zu verschwinden.
  const ergebnis = balkenDaten(
    [
      { title: 'Aug', synced: 3, entwurf: 0 },
      { title: 'Sep', synced: 0, entwurf: 0 },
      { title: 'Okt', synced: 1, entwurf: 0 },
    ],
    200,
    { alleZeilen: true }
  );
  assert.equal(ergebnis.balken.length, 3);
  assert.equal(ergebnis.balken.map((b) => b.title).join(','), 'Aug,Sep,Okt', 'Reihenfolge bleibt erhalten');
  const sep = ergebnis.balken.find((b) => b.title === 'Sep');
  assert.equal(sep.syncedPx, 0);
  assert.equal(sep.entwurfPx, 0);
});

test('balkenDaten mit alleZeilen liefert trotzdem null, wenn wirklich ueberall 0h steht', () => {
  assert.equal(
    balkenDaten([{ title: 'Aug', synced: 0, entwurf: 0 }], 200, { alleZeilen: true }),
    null
  );
});

test('balkenDaten berechnet Pixelhoehen relativ zum Achsen-Maximum', () => {
  // Groesster Balken: 2 + 3 = 5h -> Achse rundet auf 5 (max) auf.
  const ergebnis = balkenDaten(
    [
      { title: 'A', synced: 2, entwurf: 3 },
      { title: 'B', synced: 1, entwurf: 0 },
    ],
    200
  );
  assert.equal(ergebnis.max, 5);
  const a = ergebnis.balken.find((b) => b.title === 'A');
  assert.equal(a.summe, 5);
  assert.equal(a.syncedPx, 80, '2/5 von 200px');
  assert.equal(a.entwurfPx, 120, '3/5 von 200px');
  const b = ergebnis.balken.find((b2) => b2.title === 'B');
  assert.equal(b.syncedPx, 40, '1/5 von 200px');
  assert.equal(b.entwurfPx, 0);
});

test('kategorieFarbe liefert eine CSS-Variable mit Hex-Fallback je Farbindex', () => {
  assert.equal(kategorieFarbe(0), 'var(--chart-series-1, #2a78d6)');
  assert.equal(kategorieFarbe(7), 'var(--chart-series-8, #e34948)');
  assert.equal(kategorieFarbe(-1), 'var(--chart-series-andere, #767672)', '"Andere" bekommt eine eigene, neutrale Farbe');
});

test('kategorienBalkenDaten liefert null, wenn nirgends Zeit erfasst wurde', () => {
  const serien = [{ key: '1', label: 'A', farbindex: 0, farbe: kategorieFarbe(0) }];
  assert.equal(kategorienBalkenDaten([{ title: 'Aug', werte: [0] }], serien, 200), null);
  assert.equal(kategorienBalkenDaten([], serien, 200), null);
});

test('kategorienBalkenDaten behaelt alle Monate, auch ohne jede Zeit (Luecke)', () => {
  const serien = [
    { key: '1', label: 'A', farbindex: 0, farbe: kategorieFarbe(0) },
    { key: '2', label: 'B', farbindex: 1, farbe: kategorieFarbe(1) },
  ];
  const ergebnis = kategorienBalkenDaten(
    [
      { title: 'Aug', werte: [2, 0] },
      { title: 'Sep', werte: [0, 0] },
      { title: 'Okt', werte: [0, 3] },
    ],
    serien,
    200
  );
  assert.equal(ergebnis.balken.length, 3);
  assert.equal(ergebnis.balken.map((b) => b.title).join(','), 'Aug,Sep,Okt');
  const sep = ergebnis.balken.find((b) => b.title === 'Sep');
  assert.equal(sep.summe, 0);
  assert.equal(sep.segmente.every((s) => s.px === 0), true);
});

test('kategorienBalkenDaten ordnet Segmente je Balken der Reihenfolge von serien zu und rundet nur das oberste sichtbare Segment', () => {
  const serien = [
    { key: '1', label: 'A', farbindex: 0, farbe: kategorieFarbe(0) },
    { key: '2', label: 'B', farbindex: 1, farbe: kategorieFarbe(1) },
    { key: '3', label: 'C', farbindex: 2, farbe: kategorieFarbe(2) },
  ];
  const ergebnis = kategorienBalkenDaten([{ title: 'Aug', werte: [2, 0, 1] }], serien, 200);
  const balken = ergebnis.balken[0];
  assert.equal(balken.summe, 3);
  assert.equal(balken.segmente.map((s) => s.label).join(','), 'A,B,C', 'Reihenfolge folgt serien, nicht dem Wert');
  assert.equal(balken.segmente[0].farbe, kategorieFarbe(0));
  assert.equal(balken.segmente[1].px, 0, 'B hat 0h und bleibt unsichtbar');
  assert.equal(balken.segmente[1].obenAbgerundet, undefined);
  assert.equal(balken.segmente[2].obenAbgerundet, true, 'C ist das letzte Segment mit Wert > 0');
});
