const router = require('express').Router();
const multer = require('multer');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { csrfSchutzNachUpload } = require('../middleware/csrf');
const { nowLocalString, diffMinutes, baueZeitraum, MAX_DAUER_MINUTEN } = require('../util/time');
const { zielZeitstunden, fortschrittProzent } = require('../util/stunden');
const { parseCsv } = require('../util/csv');
const { encrypt, decrypt, UNLESBAR } = require('../util/crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

// Eine nicht entschluesselbare Beschreibung wird als Platzhalter angezeigt
// (siehe util/crypto.js). Schickt das Bearbeiten-Formular genau diesen
// Platzhalter unveraendert zurueck, darf er den bestehenden Chiffretext NICHT
// ersetzen - sonst wuerde ein Speichern den (evtl. mit dem richtigen
// Schluessel noch rettbaren) Originalwert endgueltig zerstoeren.
function beschreibungZumSpeichern(eingabe, bisher) {
  const text = (eingabe || '').trim();
  if (text === UNLESBAR) return bisher;
  return encrypt(text || 'Taetigkeit');
}

const ERROR_MESSAGES = {
  'timer-laeuft': 'Es laeuft bereits eine Zeiterfassung. Bitte zuerst stoppen.',
  'felder-fehlen': 'Bitte alle Felder ausfuellen.',
  'ungueltige-zeit':
    'Das Ende muss nach dem Beginn liegen. Endet die Taetigkeit erst am Folgetag, bitte zusaetzlich das Bis-Datum angeben.',
  'ungueltiges-datum': 'Bitte ein gueltiges Datum angeben.',
  'ungueltige-uhrzeit': 'Bitte gueltige Uhrzeiten im Format HH:MM angeben.',
  'zu-lang': `Ein einzelner Eintrag kann hoechstens ${MAX_DAUER_MINUTEN / 60} Stunden umfassen. Bitte Datum und Uhrzeiten pruefen.`,
  'keine-datei': 'Bitte eine CSV-Datei auswaehlen.',
  'ungueltiges-ziel': 'Bitte eine gueltige Anzahl Zeitstunden eingeben.',
  'unterprojekt-titel-fehlt': 'Bitte einen Titel fuer das Unterprojekt eingeben.',
};

function getOwnedCategory(id, userId) {
  return db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(id, userId);
}

function kategorieHatZuweisung(categoryId) {
  return !!db.prepare('SELECT 1 FROM zuweisungen WHERE category_id=? LIMIT 1').get(categoryId);
}

function getUnterprojekte(categoryId) {
  return db.prepare('SELECT * FROM unterprojekte WHERE category_id=? ORDER BY created_at ASC').all(categoryId);
}

// Holt (oder legt bei Bedarf an) das Auffang-Unterprojekt "Allgemein" einer
// Kategorie - dorthin wandern Zeiten, die keinem konkreten Unterprojekt
// zugeordnet wurden, sobald die Kategorie ueberhaupt Unterprojekte hat.
function allgemeinUnterprojekt(categoryId) {
  let up = db.prepare("SELECT * FROM unterprojekte WHERE category_id=? AND title='Allgemein'").get(categoryId);
  if (!up) {
    const info = db.prepare('INSERT INTO unterprojekte (category_id, title) VALUES (?,?)').run(categoryId, 'Allgemein');
    up = db.prepare('SELECT * FROM unterprojekte WHERE id=?').get(info.lastInsertRowid);
  }
  return up;
}

// Loest die zu speichernde unterprojekt_id auf. Unterprojekte sind komplett
// optional: hat die Kategorie noch keine, bleibt der Eintrag unzugeordnet
// (null). Hat sie welche, zaehlt entweder das explizit gewaehlte (wenn es
// zu dieser Kategorie gehoert) oder sonst automatisch "Allgemein" - damit
// hat in einer Kategorie mit Unterprojekten am Ende jede Zeit eins
// zugeordnet.
function resolveUnterprojektId(categoryId, submittedId) {
  const hatUnterprojekte = !!db.prepare('SELECT 1 FROM unterprojekte WHERE category_id=? LIMIT 1').get(categoryId);
  if (!hatUnterprojekte) return null;
  if (submittedId) {
    const up = db.prepare('SELECT id FROM unterprojekte WHERE id=? AND category_id=?').get(submittedId, categoryId);
    if (up) return up.id;
  }
  return allgemeinUnterprojekt(categoryId).id;
}

// Legt einen manuellen Zeiteintrag aus einem bereits geprueften Zeitraum an
// (siehe baueZeitraum in util/time.js). Wird sowohl vom Nachtragen-Formular
// als auch vom CSV-Import verwendet.
function insertManualEntry(cat, userId, { beschreibung, zeitraum, unterprojektId }, autoSync) {
  db.prepare(
    `INSERT INTO time_entries
       (category_id, user_id, unterprojekt_id, beschreibung, start_time, end_time, duration_minutes, source, synced, synced_at)
     VALUES (?,?,?,?,?,?,?,'manual',?,?)`
  ).run(
    cat.id,
    userId,
    resolveUnterprojektId(cat.id, unterprojektId),
    encrypt((beschreibung || '').trim() || 'Taetigkeit'),
    zeitraum.startStr,
    zeitraum.endStr,
    zeitraum.dauer,
    autoSync ? 1 : 0,
    autoSync ? nowLocalString() : null
  );
}

router.get('/categories/:id', requireAuth, (req, res) => {
  const cat = getOwnedCategory(req.params.id, req.session.user.id);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const laufender = db
    .prepare(
      `SELECT te.*, up.title as unterprojekt_title FROM time_entries te
       LEFT JOIN unterprojekte up ON up.id = te.unterprojekt_id
       WHERE te.category_id=? AND te.end_time IS NULL`
    )
    .get(cat.id);
  if (laufender) laufender.beschreibung = decrypt(laufender.beschreibung);

  // Unterprojekte gliedern die Zeiten optional weiter (siehe Kommentar an
  // der Tabelle in db.js). Je Unterprojekt wird die Gesamtzeit aus allen
  // damit verknuepften abgeschlossenen Eintraegen berechnet - unabhaengig
  // vom Filter der Tabelle darunter, aus demselben Grund wie erfassteStunden.
  const unterprojekte = getUnterprojekte(cat.id).map((up) => {
    const minuten = db
      .prepare('SELECT COALESCE(SUM(duration_minutes),0) as m FROM time_entries WHERE unterprojekt_id=? AND end_time IS NOT NULL')
      .get(up.id).m;
    return { ...up, stunden: minuten / 60 };
  });

  // Erfasste Zeitstunden (Fortschrittsbalken) beziehen sich immer auf ALLE
  // abgeschlossenen Eintraege, unabhaengig von Sortierung/Filter der Tabelle
  // darunter - sonst wuerde ein aktiver Filter den Fortschritt verfaelschen.
  const sumMinutes = db
    .prepare('SELECT COALESCE(SUM(duration_minutes),0) as m FROM time_entries WHERE category_id=? AND end_time IS NOT NULL')
    .get(cat.id).m;

  const sort = req.query.sort === 'asc' ? 'ASC' : 'DESC';
  const von = (req.query.von || '').trim();
  const bis = (req.query.bis || '').trim();
  const suche = (req.query.suche || '').trim();

  const bedingungen = ['category_id = ?', 'end_time IS NOT NULL'];
  const params = [cat.id];
  if (von) {
    bedingungen.push('date(start_time) >= date(?)');
    params.push(von);
  }
  if (bis) {
    bedingungen.push('date(start_time) <= date(?)');
    params.push(bis);
  }

  // beschreibung liegt verschluesselt in der DB und kann daher nicht per SQL
  // LIKE gefiltert werden - Datum/Sortierung laufen weiterhin ueber SQL,
  // die Beschreibungssuche wird erst nach dem Entschluesseln in JS
  // angewendet (bei den Datenmengen einer Schule unproblematisch).
  let entries = db
    .prepare(
      `SELECT * FROM time_entries WHERE ${bedingungen.join(' AND ')} ORDER BY start_time ${sort}`
    )
    .all(...params);
  entries.forEach((e) => { e.beschreibung = decrypt(e.beschreibung); });
  if (suche) {
    const nadel = suche.toLowerCase();
    entries = entries.filter((e) => e.beschreibung.toLowerCase().includes(nadel));
  }

  // Hat die Kategorie Unterprojekte, werden die (bereits gefilterten und
  // sortierten) Eintraege dafuer nach Unterprojekt gruppiert - jede Zeit
  // gehoert dann zu genau einem, siehe resolveUnterprojektId. Ohne
  // Unterprojekte bleibt es bei der bisherigen flachen Ansicht (eine
  // "Gruppe" ohne Ueberschrift).
  let gruppen;
  if (unterprojekte.length > 0) {
    const gruppenNachId = new Map(
      unterprojekte.map((up) => [up.id, { id: up.id, title: up.title, stunden: up.stunden, entries: [] }])
    );
    entries.forEach((e) => {
      const gruppe = gruppenNachId.get(e.unterprojekt_id);
      if (gruppe) gruppe.entries.push(e);
    });
    gruppen = Array.from(gruppenNachId.values());
    gruppen.sort((a, b) => (a.title === 'Allgemein' ? 1 : 0) - (b.title === 'Allgemein' ? 1 : 0));
  } else {
    gruppen = [{ id: null, title: null, stunden: null, entries }];
  }

  const importiert = parseInt(req.query.importiert, 10);
  const uebersprungen = parseInt(req.query.uebersprungen, 10);

  const hatZuweisung = kategorieHatZuweisung(cat.id);

  // Standardmaessig ist nur die Erfassen-Ansicht (Beschreibung + Start/Stopp)
  // sichtbar. Nach dem Absenden von "Zeit nachtragen" oder "CSV importieren"
  // bleibt die jeweilige Ansicht aktiv, damit Fehler/Ergebnis im Kontext
  // sichtbar bleiben.
  const activeTab = ['nachtragen', 'import'].includes(req.query.formular) ? req.query.formular : 'erfassen';

  res.render('category', {
    category: cat,
    gruppen,
    unterprojekte,
    running: laufender,
    erfassteStunden: sumMinutes / 60,
    ziel: zielZeitstunden(cat),
    fortschritt: fortschrittProzent(sumMinutes / 60, zielZeitstunden(cat).stunden),
    hatZuweisung,
    activeTab,
    filter: { sort: sort === 'ASC' ? 'asc' : 'desc', von, bis, suche },
    error: ERROR_MESSAGES[req.query.error] || null,
    importInfo: Number.isInteger(importiert) ? { importiert, uebersprungen: uebersprungen || 0 } : null,
  });
});

router.post('/categories/:id/start', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const cat = getOwnedCategory(req.params.id, userId);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const already = db.prepare('SELECT id FROM time_entries WHERE user_id=? AND end_time IS NULL').get(userId);
  if (already) return res.redirect(`/categories/${cat.id}?error=timer-laeuft`);

  const beschreibung = (req.body.beschreibung || '').trim() || 'Taetigkeit';
  const unterprojektId = resolveUnterprojektId(cat.id, req.body.unterprojekt_id);
  db.prepare(
    "INSERT INTO time_entries (category_id, user_id, unterprojekt_id, beschreibung, start_time, source) VALUES (?,?,?,?,?,'timer')"
  ).run(cat.id, userId, unterprojektId, encrypt(beschreibung), nowLocalString());

  res.redirect(`/categories/${cat.id}`);
});

router.post('/entries/:id/stop', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const entry = db.prepare('SELECT * FROM time_entries WHERE id=? AND user_id=?').get(req.params.id, userId);
  if (!entry) return res.status(404).render('error', { message: 'Eintrag nicht gefunden.' });
  if (entry.end_time) return res.redirect(`/categories/${entry.category_id}`);

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  const endTime = nowLocalString();
  const duration = Math.max(diffMinutes(entry.start_time, endTime), 0);

  db.prepare('UPDATE time_entries SET end_time=?, duration_minutes=?, synced=?, synced_at=? WHERE id=?').run(
    endTime,
    duration,
    user.auto_sync ? 1 : 0,
    user.auto_sync ? nowLocalString() : null,
    entry.id
  );

  res.redirect(`/categories/${entry.category_id}`);
});

// Korrektur eines bereits abgeschlossenen Eintrags (z. B. Verschreiber bei
// Datum/Uhrzeit). Ein noch laufender Timer wird hier nicht bearbeitet -
// dafuer gibt es Stopp. War der Eintrag schon synchronisiert, gilt er nach
// der Korrektur wieder als Entwurf (ausser bei aktivem Auto-Sync), damit dem
// Admin nicht stillschweigend ein veralteter Wert stehen bleibt.
router.post('/entries/:id/edit', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const entry = db.prepare('SELECT * FROM time_entries WHERE id=? AND user_id=?').get(req.params.id, userId);
  if (!entry) return res.status(404).render('error', { message: 'Eintrag nicht gefunden.' });
  if (!entry.end_time) return res.redirect(`/categories/${entry.category_id}`);

  const { beschreibung, datum, bis_datum, von, bis, unterprojekt_id } = req.body;
  if (!datum || !von || !bis) return res.redirect(`/categories/${entry.category_id}?error=felder-fehlen`);

  const zeitraum = baueZeitraum({ datum, von, bis, bisDatum: bis_datum });
  if (zeitraum.fehler) return res.redirect(`/categories/${entry.category_id}?error=${zeitraum.fehler}`);

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  db.prepare(
    'UPDATE time_entries SET beschreibung=?, start_time=?, end_time=?, duration_minutes=?, unterprojekt_id=?, synced=?, synced_at=? WHERE id=?'
  ).run(
    beschreibungZumSpeichern(beschreibung, entry.beschreibung),
    zeitraum.startStr,
    zeitraum.endStr,
    zeitraum.dauer,
    resolveUnterprojektId(entry.category_id, unterprojekt_id),
    user.auto_sync ? 1 : 0,
    user.auto_sync ? nowLocalString() : null,
    entry.id
  );

  res.redirect(`/categories/${entry.category_id}`);
});

router.post('/entries/:id/delete', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const entry = db.prepare('SELECT * FROM time_entries WHERE id=? AND user_id=?').get(req.params.id, userId);
  if (!entry) return res.status(404).render('error', { message: 'Eintrag nicht gefunden.' });

  const categoryId = entry.category_id;
  db.prepare('DELETE FROM time_entries WHERE id=?').run(entry.id);
  res.redirect(`/categories/${categoryId}`);
});

router.post('/categories/:id/entries', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const cat = getOwnedCategory(req.params.id, userId);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const { beschreibung, datum, bis_datum, von, bis, unterprojekt_id } = req.body;
  if (!datum || !von || !bis) return res.redirect(`/categories/${cat.id}?error=felder-fehlen&formular=nachtragen`);

  const zeitraum = baueZeitraum({ datum, von, bis, bisDatum: bis_datum });
  if (zeitraum.fehler) {
    return res.redirect(`/categories/${cat.id}?error=${zeitraum.fehler}&formular=nachtragen`);
  }

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  insertManualEntry(cat, userId, { beschreibung, zeitraum, unterprojektId: unterprojekt_id }, !!user.auto_sync);

  res.redirect(`/categories/${cat.id}?formular=nachtragen`);
});

// csrfSchutzNachUpload steht hinter multer: bei multipart/form-data liest
// erst multer die Formularfelder, vorher ist req.body leer und die globale
// CSRF-Middleware koennte das Token gar nicht sehen.
router.post('/categories/:id/import', requireAuth, upload.single('csv_file'), csrfSchutzNachUpload, (req, res) => {
  const userId = req.session.user.id;
  const cat = getOwnedCategory(req.params.id, userId);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });
  if (!req.file) return res.redirect(`/categories/${cat.id}?error=keine-datei&formular=import`);

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  const rows = parseCsv(req.file.buffer.toString('utf8'));

  let importiert = 0;
  let uebersprungen = 0;

  const importieren = db.transaction((zeilen) => {
    for (const row of zeilen) {
      const beschreibung = row['beschreibung'] ?? row['taetigkeit'] ?? '';
      // Das Bis-Datum ist optional und nur fuer Taetigkeiten ueber
      // Mitternacht noetig - ohne Angabe endet der Eintrag am selben Tag.
      const zeitraum = baueZeitraum({
        datum: row['datum'] ?? row['date'],
        bisDatum: row['bis-datum'] ?? row['bisdatum'] ?? row['enddatum'],
        von: row['von'] ?? row['start'],
        bis: row['bis'] ?? row['ende'] ?? row['end'],
      });

      if (zeitraum.fehler) {
        uebersprungen++;
        continue;
      }
      insertManualEntry(cat, userId, { beschreibung, zeitraum }, !!user.auto_sync);
      importiert++;
    }
  });
  importieren(rows);

  res.redirect(`/categories/${cat.id}?importiert=${importiert}&uebersprungen=${uebersprungen}&formular=import`);
});

// Eigenes vorlaeufiges Zeitstunden-Ziel, solange noch keine Zuweisung
// verknuepft ist. Danach gesperrt (der Request wird einfach ignoriert),
// weil die offizielle Berechnung dann massgeblich ist.
router.post('/categories/:id/ziel', requireAuth, (req, res) => {
  const cat = getOwnedCategory(req.params.id, req.session.user.id);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });
  if (kategorieHatZuweisung(cat.id)) return res.redirect(`/categories/${cat.id}`);

  const wert = parseFloat(String(req.body.ziel_zeitstunden || '').replace(',', '.'));
  if (!(wert > 0)) return res.redirect(`/categories/${cat.id}?error=ungueltiges-ziel`);

  db.prepare('UPDATE categories SET ziel_zeitstunden=? WHERE id=?').run(wert, cat.id);
  res.redirect(`/categories/${cat.id}`);
});

// Legt ein neues Unterprojekt fuer die Kategorie an. Beim allerersten
// Unterprojekt einer Kategorie werden gleichzeitig alle bis dahin nicht
// zugeordneten Zeiten dem (bei Bedarf automatisch angelegten) Unterprojekt
// "Allgemein" zugeordnet - siehe Kommentar an db.js/unterprojekte.
router.post('/categories/:id/unterprojekte', requireAuth, (req, res) => {
  const cat = getOwnedCategory(req.params.id, req.session.user.id);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const title = (req.body.title || '').trim();
  if (!title) return res.redirect(`/categories/${cat.id}?error=unterprojekt-titel-fehlt`);

  const hatteBereitsUnterprojekte = !!db.prepare('SELECT 1 FROM unterprojekte WHERE category_id=? LIMIT 1').get(cat.id);
  db.prepare('INSERT INTO unterprojekte (category_id, title) VALUES (?,?)').run(cat.id, title);

  if (!hatteBereitsUnterprojekte) {
    const allgemein = allgemeinUnterprojekt(cat.id);
    db.prepare('UPDATE time_entries SET unterprojekt_id=? WHERE category_id=? AND unterprojekt_id IS NULL').run(
      allgemein.id,
      cat.id
    );
  }

  res.redirect(`/categories/${cat.id}`);
});

router.post('/categories/:id/sichtbarkeit', requireAuth, (req, res) => {
  const cat = getOwnedCategory(req.params.id, req.session.user.id);
  if (!cat) return res.status(404).render('error', { message: 'Kategorie nicht gefunden.' });

  const sichtbar = req.body.sichtbar === 'on' ? 1 : 0;
  db.prepare('UPDATE categories SET visible_for_admin=? WHERE id=?').run(sichtbar, cat.id);
  res.redirect(`/categories/${cat.id}`);
});

module.exports = router;
