const test = require('node:test');
const assert = require('node:assert');
const { interneZielseite } = require('../src/util/redirect');

test('fremde Ziele fuehren nie aus der Anwendung heraus', () => {
  // Der Origin wird grundsaetzlich verworfen, deshalb bleibt selbst bei einem
  // praeparierten Referer nur ein Pfad dieser Anwendung uebrig.
  assert.equal(interneZielseite('https://evil.example.com/phish'), '/phish');
  assert.equal(interneZielseite('//evil.example.com/phish'), '/phish');
  assert.equal(interneZielseite('https://evil.example.com'), '/');
  assert.equal(interneZielseite('javascript:alert(1)'), '/');
});

test('normale Browser-Referer landen auf der richtigen Seite', () => {
  // Browser senden den Referer absolut - das muss weiterhin funktionieren.
  assert.equal(interneZielseite('http://schule.de:3000/categories/1?von=2026-09-01'), '/categories/1?von=2026-09-01');
  assert.equal(interneZielseite('/categories/1'), '/categories/1');
});

test('fehlender oder unbrauchbarer Referer faellt auf die Startseite zurueck', () => {
  assert.equal(interneZielseite(null), '/');
  assert.equal(interneZielseite(undefined), '/');
  assert.equal(interneZielseite(''), '/');
});
