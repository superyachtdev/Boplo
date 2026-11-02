/* Feature tour: the section holds still while you scroll through it. Each feature in the list opens in turn,
   a line along its top fills as you go, and its screen wipes down over the last one on the laptop and the phone.
   Click a feature to go straight to it. With reduced motion the section scrolls normally and the list just switches. */
(() => {
  const root = document.querySelector('[data-tour]'); if (!root) return;
  const rows = [...root.querySelectorAll('.tour-rows li')], pin = root.querySelector('.tour-pin');
  const lap = root.querySelector('[data-lap]'), phn = root.querySelector('[data-phn]'), credit = root.querySelector('[data-credit]');
  if (!rows.length || !lap || !phn) return;
  const N = rows.length, keys = rows.map(r => r.dataset.k);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  root.style.setProperty('--steps', N - 1);

  // the screens, stacked in order; later ones sit on top and wipe in over earlier ones
  const img = (src, n) => { const i = new Image(); i.className = 'shot'; i.alt = ''; i.decoding = 'async'; if (n > 1) i.loading = 'lazy'; i.src = src; i.style.zIndex = n + 1; return i; };
  const scans = [lap.querySelector('.scan'), phn.querySelector('.scan')];
  const shots = keys.map((k, n) => {
    const a = img(`/assets/tour/${k}-d.webp?v=2`, n), b = img(`/assets/tour/${k}-m.webp?v=2`, n);
    if (k === 'sim') b.classList.add('full');
    lap.insertBefore(a, scans[0]); phn.insertBefore(b, scans[1]);
    return [a, b];
  });

  // load every screen as the section approaches, so a fast scroll never wipes onto a blank
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); shots.flat().forEach(s => { s.loading = 'eager'; }); } }, { rootMargin: '150% 0px' }); io.observe(pin); }

  // phones: a segmented bar above the current feature
  const segs = document.createElement('div'); segs.className = 'tour-segs'; segs.setAttribute('aria-hidden', 'true');
  rows.forEach(() => segs.append(document.createElement('i')));
  root.querySelector('.tour-rows').before(segs);

  let cur = -1;
  const setActive = i => {
    if (i === cur) return; cur = i;
    rows.forEach((r, n) => { r.classList.toggle('on', n === i); r.querySelector('button').setAttribute('aria-current', n === i ? 'step' : 'false'); });
    credit?.classList.toggle('on', keys[i] === 'sim');
    // warm the next screens so a wipe never shows a blank
    shots[i + 1]?.forEach(s => { s.loading = 'eager'; });
    document.documentElement.classList.toggle('tour-sim', keys[i] === 'sim');
  };

  // p runs from 0 to N-1 across the scroll; screen n wipes in over the last stretch before it becomes current
  const render = p => {
    const a = clamp(Math.floor(p + .3), 0, N - 1);
    setActive(a);
    shots.forEach((pair, n) => {
      const r = n === 0 ? 1 : ease(clamp((p - (n - 1) - .55) / .45));
      const next = n + 1 < N ? ease(clamp((p - n - .55) / .45)) : 0; // how far the screen above has covered this one
      const clip = r >= 1 ? 'inset(0)' : `inset(0 0 ${((1 - r) * 100).toFixed(2)}% 0)`;
      const tf = `translateY(${(-(next) * 2.5 + (1 - r) * 2.5).toFixed(2)}%) scale(${(1 + (1 - r) * .06 + next * .02).toFixed(4)})`;
      pair.forEach(s => { s.style.clipPath = clip; s.style.transform = tf; s.style.visibility = r <= 0 ? 'hidden' : 'visible'; });
    });
    // the bright line rides the edge of whichever wipe is happening
    let edge = -1; for (let n = 1; n < N; n++) { const r = ease(clamp((p - (n - 1) - .55) / .45)); if (r > 0 && r < 1) edge = r; }
    scans.forEach(s => { s.style.opacity = edge < 0 ? 0 : Math.sin(edge * Math.PI).toFixed(3); s.style.top = edge < 0 ? '0' : (edge * 100).toFixed(2) + '%'; });
    // the current row's line fills across its stretch; the phone segments fill behind it
    rows.forEach((r, n) => r.querySelector('.bar').style.setProperty('--p', n === a ? clamp(p - n + .3).toFixed(3) : 0));
    [...segs.children].forEach((s, n) => s.style.setProperty('--p', clamp(p - n + .3).toFixed(3)));
  };

  const span = () => Math.max(1, pin.offsetHeight - innerHeight);
  const goTo = i => {
    if (reduce || root.classList.contains('static')) { render(i); return; }
    const target = pin.getBoundingClientRect().top + scrollY + clamp((i + .02) / (N - .4)) * span();
    if (window.__lenis) window.__lenis.scrollTo(target, { duration: 1.2 }); else scrollTo({ top: target, behavior: 'smooth' });
  };
  rows.forEach((r, n) => r.querySelector('button').addEventListener('click', () => goTo(n)));

  // keep the floating radio button and bottom bar out of the way while the tour fills the screen on a phone
  if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => document.documentElement.classList.toggle('tour-in', e.isIntersecting)), { rootMargin: '-45% 0px -45% 0px' }).observe(pin);

  if (reduce) { root.classList.add('static'); render(0); return; }
  let ticking = false;
  const update = () => { ticking = false; const t = clamp(-pin.getBoundingClientRect().top / span()); render(Math.min(N - 1, t * (N - .4))); };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  render(0); update();
})();
