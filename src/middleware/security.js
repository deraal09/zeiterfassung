const crypto = require('crypto');
const helmet = require('helmet');

// Sicherheits-Header, allen voran eine Content-Security-Policy.
//
// script-src ist bewusst streng: keine Skripte aus HTML-Attributen, keine
// fremden Quellen, sondern nur eigene Dateien und das eine Inline-Skript,
// das die Nonce dieses Requests traegt (Theme-Umschaltung in
// partials/head.ejs, die vor dem ersten Rendern laufen muss). Genau diese
// Luecke wuerde eine XSS-Stelle ausnutzen.
//
// style-src erlaubt dagegen weiterhin 'unsafe-inline'. Die Ansichten setzen
// an vielen Stellen style-Attribute (Balkenbreite, Abstaende); fuer
// Attribute gibt es keine Nonce, sie liessen sich nur durch einen breiten
// Umbau der Templates ersetzen. Der Gewinn waere gering - ueber einen
// Stilwert laesst sich kein Code ausfuehren.
function nonceMiddleware(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
}

const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      // Die Anwendung laedt nichts von aussen und bindet nichts ein.
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  // Die App laeuft je nach Schule auch ueber http:// im internen Netz;
  // HSTS wuerde dort den Zugriff dauerhaft auf https umbiegen.
  strictTransportSecurity: false,
  // Bilder/Downloads gibt es nicht, und die strenge Vorgabe bricht bei
  // manchen Reverse-Proxy-Konfigurationen das Ausliefern statischer Dateien.
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'same-origin' },
});

module.exports = { nonceMiddleware, helmetMiddleware };
