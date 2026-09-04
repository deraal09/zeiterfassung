document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-tabs]').forEach((container) => {
    const buttons = container.querySelectorAll('[data-tab-target]');
    const panels = container.querySelectorAll('[data-tab-panel]');

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.tabTarget;
        panels.forEach((panel) => { panel.hidden = panel.id !== targetId; });
        buttons.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
  });
});
