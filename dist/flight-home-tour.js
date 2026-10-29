/* Feature tour: as each feature scrolls into the middle of the screen, the laptop and phone switch to it. */
(() => {
  const root = document.querySelector('[data-tour]'); if (!root) return;
  const steps = [...root.querySelectorAll('.tour-step')], lap = root.querySelector('[data-lap]'), phn = root.querySelector('[data-phn]'), credit = root.querySelector('[data-credit]');
  if (!lap || !phn) return;
  const keys = steps.map(s => s.dataset.k), shots = {};
  const img = (src, eager) => { const i = new Image(); i.className = 'shot'; i.alt = ''; i.decoding = 'async'; if (!eager) i.loading = 'lazy'; i.src = src; return i; };
  keys.forEach((k, n) => { const a = img(`/assets/tour/${k}-d.webp`, !n), b = img(`/assets/tour/${k}-m.webp`, !n); if (k === 'sim') b.classList.add('full'); lap.append(a); phn.append(b); shots[k] = [a, b]; });
  // dots let you jump between features without scrolling the whole list
  const dots = document.createElement('div'); dots.className = 'tour-dots'; dots.setAttribute('role', 'group'); dots.setAttribute('aria-label', 'Features');
  steps.forEach((s, n) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', s.querySelector('h3').textContent); b.onclick = () => s.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); dots.append(b); });
  root.querySelector('.stage').append(dots);
  let cur = null;
  const show = k => {
    if (k === cur) return; cur = k;
    keys.forEach((x, n) => { shots[x].forEach(i => i.classList.toggle('on', x === k)); steps[n].classList.toggle('on', x === k); dots.children[n].setAttribute('aria-current', String(x === k)); });
    credit.classList.toggle('on', k === 'sim');
    // warm the next pair so the switch never shows a blank screen
    const nx = keys[keys.indexOf(k) + 1]; if (nx) shots[nx].forEach(i => { i.loading = 'eager'; });
  };
  show(keys[0]);
  // phones: the cards swipe sideways; dots follow the card in view and jump to one when tapped
  const list = root.querySelector('.tour-steps');
  const pager = document.createElement('div'); pager.className = 'tour-pager'; pager.setAttribute('role', 'group'); pager.setAttribute('aria-label', 'Features');
  steps.forEach((s, n) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', s.querySelector('h3').textContent); b.onclick = () => list.scrollTo({ left: s.offsetLeft - list.offsetLeft - (list.clientWidth - s.clientWidth) / 2, behavior: 'smooth' }); pager.append(b); });
  const hint = document.createElement('p'); hint.className = 'tour-swipe'; hint.textContent = 'Swipe to see more';
  list.after(pager, hint);
  const mark = () => { const mid = list.scrollLeft + list.clientWidth / 2; let best = 0, bd = 1e9; steps.forEach((s, n) => { const d = Math.abs(s.offsetLeft - list.offsetLeft + s.clientWidth / 2 - mid); if (d < bd) { bd = d; best = n; } }); [...pager.children].forEach((b, n) => b.setAttribute('aria-current', String(n === best))); if (best) hint.style.visibility = 'hidden'; };
  list.addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true }); mark();
  // keep the floating radio button and bottom bar out of the way while someone reads the cards
  if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => document.documentElement.classList.toggle('tour-in', e.isIntersecting)), { rootMargin: '-20% 0px -20% 0px' }).observe(list);
  if (matchMedia('(max-width: 900px)').matches) return;
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(es => { es.forEach(e => { if (e.isIntersecting) show(e.target.dataset.k); }); }, { rootMargin: matchMedia('(max-width: 900px)').matches ? '-62% 0px -26% 0px' : '-45% 0px -45% 0px' });
  steps.forEach(s => io.observe(s));
})();
