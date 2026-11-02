/* Boplo Flight landing: the airfield counts tick up when they come into view.
   The real figures are in the HTML, so with no script or reduced motion the page simply shows them. */
(() => {
  'use strict';
  const sec = document.querySelector('[data-nums]');
  if (!sec || matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const ease = t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // fast start, long settle, like an odometer
  const run = (el, delay) => {
    const to = +el.dataset.count, dur = to > 1000 ? 2200 : 1100;
    el.setAttribute('aria-label', fmt(to));
    // keep the width steady while it counts: measure the final figure (same frame, never painted)
    if (getComputedStyle(el).display.startsWith('inline')) { el.textContent = fmt(to); el.style.minWidth = Math.ceil(el.getBoundingClientRect().width) + 'px'; el.textContent = '0'; }
    setTimeout(() => {
      const t0 = performance.now();
      const step = now => { const k = Math.min(1, (now - t0) / dur); el.textContent = fmt(to * ease(k)); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }, delay);
  };
  const els = [...sec.querySelectorAll('[data-count]')];
  els.forEach(el => { el.textContent = '0'; });
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    run(e.target, e.target.closest('.nums-cards') ? [...e.target.closest('.nums-cards').children].indexOf(e.target.parentElement) * 140 : 0);
  }), { threshold: .5 });
  els.forEach(el => io.observe(el));
})();
