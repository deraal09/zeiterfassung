const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Kurzer Inhalts-Hash aller Stylesheets und Skripte unter public/. Er haengt
// als ?v=... an deren Adressen (siehe views): aendert sich eine Datei, aendert
// sich die Adresse, und Browser (oder ein vorgeschalteter Webserver) laden sie
// neu, statt nach einem Update mit altem CSS/JS zur neuen Seite zu laden.
// Aendert sich nichts, bleibt die Nummer ueber Neustarts gleich und der Cache
// nutzbar.
function berechne(wurzel = path.join(__dirname, '..', '..', 'public')) {
  const hash = crypto.createHash('sha1');
  for (const ordner of ['css', 'js']) {
    const pfad = path.join(wurzel, ordner);
    if (!fs.existsSync(pfad)) continue;
    for (const datei of fs.readdirSync(pfad).sort()) {
      if (!/\.(css|js)$/.test(datei)) continue;
      hash.update(`${ordner}/${datei}\n`);
      hash.update(fs.readFileSync(path.join(pfad, datei)));
    }
  }
  return hash.digest('hex').slice(0, 10);
}

module.exports = { berechne };
