// Unterprojekt-Gruppen sind standardmaessig eingeklappt. Weil jede Aenderung
// an einem Eintrag (automatisches Speichern, Zuordnen, Loeschen) die Seite neu
// laedt, merkt sich dieses Skript je Browser-Tab, welche Gruppen aufgeklappt
// wurden - sonst klappte die gerade bearbeitete Gruppe nach jedem Speichern
// wieder zu.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('details[data-merken]').forEach((el) => {
    const key = `details:${el.dataset.merken}`;
    try {
      if (sessionStorage.getItem(key) === '1') el.open = true;
    } catch (e) {
      // Ohne Speicher (z. B. privater Modus) bleibt es beim Standard: eingeklappt.
    }
    el.addEventListener('toggle', () => {
      try {
        sessionStorage.setItem(key, el.open ? '1' : '0');
      } catch (e) {
        // siehe oben
      }
    });
  });
});
