document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('ldap-search');
  if (!input) return;

  const resultsBox = document.getElementById('ldap-results');
  const usernameField = document.getElementById('assign-username');
  const displayNameField = document.getElementById('assign-displayName');
  const emailField = document.getElementById('assign-email');
  const selected = document.getElementById('assign-selected');
  let debounce = null;

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    resultsBox.innerHTML = '';
    if (q.length < 2) return;

    debounce = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/ldap-search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        resultsBox.innerHTML = '';
        if (!Array.isArray(data) || data.length === 0) {
          resultsBox.innerHTML = '<div class="autocomplete-item">Keine Treffer</div>';
          return;
        }
        data.forEach((u) => {
          const div = document.createElement('div');
          div.className = 'autocomplete-item';
          div.textContent = `${u.displayName} (${u.username})`;
          div.addEventListener('click', () => {
            usernameField.value = u.username;
            displayNameField.value = u.displayName;
            emailField.value = u.email || '';
            selected.textContent = `Ausgewählt: ${u.displayName} (${u.username})`;
            input.value = '';
            resultsBox.innerHTML = '';
          });
          resultsBox.appendChild(div);
        });
      } catch (err) {
        resultsBox.innerHTML = '<div class="autocomplete-item">Fehler bei der Suche</div>';
      }
    }, 250);
  });

  const form = document.getElementById('assign-form');
  form.addEventListener('submit', (e) => {
    if (!usernameField.value) {
      e.preventDefault();
      alert('Bitte zuerst eine Lehrkraft aus der Suche auswählen.');
    }
  });
});
