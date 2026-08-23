const express = require('express');
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const config = require('./src/config');
const { initDb } = require('./src/db');

initDb();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

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

app.use('/', require('./src/routes/auth'));
app.use('/', require('./src/routes/dashboard'));
app.use('/', require('./src/routes/categories'));
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => {
  res.status(404).render('error', { message: 'Seite nicht gefunden.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: 'Ein Fehler ist aufgetreten.' });
});

app.listen(config.port, () => {
  console.log(`Zeiterfassung laeuft auf Port ${config.port}`);
});

module.exports = app;
