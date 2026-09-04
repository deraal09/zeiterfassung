const router = require('express').Router();
const multer = require('multer');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { nowLocalString, diffMinutes, parseDatumEingabe, parseZeitEingabe } = require('../util/time');
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
  'ungueltige-zeit': 'Die Endzeit muss nach der Startzeit liegen.',
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

// Solange keine Zuweisung verknuepft ist, gilt das von der Lehrkraft selbst
// eingetragene ziel_zeitstunden als vorlaeufiges Ziel. Sobald mindestens
// eine Zuweisung verknuepft ist, zaehlt nur noch die offizielle Berechnung
// (Ausgleichsstunden x Schuljahr-Faktor, summiert) - das eigene Ziel wird
// dann ignoriert (aber weiterhin angezeigt, siehe category.ejs).
function benoetigteStunden(category) {
  const summe = db
    .prepare(
      `SELECT COALESCE(SUM(z.ausgleichsstunden * COALESCE(sf.zeitstunden_pro_woche * sf.schulwochen,0)),0) as h,
              COUNT(*) as anzahl
       FROM zuweisungen z LEFT JOIN schuljahr_faktoren sf ON sf.schuljahr = z.schuljahr
       WHERE z.category_id=?`
    )
    .get(category.id);
  if (summe.anzahl > 0) return summe.h;
  return category.ziel_zeitstunden || 0;
}

// Legt einen manuellen Zeiteintrag an (Datum + Von + Bis, Dauer wird daraus
// berechnet). Gibt die Dauer in Minuten zurueck, oder null bei ungueltiger
// Zeitspanne (Bis <= Von). Wird sowohl vom einzelnen Nachtragen-Formular
// als auch vom CSV-Import verwendet.
function insertManualEntry(cat, userId, { beschreibung, datum, von, bis, unterprojektId }, autoSync) {
  const startStr = `${datum} ${von}:00`;
  const endStr = `${datum} ${bis}:00`;
  const duration = diffMinutes(startStr, endStr);
  if (!(duration > 0)) return null;

  db.prepare(
    `INSERT INTO time_entries
       (category_id, user_id, unterprojekt_id, beschreibung, start_time, end_time, duration_minutes, source, synced, synced_at)
     VALUES (?,?,?,?,?,?,?,'manual',?,?)`
  ).run(
    cat.id,
    userId,
    resolveUnterprojektId(cat.id, unterprojektId),
    encrypt((beschreibung || '').trim() || 'Taetigkeit'),
    startStr,
    endStr,
    duration,
    autoSync ? 1 : 0,
    autoSync ? nowLocalString() : null
  );
  return duration;
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
    benoetigteStunden: benoetigteStunden(cat),
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

  const { beschreibung, datum, von, bis, unterprojekt_id } = req.body;
  if (!datum || !von || !bis) return res.redirect(`/categories/${entry.category_id}?error=felder-fehlen`);

  const startStr = `${datum} ${von}:00`;
  const endStr = `${datum} ${bis}:00`;
  const duration = diffMinutes(startStr, endStr);
  if (!(duration > 0)) return res.redirect(`/categories/${entry.category_id}?error=ungueltige-zeit`);

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  db.prepare(
    'UPDATE time_entries SET beschreibung=?, start_time=?, end_time=?, duration_minutes=?, unterprojekt_id=?, synced=?, synced_at=? WHERE id=?'
  ).run(
    beschreibungZumSpeichern(beschreibung, entry.beschreibung),
    startStr,
    endStr,
    duration,
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

  const { beschreibung, datum, von, bis, unterprojekt_id } = req.body;
  if (!datum || !von || !bis) return res.redirect(`/categories/${cat.id}?error=felder-fehlen&formular=nachtragen`);

  const user = db.prepare('SELECT auto_sync FROM users WHERE id=?').get(userId);
  const duration = insertManualEntry(
    cat,
    userId,
    { beschreibung, datum, von, bis, unterprojektId: unterprojekt_id },
    !!user.auto_sync
  );
  if (duration === null) return res.redirect(`/categories/${cat.id}?error=ungueltige-zeit&formular=nachtragen`);

  res.redirect(`/categories/${cat.id}?formular=nachtragen`);
});

router.post('/categories/:id/import', requireAuth, upload.single('csv_file'), (req, res) => {
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
      const datum = parseDatumEingabe(row['datum'] ?? row['date']);
      const von = parseZeitEingabe(row['von'] ?? row['start']);
      const bis = parseZeitEingabe(row['bis'] ?? row['ende'] ?? row['end']);
      const beschreibung = row['beschreibung'] ?? row['taetigkeit'] ?? '';

      if (!datum || !von || !bis) {
        uebersprungen++;
        continue;
      }
      const duration = insertManualEntry(cat, userId, { beschreibung, datum, von, bis }, !!user.auto_sync);
      if (duration === null) {
        uebersprungen++;
        continue;
      }
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
