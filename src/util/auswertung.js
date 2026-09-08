// Grafische Auswertung auf dem Dashboard: Saeulendiagramme, gestapelt bzw.
// gruppiert aus synchronisierten und noch nicht synchronisierten (Entwurf)
// Stunden - einmal je Kategorie ("Zeiten je Kategorie"), einmal je Monat
// des Schuljahres ("Zeiten im Schuljahresverlauf"). Reine Berechnung ohne
// DB-Zugriff, damit sich Achse und Balken-Geometrie unabhaengig von der
// Route testen lassen; welche Zeilen (Kategorien oder Monate) reinkommen,
// bestimmt die Route.

// Rundet einen rohen Maximalwert auf eine "runde" Achsen-Obergrenze auf
// (1/2/5 x 10^n) - sonst zeigen die Gitterlinien krumme Werte wie 17,3.
function nizeMax(rohMax) {
  if (!(rohMax > 0)) return 1;
  const exponent = Math.floor(Math.log10(rohMax));
  const basis = Math.pow(10, exponent);
  const fraktion = rohMax / basis;
  let stufe;
  if (fraktion <= 1) stufe = 1;
  else if (fraktion <= 2) stufe = 2;
  else if (fraktion <= 5) stufe = 5;
  else stufe = 10;
  return stufe * basis;
}

// Baut eine Achse mit `schritte` gleich grossen Intervallen von 0 bis zur
// aufgerundeten Obergrenze.
function achse(rohMax, schritte = 4) {
  const max = nizeMax(rohMax);
  const ticks = [];
  for (let i = 0; i <= schritte; i++) {
    ticks.push(Math.round(((i * max) / schritte) * 100) / 100);
  }
  return { max, ticks };
}

// zeilen: [{ title, synced, entwurf }] (Stunden) - je eine Kategorie oder,
// fuer die Zeitleiste, je ein Monat des Schuljahres.
//
// Ohne alleZeilen liefert eine Zeile ganz ohne erfasste Zeit keinen Balken -
// passend fuer "je Kategorie", wo eine leere Kategorie nichts zu zeigen
// haette und die Achse nur unnoetig stauchen wuerde. Mit alleZeilen:true
// (Zeitleiste) bleiben auch Nullwerte als Balken der Hoehe 0 erhalten -
// dort ist eine Luecke (z. B. die Sommerferien) selbst die Information und
// soll nicht stillschweigend verschwinden.
//
// Liefert in jedem Fall null, wenn es insgesamt nichts zu zeigen gibt (dann
// blendet die Ansicht die Auswertung ganz aus statt eines leeren Diagramms).
function balkenDaten(zeilenRoh, plotHoehePx, { alleZeilen = false } = {}) {
  const hatDaten = zeilenRoh.some((z) => z.synced + z.entwurf > 0);
  if (!hatDaten) return null;

  const zeilen = alleZeilen ? zeilenRoh : zeilenRoh.filter((k) => k.synced + k.entwurf > 0);

  const { max, ticks } = achse(Math.max(...zeilen.map((z) => z.synced + z.entwurf)));

  // Mindestens 2px fuer jeden Wert > 0 - sonst rundet ein sehr kleiner Anteil
  // (z. B. 5 Minuten bei einer Achse von mehreren Stunden) auf 0px und das
  // Segment verschwindet optisch, obwohl Daten vorhanden sind.
  const pixelHoehe = (wert) => {
    if (!(wert > 0)) return 0;
    return Math.max(2, Math.round((wert / max) * plotHoehePx));
  };

  const balken = zeilen.map((z) => {
    const syncedPx = pixelHoehe(z.synced);
    const entwurfPx = pixelHoehe(z.entwurf);
    return {
      title: z.title,
      synced: z.synced,
      entwurf: z.entwurf,
      summe: z.synced + z.entwurf,
      syncedPx,
      entwurfPx,
      // Nur das oberste, tatsaechlich sichtbare Segment eines gestapelten
      // Balkens bekommt oben abgerundete Ecken (siehe marks-and-anatomy.md:
      // "4px rounded data-end, square at the baseline") - je nachdem, ob
      // Entwurf-Zeit vorhanden ist, ist das Entwurf oder Synchronisiert.
      obenAbgerundet: entwurfPx > 0 ? 'entwurf' : 'synced',
    };
  });

  // Gitterlinien als fertige Pixel-Position (von der Grundlinie aus), damit
  // die Ansicht nur noch platzieren, nicht mehr rechnen muss.
  const achsenTicks = ticks.map((wert) => ({ wert, bottomPx: Math.round((wert / max) * plotHoehePx) }));

  return { balken, achsenTicks, max, plotHoehePx };
}

module.exports = { nizeMax, achse, balkenDaten };
