const { Client } = require('ldapts');
const config = require('./config');

function createClient() {
  return new Client({ url: config.ldap.url, timeout: 5000, connectTimeout: 5000 });
}

function escapeFilterValue(value) {
  return String(value).replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
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
    return false;
  } finally {
    await client.unbind().catch(() => {});
  }
}

async function authenticate(username, password) {
  const entry = await findUserEntry(username);
  if (!entry) return null;
  const ok = await verifyPassword(entry.dn, password);
  if (!ok) return null;
  return normalize(entry);
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
