// Der Referer bestimmt nach manchen Aktionen nur, auf welche Seite der
// Anwendung zurueckgesprungen wird. Ungeprueft uebernommen wuerde daraus ein
// Open Redirect: ein praeparierter Link leitet nach dem Absenden auf eine
// fremde Seite weiter - eine gute Grundlage fuer eine nachgebaute
// Anmeldemaske, die von der echten Adresse aus verlinkt wurde.
//
// Statt eine Herkunft zu erlauben und alle anderen zu sperren, wird der
// Origin grundsaetzlich verworfen und nur der Pfad uebernommen. Damit zeigt
// das Ziel immer in diese Anwendung - unabhaengig davon, was im Referer
// steht. Browser senden ihn absolut ("https://server/categories/1"), was so
// weiterhin auf der richtigen Seite landet.
function interneZielseite(referer) {
  if (!referer) return '/';
  try {
    // Die Basis dient nur zum Parsen und wird nie mit ausgegeben.
    const url = new URL(String(referer), 'http://interne-basis');
    // Ein Pfad, der nicht mit einem einzelnen "/" beginnt, ist entweder kein
    // Pfad (etwa bei "javascript:") oder protokollrelativ ("//fremde.seite")
    // und damit wieder eine fremde Adresse.
    if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return '/';
    return `${url.pathname}${url.search}`;
  } catch (err) {
    return '/';
  }
}

module.exports = { interneZielseite };
