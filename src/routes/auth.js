const router = require('express').Router();
const ldap = require('../ldap');
const config = require('../config');
const { db } = require('../db');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('login', { error: 'Bitte Benutzername und Passwort eingeben.' });
  }

  try {
    const result = await ldap.authenticate(username.trim(), password);
    if (!result || !result.username) {
      return res.render('login', { error: 'Benutzername oder Passwort ist falsch.' });
    }

    const isAdmin = config.adminUsernames.includes(result.username.toLowerCase());
    let row = db.prepare('SELECT * FROM users WHERE username = ?').get(result.username);
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
