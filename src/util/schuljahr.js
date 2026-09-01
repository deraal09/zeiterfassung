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

module.exports = { aktuellesSchuljahr, schuljahrFuer };
