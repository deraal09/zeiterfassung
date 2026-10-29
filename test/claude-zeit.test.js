const test = require('node:test');
const assert = require('node:assert');
const lib = require('../tools/claude-zeit-lib');

const min = (n) => n * 60 * 1000;
const t0 = Date.parse('2026-10-08T08:00:00Z');

test('Projektpfad wird wie von Claude Code kodiert', () => {
  assert.equal(lib.kodiereProjektPfad('/home/user/zeiterfassung'), '-home-user-zeiterfassung');
  assert.equal(lib.kodiereProjektPfad('C:\\Users\\Anna\\mein projekt'), 'C--Users-Anna-mein-projekt');
});

test('Sitzung lesen: nur Nachrichten zaehlen, kaputte Zeilen werden uebersprungen', () => {
  const text = [
    JSON.stringify({ type: 'user', timestamp: '2026-10-08T08:05:00.000Z', sessionId: 's1', cwd: '/p' }),
    JSON.stringify({ type: 'mode', timestamp: '2026-10-08T07:00:00.000Z' }),
    '{halbe zeile',
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-08T08:00:00.000Z', sessionId: 's1' }),
    JSON.stringify({ type: 'assistant', timestamp: 'kein datum' }),
    '',
  ].join('\n');
  const s = lib.leseSitzung(text);
  assert.equal(s.sessionId, 's1');
  assert.equal(s.cwd, '/p');
  assert.deepEqual(s.zeitpunkte, [Date.parse('2026-10-08T08:00:00Z'), Date.parse('2026-10-08T08:05:00Z')], 'sortiert');
});

test('Pausen teilen Bloecke, kuerzere Luecken nicht', () => {
  const zeiten = [t0, t0 + min(5), t0 + min(20), t0 + min(60), t0 + min(61)];
  const bloecke = lib.baueBloecke(zeiten, 15);
  assert.deepEqual(bloecke, [
    { start: t0, ende: t0 + min(20) },
    { start: t0 + min(60), ende: t0 + min(61) },
  ]);
});

test('Block ueber Mitternacht wird in Tagesabschnitte geteilt', () => {
  const start = new Date(2026, 9, 8, 23, 30).getTime();
  const ende = new Date(2026, 9, 9, 0, 45).getTime();
  const teile = lib.teileAnMitternacht({ start, ende });
  assert.equal(teile.length, 2);
  assert.equal(teile[0].ende, new Date(2026, 9, 9, 0, 0).getTime());
  assert.equal(teile[1].start, new Date(2026, 9, 9, 0, 0).getTime());
  assert.equal(teile[1].ende, ende);
});

test('Runden: Beginn ab-, Ende aufrunden, mindestens eine Minute', () => {
  const r = lib.rundeAufMinuten({ start: t0 + 20000, ende: t0 + min(2) + 1000 });
  assert.equal(r.start, t0);
  assert.equal(r.ende, t0 + min(3));
  const einzel = lib.rundeAufMinuten({ start: t0 + 5000, ende: t0 + 5000 });
  assert.equal(einzel.ende - einzel.start, min(1));
});

test('Eintraege: stabile external_id, auch wenn der Block waechst', () => {
  const basis = { sessionId: 's1', beschreibung: 'x', aufgabenbereichId: 1, mindestMinuten: 1 };
  const frueh = lib.bloeckeZuEintraegen({ ...basis, bloecke: [{ start: t0, ende: t0 + min(10) }] });
  const spaet = lib.bloeckeZuEintraegen({ ...basis, bloecke: [{ start: t0, ende: t0 + min(30) }] });
  assert.equal(frueh.length, 1);
  assert.equal(frueh[0].external_id, spaet[0].external_id);
  assert.notEqual(frueh[0].ende, spaet[0].ende);
  assert.equal(frueh[0].beginn, '2026-10-08T08:00:00.000Z');
});

test('Eintraege: Mindestdauer, Stichtag und Unterprojekt', () => {
  const bloecke = [
    { start: t0, ende: t0 + min(1) },
    { start: t0 + min(60), ende: t0 + min(100) },
  ];
  const basis = { sessionId: 's1', beschreibung: 'x', aufgabenbereichId: 1 };
  assert.equal(lib.bloeckeZuEintraegen({ ...basis, bloecke, mindestMinuten: 5 }).length, 1);
  assert.equal(lib.bloeckeZuEintraegen({ ...basis, bloecke, mindestMinuten: 1, seitMs: t0 + min(30) }).length, 1);
  const mit = lib.bloeckeZuEintraegen({ ...basis, bloecke, mindestMinuten: 1, unterprojekt: 'Kurs B' });
  assert.equal(mit[0].unterprojekt, 'Kurs B');
});

test('Beschreibungsvorlage und Dauerformat', () => {
  assert.equal(lib.baueBeschreibung(undefined, 'mein-projekt'), 'Claude Code: mein-projekt');
  assert.equal(lib.baueBeschreibung('Arbeit an {projekt} ({projekt})', 'p'), 'Arbeit an p (p)');
  assert.equal(lib.formatDauer(45), '45 min');
  assert.equal(lib.formatDauer(125), '2 h 05 min');
});
