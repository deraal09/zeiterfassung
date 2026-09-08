const test = require('node:test');
const assert = require('node:assert');
const { nizeMax, achse, balkenDaten } = require('../src/util/auswertung');

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
