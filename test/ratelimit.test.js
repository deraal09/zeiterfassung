const test = require('node:test');
const assert = require('node:assert');
const { frischeUmgebung, ladeSrc } = require('./helpers');

function aufbau() {
  frischeUmgebung();
  ladeSrc('db').initDb();
  return ladeSrc('auth/login-ratelimit');
}

const IP = '192.0.2.10';

test('sperrt einen Benutzernamen ab der Schwelle', () => {
  const rl = aufbau();
  assert.equal(rl.pruefeSperre('lehrer1', IP).gesperrt, false);

  for (let i = 0; i < rl.SCHWELLE_BENUTZER; i++) rl.vermerkeFehlversuch('lehrer1', IP);
  assert.equal(rl.pruefeSperre('lehrer1', IP).gesperrt, true);

  // Ein anderer Name von derselben Adresse ist noch frei - die Adresse hat
  // eine viel hoehere Schwelle, damit sich nicht das ganze Kollegium hinter
  // einer gemeinsamen Adresse gegenseitig aussperrt.
  assert.equal(rl.pruefeSperre('lehrer2', IP).gesperrt, false);
});

test('sperrt auch die Adresse, wenn viele Namen durchprobiert werden', () => {
  const rl = aufbau();
  // Password Spraying: jeder Name nur einmal, damit die Namens-Schwelle nie
  // greift. Ohne Adressbezug bliebe das voellig unbemerkt.
  for (let i = 0; i < rl.SCHWELLE_ADRESSE; i++) rl.vermerkeFehlversuch(`lehrer${i}`, IP);

  assert.equal(rl.pruefeSperre('nochjemand', IP).gesperrt, true, 'die Adresse ist gesperrt');
  assert.equal(rl.pruefeSperre('nochjemand', '198.51.100.7').gesperrt, false, 'andere Adressen nicht');
});

test('die Sperrdauer waechst, aber nur bis zur Obergrenze', () => {
  const rl = aufbau();
  const { db } = ladeSrc('db');

  // Viele Fehlversuche in Folge; die Sperre wird jeweils zurueckgesetzt,
  // damit der naechste Versuch nicht in eine laufende Sperre faellt.
  for (let i = 0; i < 20; i++) {
    db.prepare('UPDATE login_ratelimit SET gesperrt_bis=NULL').run();
    rl.vermerkeFehlversuch('lehrer1', IP);
  }

  const rest = rl.pruefeSperre('lehrer1', IP).restSekunden;
  assert.ok(rest <= rl.MAX_SPERRE_MS / 1000, `Sperre ist gedeckelt (${rest}s)`);
  // Ohne Obergrenze waeren das nach 20 Versuchen ueber 40 Tage - ein
  // fremdes Konto liesse sich so dauerhaft aussperren.
  assert.ok(rest > 0);
});

test('nach einer ruhigen Phase beginnt die Zaehlung von vorn', () => {
  const rl = aufbau();
  const { db } = ladeSrc('db');

  for (let i = 0; i < rl.SCHWELLE_BENUTZER; i++) rl.vermerkeFehlversuch('lehrer1', IP);
  assert.equal(rl.pruefeSperre('lehrer1', IP).gesperrt, true);

  // Sperre abgelaufen und letzter Fehlversuch liegt laenger zurueck als der
  // Verfall: der naechste Fehlversuch darf nicht die alte Zaehlung fortsetzen.
  const lange = Date.now() - rl.VERFALL_MS - 1000;
  db.prepare('UPDATE login_ratelimit SET gesperrt_bis=NULL, letzter_versuch=?').run(lange);

  rl.vermerkeFehlversuch('lehrer1', IP);
  assert.equal(rl.pruefeSperre('lehrer1', IP).gesperrt, false, 'zaehlt wieder bei eins');
});

test('eine erfolgreiche Anmeldung raeumt die Zaehler weg', () => {
  const rl = aufbau();
  for (let i = 0; i < rl.SCHWELLE_BENUTZER; i++) rl.vermerkeFehlversuch('lehrer1', IP);
  rl.setzeZurueck('lehrer1', IP);
  assert.equal(rl.pruefeSperre('lehrer1', IP).gesperrt, false);
});

test('aufraeumen entfernt nur wirkungslose Zeilen', () => {
  const rl = aufbau();
  const { db } = ladeSrc('db');
  const anzahl = () => db.prepare('SELECT COUNT(*) c FROM login_ratelimit').get().c;

  rl.vermerkeFehlversuch('frisch', IP);
  assert.equal(rl.raeumeAuf(), 0, 'aktuelle Zeilen bleiben stehen');
  assert.ok(anzahl() > 0);

  // Ohne Aufraeumen waechst die Tabelle mit jedem je eingetippten Namen.
  db.prepare('UPDATE login_ratelimit SET gesperrt_bis=NULL, letzter_versuch=?').run(Date.now() - rl.VERFALL_MS - 1000);
  assert.ok(rl.raeumeAuf() > 0);
  assert.equal(anzahl(), 0);
});
