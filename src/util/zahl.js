// Zahl in deutscher Schreibweise: Komma, hoechstens zwei Nachkommastellen,
// ohne ueberfluessige Nullen (10,5 statt 10,50). Fuer Ansichten steht sie als
// zahl() in app.locals bereit.
function zahl(wert) {
  return (Math.round(Number(wert) * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

module.exports = { zahl };
