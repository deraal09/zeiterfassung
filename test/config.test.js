const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const CONFIG = path.join(__dirname, '..', 'src', 'config.js');

function ladeConfigMit(secret) {
  delete require.cache[require.resolve(CONFIG)];
  if (secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = secret;
  return require(CONFIG);
}

test('ohne SESSION_SECRET startet die App nicht', () => {
  assert.throws(() => ladeConfigMit(undefined), /SESSION_SECRET/);
  assert.throws(() => ladeConfigMit(''), /SESSION_SECRET/);
});

test('der Beispielwert aus .env.example wird abgelehnt', () => {
  // Sonst uebernaehme ihn jede Installation ungeprueft aus der Vorlage - und
  // wer ihn kennt, koennte sich fremde Session-Cookies signieren.
  assert.throws(() => ladeConfigMit('change-me-in-production'), /SESSION_SECRET/);
  assert.throws(() => ladeConfigMit('bitte-aendern-in-produktion'), /SESSION_SECRET/);
});

test('ein zu kurzes Secret wird abgelehnt', () => {
  assert.throws(() => ladeConfigMit('kurz'), /mindestens/);
});

test('ein echtes Secret wird uebernommen', () => {
  const secret = require('crypto').randomBytes(32).toString('hex');
  assert.equal(ladeConfigMit(secret).sessionSecret, secret);
});
