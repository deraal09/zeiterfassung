const test = require('node:test');
const assert = require('node:assert');
const { frischeUmgebung, ladeSrc } = require('./helpers');

test('verschluesselt und entschluesselt verlustfrei', () => {
  frischeUmgebung();
  const { encrypt, decrypt, isEncrypted } = ladeSrc('util/crypto');

  const klartext = 'Moodle-Kurs für Klasse 11b aufgebaut';
  const chiffre = encrypt(klartext);

  assert.notEqual(chiffre, klartext, 'der Klartext steht nicht mehr in der Datenbank');
  assert.ok(isEncrypted(chiffre));
  assert.equal(decrypt(chiffre), klartext);
});

test('zwei gleiche Klartexte ergeben unterschiedliche Chiffretexte', () => {
  frischeUmgebung();
  const { encrypt } = ladeSrc('util/crypto');
  assert.notEqual(encrypt('Taetigkeit'), encrypt('Taetigkeit'), 'jeder Aufruf nutzt ein eigenes IV');
});

test('leere Werte bleiben unveraendert', () => {
  frischeUmgebung();
  const { encrypt, decrypt } = ladeSrc('util/crypto');
  for (const wert of [null, undefined, '']) {
    assert.equal(encrypt(wert), wert);
    assert.equal(decrypt(wert), wert);
  }
});

test('Klartext, der mit dem Praefix beginnt, gilt nicht als verschluesselt', () => {
  frischeUmgebung();
  const { decrypt, isEncrypted } = ladeSrc('util/crypto');

  // Sonst wuerde die Migration in db.js diesen Wert nie verschluesseln und
  // das Lesen wuerde daran scheitern.
  assert.equal(isEncrypted('enc1:Besprechung'), false);
  assert.equal(decrypt('enc1:Besprechung'), 'enc1:Besprechung');
});

test('ein unlesbarer Wert liefert einen Platzhalter statt zu werfen', () => {
  frischeUmgebung();
  const { encrypt, decrypt, UNLESBAR } = ladeSrc('util/crypto');

  // Wert, der mit einem ANDEREN Schluessel verschluesselt wurde.
  process.env.ENCRYPTION_KEY = 'b'.repeat(64);
  delete require.cache[require.resolve('../src/util/crypto')];
  const fremd = require('../src/util/crypto').encrypt('Mit fremdem Schluessel');
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);

  assert.doesNotThrow(() => decrypt(fremd), 'eine kaputte Zeile darf die Seite nicht sprengen');
  assert.equal(decrypt(fremd), UNLESBAR);

  // Intakte Werte funktionieren daneben unveraendert weiter.
  assert.equal(decrypt(encrypt('Intakt')), 'Intakt');
});

test('abgeschnittener Chiffretext wirft nicht', () => {
  frischeUmgebung();
  const { encrypt, decrypt, UNLESBAR } = ladeSrc('util/crypto');
  const chiffre = encrypt('Irgendeine Taetigkeit');
  const beschaedigt = chiffre.slice(0, chiffre.length - 8);

  assert.doesNotThrow(() => decrypt(beschaedigt));
  assert.equal(decrypt(beschaedigt), UNLESBAR);
});
