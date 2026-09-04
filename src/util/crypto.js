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

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
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

// Entschluesselt einen mit encrypt() erzeugten Wert. Werte ohne das Praefix
// gelten als (noch) unverschluesselter Altbestand und werden unveraendert
// zurueckgegeben, statt einen Fehler zu werfen.
function decrypt(value) {
  if (value === null || value === undefined || value === '') return value;
  if (!isEncrypted(value)) return value;

  const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted };
