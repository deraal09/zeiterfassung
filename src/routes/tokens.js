const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { neuesToken } = require('../util/api-token');

// Verwaltung der persoenlichen API-Zugaenge (siehe routes/api.js). Jede
// Lehrkraft verwaltet nur ihre eigenen Tokens; ein Token zeigt die Seite
// genau einmal - direkt nach dem Erstellen.

const MAX_TOKENS = 10;

function basisUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function rendere(req, res, extra = {}) {
  const tokens = db
    .prepare('SELECT id, name, token_prefix, created_at, last_used_at FROM api_tokens WHERE user_id=? ORDER BY created_at DESC, id DESC')
    .all(req.session.user.id);
  // Die Seite mit dem frischen Token soll nicht im Browser-Cache oder Verlauf
  // landen - das Token ist danach nicht mehr auslesbar, aber bis zum
  // Widerruf gueltig.
  res.set('Cache-Control', 'no-store');
  res.render('api-zugang', { tokens, basisUrl: basisUrl(req), neuesToken: null, error: null, maxTokens: MAX_TOKENS, ...extra });
}

router.get('/api-zugang', requireAuth, (req, res) => rendere(req, res));

router.post('/api-zugang', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 100);
  if (!name) return rendere(req, res, { error: 'Bitte einen Namen für den Zugang eingeben, z. B. "Laptop Claude Code".' });

  const anzahl = db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id=?').get(req.session.user.id).n;
  if (anzahl >= MAX_TOKENS) {
    return rendere(req, res, { error: `Es sind höchstens ${MAX_TOKENS} Zugänge möglich. Bitte zuerst einen nicht mehr benötigten widerrufen.` });
  }

  const { token, hash, anzeige } = neuesToken();
  db.prepare('INSERT INTO api_tokens (user_id, name, token_hash, token_prefix) VALUES (?,?,?,?)').run(
    req.session.user.id,
    name,
    hash,
    anzeige
  );
  rendere(req, res, { neuesToken: token });
});

router.post('/api-zugang/:id/widerrufen', requireAuth, (req, res) => {
  db.prepare('DELETE FROM api_tokens WHERE id=? AND user_id=?').run(req.params.id, req.session.user.id);
  res.redirect('/api-zugang');
});

module.exports = router;
