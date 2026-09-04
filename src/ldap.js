const { Client, InvalidCredentialsError } = require('ldapts');
const config = require('./config');

function createClient() {
  return new Client({
    url: config.ldap.url,
    timeout: 5000,
    connectTimeout: 5000,
    ...(config.ldap.tlsOptions ? { tlsOptions: config.ldap.tlsOptions } : {}),
  });
}

function escapeFilterValue(value) {
  return String(value).replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

// Sonderzeichen, die in einem Distinguished Name eine Bedeutung haben
// (RFC 4514). Ohne Maskierung koennte ein Benutzername mit Komma oder
// Gleichheitszeichen den aus LDAP_BIND_USER_TEMPLATE gebauten DN umschreiben
// und den Bind gegen einen anderen Eintrag laufen lassen.
function escapeDnValue(value) {
  return String(value)
    .replace(/([\\,+"<>;=])/g, '\\$1')
    .replace(/^([ #])/, '\\$1')
    .replace(/ $/, '\\ ');
}

function normalize(entry) {
  const get = (attr) => {
    const v = entry[attr];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    username: get(config.ldap.usernameAttr),
    displayName: get(config.ldap.displayNameAttr) || get(config.ldap.usernameAttr),
    email: get(config.ldap.emailAttr) || null,
  };
}

async function findUserEntry(username) {
  const client = createClient();
  try {
    await client.bind(config.ldap.bindDn, config.ldap.bindPassword);
    const filter = config.ldap.userFilter.replace('{{username}}', escapeFilterValue(username));
    const { searchEntries } = await client.search(config.ldap.baseDn, {
      filter,
      scope: 'sub',
      attributes: [config.ldap.usernameAttr, config.ldap.displayNameAttr, config.ldap.emailAttr],
      sizeLimit: 1,
    });
    return searchEntries[0] || null;
  } finally {
    await client.unbind().catch(() => {});
  }
}

async function verifyPassword(dn, password) {
  if (!password) return false;
  const client = createClient();
  try {
    await client.bind(dn, password);
    return true;
  } catch (err) {
    if (err instanceof InvalidCredentialsError) return false;
    throw err;
  } finally {
    await client.unbind().catch(() => {});
  }
}

async function authenticate(username, password) {
  if (config.ldap.bindUserTemplate) {
    return authenticateDirect(username, password);
  }
  const entry = await findUserEntry(username);
  if (!entry) return null;
  const ok = await verifyPassword(entry.dn, password);
  if (!ok) return null;
  return normalize(entry);
}

// Direkt-Bind: Der Nutzer meldet sich mit seiner eigenen, aus dem
// Benutzernamen abgeleiteten Kennung an - kein Service-Account noetig, um
// ihn vorher im Verzeichnis zu suchen. Attribute (Anzeigename, E-Mail)
// werden per Best-Effort-Suche ueber dieselbe, bereits authentifizierte
// Verbindung nachgeladen; schlaegt das fehl (z. B. keine Leserechte),
// gilt die Anmeldung trotzdem als erfolgreich.
async function authenticateDirect(username, password) {
  if (!password) return null;
  // Bei einem User Principal Name ("{{username}}@schule.de") oder einer
  // NetBIOS-Kennung ("SCHULE\{{username}}") ist der Wert zwar kein echter
  // DN, die Maskierung stoert dort aber nicht - normale Benutzernamen
  // enthalten keines dieser Zeichen.
  const bindDn = config.ldap.bindUserTemplate.replace('{{username}}', escapeDnValue(username));
  const client = createClient();
  try {
    try {
      await client.bind(bindDn, password);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) return null;
      throw err;
    }
    let canonicalUsername = username;
    let displayName = username;
    let email = null;
    try {
      const filter = config.ldap.userFilter.replace('{{username}}', escapeFilterValue(username));
      const { searchEntries } = await client.search(config.ldap.baseDn, {
        filter,
        scope: 'sub',
        attributes: [config.ldap.usernameAttr, config.ldap.displayNameAttr, config.ldap.emailAttr],
        sizeLimit: 1,
      });
      if (searchEntries[0]) {
        const n = normalize(searchEntries[0]);
        // Kanonische Schreibweise aus dem Verzeichnis uebernehmen, damit
        // wiederholte Logins (unabhaengig von der eingetippten Gross-/
        // Kleinschreibung) immer auf denselben Benutzernamen abbilden.
        canonicalUsername = n.username || username;
        displayName = n.displayName || username;
        email = n.email;
      }
    } catch (err) {
      // Attribut-Suche ist optional - Anmeldung gilt bereits als erfolgreich.
    }
    return { username: canonicalUsername, displayName, email };
  } finally {
    await client.unbind().catch(() => {});
  }
}

async function searchUsers(query) {
  const client = createClient();
  try {
    await client.bind(config.ldap.bindDn, config.ldap.bindPassword);
    const term = escapeFilterValue(query);
    const filter = `(|(${config.ldap.usernameAttr}=*${term}*)(${config.ldap.displayNameAttr}=*${term}*))`;
    const { searchEntries } = await client.search(config.ldap.baseDn, {
      filter,
      scope: 'sub',
      attributes: [config.ldap.usernameAttr, config.ldap.displayNameAttr, config.ldap.emailAttr],
      sizeLimit: 25,
    });
    return searchEntries.map(normalize).filter((u) => u.username);
  } finally {
    await client.unbind().catch(() => {});
  }
}

module.exports = { authenticate, searchUsers };
