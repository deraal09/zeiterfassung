// Ersetzt die frueheren Inline-Handler (onchange/onsubmit). Die
// Content-Security-Policy erlaubt kein Skript im HTML-Attribut - was
// erwuenscht ist: genau diese Luecke wuerde eine XSS-Stelle ausnutzen.
document.addEventListener('DOMContentLoaded', () => {
  // Kontrollkästchen, die ihre Auswahl sofort speichern.
  document.querySelectorAll('[data-submit-on-change]').forEach((el) => {
    el.addEventListener('change', () => el.form && el.form.submit());
  });

  // Formulare, die vor dem Absenden rueckfragen.
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
});
