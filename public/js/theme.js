document.addEventListener('DOMContentLoaded', () => {
  const toggles = document.querySelectorAll('[data-theme-toggle]');
  if (!toggles.length) return;

  function currentPreference() {
    try {
      const stored = localStorage.getItem('theme');
      return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function applyPreference(pref) {
    if (pref === 'light' || pref === 'dark') {
      document.documentElement.setAttribute('data-theme', pref);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      if (pref === 'system') {
        localStorage.removeItem('theme');
      } else {
        localStorage.setItem('theme', pref);
      }
    } catch (e) {}
  }

  function updateActiveButtons() {
    const pref = currentPreference();
    toggles.forEach((toggle) => {
      toggle.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.themeValue === pref);
      });
    });
  }

  toggles.forEach((toggle) => {
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-theme-value]');
      if (!btn) return;
      applyPreference(btn.dataset.themeValue);
      updateActiveButtons();
    });
  });

  updateActiveButtons();
});
