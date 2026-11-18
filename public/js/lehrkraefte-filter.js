// Suche, Filter und Sortierung der Lehrkraefte-Kacheln (Admin). Alles
// geschieht im Browser, die Liste ist ohnehin komplett auf der Seite.
// (Kein onsubmit-Attribut im HTML: die Content-Security-Policy erlaubt kein
// Inline-Skript - Enter im Suchfeld wird deshalb hier abgefangen.)
document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-lehrkraefte-filter]');
  const liste = document.querySelector('[data-lehrkraefte-liste]');
  if (!form || !liste) return;

  const suche = form.querySelector('[data-filter-suche]');
  const sortierung = form.querySelector('[data-filter-sort]');
  const nurOffen = form.querySelector('[data-filter-offen]');
  const nurStunden = form.querySelector('[data-filter-stunden]');
  const anzahl = document.querySelector('[data-filter-anzahl]');
  const leer = document.querySelector('[data-filter-leer]');
  const karten = Array.from(liste.children);

  form.addEventListener('submit', (event) => event.preventDefault());

  // Akzente und Gross-/Kleinschreibung egal: "mueller", "Müller" und "MÜLLER"
  // finden dieselbe Person.
  function normal(text) {
    return String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  const vergleiche = {
    name: (a, b) => a.dataset.anzeigename.localeCompare(b.dataset.anzeigename, 'de'),
    stunden: (a, b) => Number(b.dataset.stunden) - Number(a.dataset.stunden) || vergleiche.name(a, b),
    offen: (a, b) => Number(b.dataset.offen) - Number(a.dataset.offen) || vergleiche.name(a, b),
  };

  function aktualisieren() {
    const woerter = normal(suche.value).split(/\s+/).filter(Boolean);
    let sichtbar = 0;

    karten.forEach((karte) => {
      const text = normal(karte.dataset.name);
      const passt =
        woerter.every((w) => text.includes(w)) &&
        (!nurOffen.checked || Number(karte.dataset.offen) > 0) &&
        (!nurStunden.checked || Number(karte.dataset.stunden) > 0);
      karte.hidden = !passt;
      if (passt) sichtbar += 1;
    });

    karten
      .slice()
      .sort(vergleiche[sortierung.value] || vergleiche.name)
      .forEach((karte) => liste.appendChild(karte));

    anzahl.textContent = `${sichtbar} von ${karten.length} Lehrkräften`;
    leer.hidden = sichtbar > 0;
  }

  [suche, sortierung, nurOffen, nurStunden].forEach((el) => {
    el.addEventListener('input', aktualisieren);
    el.addEventListener('change', aktualisieren);
  });
});
