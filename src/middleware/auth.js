function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!req.session.user.isAdmin) {
    return res.status(403).render('error', { message: 'Kein Zugriff auf den Admin-Bereich.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
