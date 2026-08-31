require('dotenv').config();
const path = require('path');

process.env.TZ = process.env.TZ || 'Europe/Berlin';

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
  },
  adminUsernames: (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};
