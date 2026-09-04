const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
// Praefix markiert bereits verschluesselte Werte, damit beim Lesen
// unterschieden werden kann zwischen neuen (verschluesselten) und alten,
// vor der Migration im Klartext gespeicherten Werten (siehe db.js).
const PREFIX = 'enc1:';

function ladeSchluessel() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY ist nicht gesetzt. Bitte einen 32 Byte langen Schluessel (64 Hex-Zeichen) in der .env ' +
        "hinterlegen, z. B. erzeugt mit: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY muss genau 32 Byte (64 Hex-Zeichen) lang sein.');
  }
  return key;
}

const key = ladeSchluessel();

// Ein Wert gilt nur dann als verschluesselt, wenn er neben dem Praefix auch
// tatsaechlich einen plausiblen Payload traegt (gueltiges Base64, mindestens
// IV + Auth-Tag lang). Sonst wuerde eine Beschreibung, die zufaellig mit
// "enc1:" beginnt, als Chiffretext missverstanden - beim Lesen waere sie
// dann nicht entschluesselbar, und die Migration in db.js wuerde sie nie
// verschluesseln.
const MIN_PAYLOAD_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH;

function isEncrypted(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return false;
  const payload = value.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return false;
  return Buffer.from(payload, 'base64').length >= MIN_PAYLOAD_LENGTH;
}

// Verschluesselt einen Klartext-String zu einem speicherbaren String
// (Praefix + Base64 aus IV, Auth-Tag und Chiffretext, je Aufruf mit neuem
// IV). null/undefined/leer bleiben unveraendert, damit optionale Felder
// nicht faelschlich als Wert verschluesselt werden.
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

// Platzhalter fuer Werte, die sich nicht entschluesseln lassen (z. B. Reste
// aus einem frueheren ENCRYPTION_KEY oder eine beschaedigte Zeile). Wird beim
// Speichern eines Eintrags erkannt und dann NICHT zurueckgeschrieben, damit
// der Platzhalter den echten Chiffretext nicht ueberschreibt (siehe
// routes/categories.js).
const UNLESBAR = '[nicht entschluesselbar]';

let unlesbarGemeldet = false;

// Entschluesselt einen mit encrypt() erzeugten Wert. Werte ohne das Praefix
// gelten als (noch) unverschluesselter Altbestand und werden unveraendert
// zurueckgegeben, statt einen Fehler zu werfen.
//
// Schlaegt die Entschluesselung fehl, wird bewusst NICHT geworfen: eine
// einzige unlesbare Zeile wuerde sonst die komplette Kategorie- oder
// Uebersichtsseite mit einem Serverfehler blockieren - also genau die Seite,
// ueber die sich der kaputte Eintrag korrigieren oder loeschen liesse.
function decrypt(value) {
  if (value === null || value === undefined || value === '') return value;
  if (!isEncrypted(value)) return value;

  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    if (!unlesbarGemeldet) {
      unlesbarGemeldet = true;
      console.error(
        'Mindestens ein verschluesseltes Feld liess sich nicht entschluesseln. Passt ENCRYPTION_KEY ' +
          'noch zum Datenbestand? Betroffene Eintraege werden als "' + UNLESBAR + '" angezeigt.'
      );
    }
    return UNLESBAR;
  }
}

module.exports = { encrypt, decrypt, isEncrypted, UNLESBAR };
