const router = require('express').Router();
const bcrypt = require('bcryptjs');
const ldap = require('../ldap');
const config = require('../config');
const { db } = require('../db');
const { pruefeSperre, vermerkeFehlversuch, setzeZurueck, raeumeAuf } = require('../auth/login-ratelimit');

const MIN_USER_LEN = 3;
const MIN_PW_LEN = 8;

function userCount() {
  return db.prepare('SELECT COUNT(*) as c FROM users').get().c;
}

// Solange noch kein einziger Nutzer existiert, kann hier ein erster lokaler
// Admin angelegt werden - unabhaengig davon, ob LDAP schon funktioniert.
router.get('/setup', (req, res) => {
  if (userCount() > 0) return res.redirect('/login');
  res.render('setup', { error: null });
});

router.post('/setup', (req, res) => {
  if (userCount() > 0) return res.redirect('/login');

  const username = (req.body.username || '').trim();
  const displayName = (req.body.displayName || '').trim() || username;
  const { password, password2 } = req.body;

  if (username.length < MIN_USER_LEN) {
    return res.render('setup', { error: 'Benutzername muss mindestens 3 Zeichen haben.' });
  }
  if (password !== password2) {
    return res.render('setup', { error: 'Passwoerter stimmen nicht ueberein.' });
  }
  if (!password || password.length < MIN_PW_LEN) {
    return res.render('setup', { error: 'Passwort muss mindestens 8 Zeichen haben.' });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare(
      "INSERT INTO users (username, display_name, is_admin, auth_source, password_hash, last_login) VALUES (?,?,1,'local',?,datetime('now'))"
    )
    .run(username, displayName, passwordHash);

  req.session.regenerate((err) => {
    if (err) return res.render('setup', { error: 'Fehler beim Anlegen. Bitte erneut versuchen.' });
    req.session.user = {
      id: info.lastInsertRowid,
      username,
      displayName,
      isAdmin: true,
      autoSync: false,
    };
    res.redirect('/admin');
  });
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  if (userCount() === 0) return res.redirect('/setup');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('login', { error: 'Bitte Benutzername und Passwort eingeben.' });
  }
  const uname = username.trim();
  // Hinter req.ip steckt bei Betrieb hinter Plesk/Passenger die per
  // 'trust proxy' ausgewertete Client-Adresse (siehe app.js).
  const adresse = req.ip;

  const sperre = pruefeSperre(uname, adresse);
  if (sperre.gesperrt) {
    const einheit = sperre.restSekunden === 1 ? 'Sekunde' : 'Sekunden';
    return res.render('login', {
      error: `Zu viele Fehlversuche. Bitte in ${sperre.restSekunden} ${einheit} erneut versuchen.`,
    });
  }

  // Lokaler Account (z. B. per /setup angelegt) geht vor LDAP.
  const localRow = db
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND auth_source = 'local'")
    .get(uname);
  if (localRow) {
    if (!bcrypt.compareSync(password, localRow.password_hash || '')) {
      vermerkeFehlversuch(uname, adresse);
      return res.render('login', { error: 'Benutzername oder Passwort ist falsch.' });
    }
    setzeZurueck(uname, adresse);
    raeumeAuf();
    db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(localRow.id);
    return req.session.regenerate((err) => {
      if (err) return res.render('login', { error: 'Fehler beim Anmelden. Bitte erneut versuchen.' });
      req.session.user = {
        id: localRow.id,
        username: localRow.username,
        displayName: localRow.display_name,
        isAdmin: !!localRow.is_admin,
        autoSync: !!localRow.auto_sync,
      };
      res.redirect('/');
    });
  }

  try {
    const result = await ldap.authenticate(uname, password);
    if (!result || !result.username) {
      vermerkeFehlversuch(uname, adresse);
      return res.render('login', { error: 'Benutzername oder Passwort ist falsch.' });
    }
    setzeZurueck(uname, adresse);
    raeumeAuf();

    // COLLATE NOCASE: Ein vom Admin vorab per Benutzername angelegtes Konto
    // (z. B. Zuweisung vor dem ersten Login) muss unabhaengig von Gross-/
    // Kleinschreibung mit dem tatsaechlichen LDAP-Login zusammengefuehrt
    // werden - AD ist bei sAMAccountName/UPN selbst nicht case-sensitiv.
    const isAdmin = config.adminUsernames.includes(result.username.toLowerCase());
    let row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(result.username);
    if (!row) {
      const info = db
        .prepare(
          "INSERT INTO users (username, display_name, email, is_admin, last_login) VALUES (?,?,?,?,datetime('now'))"
        )
        .run(result.username, result.displayName, result.email, isAdmin ? 1 : 0);
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    } else {
      db.prepare(
        "UPDATE users SET display_name=?, email=?, is_admin=?, last_login=datetime('now') WHERE id=?"
      ).run(result.displayName, result.email, isAdmin ? 1 : 0, row.id);
    }

    req.session.regenerate((err) => {
      if (err) return res.render('login', { error: 'Fehler beim Anmelden. Bitte erneut versuchen.' });
      req.session.user = {
        id: row.id,
        username: row.username,
        displayName: result.displayName,
        isAdmin: !!isAdmin,
        autoSync: !!row.auto_sync,
      };
      res.redirect('/');
    });
  } catch (err) {
    console.error('LDAP-Anmeldefehler:', err.message);
    res.render('login', { error: 'Anmeldung derzeit nicht moeglich. Bitte spaeter erneut versuchen.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
