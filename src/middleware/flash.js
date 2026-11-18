// Einmalige Rueckmeldung nach einer Aktion ("Zeiterfassung gestartet."):
// Die POST-Route legt sie mit req.flash(text) in die Session, die naechste
// gerenderte Seite zeigt sie genau einmal an (siehe partials/flash.ejs).
//
// Der Text wird erst beim render() aus der Session genommen - ein Download
// (CSV-Export) oder eine weitere Weiterleitung dazwischen verbraucht ihn also
// nicht.
function flashMiddleware(req, res, next) {
  req.flash = (text) => {
    if (req.session) req.session.flash = String(text);
  };
  res.locals.flash = null;

  const render = res.render.bind(res);
  res.render = (...args) => {
    if (req.session && req.session.flash) {
      res.locals.flash = req.session.flash;
      delete req.session.flash;
    }
    return render(...args);
  };
  next();
}

module.exports = { flashMiddleware };
