// Einfacher CSV-Parser mit automatischer Trennzeichen-Erkennung (Komma,
// Semikolon, Tab, Pipe) und Unterstuetzung fuer doppelt angefuehrte Felder
// (RFC 4180, "" als Escape fuer ein Anfuehrungszeichen im Feld).

const DELIMITERS = [';', ',', '\t', '|'];

function splitLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function detectDelimiter(headerLine) {
  let best = DELIMITERS[0];
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = splitLine(headerLine, d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

// Gibt ein Array von Objekten zurueck, je Datenzeile eins, mit den
// (kleingeschriebenen) Spaltennamen aus der Kopfzeile als Keys.
function parseCsv(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const header = splitLine(lines[0], delimiter).map((h) => h.toLowerCase());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitLine(lines[i], delimiter);
    const row = {};
    header.forEach((key, idx) => {
      row[key] = fields[idx] !== undefined ? fields[idx] : '';
    });
    rows.push(row);
  }
  return rows;
}

module.exports = { parseCsv };
