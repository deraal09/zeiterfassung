require('dotenv').config();
const path = require('path');

process.env.TZ = process.env.TZ || 'Europe/Berlin';

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
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
