const test = require('node:test');
const assert = require('node:assert');
const { baueZeitraum, parseDatumEingabe, normalisiereZeitstempel, MAX_DAUER_MINUTEN } = require('../src/util/time');

test('normalisiert gueltige Eingaben in die Speicherform', () => {
  assert.deepEqual(baueZeitraum({ datum: '2026-09-02', von: '08:00', bis: '10:00' }), {
    startStr: '2026-09-02 08:00:00',
    endStr: '2026-09-02 10:00:00',
    dauer: 120,
  });

  // Einstellige Stunde und deutsches Datum muessen normalisiert ankommen -
  // sonst kann SQLite den Wert spaeter nicht als Zeitpunkt lesen.
  assert.equal(baueZeitraum({ datum: '02.09.2026', von: '9:05', bis: '11:05' }).startStr, '2026-09-02 09:05:00');
});

test('weist Daten zurueck, die es im Kalender nicht gibt', () => {
  // Nur das Format zu pruefen reicht nicht: "2026-13-45" passt aufs Muster.
  assert.equal(baueZeitraum({ datum: '2026-13-45', von: '08:00', bis: '10:00' }).fehler, 'ungueltiges-datum');
  assert.equal(baueZeitraum({ datum: '2026-02-29', von: '08:00', bis: '10:00' }).fehler, 'ungueltiges-datum');
  assert.equal(parseDatumEingabe('31.04.2026'), null);
  assert.equal(parseDatumEingabe('2028-02-29'), '2028-02-29', 'Schaltjahr bleibt gueltig');
});

test('weist unvollstaendige Uhrzeiten zurueck', () => {
  assert.equal(baueZeitraum({ datum: '2026-09-02', von: '9:5', bis: '11:5' }).fehler, 'ungueltige-uhrzeit');
  assert.equal(baueZeitraum({ datum: '2026-09-02', von: '25:00', bis: '26:00' }).fehler, 'ungueltige-uhrzeit');
});

test('eine Taetigkeit ueber Mitternacht braucht ein Bis-Datum', () => {
  const ueberNacht = baueZeitraum({ datum: '2026-09-03', von: '22:00', bis: '01:00', bisDatum: '2026-09-04' });
  assert.equal(ueberNacht.startStr, '2026-09-03 22:00:00');
  assert.equal(ueberNacht.endStr, '2026-09-04 01:00:00');
  assert.equal(ueberNacht.dauer, 180);

  // Ohne Bis-Datum sind das vertauschte Uhrzeiten und keine 23-Stunden-Schicht.
  assert.equal(baueZeitraum({ datum: '2026-09-03', von: '22:00', bis: '01:00' }).fehler, 'ungueltige-zeit');
});

test('begrenzt die Dauer eines einzelnen Eintrags', () => {
  // Ein falsches Jahr im Bis-Datum ergaebe sonst vierstellige Stundenwerte.
  assert.equal(
    baueZeitraum({ datum: '2026-09-03', von: '08:00', bis: '10:00', bisDatum: '2027-09-03' }).fehler,
    'zu-lang'
  );
  const genauMax = baueZeitraum({ datum: '2026-09-02', von: '08:00', bis: '08:00', bisDatum: '2026-09-03' });
  assert.equal(genauMax.dauer, MAX_DAUER_MINUTEN, 'die Grenze selbst ist noch erlaubt');
});

test('normalisiert gespeicherte Zeitstempel, erfindet aber keine Daten', () => {
  assert.equal(normalisiereZeitstempel('2026-09-01 9:5:00'), '2026-09-01 09:05:00');
  assert.equal(normalisiereZeitstempel('2026-09-02 08:00:00'), '2026-09-02 08:00:00');
  // Wuerde beim Weiterrechnen zum 14.02.2027 - das waere ein erfundenes Datum.
  assert.equal(normalisiereZeitstempel('2026-13-45 08:00:00'), null);
  assert.equal(normalisiereZeitstempel('kein datum'), null);
});
