const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = require('express').Router();
const multer = require('multer');
const config = require('../config');
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { csrfSchutzNachUpload } = require('../middleware/csrf');
const { istSchuljahr } = require('../util/schuljahr');
const { dokumentStatus } = require('../util/dokumente');

// Unterschriebene Ausdrucke (Scan oder Foto) zu einem Pool, einem Bereich oder
// der Gesamtuebersicht eines Schuljahres. Nur fuer Admins - weder die Liste
// noch die Dateien sind fuer Lehrkraefte erreichbar.

const MAX_BYTES = 15 * 1024 * 1024;
const UPLOAD_ORDNER = path.join(path.dirname(config.dbPath), 'uploads');

const ARTEN = new Set(['pool', 'bereich', 'uebersicht']);

const FEHLER = {
  'keine-datei': 'Bitte eine Datei auswaehlen.',
  'zu-gross': `Die Datei ist zu gross (hoechstens ${MAX_BYTES / 1024 / 1024} MB).`,
  'falscher-typ': 'Erlaubt sind PDF-Dateien sowie Bilder im Format JPG oder PNG.',
  'ziel-unbekannt': 'Der Pool bzw. Bereich existiert nicht (mehr) oder gehoert zu einem anderen Schuljahr.',
  'ungueltige-eingabe': 'Ungueltige Angaben zum Dokument.',
};

// Der Dateityp wird am Inhalt erkannt, nicht am Namen oder dem vom Browser
// gemeldeten Typ - beides stammt vom Absender. Nur diese drei Formate werden
// angenommen und mit dem hier festgelegten Typ wieder ausgeliefert.
function erkenneTyp(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', endung: '.pdf' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', endung: '.jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', endung: '.png' };
  }
  return null;
}

function zielGueltig(art, zielId, schuljahr) {
  if (art === 'uebersicht') return true;
  const tabelle = art === 'pool' ? 'pools' : 'bereiche';
  return !!db.prepare(`SELECT 1 FROM ${tabelle} WHERE id=? AND schuljahr=?`).get(zielId, schuljahr);
}

function seitenZiel(art, zielId, schuljahr, quelle) {
  const jahr = `schuljahr=${encodeURIComponent(schuljahr)}`;
  if (quelle !== 'dokumente') {
    if (art === 'pool') return `/admin/pools/${zielId}`;
    if (art === 'bereich') return `/admin/bereiche/${zielId}`;
    return `/admin/uebersicht?${jahr}`;
  }
  return `/admin/dokumente?${jahr}`;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

// Faengt Fehler von multer (z. B. zu grosse Datei) ab und meldet sie dem
// Admin auf der Seite, statt eine technische Fehlerseite zu zeigen.
function nimmDateiAn(req, res, next) {
  upload.single('datei')(req, res, (err) => {
    if (!err) return next();
    const code = err.code === 'LIMIT_FILE_SIZE' ? 'zu-gross' : 'ungueltige-eingabe';
    res.redirect(`/admin/dokumente?error=${code}`);
  });
}

router.get('/dokumente', requireAdmin, (req, res) => {
  const schuljahr = res.locals.adminSchuljahr;
  const status = dokumentStatus(schuljahr);
  const alleDateien = db
    .prepare('SELECT * FROM admin_dokumente WHERE schuljahr=? ORDER BY hochgeladen_am DESC, id DESC')
    .all(schuljahr);
  const namen = new Map([
    ...status.proPool.map((p) => [`pool:${p.id}`, `Pool ${p.name}`]),
    ...status.proBereich.map((b) => [`bereich:${b.id}`, `Bereich ${b.name}`]),
  ]);
  res.render('admin/dokumente', {
    schuljahr,
    status,
    maxMb: MAX_BYTES / 1024 / 1024,
    dateien: alleDateien.map((d) => ({
      ...d,
      zielName: d.art === 'uebersicht' ? 'Übersicht aller Pools' : namen.get(`${d.art}:${d.ziel_id}`) || '(gelöscht)',
    })),
    error: FEHLER[req.query.error] || null,
    ok: req.query.ok === 'hochgeladen' ? 'Dokument hochgeladen.' : req.query.ok === 'geloescht' ? 'Dokument geloescht.' : null,
  });
});

// csrfSchutzNachUpload steht hinter multer: bei multipart/form-data liest
// erst multer die Formularfelder, vorher ist req.body leer.
router.post('/dokumente', requireAdmin, nimmDateiAn, csrfSchutzNachUpload, (req, res) => {
  const { art, quelle } = req.body;
  const schuljahr = req.body.schuljahr;
  const zielId = art === 'uebersicht' ? null : Number(req.body.ziel_id);
  if (!ARTEN.has(art) || !istSchuljahr(schuljahr) || (art !== 'uebersicht' && !Number.isInteger(zielId))) {
    return res.redirect('/admin/dokumente?error=ungueltige-eingabe');
  }

  const zielSeite = seitenZiel(art, zielId, schuljahr, quelle);
  const zurueck = (code, ok) =>
    res.redirect(`${zielSeite}${zielSeite.includes('?') ? '&' : '?'}${ok ? `ok=${ok}` : `error=${code}`}`);

  if (!zielGueltig(art, zielId, schuljahr)) return zurueck('ziel-unbekannt');
  if (!req.file || req.file.size === 0) return zurueck('keine-datei');
  const typ = erkenneTyp(req.file.buffer);
  if (!typ) return zurueck('falscher-typ');

  fs.mkdirSync(UPLOAD_ORDNER, { recursive: true });
  const datei = `${crypto.randomBytes(16).toString('hex')}${typ.endung}`;
  fs.writeFileSync(path.join(UPLOAD_ORDNER, datei), req.file.buffer, { mode: 0o600 });

  const anzeigename = path.basename(String(req.file.originalname || 'dokument')).slice(0, 200);
  db.prepare(
    `INSERT INTO admin_dokumente (schuljahr, art, ziel_id, dateiname, datei, mime, groesse, hochgeladen_von)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(schuljahr, art, zielId, anzeigename, datei, typ.mime, req.file.size, req.session.user.username);

  zurueck(null, 'hochgeladen');
});

// Liefert die Datei aus. Der Typ stammt aus der Erkennung beim Upload (nie vom
// Absender); die globale Content-Security-Policy wird hier ausgelassen, weil
// sie den PDF-Betrachter mancher Browser (object-src 'none') blockiert - es
// werden ausschliesslich geprueftes PDF/JPG/PNG mit festem Typ und nosniff
// ausgeliefert, nie HTML.
router.get('/dokumente/:id/datei', requireAdmin, (req, res) => {
  const d = db.prepare('SELECT * FROM admin_dokumente WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).render('error', { message: 'Dokument nicht gefunden.' });

  const pfad = path.join(UPLOAD_ORDNER, path.basename(d.datei));
  if (!fs.existsSync(pfad)) return res.status(404).render('error', { message: 'Die Datei ist auf dem Server nicht mehr vorhanden.' });

  const endung = path.extname(d.datei);
  const name = `${d.art}-${d.schuljahr.replace('/', '-')}-${d.id}${endung}`;
  res.removeHeader('Content-Security-Policy');
  res.set({
    'Content-Type': d.mime,
    'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${name}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(pfad).pipe(res);
});

router.post('/dokumente/:id/loeschen', requireAdmin, (req, res) => {
  const d = db.prepare('SELECT * FROM admin_dokumente WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).render('error', { message: 'Dokument nicht gefunden.' });

  db.prepare('DELETE FROM admin_dokumente WHERE id=?').run(d.id);
  try {
    fs.unlinkSync(path.join(UPLOAD_ORDNER, path.basename(d.datei)));
  } catch (err) {
    // Fehlt die Datei schon, ist das Ziel (kein Dokument mehr) erreicht.
  }
  res.redirect(`/admin/dokumente?schuljahr=${encodeURIComponent(d.schuljahr)}&ok=geloescht`);
});

module.exports = router;
