require('dotenv').config();
const fs = require('fs');
const path = require('path');

process.env.TZ = process.env.TZ || 'Europe/Berlin';

// Ohne eigenes Session-Secret liessen sich Session-Cookies faelschen - wer
// den Vorgabewert kennt, meldet sich als beliebiger Benutzer an, auch als
// Admin. Ein Fallback waere hier also kein Komfort, sondern eine offene Tuer,
// deshalb verweigert die App den Start (analog zu ENCRYPTION_KEY).
const UNSICHERE_SECRETS = ['change-me-in-production', 'bitte-aendern-in-produktion'];
const MIN_SECRET_LENGTH = 16;

function ladeSessionSecret() {
  const secret = (process.env.SESSION_SECRET || '').trim();
  if (!secret || UNSICHERE_SECRETS.includes(secret.toLowerCase())) {
    throw new Error(
      'SESSION_SECRET ist nicht gesetzt (oder steht noch auf dem Beispielwert). Bitte einen zufaelligen, ' +
        'geheimen String in der .env hinterlegen, z. B. erzeugt mit: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET muss mindestens ${MIN_SECRET_LENGTH} Zeichen lang sein.`);
  }
  return secret;
}

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
  sessionSecret: ladeSessionSecret(),
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
