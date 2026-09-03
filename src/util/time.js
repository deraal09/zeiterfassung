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

// Erkennt "YYYY-MM-DD" (HTML-Datepicker) und "DD.MM.YYYY" (deutsche
// Schreibweise, z. B. aus einer CSV-Datei). Gibt "YYYY-MM-DD" zurueck
// oder null bei ungueltiger Eingabe.
function parseDatumEingabe(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
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

module.exports = {
  nowLocalString,
  formatLocal,
  parseLocal,
  diffMinutes,
  parseDatumEingabe,
  parseZeitEingabe,
};
