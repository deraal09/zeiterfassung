const crypto = require('crypto');

// Schutz gegen Cross-Site Request Forgery: Ohne Token koennte eine fremde
// Seite im Namen einer angemeldeten Lehrkraft Formulare abschicken - Zeiten
// loeschen, Verknuepfungen aendern, im Admin-Bereich Zuweisungen vergeben.
// Das SameSite=Lax-Cookie federt das zwar ab, ist aber die einzige
// Verteidigung und greift nicht gegenueber einer anderen Subdomain derselben
// Site (beim Hosting auf einem Schulserver ein realistischer Fall).
//
// Bewusst ohne zusaetzliche Abhaengigkeit: ein Zufallstoken pro Session,
// das jedes schreibende Formular mitschickt.

const SICHERE_METHODEN = new Set(['GET', 'HEAD', 'OPTIONS']);
const FELD = '_csrf';

function tokenFuer(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  }
  return req.session.csrfToken;
}

// Vergleich in konstanter Zeit, damit sich das Token nicht zeichenweise
// ueber die Antwortzeit erraten laesst.
function stimmtUeberein(erwartet, gesendet) {
  if (!erwartet || !gesendet) return false;
  const a = Buffer.from(String(erwartet));
  const b = Buffer.from(String(gesendet));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function istMultipart(req) {
  return (req.get('content-type') || '').startsWith('multipart/form-data');
}

// Prueft den Request und beantwortet ihn bei fehlendem/falschem Token selbst.
// Gibt true zurueck, wenn die Verarbeitung weitergehen darf.
function pruefeToken(req, res) {
  const gesendet = (req.body && req.body[FELD]) || req.get('x-csrf-token');
  if (stimmtUeberein(req.session.csrfToken, gesendet)) return true;

  res.status(403).render('error', {
    message:
      'Die Sitzung ist abgelaufen oder das Formular wurde nicht von dieser Seite abgeschickt. ' +
      'Bitte die Seite neu laden und es erneut versuchen.',
  });
  return false;
}

// Globale Middleware: stellt jedem Template das Token bereit und prueft alle
// schreibenden Anfragen.
//
// Ausnahme sind Datei-Uploads (multipart/form-data): deren Felder liest erst
// multer, an dieser Stelle ist req.body noch leer. Solche Routen haengen
// csrfSchutzNachUpload hinter multer - siehe routes/categories.js.
function csrfMiddleware(req, res, next) {
  res.locals.csrfToken = tokenFuer(req);
  if (SICHERE_METHODEN.has(req.method)) return next();
  if (istMultipart(req)) return next();
  if (!pruefeToken(req, res)) return;
  next();
}

function csrfSchutzNachUpload(req, res, next) {
  if (!pruefeToken(req, res)) return;
  next();
}

module.exports = { csrfMiddleware, csrfSchutzNachUpload, FELD };
