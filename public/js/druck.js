document.addEventListener('DOMContentLoaded', () => {
  const knopf = document.getElementById('drucken');
  if (knopf) knopf.addEventListener('click', () => window.print());
});
