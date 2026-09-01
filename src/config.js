require('dotenv').config();
const fs = require('fs');
const path = require('path');

process.env.TZ = process.env.TZ || 'Europe/Berlin';

function buildTlsOptions() {
  const tlsOptions = {};
  const caPath = process.env.LDAP_TLS_CA_PFAD;
  if (caPath) tlsOptions.ca = fs.readFileSync(caPath);
  if (process.env.LDAP_TLS_REJECT_UNAUTHORIZED === 'false') tlsOptions.rejectUnauthorized = false;
  return Object.keys(tlsOptions).length ? tlsOptions : undefined;
}

module.exports = {
  // Plesk/Passenger uebergibt PORT haeufig als Unix-Socket-Pfad statt als
  // Zahl. parseInt() wuerde das in NaN -> Fallback-Port verwandeln, wodurch
  // die App auf dem falschen Endpunkt lauscht und Passenger sie nie
  // erreicht (Symptom: generische Passenger-Fehlerseite). Der rohe Wert
  // wird deshalb unveraendert durchgereicht und erst in app.js ausgewertet.
  portEnv: process.env.PORT || null,
  fallbackPort: 3000,
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',
  dbPath: process.env.DB_PATH
    ? path.resolve(__dirname, '..', process.env.DB_PATH)
    : path.join(__dirname, '..', 'data', 'zeiterfassung.db'),
  ldap: {
    url: process.env.LDAP_URL,
    bindDn: process.env.LDAP_BIND_DN,
    bindPassword: process.env.LDAP_BIND_PASSWORD,
    baseDn: process.env.LDAP_BASE_DN,
    userFilter: process.env.LDAP_USER_FILTER || '(uid={{username}})',
    usernameAttr: process.env.LDAP_USERNAME_ATTR || 'uid',
    displayNameAttr: process.env.LDAP_DISPLAY_NAME_ATTR || 'cn',
    emailAttr: process.env.LDAP_EMAIL_ATTR || 'mail',
    // ldaps:// gegen ein internes/selbstsigniertes Zertifikat (z. B.
    // schul-eigenes Active Directory) schlaegt sonst mit einem TLS-Fehler
    // fehl, noch bevor ueberhaupt ein Bind versucht wird.
    // LDAP_TLS_CA_PFAD: Pfad zur PEM-Datei der internen CA (empfohlen).
    // LDAP_TLS_REJECT_UNAUTHORIZED=false: Zertifikatspruefung abschalten
    // (nur als Notloesung in vertrauenswuerdigen Netzen).
    tlsOptions: buildTlsOptions(),
    // Direkt-Bind-Modus: Statt mit einem Service-Account zu suchen und dann
    // erneut zu binden, bindet die Anmeldung direkt mit der aus dem
    // eingegebenen Benutzernamen gebauten Kennung + Passwort. Kein
    // LDAP_BIND_DN/LDAP_BIND_PASSWORD noetig. Beispiel: "SCHULE\{{username}}"
    // oder "{{username}}@schule.de" (User Principal Name, oft die simpelste
    // Wahl bei Active Directory).
    bindUserTemplate: process.env.LDAP_BIND_USER_TEMPLATE || null,
  },
  adminUsernames: (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};
