/* Boplo Flight landing: audience tabs (arrow keys move between them, as a tablist should) */
(() => {
  const root = document.querySelector('[data-aud]'); if (!root) return;
  const tabs = [...root.querySelectorAll('[role=tab]')], panels = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));
  const pick = (i, focus) => {
    tabs.forEach((t, j) => { const on = i === j; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; panels[j].hidden = !on; panels[j].classList.toggle('in', on); });
    if (focus) tabs[i].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(i));
    t.addEventListener('keydown', e => { const k = e.key; if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); pick((i + (k === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length, true); } else if (k === 'Home') { e.preventDefault(); pick(0, true); } else if (k === 'End') { e.preventDefault(); pick(tabs.length - 1, true); } });
  });
})();
