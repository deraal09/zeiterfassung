const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const config = require('./src/config');
const { initDb } = require('./src/db');
const { csrfMiddleware } = require('./src/middleware/csrf');
const { nonceMiddleware, helmetMiddleware } = require('./src/middleware/security');

initDb();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// Vor allem anderen, damit auch Fehlerseiten und statische Dateien die
// Sicherheits-Header tragen.
app.use(nonceMiddleware);
app.use(helmetMiddleware);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

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

app.use('/', require('./src/routes/auth'));
app.use('/', require('./src/routes/dashboard'));
app.use('/', require('./src/routes/categories'));
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => {
  res.status(404).render('error', { message: 'Seite nicht gefunden.' });
});

app.use((err, req, res, next) => {
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
