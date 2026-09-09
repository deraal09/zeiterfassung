// Ersetzt die frueheren Inline-Handler (onchange/onsubmit). Die
// Content-Security-Policy erlaubt kein Skript im HTML-Attribut - was
// erwuenscht ist: genau diese Luecke wuerde eine XSS-Stelle ausnutzen.
document.addEventListener('DOMContentLoaded', () => {
  // Felder, die ihre Aenderung sofort speichern. Teilt sich ein Formular
  // mehrere solcher Felder (z. B. Datum UND Uhrzeit eines Eintrags), wuerde
  // ein sofortiges Speichern nach dem ERSTEN geaenderten Feld einen
  // Zwischenstand pruefen, der fuer sich allein ungueltig sein kann (z. B.
  // neue Uhrzeit, aber noch altes Datum -> "Ende vor Beginn"), obwohl das
  // Ergebnis nach der zweiten Aenderung gueltig waere - die Seite laedt dann
  // mit dem alten, unveraenderten Wert neu und die erste Aenderung wirkt wie
  // verschluckt. Deshalb wird bei mehreren Feldern erst gespeichert, wenn
  // keines davon mehr den Fokus hat (Feldwechsel per Tab bleibt in der
  // Gruppe, ein Formular mit nur einem Feld speichert weiterhin sofort).
  const gruppen = new Map();
  document.querySelectorAll('[data-submit-on-change]').forEach((el) => {
    if (!el.form) return;
    if (!gruppen.has(el.form)) gruppen.set(el.form, []);
    gruppen.get(el.form).push(el);
  });
  gruppen.forEach((elemente, form) => {
    if (elemente.length === 1) {
      elemente[0].addEventListener('change', () => form.submit());
      return;
    }

    // "change" kann bei Datum-/Uhrzeit-Feldern schon feuern, WAEHREND das
    // Feld noch den Fokus haelt (z. B. sobald alle Ziffern eines
    // Datumssegments eingegeben sind) - ein einmaliger Check direkt im
    // change-Handler wuerde diesen Fall verpassen und nie mehr speichern.
    // pending merkt sich daher eine noch offene Aenderung, die sowohl vom
    // naechsten change als auch vom naechsten focusout (Feld verlassen)
    // erneut geprueft wird.
    let pending = false;
    const versucheSpeichern = () => {
      if (!pending) return;
      if (elemente.includes(document.activeElement)) return;
      pending = false;
      form.submit();
    };
    elemente.forEach((el) => {
      el.addEventListener('change', () => {
        pending = true;
        versucheSpeichern();
      });
      // Fokus-Wechsel passiert synchron vor dem naechsten Task - ein
      // setTimeout(0) wartet genau darauf, statt sich auf relatedTarget zu
      // verlassen (fehlt z. B. bei einem Klick auf ein Element ohne
      // tabindex).
      el.addEventListener('focusout', () => setTimeout(versucheSpeichern, 0));
    });
  });

  // Formulare, die vor dem Absenden rueckfragen.
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
});
