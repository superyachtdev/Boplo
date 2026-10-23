/* Boplo Flight landing: interaction layer.
   Everything here answers the visitor (scrolling, pointing, choosing) or shows the product doing its job.
   It only adds to the page: with JS off or reduced motion on, the page reads exactly as before. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, fine = matchMedia('(pointer: fine)').matches;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const once = (el, fn, threshold = .45) => {
    if (!el) return;
    if (reduce || !('IntersectionObserver' in window)) return fn(true);
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.disconnect(); fn(false); } }), { threshold });
    io.observe(el);
  };
  const glide = (y) => { if (window.__lenis) window.__lenis.scrollTo(y, { duration: 1.6 }); else scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' }); };
  const scrollTasks = [];
  let ticking = false;
  const onScroll = () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; scrollTasks.forEach(f => f()); }); };
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll, { passive: true });

  /* ---- nav: a flight-progress line and the section you're in ---- */
  const nav = $('[data-nav]');
  if (nav) {
    const bar = document.createElement('span'); bar.className = 'nav-prog'; bar.setAttribute('aria-hidden', 'true'); bar.innerHTML = '<i></i>';
    nav.append(bar);
    const links = $$('.nav-links a[href^="#"]').map(a => ({ a, sec: $(a.getAttribute('href')) })).filter(x => x.sec);
    scrollTasks.push(() => {
      const max = document.documentElement.scrollHeight - innerHeight, p = max > 0 ? clamp(scrollY / max) : 0;
      bar.style.setProperty('--p', p.toFixed(4));
      const mid = innerHeight * .4; let cur = null;
      for (const l of links) { const r = l.sec.getBoundingClientRect(); if (r.top < mid && r.bottom > mid) cur = l; }
      links.forEach(l => { l.a.classList.toggle('is-here', l === cur); if (l === cur) l.a.setAttribute('aria-current', 'true'); else l.a.removeAttribute('aria-current'); });
    });
  }

  /* ---- hero: the example lesson is long; offer a way past it ---- */
  const flight = $('[data-flight]'), frame = $('.frame', flight || document), next = $('.statement');
  if (flight && frame && next && !document.documentElement.classList.contains('static')) {
    const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'skip-flight'; skip.textContent = 'Skip the flight';
    skip.onclick = () => glide(next.getBoundingClientRect().top + scrollY - 40);
    frame.append(skip);
    scrollTasks.push(() => { const r = flight.getBoundingClientRect(), p = -r.top / Math.max(1, r.height - innerHeight); skip.classList.toggle('on', p > .04 && p < .9); });
    const hint = $('.scroll-hint');
    if (hint) { hint.setAttribute('role', 'button'); hint.tabIndex = 0; const go = () => glide(innerHeight * .9); hint.onclick = go; hint.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; }
  }

  /* ---- statement: the words light up as you read; Boplo's half ends brighter than the problem ---- */
  const stmt = $('.statement p');
  if (stmt && !reduce) {
    const words = [];
    const wrap = (node, bright) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(t => { if (!t) return; if (/^\s+$/.test(t)) { frag.append(t); return; } const w = document.createElement('span'); w.className = 'w'; w.textContent = t; w.dataset.b = bright ? '1' : '0'; words.push(w); frag.append(w); });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) wrap(n, bright || n.tagName === 'SPAN');
      }
    };
    wrap(stmt, false);
    stmt.classList.add('lit');
    scrollTasks.push(() => {
      const r = stmt.getBoundingClientRect(), p = clamp((innerHeight * .88 - r.top) / (r.height + innerHeight * .45));
      const n = words.length;
      words.forEach((w, i) => { const k = clamp(p * (n + 6) - i, 0, 1); w.style.setProperty('--k', k.toFixed(3)); });
    });
  }

  /* ---- the desk demo does its job when you reach it ---- */
  // the last preparation item ticks itself
  const prep = $('.ui-prep');
  once(prep, instant => { const li = $$('.checks li', prep).find(l => !l.classList.contains('done')); if (li) setTimeout(() => li.classList.add('done', 'just'), instant ? 0 : 1100); });
  // the licence ring fills and counts
  const ring = $('.ring');
  if (ring) {
    const goal = parseFloat(getComputedStyle(ring).getPropertyValue('--p')) || .52, num = $('b', ring), end = parseFloat(num?.textContent) || 0;
    if (!reduce) { ring.style.setProperty('--p', 0); if (num) num.textContent = '0.0'; }
    once(ring, () => {
      ring.classList.add('go'); ring.style.setProperty('--p', goal);
      if (reduce || !num) { if (num) num.textContent = end.toFixed(1); return; }
      const t0 = performance.now(), D = 1600; const step = now => { const t = clamp((now - t0) / D), e = 1 - Math.pow(1 - t, 3); num.textContent = (end * e).toFixed(1); if (t < 1) requestAnimationFrame(step); }; requestAnimationFrame(step);
    }, .6);
  }
  // the track draws itself, with the aircraft flying it
  const mm = $('[data-minimap]');
  if (mm) {
    const route = $('[data-minimap-route]', mm);
    once(mm, () => {
      if (!route || !route.getTotalLength) return; const L = route.getTotalLength(); if (!L) return;
      if (reduce) return;
      route.style.strokeDasharray = L; route.style.strokeDashoffset = L;
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'g'); dot.setAttribute('class', 'mm-craft');
      dot.innerHTML = '<circle r="9" class="halo"/><circle r="3.6"/>'; mm.append(dot);
      const t0 = performance.now(), D = 3200;
      const step = now => { const t = clamp((now - t0) / D), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, at = route.getPointAtLength(L * e);
        route.style.strokeDashoffset = L * (1 - e); dot.setAttribute('transform', `translate(${at.x} ${at.y})`); if (t < 1) requestAnimationFrame(step); else dot.classList.add('landed'); };
      requestAnimationFrame(step);
    }, .5);
  }
  // hour bars say what they hold, on hover or keyboard focus
  $$('.ui-hours .bars > div').forEach(b => {
    const cs = getComputedStyle(b), d = parseFloat(cs.getPropertyValue('--d')) || 0, s = parseFloat(cs.getPropertyValue('--s')) || 0, m = $('span', b)?.textContent || '';
    const tip = document.createElement('em'); tip.className = 'bar-tip'; tip.textContent = `${(d + s).toFixed(1)} h: ${d.toFixed(1)} dual${s ? `, ${s.toFixed(1)} solo` : ''}`;
    b.append(tip); b.tabIndex = 0; b.setAttribute('aria-label', `${m}: ${tip.textContent}`);
  });

  /* ---- pricing: a sliding toggle and an altimeter-drum price ---- */
  const billing = $('[data-billing]'), plans = $('[data-plans]');
  if (billing && plans) {
    const thumb = document.createElement('span'); thumb.className = 'bill-thumb'; thumb.setAttribute('aria-hidden', 'true'); billing.prepend(thumb); billing.classList.add('has-thumb');
    const place = () => { const b = $('button[aria-pressed="true"]', billing); if (!b) return; thumb.style.width = b.offsetWidth + 'px'; thumb.style.transform = `translateX(${b.offsetLeft - 4}px)`; };
    place(); addEventListener('resize', place); document.fonts?.ready.then(place);
    const price = $('.tier-adv .tier-price');
    const Y = $('[data-price-yearly]', price)?.textContent.trim(), M = $('[data-price-monthly]', price)?.textContent.trim();
    if (price && Y && M) {
      const DIG = '0123456789';
      const drum = document.createElement('strong'); drum.className = 'drum'; drum.setAttribute('aria-live', 'polite');
      const W = Math.max(Y.length, M.length), slots = [];
      for (let i = 0; i < W; i++) { const c = document.createElement('span'); c.className = 'slot'; c.innerHTML = `<span class="reel">${[...DIG, '$', '.', ''].map(ch => `<span>${ch || '&nbsp;'}</span>`).join('')}</span>`; drum.append(c); slots.push(c); }
      const show = (txt, quiet) => {
        const t = txt.padStart(W, ' ');
        drum.setAttribute('aria-label', txt);
        slots.forEach((c, i) => { const ch = t[i], idx = ch === ' ' ? 12 : ch === '$' ? 10 : ch === '.' ? 11 : DIG.indexOf(ch); c.classList.toggle('blank', ch === ' '); c.classList.toggle('narrow', ch === '.'); c.style.setProperty('--i', idx); c.style.transitionDelay = c.firstChild.style.transitionDelay = quiet || reduce ? '0s' : `${(W - i) * 55}ms`; });
      };
      price.prepend(drum); price.classList.add('has-drum'); show(plans.dataset.period === 'monthly' ? M : Y, true);
      billing.addEventListener('click', e => { const b = e.target.closest('button[data-period]'); if (!b) return; show(b.dataset.period === 'monthly' ? M : Y); requestAnimationFrame(place); });
    } else billing.addEventListener('click', () => requestAnimationFrame(place));
  }

  /* ---- questions open and close smoothly ---- */
  if (!reduce) $$('.faq details').forEach(d => {
    const sum = $('summary', d), body = $('p', d); if (!sum || !body) return;
    sum.addEventListener('click', e => {
      e.preventDefault();
      if (d.dataset.anim) return; d.dataset.anim = '1';
      const opening = !d.open, start = d.offsetHeight;
      if (opening) d.open = true;
      const end = opening ? d.scrollHeight : sum.offsetHeight + parseFloat(getComputedStyle(d).borderBottomWidth || 0);
      const a = d.animate([{ height: start + 'px' }, { height: end + 'px' }], { duration: 380, easing: 'cubic-bezier(.2,.7,.1,1)' });
      d.style.overflow = 'hidden';
      a.onfinish = () => { if (!opening) d.open = false; d.style.overflow = ''; delete d.dataset.anim; };
    });
  });

  /* ---- the final card catches a little light from your pointer ---- */
  const card = $('.final-card');
  if (card && fine && !reduce) {
    card.addEventListener('pointermove', e => { const r = card.getBoundingClientRect(); card.style.setProperty('--lx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%'); card.style.setProperty('--ly', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%'); card.classList.add('lit'); });
    card.addEventListener('pointerleave', () => card.classList.remove('lit'));
  }

  /* ---- phones: the way in stays in reach once you're past the hero ---- */
  if (matchMedia('(max-width: 640px)').matches) {
    const dock = document.createElement('div'); dock.className = 'dock'; dock.innerHTML = '<a class="btn btn-light btn-sm" href="/flight-app.html">Open my flight desk <svg class="spark" aria-hidden="true"><use href="#spark"/></svg></a><a class="dock-alt" href="/flight-app.html?preview=1">Example desk</a>';
    document.body.append(dock);
    const fin = $('.final'), foot = $('.footer'), hero = $('[data-flight]');
    scrollTasks.push(() => {
      const past = hero ? hero.getBoundingClientRect().bottom < innerHeight * .6 : scrollY > innerHeight;
      const end = [fin, foot].some(x => x && x.getBoundingClientRect().top < innerHeight - 40);
      dock.classList.toggle('on', past && !end);
    });
  }

  onScroll();
})();
