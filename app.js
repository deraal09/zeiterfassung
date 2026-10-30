const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const config = require('./src/config');
const { initDb } = require('./src/db');
const { csrfMiddleware } = require('./src/middleware/csrf');
const { adminKontext } = require('./src/middleware/admin-kontext');
const { nonceMiddleware, helmetMiddleware } = require('./src/middleware/security');

initDb();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// Zahlen in deutscher Schreibweise (Komma, hoechstens zwei Nachkommastellen)
// fuer alle Ansichten.
app.locals.zahl = (wert) =>
  (Math.round(Number(wert) * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });

// Vor allem anderen, damit auch Fehlerseiten und statische Dateien die
// Sicherheits-Header tragen.
app.use(nonceMiddleware);
app.use(helmetMiddleware);

// REST-API: Bearer-Token statt Session und CSRF-Token (siehe routes/api.js).
// Muss vor Session- und CSRF-Middleware stehen, damit API-Aufrufe weder
// Sessions anlegen noch am CSRF-Schutz scheitern. Eigener Body-Parser mit
// groesserem Limit, weil ein Sammelabgleich bis zu 200 Eintraege enthaelt.
app.use('/api/v1', express.json({ limit: '1mb' }), require('./src/routes/api'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Der Service Worker muss aus dem Wurzelverzeichnis ausgeliefert werden,
// sonst beschraenkt der Browser seinen Scope auf /public/ und er koennte
// nur Unterseiten dort, nicht aber die eigentliche App kontrollieren.
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript; charset=UTF-8');
  res.set('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(
  session({
    store: new FileStore({ path: path.join(__dirname, 'data', 'sessions'), logFn: () => {} }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12, sameSite: 'lax', secure: 'auto', httpOnly: true },
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Nach der Session (braucht req.session) und nach express.urlencoded (liest
// das Token aus req.body) - siehe middleware/csrf.js.
app.use(csrfMiddleware);
app.use(adminKontext);

app.use('/', require('./src/routes/auth'));
app.use('/', require('./src/routes/dashboard'));
app.use('/', require('./src/routes/categories'));
app.use('/', require('./src/routes/tokens'));
app.use('/admin', require('./src/routes/admin'));
app.use('/admin', require('./src/routes/admin-pools'));
app.use('/admin', require('./src/routes/admin-dokumente'));

app.use((req, res) => {
  res.status(404).render('error', { message: 'Seite nicht gefunden.' });
});

app.use((err, req, res, next) => {
  // Fehler des JSON-Parsers der API treten vor dem API-Router auf und landen
  // deshalb hier - sie sollen als JSON beantwortet werden, nicht als HTML.
  if (req.originalUrl.startsWith('/api/')) {
    const kaputt = err && err.type === 'entity.parse.failed';
    return res.status(kaputt ? 400 : 500).json({
      fehler: {
        code: kaputt ? 'ungueltige-anfrage' : 'serverfehler',
        nachricht: kaputt ? 'Der Anfragekoerper ist kein gueltiges JSON.' : 'Ein Fehler ist aufgetreten.',
      },
    });
  }
  console.error(err);
  res.status(500).render('error', { message: 'Ein Fehler ist aufgetreten.' });
});

// Plesk/Passenger weist der App entweder einen TCP-Port oder einen
// Unix-Socket-Pfad zu (in PORT). Numerisch -> TCP-Port, sonst -> Socket.
const isNumericPort = config.portEnv !== null && /^\d+$/.test(config.portEnv);
const listenOptions = isNumericPort
  ? { port: Number(config.portEnv) }
  : config.portEnv
    ? { path: config.portEnv }
    : { port: config.fallbackPort };

// Beim Binden auf einen Unix-Socket bleibt nach einem harten Abbruch die
// alte Socket-Datei liegen; der naechste Start scheitert dann an
// EADDRINUSE, obwohl kein Prozess mehr laeuft.
if (listenOptions.path) {
  try {
    fs.unlinkSync(listenOptions.path);
  } catch (err) {
    // ENOENT ist der Normalfall: es lag nichts herum.
    if (err.code !== 'ENOENT') console.warn(`Alte Socket-Datei liess sich nicht entfernen: ${err.message}`);
  }
}

app.listen(listenOptions, () => {
  const target = listenOptions.path ? listenOptions.path : `Port ${listenOptions.port}`;
  console.log(`Zeiterfassung laeuft auf ${target}`);
});

module.exports = app;
