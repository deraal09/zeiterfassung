document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('assign-username');
  if (!input) return;

  const resultsBox = document.getElementById('ldap-results');
  const displayNameField = document.getElementById('assign-displayName');
  const emailField = document.getElementById('assign-email');
  const selected = document.getElementById('assign-selected');
  let debounce = null;

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    // Freie Eingabe hebt eine vorherige Suchauswahl auf, damit nicht
    // versehentlich der Anzeigename/die E-Mail eines anderen Treffers
    // an den nun eingetippten Benutzernamen haengen bleibt.
    displayNameField.value = '';
    emailField.value = '';
    selected.textContent = '';

    const q = input.value.trim();
    resultsBox.innerHTML = '';
    if (q.length < 2) return;

    debounce = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/ldap-search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        resultsBox.innerHTML = '';
        if (!Array.isArray(data) || data.length === 0) return;
        data.forEach((u) => {
          const div = document.createElement('div');
          div.className = 'autocomplete-item';
          div.textContent = `${u.displayName} (${u.username})`;
          div.addEventListener('click', () => {
            input.value = u.username;
            displayNameField.value = u.displayName;
            emailField.value = u.email || '';
            selected.textContent = `Aus LDAP übernommen: ${u.displayName} (${u.username})`;
            resultsBox.innerHTML = '';
          });
          resultsBox.appendChild(div);
        });
      } catch (err) {
        // LDAP-Suche ist nur eine Komfortfunktion - bei Fehlern einfach
        // keine Treffer anzeigen, der Benutzername kann weiterhin direkt
        // eingetippt werden.
      }
    }, 250);
  });
});
