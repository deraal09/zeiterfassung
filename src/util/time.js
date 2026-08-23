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

module.exports = { nowLocalString, formatLocal, parseLocal, diffMinutes };
