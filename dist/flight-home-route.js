/* Boplo Flight landing: a logged cross-country, drawn as you scroll.
   Example flight around San Diego. Positions are projected from real coordinates; the map is simplified.
   With reduced motion (or before this runs) the section shows the whole flight, logged. */
(() => {
  'use strict';
  const sec = document.querySelector('[data-route]');
  if (!sec) return;
  const $ = s => sec.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.append(e); return e; };

  // waypoint: ident, name, x, y, altitude there (ft), label side
  const W = [
    { id: 'KSEE', name: 'Gillespie Field', x: 375.4, y: 393.8, alt: 388, side: 'l' },
    { id: '', name: 'San Vicente', x: 415.1, y: 305.0, alt: 3500, side: 'r' },
    { id: 'KRNM', name: 'Ramona', x: 423.2, y: 180.8, alt: 1395, side: 'bl' },
    { id: '', name: 'Lake Hodges', x: 251.6, y: 160.0, alt: 4500, side: 'tr' },
    { id: 'KCRQ', name: 'McClellan-Palomar', x: 117.2, y: 91.7, alt: 331, side: 'r' },
    { id: '', name: 'Lake Poway', x: 347.2, y: 241.0, alt: 3500, side: 'l' },
    { id: 'KSEE', name: 'Gillespie Field', x: 375.4, y: 393.8, alt: 388, side: 'r' }
  ];
  const CRUISE = [3500, 3500, 4500, 4500, 3500, 3500];
  const CLOCK = 54; // minutes, block to block

  const svg = $('[data-rt-svg]'), track = $('[data-rt-track]'), plan = $('[data-rt-plan]'), craft = $('[data-rt-craft]');
  const hud = $('[data-rt-hud]'), nm = $('[data-rt-name]'), legEl = $('[data-rt-leg]'), clock = $('[data-rt-clock]');
  const altEl = $('[data-rt-alt]'), hdgEl = $('[data-rt-hdg]'), gsEl = $('[data-rt-gs]'), bar = $('[data-rt-bar]');

  // faint chart grid
  const grid = $('[data-rt-grid]');
  for (let x = 0; x <= 500; x += 50) el('line', { x1: x, y1: 0, x2: x, y2: 520 }, grid);
  for (let y = 0; y <= 520; y += 52) el('line', { x1: 0, y1: y, x2: 500, y2: y }, grid);

  // the planned route (straight legs) and the flown track (a little wander, like a real GPS trace)
  plan.setAttribute('d', 'M' + W.map(p => p.x + ' ' + p.y).join(' L'));
  const pts = [[W[0].x, W[0].y]], legAt = [0];
  for (let i = 1; i < W.length; i++) {
    const a = W[i - 1], b = W[i], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, n = Math.max(6, Math.round(len / 14));
    for (let k = 1; k <= n; k++) {
      const t = k / n, w = k === n ? 0 : Math.sin(t * Math.PI) * (Math.sin(i * 2.1 + t * 7.3) * 3.2 + Math.sin(t * 19 + i) * 1.1);
      pts.push([a.x + dx * t + nx * w, a.y + dy * t + ny * w]);
    }
    legAt.push(pts.length - 1);
  }
  track.setAttribute('d', 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L'));
  track.removeAttribute('pathLength');
  const total = track.getTotalLength();
  track.setAttribute('pathLength', '1');
  // where each waypoint sits along the track (0..1)
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const along = legAt.map(i => cum[i] / cum[cum.length - 1]);

  // waypoints and labels (the home field once)
  const ptsG = $('[data-rt-pts]'), dots = [];
  W.forEach((p, i) => {
    if (i === W.length - 1) { dots.push(dots[0]); return; }
    const g = el('g', { class: 'rt-pt' + (p.id ? ' apt' : '') }, ptsG);
    el('circle', { cx: p.x, cy: p.y, r: p.id ? 6 : 4.5 }, g);
    const off = { r: [12, 4, 'start'], l: [-12, 4, 'end'], t: [0, -13, 'middle'], tr: [6, -11, 'start'], bl: [-8, 20, 'end'] }[p.side];
    const t = el('text', { x: p.x + off[0], y: p.y + off[1], 'text-anchor': off[2] }, g);
    if (p.id) { const b = el('tspan', { class: 'id' }, t); b.textContent = p.id + ' '; }
    t.append(p.name);
    dots.push(g);
  });

  const label = p => (p.id ? p.id + ' ' : '') + p.name;
  const headings = W.slice(1).map((b, i) => { const a = W[i]; return (Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI + 360) % 360; });
  const fmtAlt = v => Math.round(v / 10) * 10 >= 1000 ? (Math.round(v / 10) * 10).toLocaleString('en-US') + ' ft' : Math.round(v) + ' ft';
  const fmtH = h => String(Math.round(h) % 360 || 360).padStart(3, '0') + '°';
  const fmtClock = m => Math.floor(m / 60) + ':' + String(Math.floor(m % 60)).padStart(2, '0');

  // the name decodes like a GPS working out the next fix
  let scr = 0, shown = '';
  const CH = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%';
  const decode = text => {
    if (text === shown) return; shown = text; cancelAnimationFrame(scr);
    if (reduce) { nm.textContent = text; return; }
    const t0 = performance.now(), dur = 520;
    const step = now => {
      const k = clamp((now - t0) / dur), fixed = Math.floor(k * text.length);
      nm.textContent = text.slice(0, fixed) + text.slice(fixed).replace(/\S/g, () => CH[Math.random() * CH.length | 0]);
      if (k < 1) scr = requestAnimationFrame(step); else nm.textContent = text;
    };
    scr = requestAnimationFrame(step);
  };

  const render = d => {
    d = clamp(d);
    track.style.strokeDashoffset = (1 - d).toFixed(4);
    bar.style.setProperty('--p', d.toFixed(4));
    // where along the route
    let leg = 0; while (leg < W.length - 2 && d > along[leg + 1]) leg++;
    const lt = clamp((d - along[leg]) / Math.max(1e-6, along[leg + 1] - along[leg]));
    // aircraft at the tip, pointing along the track
    const L = d * total, a = track.getPointAtLength(Math.max(0, L - 1.5)), b = track.getPointAtLength(Math.min(total, L + 1.5));
    const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90;
    const tip = track.getPointAtLength(L);
    craft.setAttribute('transform', `translate(${tip.x.toFixed(1)} ${tip.y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
    craft.style.opacity = d > .995 ? 0 : 1;
    // passed waypoints light up
    dots.forEach((g, i) => { if (i < W.length - 1) g.classList.toggle('on', i === 0 || d >= along[i] - .002); });
    dots.forEach(g => g && g.classList.remove('now'));
    const nowIdx = lt < .12 ? leg : leg + 1; const nowDot = dots[nowIdx === W.length - 1 ? 0 : nowIdx];
    if (nowDot && d < .995) nowDot.classList.add('now');
    // readout
    const done = d > .995;
    hud.classList.toggle('done', done);
    if (done) { decode('Saved to your logbook'); legEl.textContent = 'Flight logged'; clock.textContent = fmtClock(CLOCK); return; }
    legEl.textContent = `Leg ${leg + 1} of ${W.length - 1}`;
    decode(label(lt < .12 && leg > 0 ? W[leg] : W[leg + 1]));
    const from = W[leg].alt, to = W[leg + 1].alt, cr = CRUISE[leg];
    const alt = lt < .3 ? from + (cr - from) * (lt / .3) : lt > .7 ? cr + (to - cr) * ((lt - .7) / .3) : cr;
    altEl.textContent = fmtAlt(alt);
    hdgEl.textContent = fmtH(headings[leg]);
    const gs = (leg === 0 && lt < .05) ? lt / .05 * 60 : (leg === W.length - 2 && lt > .96) ? (1 - lt) / .04 * 60 : 95 - (W[leg].id && lt < .15 ? (1 - lt / .15) * 30 : 0) - (W[leg + 1].id && lt > .85 ? ((lt - .85) / .15) * 30 : 0);
    gsEl.textContent = Math.max(0, Math.round(gs)) + ' kt';
    clock.textContent = fmtClock(d * CLOCK);
  };

  // reduced motion: the whole flight, logged, no pinning
  if (reduce) { sec.classList.add('static'); render(1); return; }

  let ticking = false, last = -1;
  const update = () => {
    ticking = false;
    const r = sec.getBoundingClientRect(), span = Math.max(1, r.height - innerHeight);
    const p = clamp(-r.top / span);
    const d = clamp((p - .06) / .84);
    if (Math.abs(d - last) < .0004) return; last = d;
    render(d);
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  render(0); update();
})();
