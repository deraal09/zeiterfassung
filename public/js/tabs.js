document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-tabs]').forEach((container) => {
    // Nur Buttons/Panels, die zu DIESEM Register gehoeren, nicht die eines
    // verschachtelten [data-tabs] darin - sonst wuerde ein Klick im aeusseren
    // Register auch das innere mit umschalten (querySelectorAll findet
    // Nachfahren in jeder Tiefe).
    const buttons = Array.from(container.querySelectorAll('[data-tab-target]')).filter(
      (btn) => btn.closest('[data-tabs]') === container
    );
    const panels = Array.from(container.querySelectorAll('[data-tab-panel]')).filter(
      (panel) => panel.closest('[data-tabs]') === container
    );

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.tabTarget;
        panels.forEach((panel) => { panel.hidden = panel.id !== targetId; });
        buttons.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
  });
});
