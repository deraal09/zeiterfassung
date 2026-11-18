const test = require('node:test');
const assert = require('node:assert');
const { frischeUmgebung, ladeSrc } = require('./helpers');

test('zahl: deutsche Schreibweise ohne ueberfluessige Nullen', () => {
  frischeUmgebung();
  const { zahl } = ladeSrc('util/zahl');
  assert.equal(zahl(136), '136');
  assert.equal(zahl(10.5), '10,5');
  assert.equal(zahl(33.75), '33,75');
  assert.equal(zahl(1 / 3), '0,33');
  assert.equal(zahl(1234.5), '1.234,5');
});

test('flash: die Meldung steht beim naechsten render() genau einmal bereit', () => {
  frischeUmgebung();
  const { flashMiddleware } = ladeSrc('middleware/flash');
  const gerendert = [];
  const session = {};
  const req = { session };
  const res = { locals: {}, render: () => gerendert.push(res.locals.flash) };
  flashMiddleware(req, res, () => {});

  req.flash('Zeiterfassung gestartet.');
  assert.equal(session.flash, 'Zeiterfassung gestartet.');
  assert.equal(res.locals.flash, null, 'vor dem Rendern noch nicht gesetzt');

  res.render('x');
  assert.deepEqual(gerendert, ['Zeiterfassung gestartet.']);
  assert.equal(session.flash, undefined, 'nach dem Rendern verbraucht');

  const res2 = { locals: {}, render: () => gerendert.push(res2.locals.flash) };
  flashMiddleware(req, res2, () => {});
  res2.render('x');
  assert.equal(gerendert[1], null, 'beim zweiten Aufruf keine Meldung mehr');
});

test('laufender Timer: nur fuer angemeldete Personen und nur bei GET', () => {
  frischeUmgebung();
  const { db, initDb } = ladeSrc('db');
  initDb();
  const { encrypt } = ladeSrc('util/crypto');
  const { laufenderTimer } = ladeSrc('middleware/laufender-timer');
  db.prepare("INSERT INTO users (username, display_name) VALUES ('anna','Anna'), ('bernd','Bernd')").run();
  db.prepare("INSERT INTO categories (user_id,title,schuljahr) VALUES (1,'Moodle','2026/27')").run();
  db.prepare(
    "INSERT INTO time_entries (category_id,user_id,beschreibung,start_time,source) VALUES (1,1,?,'2026-10-01 08:00:00','timer')"
  ).run(encrypt('Kurse anlegen'));

  const lauf = (user, method = 'GET') => {
    const res = { locals: {} };
    laufenderTimer({ session: { user }, method }, res, () => {});
    return res.locals.laufenderTimer;
  };

  const timer = lauf({ id: 1 });
  assert.equal(timer.beschreibung, 'Kurse anlegen', 'Beschreibung wird entschluesselt');
  assert.equal(timer.category_title, 'Moodle');
  assert.equal(lauf({ id: 2 }), null, 'fremder Timer bleibt unsichtbar');
  assert.equal(lauf(null), null, 'ohne Anmeldung kein Timer');
  assert.equal(lauf({ id: 1 }, 'POST'), null, 'bei POST wird nichts geladen');
});
