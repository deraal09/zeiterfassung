const crypto = require('crypto');

// API-Tokens sind 256 Bit Zufall mit gut erkennbarem Praefix (damit sie sich
// in Konfigurationen und Secret-Scannern als Zeiterfassungs-Token erkennen
// lassen). Weil das Token selbst schon hochentropisch ist, genuegt ein
// schneller SHA-256-Hash zum Ablegen - ein langsames Passwort-Hashverfahren
// braeuchte nur Rechenzeit pro Request, ohne Schutz zu bringen.
const PRAEFIX = 'zt_';
const ANZEIGE_LAENGE = 9; // "zt_" + 6 Zeichen, reicht zum Wiedererkennen

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function neuesToken() {
  const token = PRAEFIX + crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token), anzeige: token.slice(0, ANZEIGE_LAENGE) };
}

// Liest das Token aus "Authorization: Bearer <token>". Gibt null zurueck,
// wenn der Header fehlt oder ein anderes Schema nutzt.
function tokenAusHeader(header) {
  const treffer = /^Bearer\s+(\S+)$/i.exec(String(header || '').trim());
  return treffer ? treffer[1] : null;
}

module.exports = { neuesToken, hashToken, tokenAusHeader, PRAEFIX };
