// Alle Zeiten werden als "naive" lokale Zeitstrings ("YYYY-MM-DD HH:MM:SS")
// in der Server-Zeitzone (siehe TZ in config.js) gespeichert. So bleiben
// Timer-Eintraege und manuell nachgetragene Eintraege konsistent, ohne dass
// UTC-Konvertierung noetig ist.

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatLocal(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function nowLocalString() {
  return formatLocal(new Date());
}

function parseLocal(str) {
  const [datePart, timePart] = str.trim().replace('T', ' ').split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = (timePart || '00:00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss || 0);
}

function diffMinutes(startStr, endStr) {
  return (parseLocal(endStr) - parseLocal(startStr)) / 60000;
}

// Prueft, ob es den Tag im Kalender ueberhaupt gibt. Ein reiner
// Formatabgleich reicht nicht: "2026-13-45" passt aufs Muster, ergibt in der
// Datenbank aber einen Wert, den SQLite nicht als Datum lesen kann - solche
// Zeilen fallen dann aus jedem Datumsfilter heraus, zaehlen aber weiter in
// die Summen.
function istKalendertag(jahr, monat, tag) {
  const date = new Date(jahr, monat - 1, tag);
  return date.getFullYear() === jahr && date.getMonth() === monat - 1 && date.getDate() === tag;
}

// Erkennt "YYYY-MM-DD" (HTML-Datepicker) und "DD.MM.YYYY" (deutsche
// Schreibweise, z. B. aus einer CSV-Datei). Gibt "YYYY-MM-DD" zurueck
// oder null bei ungueltiger Eingabe.
function parseDatumEingabe(value) {
  const s = String(value || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, mo, d] = iso.map(Number);
    return istKalendertag(y, mo, d) ? s : null;
  }
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  if (!istKalendertag(Number(y), Number(mo), Number(d))) return null;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Erkennt "HH:MM" und "HH:MM:SS", auch mit einstelliger Stunde ("9:00").
// Gibt "HH:MM" zurueck oder null bei ungueltiger Eingabe.
function parseZeitEingabe(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh > 23 || mm > 59) return null;
  return `${pad(hh)}:${pad(mm)}`;
}

// Bringt einen bereits gespeicherten Zeitstempel in die kanonische Form
// "YYYY-MM-DD HH:MM:SS". Gibt null zurueck, wenn der Wert keinen echten
// Kalenderzeitpunkt beschreibt - dann darf er NICHT stillschweigend
// umgedeutet werden (aus "2026-13-45" wuerde beim Weiterrechnen sonst der
// 14.02.2027, also ein frei erfundenes Datum).
function normalisiereZeitstempel(wert) {
  const m = String(wert || '')
    .trim()
    .replace('T', ' ')
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;

  const jahr = Number(m[1]);
  const monat = Number(m[2]);
  const tag = Number(m[3]);
  const stunde = Number(m[4]);
  const minute = Number(m[5]);
  const sekunde = m[6] === undefined ? 0 : Number(m[6]);

  if (!istKalendertag(jahr, monat, tag)) return null;
  if (stunde > 23 || minute > 59 || sekunde > 59) return null;

  return `${jahr}-${pad(monat)}-${pad(tag)} ${pad(stunde)}:${pad(minute)}:${pad(sekunde)}`;
}

// Ein einzelner nachgetragener Eintrag laenger als ein Tag ist praktisch
// immer ein Vertipper im Datum (etwa ein falsches Jahr im Bis-Datum) und
// nicht echte Arbeitszeit. Ohne diese Grenze landen daraus zwei- bis
// dreistellige Stundenwerte in der Auswertung.
const MAX_DAUER_MINUTEN = 24 * 60;

// Baut aus den Formular-/CSV-Eingaben ein geprueftes Start-/End-Paar in der
// Speicherform "YYYY-MM-DD HH:MM:SS". Einzige Stelle, an der aus Eingaben
// gespeicherte Zeitstempel werden - vorher setzte jede Route den String
// selbst zusammen, wodurch unvalidierte Werte in die Datenbank gelangten.
//
// bisDatum ist optional; leer bedeutet "endet am selben Tag". Fuer eine
// Taetigkeit ueber Mitternacht wird es ausdruecklich angegeben, statt bei
// "Bis <= Von" automatisch auf den Folgetag zu rollen - ein vertauschtes
// Uhrzeitpaar soll eine Fehlermeldung ergeben und keine 23-Stunden-Schicht.
//
// Gibt { startStr, endStr, dauer } zurueck oder { fehler } mit einem Code
// aus ERROR_MESSAGES der Routen.
function baueZeitraum({ datum, von, bis, bisDatum }) {
  const startDatum = parseDatumEingabe(datum);
  if (!startDatum) return { fehler: 'ungueltiges-datum' };

  const endDatum = bisDatum ? parseDatumEingabe(bisDatum) : startDatum;
  if (!endDatum) return { fehler: 'ungueltiges-datum' };

  const startZeit = parseZeitEingabe(von);
  const endZeit = parseZeitEingabe(bis);
  if (!startZeit || !endZeit) return { fehler: 'ungueltige-uhrzeit' };

  const startStr = `${startDatum} ${startZeit}:00`;
  const endStr = `${endDatum} ${endZeit}:00`;
  const dauer = diffMinutes(startStr, endStr);

  if (!(dauer > 0)) return { fehler: 'ungueltige-zeit' };
  if (dauer > MAX_DAUER_MINUTEN) return { fehler: 'zu-lang' };

  return { startStr, endStr, dauer };
}

module.exports = {
  nowLocalString,
  formatLocal,
  parseLocal,
  diffMinutes,
  parseDatumEingabe,
  parseZeitEingabe,
  baueZeitraum,
  normalisiereZeitstempel,
  MAX_DAUER_MINUTEN,
};
