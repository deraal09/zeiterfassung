// Zeigt bei der Pool-Auswahl, wie viel dort vergeben und noch frei ist, und
// verhindert im Formular mehr Stunden als frei sind. Der Server prueft die
// Grenze unabhaengig davon noch einmal - das hier ist nur die fruehe,
// verstaendliche Rueckmeldung.
document.addEventListener('DOMContentLoaded', () => {
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });

  document.querySelectorAll('[data-pool-select]').forEach((select) => {
    // Die Teile einer Gruppe tragen dieselbe Kennung - sie muessen nicht im
    // selben <form> stehen (Felder koennen per form="..." zugeordnet sein).
    const gruppe = select.dataset.poolSelect;
    const stunden = document.querySelector(`[data-pool-stunden="${gruppe}"]`);
    const info = document.querySelector(`[data-pool-info="${gruppe}"]`);
    if (!stunden || !info) return;

    const aktualisiere = () => {
      const opt = select.selectedOptions[0];
      stunden.setCustomValidity('');
      info.classList.remove('pool-info-fehler');
      if (!opt || !opt.value) {
        info.textContent = '';
        return;
      }

      const gesamt = parseFloat(opt.dataset.stunden);
      const frei = parseFloat(opt.dataset.frei);
      const bisher = gesamt - frei;
      const h = parseFloat(String(stunden.value).replace(',', '.'));
      const wert = Number.isFinite(h) && h > 0 ? h : 0;
      const rest = Math.round((frei - wert) * 100) / 100;

      let text = `${opt.dataset.name}: ${fmt(bisher)} von ${fmt(gesamt)} h bereits vergeben, ${fmt(frei)} frei`;
      if (wert === 0) {
        text += '.';
      } else if (rest >= 0) {
        text += ` – nach dieser Zuweisung noch ${fmt(rest)} frei.`;
      } else {
        text += ` – ${fmt(-rest)} h zu viel.`;
        info.classList.add('pool-info-fehler');
        stunden.setCustomValidity(`Im Pool sind nur noch ${fmt(frei)} Stunden frei.`);
      }
      info.textContent = text;
    };

    select.addEventListener('change', aktualisiere);
    stunden.addEventListener('input', aktualisiere);
    aktualisiere();
  });
});
