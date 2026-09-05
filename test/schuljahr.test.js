const test = require('node:test');
const assert = require('node:assert');
const { schuljahrFuer, istSchuljahr, schuljahrVerschoben } = require('../src/util/schuljahr');

test('das Schuljahr wechselt am 1. August', () => {
  assert.equal(schuljahrFuer(new Date(2026, 6, 31)), '2025/26', '31. Juli gehoert noch zum alten');
  assert.equal(schuljahrFuer(new Date(2026, 7, 1)), '2026/27', '1. August beginnt das neue');
  assert.equal(schuljahrFuer(new Date(2026, 11, 24)), '2026/27');
  assert.equal(schuljahrFuer(new Date(2027, 0, 7)), '2026/27');
});

test('erkennt gueltige Schuljahre', () => {
  assert.equal(istSchuljahr('2026/27'), true);
  assert.equal(istSchuljahr('1999/00'), true, 'Jahrhundertwechsel');
  assert.equal(istSchuljahr('2099/00'), true);
});

test('weist Schuljahre zurueck, die es nicht gibt', () => {
  // Ohne diese Pruefung liesse sich ueber die Adresszeile ein Faktor fuer ein
  // erfundenes Schuljahr anlegen, den nie wieder etwas erreicht.
  assert.equal(istSchuljahr('2026/28'), false, 'zweite Zahl folgt nicht auf die erste');
  assert.equal(istSchuljahr('2026/26'), false);
  assert.equal(istSchuljahr('2026-27'), false);
  assert.equal(istSchuljahr('26/27'), false);
  assert.equal(istSchuljahr(''), false);
  assert.equal(istSchuljahr(null), false);
});

test('verschiebt Schuljahre ueber Jahrhundertgrenzen hinweg', () => {
  assert.equal(schuljahrVerschoben('2026/27', -1), '2025/26');
  assert.equal(schuljahrVerschoben('2026/27', 1), '2027/28');
  assert.equal(schuljahrVerschoben('1999/00', 1), '2000/01');
  assert.equal(schuljahrVerschoben('2000/01', -1), '1999/00');
});
