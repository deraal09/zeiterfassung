// Deutsches Schuljahr: 1. August bis 31. Juli, Format "YYYY/YY" (z. B. "2026/27").

function pad2(n) {
  return String(n).padStart(2, '0');
}

function schuljahrFuer(date) {
  const jahr = date.getFullYear();
  const startJahr = date.getMonth() >= 7 ? jahr : jahr - 1; // Monat 7 = August (0-indiziert)
  return `${startJahr}/${pad2((startJahr + 1) % 100)}`;
}

function aktuellesSchuljahr() {
  return schuljahrFuer(new Date());
}

// Prueft die Schreibweise "YYYY/YY" und dass die zweite Zahl wirklich auf das
// Startjahr folgt - "2026/28" waere sonst ein Schuljahr, das es nicht gibt.
// Wird fuer alles gebraucht, was von aussen kommt (Auswahl im Dashboard,
// Eingabe im Admin-Bereich).
function istSchuljahr(wert) {
  const m = String(wert || '').trim().match(/^(\d{4})\/(\d{2})$/);
  if (!m) return false;
  const startJahr = Number(m[1]);
  return pad2((startJahr + 1) % 100) === m[2];
}

// Schuljahr n Jahre vor/nach dem uebergebenen ("2026/27", -1 -> "2025/26").
function schuljahrVerschoben(schuljahr, versatz) {
  const startJahr = Number(String(schuljahr).slice(0, 4)) + versatz;
  return `${startJahr}/${pad2((startJahr + 1) % 100)}`;
}

module.exports = { aktuellesSchuljahr, schuljahrFuer, istSchuljahr, schuljahrVerschoben };
