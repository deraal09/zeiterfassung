const test = require('node:test');
const assert = require('node:assert');
const { frischeUmgebung, ladeSrc } = require('./helpers');

// Baut eine Lehrkraft mit zwei Kategorien und einer Zuweisung auf, die mit
// Kategorie 1 bestaetigt verknuepft ist.
function aufbau() {
  frischeUmgebung();
  const { db, initDb } = ladeSrc('db');
  initDb();
  const zuweisungen = ladeSrc('util/zuweisungen');

  db.prepare("INSERT INTO users (username, display_name) VALUES ('lehrer1','Lehrer Eins')").run();
  db.prepare("INSERT INTO categories (user_id,title,schuljahr) VALUES (1,'Kategorie A','2026/27')").run();
  db.prepare("INSERT INTO categories (user_id,title,schuljahr) VALUES (1,'Kategorie B','2026/27')").run();
  db.prepare("INSERT INTO zuweisungen (user_id,schuljahr,ausgleichsstunden,category_id) VALUES (1,'2026/27',2,1)").run();

  const hole = () => db.prepare('SELECT * FROM zuweisungen WHERE id=1').get();
  const erfasseZeit = (categoryId) =>
    db
      .prepare(
        `INSERT INTO time_entries (category_id,user_id,beschreibung,start_time,end_time,duration_minutes)
         VALUES (?,1,'x','2026-09-01 08:00:00','2026-09-01 10:00:00',120)`
      )
      .run(categoryId);

  return { db, hole, erfasseZeit, ...zuweisungen };
}

test('Vorschlag und Bestaetigung aendern die Verknuepfung', () => {
  const { hole, vorschlagen, annehmen } = aufbau();

  assert.equal(vorschlagen(hole(), 'lehrkraft', 2).ok, true);
  assert.equal(annehmen(hole(), 'admin').ok, true);
  assert.equal(hole().category_id, 2, 'die bestaetigte Verknuepfung zeigt auf die neue Kategorie');
  assert.equal(hole().vorschlag_von, null, 'der Vorschlag ist aufgeloest');
});

test('ein Vorschlag laesst sich nicht mehr annehmen, wenn inzwischen Zeiten erfasst wurden', () => {
  const { hole, erfasseZeit, vorschlagen, annehmen, istGesperrt } = aufbau();

  // Vorschlag geht raus, solange die Zuweisung noch offen ist ...
  assert.equal(vorschlagen(hole(), 'lehrkraft', 2).ok, true);

  // ... danach werden fuer die BESTAETIGTE Kategorie Zeiten erfasst.
  erfasseZeit(1);
  assert.equal(istGesperrt(hole()), true);

  const ergebnis = annehmen(hole(), 'admin');
  assert.equal(ergebnis.ok, false, 'die Sperre gilt auch beim Bestaetigen');
  assert.equal(ergebnis.fehler, 'gesperrt');
  assert.equal(hole().category_id, 1, 'die erfassten Zeiten behalten ihre Zuweisung');
});

test('ein gesperrter Vorschlag laesst sich weiterhin ablehnen', () => {
  const { hole, erfasseZeit, vorschlagen, ablehnen } = aufbau();

  vorschlagen(hole(), 'lehrkraft', 2);
  erfasseZeit(1);

  assert.equal(ablehnen(hole(), 'admin').ok, true, 'sonst bliebe der Vorschlag fuer immer offen');
  assert.equal(hole().vorschlag_von, null);
  assert.equal(hole().category_id, 1);
});

test('eine Kategorie einer anderen Lehrkraft wird nicht bestaetigt', () => {
  const { db, hole, vorschlagen, annehmen } = aufbau();

  db.prepare("INSERT INTO users (username, display_name) VALUES ('lehrer2','Lehrer Zwei')").run();
  db.prepare("INSERT INTO categories (user_id,title,schuljahr) VALUES (2,'Fremde Kategorie','2026/27')").run();

  vorschlagen(hole(), 'lehrkraft', 2);
  // Vorschlag nachtraeglich auf die fremde Kategorie (id 3) umbiegen, wie es
  // nur unter Umgehung der Routen passieren koennte.
  db.prepare('UPDATE zuweisungen SET vorschlag_category_id=3 WHERE id=1').run();

  const ergebnis = annehmen(hole(), 'admin');
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.fehler, 'vorschlag-ungueltig');
  assert.equal(hole().category_id, 1, 'die bestehende Verknuepfung bleibt unangetastet');
});

test('ein ausdrueckliches "Verknuepfung aufheben" bleibt moeglich', () => {
  const { hole, vorschlagen, annehmen } = aufbau();

  assert.equal(vorschlagen(hole(), 'lehrkraft', null).ok, true);
  assert.equal(annehmen(hole(), 'admin').ok, true);
  assert.equal(hole().category_id, null);
});

test('niemand bestaetigt seinen eigenen Vorschlag', () => {
  const { hole, vorschlagen, annehmen, ablehnen } = aufbau();

  vorschlagen(hole(), 'lehrkraft', 2);
  assert.equal(annehmen(hole(), 'lehrkraft').ok, false);
  assert.equal(ablehnen(hole(), 'lehrkraft').ok, false);
  assert.equal(hole().category_id, 1);
});

test('die Gegenseite kann einen offenen Vorschlag nicht ueberschreiben', () => {
  const { hole, vorschlagen } = aufbau();

  assert.equal(vorschlagen(hole(), 'lehrkraft', 2).ok, true);
  assert.equal(vorschlagen(hole(), 'admin', 1).ok, false, 'der offene Vorschlag muss zuerst aufgeloest werden');
  assert.equal(hole().vorschlag_von, 'lehrkraft');
});

test('eine gesperrte Zuweisung nimmt keine neuen Vorschlaege an', () => {
  const { hole, erfasseZeit, vorschlagen } = aufbau();

  erfasseZeit(1);
  const ergebnis = vorschlagen(hole(), 'lehrkraft', 2);
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.fehler, 'gesperrt');
});
