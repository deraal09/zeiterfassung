document.addEventListener('DOMContentLoaded', () => {
  const els = document.querySelectorAll('.live-timer');
  if (!els.length) return;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function tick() {
    els.forEach((el) => {
      const start = new Date(el.dataset.start.replace(' ', 'T'));
      const diff = Math.max(0, Date.now() - start.getTime());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    });
  }

  tick();
  setInterval(tick, 1000);
});
