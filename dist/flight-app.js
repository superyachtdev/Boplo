/* Boplo Flight — flight desk app.
   Talks to /flight/* (Pages Function) and /auth/* (shared identity). No dependencies. */
(() => {
  'use strict';
  const root = document.getElementById('app');
  const sheet = document.getElementById('sheet');
  const toastEl = document.getElementById('toast');
  const preview = new URLSearchParams(location.search).get('preview') === '1';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- helpers ---------------- */
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const ico = (name, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const spark = '<svg class="spark" aria-hidden="true"><use href="#spark"/></svg>';
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => s ? parseISO(s).toLocaleDateString('en-GB', opts) : '';
  const daysUntil = s => Math.round((parseISO(s) - parseISO(todayISO())) / 86400000);
  const hrs = min => (Number(min || 0) / 60).toFixed(1);
  const hm = min => { min = Math.round(Number(min || 0)); return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; };
  const roleName = r => ({ dual: 'Dual', solo: 'Solo', pic: 'PIC' }[r] || r);
  const roleLong = r => ({ dual: 'Dual instruction', solo: 'Solo', pic: 'Pilot in command' }[r] || r);
  const upper = s => String(s || '').trim().toUpperCase();
  const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'pilot';
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);

  let toastTimer;
  function toast(msg) {
    toastEl.innerHTML = `<svg aria-hidden="true"><use href="#spark"/></svg>${esc(msg)}`;
    toastEl.classList.add('on'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 3200);
  }

  async function api(path, method = 'GET', data) {
    const res = await fetch('/flight/' + path, {
      method, credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
    });
    const isJSON = (res.headers.get('Content-Type') || '').includes('application/json');
    const out = isJSON ? await res.json().catch(() => ({})) : {};
    if (!isJSON) throw Object.assign(new Error('The flight desk service isn’t reachable right now. Try again in a minute.'), { status: res.status === 401 ? 401 : 503 });
    if (res.status === 402) { if (sheet.open) sheet.close(); setTimeout(() => upgradeSheet(out.error || 'This is part of Advanced.'), 50); }
    if (!res.ok) throw Object.assign(new Error(out.error || 'Something went wrong. Try again.'), { status: res.status });
    return out;
  }

  /* ---------------- state ---------------- */
  let state = { user: null, profile: null, flights: [], mapsKey: '' };
  const ui = { step: 0, q: '', role: 'all', range: '365', mapSel: null, wxq: '' };

  const PAGES = [
    ['overview', 'Overview', 'overview'],
    ['ask', 'Ask Boplo', 'ask'],
    ['logbook', 'Logbook', 'logbook'],
    ['progress', 'Progress', 'progress'],
    ['budget', 'Budget', 'budget'],
    ['study', 'Study', 'study'],
    ['prepare', 'Prepare', 'prepare'],
    ['navlog', 'Nav log', 'navlog'],
    ['sim', 'Simulator', 'sim'],
    ['weather', 'Weather', 'weather'],
    ['preflight', 'Preflight', 'navlog'],
    ['currency', 'Currency', 'currency'],
    ['radio', 'Radio', 'radio'],
    ['map', 'Map', 'map'],
    ['analytics', 'Analytics', 'analytics'],
    ['community', 'Q&A', 'community'],
    ['leaderboards', 'Leaderboards', 'sim'],
    ['students', 'Students nearby', 'profile']
  ];
  // the sidebar groups pages into hubs; each hub shows its pages as tabs across the top
  const HUBS = [
    ['overview', 'Overview', 'overview', ['overview'], 'Overview'],
    ['ask', 'Ask Boplo', 'ask', ['ask'], 'Ask'],
    ['logbook', 'Logbook', 'logbook', ['logbook', 'map', 'analytics'], 'Logbook'],
    ['training', 'Training', 'study', ['progress', 'budget', 'study', 'prepare', 'radio', 'currency'], 'Training'],
    ['planning', 'Flight planning', 'navlog', ['navlog', 'preflight', 'weather'], 'Planning'],
    ['sim', 'Simulator', 'sim', ['sim'], 'Fly'],
    ['community', 'Community', 'community', ['community', 'leaderboards', 'students'], 'Community']
  ];
  const SUBLABEL = { logbook: 'Flights' };
  const hubOf = id => HUBS.find(h => h[3].includes(id));
  ui.lastSub = ui.lastSub || {};
  const hubHref = h => '#' + (ui.lastSub[h[0]] && h[3].includes(ui.lastSub[h[0]]) ? ui.lastSub[h[0]] : h[3][0]);
  const TABS = HUBS.map(h => h[0]);
  const LEGACY = { today: 'overview', log: 'logbook', lesson: 'prepare', training: 'progress', planning: 'navlog', account: 'more' };
  const current = () => { const h = location.hash.slice(1); const k = LEGACY[h] || h; return [...PAGES.map(p => p[0]), 'profile', 'more', 'plan', 'school'].includes(k) ? k : 'overview'; };

  /* checklist stored as text lines: "[x] item" / "[ ] item" */
  const parseChecks = s => String(s || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^\[( |x)\]\s?(.*)$/i); return m ? { done: m[1].toLowerCase() === 'x', text: m[2] } : { done: false, text: l }; }).filter(c => c.text);
  const writeChecks = list => list.filter(c => c.text.trim()).map(c => `[${c.done ? 'x' : ' '}] ${c.text.trim()}`).join('\n').slice(0, 3000);

  async function saveProfile(patch) {
    const next = { ...state.profile, ...patch };
    if (preview) { state.profile = next; return next; }
    state.profile = (await api('profile', 'PUT', next)).profile;
    return state.profile;
  }

  /* ---------------- decorative contours (same field as the landing) ---------------- */
  function contourSVG(w = 1200, h = 800, seed = 0) {
    const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7 + seed) * 43758.5453; return s - Math.floor(s); };
    const lerp = (a, b, t) => a + (b - a) * t;
    const vn = (x, z) => { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf); return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v); };
    const fbm = (x, z) => { let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++) { s += a * vn(x * f, z * f); f *= 2; a *= .5; } return s; };
    const N = 70, M = Math.round(N * h / w), H = [];
    for (let j = 0; j <= M; j++) { H[j] = []; for (let i = 0; i <= N; i++) H[j][i] = fbm(i / N * 4.2 + 1.3, j / M * 4.2 * h / w + .7); }
    let minor = '', major = '';
    const levels = [.3, .36, .42, .48, .54, .6, .66, .72];
    levels.forEach((L, li) => {
      let d = '';
      for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
        const v = [H[j][i], H[j][i + 1], H[j + 1][i + 1], H[j + 1][i]], c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], e = [];
        for (let k = 0; k < 4; k++) { const a = v[k], b = v[(k + 1) % 4]; if ((a < L) !== (b < L)) { const t = (L - a) / (b - a), p = c[k], q = c[(k + 1) % 4]; e.push([lerp(p[0], q[0], t), lerp(p[1], q[1], t)]); } }
        for (let k = 0; k + 1 < e.length; k += 2) d += `M${(e[k][0] / N * w).toFixed(1)} ${(e[k][1] / M * h).toFixed(1)}L${(e[k + 1][0] / N * w).toFixed(1)} ${(e[k + 1][1] / M * h).toFixed(1)}`;
      }
      if (li % 3 === 2) major += d; else minor += d;
    });
    return `<svg class="contours" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="${minor}"/><path class="major" d="${major}"/></svg>`;
  }
  const CONTOURS = { a: null, b: null };
  const contours = k => CONTOURS[k] || (CONTOURS[k] = contourSVG(k === 'a' ? 1200 : 500, k === 'a' ? 800 : 1000, k === 'a' ? 0 : 3.7));

  const brand = (href = '/') => `<a class="brand" href="${href}" aria-label="Boplo home"><img src="/assets/boplo-wordmark.webp" alt="Boplo" width="520" height="163"><span>Flight</span></a>`;

  /* ---------------- sign in ---------------- */
  function auth(notice = '') {
    document.title = 'Sign in · Boplo Flight';
    root.innerHTML = `<main class="auth"><div class="night">${contours('a')}
      <div class="auth-copy">
        ${brand()}
        <div>
          <h1 class="display">Your flight desk is waiting.</h1>
          <p>Sign in to keep your next lesson, your flights and your hours in one place.</p>
        </div>
        <small>Boplo supports preparation and record keeping. It is not flight instruction or operational approval.</small>
      </div>
      <section class="auth-card" aria-labelledby="auth-title">
        <h2 id="auth-title">Sign in or create your desk</h2>
        <p>New here? Signing in creates your account. It’s free to start.</p>
        <a class="btn btn-google" href="/auth/auth/google">${ico('google')}Continue with Google</a>
        <div class="or">or use your email</div>
        <form data-email novalidate>
          <label for="auth-email">Email address<input id="auth-email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required></label>
          <p class="auth-note" data-note aria-live="polite" style="margin:12px 0">${esc(notice)}</p>
          <button class="btn btn-blue btn-has-spark" type="submit">Email me a sign-in link ${spark}</button>
        </form>
        <p class="auth-legal">By continuing you agree to the <a href="/terms.html">Terms</a> and confirm you’ve read the <a href="/privacy.html">Privacy policy</a>.</p>
        <div class="auth-links"><a href="/flight-app.html?preview=1">Try the example desk</a><a href="/">Back to boplo.app</a></div>
      </section>
    </div></main>`;
    const form = $('[data-email]'), note = $('[data-note]');
    form.onsubmit = async e => {
      e.preventDefault();
      const email = form.email.value.trim(), btn = form.querySelector('button');
      note.className = 'auth-note';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note.textContent = 'Enter a valid email address.'; note.classList.add('err'); form.email.focus(); return; }
      btn.disabled = true; note.textContent = 'Sending your link…';
      try {
        const res = await fetch('/auth/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'We couldn’t send that email. Try again shortly.');
        note.textContent = `Check ${email}. The link opens your desk and expires in 15 minutes.`; note.classList.add('ok');
      } catch (err) { note.textContent = err.message; note.classList.add('err'); btn.disabled = false; }
    };
  }

  function failure(err) {
    root.innerHTML = `<main class="auth"><div class="night">${contours('a')}
      <div class="auth-copy">${brand()}<div><h1 class="display">Your desk didn’t open.</h1><p>${esc(err.message)}</p></div><small></small></div>
      <section class="auth-card"><h2>Try again</h2><p>Your records are safe. This is usually a connection problem.</p>
        <button class="btn btn-blue" data-retry>Reload my desk</button>
        <div class="auth-links"><a href="/flight-app.html?preview=1">Try the example desk</a><a href="/">Back to boplo.app</a></div></section>
    </div></main>`;
    $('[data-retry]').onclick = start;
  }

  /* ---------------- fields ---------------- */
  const input = (label, name, value = '', type = 'text', extra = '', opt = false, hint = '') =>
    `<label class="field${type === 'textarea' ? ' full' : ''}"><span>${label}${opt ? ' <i>(optional)</i>' : ''}</span>${type === 'textarea'
      ? `<textarea name="${name}" maxlength="3000" ${extra}>${esc(value)}</textarea>`
      : `<input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`}${hint ? `<small>${hint}</small>` : ''}</label>`;
  const select = (label, name, options, value) =>
    `<label class="field"><span>${label}</span><select name="${name}">${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`;
  const duration = (label, name, minutes, required = true, hint = '') => {
    const m = Math.round(Number(minutes || 0)), h = minutes === '' || minutes == null ? '' : Math.floor(m / 60), mm = minutes === '' || minutes == null ? '' : m % 60;
    return `<div class="field"><span>${label}</span><div class="duo" data-duration="${name}">
      <label><span class="sr">${label} hours</span><input type="number" inputmode="numeric" min="0" max="${name === 'openingMinutes' ? 10000 : 24}" step="1" value="${h}" data-h ${required ? 'required' : ''}><em>h</em></label>
      <label><span class="sr">${label} minutes</span><input type="number" inputmode="numeric" min="0" max="59" step="1" value="${mm}" data-m><em>min</em></label>
    </div>${hint ? `<small>${hint}</small>` : ''}</div>`;
  };
  const readDuration = (form, name) => { const box = form.querySelector(`[data-duration="${name}"]`); const h = Number(box.querySelector('[data-h]').value || 0), m = Number(box.querySelector('[data-m]').value || 0); return Math.round(h * 60 + m); };

  const AUTHORITIES = ['UK CAA', 'EASA member-state authority', 'FAA', 'Other / deciding'];
  const LICENCES = ['PPL(A)', 'LAPL(A)', 'Next rating', 'Exploring flight training'];
  const FREQ = ['Still deciding', 'Weekly', 'Twice a week', 'Monthly', 'Intensive course'];

  /* ---------------- countries, authorities, licences ---------------- */
  const R = window.BOPLO_RULES;
  const REGIME_ORDER = ['uk', 'easa', 'faa', 'tc', 'casa', 'nz', 'icao'];
  const countryCodeOf = p => p.countryCode || R.codeForName(p.country);
  // Airfield search boxes: our own suggestion list instead of the browser's datalist popup, which is unreliable
  // (Safari, the desktop app's web view, long lists). Any <input list="..."> becomes one when focused.
  (() => {
    let box = null, cur = null, items = [], hi = -1;
    const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const opts = inp => { const dl = inp.dataset.combo && document.getElementById(inp.dataset.combo); return dl ? [...dl.options].filter(o => o.value).map(o => { const lab = (o.label && o.label !== o.value ? o.label : o.textContent || '').trim(), [c, ...rest] = o.value.split(' · '); return { v: o.value, c, t: lab || rest.join(' · '), n: norm(o.value + ' ' + lab) }; }) : []; };
    const close = () => { if (box) box.hidden = true; cur = null; hi = -1; };
    const place = inp => {
      if (!box) return; const host = inp.closest('dialog') || document.body; if (box.parentNode !== host) host.append(box);
      const r = inp.getBoundingClientRect(), below = innerHeight - r.bottom, up = below < 200 && r.top > below, w = Math.min(innerWidth - 16, Math.max(r.width, 280));
      box.style.width = w + 'px'; box.style.maxHeight = Math.max(140, Math.min(320, (up ? r.top : below) - 14)) + 'px'; box.style.left = '0px'; box.style.top = '0px';
      // a transformed sheet makes position:fixed relative to it, so measure where (0,0) lands and correct
      const o = box.getBoundingClientRect(), h = o.height, L = Math.max(8, Math.min(r.left, innerWidth - w - 8)), T = up ? r.top - 4 - h : r.bottom + 4;
      box.style.left = (L - o.left) + 'px'; box.style.top = (T - o.top) + 'px';
    };
    const paintHi = () => { box.querySelectorAll('[data-i]').forEach(b => b.classList.toggle('on', +b.dataset.i === hi)); box.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); };
    function render(inp) {
      const q = norm(inp.value.trim().split(' · ')[0]), all = opts(inp), first = [], rest = [];
      for (const o of all) { if (!q || norm(o.c).startsWith(q)) first.push(o); else if (o.n.includes(q)) rest.push(o); if (first.length >= 60) break; }
      items = [...first, ...rest].slice(0, 60);
      if (!box) { box = document.createElement('div'); box.className = 'combo-list'; box.setAttribute('role', 'listbox'); document.body.append(box); box.addEventListener('pointerdown', e => { const b = e.target.closest('[data-i]'); if (!b) return; e.preventDefault(); pick(items[+b.dataset.i]); }); }
      if (!items.length) { box.hidden = false; box.innerHTML = `<p class="combo-none">${all.length ? 'No airfield matches that.' : 'Loading airfields…'}</p>`; place(inp); return; }
      box.hidden = false; hi = q ? 0 : -1;
      box.innerHTML = items.map((o, i) => `<button type="button" role="option" tabindex="-1" data-i="${i}"><b>${esc(o.c)}</b><span>${esc(o.t)}</span></button>`).join('');
      paintHi(); place(inp);
    }
    function pick(o) { const inp = cur; close(); if (!inp || !o) return; inp.value = o.v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
    document.addEventListener('focusin', e => { const inp = e.target; if (!(inp instanceof HTMLInputElement)) return; if (inp.hasAttribute('list')) { inp.dataset.combo = inp.getAttribute('list'); inp.removeAttribute('list'); inp.setAttribute('autocomplete', 'off'); } if (!inp.dataset.combo) return; cur = inp; render(inp); });
    document.addEventListener('input', e => { if (e.isTrusted && e.target === cur) render(cur); });
    document.addEventListener('click', e => { if (e.target === cur && box?.hidden) render(cur); });
    document.addEventListener('keydown', e => {
      if (!box || box.hidden || e.target !== cur) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, Math.min(items.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))); paintHi(); }
      else if (e.key === 'Enter' && hi >= 0 && items[hi]) { e.preventDefault(); pick(items[hi]); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }, true);
    document.addEventListener('focusout', e => { if (e.target === cur) setTimeout(() => { if (cur && document.activeElement !== cur) close(); }, 120); });
    addEventListener('scroll', () => { if (cur && box && !box.hidden) place(cur); }, true); addEventListener('resize', () => { if (cur) place(cur); });
  })();
  const regimeOf = p => (p.regime && R.regimes[p.regime] ? p.regime : '') || R.legacyRegime(p.authority) || (countryCodeOf(p) ? R.regimeFor(countryCodeOf(p)) : 'uk');
  const licenceOf = p => { const r = regimeOf(p); return R.licence(r, p.licence) ? p.licence : R.licencesFor(r)[0].id; };
  const countrySelect = code => {
    const opt = c => `<option value="${c.code}" ${c.code === code ? 'selected' : ''}>${esc(c.name)}</option>`;
    const pop = R.popular.map(c => R.countries.find(x => x.code === c)).filter(Boolean);
    return `<label class="field"><span>Country of training</span><select name="countryCode" required data-country><option value="" ${code ? '' : 'selected'} disabled>Choose a country</option><optgroup label="Most common">${pop.map(opt).join('')}</optgroup><optgroup label="All countries">${R.countries.map(opt).join('')}</optgroup></select></label>`;
  };
  const regimeSelect = r => `<label class="field"><span>Licensing system</span><select name="regime" data-regime>${REGIME_ORDER.map(k => `<option value="${k}" ${k === r ? 'selected' : ''}>${esc(k === 'icao' ? 'Other national authority (ICAO)' : R.regimes[k].label)}</option>`).join('')}</select></label>`;
  const licenceSelect = (r, id) => `<label class="field"><span>Training goal</span><select name="licence" data-licence>${R.licencesFor(r).map(l => `<option value="${esc(l.id)}" ${l.id === id ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>`;
  const minNote = (r, id, cls = 'callout') => {
    const l = R.licence(r, id); if (!l) return '';
    const head = l.minHours ? `<b>Published minimum: ${l.minHours} hours.</b> ` : '';
    const src = l.url ? ` <a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">Source: ${esc(l.source)}</a>` : '';
    return `<p class="${cls}" data-minnote>${head}${esc(l.summary)}${src}${l.url ? `<br><small>Checked ${esc(fmtDate(R.checked, { day: 'numeric', month: 'long', year: 'numeric' }))}. Most students fly more than the minimum. Your school and authority decide what counts.</small>` : ''}</p>`;
  };
  // keep country → system → licence → minimum in step as the user changes them
  function bindTraining(form, p) {
    const c = form.querySelector('[data-country]'), r = form.querySelector('[data-regime]'), a = form.querySelector('[name=authority]'), g = form.querySelector('[name=goalHours]');
    let regime = r ? r.value : regimeOf(p);
    const lic = () => form.querySelector('[data-licence]');
    const minNow = () => (lic() ? R.licence(regime, lic().value)?.minHours : null) || null;
    let curMin = minNow();
    const sync = () => {
      const n = form.querySelector('[data-minnote]'); if (n && lic()) n.outerHTML = minNote(regime, lic().value);
      const next = minNow();
      if (g) { if (next && (!g.value || Number(g.value) === curMin)) g.value = next; g.placeholder = next ? `e.g. ${next}` : 'e.g. 45'; }
      curMin = next;
    };
    const bindLic = () => { const l = lic(); if (l) l.onchange = sync; };
    const relicence = () => { const l = lic(); if (!l) { sync(); return; } const keep = R.licence(regime, l.value) ? l.value : R.licencesFor(regime)[0].id; l.outerHTML = licenceSelect(regime, keep); bindLic(); sync(); };
    const fillHome = cc => { const dl = form.querySelector('#home-af'); if (!dl || !window.BoploMap || !cc) return; BoploMap.airfields(cc).then(list => { dl.innerHTML = list.slice(0, 6000).map(x => `<option value="${esc(x.code)} · ${esc(x.name)}"></option>`).join(''); }); };
    fillHome(c ? c.value : countryCodeOf(p));
    if (c) c.addEventListener('change', () => fillHome(c.value));
    if (c) c.onchange = () => { regime = R.regimeFor(c.value); if (r) r.value = regime; if (a) a.value = R.authorityFor(c.value) || ''; relicence(); };
    if (r) r.onchange = () => { regime = r.value; if (a) a.value = regime === 'icao' ? '' : regime === 'easa' ? (R.authorityFor(c?.value) || 'EASA') : R.regimes[regime].label; relicence(); };
    bindLic();
  }


  /* ---------------- onboarding ---------------- */
  const STEPS = ['About you', 'Your goal', 'Aircraft', 'Hours so far', 'Review'];
  function onboard() {
    document.title = 'Set up your desk · Boplo Flight';
    const p = state.profile || {}, s = ui.step;
    const screens = [
      ['Let’s set up your flight desk.', 'A few details keep everything in the right context. You can change any of this later.',
        input('Your name', 'name', p.name || state.user?.display_name || '', 'text', 'required maxlength="100" autocomplete="name"') +
        countrySelect(countryCodeOf(p)) +
        regimeSelect(regimeOf(p)) +
        input('Licensing authority', 'authority', p.authority && !R.legacyRegime(p.authority) ? p.authority : (R.authorityFor(countryCodeOf(p)) || ''), 'text', 'required maxlength="100" placeholder="e.g. your national aviation authority"', false, 'Filled in from your country. Change it if yours is different.') +
        input('Home airfield', 'airport', p.airport, 'text', 'maxlength="100" placeholder="ICAO code or name" list="home-af" autocomplete="off"', true) + '<datalist id="home-af"></datalist>' +
        input('School or club', 'school', p.school, 'text', 'maxlength="200"', true)],
      ['What are you working toward?', 'Your target is your own planning date. Your school decides the training sequence and when you’re ready.',
        licenceSelect(regimeOf(p), licenceOf(p)) +
        input('Target date', 'target', p.target, 'date', '', true) +
        `<div class="full" style="grid-column:1/-1">${minNote(regimeOf(p), licenceOf(p))}</div>` +
        input('Hours goal', 'goalHours', p.goalHours || R.licence(regimeOf(p), licenceOf(p))?.minHours || '', 'number', 'min="0" max="2000" step="1" inputmode="numeric" placeholder="e.g. 45"', true, 'Starts at the published minimum. Set it to whatever you want to track against.') +
        input('Next lesson', 'nextLesson', p.nextLesson, 'text', 'maxlength="200" placeholder="e.g. Lesson 12 · Navigation"', true) +
        input('Next lesson date', 'lessonDate', p.lessonDate, 'date', '', true)],
      ['What do you usually fly?', 'These fill in new flight records for you.',
        input('Aircraft type', 'aircraft', p.aircraft, 'text', 'maxlength="200" placeholder="e.g. PA-28 Warrior"', true) +
        input('Registration', 'registration', p.registration, 'text', 'maxlength="200" placeholder="e.g. G-ABCD"', true) +
        select('How often do you fly?', 'frequency', FREQ, p.frequency || 'Still deciding') +
        input('Theory to revisit', 'topics', p.topics, 'text', 'maxlength="200" placeholder="e.g. Air law, meteorology"', true) +
        input('Aircraft cost per hour', 'rateAircraft', p.rateAircraft || '', 'number', 'min="0" max="5000" step="0.01" inputmode="decimal"', true, 'From your school’s price list. Used to track spending.') +
        input('Instructor cost per hour', 'rateInstructor', p.rateInstructor || '', 'number', 'min="0" max="2000" step="0.01" inputmode="decimal"', true, 'Leave blank if it’s included in the aircraft rate.')],
      ['Bring the hours you already have.', 'Add the total from your logbook, or leave it at zero and log flights as you go. These hours are kept separate from your dated flights.',
        duration('Existing flight time', 'openingMinutes', p.openingMinutes || 0, false) +
        input('Anything to remember', 'notes', p.notes, 'textarea', '', true)],
      ['Your desk is ready.', 'Check the details below. Everything can be changed later in your profile.',
        `<dl class="review full" style="grid-column:1/-1">${[['Pilot', p.name], ['Training in', [p.country, p.authority].filter(Boolean).join(' · ')], ['Goal', R.licence(regimeOf(p), p.licence)?.label || p.licence], ['Hours goal', p.goalHours ? p.goalHours + ' h' : 'Not set'], ['Target date', p.target ? fmtDate(p.target, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not set'], ['Home airfield', p.airport || 'Not set'], ['Hours so far', hrs(p.openingMinutes) + ' h']].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || '—')}</dd></div>`).join('')}</dl>
         <p class="callout" style="grid-column:1/-1">Everything you enter is self-reported. Boplo organises your records and preparation; it doesn’t assess your eligibility or readiness.</p>`]
    ];
    const [title, lead, fields] = screens[s];
    root.innerHTML = `<div class="onboard">
      <aside class="onboard-side night">${contours('b')}
        ${brand()}
        <ol class="steps" aria-label="Setup steps">${STEPS.map((t, i) => `<li class="${i === s ? 'current' : i < s ? 'done' : ''}" ${i === s ? 'aria-current="step"' : ''}><b>${i < s ? '✓' : i + 1}</b><span>${t}</span></li>`).join('')}</ol>
        <div class="foot"><span>${preview ? 'Example desk · not saved' : 'Saved after each step'}</span><button data-logout>${preview ? 'Leave' : 'Sign out'}</button></div>
      </aside>
      <main class="onboard-main"><form class="onboard-form" novalidate>
        <p class="kicker">Step ${s + 1} of ${STEPS.length}</p>
        <h1 class="display" tabindex="-1">${title}</h1>
        <p class="lead">${lead}</p>
        <div class="fields">${fields}</div>
        <p class="form-error" role="alert"></p>
        <div class="actions">
          ${s ? '<button type="button" class="btn btn-line" data-back>Back</button>' : '<span></span>'}
          <div class="right"><button class="btn btn-blue btn-has-spark" type="submit">${s === 4 ? 'Open my flight desk' : 'Continue'} ${spark}</button></div>
        </div>
      </form></main></div>`;
    $('[data-logout]').onclick = logout;
    const back = $('[data-back]'); if (back) back.onclick = () => { ui.step--; onboard(); $('h1').focus(); };
    const form = $('form');
    bindTraining(form, p);
    form.onsubmit = async e => {
      e.preventDefault();
      const err = $('.form-error', form), btn = form.querySelector('[type=submit]'); err.textContent = '';
      const bad = [...form.querySelectorAll('input[required], select[required]')].find(i => !String(i.value).trim());
      if (bad) { err.textContent = 'Fill in the required fields to continue.'; bad.focus(); return; }
      const v = Object.fromEntries(new FormData(form));
      if (v.countryCode) v.country = R.nameFor(v.countryCode);
      if (form.querySelector('[data-duration="openingMinutes"]')) v.openingMinutes = readDuration(form, 'openingMinutes');
      if ('goalHours' in v) v.goalHours = Number(v.goalHours || 0);
      ['rateAircraft', 'rateInstructor'].forEach(k => { if (k in v) v[k] = Number(v[k] || 0); });
      if (v.countryCode && !p.currency) v.currency = CURRENCY_BY[v.countryCode] || (EURO.includes(v.countryCode) ? 'EUR' : 'USD');
      btn.disabled = true;
      try {
        await saveProfile({ ...v, openingMinutes: Number(v.openingMinutes ?? p.openingMinutes ?? 0), step: Math.min(s + 1, 4), complete: s === 4 });
        if (s === 4) { location.hash = 'overview'; render(); toast('Your flight desk is ready.'); }
        else { ui.step++; onboard(); $('h1').focus(); }
      } catch (x) { err.textContent = x.message; btn.disabled = false; }
    };
  }

  async function logout() {
    if (!preview) { try { await fetch('/auth/logout', { method: 'POST' }); } catch { } }
    location.href = preview ? '/' : '/flight-app.html';
  }

  /* ---------------- derived numbers ---------------- */
  const sorted = () => [...state.flights].sort((a, b) => b.date.localeCompare(a.date) || 0);
  const totalMin = () => sum(state.flights, f => f.minutes) + Number(state.profile.openingMinutes || 0);
  const inLast = days => { const c = new Date(parseISO(todayISO()) - days * 86400000); const iso = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`; return state.flights.filter(f => f.date >= iso); };

  /* ---------------- tracks: projection ---------------- */
  function project(lists, w, h, pad = 28) {
    const pts = lists.flat(); if (!pts.length) return null;
    const lat0 = sum(pts, p => p.lat) / pts.length, k = Math.cos(lat0 * Math.PI / 180);
    const xs = pts.map(p => p.lng * k), ys = pts.map(p => -p.lat);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = Math.max(x1 - x0, y1 - y0, .02); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const s = Math.min((w - 2 * pad) / Math.max(x1 - x0, span * (w / h) * .25, .02), (h - 2 * pad) / Math.max(y1 - y0, span * .25, .02));
    return p => [w / 2 + (p.lng * k - cx) * s, h / 2 + (-p.lat - cy) * s];
  }
  const pathD = (pts, P) => pts.map((p, i) => { const [x, y] = P(p); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('');
  const gridLines = (w, h, step = 40) => { let d = ''; for (let x = step; x < w; x += step) d += `M${x} 0V${h}`; for (let y = step; y < h; y += step) d += `M0 ${y}H${w}`; return `<path d="${d}" stroke="rgba(158,216,255,.07)" stroke-width="1" fill="none"/>`; };

  function trackSVG(flights, w, h, selected = null) {
    const withPts = flights.filter(f => f.points?.length);
    const P = project(withPts.map(f => f.points), w, h, 34);
    if (!P) return '';
    let routes = '', labels = '', seen = [];
    const label = (pt, code) => { const [x, y] = P(pt); if (seen.some(([a, b]) => Math.hypot(a - x, b - y) < 24)) return; seen.push([x, y]); labels += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle r="4.5" fill="#020611" stroke="#9ED8FF" stroke-width="1.5"/><text y="-11" text-anchor="middle" fill="rgba(230,240,255,.92)" font-size="11.5" font-weight="600" letter-spacing=".04em">${esc(upper(code).slice(0, 8))}</text></g>`; };
    withPts.forEach(f => {
      const on = !selected || selected === f.id, d = pathD(f.points, P), dash = f.routeKind === 'track' ? '' : 'stroke-dasharray="5 5"';
      routes += `<path d="${d}" fill="none" stroke="rgba(10,98,255,${on ? .55 : .16})" stroke-width="${on ? 9 : 5}" stroke-linecap="round" stroke-linejoin="round"/>`;
      routes += `<path d="${d}" fill="none" stroke="${on ? '#9ED8FF' : 'rgba(158,216,255,.35)'}" stroke-width="${on ? 2.2 : 1.4}" stroke-linecap="round" stroke-linejoin="round" ${dash}/>`;
    });
    withPts.forEach(f => { label(f.points[0], f.departure); label(f.points[f.points.length - 1], f.arrival); });
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Flight tracks from your records">${gridLines(w, h)}${routes}${labels}</svg>`;
  }

  /* ---------------- shell ---------------- */
  function shell(page, head, body) {
    const p = state.profile;
    document.title = `${head.title.replace(/<[^>]+>/g, '')} · Boplo Flight`;
    root.innerHTML = `<div class="shell">
      <aside class="side"><div class="side-in night">${contours('b')}
        ${brand('#overview')}
        <button class="btn btn-blue btn-has-spark log-cta" data-add>Log a flight ${spark}</button>
        <nav aria-label="Flight desk">${HUBS.map(h => `<div class="nav-hub${hubOf(page) === h ? ' on' : ''}" data-hub="${h[0]}"><a href="${hubHref(h)}" ${hubOf(page) === h ? 'aria-current="' + (h[3].length > 1 ? 'true' : 'page') + '"' : ''}>${ico(h[2])}${h[1]}${h[0] === 'sim' ? '<span class="nav-tag">3D</span>' : ''}</a>${h[3].length > 1 ? `<div class="nav-subs">${h[3].map(id => `<a href="#${id}" ${id === page ? 'aria-current="page"' : ''}>${esc(SUBLABEL[id] || (PAGES.find(x => x[0] === id) || [, id])[1])}</a>`).join('')}</div>` : ''}</div>`).join('')}${B().owner && !preview ? `<div class="nav-hub"><a href="/owner.html">${ico('analytics')}Owner analytics</a></div>` : ''}</nav>
        <div class="me">
          <div class="me-row"><span class="avatar" aria-hidden="true">${esc(initials(p.name))}</span><div style="min-width:0"><b>${esc(p.name)}</b><small><span class="plan-badge ${isAdv() ? 'adv' : ''}">${isAdv() ? 'Advanced' : 'Free'}</span>${esc([p.licence, p.authority].filter(Boolean).join(' · '))}</small></div></div>
          <div class="me-actions"><a href="#profile" ${page === 'profile' ? 'aria-current="page"' : ''}>${ico('profile')}Profile</a><a href="#plan" ${page === 'plan' ? 'aria-current="page"' : ''}>${ico('plan')}${isAdv() ? 'Plan' : 'Upgrade'}</a><button data-logout class="me-out" aria-label="${preview ? 'Leave example desk' : 'Sign out'}" title="${preview ? 'Leave example desk' : 'Sign out'}">${ico('out')}</button></div>
        </div>
      </div></aside>
      <header class="topbar">${brand('#overview')}<div style="display:flex;gap:8px;align-items:center"><a class="icon-btn" href="#more" aria-label="Account" ${['more', 'profile', 'plan'].includes(page) ? 'aria-current="page"' : ''} style="background:transparent;border-color:var(--hair-d);color:#fff">${ico('profile')}</a><button class="btn btn-blue btn-has-spark" data-add>Log flight ${spark}</button></div></header>
      <main class="main"><div class="page">
        ${state.offline ? '<div class="offline-bar"><b>Offline.</b> Showing your desk as it was when you were last connected. Flights you log now are saved when you reconnect.</div>' : ''}${preview ? `<div class="preview-bar"><span><b>Example desk.</b> These are sample records; changes aren’t saved.</span><a class="btn btn-light btn-sm" href="/flight-app.html">Open my own desk</a></div>` : ''}
        ${(() => { const h = hubOf(page); if (!h || h[3].length < 2) return ''; ui.lastSub[h[0]] = page; return `<nav class="subnav" aria-label="${esc(h[1])}"><span class="subnav-hub">${ico(h[2])}${esc(h[1])}</span><div class="subnav-tabs">${h[3].map(id => `<a href="#${id}" ${id === page ? 'aria-current="page"' : ''}>${esc(SUBLABEL[id] || (PAGES.find(x => x[0] === id) || [, id])[1])}</a>`).join('')}</div></nav>`; })()}
        <header class="page-head"><div><h1 class="display">${head.title}</h1>${head.sub ? `<p>${head.sub}</p>` : ''}</div>${head.actions ? `<div class="head-actions">${head.actions}</div>` : ''}</header>
        ${body}
      </div></main>
      <nav class="tabbar" aria-label="Flight desk">${HUBS.map(h => `<a href="${hubHref(h)}" ${hubOf(page) === h ? 'aria-current="page"' : ''}>${ico(h[2])}${h[4]}</a>`).join('')}</nav>
    </div>`;
    fitNav();
    $$('[data-add]').forEach(b => b.onclick = () => { if (!isAdv() && state.flights.length >= B().limits.flights) return upgradeSheet(`The Free plan holds ${B().limits.flights} flights. Advanced gives you an unlimited logbook.`); flightSheet(); });
    $$('[data-record]').forEach(b => b.onclick = recorderSheet);
    $$('[data-flyagain]').forEach(b => b.onclick = () => { const f = state.flights.find(x => x.id === b.dataset.flyagain); if (f) openSim(f, 'replay'); });
    $$('[data-logout]').forEach(b => b.onclick = logout);
    $$('[data-flight]').forEach(b => b.onclick = () => flightSheet(state.flights.find(f => f.id === b.dataset.flight)));
  }

  // show every section's pages in the sidebar; when the window is too short, fold the other sections (bottom first), then this one, so the sidebar never scrolls (Logbook folds first: its main link already opens Flights; Flight planning, with the simulator, folds last)
  function fitNav() {
    const nav = $('.side nav'); if (!nav || !nav.offsetParent) return;
    const hubs = [...nav.querySelectorAll('.nav-hub')].filter(x => x.querySelector('.nav-subs'));
    hubs.forEach(x => x.classList.remove('folded'));
    const over = () => nav.scrollHeight > nav.clientHeight + 1;
    const FOLD = ['logbook', 'training', 'planning'], rank = x => FOLD.indexOf(x.dataset.hub);
    for (const x of [...hubs.filter(x => !x.classList.contains('on')).sort((a, b) => rank(a) - rank(b)), ...hubs.filter(x => x.classList.contains('on'))]) { if (!over()) break; x.classList.add('folded'); }
    const on = nav.querySelector('.nav-hub.on'); $('.shell')?.classList.toggle('side-subs', !!on && !on.classList.contains('folded') && !!on.querySelector('.nav-subs'));
  }
  let fitT; addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitNav, 80); });

  /* ---------------- pages ---------------- */
  function flightRows(list) {
    return list.map(f => `<button class="frow" data-flight="${esc(f.id)}">
      <span class="fdate"><b>${esc(fmtDate(f.date, { day: 'numeric', month: 'short' }))}</b>${esc(fmtDate(f.date, { weekday: 'short' }))}</span>
      <span class="froute"><b>${esc(upper(f.departure))} → ${esc(upper(f.arrival))}</b><small>${esc(f.lesson || f.aircraft || 'Flight')}</small></span>
      <span class="chip role-${esc(f.role)}"><i></i>${esc(roleName(f.role))}</span>
      <span class="ftime">${hm(f.minutes)}<small>${f.landings} ldg</small></span>
    </button>`).join('');
  }

  /* ================= training coach: recurring debrief issues, rust refresher, forecast check and weather scrubs ================= */
  const ISSUES = [
    { id: 'flare', title: 'The flare and touchdown', re: /\bflare|round ?out|hold ?off|balloon|\bfloat(ed|ing)?\b|bounc|touch ?down|hard landing|landed (flat|on the nose)|landing (was|were) (firm|hard)/i, sim: { kind: 'short', weather: 'clear' }, study: 'pof',
      drills: ['Chair-fly the last 200 ft out loud: aim point, speed, then eyes to the far end of the runway as you start the flare.', 'In the sim, fly three short finals and aim for under 200 fpm at touchdown and less than 100 m past the aim point.', 'Ask your instructor to call “look ahead” at the flare on the next few landings.'] },
    { id: 'drift', title: 'Drift and the centreline on final', re: /\bdrift|cross ?wind|centre ?line|center ?line|\bcrab|wing ?down|de-?crab|kick (it )?straight|blown (off|across)/i, sim: { kind: 'short', weather: 'gusty' }, study: 'pof', not: /downwind|spacing|circuit|\bwide\b/i,
      drills: ['Pick a point at the far end of the runway and keep it fixed in the windscreen: ailerons for the line, rudder for the nose.', 'In the sim, fly two short finals in a gusty crosswind and keep the centreline error under 4 m at touchdown.', 'Work out the crosswind for your runway before you fly, so you know how much bank to expect.'] },
    { id: 'approach', title: 'A stable approach', re: /approach (speed|path|angle)|on final|glide ?path|too (high|low|fast|slow)|\bunstab|stabili[sz]ed|\bpapi\b|aim(ing)? point|go[- ]?around|speed control/i, sim: { kind: 'long', weather: 'fair' }, study: 'ops', not: /centre ?line|center ?line|\bdrift|cross ?wind/i,
      drills: ['Say your gates out loud: on the runway line, on speed, on the glidepath, by 300 ft; if not, go around.', 'In the sim, fly a long final holding two white and two red on the PAPI all the way down.', 'Note the power setting that holds approach speed at 3° in your aircraft and set it early.'] },
    { id: 'circuit', title: 'The circuit shape and spacing', re: /\bcircuit|\bpattern\b|downwind|base (leg|turn)|crosswind leg|spacing|\btpa\b|circuit height|turn(ed|ing)? (base|final) (early|late)/i, sim: { kind: 'circuit', weather: 'clear' }, study: 'ops',
      drills: ['Find two ground features for your downwind spacing and the base turn, and note them on your prep.', 'In the sim, fly a full circuit and keep within 100 ft of circuit height on downwind.', 'Draw your circuit from memory with heights, speeds and checks at each point.'] },
    { id: 'radio', title: 'Radio calls', re: /\bradio|\br\/t\b|read ?back|\bcalls?\b|transmi|frequency|\batc\b|tower|phraseology/i, sim: { kind: 'circuit', weather: 'clear', radio: true }, study: 'comms', radio: true,
      drills: ['Write your circuit calls on a card and say them out loud three times before the lesson.', 'Practise the take-off readback and downwind call in Radio practice.', 'Fly a circuit in the sim with radio calls switched on.'] },
    { id: 'trim', title: 'Using the trim', re: /\btrim/i, study: 'pof',
      drills: ['Chair-fly “power, attitude, trim” for each phase: climb, level off, descent.', 'After every attitude change, hold it, then trim until you can relax your hand.'] },
    { id: 'lookout', title: 'Lookout', re: /look ?out|\bscan(ning)?\b|head (down|in)|eyes (inside|in the cockpit)|traffic/i, study: 'ops',
      drills: ['Use a set scan: sectors left to right, ten degrees at a time, then a quick instrument check.', 'Before every turn, say “clear left, clear right, above, below” out loud.'] },
    { id: 'checks', title: 'Checks from memory', re: /\bchecks?\b|checklist|\bfreda\b|has+ell|\bbumpfh?\b|vital actions|before landing/i, study: 'ops',
      drills: ['Write each check (FREDA, HASELL, BUMPFH or your school’s) on a card and run them from memory twice a day.', 'Chair-fly where in the circuit each check happens.'] },
    { id: 'balance', title: 'Balance and rudder', re: /\bbalance|\bball\b|\brudder|coordinat|\bslip|\bskid|\byaw/i, study: 'pof',
      drills: ['Say “step on the ball” and practise rudder into every roll and every power change.', 'Watch the nose against the horizon as you roll in: it shouldn’t swing.'] },
    { id: 'height', title: 'Holding height', re: /\baltitude|height keeping|holding (height|altitude|level)|level(l)?ing off|lost height|gained height|climbed (through|above)/i, study: 'pof',
      drills: ['Pick a nose attitude for level flight and memorise where the horizon sits in the windscreen.', 'When levelling off: attitude, let the speed build, power, trim.'] },
    { id: 'nav', title: 'Navigation and timing', re: /\bheading|\btiming|turn(ing)? point|\btrack(ing)?\b|map read|\bnav(igation)?\b|landmark|got lost|unsure of position/i, study: 'nav',
      drills: ['Re-plan the last route in the Nav log and mark a feature every 5 minutes.', 'Practise “clock, compass, map”: time, heading, then the ground.'] },
    { id: 'takeoff', title: 'The take-off', re: /take-?off|rotat(e|ion)|lift ?off|\bswing|initial climb/i, sim: { kind: 'takeoff', weather: 'fair' }, study: 'perf',
      drills: ['Chair-fly the take-off: centreline, rotate speed, climb attitude, climb speed, checks at 500 ft.', 'In the sim, practise a take-off and hold Vy within 5 kt to 1,000 ft.'] },
    { id: 'forced', title: 'Forced landings and engine failures', re: /\bpfl\b|forced landing|\befato\b|engine failure|glide approach|field selection/i, study: 'ops',
      drills: ['Learn your best glide speed and say the actions for an engine failure after take-off from memory.', 'On every drive, pick a field and imagine the approach to it.'] },
    { id: 'stall', title: 'Stalls and slow flight', re: /\bstall|slow flight|\bspin/i, study: 'pof',
      drills: ['Say the stall recovery out loud: “nose down, full power, wings level, climb away”.', 'Study what changes the stall speed (weight, flap, bank) in Principles of flight.'] },
    { id: 'taxi', title: 'Taxiing', re: /\btaxi/i,
      drills: ['Taxi at walking pace and steer with rudder pedals, brakes only to stop.', 'Before the lesson, study the airfield chart and say your taxi route.'] }
  ];
  const BAD_CUE = /\b(work on|again|late|early|too\b|high|low|fast|slow|drift|struggl|forgot|missed|need|improv|wide|close|bounc|balloon|hard|not\b|didn|don['’]t|keep|remember|focus|practi[cs]e|unstab|behind|over-?correct|rushed|lost|wobbl|tense|tight|messy|sloppy|inconsistent|nervous|confus|wrong|mistake|issue|problem|tricky|difficult|wasn['’]t|weren['’]t)/i;
  // which issues come up in the debrief notes of recent lessons: only sentences that read as something to fix count
  function recurringIssues(n = 8) {
    const fl = sorted().filter(f => String(f.notes || '').trim()).slice(0, n), hits = {};
    for (const f of fl) {
      let mode = 'any'; const seen = new Set();
      for (const raw of String(f.notes).split(/\n|(?<=[.!?])\s+/)) {
        const s = raw.trim(); if (!s) continue;
        if (/^(went well|good|positives?)\s*:/i.test(s)) { mode = 'good'; if (!s.replace(/^[^:]*:\s*/, '')) continue; }
        if (/^(work on|to work on|improve|next time|prepare next time|ask my instructor)\s*:/i.test(s)) { mode = 'fix'; }
        if (/^(summary|lesson)\s*:/i.test(s)) mode = 'any';
        if (mode === 'good' && !/^[-•*]/.test(s) && s.length > 60) mode = 'any';
        if (mode === 'good') continue;
        if (mode !== 'fix' && !BAD_CUE.test(s)) continue;
        for (const I of ISSUES) if (!seen.has(I.id) && I.re.test(s) && !(I.not && I.not.test(s))) { seen.add(I.id); (hits[I.id] = hits[I.id] || { I, n: 0, dates: [], quotes: [] }).n++; hits[I.id].dates.push(f.date); if (hits[I.id].quotes.length < 2) hits[I.id].quotes.push(s.replace(/^[-•*]\s*/, '').slice(0, 140)); }
      }
    }
    return { of: fl.length, list: Object.values(hits).filter(h => h.n >= 2).sort((a, b) => b.n - a.n || b.dates[0].localeCompare(a.dates[0])) };
  }
  const homeCode = () => upper(state.profile.airport).split(/[\s·]/)[0];
  const daysSinceFlight = () => { const f = sorted()[0]; return f ? -daysUntil(f.date) : null; };
  const rustKey = () => 'boplo-rust-' + (sorted()[0]?.date || '');
  const rustDone = () => { try { return JSON.parse(localStorage.getItem(rustKey()) || '{}'); } catch { return {}; } };
  const simBtn = (sim, label) => sim ? `<button type="button" class="btn btn-line btn-sm" data-cosim="${sim.kind}|${sim.weather || ''}|${sim.radio ? 1 : 0}">${esc(label || 'Practise it in the sim')}</button>` : '';

  function issueTile(cls = 'span-6') {
    const r = recurringIssues(); if (!r.list.length) return '';
    const top = r.list[0], I = top.I;
    return `<section class="tile ${cls} coach-issue"><div class="tile-head"><h2>Keeps coming up</h2><span class="chip warn">${top.n} of your last ${r.of} lessons</span></div>
      <h3 class="coach-h">${esc(I.title)}</h3>
      ${top.quotes.length ? `<p class="coach-q">“${esc(top.quotes[0])}”</p>` : ''}
      <ol class="coach-drills">${I.drills.slice(0, 3).map(d => `<li>${esc(d)}</li>`).join('')}</ol>
      <div class="coach-acts">${simBtn(I.sim)}${I.radio ? '<a class="btn btn-line btn-sm" href="#radio">Radio practice</a>' : ''}<button type="button" class="btn btn-line btn-sm" data-coprep="${I.id}">Add the drills to my prep</button></div>
      ${r.list.length > 1 ? `<p class="footnote">Also coming up: ${r.list.slice(1, 4).map(h => `${esc(h.I.title.toLowerCase())} (${h.n})`).join(', ')}. Spotted from your debrief notes.</p>` : '<p class="footnote">Spotted from your debrief notes.</p>'}</section>`;
  }
  function rustTile(cls = 'span-6') {
    const gap = daysSinceFlight(), p = state.profile; if (gap == null || gap < 10) return '';
    const T = window.BoploPreflight?.TYPES?.[pfType(p)], sp = T?.speeds || {}, d = rustDone(), r = recurringIssues();
    const last = sorted()[0], fix = String(last?.notes || '').split(/\n|(?<=[.!?])\s+/).map(s => s.trim().replace(/^[-•*]\s*/, '')).filter(s => s && BAD_CUE.test(s)).slice(0, 3);
    const steps = [
      ['chair', 'Chair-fly one circuit out loud', `<button type="button" class="btn btn-line btn-sm" data-chairfly>Talk me round it</button><details class="coach-script"><summary>The script</summary><p>Lined up: checks complete, full power, keep straight on the centreline${sp.vr ? `, rotate at ${sp.vr} kt` : ''}, climb${sp.vy ? ` at ${sp.vy} kt` : ''}. At 500 ft: checks, turn crosswind. At circuit height: level off, power, trim, turn downwind and make your call. Abeam the threshold: before-landing checks. Base: power back, flap, start down. Final: on the line${sp.vref ? `, ${sp.vref} kt` : ''}, aim point fixed, landing flap. Flare: eyes to the far end, hold off, let it settle.</p></details>`],
      ['sim', `Fly a short final${homeCode() ? ` at ${homeCode()}` : ''} in the simulator`, simBtn({ kind: 'short', weather: 'clear' }, 'Open the sim')],
      ['debrief', 'Re-read your last debrief', fix.length ? `<ul class="coach-mini">${fix.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : `<a class="link" href="#logbook">Open your last flight</a>`],
      ...(r.list[0] ? [['drill', `Run one drill for ${r.list[0].I.title.toLowerCase()}`, `<p class="coach-mini">${esc(r.list[0].I.drills[0])}</p>`]] : [])
    ];
    const n = steps.filter(s => d[s[0]]).length;
    return `<section class="tile ${cls} coach-rust"><div class="tile-head"><h2>Shake off the rust</h2><span class="chip">${gap} days since you flew</span></div>
      <p class="hint">${gap >= 60 ? 'After a break this long most students restart with a dual lesson; that’s normal. ' : ''}Skills fade fastest in the first few weeks off. Fifteen minutes before your next lesson gets most of it back.</p>
      <div class="coach-steps">${steps.map(([k, t, extra]) => `<label class="coach-step ${d[k] ? 'done' : ''}"><input type="checkbox" data-rust="${k}" ${d[k] ? 'checked' : ''}><span><b>${esc(t)}</b>${extra}</span></label>`).join('')}</div>
      <div class="progress" style="margin-top:12px"><span class="progress-bar"><i style="width:${n / steps.length * 100}%"></i></span>${n} of ${steps.length} done</div></section>`;
  }
  const lessonWxTile = (cls = 'span-6') => { const p = state.profile, d = p.lessonDate ? daysUntil(p.lessonDate) : null; if (d == null || d < 0 || d > 1 || !homeCode()) return ''; return `<section class="tile ${cls} coach-wx" data-cowx><div class="tile-head"><h2>Lesson forecast</h2><span class="chip">${d === 0 ? 'Today' : 'Tomorrow'}${p.lessonTime ? ' · ' + esc(p.lessonTime) : ''}</span></div><p class="hint">Checking the TAF against your minimums…</p></section>`; };
  function coachTiles() { const t = [lessonWxTile(), rustTile(), issueTile()].filter(Boolean); if (t.length === 1) return t[0].replace(/span-6/, 'span-12'); if (t.length === 3) return t.map((x, i) => i === 2 ? x.replace(/span-6/, 'span-12') : x).join(''); return t.join(''); }

  // TAF: split into the base forecast and its change groups, each with a UTC time range and conditions
  function parseTAF(raw, now = new Date()) {
    const tok = String(raw || '').replace(/\s+/g, ' ').trim().replace(/^TAF\s+(AMD\s+|COR\s+)?/, '').split(' ').filter(Boolean); if (tok.length < 3) return null;
    const iss = tok[1].match(/^(\d{2})(\d{2})(\d{2})Z$/); const Y = now.getUTCFullYear(), M = now.getUTCMonth();
    const at = (dd, hh, mm = 0) => { let d = new Date(Date.UTC(Y, M, +dd, +hh, +mm)); if (iss && +dd < +iss[1] - 15) d = new Date(Date.UTC(Y, M + 1, +dd, +hh, +mm)); else if (iss && +dd > +iss[1] + 15) d = new Date(Date.UTC(Y, M - 1, +dd, +hh, +mm)); return d; };
    const per = s => { const m = s.match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/); return m ? [at(m[1], m[2]), at(m[3], m[4])] : null; };
    let i = 2; const valid = per(tok[i] || ''); if (valid) i++; else return null;
    const groups = [], blank = type => ({ type, prob: 0, from: valid[0], to: valid[1], wind: null, gust: 0, visKm: null, ceil: null, wx: [] });
    let g = blank('BASE'); groups.push(g);
    for (; i < tok.length; i++) {
      const t = tok[i]; let m;
      if ((m = t.match(/^FM(\d{2})(\d{2})(\d{2})$/))) { g.to = at(m[1], m[2], m[3]); g = blank('FM'); g.from = at(m[1], m[2], m[3]); groups.push(g); continue; }
      if (t === 'BECMG' || t === 'TEMPO') { const p = per(tok[i + 1] || ''); const prob = g.type === 'PROB' && g.wind == null && g.visKm == null && !g.wx.length ? g.prob : 0; if (prob) groups.pop(); g = blank(t); g.prob = prob; if (p) { [g.from, g.to] = p; i++; } groups.push(g); continue; }
      if ((m = t.match(/^PROB(\d{2})$/))) { const p = per(tok[i + 1] || ''); g = blank('PROB'); g.prob = +m[1]; if (p) { [g.from, g.to] = p; i++; } groups.push(g); continue; }
      if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) { const k = m[4] === 'MPS' ? 1.944 : 1; g.wind = Math.round(+m[2] * k); g.gust = m[3] ? Math.round(+m[3] * k) : 0; continue; }
      if (t === 'CAVOK') { g.visKm = 10; g.ceil = 99999; continue; }
      if (/^\d{4}$/.test(t)) { g.visKm = +t >= 9999 ? 10 : +t / 1000; continue; }
      if ((m = t.match(/^(P)?(\d+)(?:\/(\d+))?SM$/))) { g.visKm = m[1] ? 10 : Math.min(10, (m[3] ? +m[2] / +m[3] : +m[2]) * 1.609); continue; }
      if ((m = t.match(/^(BKN|OVC|VV)(\d{3})/))) { const b = +m[2] * 100; g.ceil = g.ceil == null || g.ceil === 99999 ? b : Math.min(g.ceil, b); continue; }
      if (t === 'NSC' || t === 'SKC' || t === 'NSW') { if (t !== 'NSW') g.ceil = 99999; continue; }
      if (/^[-+]?(VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(RA|DZ|SN|SG|GR|GS|PL|BR|FG|HZ|FU|DU|SA|SQ|FC|UP)*$/.test(t) && /TS|FG|SN|GR|FZ|SQ|FC|\+RA|\+SHRA|BR/.test(t)) g.wx.push(t);
    }
    return { valid, groups };
  }
  // the lesson window against the forecast and the pilot's minimums
  function lessonForecast(taf, mins, dateISO, time) {
    const T = parseTAF(taf); if (!T) return null;
    const [h, m] = (time || '').split(':').map(Number), start = new Date(`${dateISO}T${Number.isFinite(h) ? String(h).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0') : '09:00'}:00`);
    const from = new Date(start.getTime() - (Number.isFinite(h) ? 90 : 0) * 6e4), to = new Date(start.getTime() + (Number.isFinite(h) ? 150 : 8 * 60) * 6e4);
    if (from > T.valid[1]) return { notYet: true };
    let state = null; const reasons = []; let worst = 'go';
    const fmt = d => d.toISOString().slice(11, 13) + 'Z';
    const check = (g, temp) => {
      const issues = [], close = [];
      const t = (bad, near, msg) => { if (bad) issues.push(msg); else if (near) close.push(msg); };
      const W = g.wind, G = g.gust || g.wind;
      if (W != null && mins.wind !== '' && mins.wind != null) t(W > +mins.wind, W > +mins.wind * .85, `wind ${W} kt (your max ${mins.wind})`);
      if (G != null && g.gust && mins.gust !== '' && mins.gust != null) t(G > +mins.gust, G > +mins.gust * .85, `gusts ${G} kt (your max ${mins.gust})`);
      if (g.visKm != null && mins.visKm) t(g.visKm < +mins.visKm, g.visKm < +mins.visKm * 1.15, `visibility ${g.visKm >= 10 ? '10+' : g.visKm.toFixed(1)} km (your min ${mins.visKm})`);
      if (g.ceil != null && g.ceil !== 99999 && mins.ceil) t(g.ceil < +mins.ceil, g.ceil < +mins.ceil * 1.15, `cloud base ${g.ceil} ft (your min ${mins.ceil})`);
      if (g.wx.some(w => /TS/.test(w))) issues.push('thunderstorms'); else if (g.wx.some(w => /FG|FZ|SN|GR|SQ/.test(w))) issues.push(g.wx.join(' ').replace(/FG/g, 'fog').replace(/SN/g, 'snow').replace(/BR/g, 'mist'));
      const when = `${fmt(g.from)}–${fmt(g.to)}`, pre = g.prob ? `${g.prob}% chance${g.type === 'TEMPO' ? ', temporarily,' : ''} ${when}` : g.type === 'TEMPO' ? `Temporarily ${when}` : g.type === 'BECMG' ? `Becoming from ${fmt(g.from)}` : g.type === 'FM' ? `From ${fmt(g.from)}` : 'Forecast';
      const R = { go: 0, caution: 1, nogo: 2 }, up = v => { if (R[v] > R[worst]) worst = v; };
      if (issues.length) { const sv = temp ? 'caution' : 'nogo'; reasons.push({ s: sv, t: `${pre}: ${issues.join(', ')}` }); up(sv); }
      else if (close.length) { reasons.push({ s: 'caution', t: `${pre}: close to your limit, ${close.join(', ')}` }); up('caution'); }
    };
    for (const g of T.groups) {
      if (g.to <= from || g.from >= to) continue;
      if (g.type === 'BASE' || g.type === 'FM') { state = { ...g }; check(state, false); }
      else if (g.type === 'BECMG') { state = { ...(state || {}), ...Object.fromEntries(Object.entries(g).filter(([k, v]) => v != null && !(Array.isArray(v) && !v.length) && k !== 'type')), type: 'BECMG' }; check(state, false); }
      else check(g, true);
    }
    if (!reasons.length) reasons.push({ s: 'go', t: 'Nothing in the forecast outside your minimums for the lesson window.' });
    return { worst, reasons, from, to };
  }
  async function fillForecast() {
    const box = $('[data-cowx]'); if (!box) return;
    const p = state.profile, code = homeCode(), mins = { wind: 15, gust: 20, cross: 10, visKm: 8, ceil: 1500, ...(pfStore().mins || {}) };
    try {
      const af = await anyAirfield(code), d = preview ? EX_WX : await api(`weather?ids=${encodeURIComponent(code)}${af ? `&lat=${af.lat}&lng=${af.lng}` : ''}`);
      const st = (d.stations || []).find(s => s.taf) || null;
      if (!st) { box.querySelector('.hint').textContent = 'No TAF is published near your airfield. Check the forecast in your official briefing.'; return; }
      const f = lessonForecast(st.taf, mins, p.lessonDate, p.lessonTime);
      if (!f) { box.querySelector('.hint').textContent = 'The forecast couldn’t be read.'; return; }
      if (f.notYet) { box.querySelector('.hint').textContent = `The ${st.id} forecast doesn’t reach your lesson time yet. Check again in the morning.`; return; }
      const word = { go: 'Looks flyable', caution: 'Marginal', nogo: 'Unlikely to fly' }[f.worst];
      box.innerHTML = `<div class="tile-head"><h2>Lesson forecast</h2><span class="chip go-${f.worst}">${word}</span></div>
        <ul class="coach-wxl">${f.reasons.map(r => `<li class="go-${r.s}">${esc(r.t)}</li>`).join('')}</ul>
        <p class="footnote">TAF ${esc(st.id)}${st.id !== code ? ` (nearest to ${esc(code)})` : ''} for ${f.from.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}–${f.to.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, against your personal minimums (<a class="link" href="#preflight">change them</a>). ${f.worst !== 'go' ? 'If it’s scrubbed, tap “Lesson cancelled?” for a grounded plan.' : 'Your instructor makes the call on the day.'}</p>`;
    } catch (x) { box.querySelector('.hint').textContent = 'The forecast didn’t load.'; }
  }
  function wireCoach(again) {
    $$('[data-cosim]').forEach(b => b.onclick = () => { const [kind, wx, radio] = b.dataset.cosim.split('|'); if (!homeCode()) { toast('Set your home airfield in your profile first.'); return; } if (radio === '1') ui.sim.radio = true; openPractice(homeCode(), '', kind, { weather: wx || undefined }); });
    $$('[data-coprep]').forEach(b => b.onclick = async () => { const I = ISSUES.find(x => x.id === b.dataset.coprep); const checks = parseChecks(state.profile.checklist); I.drills.forEach(t => { if (!checks.some(c => c.text === t)) checks.push({ done: false, text: t }); }); try { await saveProfile({ checklist: writeChecks(checks) }); toast('Added to your preparation checklist.'); b.disabled = true; b.textContent = 'Added to your prep'; } catch (x) { toast(x.message); } });
    $$('[data-rust]').forEach(i => i.onchange = () => { const d = rustDone(); d[i.dataset.rust] = i.checked; try { localStorage.setItem(rustKey(), JSON.stringify(d)); } catch { } again(); });
    $$('[data-scrub]').forEach(b => b.onclick = scrubSheet);
    fillForecast();
  }

  // lesson cancelled: log it, then turn the slot into a grounded hour built around the lesson that was planned
  const scrubsOf = () => { const x = readJSON(state.profile.scrubs, []); return Array.isArray(x) ? x : []; };
  function groundedPlan(lesson) {
    const L = String(lesson || '').toLowerCase(), faa = regimeOf(state.profile) === 'faa', top = recurringIssues().list[0]?.I;
    const kind = /circuit|pattern|landing|touch/.test(L) ? 'circuit' : /nav|cross ?country|xc/.test(L) ? 'nav' : /stall|slow/.test(L) ? 'stall' : /pfl|forced|efato|emergenc/.test(L) ? 'forced' : /take ?off|departure/.test(L) ? 'takeoff' : /solo/.test(L) ? 'circuit' : 'general';
    const P = {
      circuit: { sim: { kind: 'circuit', weather: 'clear', radio: true }, simT: 'Fly the circuit in the sim, with radio calls', study: 'ops', radio: faa ? 'f-ctaf' : 'u-dw' },
      nav: { sim: null, simT: '', nav: true, study: 'nav', radio: faa ? 'f-gnd' : 'u-check' },
      stall: { sim: { kind: 'long', weather: 'clear' }, simT: 'Fly a long final in the sim and hold the speed exactly', study: 'pof', radio: faa ? 'f-to' : 'u-dep' },
      forced: { sim: { kind: 'long', weather: 'fair' }, simT: 'Fly a long final and practise judging the descent', study: 'ops', radio: faa ? 'f-may' : 'u-may' },
      takeoff: { sim: { kind: 'takeoff', weather: 'fair' }, simT: 'Practise the take-off in the sim', study: 'perf', radio: faa ? 'f-to' : 'u-dep' },
      general: { sim: top?.sim || { kind: 'short', weather: 'clear' }, simT: top?.sim ? `Work on ${top.title.toLowerCase()} in the sim` : 'Fly a few short finals in the sim', study: top?.study || 'met', radio: faa ? 'f-to' : 'u-dep' }
    }[kind];
    const subj = (QB?.subjects || []).find(s => s.id === P.study);
    return [
      P.sim ? ['sim', P.simT, '20 min', simBtn(P.sim, 'Open the sim')] : ['nav', 'Re-plan the route in the Nav log and mark a feature every 5 minutes', '20 min', '<a class="btn btn-line btn-sm" href="#navlog">Open the Nav log</a>'],
      ['study', `Theory: ${subj ? subj.name : 'today’s review'}`, '15 min', `<button type="button" class="btn btn-line btn-sm" data-costudy="${esc(P.study)}">Start</button>`],
      ['radio', 'Radio: say the calls for this lesson out loud', '10 min', `<button type="button" class="btn btn-line btn-sm" data-coradio="${esc(P.radio)}">Practise</button>`],
      ['chair', 'Chair-fly the lesson from start to finish', '10 min', '<button type="button" class="btn btn-line btn-sm" data-chairfly>Talk me round it</button>']
    ];
  }
  function scrubSheet() {
    const p = state.profile;
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Lesson cancelled</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body" data-scbody><p>Sorry. It happens to everyone and it isn’t wasted: turn the slot into a grounded hour built around ${p.nextLesson ? `<b>${esc(p.nextLesson)}</b>` : 'your next lesson'}.</p>
        <div class="segmented" data-screason>${[['weather', 'Weather'], ['aircraft', 'Aircraft'], ['instructor', 'Instructor'], ['me', 'Me'], ['other', 'Other']].map(([v, l], i) => `<label><input type="radio" name="r" value="${v}" ${i ? '' : 'checked'}><span>${l}</span></label>`).join('')}</div>
        <label class="field"><span>New lesson date <i>(optional)</i></span><input type="date" data-scdate value=""></label><p class="form-error" role="alert"></p></div>
      <footer class="sheet-foot"><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Cancel</button><button type="button" class="btn btn-blue" data-scgo>Show my grounded hour</button></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => sheet.close()); sheet.showModal();
    sheet.querySelector('[data-scgo]').onclick = async e => {
      e.target.disabled = true;
      const reason = sheet.querySelector('[name=r]:checked')?.value || 'other', nd = sheet.querySelector('[data-scdate]').value, lesson = p.nextLesson || '';
      const list = [...scrubsOf(), { d: p.lessonDate || todayISO(), r: reason, l: lesson.slice(0, 120), at: todayISO() }].slice(-50);
      try { await saveProfile({ scrubs: JSON.stringify(list), ...(nd ? { lessonDate: nd } : {}) }); } catch (x) { sheet.querySelector('.form-error').textContent = x.message; e.target.disabled = false; return; }
      const plan = groundedPlan(lesson), month = list.filter(s => s.at?.slice(0, 7) === todayISO().slice(0, 7)).length;
      sheet.querySelector('[data-scbody]').innerHTML = `<p>${reason === 'weather' ? 'Grounded by the weather. ' : ''}Here’s an hour that keeps you moving${nd ? `, and your lesson is now on ${esc(fmtDate(nd, { weekday: 'long', day: 'numeric', month: 'long' }))}` : ''}.</p>
        <div class="coach-plan">${plan.map(([k, t, mins, btn]) => `<div class="coach-pl"><span class="coach-min">${mins}</span><b>${esc(t)}</b>${btn}</div>`).join('')}</div>
        <p class="hint">${month > 1 ? `${month} cancellations this month. ` : ''}Students who use cancelled slots for ground work lose far less between lessons.</p>`;
      sheet.querySelector('.sheet-foot').innerHTML = '<div class="right" style="margin-left:auto"><button type="button" class="btn btn-blue" data-close>Done</button></div>';
      sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { sheet.close(); render(); });
      sheet.querySelectorAll('[data-cosim]').forEach(b => b.onclick = () => { sheet.close(); const [kind, wx, radio] = b.dataset.cosim.split('|'); if (!homeCode()) { toast('Set your home airfield in your profile first.'); return; } if (radio === '1') ui.sim.radio = true; openPractice(homeCode(), '', kind, { weather: wx || undefined }); });
      sheet.querySelectorAll('[data-costudy]').forEach(b => b.onclick = () => { sheet.close(); if (!isAdv()) return upgradeSheet('Theory practice is part of Advanced.'); location.hash = '#study'; setTimeout(() => startQuiz(b.dataset.costudy), 60); });
      sheet.querySelectorAll('[data-chairfly]').forEach(b => b.onclick = () => { sheet.close(); setTimeout(chairflySheet, 50); });
      sheet.querySelectorAll('[data-coradio]').forEach(b => b.onclick = () => { sheet.close(); if (!isAdv()) return upgradeSheet('Radio practice is part of Advanced.'); location.hash = '#radio'; setTimeout(() => radioPage(b.dataset.coradio), 60); });
    };
  }

  /* ---- you're normal: where you are against how long students really take ---- */
  // typical ranges: first solo 15–25 h (often 10–30), licence usually well above the legal minimum
  function normalCheck() {
    const p = state.profile, fl = state.flights, h = totalMin() / 60, faa = regimeOf(p) === 'faa', solo = fl.some(f => f.role === 'solo');
    const lic = R.licence(regimeOf(p), p.licence), min = lic?.minHours || (faa ? 40 : 45), typ = [Math.round(min * 1.4), Math.round(min * 1.8)];
    const stage = !solo ? { name: 'first solo', range: [12, 25], wide: [8, 35] } : { name: 'your licence', range: typ, wide: [min, Math.round(min * 2.2)] };
    const max = Math.max(stage.wide[1], h * 1.1), pos = x => Math.min(100, x / max * 100);
    let line;
    if (!fl.length) line = 'Log a flight and Boplo shows where you are against how long students usually take.';
    else if (h < stage.range[0]) line = `You’re at ${h.toFixed(1)} h. Most students reach ${stage.name} somewhere between ${stage.range[0]} and ${stage.range[1]} hours, so you’re right on track.`;
    else if (h <= stage.range[1]) line = `You’re at ${h.toFixed(1)} h, right in the usual range for ${stage.name} (${stage.range[0]}–${stage.range[1]} h). This is where most students are.`;
    else line = `You’re at ${h.toFixed(1)} h. Plenty of students take longer than ${stage.range[1]} hours to reach ${stage.name}: weather, gaps between lessons, aircraft and instructor changes all add hours. It isn’t a verdict on your ability.`;
    return { h, stage, line, pos, max, min, solo };
  }
  function normalTile(cls = 'span-12') {
    const n = normalCheck(); if (!state.flights.length) return '';
    return `<section class="tile ${cls} nrm"><div class="tile-head"><h2>Where you are</h2><span class="chip">Toward ${esc(n.stage.name)}</span></div>
      <div class="nrm-bar" role="img" aria-label="${esc(n.line)}"><span class="nrm-wide" style="left:${n.pos(n.stage.wide[0])}%;width:${n.pos(n.stage.wide[1]) - n.pos(n.stage.wide[0])}%"></span><span class="nrm-band" style="left:${n.pos(n.stage.range[0])}%;width:${n.pos(n.stage.range[1]) - n.pos(n.stage.range[0])}%"></span><i style="left:${n.pos(n.h)}%"><b>You</b></i></div>
      <div class="nrm-scale"><span>0 h</span><span>Usual range ${n.stage.range[0]}–${n.stage.range[1]} h</span><span>${Math.round(n.max)} h</span></div>
      <p>${esc(n.line)}</p>
      <p class="footnote">Typical ranges from flight-training norms; ${n.solo ? `the legal minimum for your licence is ${n.min} h, and most students finish well above it` : 'first solo depends a lot on how often you fly'}. Every student and airfield is different.</p></section>`;
  }

  /* ---- wins jar: one good moment from each lesson, shown when a lesson went badly ---- */
  const winsOf = () => sorted().filter(f => String(f.win || '').trim()).map(f => ({ t: f.win.trim(), d: f.date }));
  const roughLesson = f => { if (!f) return false; const t = String(f.notes || ''); const bad = (t.match(/\b(frustrat|awful|terrible|bad lesson|rough|struggl|disappoint|gave up|useless|not getting|hopeless|worst|nervous|anxious)/gi) || []).length; return bad > 0 || (t.split(/\n|(?<=[.!?])\s+/).filter(s => BAD_CUE.test(s)).length >= 4 && !String(f.win || '').trim()); };
  function winsTile(cls = 'span-12') {
    const w = winsOf(), last = sorted()[0]; if (!w.length && !roughLesson(last)) return '';
    const rough = roughLesson(last), show = w.filter(x => !last || x.d !== last.date || !rough).slice(0, rough ? 4 : 3);
    return `<section class="tile ${cls} wins ${rough ? 'rough' : ''}"><div class="tile-head"><h2>${rough ? 'Tough lesson? Remember these' : 'Wins jar'}</h2><span class="chip">${w.length} saved</span></div>
      ${rough ? '<p class="hint">Bad days are part of every pilot’s training. Here’s what you’ve already got right:</p>' : ''}
      ${show.length ? `<ul class="wins-list">${show.map(x => `<li><span>“${esc(x.t)}”</span><small>${esc(fmtDate(x.d, { day: 'numeric', month: 'short' }))}</small></li>`).join('')}</ul>` : '<p class="hint">Add “one thing that clicked” when you log a flight, and your wins show up here on the harder days.</p>'}</section>`;
  }

  /* ---- funding runway: how many more lessons the budget covers, and where that gets you ---- */
  function fundingRunway() {
    const fc = forecast(), p = state.profile, fl = sorted().slice(0, 6);
    if (!fc.budget || !fc.hasRates) return null;
    const avgMin = fl.length ? fl.reduce((a, f) => a + f.minutes, 0) / fl.length : 60, perLesson = fc.perHour * avgMin / 60;
    const left = fc.budget - fc.spent - fc.extrasPaid - fc.extrasDue; if (!(perLesson > 0)) return null;
    const lessons = Math.max(0, Math.floor(left / perLesson)), hoursAt = totalMin() / 60 + lessons * avgMin / 60, n = normalCheck();
    const reach = !n.solo && hoursAt >= n.stage.range[0] ? 'enough to get you to the usual first-solo range' : n.solo && hoursAt >= n.stage.range[0] ? 'enough to reach the usual range for finishing your licence' : hoursAt >= (n.min || 45) ? 'enough for the legal minimum hours, though most students need more' : '';
    return { lessons, perLesson, avgMin, hoursAt, left, reach, fast: fc.fast };
  }
  function runwayTile(cls = 'span-12') {
    const r = fundingRunway(); if (!r) return '';
    return `<section class="tile ${cls} fund"><div class="tile-head"><h2>Funding runway</h2><span class="chip ${r.lessons <= 3 ? 'warn' : ''}">${r.lessons} lesson${r.lessons === 1 ? '' : 's'} left</span></div>
      <p class="fund-big"><b>${r.lessons}</b> more lesson${r.lessons === 1 ? '' : 's'} of about ${Math.round(r.avgMin)} min at ${esc(money(r.perLesson))} each, taking you to about <b>${r.hoursAt.toFixed(0)} h</b>${r.reach ? `, ${r.reach}` : ''}.</p>
      ${r.fast ? `<p class="hint">Booking lessons closer together is the cheapest way through: students flying twice a week usually need about ${r.fast.saveH} fewer hours${r.fast.save ? `, around ${esc(money(r.fast.save))} saved` : ''}. Block-book the next few if your school offers it.</p>` : '<p class="hint">You’re flying often enough to keep re-learning to a minimum. Keep it up.</p>'}</section>`;
  }

  /* ---- the morning of a lesson: what to bring, three things to remember, and a kneeboard ---- */
  const BRING = faa => ['Headset', faa ? 'Student pilot certificate and photo ID' : 'Licence or student documents, and photo ID', 'Medical certificate', 'Logbook', 'Kneeboard, pen and a chart', 'Sunglasses and water', faa ? 'Your endorsements (if flying solo)' : 'Your instructor’s sign-off (if flying solo)'];
  const remindersFor = () => {
    const out = [], top = recurringIssues().list[0]; if (top) out.push(top.I.drills[0]);
    const last = sorted()[0]; String(last?.notes || '').split(/\n|(?<=[.!?])\s+/).map(s => s.trim().replace(/^[-•*]\s*/, '')).filter(s => s && BAD_CUE.test(s)).slice(0, 2).forEach(s => out.push(s));
    const q = String(state.profile.questions || '').split('\n').map(s => s.trim()).filter(Boolean)[0]; if (q) out.push(`Ask: ${q}`);
    return [...new Set(out)].slice(0, 3);
  };
  const bringKey = () => 'boplo-bring-' + (state.profile.lessonDate || '');
  function lessonDayTile(cls = 'span-12') {
    const p = state.profile, d = p.lessonDate ? daysUntil(p.lessonDate) : null, evening = new Date().getHours() >= 17;
    if (!(d === 0 || (d === 1 && evening))) return '';
    let got = {}; try { got = JSON.parse(localStorage.getItem(bringKey()) || '{}'); } catch { }
    const rem = remindersFor(), bring = BRING(regimeOf(p) === 'faa');
    return `<section class="tile dark ${cls} lday">${contours('a')}<div class="lday-in">
      <div><span class="kicker">${d === 0 ? 'Lesson day' : 'Tomorrow'}${p.lessonTime ? ' · ' + esc(p.lessonTime) : ''}</span><h2 class="display">${esc(p.nextLesson || 'Your lesson')}</h2>
        ${rem.length ? `<h3>Three things to remember</h3><ol class="lday-rem">${rem.map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
        <div class="lday-acts"><button type="button" class="btn btn-light btn-has-spark" data-kneeboard>Print my kneeboard ${spark}</button><button type="button" class="btn btn-line-light" data-chairfly>Chair-fly the circuit</button></div></div>
      <div class="lday-bring"><h3>Bring</h3>${bring.map((b, i) => `<label><input type="checkbox" data-bring="${i}" ${got[i] ? 'checked' : ''}><span>${esc(b)}</span></label>`).join('')}</div></div></section>`;
  }
  async function printKneeboard() {
    const p = state.profile, code = homeCode(), af = code ? await anyAirfield(code) : null, P = window.BoploPreflight, T = P?.TYPES?.[pfType(p)], sp = T?.speeds || {};
    const ends = af ? await runwayEnds(af).catch(() => []) : [], S = pfStore(), e = ends.find(x => x.id === S.cond?.rw) || ends[0];
    const hdg = e ? Math.round(e.hdg) : 0, left = true, elev = af?.elev ?? null, faa = regimeOf(p) === 'faa', tpa = faa ? 1000 : 1000;
    const freqs = (af?.freqs || []).slice(0, 6).map(f => `<tr><td>${esc(f[0])}</td><td>${esc(f[1] || '')}</td><td><b>${esc(String(f[2]))}</b></td></tr>`).join('');
    // a circuit diagram drawn for the runway heading, left-hand unless the pilot's school says otherwise
    const rot = hdg - 90, circuit = `<svg viewBox="-130 -130 260 260" width="240" height="240" style="border:1px solid #ccc;border-radius:8px"><text x="0" y="-116" text-anchor="middle" font-size="11" font-family="Arial">N ↑</text><g transform="rotate(${rot})">
      <rect x="-45" y="-6" width="90" height="12" fill="#222"/><text x="-40" y="4" fill="#fff" font-size="9" font-family="Arial">${esc(e?.id || '')}</text>
      <path d="M45 0 H85 V${left ? -70 : 70} H-85 V0 H-45" fill="none" stroke="#0A62FF" stroke-width="3"/>
      <path d="M6 ${left ? -76 : 64} L-6 ${left ? -70 : 70} L6 ${left ? -64 : 76} Z" fill="#0A62FF"/><text x="0" y="${left ? -78 : 86}" text-anchor="middle" font-size="9" font-family="Arial" fill="#0A62FF">downwind</text></g></svg>
      <p style="margin:6px 0 0;font-size:11px">Runway ${esc(e?.id || '—')} · ${left ? 'left' : 'right'}-hand · circuit ${tpa} ft above the field${elev != null ? ` (${elev + tpa} ft QNH)` : ''}</p>`;
    const rem = remindersFor(), cs = radioScenarios();
    printDoc('Kneeboard', `<h1>${esc(af?.name || code || 'Airfield')} ${code ? `(${esc(code)})` : ''}</h1><p class="meta">${esc(p.nextLesson || 'Lesson')} · ${esc(p.lessonDate ? fmtDate(p.lessonDate, { weekday: 'short', day: 'numeric', month: 'short' }) : '')} · ${esc(T?.name || p.aircraft || '')} ${esc(p.registration || '')} · callsign ${esc(cs.cs)}</p>
      <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap"><div>${circuit}</div>
      <table style="width:auto;min-width:240px"><tbody><tr><th colspan="2">Speeds (check your POH)</th></tr><tr><td>Rotate</td><td>${sp.vr || '—'} kt</td></tr><tr><td>Best rate climb (Vy)</td><td>${sp.vy || '—'} kt</td></tr><tr><td>Approach</td><td>${sp.vref ? sp.vref + 5 : '—'} kt</td></tr><tr><td>Threshold</td><td>${sp.vref || '—'} kt</td></tr><tr><td>Field elevation</td><td>${elev != null ? elev + ' ft' : '—'}</td></tr><tr><td>Runway ${esc(e?.id || '')}</td><td>${e?.len ? Math.round(e.len) + ' m' : '—'}</td></tr></tbody></table></div>
      ${freqs ? `<h3>Frequencies</h3><table><tbody>${freqs}</tbody></table>` : ''}
      <h3>Weather</h3><table><tbody><tr><td style="width:25%">ATIS / info</td><td></td></tr><tr><td>Wind</td><td></td></tr><tr><td>QNH</td><td></td></tr><tr><td>Runway in use</td><td></td></tr></tbody></table>
      ${rem.length ? `<h3>Remember</h3><ol>${rem.map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
      <h3>Notes</h3><div style="height:120px;border:1px solid #999"></div>
      <p class="small">Prepared with Boplo Flight. Circuit direction and heights vary by airfield: follow the published procedures and your instructor.</p>`);
  }

  /* ---- guided chair-fly: a spoken walk-through of the circuit, with pauses to say each call ---- */
  function chairflyScript() {
    const p = state.profile, faa = regimeOf(p) === 'faa', T = window.BoploPreflight?.TYPES?.[pfType(p)], sp = T?.speeds || { vr: 55, vy: 75, vref: 65 }, S = pfStore();
    const rw = S.cond?.rw || '', rwT = rw ? rw.split('').map(c => /\d/.test(c) ? ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'][+c] : c === 'L' ? 'left' : c === 'R' ? 'right' : '').join(' ') : '', RW = rwT ? `runway ${rwT}` : 'the runway', place = String(p.airport || '').split('·')[1]?.trim().replace(/\s+(Airfield|Airport|Aerodrome)$/i, '') || 'the airfield', rs = radioScenarios();
    const abbr = faa ? `${(p.aircraft || 'Cessna').split(/\s/)[0]} ${rs.cs.split(' ').slice(-3).join(' ')}` : rs.cs.split(' ').filter((_, i, a) => i === 0 || i >= a.length - 2).join(' ');
    return [
      { t: 'Holding point', say: `You’re at the holding point for ${RW}. Hands on the controls. Do your power checks and pre take-off checks now, out loud.`, wait: 14 },
      { t: 'Ready call', say: 'Make your ready for departure call.', call: faa ? `${place} traffic, ${abbr}, departing ${RW}, remaining in the pattern, ${place}.` : `${abbr}, ready for departure.`, wait: 7 },
      { t: 'Line up', say: `Line up on the centreline. Look along the runway. Final checks: lights, transponder, fuel pump.`, wait: 6 },
      { t: 'Take-off roll', say: `Full power. Engine instruments in the green. Airspeed alive. Keep it straight with your feet.${sp.vr ? ` At ${sp.vr} knots, ease back and rotate.` : ''}`, wait: 7 },
      { t: 'Climb', say: `Pitch for the climb attitude${sp.vy ? ` and ${sp.vy} knots` : ''}. Trim. Keep the ball in the middle.`, wait: 7 },
      { t: '500 feet', say: 'At 500 feet: after take-off checks. Lookout left. Turn crosswind.', wait: 7 },
      { t: 'Circuit height', say: 'Approaching circuit height: level off. Attitude, let the speed build, power back, trim.', wait: 7 },
      { t: 'Downwind', say: 'Lookout, turn downwind. Check your spacing from the runway. Make your downwind call.', call: faa ? `${place} traffic, ${abbr}, left downwind ${RW}, full stop, ${place}.` : `${abbr}, downwind to land.`, wait: 8 },
      { t: 'Downwind checks', say: `Before-landing checks now${faa ? ', GUMPS' : ', BUMPFH or FREDA, as your school teaches'}. Say each item.`, wait: 12 },
      { t: 'Base', say: 'Abeam the end of the runway: power back, first stage of flap, start the descent. Lookout, turn base.', wait: 8 },
      { t: 'Final turn', say: 'Lookout along the approach. Turn final. Line up with the centreline.', wait: 6 },
      { t: 'Final call', say: 'Make your final call.', call: faa ? `${place} traffic, ${abbr}, final ${RW}, full stop, ${place}.` : `${abbr}, final.`, wait: 6 },
      { t: 'Approach', say: `Landing flap.${sp.vref ? ` ${sp.vref + 5} knots, slowing to ${sp.vref} over the threshold.` : ''} Pick your aim point and keep it still in the windscreen. Power for the glidepath, attitude for the speed.`, wait: 9 },
      { t: 'Flare', say: 'Over the threshold: power to idle. Eyes to the far end. Ease back, hold it off, let it settle. Keep it straight on the rollout.', wait: 9 },
      { t: 'Vacate', say: 'Slow to walking pace, vacate the runway, stop. After-landing checks. Well done: that was one circuit.', wait: 4 }
    ];
  }
  function chairflySheet() {
    const steps = chairflyScript(), synth = window.speechSynthesis;
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Chair-fly a circuit</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body"><p class="hint">Sit down, close your eyes if you like, and move your hands and feet as if you’re flying. Boplo talks you round and pauses for you to do each step and say the calls out loud. About four minutes.</p>
        <ol class="cf-steps">${steps.map((s, i) => `<li data-cf="${i}"><b>${esc(s.t)}</b><span>${esc(s.say)}</span>${s.call ? `<em>Say: “${esc(s.call)}”</em>` : ''}</li>`).join('')}</ol></div>
      <footer class="sheet-foot"><label class="sim-radio-opt" style="align-items:center"><input type="checkbox" data-cfvoice ${synth ? 'checked' : 'disabled'}> Read it out loud</label><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-cfstop>Stop</button><button type="button" class="btn btn-blue btn-has-spark" data-cfgo>Start ${spark}</button></div></footer>`;
    let i = -1, timer = 0, run = false;
    const stop = () => { run = false; clearTimeout(timer); try { synth?.cancel(); } catch { } sheet.querySelector('[data-cfgo]').innerHTML = `Start ${spark}`; };
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { stop(); sheet.close(); });
    sheet.addEventListener('close', stop, { once: true });
    const show = k => { sheet.querySelectorAll('[data-cf]').forEach(li => { li.classList.toggle('on', +li.dataset.cf === k); li.classList.toggle('done', +li.dataset.cf < k); }); sheet.querySelector(`[data-cf="${k}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
    const voiceOn = () => sheet.querySelector('[data-cfvoice]')?.checked && synth;
    const next = () => {
      if (!run) return; i++; if (i >= steps.length) { stop(); i = -1; toast('Circuit complete. Do it again tomorrow and it sticks.'); return; }
      const s = steps[i]; show(i);
      const after = () => { if (run) timer = setTimeout(next, s.wait * 1000); };
      if (voiceOn()) { const u = new SpeechSynthesisUtterance(s.say); u.rate = 1; u.lang = regimeOf(state.profile) === 'faa' ? 'en-US' : 'en-GB'; let done = false; const fin = () => { if (!done) { done = true; after(); } }; u.onend = fin; u.onerror = fin; setTimeout(fin, 2000 + s.say.length * 80); synth.cancel(); synth.speak(u); }
      else timer = setTimeout(next, (s.wait + s.say.length / 18) * 1000);
    };
    sheet.querySelector('[data-cfgo]').onclick = e => { if (run) { stop(); return; } run = true; e.currentTarget.textContent = 'Pause'; if (i >= steps.length - 1) i = -1; i = Math.max(-1, i - 1); next(); };
    sheet.querySelector('[data-cfstop]').onclick = () => { stop(); i = -1; show(-1); };
    sheet.showModal();
  }

  /* ---- milestone moments: celebrate the moment a logged flight crosses one ---- */
  function celebrate(m) {
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">${esc(m.title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body celebrate"><div class="cel-burst" aria-hidden="true"><svg><use href="#spark"/></svg></div><p class="cel-big">${esc(m.big)}</p><p>${m.title === 'First solo' ? 'Your first solo. Every pilot remembers this one.' : m.title.includes('hours') ? `That’s ${esc(m.big)} hours in your logbook. Real progress.` : 'A moment worth marking.'}</p></div>
      <footer class="sheet-foot"><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Later</button><button type="button" class="btn btn-blue btn-has-spark" data-celshare>Make a share card ${spark}</button></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => sheet.close());
    sheet.querySelector('[data-celshare]').onclick = () => { sheet.close(); setTimeout(() => shareCard(m), 50); };
    sheet.showModal();
  }
  function wireCoach2(again) {
    $$('[data-bring]').forEach(i => i.onchange = () => { let g = {}; try { g = JSON.parse(localStorage.getItem(bringKey()) || '{}'); } catch { } g[i.dataset.bring] = i.checked; try { localStorage.setItem(bringKey(), JSON.stringify(g)); } catch { } });
    $$('[data-kneeboard]').forEach(b => b.onclick = printKneeboard);
    $$('[data-chairfly]').forEach(b => b.onclick = chairflySheet);
  }

  function overview() {
    const p = state.profile, list = sorted(), last30 = inLast(30), checks = parseChecks(p.checklist);
    const done = checks.filter(c => c.done).length, goal = Number(p.goalHours || 0), total = totalMin() / 60;
    const pct = goal ? Math.min(1, total / goal) : 0, C = 2 * Math.PI * 64;
    const dLesson = p.lessonDate ? daysUntil(p.lessonDate) : null;
    const when = dLesson == null ? 'No date set' : dLesson === 0 ? 'Today' : dLesson === 1 ? 'Tomorrow' : dLesson > 1 ? `In ${dLesson} days` : `${-dLesson} days ago`;
    const firstQ = String(p.questions || '').split('\n').map(s => s.trim()).filter(Boolean)[0];
    const latest = list.find(f => f.points?.length);
    const hour = new Date().getHours(), greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    shell('overview', { title: `${greet}, ${esc(firstName(p.name))}.`, sub: list.length ? `${list.length} flight${list.length === 1 ? '' : 's'} logged, ${hrs(totalMin())} hours recorded in total.` : 'Log your first flight and your desk starts filling in.' },
      `<div class="grid">${lessonDayTile()}${coachTile()}
        <section class="tile dark next span-7" aria-labelledby="next-h">${contours('b')}
          <div class="tile-head"><h2 id="next-h">Up next</h2><span class="chip">${esc(when)}</span></div>
          <h3 class="display">${esc(p.nextLesson || 'Add your next lesson')}</h3>
          <div class="next-meta">${p.lessonDate ? `<span><b>${esc(fmtDate(p.lessonDate, { weekday: 'long', day: 'numeric', month: 'long' }))}</b></span>` : ''}${p.airport ? `<span>${esc(p.airport)}</span>` : ''}${p.aircraft ? `<span>${esc(p.aircraft)}</span>` : ''}</div>
          ${firstQ ? `<p class="next-q">${esc(firstQ)}</p>` : ''}
          <div class="next-foot">
            ${checks.length ? `<span class="progress"><span class="progress-bar"><i style="width:${checks.length ? done / checks.length * 100 : 0}%"></i></span>${done} of ${checks.length} prepared</span>` : '<span class="progress">No preparation checklist yet</span>'}
            <span style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${p.lessonDate && dLesson >= 0 && dLesson <= 3 ? '<button type="button" class="link light" data-scrub>Lesson cancelled?</button>' : ''}<a class="btn btn-light btn-has-spark" href="#prepare">Prepare ${spark}</a></span>
          </div>
        </section>

        <section class="tile span-5" aria-labelledby="goal-h">
          <div class="tile-head"><h2 id="goal-h">Toward your licence</h2><a class="link" href="#profile">Edit</a></div>
          <div class="goal">
            <div class="ring" role="img" aria-label="${goal ? `${total.toFixed(1)} of a ${goal} hour goal` : `${total.toFixed(1)} hours recorded`}">
              <svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="64"/><circle class="fill" cx="75" cy="75" r="64" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/></svg>
              <div><b class="num">${total.toFixed(1)}</b><span>${goal ? `of ${goal} h goal` : 'hours recorded'}</span></div>
            </div>
            <dl>
              <div><dt>Licence</dt><dd>${esc(p.licence || '—')}</dd></div>
              <div><dt>Authority</dt><dd>${esc(p.authority || '—')}</dd></div>
              <div><dt>Target date</dt><dd>${p.target ? esc(fmtDate(p.target, { month: 'long', year: 'numeric' })) : '<a class="link" href="#profile">Set a date</a>'}</dd></div>
            </dl>
          </div>
          ${(() => { const l = R.licence(regimeOf(p), p.licence); return l?.minHours ? `<p class="footnote">Published minimum for ${esc(l.id)}: ${l.minHours} h. <a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.source)}</a></p>` : ''; })()}
          ${goal ? '' : '<p class="footnote">Set an hours goal in your profile to see progress here.</p>'}
        </section>

        ${coachTiles()}${roughLesson(sorted()[0]) ? winsTile() : ''}
        <section class="stats span-12" aria-label="Totals">
          <div class="stat"><span>Total time</span><b>${hrs(totalMin())}<small>h</small></b><em>${p.openingMinutes ? `Includes ${hrs(p.openingMinutes)} h from before` : 'From your logged flights'}</em></div>
          <div class="stat"><span>Last 30 days</span><b>${hrs(sum(last30, f => f.minutes))}<small>h</small></b><em>${last30.length} flight${last30.length === 1 ? '' : 's'}</em></div>
          <div class="stat"><span>Landings</span><b>${sum(state.flights, f => f.landings)}</b><em>Across all flights</em></div>
          <div class="stat"><span>Solo and PIC</span><b>${hrs(sum(state.flights.filter(f => f.role !== 'dual'), f => f.minutes))}<small>h</small></b><em>${hrs(sum(state.flights.filter(f => f.role === 'dual'), f => f.minutes))} h dual</em></div>
        </section>

        ${momentumTile()}
        ${(() => { const rq = requirements(); return rq ? reqTile(rq, { short: true, cls: 'span-7' }) : `<section class="tile span-7"><div class="tile-head"><h2>Licence checklist</h2></div><p class="hint">Choose a licence in your profile to see what it needs.</p></section>`; })()}
        ${forecastTile()}
        <section class="tile span-5" aria-labelledby="studyt-h">
          ${(() => { const st = studyOf(p), last = (st._mocks || []).slice(-1)[0], pm = QB ? QB.passMark(regimeOf(p)) : 75, seen = QB ? QB.questions.filter(q => st[q.id]).length : 0; return `<div class="tile-head"><h2 id="studyt-h">Theory</h2><a class="link" href="#study">Study</a></div>
          ${last ? `<div class="study-last"><b class="${last.s >= pm ? 'pass' : 'fail'}">${last.s}%</b><span>Last mock exam · pass mark ${pm}%</span></div>` : `<p class="hint" style="margin-bottom:14px">${seen ? `${seen} questions practised so far.` : 'Practise theory between lessons in short sessions.'}</p>`}
          <a class="btn btn-ink btn-has-spark" href="#study">${seen ? 'Keep practising' : 'Start practising'} ${spark}</a>`; })()}
        </section>

        <section class="tile span-7" aria-labelledby="recent-h">
          <div class="tile-head"><h2 id="recent-h">Recent flights</h2>${list.length ? '<a class="link" href="#logbook">Open logbook</a>' : ''}</div>
          ${list.length ? `<div class="flist">${flightRows(list.slice(0, 5))}</div>` : `<div class="empty"><h3>Your first flight goes here.</h3><p>Log the time, role, landings and what you learned while it’s fresh.</p><button class="btn btn-blue btn-has-spark" data-add>Log a flight ${spark}</button></div>`}
        </section>

        <section class="tile span-5" aria-labelledby="track-h">
          <div class="tile-head"><h2 id="track-h">Latest track</h2>${latest ? `<div style="display:flex;gap:14px;align-items:center"><a class="link" href="#map">Open map</a><button class="btn btn-blue btn-sm" data-flyagain="${esc(latest.id)}">Fly it again</button></div>` : ''}</div>
          <div class="mini">${latest ? trackSVG([latest], 480, 300) : `<div class="mini-empty"><b>No track yet</b>Add coordinates to a flight and its route is drawn here.</div>`}</div>
          ${latest ? `<div class="mini-meta"><span><b>${esc(upper(latest.departure))} → ${esc(upper(latest.arrival))}</b> · ${esc(fmtDate(latest.date))}</span><span>${hm(latest.minutes)} · ${esc(roleName(latest.role))}</span></div>` : ''}
        </section>
      </div>`);
    wireMomentum(); wireCoach(overview); wireCoach2(overview);
  }

  function logbook() {
    const q = ui.q.toLowerCase();
    const list = sorted().filter(f => (ui.role === 'all' || f.role === ui.role) && (!q || [f.departure, f.arrival, f.aircraft, f.registration, f.instructor, f.lesson, f.notes, f.date].join(' ').toLowerCase().includes(q)));
    const totalM = sum(list, f => f.minutes);
    shell('logbook', { title: 'Logbook', sub: 'Every flight you’ve logged, with the context behind it.', actions: `${state.flights.length ? '<button class="btn btn-line" data-print>Print</button><button class="btn btn-line" data-csv>Export CSV</button>' : ''}<button class="btn btn-line" data-import>Import</button><button class="btn btn-line" data-record>${ico('map')} Record</button><button class="btn btn-blue btn-has-spark" data-add>Log a flight ${spark}</button>` },
      state.flights.length ? `
      <div class="toolbar">
        <label class="search">${ico('search')}<span class="sr">Search flights</span><input type="search" data-q value="${esc(ui.q)}" placeholder="Search airfield, lesson, aircraft…"></label>
        <div class="filter" role="group" aria-label="Role">${[['all', 'All'], ['dual', 'Dual'], ['solo', 'Solo'], ['pic', 'PIC']].map(([v, l]) => `<button data-role="${v}" aria-pressed="${ui.role === v}">${l}</button>`).join('')}</div>
        <span class="count" aria-live="polite">${list.length} flight${list.length === 1 ? '' : 's'} · ${hm(totalM)} h${!isAdv() ? ` · <a class="link" href="#plan">${state.flights.length} of ${B().limits.flights} on Free</a>` : ''}</span>
      </div>
      ${list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Route</th><th>Aircraft</th><th>Lesson</th><th>Role</th><th class="r">Landings</th><th class="r">Time</th></tr></thead>
        <tbody>${list.map(f => `<tr data-flight="${esc(f.id)}" tabindex="0" aria-label="Open flight on ${esc(fmtDate(f.date))}">
          <td>${esc(fmtDate(f.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
          <td class="route">${esc(upper(f.departure))} → ${esc(upper(f.arrival))}</td>
          <td>${esc([f.aircraft, f.registration].filter(Boolean).join(' · ') || '—')}</td>
          <td class="lesson">${esc(f.lesson || '—')}</td>
          <td><span class="chip role-${esc(f.role)}"><i></i>${esc(roleName(f.role))}</span></td>
          <td class="r">${f.landings}</td><td class="r"><b>${hm(f.minutes)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5">${list.length} flight${list.length === 1 ? '' : 's'}</td><td class="r">${sum(list, f => f.landings)}</td><td class="r">${hm(totalM)}</td></tr></tfoot>
      </table></div>
      <div class="cards">${list.map(f => `<button class="card" data-flight="${esc(f.id)}"><span class="froute"><b>${esc(upper(f.departure))} → ${esc(upper(f.arrival))}</b><small>${esc(fmtDate(f.date))} · ${esc(roleName(f.role))} · ${f.landings} ldg</small></span><span class="ftime">${hm(f.minutes)}</span><small style="color:var(--ink-3);font-size:13px;grid-column:1">${esc(f.lesson || f.aircraft || '')}</small></button>`).join('')}</div>`
        : `<div class="tile empty center"><h3>No flights match.</h3><p>Try a different search or role.</p><button class="btn btn-line" data-clear>Clear filters</button></div>`}`
        : `<div class="tile empty center"><h3>Your logbook is empty.</h3><p>Each flight you log keeps its time, role, landings and debrief together.</p><button class="btn btn-blue btn-has-spark" data-add>Log your first flight ${spark}</button></div>`);
    const qi = $('[data-q]');
    if (qi) qi.oninput = () => { ui.q = qi.value; const pos = qi.selectionStart; logbook(); const n = $('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); };
    $$('[data-role]').forEach(b => b.onclick = () => { ui.role = b.dataset.role; logbook(); });
    const c = $('[data-clear]'); if (c) c.onclick = () => { ui.q = ''; ui.role = 'all'; logbook(); };
    const pb = $('[data-print]'); if (pb) pb.onclick = printLogbook;
    const cb = $('[data-csv]'); if (cb) cb.onclick = exportCSV;
    $('[data-import]').onclick = gateOr('Importing flights', importSheet);
    $$('tbody tr').forEach(tr => tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tr.click(); } });
  }

  function mapPage() {
    const list = sorted().filter(f => f.points?.length);
    const sel = list.some(f => f.id === ui.mapSel) ? ui.mapSel : null;
    shell('map', { title: 'Map', sub: 'Your routes on a live chart with the real airfields in your country. Tap an airfield for its runways and frequencies.' },
      `<div class="grid">
        <section class="span-8"><div class="mapbox" data-mapbox>${trackSVG(list, 800, 560, sel)}<div class="map-legend"><span><i></i>Recorded track</span><span><i class="dash"></i>Plotted or start to end</span></div></div>
          <p class="map-note"><span data-afcount></span> For reviewing your records only, not for navigation.</p></section>
        <section class="tile span-4"><div class="tile-head"><h2>Flights with routes</h2>${sel ? '<button class="link" data-all>Show all</button>' : ''}</div>
          ${list.length ? '' : `<div class="empty"><p>No routes yet. When you log a flight, choose <b>Plot on the map</b> or pick airfields for From and To.</p><button class="btn btn-blue btn-has-spark" data-add>Log a flight ${spark}</button></div>`}
          <div class="track-list">${list.map(f => `<button class="track-item" data-sel="${esc(f.id)}" aria-pressed="${sel === f.id}"><span><b>${esc(upper(f.departure))} → ${esc(upper(f.arrival))}</b><small>${esc(fmtDate(f.date))} · ${esc(f.lesson || roleLong(f.role))}</small></span><span class="ftime">${hm(f.minutes)}</span></button>`).join('')}</div>
        </section></div>`);
    $$('[data-sel]').forEach(b => b.onclick = () => {
      ui.mapSel = ui.mapSel === b.dataset.sel ? null : b.dataset.sel;
      if (chart && $('[data-mapbox]')?.classList.contains('live')) { chart.select(ui.mapSel); $$('[data-sel]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.sel === ui.mapSel))); }
      else mapPage();
    });
    const all = $('[data-all]'); if (all) all.onclick = () => { ui.mapSel = null; if (chart) { chart.select(null); $$('[data-sel]').forEach(x => x.setAttribute('aria-pressed', 'false')); } else mapPage(); };
    chartMap(list, sel);
  }

  let chart = null;
  async function chartMap(list, sel) {
    const box = $('[data-mapbox]'); if (!box || !window.BoploMap) return;
    const holder = document.createElement('div'); holder.className = 'gmap'; box.prepend(holder);
    try {
      chart?.destroy?.();
      chart = await BoploMap.mountOverview(holder, { country: countryCodeOf(state.profile), home: upper(state.profile.airport).split(/[\s·]/)[0], flights: list, selected: sel, onCount: n => { const c = $('[data-afcount]'); if (c) c.textContent = n ? `${n.toLocaleString('en-GB')} airfields in ${R.nameFor(countryCodeOf(state.profile))}.` : ''; } });
      if (!holder.isConnected) { chart.destroy(); return; }
      const svg = box.querySelector(':scope > svg'); if (svg) svg.style.display = 'none';
      box.classList.add('live');
    } catch { holder.remove(); }
  }

  let mapsReady;
  async function googleMap(list, sel) {
    const box = $('[data-mapbox]'); if (!box) return;
    try {
      mapsReady = mapsReady || new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(state.mapsKey) + '&callback=__boploMaps&loading=async';
        window.__boploMaps = res; s.onerror = () => rej(new Error('Map service unavailable.'));
        setTimeout(() => rej(new Error('Map service timed out.')), 15000); document.head.append(s);
      });
      await mapsReady; if (!box.isConnected) return;
      const el = document.createElement('div'); el.className = 'gmap'; box.prepend(el);
      const map = new google.maps.Map(el, { mapTypeId: 'hybrid', streetViewControl: false, mapTypeControl: false, fullscreenControl: true, center: list[0].points[0], zoom: 9 });
      const b = new google.maps.LatLngBounds();
      list.forEach(f => { const on = !sel || sel === f.id; f.points.forEach(p => b.extend(p)); new google.maps.Polyline({ map, path: f.points, geodesic: f.routeKind !== 'track', strokeColor: on ? '#9ED8FF' : '#5B86C9', strokeOpacity: on ? 1 : .45, strokeWeight: on ? 3 : 2 }); });
      map.fitBounds(b, 48);
      const svg = box.querySelector('svg'); if (svg) svg.style.display = 'none';
    } catch { mapsReady = null; }
  }

  function analytics() {
    const r = ui.range, days = r === 'all' ? null : Number(r), list = days ? inLast(days) : state.flights;
    const nMonths = r === '90' ? 3 : 12;
    const months = Array.from({ length: nMonths }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (nMonths - 1) + i); return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en-GB', { month: 'short' }) }; });
    const per = months.map(m => { const fs = state.flights.filter(f => f.date.startsWith(m.key)); return { dual: sum(fs.filter(f => f.role === 'dual'), f => f.minutes), solo: sum(fs.filter(f => f.role === 'solo'), f => f.minutes), pic: sum(fs.filter(f => f.role === 'pic'), f => f.minutes) }; });
    const max = Math.max(60, ...per.map(x => x.dual + x.solo + x.pic));
    const total = sum(list, f => f.minutes);
    const airports = {}; list.forEach(f => new Set([upper(f.departure), upper(f.arrival)].filter(Boolean)).forEach(k => { airports[k] = (airports[k] || 0) + 1; }));
    const topA = Object.entries(airports).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const avg = list.length ? total / list.length : 0;
    const colors = { dual: 'var(--dual)', solo: 'var(--solo)', pic: 'var(--pic)' };
    shell('analytics', { title: 'Analytics', sub: 'Your flying, measured from your own records.', actions: `<div class="filter" role="group" aria-label="Period">${[['90', '90 days'], ['365', '12 months'], ['all', 'All time']].map(([v, l]) => `<button data-range="${v}" aria-pressed="${r === v}">${l}</button>`).join('')}</div>` },
      `<div class="grid">
        <section class="stats span-12" aria-label="Totals for this period">
          <div class="stat"><span>Flight time</span><b>${hrs(total)}<small>h</small></b><em>${r === 'all' ? 'All logged flights' : `Last ${r === '90' ? '90 days' : '12 months'}`}</em></div>
          <div class="stat"><span>Flights</span><b>${list.length}</b><em>${list.length ? `Average ${hm(avg)}` : 'None in this period'}</em></div>
          <div class="stat"><span>Landings</span><b>${sum(list, f => f.landings)}</b><em>${list.length ? `${(sum(list, f => f.landings) / list.length).toFixed(1)} per flight` : '—'}</em></div>
          <div class="stat"><span>Airfields</span><b>${Object.keys(airports).length}</b><em>Visited or departed</em></div>
        </section>
        <section class="tile span-8" aria-labelledby="m-h">
          <div class="tile-head"><h2 id="m-h">Hours by month</h2><div class="legend"><span><i style="background:var(--dual)"></i>Dual</span><span><i style="background:var(--solo)"></i>Solo</span><span><i style="background:var(--pic)"></i>PIC</span></div></div>
          <div class="chart" role="img" aria-label="${months.map((m, i) => `${m.label}: ${hrs(per[i].dual + per[i].solo + per[i].pic)} hours`).join(', ')}">
            ${months.map((m, i) => { const t = per[i].dual + per[i].solo + per[i].pic; return `<div class="col"><small>${t ? hrs(t) : ''}</small><div class="stack" style="height:${Math.max(1, t / max * 88)}%">${['dual', 'solo', 'pic'].map(k => per[i][k] ? `<i style="height:${per[i][k] / t * 100}%;background:${colors[k]}"></i>` : '').join('')}</div><span>${m.label}</span></div>`; }).join('')}
          </div>
        </section>
        <section class="tile span-4" aria-labelledby="r-h">
          <div class="tile-head"><h2 id="r-h">Time by role</h2></div>
          <div class="bars">${['dual', 'solo', 'pic'].map(k => { const n = sum(list.filter(f => f.role === k), f => f.minutes); return `<div class="bar-row"><div><span>${roleLong(k)}</span><b>${hrs(n)} h</b></div><div class="bar-track"><i style="width:${total ? n / total * 100 : 0}%;background:${colors[k]}"></i></div></div>`; }).join('')}</div>
          <p class="footnote">From your own entries. It doesn’t decide what counts toward a licence.</p>
        </section>
        <section class="tile span-6" aria-labelledby="a-h">
          <div class="tile-head"><h2 id="a-h">Airfields</h2></div>
          ${topA.length ? `<div class="airports">${topA.map(([k, n]) => `<div><b>${esc(k)}</b><span>${n} flight${n === 1 ? '' : 's'}</span></div>`).join('')}</div>` : '<p class="hint">No flights in this period.</p>'}
        </section>
        <section class="tile span-6" aria-labelledby="l-h">
          <div class="tile-head"><h2 id="l-h">Recent lessons</h2></div>
          ${list.length ? `<div class="flist">${flightRows(sorted().filter(f => list.includes(f)).slice(0, 4))}</div>` : '<p class="hint">No flights in this period.</p>'}
        </section>
      </div>
      <p class="footnote">Hours you had before joining (${hrs(state.profile.openingMinutes)} h) aren’t included in dated charts.</p>`);
    $$('[data-range]').forEach(b => b.onclick = () => { ui.range = b.dataset.range; analytics(); });
  }

  // ---- calendar: one lesson as an .ics file, or a live subscription with lessons, exams and expiry dates ----
  function downloadICS(title, date, time, where) {
    if (!date) { toast('Set the lesson date first.'); return; }
    const d = date.replace(/-/g, ''), e = s => String(s || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const [h, m] = (time || '').split(':').map(Number), timed = Number.isFinite(h);
    const end = timed ? (h >= 22 ? '235900' : String(h + 2).padStart(2, '0') + String(m).padStart(2, '0') + '00') : '';
    const nd = (() => { const x = new Date(date + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ''); })();
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Boplo//Flight desk//EN', 'BEGIN:VEVENT', `UID:lesson-${d}-${Math.random().toString(36).slice(2)}@boplo.app`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
      timed ? `DTSTART:${d}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00` : `DTSTART;VALUE=DATE:${d}`, timed ? `DTEND:${d}T${end}` : `DTEND;VALUE=DATE:${nd}`,
      `SUMMARY:${e('Flying lesson' + (title ? ': ' + title : ''))}`, where ? `LOCATION:${e(where)}` : '', 'DESCRIPTION:Prepare in Boplo: https://boplo.app/flight-app.html#prepare', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Flying lesson tomorrow', 'TRIGGER:-PT18H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = `boplo-lesson-${date}.ics`; document.body.append(a); a.click(); a.remove();
  }
  async function calendarSheet() {
    const p = state.profile;
    const show = token => {
      const https = `${location.origin}/flight/cal/feed.ics?t=${token}`, webcal = https.replace(/^https?:/, 'webcal:');
      sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Sync with your calendar</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
        <div class="sheet-body"><p>Your calendar subscribes to Boplo and updates by itself: your next lesson (with its time and a reminder the day before), exam dates, your licence target, and when your medical, rating and other documents expire.</p>
        ${token ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-blue" href="${esc(webcal)}">Apple Calendar or Outlook</a><a class="btn btn-line" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}" target="_blank" rel="noopener">Google Calendar</a></div>
        <label class="field"><span>Or paste this address into any calendar app</span><div class="share-link"><input readonly value="${esc(https)}" data-calurl><button type="button" class="btn btn-line btn-sm" data-calcopy>Copy</button></div></label>
        <p class="hint">Keep the address private: anyone with it can see these dates. Calendars refresh every few hours.</p>` : `<p class="hint">${p.calOn ? 'Sync is on. For security the address is only shown when it’s created: make a new one to add another calendar (the old address stops working).' : ''}</p>`}</div>
        <footer class="sheet-foot">${p.calOn || token ? '<button type="button" class="btn btn-line" data-caloff>Turn sync off</button>' : ''}<div class="right" style="display:flex;gap:10px;margin-left:auto">${token ? '' : `<button type="button" class="btn btn-blue" data-calmake>${p.calOn ? 'Make a new address' : 'Turn on calendar sync'}</button>`}<button type="button" class="btn btn-line" data-close>Done</button></div></footer>`;
      sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { sheet.close(); render(); });
      const mk = sheet.querySelector('[data-calmake]'); if (mk) mk.onclick = async () => { if (preview) { show('0'.repeat(48)); return; } mk.disabled = true; try { const r = await api('cal', 'POST'); state.profile.calOn = true; show(r.token); } catch (x) { toast(x.message); mk.disabled = false; } };
      const off = sheet.querySelector('[data-caloff]'); if (off) off.onclick = async () => { try { if (!preview) await api('cal', 'DELETE'); state.profile.calOn = false; toast('Calendar sync is off.'); show(''); } catch (x) { toast(x.message); } };
      const cp = sheet.querySelector('[data-calcopy]'); if (cp) cp.onclick = () => { navigator.clipboard?.writeText(https).then(() => toast('Copied.')).catch(() => sheet.querySelector('[data-calurl]').select()); };
      if (!sheet.open) sheet.showModal();
    };
    show('');
  }

  function prepare() {
    const p = state.profile; let checks = parseChecks(p.checklist);
    const recent = sorted().slice(0, 3);
    shell('prepare', { title: 'Prepare', sub: 'Your notes and questions for the next lesson, with the last debriefs beside them.' },
      `<form class="grid" data-prep novalidate>
        <section class="tile span-7"><div class="tile-head"><h2>Next lesson</h2></div>
          <div class="fields">
            ${input('Lesson', 'nextLesson', p.nextLesson, 'text', 'maxlength="200" placeholder="e.g. Lesson 12 · Navigation"')}
            ${input('Date', 'lessonDate', p.lessonDate, 'date')}
            ${input('Start time', 'lessonTime', p.lessonTime, 'time')}
            <div class="field cal-add"><span>Calendar</span><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-line btn-sm" data-icsone ${p.lessonDate ? '' : 'disabled'}>Add this lesson to my calendar</button><button type="button" class="btn btn-line btn-sm" data-calsub>${p.calOn ? 'Calendar sync is on' : 'Sync with my calendar'}</button>${p.lessonDate ? '<button type="button" class="btn btn-line btn-sm" data-scrub>Lesson cancelled?</button>' : ''}</div></div>
            <div class="field cal-add"><span>Before you fly</span><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-line btn-sm" data-chairfly>Chair-fly the circuit</button><button type="button" class="btn btn-line btn-sm" data-kneeboard>Print my kneeboard</button></div></div>
          </div>
          <div class="group" style="margin-top:22px"><h3>Preparation checklist</h3>
            <div class="checklist" data-checks></div>
            <div class="add-check"><input data-new placeholder="Add something to prepare and press Enter" maxlength="200" aria-label="New checklist item"><button type="button" class="btn btn-line" data-addcheck>Add</button></div>
          </div>
          <div class="fields" style="margin-top:22px">
            ${input('Questions for your instructor', 'questions', p.questions, 'textarea', 'placeholder="One question per line"')}
            ${input('Preparation notes', 'notes', p.notes, 'textarea')}
          </div>
          <p class="form-error" role="alert" style="margin-top:12px"></p>
          <div class="actions" style="margin-top:16px"><span class="hint">${preview ? 'Example desk: changes aren’t saved.' : 'Saved to your account.'}</span><div class="right"><button class="btn btn-blue btn-has-spark" type="submit">Save preparation ${spark}</button></div></div>
        </section>
        <div class="span-5" style="display:grid;gap:16px;align-content:start">${lessonWxTile('')}${issueTile('')}${rustTile('')}
        <section class="tile"><div class="tile-head"><h2>From your last flights</h2>${recent.length ? '<a class="link" href="#logbook">Logbook</a>' : ''}</div>
          ${recent.length ? recent.map(f => `<div class="debrief"><small>${esc(fmtDate(f.date))} · ${esc(f.lesson || `${upper(f.departure)} → ${upper(f.arrival)}`)}</small><p class="${f.notes ? '' : 'none'}">${esc(f.notes || 'No debrief notes for this flight.')}</p></div>`).join('') : '<p class="hint">Debrief notes from your flights will show here.</p>'}
        </section></div>
      </form>`);
    const form = $('[data-prep]'), box = $('[data-checks]'), nw = $('[data-new]');
    wireCoach(prepare); wireCoach2(prepare);
    const one = $('[data-icsone]'); if (one) one.onclick = () => { const v = Object.fromEntries(new FormData(form)); downloadICS(v.nextLesson, v.lessonDate || p.lessonDate, v.lessonTime, p.airport); };
    $('[data-calsub]').onclick = calendarSheet;
    const draw = () => {
      box.innerHTML = checks.length ? checks.map((c, i) => `<div class="check ${c.done ? 'done' : ''}"><input type="checkbox" ${c.done ? 'checked' : ''} data-i="${i}" aria-label="Mark as prepared"><input type="text" value="${esc(c.text)}" data-t="${i}" maxlength="200" aria-label="Checklist item"><button type="button" data-x="${i}" aria-label="Remove item">${ico('close')}</button></div>`).join('') : '<p class="hint">Nothing on the list yet.</p>';
      box.querySelectorAll('[data-i]').forEach(el => el.onchange = () => { checks[el.dataset.i].done = el.checked; draw(); });
      box.querySelectorAll('[data-t]').forEach(el => el.oninput = () => { checks[el.dataset.t].text = el.value; });
      box.querySelectorAll('[data-x]').forEach(el => el.onclick = () => { checks.splice(Number(el.dataset.x), 1); draw(); });
    };
    const add = () => { const t = nw.value.trim(); if (!t) return; checks.push({ done: false, text: t }); nw.value = ''; draw(); nw.focus(); };
    nw.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    $('[data-addcheck]').onclick = add;
    draw();
    form.onsubmit = async e => {
      e.preventDefault(); const btn = form.querySelector('[type=submit]'), err = $('.form-error', form); err.textContent = ''; btn.disabled = true;
      try { const v = Object.fromEntries(new FormData(form)); ['nw'].forEach(k => delete v[k]); await saveProfile({ nextLesson: v.nextLesson, lessonDate: v.lessonDate, lessonTime: v.lessonTime, questions: v.questions, notes: v.notes, checklist: writeChecks(checks) }); toast('Preparation saved.'); prepare(); }
      catch (x) { err.textContent = x.message; btn.disabled = false; }
    };
  }

  function profilePage() {
    const p = state.profile;
    shell('profile', { title: 'Profile', sub: 'The details your desk is built around.' },
      `<form class="grid" data-profile novalidate>
        <section class="tile span-7"><div class="tile-head"><h2>You and your training</h2></div>
          <div class="fields">
            ${input('Your name', 'name', p.name, 'text', 'required maxlength="100" autocomplete="name"')}
            ${countrySelect(countryCodeOf(p))}
            ${regimeSelect(regimeOf(p))}
            ${input('Licensing authority', 'authority', p.authority && !R.legacyRegime(p.authority) ? p.authority : (R.authorityFor(countryCodeOf(p)) || R.regimes[regimeOf(p)].label), 'text', 'required maxlength="100"')}
            ${licenceSelect(regimeOf(p), licenceOf(p))}
            <div class="full" style="grid-column:1/-1">${minNote(regimeOf(p), licenceOf(p))}</div>
            ${input('Target date', 'target', p.target, 'date', '', true)}
            ${input('Hours goal', 'goalHours', p.goalHours || '', 'number', 'min="0" max="2000" step="1" inputmode="numeric"', true)}
            ${input('Home airfield', 'airport', p.airport, 'text', 'maxlength="100" placeholder="ICAO code or name" list="home-af" autocomplete="off"', true)}<datalist id="home-af"></datalist>
            ${input('School or club', 'school', p.school, 'text', 'maxlength="200"', true)}
          </div>
        </section>
        <section class="tile span-5"><div class="tile-head"><h2>Flying</h2></div>
          <div class="fields" style="grid-template-columns:1fr">
            ${input('Aircraft type', 'aircraft', p.aircraft, 'text', 'maxlength="200"', true)}
            ${input('Registration', 'registration', p.registration, 'text', 'maxlength="200"', true)}
            ${select('How often you fly', 'frequency', FREQ, p.frequency || 'Still deciding')}
            ${input('Theory to revisit', 'topics', p.topics, 'text', 'maxlength="200"', true)}
            ${duration('Hours before Boplo', 'openingMinutes', p.openingMinutes || 0, false, 'Kept separate from dated flights.')}
          </div>
        </section>
        <section class="tile span-12"><div class="tile-head"><h2>Costs</h2></div>
          <div class="fields" style="grid-template-columns:repeat(4,minmax(0,1fr))">
            ${select('Currency', 'currency', CURRENCIES.map(c => [c, c]), currencyOf(p))}
            ${input('Aircraft, per hour', 'rateAircraft', p.rateAircraft || '', 'number', 'min="0" max="5000" step="0.01" inputmode="decimal"', true)}
            ${input('Instructor, per hour', 'rateInstructor', p.rateInstructor || '', 'number', 'min="0" max="2000" step="0.01" inputmode="decimal"', true, 'Added to dual flights only. Leave at 0 if your aircraft rate includes the instructor.')}
          </div>
          <p class="footnote">Used to estimate each flight’s cost when you don’t enter it, and to forecast your total on the overview.</p>
        </section>
        <section class="tile span-12 data-tile"><div class="tile-head"><h2>Your data</h2></div>
          <p class="hint">Your flights and notes are yours. Download them any time, on any plan. <a class="link" href="/privacy.html" target="_blank">How Boplo handles your data</a></p>
          <div class="data-actions"><a class="btn btn-line btn-sm" ${preview ? 'aria-disabled="true"' : 'href="/flight/account/export" download'}>Download everything (JSON)</a><button type="button" class="btn btn-line btn-sm" data-csvx>Export logbook (CSV)</button><span style="flex:1"></span><button type="button" class="btn btn-danger btn-sm" data-delacct ${preview ? 'disabled' : ''}>Delete my account</button></div>
        </section>
        <div class="span-12 actions"><p class="form-error" role="alert"></p><span class="hint">${state.user?.email ? `Signed in as ${esc(state.user.email)}` : ''}</span><div class="right"><button type="button" class="btn btn-line" data-logout>${ico('out')}${preview ? 'Leave example' : 'Sign out'}</button><button class="btn btn-blue btn-has-spark" type="submit">Save profile ${spark}</button></div></div>
      </form>`);
    $$('[data-logout]').forEach(b => b.onclick = logout);
    $('[data-csvx]').onclick = exportCSV;
    const da = $('[data-delacct]'); if (da) da.onclick = deleteAccountSheet;
    const form = $('[data-profile]');
    bindTraining(form, p);
    form.onsubmit = async e => {
      e.preventDefault(); const err = $('.form-error', form), btn = form.querySelector('[type=submit]'); err.textContent = '';
      const bad = [...form.querySelectorAll('input[required], select[required]')].find(i => !String(i.value).trim()); if (bad) { err.textContent = 'Name, country and authority are required.'; bad.focus(); return; }
      const v = Object.fromEntries(new FormData(form)); if (v.countryCode) v.country = R.nameFor(v.countryCode); v.openingMinutes = readDuration(form, 'openingMinutes'); v.goalHours = Number(v.goalHours || 0); v.rateAircraft = Number(v.rateAircraft || 0); v.rateInstructor = Number(v.rateInstructor || 0);
      btn.disabled = true;
      try { await saveProfile({ ...v, complete: true, step: 4 }); toast('Profile saved.'); profilePage(); } catch (x) { err.textContent = x.message; btn.disabled = false; }
    };
  }

  /* ================= money and pace ================= */
  const CURRENCY_BY = { GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', NO: 'NOK', SE: 'SEK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', IS: 'ISK', ZA: 'ZAR', IN: 'INR', JP: 'JPY', BR: 'BRL', MX: 'MXN' };
  const EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ');
  const CURRENCIES = ['GBP', 'EUR', 'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'ZAR', 'INR', 'JPY', 'BRL', 'MXN'];
  const currencyOf = p => p.currency || CURRENCY_BY[countryCodeOf(p)] || (EURO.includes(countryCodeOf(p)) ? 'EUR' : 'USD');
  const money = (n, p = state.profile, digits = 0) => { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currencyOf(p), maximumFractionDigits: digits }).format(n || 0); } catch { return `${Math.round(n || 0)}`; } };
  const estCost = (f, p = state.profile) => { const r = Number(p.rateAircraft || 0) + (f.role === 'dual' ? Number(p.rateInstructor || 0) : 0); return r ? f.minutes / 60 * r : null; };
  const costOf = f => f.cost != null && f.cost !== '' ? Number(f.cost) : estCost(f);
  function pace() {
    const p = state.profile, goal = Number(p.goalHours || 0), total = totalMin() / 60;
    const recent = inLast(56), perWeek = sum(recent, f => f.minutes) / 60 / 8;
    const costed = state.flights.map(f => [f, costOf(f)]).filter(([, c]) => c != null);
    const spent = sum(costed, ([, c]) => c);
    const perHour = costed.length ? spent / (sum(costed, ([f]) => f.minutes) / 60) : (Number(p.rateAircraft || 0) + Number(p.rateInstructor || 0) * 0.6) || 0;
    const remaining = Math.max(0, goal - total);
    const weeks = perWeek > 0 ? remaining / perWeek : null;
    const eta = weeks != null ? new Date(Date.now() + weeks * 7 * 86400000) : null;
    return { goal, total, perWeek, spent, perHour, remaining, weeks, eta, projected: spent + remaining * perHour, costedCount: costed.length };
  }

  /* ================= licence requirements ================= */
  const nmBetween = (a, b) => { const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.sqrt(h)); };
  const trackNM = f => { const p = f.points || []; let d = 0; for (let i = 1; i < p.length; i++) d += nmBetween(p[i - 1], p[i]); return d; };
  const isXC = f => upper(f.departure) && upper(f.arrival) && upper(f.departure) !== upper(f.arrival) || trackNM(f) > 25 && (f.points || []).some(pt => nmBetween(f.points[0], pt) > 12);
  const reqKey = p => `${regimeOf(p)}|${licenceOf(p)}`;
  function requirements() {
    const p = state.profile, list = R.requirementsFor(regimeOf(p), licenceOf(p)); if (!list) return null;
    const ticks = readJSON(p.reqs)[reqKey(p)] || {}, fl = state.flights, docs = docsOf(p);
    const h = pred => sum(fl.filter(pred), f => f.minutes) / 60;
    const items = list.map(q => {
      const o = { ...q, auto: true, have: 0, unit: 'h' };
      if (q.k === 'total') o.have = totalMin() / 60;
      else if (q.k === 'dual') o.have = h(f => f.role === 'dual');
      else if (q.k === 'solo') o.have = h(f => f.role === 'solo');
      else if (q.k === 'soloxc') o.have = h(f => f.role === 'solo' && isXC(f));
      else if (q.k === 'nightldg') { o.have = sum(fl, f => Number(f.nightLandings || 0)); o.unit = ''; }
      else if (q.k === 'longxc') { const hit = [...fl].sort((a, b) => a.date.localeCompare(b.date)).find(f => f.role === 'solo' && trackNM(f) >= q.nm); o.id = 'longxc'; o.found = hit || null; o.auto = !!hit; o.done = !!hit || !!ticks.longxc; o.need = 1; o.have = o.done ? 1 : 0; o.unit = 'flight'; }
      else { o.auto = false; o.done = !!ticks[q.id] || (q.id === 'medical' && !!docs.medical && docs.medical >= todayISO()); o.medAuto = q.id === 'medical' && !!docs.medical && docs.medical >= todayISO(); o.need = 1; o.have = o.done ? 1 : 0; o.unit = ''; }
      if (o.done == null) o.done = o.have >= q.need;
      o.pct = Math.max(0, Math.min(1, o.have / (o.need || 1)));
      return o;
    });
    const open = items.filter(i => !i.done);
    const next = open.filter(i => ['dual', 'solo', 'soloxc', 'nightldg', 'total'].includes(i.k)).sort((a, b) => b.pct - a.pct)[0] || open[0] || null;
    const L = R.licence(regimeOf(p), licenceOf(p));
    return { items, doneN: items.length - open.length, next, licence: L, ticks };
  }
  const reqAmount = i => i.unit === 'h' ? `${Math.min(i.have, i.need).toFixed(1)} of ${i.need} h` : i.k === 'nightldg' ? `${Math.min(i.have, i.need)} of ${i.need}` : i.done ? 'Done' : 'To do';
  function reqRow(i, interactive = true) {
    const tick = !i.auto && !i.medAuto && interactive;
    return `<div class="req ${i.done ? 'done' : ''}">
      <span class="req-ic" aria-hidden="true">${i.done ? '<svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</span>
      <div class="req-main"><div class="req-top"><b>${esc(i.label)}</b><span>${esc(reqAmount(i))}</span></div>
        ${i.unit === 'h' || i.k === 'nightldg' ? `<div class="bar-track"><i style="width:${(i.pct * 100).toFixed(1)}%;background:${i.done ? 'var(--ok)' : 'var(--electric)'}"></i></div>` : ''}
        ${i.found ? `<small>Found in your logbook: ${esc(fmtDate(i.found.date, { day: 'numeric', month: 'short', year: 'numeric' }))}, ${esc(upper(i.found.departure))} → ${esc(upper(i.found.arrival))}, ${Math.round(trackNM(i.found))} NM tracked. Check the landings count for your licence.</small>` : i.k === 'longxc' && !i.done ? '<small>Boplo spots this from a solo flight’s track. Without a track, tick it once your instructor confirms it.</small>' : i.medAuto ? '<small>From the medical expiry date in Currency.</small>' : i.note ? `<small>${esc(i.note)}</small>` : ''}
      </div>
      ${tick ? `<button type="button" class="btn btn-sm ${i.done ? 'btn-line' : 'btn-ink'}" data-reqtick="${esc(i.id)}">${i.done ? 'Undo' : 'Mark done'}</button>` : ''}
    </div>`;
  }
  async function toggleReq(id) {
    const p = state.profile, all = readJSON(p.reqs), k = reqKey(p), mine = all[k] || {};
    if (mine[id]) delete mine[id]; else mine[id] = todayISO();
    all[k] = mine; await saveProfile({ reqs: JSON.stringify(all) });
  }
  function reqTile(rq, opts = {}) {
    const L = rq.licence;
    return `<section class="tile ${opts.cls || 'span-12'}" aria-labelledby="req-h">
      <div class="tile-head"><h2 id="req-h">${opts.short ? 'Licence checklist' : `What ${esc(L?.id || 'your licence')} needs`}</h2><span class="chip ${rq.doneN === rq.items.length ? 'ok' : ''}">${rq.doneN} of ${rq.items.length} done</span></div>
      ${rq.next && opts.short ? `<p class="req-next"><span>Next milestone</span><b>${esc(rq.next.label)}</b>${rq.next.unit === 'h' ? ` <em>${(rq.next.need - rq.next.have).toFixed(1)} h to go</em>` : ''}</p>` : ''}
      <div class="reqs">${(opts.short ? rq.items.filter(i => !i.done).slice(0, 4) : rq.items).map(i => reqRow(i, !opts.short)).join('')}</div>
      ${opts.short ? `<a class="link" href="#progress">See the full checklist</a>` : `<p class="footnote">Worked out from your logbook: dual and solo time come from each flight’s role, and cross-country counts flights that land somewhere other than where they started. Hours from before Boplo count toward the total only. ${L?.url ? `<a class="link" href="${esc(L.url)}" target="_blank" rel="noopener">${esc(L.source)}</a>.` : ''} Your instructor and authority decide what counts.</p>`}
    </section>`;
  }

  /* ================= cost forecast ================= */
  const FREQ_PER_WEEK = { 'Twice a week': 2, 'Weekly': 1, 'Monthly': 0.25, 'Intensive course': 4 };
  const budgetOf = p => { const b = readJSON(p.budget, {}); return { total: Number(b.total || 0), extras: Array.isArray(b.extras) ? b.extras : [] }; };
  // completion factor over the published minimum, by how often you fly. Typical private pilots finish at about 1.8× the FAA minimum (DPE completion data, Pilot Institute survey); frequent flying finishes sooner.
  const finishFactor = perWeek => perWeek >= 1.8 ? 1.4 : perWeek >= 0.9 ? 1.65 : 1.9;
  function forecast(basis = ui.fcBasis || 'typical') {
    const p = state.profile, L = R.licence(regimeOf(p), licenceOf(p)), min = L?.minHours || null, pc = pace();
    const recent = inLast(56), flPerWeek = recent.length / 8;
    const avgLen = state.flights.length ? sum(state.flights, f => f.minutes) / state.flights.length / 60 : 1.1;
    const planned = FREQ_PER_WEEK[p.frequency] || 0;
    const perWeekFl = flPerWeek || planned || 1, perWeekH = pc.perWeek || perWeekFl * avgLen;
    const factor = finishFactor(perWeekFl);
    const typical = min ? Math.round(min * factor) : null;
    const target = basis === 'min' && min ? min : basis === 'goal' && pc.goal ? pc.goal : typical || pc.goal || null;
    const b = budgetOf(p), extrasPaid = sum(b.extras.filter(x => x.paid), x => Number(x.amt || 0)), extrasDue = sum(b.extras.filter(x => !x.paid), x => Number(x.amt || 0));
    const perHour = pc.perHour || 0, remainingH = target ? Math.max(0, target - pc.total) : null;
    const remainingFly = remainingH != null ? remainingH * perHour : null;
    const spentAll = pc.spent + extrasPaid;
    const projected = remainingFly != null ? spentAll + remainingFly + extrasDue : null;
    const weeks = remainingH != null && perWeekH > 0 ? remainingH / perWeekH : null;
    const finish = weeks != null ? new Date(Date.now() + weeks * 7 * 86400000) : null;
    const monthly = perWeekH * perHour * 4.345;
    const left = b.total ? b.total - spentAll : null;
    const runOut = left != null && monthly > 0 ? (left <= 0 ? new Date() : new Date(Date.now() + left / monthly * 30.44 * 86400000)) : null;
    const short = b.total && projected != null ? projected - b.total : null;
    const fast = min && perWeekFl < 1.8 ? { hours: Math.round(min * 1.4), save: (typical - Math.round(min * 1.4)) * perHour, saveH: typical - Math.round(min * 1.4) } : null;
    return { min, typical, target, basis, factor, perWeekFl, perWeekH, measured: !!flPerWeek, planned, perHour, spent: pc.spent, extrasPaid, extrasDue, spentAll, remainingH, remainingFly, projected, finish, monthly, budget: b.total, left, runOut, short, fast, range: min ? [Math.round(min * 1.3), Math.round(min * 1.9)] : null, hasRates: perHour > 0, total: pc.total };
  }
  const monthYear = d => d ? d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—';
  function forecastLine(fc) {
    if (!fc.target) return 'Choose your licence in Profile to see a forecast.';
    if (!fc.hasRates) return `Most students finish around ${fc.typical || fc.target} h. Add your aircraft and instructor rates to see the cost.`;
    if (fc.budget && fc.short > 0) return `At this pace your budget runs out around ${monthYear(fc.runOut)}, about ${money(fc.short)} short of finishing.`;
    if (fc.budget) return `Your budget covers it, with about ${money(-fc.short)} to spare.`;
    return `About ${money(fc.projected)} in total, finishing around ${monthYear(fc.finish)}.`;
  }
  function forecastTile() {
    const fc = forecast();
    return `<section class="tile span-7 pace" aria-labelledby="pace-h">
      <div class="tile-head"><h2 id="pace-h">Cost forecast</h2><a class="link" href="#budget">Open budget</a></div>
      <div class="pace-grid">
        <div><span>Likely to finish at</span><b>${fc.target ? `${fc.target}<small>h</small>` : '—'}</b><em>${fc.min ? `Minimum ${fc.min} h · at your pace` : 'Set your licence'}</em></div>
        <div><span>Finish around</span><b>${esc(monthYear(fc.finish))}</b><em>${fc.remainingH != null ? `${fc.remainingH.toFixed(1)} h to go · ${fc.perWeekFl.toFixed(1)} flights a week` : '—'}</em></div>
        <div><span>Spent so far</span><b>${fc.hasRates || fc.spentAll ? esc(money(fc.spentAll)) : '—'}</b><em>${fc.hasRates ? `About ${esc(money(fc.perHour))} per hour` : 'Add your rates'}</em></div>
        <div><span>Projected total</span><b>${fc.projected != null && fc.hasRates ? esc(money(fc.projected)) : '—'}</b><em>${fc.budget ? `Budget ${esc(money(fc.budget))}` : 'Add a budget to track it'}</em></div>
      </div>
      <p class="fc-line ${fc.short > 0 ? 'warn' : ''}">${esc(forecastLine(fc))}</p>
    </section>`;
  }
  const EXTRA_SUGG = () => regimeOf(state.profile) === 'faa' ? ['Medical exam', 'Knowledge test', 'Checkride examiner fee', 'Headset', 'Books and ground school', 'Landing and airport fees'] : ['Medical exam', 'Theory exams', 'Skill test and examiner fee', 'Radio (FRTOL) exam', 'Headset', 'Books and ground school', 'Licence issue fee', 'Landing fees'];
  let budgetSave = null;
  function budgetPage() {
    const p = state.profile, fc = forecast(), b = budgetOf(p), cur = currencyOf(p);
    const basisBtn = (k, t) => `<button type="button" data-basis="${k}" aria-pressed="${fc.basis === k}">${t}</button>`;
    const month = {}; state.flights.forEach(f => { const c = costOf(f); if (c != null) { const k = f.date.slice(0, 7); month[k] = (month[k] || 0) + c; } });
    const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5 + i); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; return [k, month[k] || 0, d.toLocaleDateString('en-GB', { month: 'short' })]; });
    const maxM = Math.max(1, ...months.map(m => m[1]));
    shell('budget', { title: 'Budget', sub: 'What your licence is likely to cost, based on how students really finish, and whether your budget gets you there.' },
      `<div class="grid">
        <section class="tile dark span-12 fc-hero">${contours('a')}
          <div class="fc-hero-main"><span class="kicker">Projected total</span><h2 class="display">${fc.projected != null && fc.hasRates ? esc(money(fc.projected)) : '—'}</h2><p>${esc(forecastLine(fc))}</p>
            <div class="bill-toggle fc-basis" role="group" aria-label="Plan for">${basisBtn('typical', 'Typical at your pace')}${fc.min ? basisBtn('min', `Minimum ${fc.min} h`) : ''}${Number(p.goalHours) ? basisBtn('goal', `My goal ${Number(p.goalHours)} h`) : ''}</div></div>
          <dl class="fc-facts">
            <div><dt>Hours</dt><dd>${fc.target || '—'}${fc.target ? ' h' : ''}</dd></div>
            <div><dt>Finish</dt><dd>${esc(monthYear(fc.finish))}</dd></div>
            <div><dt>Monthly spend</dt><dd>${fc.hasRates ? esc(money(fc.monthly)) : '—'}</dd></div>
            <div><dt>Budget lasts to</dt><dd>${fc.budget && fc.hasRates ? esc(monthYear(fc.runOut)) : '—'}</dd></div>
          </dl>
        </section>
        ${runwayTile()}
        ${fc.short > 0 ? `<p class="callout warn span-12"><b>Heads up:</b> at your current pace, the money runs out before the licence does. Flying more often is the biggest lever: fewer hours are lost to re-learning between lessons.</p>` : ''}
        <section class="tile span-7"><div class="tile-head"><h2>Breakdown</h2><span class="chip">${esc(cur)}</span></div>
          <div class="airports fc-break">
            <div><span>Flying so far · ${state.flights.length} flight${state.flights.length === 1 ? '' : 's'}</span><b>${esc(money(fc.spent))}</b></div>
            <div><span>Other costs paid</span><b>${esc(money(fc.extrasPaid))}</b></div>
            <div><span>Flying still to do · ${fc.remainingH != null ? fc.remainingH.toFixed(1) : '—'} h × ${esc(money(fc.perHour))}</span><b>${fc.remainingFly != null ? esc(money(fc.remainingFly)) : '—'}</b></div>
            <div><span>Other costs to come</span><b>${esc(money(fc.extrasDue))}</b></div>
            <div class="fc-sum"><span>Total</span><b>${fc.projected != null ? esc(money(fc.projected)) : '—'}</b></div>
          </div>
          <form class="fc-form" data-fcform>
            <label class="field"><span>Total budget</span><input name="total" inputmode="decimal" value="${b.total || ''}" placeholder="e.g. 12000"></label>
            <label class="field"><span>Aircraft per hour</span><input name="rateAircraft" inputmode="decimal" value="${Number(p.rateAircraft) || ''}" placeholder="0"></label>
            <label class="field"><span>Instructor per hour</span><input name="rateInstructor" inputmode="decimal" value="${Number(p.rateInstructor) || ''}" placeholder="0"></label>
          </form>
          <p class="footnote">Spending comes from each flight’s cost, or your rates when a flight has no cost entered.</p>
        </section>
        <section class="tile span-5"><div class="tile-head"><h2>Spent by month</h2></div>
          <div class="fc-months">${months.map(([k, v, l]) => `<div title="${esc(money(v))}"><i style="height:${Math.max(2, v / maxM * 100)}%"></i><span>${esc(l)}</span></div>`).join('')}</div>
          ${fc.fast ? `<div class="fc-lever"><b>Fly twice a week</b><p>Students who fly twice a week tend to finish nearer ${fc.fast.hours} h. For you that’s about ${fc.fast.saveH} fewer hours${fc.hasRates ? `, or ${esc(money(fc.fast.save))} saved` : ''}.</p></div>` : fc.min ? `<div class="fc-lever ok"><b>Good pace</b><p>You’re flying often enough to finish close to the best case, around ${Math.round(fc.min * 1.4)} h.</p></div>` : ''}
        </section>
        <section class="tile span-12"><div class="tile-head"><h2>Other costs</h2><button type="button" class="btn btn-line btn-sm" data-addx>Add a cost</button></div>
          <div class="fc-extras" data-extras>${b.extras.length ? b.extras.map((x, i) => `<div class="fc-x" data-x="${i}"><input aria-label="Cost name" name="n" value="${esc(x.n || '')}" placeholder="What it’s for"><input aria-label="Amount" name="amt" inputmode="decimal" value="${x.amt || ''}" placeholder="Amount"><label class="fc-paid"><input type="checkbox" name="paid" ${x.paid ? 'checked' : ''}> Paid</label><button type="button" class="icon-btn" data-delx="${i}" aria-label="Remove">${ico('close')}</button></div>`).join('') : '<p class="hint">Exams, the medical, examiner fees and a headset add up. Add them so the total is honest.</p>'}</div>
          <div class="fc-sugg">${EXTRA_SUGG().filter(n => !b.extras.some(x => x.n === n)).map(n => `<button type="button" class="chip" data-suggx="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>
        </section>
      </div>
      <p class="footnote" style="margin-top:16px">How this works: published minimums are the floor, not the norm. Typical private pilots finish at about 1.8× the minimum, and those who fly twice a week finish nearer 1.4×. Boplo uses your recent pace (or the frequency in your profile) to pick a figure. It’s an estimate from your own records, not a quote.</p>`);
    const save = (patch, rerender = true) => { clearTimeout(budgetSave); budgetSave = setTimeout(async () => { try { await saveProfile(patch()); if (rerender) { const y = scrollY, a = document.activeElement?.name; budgetPage(); scrollTo(0, y); } } catch (x) { toast(x.message); } }, 600); };
    const num = v => { const n = Number(String(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; };
    const extrasNow = () => $$('[data-x]').map(r => ({ n: r.querySelector('[name=n]').value.trim().slice(0, 60), amt: num(r.querySelector('[name=amt]').value), paid: r.querySelector('[name=paid]').checked }));
    const writeBudget = extras => JSON.stringify({ total: num($('[data-fcform]').total.value), extras: extras.slice(0, 30) });
    $('[data-fcform]').oninput = () => save(() => ({ budget: writeBudget(extrasNow()), rateAircraft: num($('[data-fcform]').rateAircraft.value), rateInstructor: num($('[data-fcform]').rateInstructor.value) }), false);
    $('[data-fcform]').onchange = () => save(() => ({ budget: writeBudget(extrasNow()), rateAircraft: num($('[data-fcform]').rateAircraft.value), rateInstructor: num($('[data-fcform]').rateInstructor.value) }));
    $('[data-extras]').onchange = () => save(() => ({ budget: writeBudget(extrasNow()) }));
    $$('[data-delx]').forEach(x => x.onclick = () => { const e = extrasNow(); e.splice(Number(x.dataset.delx), 1); save(() => ({ budget: writeBudget(e) })); });
    const add = n => { const e = extrasNow(); e.push({ n, amt: 0, paid: false }); clearTimeout(budgetSave); saveProfile({ budget: writeBudget(e) }).then(() => { budgetPage(); const rows = $$('[data-x]'); rows[rows.length - 1]?.querySelector(n ? '[name=amt]' : '[name=n]')?.focus(); }).catch(x => toast(x.message)); };
    $('[data-addx]').onclick = () => add('');
    $$('[data-suggx]').forEach(x => x.onclick = () => add(x.dataset.suggx));
    $$('[data-basis]').forEach(x => x.onclick = () => { ui.fcBasis = x.dataset.basis; budgetPage(); });
  }

  /* ================= momentum ================= */
  function momentum() {
    const p = state.profile, fl = sorted(), last = fl[0]?.date || null, gap = last ? -daysUntil(last) : null;
    const today = parseISO(todayISO()), weeks = [...Array(8)].map((_, i) => { const end = new Date(today - i * 7 * 86400000), start = new Date(end - 6 * 86400000); const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return fl.filter(f => f.date >= iso(start) && f.date <= iso(end)).length; }).reverse();
    let streak = 0; for (let i = weeks.length - 1; i >= 0 && weeks[i] > 0; i--) streak++;
    const target = FREQ_PER_WEEK[p.frequency] || 2, lately = sum(weeks.slice(-4), x => x) / 4;
    const level = gap == null ? 'none' : gap <= 7 ? 'good' : gap <= 20 ? 'book' : gap <= 59 ? 'fade' : gap <= 89 ? 'warn' : 'lapsed';
    const msg = { none: 'Log your first flight and Boplo keeps an eye on your momentum.', good: lately >= target ? 'Great rhythm. Flying this often is how students finish in fewer hours.' : 'Nice and recent. Keep the next lesson close to stay sharp.', book: 'A good moment to book your next lesson, before skills start to slip.', fade: 'Skills fade fastest in the first few weeks off. Getting back up soon saves hours later.', warn: 'You’re getting close to 90 days. After that, passenger currency lapses and skills need rebuilding.', lapsed: 'It’s been over 90 days. Most students restart with a dual lesson to brush up, and that’s normal.' }[level];
    return { last, gap, weeks, streak, target, lately, level, msg };
  }
  let installEvt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $$('[data-install]').forEach(b => b.hidden = false); });
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function momentumTile() {
    const m = momentum(), p = state.profile, max = Math.max(m.target, ...m.weeks, 1);
    return `<section class="tile span-5 mo mo-${m.level}" aria-labelledby="mo-h">
      <div class="tile-head"><h2 id="mo-h">Momentum</h2>${m.streak > 1 ? `<span class="chip ok">${m.streak}-week streak</span>` : ''}</div>
      <div class="mo-big"><b>${m.gap == null ? '—' : m.gap}</b><span>${m.gap == null ? 'no flights yet' : m.gap === 1 ? 'day since your last flight' : 'days since your last flight'}</span></div>
      <p class="mo-msg">${esc(m.msg)}</p>
      <div class="mo-weeks" role="img" aria-label="Flights per week over the last 8 weeks: ${m.weeks.join(', ')}">${m.weeks.map((n, i) => `<div><i style="height:${n ? Math.max(14, n / max * 100) : 4}%" class="${n >= m.target ? 'hit' : ''}"></i><span>${i === 7 ? 'This wk' : ''}</span></div>`).join('')}<em style="bottom:${m.target / max * 100}%" title="Your target"></em></div>
      <p class="footnote">${m.lately.toFixed(1)} flights a week lately · target ${m.target} (from your profile)</p>
      <div class="mo-actions">
        <label class="switch"><input type="checkbox" data-reminders ${p.reminders ? 'checked' : ''} ${preview ? 'disabled' : ''}><span></span>Email reminders</label>
        ${pushOK() || iOS ? '<label class="switch"><input type="checkbox" data-pushsw><span></span>Phone notifications</label>' : ''}
        ${standalone() ? '' : `<button type="button" class="btn btn-line btn-sm" data-install ${installEvt || iOS ? '' : 'hidden'}>Install the app</button>`}
      </div>
    </section>`;
  }
  function wireMomentum() {
    const ps = $('[data-pushsw]'); if (ps) { pushState().then(v => { ps.checked = v; }); ps.onchange = async () => { const want = ps.checked; ps.disabled = true; try { const v = await setPush(want); ps.checked = v; toast(v ? 'Notifications on. A test one is on its way.' : 'Notifications off on this device.'); } catch (x) { ps.checked = !want; toast(x.message); } ps.disabled = false; }; }
    const r = $('[data-reminders]'); if (r) r.onchange = async () => { try { await saveProfile({ reminders: r.checked }); toast(r.checked ? 'Reminders on. Boplo emails you when it’s been a while, and the day before a lesson.' : 'Reminders off.'); } catch (x) { r.checked = !r.checked; toast(x.message); } };
    $$('[data-install]').forEach(b => b.onclick = async () => {
      if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => { }); installEvt = null; b.hidden = true; return; }
      sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Add Boplo to your home screen</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div><div class="sheet-body"><ol class="steps-list"><li>Tap the <b>Share</b> button in Safari’s toolbar.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Boplo opens full screen, like an app.</li></ol></div>`;
      sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => sheet.close()); sheet.showModal();
    });
  }

  /* ================= syllabus progress ================= */
  const syllabusOf = p => R.syllabusFor(regimeOf(p));
  const readJSON = (s, d = {}) => { try { const v = JSON.parse(s || ''); return v && typeof v === 'object' ? v : d; } catch { return d; } };
  const syllabusState = p => { const all = readJSON(p.syllabus); const s = syllabusOf(p); return { all, s, st: all[s.id] || {} }; };
  const STATUS = { '': 'Not started', p: 'In progress', d: 'Done' };

  function progressPage() {
    const p = state.profile, { all, s, st } = syllabusState(p);
    const doneN = s.items.filter(i => st[i.id] === 'd').length, pct = Math.round(doneN / s.items.length * 100);
    const ms = milestones();
    shell('progress', { title: 'Progress', sub: 'Track the syllabus you’ve covered, and share the moments worth celebrating.' },
      `<div class="grid">
        ${(() => { const rq = requirements(); return rq ? reqTile(rq) : ''; })()}
        ${normalTile('span-8')}${winsTile('span-4') || '<div class="span-4"></div>'}
        <section class="tile span-8" aria-labelledby="syl-h">
          <div class="tile-head"><h2 id="syl-h">${esc(s.title)}</h2><span class="chip">${doneN} of ${s.items.length} done</span></div>
          <div class="syl-bar" role="img" aria-label="${pct}% of the syllabus done"><i style="width:${pct}%"></i></div>
          <p class="footnote" style="margin:10px 0 18px">${esc(s.source)}. Tap an item to move it between not started, in progress and done.</p>
          ${s.stages.map((stage, si) => { const items = s.items.filter(i => i.stage === si); const d = items.filter(i => st[i.id] === 'd').length; return `<div class="syl-stage"><div class="syl-stage-head"><h3>${esc(stage)}</h3><span>${d}/${items.length}</span></div><div class="syl-items">${items.map(i => `<button type="button" class="syl-item s-${st[i.id] || 'n'}" data-syl="${esc(i.id)}" aria-label="${esc(i.name)}: ${STATUS[st[i.id] || '']}"><span class="syl-dot" aria-hidden="true"></span><span class="syl-id">${esc(i.id)}</span><span class="syl-name">${esc(i.name)}</span><span class="syl-state">${STATUS[st[i.id] || '']}</span></button>`).join('')}</div></div>`; }).join('')}
          <p class="form-error" role="alert"></p>
        </section>
        <div class="span-4" style="display:grid;gap:16px;align-content:start"><section class="tile dark ms-tile" aria-labelledby="ms-h">${contours('b')}
          <div class="tile-head"><h2 id="ms-h">Milestones</h2></div>
          ${ms.length ? `<ol class="ms-list">${ms.map((m, i) => `<li><span class="ms-ic" aria-hidden="true"><svg><use href="#spark"/></svg></span><span class="ms-t"><b>${esc(m.title)}</b><small>${esc(m.date ? fmtDate(m.date, { day: 'numeric', month: 'short', year: 'numeric' }) : '')}${m.detail ? ' · ' + esc(m.detail) : ''}</small></span><button type="button" class="btn btn-light btn-sm" data-share="${i}">Share</button></li>`).join('')}</ol>` : `<div class="empty"><h3>Your first milestone is close.</h3><p>Log your first flight and Boplo starts marking the moments: first solo, every 10 hours, your first cross-country.</p></div>`}
        </section>${shareTile()}</div>
      </div>`);
    wireShare();
    $$('[data-syl]').forEach(b => b.onclick = async () => {
      const id = b.dataset.syl, next = { '': 'p', p: 'd', d: '' }[st[id] || ''];
      if (next) st[id] = next; else delete st[id];
      all[s.id] = st;
      b.className = `syl-item s-${next || 'n'}`; b.querySelector('.syl-state').textContent = STATUS[next || ''];
      try { await saveProfile({ syllabus: JSON.stringify(all) }); } catch (x) { $('.form-error').textContent = x.message; }
    });
    $$('[data-share]').forEach(b => b.onclick = () => shareCard(ms[Number(b.dataset.share)]));
    $$('[data-reqtick]').forEach(b => b.onclick = async () => { b.disabled = true; try { await toggleReq(b.dataset.reqtick); const y = scrollY; progressPage(); scrollTo(0, y); } catch (x) { toast(x.message); b.disabled = false; } });
  }

  /* ================= milestones and share cards ================= */
  function milestones() {
    const p = state.profile, fl = [...state.flights].sort((a, b) => a.date.localeCompare(b.date)), out = [];
    if (!fl.length) return out;
    out.push({ title: 'First flight logged', date: fl[0].date, flight: fl[0], big: hm(fl[0].minutes), unit: 'in the air' });
    const solo = fl.find(f => f.role === 'solo'); if (solo) out.push({ title: 'First solo', date: solo.date, flight: solo, big: 'SOLO', unit: upper(solo.departure) || 'First solo' });
    const xc = fl.find(f => (f.points?.length > 1 && f.points.some(pt => BoploMap?.nm ? BoploMap.nm(f.points[0], pt) > 20 : false)) || (upper(f.departure) && upper(f.arrival) && upper(f.departure) !== upper(f.arrival)));
    if (xc) out.push({ title: 'First cross-country', date: xc.date, flight: xc, big: `${upper(xc.departure)}→${upper(xc.arrival)}`, unit: 'cross-country' });
    let cum = Number(p.openingMinutes || 0) / 60; const marks = [5, 10, 20, 30, 40, 50, 75, 100, 150, 200];
    for (const f of fl) { const before = cum; cum += f.minutes / 60; marks.filter(m => before < m && cum >= m).forEach(m => out.push({ title: `${m} hours`, date: f.date, flight: f, big: String(m), unit: 'hours flown', detail: p.licence ? `toward ${p.licence}` : '' })); }
    let ld = 0; for (const f of fl) { const b = ld; ld += f.landings; [50, 100, 250].filter(m => b < m && ld >= m).forEach(m => out.push({ title: `${m} landings`, date: f.date, flight: f, big: String(m), unit: 'landings' })); }
    const { s, st } = syllabusState(p);
    const test = s.items.find(i => /^(ST|CR|G14)$/.test(i.id)); if (test && st[test.id] === 'd') out.push({ title: 'Licence test passed', date: null, flight: null, big: p.licence || 'PILOT', unit: 'licence test passed' });
    return out.sort((a, b) => String(b.date || '9').localeCompare(String(a.date || '9')));
  }

  let logoImg = null;
  const getLogo = () => logoImg || (logoImg = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = '/assets/boplo-wordmark.webp'; }));
  async function drawCard(m) {
    const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const bg = g.createRadialGradient(W * .75, 0, 50, W * .6, H * .3, H); bg.addColorStop(0, '#0B1E4E'); bg.addColorStop(.5, '#040B22'); bg.addColorStop(1, '#020611'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // contours from the same field as the app
    const svg = contourSVG(1080, 1920, 1.9), paths = [...svg.matchAll(/d="([^"]+)"/g)].map(x => x[1]);
    g.lineWidth = 1.6; paths.forEach((d, i) => { g.strokeStyle = i ? 'rgba(158,216,255,.22)' : 'rgba(47,123,255,.32)'; try { g.stroke(new Path2D(d)); } catch { } });
    const font = (w, s, it = true) => `${it ? 'italic ' : ''}${w} ${s}px Archivo, system-ui, sans-serif`;
    // track
    const f = m.flight;
    if (f?.points?.length > 1) {
      const P = project([f.points], 900, 760, 40);
      g.save(); g.translate(90, 640); g.lineJoin = 'round'; g.lineCap = 'round';
      const path = () => { g.beginPath(); f.points.forEach((pt, i) => { const [x, y] = P(pt); i ? g.lineTo(x, y) : g.moveTo(x, y); }); };
      g.shadowColor = 'rgba(10,98,255,.9)'; g.shadowBlur = 40; g.strokeStyle = 'rgba(10,98,255,.8)'; g.lineWidth = 18; path(); g.stroke();
      g.shadowBlur = 12; g.shadowColor = '#9ED8FF'; g.strokeStyle = '#E8F6FF'; g.lineWidth = 6; path(); g.stroke();
      const [sx, sy] = P(f.points[0]); g.shadowBlur = 0; g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 12, 0, 7); g.fill();
      g.restore();
    }
    g.fillStyle = 'rgba(158,216,255,.9)'; g.font = font(600, 44, false); g.fillText(m.title, 90, 260);
    g.fillStyle = '#fff'; let size = 260; g.font = font(700, size); while (g.measureText(m.big).width > 900 && size > 90) { size -= 10; g.font = font(700, size); } g.fillText(m.big, 82, 260 + size);
    g.fillStyle = 'rgba(222,233,255,.8)'; g.font = font(500, 52, false); g.fillText(m.unit, 90, 330 + size);
    const p = state.profile, meta = [m.date ? fmtDate(m.date, { day: 'numeric', month: 'long', year: 'numeric' }) : '', f ? `${upper(f.departure)} → ${upper(f.arrival)}` : '', f?.aircraft || ''].filter(Boolean).join('  ·  ');
    g.fillStyle = 'rgba(143,160,196,1)'; let ms = 38; g.font = font(500, ms, false); while (g.measureText(meta).width > 900 && ms > 24) { ms -= 2; g.font = font(500, ms, false); } g.fillText(meta, 90, 1520);
    g.fillStyle = 'rgba(158,216,255,.14)'; g.fillRect(90, 1580, 900, 2);
    g.fillStyle = '#fff'; g.font = font(600, 42, false); g.fillText(`${hrs(totalMin())} hours logged${p.licence ? ` toward ${p.licence}` : ''}`, 90, 1660);
    const logo = await getLogo(); if (logo) { const lw = 300, lh = lw * logo.height / logo.width; g.drawImage(logo, 90, 1730, lw, lh); }
    g.fillStyle = 'rgba(143,160,196,1)'; g.font = font(500, 34, false); g.textAlign = 'right'; g.fillText('boplo.app', 990, 1790);
    return c;
  }
  async function shareCard(m) {
    if (!m) return;
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Share: ${esc(m.title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body share-body"><div class="share-preview" data-prev><p class="hint">Drawing your card…</p></div>
      <p class="hint">Sized 1080 × 1920 for TikTok, Reels and Stories.</p></div>
      <footer class="sheet-foot"><span></span><div class="right" style="display:flex;gap:10px;margin-left:auto"><a class="btn btn-line" data-dl download="boplo-${esc(m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}.png">Download</a><button type="button" class="btn btn-blue btn-has-spark" data-sharenow>Share ${spark}</button></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => sheet.close()); sheet.onclick = e => { if (e.target === sheet) sheet.close(); };
    sheet.showModal();
    const c = await drawCard(m), url = c.toDataURL('image/png');
    const prev = sheet.querySelector('[data-prev]'); prev.innerHTML = ''; const img = new Image(); img.src = url; img.alt = `${m.title} share card`; prev.append(img);
    sheet.querySelector('[data-dl]').href = url;
    const btn = sheet.querySelector('[data-sharenow]');
    c.toBlob(blob => {
      const file = new File([blob], 'boplo-milestone.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) btn.onclick = () => navigator.share({ files: [file], title: m.title, text: `${m.title} · logged with Boplo Flight` }).catch(() => { });
      else { btn.textContent = 'Download to share'; btn.onclick = () => sheet.querySelector('[data-dl]').click(); }
    }, 'image/png');
  }

  /* ================= study ================= */
  // the question bank follows the student's licensing system: FAA students get FAA subjects and questions
  const QB0 = window.BOPLO_QUESTIONS, qbCache = {};
  const qbNow = () => { const r = regimeOf(state.profile) === 'faa' ? 'faa' : 'icao'; return qbCache[r] || (qbCache[r] = QB0.forRegime ? QB0.forRegime(r) : QB0); };
  const QB = QB0 && { get status() { return QB0.status; }, get reviewed() { return QB0.reviewed; }, passMark: r => QB0.passMark(r), get subjects() { return qbNow().subjects; }, get questions() { return qbNow().questions; } };
  const studyOf = p => readJSON(p.study, {});
  let quiz = null;
  // spaced repetition (Leitner boxes): each question keeps [right, seen, box, dueDay]. Right moves it up a box, wrong sends it back to box 1.
  const BOX_DAYS = [0, 1, 3, 7, 16, 35], BOX_STRENGTH = [0, .25, .5, .72, .88, 1];
  const dayNo = () => Math.floor(parseISO(todayISO()).getTime() / 86400000);
  const boxOf = r => r ? (r[2] != null ? r[2] : (r[0] / r[1] >= .75 ? 3 : r[0] ? 2 : 1)) : 0;
  const dueOf = r => r ? (r[3] != null ? r[3] : 0) : null;
  const strength = r => { if (!r) return 0; const b = boxOf(r), late = dayNo() - (dueOf(r) || 0); return BOX_STRENGTH[b] * (late > BOX_DAYS[b] * 2 + 7 ? .75 : 1); };
  const dueQs = st => QB.questions.filter(q => st[q.id] && dueOf(st[q.id]) <= dayNo());
  const readiness = (st, subject) => { const qs = QB.questions.filter(q => !subject || q.subject === subject); return qs.length ? Math.round(sum(qs, q => strength(st[q.id])) / qs.length * 100) : 0; };
  const readyLabel = n => n >= 85 ? 'Ready to book' : n >= 65 ? 'Getting there' : n >= 30 ? 'Building up' : 'Just starting';
  function studyPage() {
    if (!isAdv()) { shell('study', { title: 'Study', sub: 'Theory practice for your licence exams.' }, paywall('Practise for your theory exams.', 'Practice questions by subject, weakest first, and timed mock exams with your authority’s pass mark.')); return; }
    if (!QB) { shell('study', { title: 'Study' }, '<div class="tile empty center"><h3>Questions didn’t load.</h3><p>Reload the page to try again.</p></div>'); return; }
    if (quiz) return quizView();
    const p = state.profile, st = studyOf(p), pm = QB.passMark(regimeOf(p));
    const sub = QB.subjects.map(s => { const qs = QB.questions.filter(q => q.subject === s.id); const seen = qs.filter(q => st[q.id]); const right = qs.filter(q => st[q.id]?.[0] > 0 && st[q.id][0] >= st[q.id][1] - st[q.id][0]); return { ...s, seen: seen.length, score: seen.length ? Math.round(sum(seen, q => st[q.id][0] / st[q.id][1]) / seen.length * 100) : null }; });
    sub.forEach(s => s.ready = readiness(st, s.id));
    const weak = sub.filter(s => s.score != null && s.score < pm).sort((a, b) => a.score - b.score);
    const due = dueQs(st).length, fresh = QB.questions.filter(q => !st[q.id]).length, ready = readiness(st), Cr = 2 * Math.PI * 44;
    const mocks = (st._mocks || []).slice(-5).reverse();
    shell('study', { title: 'Study', sub: 'Practise the theory between lessons. Short sessions, explained answers, and a mock exam when you’re ready.', actions: `<button class="btn btn-blue btn-has-spark" data-mock>Start a mock exam ${spark}</button>` },
      `<p class="callout draft">${QB.reviewed ? `Reviewed by ${esc(QB.reviewed.by)}.` : '<b>Early-access question bank.</b> Original questions written for Boplo, awaiting review by a flight instructor.'} Use them for practice alongside your official study material, not instead of it.</p>
      <div class="grid" style="margin-top:16px">
        <section class="tile dark span-12 review-hero">${contours('b')}
          <div class="ring ring-sm" role="img" aria-label="Exam readiness ${ready}%"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44"/><circle class="fill" cx="50" cy="50" r="44" stroke-dasharray="${Cr.toFixed(1)}" stroke-dashoffset="${(Cr * (1 - ready / 100)).toFixed(1)}"/></svg><div><b class="num">${ready}%</b></div></div>
          <div class="review-main"><span class="kicker">Exam readiness · ${esc(readyLabel(ready))}</span><h2 class="display">${due ? `${due} question${due === 1 ? '' : 's'} due for review` : fresh ? 'Nothing due. Learn something new.' : 'All caught up.'}</h2><p>Questions you get right come back after longer and longer gaps; ones you miss come back tomorrow. A few minutes a day is how it sticks.</p></div>
          <button class="btn btn-light btn-has-spark" data-review ${due || fresh ? '' : 'disabled'}>${due ? 'Start today’s review' : 'Learn 10 new'} ${spark}</button>
        </section>
        <section class="span-8 subj-grid">${sub.map(s => `<button type="button" class="tile subj" data-subj="${s.id}"><span class="subj-top"><b>${esc(s.name)}</b>${s.score != null ? `<span class="chip ${s.score >= pm ? 'ok' : 'warn'}">${s.score}%</span>` : `<span class="chip">${s.count} questions</span>`}</span><small>${esc(s.blurb)}</small><span class="subj-bar"><i style="width:${s.ready}%"></i></span><span class="subj-meta">${s.ready}% ready · ${s.seen} of ${s.count} practised</span></button>`).join('')}</section>
        <aside class="span-4" style="display:grid;gap:16px;align-content:start">
          <section class="tile"><div class="tile-head"><h2>Focus next</h2></div>${weak.length ? `<div class="bars">${weak.slice(0, 3).map(s => `<div class="bar-row"><div><span>${esc(s.name)}</span><b>${s.score}%</b></div><div class="bar-track"><i style="width:${s.score}%;background:var(--electric)"></i></div></div>`).join('')}</div><button class="btn btn-ink btn-sm" style="margin-top:16px" data-subj="${weak[0].id}">Practise ${esc(weak[0].name)}</button>` : `<p class="hint">${sub.some(s => s.seen) ? `Every subject you’ve practised is at or above the ${pm}% pass mark.` : 'Practise a subject and the ones that need work show up here.'}</p>`}</section>
          ${examTile()}
          <section class="tile"><div class="tile-head"><h2>Mock exams</h2><span class="chip">Pass mark ${pm}%</span></div>${mocks.length ? `<div class="airports">${mocks.map(m => `<div><span>${esc(fmtDate(m.d, { day: 'numeric', month: 'short' }))}</span><b class="${m.s >= pm ? 'pass' : 'fail'}">${m.s}% ${m.s >= pm ? 'pass' : 'below pass'}</b></div>`).join('')}</div>` : '<p class="hint">16 mixed questions across all subjects, scored against the pass mark your authority uses.</p>'}</section>
        </aside>
      </div>`);
    $$('[data-subj]').forEach(b => b.onclick = () => startQuiz(b.dataset.subj));
    $$('[data-mock]').forEach(b => b.onclick = () => startQuiz(null));
    $$('[data-review]').forEach(b => b.onclick = () => startQuiz('review'));
    wireExams(studyPage);
  }
  // theory exam dates with a countdown; they also appear in the calendar feed
  const examsOf = p => { const x = readJSON(p.exams, []); return Array.isArray(x) ? x : []; };
  function examTile() {
    const ex = examsOf(state.profile).filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date)), up = ex.filter(e => daysUntil(e.date) >= 0);
    return `<section class="tile"><div class="tile-head"><h2>Exam dates</h2>${up[0] ? `<span class="chip ${daysUntil(up[0].date) <= 14 ? 'warn' : ''}">${daysUntil(up[0].date) === 0 ? 'Today' : `${daysUntil(up[0].date)} days`}</span>` : ''}</div>
      ${ex.length ? `<div class="airports exams">${ex.map((e, i) => `<div class="${daysUntil(e.date) < 0 ? 'past' : ''}"><span>${esc(e.name)}</span><b>${esc(fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' }))} <button type="button" class="icon-btn" data-delexam="${i}" aria-label="Remove exam">${ico('close')}</button></b></div>`).join('')}</div>` : '<p class="hint">Add your theory exam dates to count down and see them in your calendar.</p>'}
      <form class="exam-add" data-addexam><input name="name" placeholder="Subject, e.g. Air law" maxlength="60" required><input name="date" type="date" required><button class="btn btn-line btn-sm">Add</button></form>
      <button type="button" class="link" data-calsub2 style="margin-top:10px">${state.profile.calOn ? 'Calendar sync is on' : 'Show these in my calendar'}</button></section>`;
  }
  function wireExams(again) {
    const f = $('[data-addexam]'); if (!f) return;
    const save = async list => { try { await saveProfile({ exams: JSON.stringify(list) }); again(); } catch (x) { toast(x.message); } };
    f.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); if (!v.name.trim() || !v.date) return; save([...examsOf(state.profile), { name: v.name.trim().slice(0, 60), date: v.date }].sort((a, b) => a.date.localeCompare(b.date)).slice(-20)); };
    $$('[data-delexam]').forEach(b => b.onclick = () => { const ex = examsOf(state.profile).filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date)); ex.splice(+b.dataset.delexam, 1); save(ex); });
    const c2 = $('[data-calsub2]'); if (c2) c2.onclick = calendarSheet;
  }
  function startQuiz(subject) {
    const st = studyOf(state.profile);
    if (subject === 'review') {
      const due = dueQs(st).sort((a, b) => dueOf(st[a.id]) - dueOf(st[b.id])).slice(0, 15);
      const fresh = QB.questions.filter(q => !st[q.id]).sort(() => Math.random() - .5).slice(0, Math.max(0, 10 - due.length));
      quiz = { subject: null, review: true, mock: false, qs: [...due, ...fresh].sort(() => Math.random() - .5), i: 0, picked: null, right: 0, answers: [] };
      quizView(); scrollTo({ top: 0 }); return;
    }
    let pool = QB.questions.filter(q => !subject || q.subject === subject);
    const weight = q => { const r = st[q.id]; return r ? r[0] / r[1] : -1; };
    pool = pool.map(q => [q, weight(q) + Math.random() * .35]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    if (!subject) pool = pool.sort(() => Math.random() - .5);
    quiz = { subject, mock: !subject, qs: pool.slice(0, subject ? 10 : 16), i: 0, picked: null, right: 0, answers: [] };
    quizView(); scrollTo({ top: 0 });
  }
  function quizView() {
    const q = quiz.qs[quiz.i], subj = QB.subjects.find(s => s.id === (quiz.subject || q?.subject));
    if (!q) return quizDone();
    const order = quiz.order?.[quiz.i] || (quiz.order = quiz.order || [], quiz.order[quiz.i] = [0, 1, 2, 3].sort(() => Math.random() - .5));
    const answered = quiz.picked != null;
    shell('study', { title: quiz.mock ? 'Mock exam' : quiz.review ? 'Daily review' : esc(subj.name), sub: `Question ${quiz.i + 1} of ${quiz.qs.length}${quiz.mock || quiz.review ? ` · ${esc(QB.subjects.find(s => s.id === q.subject).name)}` : ''}`, actions: '<button class="btn btn-line" data-quit>End session</button>' },
      `<section class="tile quiz">
        <div class="quiz-bar"><i style="width:${quiz.i / quiz.qs.length * 100}%"></i></div>
        <h2 class="quiz-q">${esc(q.q)}</h2>
        <div class="quiz-opts" role="group" aria-label="Answers">${order.map(oi => { const cls = !answered ? '' : oi === q.answer ? 'right' : oi === quiz.picked ? 'wrong' : 'dim'; return `<button type="button" class="opt ${cls}" data-opt="${oi}" ${answered ? 'disabled' : ''}>${esc(q.options[oi])}</button>`; }).join('')}</div>
        ${answered ? `<div class="quiz-explain ${quiz.picked === q.answer ? 'ok' : 'bad'}" role="status"><b>${quiz.picked === q.answer ? 'Correct.' : 'Not quite.'}</b> ${esc(q.explain)}${!preview ? `<div class="quiz-more" data-more>${quiz.more?.[quiz.i] ? md(quiz.more[quiz.i], askSources || {}) : `<button type="button" class="link" data-explain>${ico('ask')}Explain it another way with Ask Boplo</button>`}</div>` : ''}</div>
        <div class="actions"><span class="hint">${quiz.right} correct so far</span><div class="right"><button class="btn btn-blue btn-has-spark" data-next>${quiz.i + 1 < quiz.qs.length ? 'Next question' : 'See results'} ${spark}</button></div></div>` : ''}
      </section>`);
    $$('[data-opt]').forEach(b => b.onclick = () => { quiz.picked = Number(b.dataset.opt); const ok = quiz.picked === q.answer; if (ok) quiz.right++; quiz.answers.push([q.id, ok]); quizView(); $('[data-next]')?.focus(); });
    const n = $('[data-next]'); if (n) n.onclick = () => { quiz.i++; quiz.picked = null; quizView(); };
    const ex = $('[data-explain]'); if (ex) ex.onclick = async () => {
      const box = $('[data-more]'), at = quiz.i, picked = q.options[quiz.picked];
      box.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      const prompt = `I'm practising a theory question.\nQuestion: ${q.q}\nOptions: ${q.options.join(' | ')}\nCorrect answer: ${q.options[q.answer]}\nI chose: ${picked}\nThe app's explanation: ${q.explain}\n\nExplain it another way in under 120 words, with a simple way to remember it${quiz.picked !== q.answer ? ', and why my choice is wrong' : ''}.`;
      try { const text = await askOnce(prompt, t => { if (quiz && quiz.i === at) box.innerHTML = md(t, askSources || {}); }); (quiz.more = quiz.more || {})[at] = text; }
      catch (x) { box.innerHTML = `<p class="form-error">${esc(x.message)}</p>`; }
    };
    $('[data-quit]').onclick = () => { if (quiz.answers.length) quizDone(true); else { quiz = null; studyPage(); } };
  }
  async function quizDone(early = false) {
    const p = state.profile, st = studyOf(p), pm = QB.passMark(regimeOf(p));
    quiz.answers.forEach(([id, ok]) => { const r = st[id] || [0, 0]; const box = ok ? Math.min(5, (r[1] ? boxOf(r) : 1) + 1) : 1; st[id] = [r[0] + (ok ? 1 : 0), r[1] + 1, box, dayNo() + BOX_DAYS[box]]; });
    const score = Math.round(quiz.right / Math.max(1, quiz.answers.length) * 100);
    if (quiz.mock && !early) st._mocks = [...(st._mocks || []), { d: todayISO(), s: score }].slice(-20);
    const missed = quiz.answers.filter(a => !a[1]).map(a => QB.questions.find(q => q.id === a[0]));
    const res = { ...quiz }; quiz = null;
    try { await saveProfile({ study: JSON.stringify(st) }); } catch { }
    shell('study', { title: res.mock ? 'Mock exam result' : res.review ? 'Review done' : 'Session complete', sub: `${res.right} of ${res.answers.length} correct · exam readiness now ${readiness(st)}%.` },
      `<section class="tile quiz result">
        <div class="result-score ${score >= pm ? 'pass' : 'fail'}"><b>${score}%</b><span>${res.mock ? (score >= pm ? `At or above the ${pm}% pass mark` : `Below the ${pm}% pass mark`) : 'this session'}</span></div>
        ${missed.length ? `<h3>Worth another look</h3><div class="missed">${missed.map(q => `<div><b>${esc(q.q)}</b><p>${esc(q.options[q.answer])}. ${esc(q.explain)}</p></div>`).join('')}</div>` : '<p class="hint">Everything right. Nice work.</p>'}
        <div class="actions"><button class="btn btn-line" data-back>Back to subjects</button><div class="right"><button class="btn btn-blue btn-has-spark" data-again>${res.mock ? 'Another mock' : 'Practise again'} ${spark}</button></div></div>
      </section>`);
    $('[data-back]').onclick = () => studyPage();
    $('[data-again]').onclick = () => startQuiz(res.review ? 'review' : res.subject);
  }

  /* ================= weather decoder ================= */
  const CLOUD = { FEW: 'Few (1–2 oktas)', SCT: 'Scattered (3–4 oktas)', BKN: 'Broken (5–7 oktas)', OVC: 'Overcast (8 oktas)', NSC: 'No significant cloud', SKC: 'Sky clear', CLR: 'Clear below 12,000 ft', NCD: 'No cloud detected', VV: 'Vertical visibility (sky obscured)' };
  const WX = { RA: 'rain', DZ: 'drizzle', SN: 'snow', SG: 'snow grains', GR: 'hail', GS: 'small hail', PL: 'ice pellets', BR: 'mist', FG: 'fog', HZ: 'haze', FU: 'smoke', DU: 'dust', SA: 'sand', SQ: 'squalls', FC: 'funnel cloud', TS: 'thunderstorm', SH: 'showers', FZ: 'freezing', MI: 'shallow', BC: 'patches', PR: 'partial', DR: 'drifting', BL: 'blowing', VC: 'in the vicinity', UP: 'unknown precipitation' };
  function decodeToken(t, i) {
    let m;
    if (i === 0 && /^[A-Z]{4}$/.test(t)) return ['Station', `${t} is the reporting airfield’s ICAO code.`];
    if ((m = t.match(/^(\d{2})(\d{2})(\d{2})Z$/))) return ['Time', `Observed on day ${+m[1]} at ${m[2]}:${m[3]} UTC.`];
    if (t === 'AUTO') return ['Automatic', 'Made by an automatic station without a human observer.'];
    if (t === 'COR') return ['Corrected', 'A corrected report.'];
    if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) return ['Wind', `${m[1] === 'VRB' ? 'Variable direction' : `From ${m[1]}° true`} at ${+m[2]} ${m[4] === 'KT' ? 'knots' : 'm/s'}${m[3] ? `, gusting ${+m[3]}` : ''}.`];
    if ((m = t.match(/^(\d{3})V(\d{3})$/))) return ['Wind varies', `Direction varying between ${m[1]}° and ${m[2]}°.`];
    if (t === 'CAVOK') return ['CAVOK', 'Visibility 10 km or more, no cloud below 5,000 ft (or MSA), no CB or TCU, no significant weather.'];
    if (t === '9999') return ['Visibility', '10 km or more.'];
    if (/^\d{4}$/.test(t)) return ['Visibility', `${(+t).toLocaleString('en-GB')} metres.`];
    if ((m = t.match(/^(\d{1,2}(?:\/\d)?|\d \d\/\d)SM$/))) return ['Visibility', `${m[1]} statute miles.`];
    if (/^P6SM$/.test(t)) return ['Visibility', 'More than 6 statute miles.'];
    if ((m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/))) return ['Cloud', `${CLOUD[m[1]]} at ${(+m[2] * 100).toLocaleString('en-GB')} ft above the airfield${m[3] ? `, ${m[3] === 'CB' ? 'cumulonimbus (thunderstorm cloud)' : 'towering cumulus'}` : ''}.`];
    if (CLOUD[t]) return ['Cloud', CLOUD[t] + '.'];
    if ((m = t.match(/^(M?\d{2})\/(M?\d{2})?$/))) { const c = s => s ? (s[0] === 'M' ? -s.slice(1) : +s) : null; const a = c(m[1]), b = c(m[2]); return ['Temperature', `${a} °C, dew point ${b ?? '–'} °C${b != null ? `. Spread ${a - b} °C${a - b <= 2 ? ': close to saturation, watch for mist or fog' : ''}` : ''}.`]; }
    if ((m = t.match(/^Q(\d{4})$/))) return ['QNH', `Pressure ${+m[1]} hPa. Set this to read altitude above sea level.`];
    if ((m = t.match(/^A(\d{4})$/))) return ['Altimeter', `${m[1].slice(0, 2)}.${m[1].slice(2)} inHg.`];
    if (t === 'NOSIG') return ['Trend', 'No significant change expected in the next 2 hours.'];
    if (/^(BECMG|TEMPO|FM\d{6}|PROB\d{2})$/.test(t)) return ['Change group', { BECMG: 'Becoming: a lasting change.', TEMPO: 'Temporarily: fluctuations lasting under an hour each.' }[t] || (t.startsWith('FM') ? `From ${t.slice(4, 6)}:${t.slice(6, 8)} UTC on day ${+t.slice(2, 4)}.` : `${t.slice(4)}% probability.`)];
    if ((m = t.match(/^(-|\+|VC)?((?:MI|BC|PR|DR|BL|SH|TS|FZ)?)((?:RA|DZ|SN|SG|GR|GS|PL|BR|FG|HZ|FU|DU|SA|SQ|FC|UP)+)$/))) { const ph = (m[3].match(/../g) || []).map(x => WX[x]).join(' and '), d = m[2]; const txt = d === 'SH' ? `${ph} showers` : d === 'TS' ? `thunderstorm${ph ? ' with ' + ph : ''}` : `${d ? WX[d] + ' ' : ''}${ph}`; const lead = m[1] === '-' ? 'Light ' : m[1] === '+' ? 'Heavy ' : ''; const out = lead + txt; return ['Weather', `${out.charAt(0).toUpperCase() + out.slice(1)}${m[1] === 'VC' ? ' in the vicinity' : ''}.`]; }
    if (/^R\d{2}/.test(t)) return ['Runway', 'Runway visual range or runway condition.'];
    return null;
  }
  const decode = raw => { const toks = String(raw || '').trim().split(/\s+/); const out = []; for (let i = 0; i < toks.length; i++) { if (toks[i] === 'RMK') { out.push([toks.slice(i).join(' '), 'Remarks', 'Extra local information.']); break; } if (/^(METAR|SPECI|TAF)$/.test(toks[i])) continue; const d = decodeToken(toks[i], out.length); out.push([toks[i], ...(d || ['', ''])]); } return out; };
  function windFor(st, af) {
    if (!af?.runways?.length || st.wdir == null || st.wdir === 'VRB' || !st.wspd) return [];
    const ends = af.runways.flatMap(r => String(r[0] || '').split('/')).map(e => e.match(/^(\d{2})/)).filter(Boolean).map(m => +m[1]);
    return [...new Set(ends)].map(rw => { const a = ((+st.wdir - rw * 10) * Math.PI) / 180; return { rw: String(rw).padStart(2, '0'), head: Math.round(Math.cos(a) * st.wspd), cross: Math.round(Math.sin(a) * st.wspd) }; }).sort((a, b) => b.head - a.head);
  }
  const EX_WX = { source: 'Example', stations: [
    { id: 'EGHI', name: 'Southampton', dist: 17, raw: 'EGHI 211650Z 24012G22KT 210V280 9999 -SHRA FEW018 SCT030CB 14/09 Q1011', obsTime: null, wdir: 240, wspd: 12, fltCat: 'VFR', taf: 'TAF EGHI 211700Z 2118/2218 24012KT 9999 SCT030 TEMPO 2118/2203 7000 -SHRA BKN014 BECMG 2206/2209 30008KT' },
    { id: 'EGLF', name: 'Farnborough', dist: 22, raw: 'EGLF 211650Z 23010KT 9999 FEW035 15/08 Q1012', wdir: 230, wspd: 10, fltCat: 'VFR', taf: '' }
  ] };
  async function anyAirfield(code) {
    const c = upper(code).split(/[\s·]/)[0]; if (!c || !window.BoploMap) return null;
    const home = countryCodeOf(state.profile);
    let a = home ? BoploMap.findAirfield(await BoploMap.airfields(home), c) : null; if (a) return { ...a, cc: home };
    try {
      window.__afCodes = window.__afCodes || fetch('/airfields/codes.json').then(r => r.json());
      const idx = await window.__afCodes; const cc = Object.keys(idx).find(k => (' ' + idx[k] + ' ').includes(' ' + c + ' '));
      if (cc) { a = BoploMap.findAirfield(await BoploMap.airfields(cc), c); if (a) return { ...a, cc }; }
    } catch { }
    return null;
  }
  const RMK = (t, all) => {
    let m;
    if (t === 'AO1' || t === 'A01') return ['Station type', 'Automated station without a precipitation sensor.'];
    if (t === 'AO2' || t === 'A02') return ['Station type', 'Automated station with a precipitation sensor.'];
    if ((m = t.match(/^SLP(\d{3})$/))) { const v = +m[1] / 10; return ['Sea-level pressure', `${(v < 50 ? 1000 + v : 900 + v).toFixed(1)} hPa.`]; }
    if (t === 'SLPNO') return ['Sea-level pressure', 'Not available.'];
    if ((m = t.match(/^T([01])(\d{3})([01])(\d{3})$/))) { const f = (s, n) => (s === '1' ? -1 : 1) * +n / 10; return ['Precise temperature', `${f(m[1], m[2]).toFixed(1)} °C, dew point ${f(m[3], m[4]).toFixed(1)} °C.`]; }
    if ((m = t.match(/^1([01])(\d{3})$/))) return ['6-hour maximum', `${((m[1] === '1' ? -1 : 1) * +m[2] / 10).toFixed(1)} °C.`];
    if ((m = t.match(/^2([01])(\d{3})$/))) return ['6-hour minimum', `${((m[1] === '1' ? -1 : 1) * +m[2] / 10).toFixed(1)} °C.`];
    if ((m = t.match(/^5(\d)(\d{3})$/))) return ['3-hour pressure trend', `Changed by ${(+m[2] / 10).toFixed(1)} hPa (trend type ${m[1]}).`];
    if ((m = t.match(/^P(\d{4})$/))) return ['Precipitation', `${(+m[1] / 100).toFixed(2)} in in the last hour.`];
    if (t === 'PRESRR') return ['Pressure', 'Rising rapidly.'];
    if (t === 'PRESFR') return ['Pressure', 'Falling rapidly.'];
    if (t === 'TSNO') return ['Sensor', 'Thunderstorm sensor not available.'];
    if (t === '$') return ['Maintenance', 'The station needs maintenance.'];
    if (/^(BLU|WHT|GRN|YLO1?|YLO2|AMB|RED)\+?$/.test(t)) return ['Colour state', `Military airfield colour code ${t} (visibility and cloud category).`];
    return null;
  };
  const decodeAll = raw => {
    const toks = String(raw || '').trim().split(/\s+/), out = [];
    let rmk = false;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (/^(METAR|SPECI|TAF)$/.test(t)) continue;
      if (t === 'RMK') { rmk = true; out.push([t, 'Remarks', 'Everything after this is extra local information.']); continue; }
      const d = rmk ? RMK(t) : decodeToken(t, out.length);
      out.push([t, ...(d || [rmk ? 'Remark' : '', rmk ? 'Local remark.' : ''])]);
    }
    return out;
  };
  const EX_ONE = { id: 'KBHM', name: 'Birmingham Intl, AL, US', dist: 0, raw: 'METAR KBHM 211553Z 09004KT 10SM FEW250 23/08 A3026 RMK AO2 SLP241 T02280083', wdir: 90, wspd: 4, fltCat: 'VFR', taf: '' };
  function stationCard(s, i, af) {
    const dec = decodeAll(s.raw), comp = windFor(s, af);
    const cat = c => c ? `<span class="chip cat-${esc(String(c).toLowerCase())}">${esc(c)}</span>` : '';
    return `<section class="tile ${i === 0 ? 'span-12' : 'span-6'} wx" aria-label="${esc(s.id)} weather">
      <div class="tile-head"><h2>${esc(s.id)} <span class="wx-name">${esc(s.name || '')}${s.dist ? ` · ${s.dist} NM away` : ''}</span></h2>${cat(s.fltCat)}</div>
      <div class="wx-raw"><code>${esc(s.raw)}</code></div>
      ${i === 0 ? `<label class="wx-toggle"><input type="checkbox" data-hide> Try reading it yourself first (hide the decode)</label>` : ''}
      <div class="wx-dec" data-dec>${dec.map(([t, k, v]) => `<div class="wx-row"><code>${esc(t)}</code><span><b>${esc(k || 'Code')}</b> ${esc(v || 'Not decoded here.')}</span></div>`).join('')}</div>
      ${comp.length ? `<div class="wx-comp"><h3>Wind on ${esc(af.code)} runways</h3><div class="wx-comp-grid">${comp.map(c => `<div><b>Runway ${c.rw}</b><span>${c.head >= 0 ? `${c.head} kt headwind` : `${-c.head} kt tailwind`} · ${Math.abs(c.cross)} kt crosswind from the ${c.cross >= 0 ? 'right' : 'left'}</span></div>`).join('')}</div><p class="footnote">Practice maths using ${esc(s.id)}’s wind (true) on ${esc(af.code)}’s runways (magnetic), so it’s approximate.${s.dist ? ` Wind ${s.dist} NM away can differ.` : ''}</p></div>` : ''}
      ${s.taf ? `<details class="more wx-taf" ${i === 0 ? 'open' : ''}><summary>Forecast (TAF)</summary><div class="wx-raw" style="margin:0 16px"><code>${esc(s.taf)}</code></div><div class="wx-dec" style="padding:12px 16px 16px">${decodeAll(s.taf).map(([t, k, v]) => `<div class="wx-row"><code>${esc(t)}</code><span><b>${esc(k || 'Code')}</b> ${esc(v || (/^\d{4}\/\d{4}$/.test(t) ? `Valid from day ${+t.slice(0, 2)} ${t.slice(2, 4)}:00 to day ${+t.slice(5, 7)} ${t.slice(7, 9)}:00 UTC.` : 'Other group.'))}</span></div>`).join('')}</div></details>` : ''}
    </section>`;
  }
  async function weatherPage(query) {
    const p = state.profile, homeCode = upper(p.airport).split(/[\s·]/)[0];
    const q = upper(query || ui.wxq || '').trim();
    shell('weather', { title: 'Weather', sub: 'Look up the live METAR and TAF for any airport or airfield, with every group explained.' },
      `<form class="wx-search" data-wxform role="search"><label class="search">${ico('search')}<span class="sr">Airport or airfield code</span><input data-wxq list="wx-af" value="${esc(q)}" placeholder="ICAO code or airfield name, e.g. EGLL, KJFK" autocomplete="off" autocapitalize="characters"><datalist id="wx-af"></datalist></label><button class="btn btn-blue" type="submit">Get weather</button>${homeCode ? `<button type="button" class="btn btn-line" data-wxhome>${esc(homeCode)} (home)</button>` : ''}</form>
       <p class="callout warn" style="margin-top:14px">A learning tool, not a weather briefing. Before any flight, get an official briefing and talk to your instructor.</p>
       <div data-wx style="margin-top:16px"><div class="tile"><p class="hint">Fetching the latest reports…</p></div></div>`);
    const form = $('[data-wxform]'), inp = $('[data-wxq]');
    form.onsubmit = e => { e.preventDefault(); ui.wxq = inp.value.trim(); weatherPage(ui.wxq); };
    const hb = $('[data-wxhome]'); if (hb) hb.onclick = () => { ui.wxq = ''; weatherPage(''); };
    if (window.BoploMap && countryCodeOf(p)) BoploMap.airfields(countryCodeOf(p)).then(list => { const dl = $('#wx-af'); if (dl) dl.innerHTML = list.filter(a => a.type !== 'S' || /^[A-Z]{4}$/.test(a.code)).slice(0, 5000).map(a => `<option value="${esc(a.code)}">${esc(a.name)}</option>`).join(''); });
    const box = $('[data-wx]');
    const target = q || homeCode;
    // resolve a typed name to a code
    let code = target, af = null;
    if (target && !/^[A-Z0-9]{3,4}$/.test(target) && window.BoploMap) { const list = await BoploMap.airfields(countryCodeOf(p)); const hit = list.find(a => a.name.toUpperCase().includes(target)); if (hit) code = hit.code; }
    if (code) af = await anyAirfield(code);
    if (!code) { box.innerHTML = `<div class="tile empty center"><h3>Search for an airfield.</h3><p>Type an ICAO code like EGLL or KJFK, or set your home airfield in your profile.</p></div>`; return; }
    let data;
    try {
      if (preview) data = { source: 'Example', stations: [q && q !== 'EGHP' ? { ...EX_ONE, id: code, name: af?.name || code, raw: EX_ONE.raw.replace('KBHM', code) } : EX_WX.stations[0], ...(q ? [] : [EX_WX.stations[1]])], exact: !!q };
      else data = await api(`weather?ids=${encodeURIComponent(code)}${af ? `&lat=${af.lat}&lng=${af.lng}` : ''}`);
    } catch (x) { box.innerHTML = `<div class="tile empty center"><h3>Weather reports didn’t load.</h3><p>${esc(x.message)}</p><button class="btn btn-line" data-retry>Try again</button></div>`; $('[data-retry]').onclick = () => weatherPage(q); return; }
    if (!data.stations?.length) { box.innerHTML = `<div class="tile empty center"><h3>No reports for ${esc(code)}.</h3><p>${af ? `${esc(af.name)} doesn’t publish a METAR and there are no reporting stations within about 200 NM.` : `We couldn’t find a METAR for ${esc(code)}. Check the code, or try a larger airport nearby.`}</p></div>`; return; }
    const note = !data.exact && code ? `<p class="callout" style="margin-bottom:16px">${esc(af?.name || code)} doesn’t publish its own METAR. These are the nearest stations that do.</p>` : '';
    const ref = af || (homeCode ? await anyAirfield(homeCode) : null);
    box.innerHTML = `${note}<div class="grid">${data.stations.map((s, i) => stationCard(s, i, data.exact ? (af || ref) : ref)).join('')}</div>
      <p class="footnote">${preview ? 'Example reports in the example desk.' : `Live data from ${esc(data.source)}, fetched ${esc(new Date(data.fetched).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}.`}</p>`;
    const hide = box.querySelector('[data-hide]'); if (hide) hide.onchange = () => box.querySelector('[data-dec]').classList.toggle('hidden', hide.checked);
  }

  /* ================= nav log (planning log) ================= */
  const toR = d => d * Math.PI / 180, toD = r => r * 180 / Math.PI, norm360 = d => ((d % 360) + 360) % 360;
  const bearing = (a, b) => norm360(toD(Math.atan2(Math.sin(toR(b.lng - a.lng)) * Math.cos(toR(b.lat)), Math.cos(toR(a.lat)) * Math.sin(toR(b.lat)) - Math.sin(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.cos(toR(b.lng - a.lng)))));
  const distNM = (a, b) => { const h = Math.sin(toR(b.lat - a.lat) / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(toR(b.lng - a.lng) / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.sqrt(h)); };
  const pad3 = n => String(Math.round(norm360(n)) % 360).padStart(3, '0');
  function legsFor(pts, inp) {
    const tas = +inp.tas || 0, wd = +inp.wdir || 0, ws = +inp.wspd || 0, vr = (+inp.vari || 0) * (inp.vdir === 'E' ? -1 : 1), burn = +inp.burn || 0;
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], tt = bearing(a, b), d = distNM(a, b), rel = toR(wd - tt);
      const x = tas ? ws * Math.sin(rel) / tas : 0, ok = Math.abs(x) < 1;
      const wca = ok ? toD(Math.asin(x)) : NaN, gs = ok ? tas * Math.cos(toR(wca)) - ws * Math.cos(rel) : NaN;
      const th = tt + wca, mh = th + vr, mins = gs > 0 ? d / gs * 60 : NaN;
      out.push({ from: a.code || `TP${i}`, to: b.code || (i === pts.length - 1 ? 'END' : `TP${i + 1}`), tt, d, wca, th, mh, gs, mins, fuel: Number.isFinite(mins) ? burn * mins / 60 : NaN, ok: ok && gs > 0 });
    }
    return out;
  }
  /* ================= preflight: weight and balance, runway performance, briefing ================= */
  const PF = () => window.BoploPreflight;
  const pfStore = () => readJSON(state.profile.preflight, {});
  const pfType = p => { const a = String(p.aircraft || '').toLowerCase(); return /152/.test(a) ? 'c152' : /172/.test(a) ? 'c172' : /pa-?28|warrior|archer|cherokee/.test(a) ? 'pa28' : /da-?40/.test(a) ? 'da40' : /da-?20|katana/.test(a) ? 'da20' : /p2008|tecnam/.test(a) ? 'p2008' : /dr-?400|robin/.test(a) ? 'dr400' : /sr-?20|cirrus/.test(a) ? 'sr20' : /cub/.test(a) ? 'cub' : 'c172'; };
  const NOTAM_LINKS = { ES: ['ENAIRE NOTAM briefing (ICARO)', 'https://notampib.enaire.es/'], GB: ['NATS AIS pre-flight briefing', 'https://nats-uk.ead-it.com/cms-nats/opencms/en/Pre-flight-briefing/'], US: ['FAA NOTAM Search', 'https://notams.aim.faa.gov/notamSearch/'], FR: ['SIA NOTAM (SOFIA)', 'https://sofia-briefing.aviation-civile.gouv.fr/'], DE: ['DFS AIS', 'https://secais.dfs.de/'], IE: ['IAA NOTAM', 'https://www.airnav.ie/'], AU: ['Airservices NAIPS', 'https://www.airservicesaustralia.com/naips/'], CA: ['NAV CANADA CFPS', 'https://plan.navcanada.ca/'], NZ: ['Airways IFIS', 'https://www.ifis.airways.co.nz/'] };
  const runwayEnds = async af => {
    const rows = ((await fetch(`/runways/${af.cc}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))).rows || {})[af.code] || [];
    const brg = (a, b) => norm360(toD(Math.atan2(Math.sin(toR(b[1] - a[1])) * Math.cos(toR(b[0])), Math.cos(toR(a[0])) * Math.sin(toR(b[0])) - Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(toR(b[1] - a[1])))));
    if (rows.length) return rows.flatMap(r => [{ id: r[0], hdg: brg([r[2], r[3]], [r[4], r[5]]), len: r[6], lda: r[6] - (r[10] || 0), surf: r[8], disp: r[10] || 0, trueHdg: true }, { id: r[1], hdg: brg([r[4], r[5]], [r[2], r[3]]), len: r[6], lda: r[6] - (r[11] || 0), surf: r[8], disp: r[11] || 0, trueHdg: true }]).filter(e => e.id);
    return (af.runways || []).flatMap(r => String(r[0] || '').split('/').map(id => ({ id, hdg: (parseInt(id, 10) || 0) * 10, len: r[1], lda: r[1], surf: r[2] }))).filter(e => e.id && /^\d/.test(e.id));
  };
  const PAVED_RE = /asp|con|pav|bit|tar|pem|cop/i;
  async function preflightPage() {
    if (!PF()) { shell('preflight', { title: 'Preflight' }, '<div class="tile empty center"><h3>Loading the preflight tools…</h3></div>'); await loadScript('/flight-preflight.js?v=1', () => !!window.BoploPreflight).catch(() => { }); if (!PF()) return; }
    const p = state.profile, S = pfStore(), P = PF();
    S.ac = S.ac || pfType(p); S.mine = S.mine || {}; S.loads = S.loads || {}; S.fuel = S.fuel || {}; S.mins = S.mins || { wind: 15, gust: 20, cross: 10, visKm: 8, ceil: 1500 }; S.cond = S.cond || {};
    S.ap = S.ap || upper(p.airport).split(/[\s·]/)[0] || '';
    const mine = S.mine[S.ac] = S.mine[S.ac] || {}, A0 = P.TYPES[S.ac], au = A0.units === 'lb' ? 'in' : 'm', wu = A0.units;
    const num = (n, v, extra = '') => `<input name="${n}" type="number" step="any" inputmode="decimal" value="${esc(v ?? '')}" ${extra}>`;
    const envTxt = (mine.envelope || A0.envelope || []).map(([x, y]) => `${x},${y}`).join('  ');
    shell('preflight', { title: 'Preflight', sub: 'Weight and balance, runway performance and a weather go/no-go for your next flight, on one page.', actions: '<button class="btn btn-ink" data-pfprint>Print briefing</button>' },
      `<p class="callout warn">A training aid. Use your aircraft’s own weight and balance report and POH, check every figure, and get an official briefing before you fly.</p>
      <div class="grid" style="margin-top:16px">
        <section class="tile span-5 pf-in"><div class="tile-head"><h2>Aircraft and loading</h2></div>
          <form class="fields" data-pfac novalidate>
            <label class="field"><span>Aircraft type</span><select name="ac">${Object.entries(P.TYPES).map(([k, t]) => `<option value="${k}" ${S.ac === k ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Registration</span><input name="reg" value="${esc(mine.reg || p.registration || '')}" maxlength="12" placeholder="e.g. G-ABCD" autocapitalize="characters"></label>
            ${A0.stations.map(s => `<label class="field"><span>${esc(s.label)} (${wu})${s.max ? ` <i>max ${s.max}</i>` : ''}</span>${num('l_' + s.id, S.loads[s.id], 'min="0"')}</label>`).join('')}
            <label class="field"><span>Fuel at start (${esc(A0.fuel.unit)})${A0.fuel.usable ? ` <i>max ${A0.fuel.usable}</i>` : ''}</span>${num('fuelStart', S.fuel.start, 'min="0"')}</label>
            <label class="field"><span>Flight time (min)</span>${num('mins', S.fuel.mins, 'min="0" placeholder="e.g. 60"')}</label>
          </form>
          <details class="more pf-mine" ${A0.needsArms && !mine.emptyW ? 'open' : ''}><summary>Your aircraft’s figures ${mine.emptyW ? '<span class="chip ok">Entered</span>' : `<span class="chip ${A0.needsArms ? 'warn' : ''}">${A0.needsArms ? 'Needed' : 'Using typical figures'}</span>`}</summary>
            <p class="hint" style="padding:0 16px">From the aircraft’s weight and balance report and POH. Arms in ${au}, weights in ${wu}. ${A0.source ? `Defaults: typical ${esc(A0.source)} figures.` : ''}</p>
            <form class="fields" data-pfmine novalidate>
              <label class="field"><span>Basic empty weight (${wu})</span>${num('emptyW', mine.emptyW, `placeholder="${A0.empty[0] || ''}"`)}</label>
              <label class="field"><span>Empty CG arm (${au})</span>${num('emptyArm', mine.emptyArm, `placeholder="${A0.empty[1] || ''}"`)}</label>
              <label class="field"><span>Max take-off weight (${wu})</span>${num('mtow', mine.mtow, `placeholder="${A0.mtow || ''}"`)}</label>
              <label class="field"><span>Fuel burn (${esc(A0.fuel.unit)}/h)</span>${num('burn', mine.burn, `placeholder="${A0.fuel.burn || ''}"`)}</label>
              <label class="field"><span>Fuel arm (${au})</span>${num('fuelArm', mine.fuelArm, `placeholder="${A0.fuel.arm ?? ''}"`)}</label>
              <label class="field"><span>Usable fuel (${esc(A0.fuel.unit)})</span>${num('fuelUsable', mine.fuelUsable, `placeholder="${A0.fuel.usable || ''}"`)}</label>
              ${A0.stations.map(s => `<label class="field"><span>${esc(s.label)} arm (${au})</span>${num('arm_' + s.id, mine.arms?.[s.id], `placeholder="${s.arm ?? ''}"`)}</label>`).join('')}
              <label class="field full"><span>CG envelope corners <i>arm,weight pairs, clockwise</i></span><input name="envelope" value="${esc(envTxt)}" placeholder="e.g. 35,1500  35,1950  41,2550  47.3,2550  47.3,1500"></label>
              <label class="field"><span>Take-off to 50 ft (m) <i>POH, sea level, max weight</i></span>${num('to50', mine.perf?.to50, `placeholder="${A0.perf.to50 || ''}"`)}</label>
              <label class="field"><span>Landing from 50 ft (m)</span>${num('ld50', mine.perf?.ld50, `placeholder="${A0.perf.ld50 || ''}"`)}</label>
            </form></details>
        </section>
        <section class="tile span-7"><div class="tile-head"><h2>Weight and balance</h2><span data-wbchip></span></div><div data-wb></div></section>
        <section class="tile span-12"><div class="tile-head"><h2>Runway performance</h2><span data-pfchip></span></div>
          <form class="fields pf-cond" data-pfcond novalidate>
            <label class="field"><span>Airfield</span><input name="ap" list="pf-afs" value="${esc(S.ap)}" placeholder="Code or name" autocomplete="off"><datalist id="pf-afs"></datalist></label>
            <label class="field"><span>Runway</span><select name="rw" data-pfrw><option value="">Loading…</option></select></label>
            <label class="field"><span>Surface</span><select name="surface">${Object.entries(P.SURF).map(([k, v]) => `<option value="${k}" ${S.cond.surface === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
            <label class="field"><span>Slope (% uphill)</span>${num('slope', S.cond.slope ?? 0)}</label>
            <label class="field"><span>Temperature (°C)</span>${num('oat', S.cond.oat)}</label>
            <label class="field"><span>QNH (hPa)</span>${num('qnh', S.cond.qnh)}</label>
            <label class="field"><span>Wind from (°)</span>${num('wdir', S.cond.wdir)}</label>
            <label class="field"><span>Wind (kt)</span>${num('wspd', S.cond.wspd)}</label>
          </form>
          <div class="nav-tools"><button type="button" class="btn btn-line btn-sm" data-pfmetar>Use the live METAR</button><span class="hint" data-pfmnote></span></div>
          <div data-perf></div>
        </section>
        <section class="tile span-12"><div class="tile-head"><h2>Weather go / no-go</h2><span data-gochip></span></div>
          <form class="fields pf-mins" data-pfmins novalidate>
            <label class="field"><span>Max wind (kt)</span>${num('wind', S.mins.wind)}</label>
            <label class="field"><span>Max gust (kt)</span>${num('gust', S.mins.gust)}</label>
            <label class="field"><span>Max crosswind (kt)</span>${num('cross', S.mins.cross)}</label>
            <label class="field"><span>Min visibility (km)</span>${num('visKm', S.mins.visKm)}</label>
            <label class="field"><span>Min ceiling (ft)</span>${num('ceil', S.mins.ceil)}</label>
          </form>
          <p class="hint">Your personal minimums. Agree them with your instructor; they’re checked against the latest METAR for the airfield above.</p>
          <div data-brief></div>
        </section>
      </div>`);
    if (window.BoploMap && countryCodeOf(p)) BoploMap.airfields(countryCodeOf(p)).then(list => { const dl = $('#pf-afs'); if (dl) dl.innerHTML = list.filter(a => a.type !== 'W').map(a => `<option value="${esc(a.code)} · ${esc(a.name)}"></option>`).join(''); });
    let af = null, ends = [], wx = null, saveT = 0;
    const save = () => { clearTimeout(saveT); saveT = setTimeout(() => saveProfile({ preflight: JSON.stringify(S) }).catch(() => { }), 900); };
    const A = () => P.aircraft(S.ac, mine);
    const fuelUsed = () => { const a = A(); return (+S.fuel.mins || 0) / 60 * (a.fuel.burn || 0); };
    const fmtW = v => `${Math.round(v).toLocaleString('en-GB')} ${wu}`, fmtArm = v => Number.isFinite(v) ? `${v.toFixed(au === 'm' ? 3 : 1)} ${au}` : '—';
    const envSVG = (a, r) => {
      const env = a.envelope || []; if (env.length < 3) return '<p class="hint">Add the CG envelope from your POH to see the chart.</p>';
      const xs = env.map(e => e[0]).concat([r.cg, r.lcg]).filter(Number.isFinite), ys = env.map(e => e[1]).concat([r.W, r.lw]).filter(Number.isFinite);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), px = (x1 - x0) * .08 || 1, py = (y1 - y0) * .08 || 1;
      const W = 520, H = 316, L = 54, B = 44, sx = x => L + (x - (x0 - px)) / ((x1 - x0) + 2 * px) * (W - L - 12), sy = y => H - B - (y - (y0 - py)) / ((y1 - y0) + 2 * py) * (H - B - 12);
      const ticks = (a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => a0 + (a1 - a0) * i / n);
      return `<svg class="pf-env" viewBox="0 0 ${W} ${H}" role="img" aria-label="CG envelope chart">
        ${ticks(y0, y1, 4).map(t => `<line x1="${L}" x2="${W - 12}" y1="${sy(t)}" y2="${sy(t)}" class="g"/><text x="${L - 8}" y="${sy(t) + 4}" text-anchor="end">${Math.round(t)}</text>`).join('')}
        ${ticks(x0, x1, 4).map(t => `<text x="${sx(t)}" y="${H - B + 17}" text-anchor="middle">${t.toFixed(au === 'm' ? 2 : 1)}</text>`).join('')}
        <polygon points="${env.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}" class="env"/>
        <line x1="${sx(r.cg)}" y1="${sy(r.W)}" x2="${sx(r.lcg)}" y2="${sy(r.lw)}" class="burn"/>
        <circle cx="${sx(r.cg)}" cy="${sy(r.W)}" r="7" class="pt ${r.toIn ? '' : 'bad'}"/><text x="${sx(r.cg) + 11}" y="${sy(r.W) - 8}" class="lab">Take-off</text>
        <circle cx="${sx(r.lcg)}" cy="${sy(r.lw)}" r="6" class="pt ld ${r.ldIn ? '' : 'bad'}"/><text x="${sx(r.lcg) + 10}" y="${sy(r.lw) + 16}" class="lab">Landing</text>
        <text x="${(L + W) / 2}" y="${H - 4}" text-anchor="middle" class="ax">CG arm (${au})</text><text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle" class="ax">Weight (${wu})</text></svg>`;
    };
    function drawWB() {
      const a = A(), r = P.wb(a, S.loads, { start: S.fuel.start, burn: fuelUsed() });
      $('[data-wbchip]').innerHTML = r.ok ? '<span class="chip ok">Within limits</span>' : r.issues.some(i => i.bad) ? '<span class="chip warn">Out of limits</span>' : '<span class="chip">Needs figures</span>';
      $('[data-wb]').innerHTML = `<div class="pf-wb">
        <div class="table-wrap"><table><thead><tr><th>Item</th><th class="r">Weight</th><th class="r">Arm</th><th class="r">Moment</th></tr></thead>
          <tbody>${r.rows.filter(x => x.w || x.id === 'empty').map(x => `<tr><td>${esc(x.label)}</td><td class="r">${fmtW(x.w)}</td><td class="r">${fmtArm(x.arm)}</td><td class="r">${Number.isFinite(x.m) ? Math.round(x.m).toLocaleString('en-GB') : '—'}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Take-off</td><td class="r">${fmtW(r.W)}</td><td class="r"><b>${fmtArm(r.cg)}</b></td><td class="r">${Math.round(r.M).toLocaleString('en-GB')}</td></tr>
            <tr><td>Landing <small>after ${(+fuelUsed()).toFixed(1)} ${esc(a.fuel.unit)}</small></td><td class="r">${fmtW(r.lw)}</td><td class="r"><b>${fmtArm(r.lcg)}</b></td><td></td></tr></tfoot></table></div>
        ${envSVG(a, r)}</div>
        ${r.issues.length ? `<ul class="pf-issues">${r.issues.map(i => `<li class="${i.bad ? 'bad' : ''}">${esc(i.t)}</li>`).join('')}</ul>` : ''}
        <p class="footnote">Max take-off weight ${a.mtow ? fmtW(a.mtow) : '—'}. ${a.mtow ? `Useful load left: ${fmtW(Math.max(0, a.mtow - r.W))}.` : ''} ${mine.emptyW ? '' : 'Using typical empty weight and arm for the type until you enter your aircraft’s figures.'}</p>`;
      return r;
    }
    let lastPerf = null;
    function drawPerf() {
      const a = A(), r = P.wb(a, S.loads, { start: S.fuel.start, burn: fuelUsed() }), e = ends.find(x => x.id === S.cond.rw) || ends[0];
      const box = $('[data-perf]');
      if (!a.perf?.to50) { box.innerHTML = '<p class="hint">Add your POH take-off and landing distances under “Your aircraft’s figures”.</p>'; return; }
      const c = P.components(e?.hdg || 0, +S.cond.wdir, +S.cond.wspd || 0);
      const pf = P.performance(a, { elevFt: af?.elev || 0, qnh: S.cond.qnh, oat: S.cond.oat, surface: S.cond.surface, slope: +S.cond.slope || 0, head: c.head, weight: (Object.values(S.loads).some(v => +v > 0) || +S.fuel.start > 0) ? r.W : a.mtow }); lastPerf = { pf, e, c };
      const bar = (req, avail) => { if (!avail) return ''; const pct = Math.min(100, req / avail * 100); return `<div class="pf-bar ${req > avail ? 'bad' : req > avail * .85 ? 'warn' : ''}"><i style="width:${pct}%"></i></div><small>${Math.round(req)} m needed of ${Math.round(avail)} m available (${Math.round(avail - req)} m ${req > avail ? 'short' : 'spare'})</small>`; };
      const rowsOf = s => s.steps.filter(([, f]) => Math.abs(f - 1) > .005).map(([l, f]) => `<li>${esc(l)} <b>×${f.toFixed(2)}</b></li>`).join('');
      const toOK = e?.len ? pf.to.req <= e.len : null, ldOK = e?.lda ? pf.ld.req <= e.lda : null;
      $('[data-pfchip]').innerHTML = toOK == null ? '' : toOK && ldOK ? '<span class="chip ok">Runway long enough</span>' : '<span class="chip warn">Runway too short</span>';
      box.innerHTML = `<div class="pf-perf">
        <div class="pf-atm"><div><span>Pressure altitude</span><b>${Math.round(pf.pa).toLocaleString('en-GB')} ft</b></div><div><span>Density altitude</span><b>${Math.round(pf.da).toLocaleString('en-GB')} ft</b></div><div><span>Runway ${esc(e?.id || '—')} wind</span><b>${c.head >= 0 ? Math.round(c.head) + ' kt head' : Math.round(-c.head) + ' kt TAIL'} · ${Math.round(c.cross)} kt cross${c.from ? ' from the ' + c.from : ''}</b></div></div>
        <div class="pf-two">
          <div><h3>Take-off</h3><div class="pf-nums"><div><span>Ground roll</span><b>${Math.round(pf.to.roll)} m</b></div><div><span>To 50 ft</span><b>${Math.round(pf.to.d50)} m</b></div><div><span>With safety factor ×${pf.sf.to}</span><b>${Math.round(pf.to.req)} m</b></div></div>${bar(pf.to.req, e?.len)}<ul class="pf-steps">${rowsOf(pf.to)}</ul></div>
          <div><h3>Landing</h3><div class="pf-nums"><div><span>Ground roll</span><b>${Math.round(pf.ld.roll)} m</b></div><div><span>From 50 ft</span><b>${Math.round(pf.ld.d50)} m</b></div><div><span>With safety factor ×${pf.sf.ld}</span><b>${Math.round(pf.ld.req)} m</b></div></div>${bar(pf.ld.req, e?.lda)}<ul class="pf-steps">${rowsOf(pf.ld)}</ul></div>
        </div>
        <p class="footnote">Corrections from the UK CAA’s Safety Sense 7 (altitude, temperature, surface, slope and the recommended safety factors), weight by (weight ÷ max weight)², wind by the usual POH rule: 10% less per 9 kt headwind, 10% more per 2 kt tailwind. ${pf.approx ? 'This type uses approximate distances: enter the figures from your POH. ' : ''}Always check against your POH charts.</p></div>`;
    }
    function drawBrief() {
      const box = $('[data-brief]'), chip = $('[data-gochip]');
      if (!wx) { box.innerHTML = `<p class="hint">${af ? 'Fetching the weather…' : 'Choose an airfield above.'}</p>`; chip.innerHTML = ''; return; }
      const st = wx.stations?.[0]; if (!st) { box.innerHTML = '<p class="hint">No weather report found near this airfield.</p>'; chip.innerHTML = ''; return; }
      const f = P.metarFacts(st), e = ends.find(x => x.id === S.cond.rw) || ends[0];
      const xw = e ? P.components(e.hdg, f.wdir, Math.max(f.wspd, f.gust || 0)).cross : null, mm = P.minimums(S.mins, f, xw);
      const word = { go: 'Within your minimums', caution: 'Close to your minimums', nogo: 'Outside your minimums' };
      chip.innerHTML = mm.worst ? `<span class="chip go-${mm.worst}">${word[mm.worst]}</span>` : '';
      const s = af ? P.sun(af.lat, af.lng, todayISO()) : null, t = d => d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
      const NL = NOTAM_LINKS[af?.cc] || ['EUROCONTROL EAD basic', 'https://www.ead.eurocontrol.int/'];
      const allEnds = ends.length ? ends.map(x => { const k = P.components(x.hdg, f.wdir, f.wspd), kg = f.gust ? P.components(x.hdg, f.wdir, f.gust) : null; return `<tr${x.id === e?.id ? ' class="on"' : ''}><td>${esc(x.id)}</td><td class="r">${k.head >= 0 ? Math.round(k.head) : '<b class="bad">' + Math.round(-k.head) + ' tail</b>'}</td><td class="r">${Math.round(k.cross)}${kg ? ` <small>(G ${Math.round(kg.cross)})</small>` : ''}${k.from ? ' ' + k.from[0].toUpperCase() : ''}</td><td class="r">${x.len ? Math.round(x.len) + ' m' : '—'}</td></tr>`; }).join('') : '';
      box.innerHTML = `<div class="pf-brief">
        <div class="pf-go">${mm.rows.map(r => `<div class="go-${r.state}"><span>${esc(r.label)}</span><b>${esc(r.value)}</b><small>limit ${esc(r.limit)}</small></div>`).join('')}</div>
        <div class="pf-two">
          <div><h3>${esc(st.id)}${st.id !== af?.code ? ` <small>nearest report, ${esc(st.dist)} NM away</small>` : ''}</h3><p class="mono">${esc(st.raw)}</p>${st.taf ? `<p class="mono small">${esc(st.taf)}</p>` : ''}<p><a class="link" href="#weather" data-pfwx>Decode it on the Weather page</a></p></div>
          <div><h3>Runway winds</h3>${allEnds ? `<div class="table-wrap"><table><thead><tr><th>Rwy</th><th class="r">Head</th><th class="r">Cross</th><th class="r">Length</th></tr></thead><tbody>${allEnds}</tbody></table></div>` : '<p class="hint">No runway data for this airfield.</p>'}</div>
        </div>
        <div class="pf-atm"><div><span>Sunrise</span><b>${t(s?.rise)}</b></div><div><span>Sunset</span><b>${t(s?.set)}</b></div><div><span>End of civil twilight</span><b>${t(s?.dusk)}</b></div><div><span>NOTAMs</span><b><a class="link" href="${esc(NL[1])}" target="_blank" rel="noopener">${esc(NL[0])}</a></b></div></div>
        <p class="footnote">Times are your device’s local time for today. Check NOTAMs, the TAF and any airfield restrictions in your official briefing.</p></div>`;
      const wl = $('[data-pfwx]'); if (wl) wl.onclick = () => { ui.wxq = st.id; };
      return { st, f, mm, s, NL };
    }
    async function loadAf() {
      const code = upper($('[name=ap]').value).split(/[\s·]/)[0]; S.ap = code; af = code ? await anyAirfield(code) : null; ends = af ? await runwayEnds(af) : []; wx = null;
      const sel = $('[data-pfrw]'); sel.innerHTML = ends.length ? ends.map(e => `<option value="${esc(e.id)}" ${S.cond.rw === e.id ? 'selected' : ''}>${esc(e.id)} · ${Math.round(e.len || 0)} m ${PAVED_RE.test(e.surf || '') ? '' : esc((e.surf || '').toLowerCase())}</option>`).join('') : '<option value="">No runway data</option>';
      if (ends.length && !ends.some(e => e.id === S.cond.rw)) S.cond.rw = ends[0].id;
      const e = ends.find(x => x.id === S.cond.rw); if (e && !S.cond.surfaceSet) { S.cond.surface = PAVED_RE.test(e.surf || '') ? 'paved' : 'grass'; $('[name=surface]').value = S.cond.surface; }
      drawPerf(); drawBrief();
      if (af) { try { wx = preview ? EX_WX : await api(`weather?ids=${encodeURIComponent(af.code)}&lat=${af.lat}&lng=${af.lng}`); } catch { wx = { stations: [] }; } drawBrief(); }
    }
    // inputs
    $('[data-pfac]').oninput = e => {
      const fm = Object.fromEntries(new FormData($('[data-pfac]')));
      if (e.target.name === 'ac') { S.ac = fm.ac; save(); preflightPage(); return; }
      mine.reg = fm.reg; A0.stations.forEach(s => { S.loads[s.id] = fm['l_' + s.id]; }); S.fuel.start = fm.fuelStart; S.fuel.mins = fm.mins;
      drawWB(); drawPerf(); save();
    };
    $('[data-pfmine]').oninput = () => {
      const fm = Object.fromEntries(new FormData($('[data-pfmine]')));
      ['emptyW', 'emptyArm', 'mtow', 'burn', 'fuelArm', 'fuelUsable'].forEach(k => { mine[k] = fm[k]; });
      mine.arms = Object.fromEntries(A0.stations.map(s => [s.id, fm['arm_' + s.id]]));
      const env = String(fm.envelope || '').trim().split(/\s+|;/).map(t => t.split(',').map(Number)).filter(x => x.length === 2 && x.every(Number.isFinite));
      mine.envelope = env.length >= 3 ? env : undefined;
      mine.perf = { ...(mine.perf || {}), to50: fm.to50, ld50: fm.ld50 };
      if (mine.perf.to50 && A0.perf.to50) mine.perf.toRoll = +fm.to50 * A0.perf.toRoll / A0.perf.to50; if (mine.perf.ld50 && A0.perf.ld50) mine.perf.ldRoll = +fm.ld50 * A0.perf.ldRoll / A0.perf.ld50;
      drawWB(); drawPerf(); save();
    };
    const cond = $('[data-pfcond]');
    cond.oninput = e => {
      const fm = Object.fromEntries(new FormData(cond));
      if (e.target.name === 'surface') S.cond.surfaceSet = true;
      Object.assign(S.cond, { rw: fm.rw, surface: fm.surface, slope: fm.slope, oat: fm.oat, qnh: fm.qnh, wdir: fm.wdir, wspd: fm.wspd });
      drawPerf(); if (e.target.name === 'rw') drawBrief(); save();
    };
    cond.querySelector('[name=ap]').onchange = () => { S.cond.surfaceSet = false; loadAf().then(save); };
    $('[data-pfmins]').oninput = () => { Object.assign(S.mins, Object.fromEntries(new FormData($('[data-pfmins]')))); drawBrief(); save(); };
    $('[data-pfmetar]').onclick = () => {
      const st = wx?.stations?.[0], note = $('[data-pfmnote]'); if (!st) { note.textContent = 'No METAR loaded for this airfield yet.'; return; }
      const f = P.metarFacts(st);
      if (f.temp != null) S.cond.oat = f.temp; if (f.qnh != null) S.cond.qnh = Math.round(f.qnh); if (Number.isFinite(f.wdir)) S.cond.wdir = f.wdir; S.cond.wspd = f.wspd;
      ['oat', 'qnh', 'wdir', 'wspd'].forEach(k => { const i = cond.querySelector(`[name=${k}]`); if (i) i.value = S.cond[k] ?? ''; });
      note.textContent = `From ${st.id}: ${st.raw.split(' ').slice(1, 6).join(' ')}`; drawPerf(); save();
    };
    $('[data-pfprint]').onclick = () => {
      const a = A(), r = P.wb(a, S.loads, { start: S.fuel.start, burn: fuelUsed() }), b = drawBrief(), L = lastPerf;
      printDoc('Preflight briefing', `<h1>Preflight briefing · ${esc(af?.code || '')} ${esc(af?.name || '')}</h1><p class="meta">${esc(p.name || '')} · ${esc(a.name)} ${esc(mine.reg || '')} · ${esc(fmtDate(todayISO(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p>
        <h3>Weight and balance ${r.ok ? '(within limits)' : '(CHECK: not within limits or figures missing)'}</h3>
        <table><thead><tr><th>Item</th><th>Weight</th><th>Arm</th><th>Moment</th></tr></thead><tbody>${r.rows.filter(x => x.w || x.id === 'empty').map(x => `<tr><td>${esc(x.label)}</td><td>${fmtW(x.w)}</td><td>${fmtArm(x.arm)}</td><td>${Math.round(x.m)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Take-off</td><td>${fmtW(r.W)}</td><td>${fmtArm(r.cg)}</td><td>${Math.round(r.M)}</td></tr><tr><td>Landing</td><td>${fmtW(r.lw)}</td><td>${fmtArm(r.lcg)}</td><td></td></tr></tfoot></table>
        ${r.issues.length ? `<p>${r.issues.map(i => esc(i.t)).join('<br>')}</p>` : ''}
        ${L ? `<h3>Runway ${esc(L.e?.id || '')} performance</h3><table><tbody><tr><td>Pressure / density altitude</td><td>${Math.round(L.pf.pa)} ft / ${Math.round(L.pf.da)} ft</td></tr><tr><td>Wind component</td><td>${Math.round(L.c.head)} kt head, ${Math.round(L.c.cross)} kt cross</td></tr><tr><td>Take-off to 50 ft (×${L.pf.sf.to} factored)</td><td>${Math.round(L.pf.to.d50)} m (${Math.round(L.pf.to.req)} m) of ${Math.round(L.e?.len || 0)} m</td></tr><tr><td>Landing from 50 ft (×${L.pf.sf.ld} factored)</td><td>${Math.round(L.pf.ld.d50)} m (${Math.round(L.pf.ld.req)} m) of ${Math.round(L.e?.lda || 0)} m</td></tr></tbody></table>` : ''}
        ${b ? `<h3>Weather: ${esc({ go: 'within personal minimums', caution: 'close to personal minimums', nogo: 'OUTSIDE personal minimums' }[b.mm.worst] || '')}</h3><p style="font-family:monospace">${esc(b.st.raw)}</p>${b.st.taf ? `<p style="font-family:monospace">${esc(b.st.taf)}</p>` : ''}<table><tbody>${b.mm.rows.map(x => `<tr><td>${esc(x.label)}</td><td>${esc(x.value)}</td><td>limit ${esc(x.limit)}</td><td>${x.state.toUpperCase()}</td></tr>`).join('')}</tbody></table>
        <p>Sunrise ${b.s?.rise ? b.s.rise.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'} · sunset ${b.s?.set ? b.s.set.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'} · end of civil twilight ${b.s?.dusk ? b.s.dusk.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</p><p>NOTAMs: check ${esc(b.NL[0])} (${esc(b.NL[1])})</p>` : ''}
        <p class="small">Prepared with Boplo Flight as a training aid. Not an official briefing. Check all figures against the aircraft’s weight and balance report, POH and an official briefing.</p>`);
    };
    // initial values into the loading form
    drawWB(); loadAf();
  }

  const navStore = () => readJSON(state.profile.navlogs, { logs: [] });
  function navPage() {
    const p = state.profile;
    ui.nav = ui.nav || { name: '', points: [], inp: { tas: p.aircraftTas || 95, wdir: '', wspd: '', vari: '', vdir: 'W', burn: '', unit: 'L', taxi: '', reserve: 45, alt: '' } };
    const N = ui.nav, inp = N.inp, legs = legsFor(N.points, inp), saved = navStore().logs || [];
    const tot = { d: sum(legs, l => l.d), m: sum(legs, l => l.mins || 0), f: sum(legs, l => l.fuel || 0) };
    const resFuel = (+inp.burn || 0) * (+inp.reserve || 0) / 60, allFuel = tot.f + resFuel + (+inp.taxi || 0);
    const routeFlights = sorted().filter(f => f.points?.length > 1 && f.points.length <= 40);
    const fmtM = m => Number.isFinite(m) ? `${Math.floor(m / 60) ? Math.floor(m / 60) + ':' + String(Math.round(m % 60)).padStart(2, '0') : Math.round(m) + ' min'}` : '—';
    shell('navlog', { title: 'Nav log', sub: 'Plot a route, add the forecast wind, and Boplo works out heading, groundspeed, time and fuel for each leg.', actions: `<button class="btn btn-blue btn-has-spark" data-plotnav>${ico('map')} ${N.points.length ? 'Edit route' : 'Plot a route'} ${spark}</button>` },
      `<p class="callout warn">A planning aid for training. Check every figure against your own calculation, your chart and official weather before you fly.</p>
      <div class="grid" style="margin-top:16px">
        <section class="tile span-4 nav-inputs"><div class="tile-head"><h2>Flight details</h2></div>
          <form class="fields" style="grid-template-columns:1fr 1fr" data-navform novalidate>
            <label class="field full"><span>Plan name <i>(optional)</i></span><input name="name" value="${esc(N.name)}" maxlength="80" placeholder="e.g. Lesson 12 nav"></label>
            <label class="field"><span>True airspeed (kt)</span><input name="tas" type="number" min="30" max="300" value="${esc(inp.tas)}"></label>
            <label class="field"><span>Cruise altitude <i>(ft)</i></span><input name="alt" type="number" min="0" max="20000" step="100" value="${esc(inp.alt)}"></label>
            <label class="field"><span>Wind from (°T)</span><input name="wdir" type="number" min="0" max="360" value="${esc(inp.wdir)}" placeholder="e.g. 250"></label>
            <label class="field"><span>Wind speed (kt)</span><input name="wspd" type="number" min="0" max="150" value="${esc(inp.wspd)}" placeholder="e.g. 15"></label>
            <label class="field"><span>Variation (°)</span><input name="vari" type="number" min="0" max="40" step="0.5" value="${esc(inp.vari)}" placeholder="From your chart"></label>
            <label class="field"><span>East or west</span><select name="vdir"><option ${inp.vdir === 'W' ? 'selected' : ''} value="W">West (add)</option><option ${inp.vdir === 'E' ? 'selected' : ''} value="E">East (subtract)</option></select></label>
            <label class="field"><span>Fuel burn per hour</span><input name="burn" type="number" min="0" max="500" step="0.1" value="${esc(inp.burn)}" placeholder="From the POH"></label>
            <label class="field"><span>Units</span><select name="unit">${['L', 'USG', 'IG', 'kg'].map(u => `<option ${inp.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
            <label class="field"><span>Taxi and run-up fuel</span><input name="taxi" type="number" min="0" max="200" step="0.1" value="${esc(inp.taxi)}"></label>
            <label class="field"><span>Reserve (minutes)</span><input name="reserve" type="number" min="0" max="240" value="${esc(inp.reserve)}"></label>
          </form>
          <div class="nav-tools">${N.points.length ? '<button type="button" class="btn btn-line btn-sm" data-wxwind>Use wind from the departure METAR</button>' : ''}${routeFlights.length ? `<label class="field"><span>Or start from a flight’s route</span><select data-fromflight><option value="">Choose a flight</option>${routeFlights.slice(0, 30).map(f => `<option value="${esc(f.id)}">${esc(fmtDate(f.date))} · ${esc(upper(f.departure))} → ${esc(upper(f.arrival))}</option>`).join('')}</select></label>` : ''}</div>
          <p class="footnote" data-wxnote>Wind at height usually differs from the surface report. Use the forecast wind for your cruise level if you have it.</p>
        </section>
        <section class="tile span-8"><div class="tile-head"><h2>${esc(N.name || 'Planning log')}</h2><div style="display:flex;gap:8px">${N.points.length > 1 ? '<button class="btn btn-line btn-sm" data-savenav>Save</button><button class="btn btn-line btn-sm" data-flynav>Fly this route</button><button class="btn btn-ink btn-sm" data-printnav>Print kneeboard</button>' : ''}</div></div>
          ${N.points.length > 1 ? `<div class="table-wrap plog"><table>
            <thead><tr><th>Leg</th><th class="r">TT</th><th class="r">Dist</th><th class="r">WCA</th><th class="r">TH</th><th class="r">MH</th><th class="r">GS</th><th class="r">Time</th><th class="r">Fuel</th></tr></thead>
            <tbody>${legs.map(l => `<tr class="${l.ok ? '' : 'bad'}"><td class="route">${esc(l.from)} → ${esc(l.to)}</td><td class="r">${pad3(l.tt)}°</td><td class="r">${l.d.toFixed(1)}</td><td class="r">${Number.isFinite(l.wca) ? (l.wca >= 0 ? '+' : '−') + Math.abs(l.wca).toFixed(0) + '°' : '—'}</td><td class="r">${Number.isFinite(l.th) ? pad3(l.th) + '°' : '—'}</td><td class="r"><b>${Number.isFinite(l.mh) ? pad3(l.mh) + '°' : '—'}</b></td><td class="r">${Number.isFinite(l.gs) ? Math.round(l.gs) : '—'}</td><td class="r"><b>${fmtM(l.mins)}</b></td><td class="r">${Number.isFinite(l.fuel) && inp.burn ? l.fuel.toFixed(1) : '—'}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td>Total</td><td></td><td class="r">${tot.d.toFixed(1)}</td><td colspan="4"></td><td class="r">${fmtM(tot.m)}</td><td class="r">${inp.burn ? tot.f.toFixed(1) : '—'}</td></tr></tfoot>
          </table></div>
          <div class="nav-sum"><div><span>Distance</span><b>${tot.d.toFixed(1)} NM</b></div><div><span>Flight time</span><b>${fmtM(tot.m)}</b></div><div><span>Fuel needed</span><b>${inp.burn ? `${allFuel.toFixed(1)} ${esc(inp.unit)}` : '—'}</b><em>${inp.burn ? `Trip ${tot.f.toFixed(1)} + taxi ${(+inp.taxi || 0).toFixed(1)} + reserve ${resFuel.toFixed(1)}` : 'Add a fuel burn'}</em></div></div>
          ${legs.some(l => !l.ok) ? '<p class="form-error">The wind is too strong for this airspeed on at least one leg. Check the wind and TAS.</p>' : ''}
          <p class="footnote">TT true track · WCA wind correction angle · TH true heading · MH magnetic heading (TH ${inp.vdir === 'E' ? '−' : '+'} ${esc(inp.vari || 0)}° variation, constant along the route) · GS groundspeed in knots. Times exclude climb and descent.</p>`
        : `<div class="empty"><h3>Start with a route.</h3><p>Plot your departure, turning points and destination on the map. Your legs and headings appear here.</p><button class="btn btn-blue btn-has-spark" data-plotnav>${ico('map')} Plot a route ${spark}</button></div>`}
          ${saved.length ? `<div class="saved-navs"><h3>Saved plans</h3>${saved.map((s, i) => `<div class="saved-nav"><button type="button" data-loadnav="${i}"><b>${esc(s.name || 'Plan')}</b><small>${esc(s.points.map(x => x.code || '·').filter(x => x !== '·').join(' → ') || `${s.points.length} points`)}</small></button><button type="button" class="icon-btn" data-delnav="${i}" aria-label="Delete plan">${ico('close')}</button></div>`).join('')}</div>` : ''}
        </section>
      </div>`);
    const form = $('[data-navform]');
    form.oninput = () => { const v = Object.fromEntries(new FormData(form)); N.name = v.name; delete v.name; Object.assign(inp, v); clearTimeout(navPage.t); navPage.t = setTimeout(() => { const pos = document.activeElement?.name; navPage(); if (pos) $(`[data-navform] [name="${pos}"]`)?.focus(); }, 450); };
    $$('[data-plotnav]').forEach(b => b.onclick = () => {
      const dlg = document.getElementById('plot'); dlg.showModal();
      BoploMap.mountPlotter(dlg, { country: countryCodeOf(p), home: upper(p.airport).split(/[\s·]/)[0], points: N.points, onCancel: () => dlg.close(), onDone: ({ points }) => { dlg.close(); BoploMap.airfields(countryCodeOf(p)).then(list => { N.points = points.map(x => { const a = list.find(y => Math.abs(y.lat - x.lat) < .003 && Math.abs(y.lng - x.lng) < .003); return { ...x, code: a ? a.code : '' }; }); navPage(); }); } });
    });
    const ff = $('[data-fromflight]'); if (ff) ff.onchange = async () => { const f = state.flights.find(x => x.id === ff.value); if (!f) return; const list = await BoploMap.airfields(countryCodeOf(p)); N.points = f.points.map(x => { const a = list.find(y => Math.abs(y.lat - x.lat) < .003 && Math.abs(y.lng - x.lng) < .003); return { lat: x.lat, lng: x.lng, code: a ? a.code : '' }; }); N.name = N.name || `${upper(f.departure)} → ${upper(f.arrival)}`; navPage(); };
    const ww = $('[data-wxwind]'); if (ww) ww.onclick = async () => {
      const first = N.points[0]; ww.disabled = true; ww.textContent = 'Fetching…';
      try { const d = preview ? EX_WX : await api(`weather?${first.code ? `ids=${encodeURIComponent(first.code)}&` : ''}lat=${first.lat}&lng=${first.lng}`); const s = d.stations?.[0]; if (s && s.wdir != null && s.wdir !== 'VRB') { inp.wdir = s.wdir; inp.wspd = s.wspd; navPage(); toast(`Surface wind from ${s.id}: ${pad3(s.wdir)}° at ${s.wspd} kt.`); } else { ww.textContent = 'No usable wind nearby'; } } catch (x) { ww.textContent = x.message; }
    };
    const sv = $('[data-savenav]'); if (sv) sv.onclick = async () => { if (!isAdv() && (navStore().logs || []).filter(x => x.name !== N.name).length >= B().limits.navPlans) return upgradeSheet(`The Free plan saves ${B().limits.navPlans} nav plan. Advanced saves as many as you like.`); const st = navStore(); st.logs = [{ name: N.name || `${legs[0]?.from} → ${legs[legs.length - 1]?.to}`, points: N.points, inp }, ...(st.logs || []).filter(x => x.name !== N.name)].slice(0, 8); try { await saveProfile({ navlogs: JSON.stringify(st) }); toast('Plan saved.'); navPage(); } catch (x) { toast(x.message); } };
    $$('[data-loadnav]').forEach(b => b.onclick = () => { const s = saved[+b.dataset.loadnav]; ui.nav = { name: s.name, points: s.points, inp: { ...inp, ...s.inp } }; navPage(); });
    $$('[data-delnav]').forEach(b => b.onclick = async () => { const st = navStore(); st.logs.splice(+b.dataset.delnav, 1); try { await saveProfile({ navlogs: JSON.stringify(st) }); navPage(); } catch { } });
    const fn = $('[data-flynav]'); if (fn) fn.onclick = () => openSim({ name: N.name || `${legs[0]?.from} → ${legs[legs.length - 1]?.to}`, points: N.points, inp }, 'fly');
    const pr = $('[data-printnav]'); if (pr) pr.onclick = () => printDoc(`${N.name || 'Planning log'}`, `<h1>${esc(N.name || 'Planning log')}</h1><p class="meta">${esc([fmtDate(todayISO(), { day: 'numeric', month: 'long', year: 'numeric' }), p.aircraft, p.registration, inp.alt ? `${inp.alt} ft` : ''].filter(Boolean).join(' · '))} · TAS ${esc(inp.tas)} kt · W/V ${inp.wdir ? pad3(inp.wdir) : '—'}°/${esc(inp.wspd || '—')} kt · Var ${esc(inp.vari || 0)}°${esc(inp.vdir)}</p>
      <table><thead><tr><th>Leg</th><th>TT</th><th>Dist</th><th>WCA</th><th>TH</th><th>MH</th><th>GS</th><th>Time</th><th>Fuel</th><th>ETA</th><th>ATA</th></tr></thead><tbody>${legs.map(l => `<tr><td>${esc(l.from)} → ${esc(l.to)}</td><td>${pad3(l.tt)}</td><td>${l.d.toFixed(1)}</td><td>${Number.isFinite(l.wca) ? Math.round(l.wca) : ''}</td><td>${Number.isFinite(l.th) ? pad3(l.th) : ''}</td><td><b>${Number.isFinite(l.mh) ? pad3(l.mh) : ''}</b></td><td>${Number.isFinite(l.gs) ? Math.round(l.gs) : ''}</td><td><b>${fmtM(l.mins)}</b></td><td>${inp.burn && Number.isFinite(l.fuel) ? l.fuel.toFixed(1) : ''}</td><td></td><td></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td></td><td>${tot.d.toFixed(1)}</td><td colspan="4"></td><td>${fmtM(tot.m)}</td><td>${inp.burn ? tot.f.toFixed(1) : ''}</td><td colspan="2"></td></tr></tfoot></table>
      ${inp.burn ? `<p>Fuel: trip ${tot.f.toFixed(1)} + taxi ${(+inp.taxi || 0).toFixed(1)} + reserve ${resFuel.toFixed(1)} = <b>${allFuel.toFixed(1)} ${esc(inp.unit)}</b></p>` : ''}
      <p class="small">Planning aid made with Boplo Flight. Check against your own calculation and official sources.</p>`);
  }
  function printDoc(title, body) {
    const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:13px/1.4 -apple-system,Segoe UI,Arial,sans-serif;color:#000;margin:18mm 12mm}h1{font-size:20px;margin:0 0 4px}.meta{color:#333;margin:0 0 12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:5px 6px;text-align:left;vertical-align:top}th{background:#eee;font-weight:600}tfoot td{font-weight:600;background:#f6f6f6}.small{color:#555;font-size:11px;margin-top:14px}@page{size:${body.includes('data-landscape') ? 'A4 landscape' : 'A4'};margin:10mm}</style></head><body>${body}<script>setTimeout(()=>print(),300)<\/script></body></html>`);
    w.document.close();
  }

  /* ================= currency and expiry ================= */
  const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const endOfCalMonth = (iso, months) => { const d = parseISO(iso); const e = new Date(d.getFullYear(), d.getMonth() + months + 1, 0); return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`; };
  const docsOf = p => readJSON(p.docs, {});
  function landingCurrency(field) {
    const fl = sorted(); let n = 0;
    for (const f of fl) { n += Number(f[field] || 0); if (n >= 3) return { date: f.date, until: addDays(f.date, 90) }; }
    return null;
  }
  const dueState = until => { if (!until) return ['none', 'Not set']; const d = daysUntil(until); return d < 0 ? ['bad', `Expired ${-d} day${d === -1 ? '' : 's'} ago`] : d <= 60 ? ['warn', d === 0 ? 'Due today' : `Due in ${d} day${d === 1 ? '' : 's'}`] : ['ok', `Valid until ${fmtDate(until, { day: 'numeric', month: 'short', year: 'numeric' })}`]; };
  function currencyItems() {
    const p = state.profile, r = regimeOf(p), faa = r === 'faa', docs = docsOf(p), out = [];
    out.push({ id: 'medical', title: 'Medical certificate', kind: 'date', label: 'Expiry date on your medical', value: docs.medical, until: docs.medical, note: 'From your medical certificate. Validity depends on your age and class.' });
    if (faa) {
      out.push({ id: 'review', title: 'Flight review', kind: 'date', label: 'Date of your last flight review (or checkride)', value: docs.review, until: docs.review ? endOfCalMonth(docs.review, 24) : '', note: 'Required every 24 calendar months under 14 CFR § 61.56.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.56' });
      out.push({ id: 'solo', title: 'Student solo endorsement', kind: 'date', label: 'Date of your latest solo endorsement', value: docs.solo, until: docs.solo ? addDays(docs.solo, 90) : '', note: 'An instructor must update it every 90 days (14 CFR § 61.87).', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-C/section-61.87' });
    } else {
      out.push({ id: 'rating', title: 'SEP class rating', kind: 'date', label: 'Rating expiry date on your licence', value: docs.rating, until: docs.rating, note: 'Shown on your licence once it’s issued.' });
    }
    const day = landingCurrency('landings');
    out.push({ id: 'pax', title: 'Carrying passengers', kind: 'calc', until: day?.until || '', detail: day ? `3 landings in the last 90 days. Current until ${fmtDate(day.until, { day: 'numeric', month: 'short' })} unless you fly again.` : 'Needs 3 take-offs and landings in the last 90 days.', note: faa ? 'Day rule in 14 CFR § 61.57(a). Tailwheel landings must be to a full stop. Counted from all your logged landings.' : 'FCL.060(b): 3 take-offs, approaches and landings in the same class or type in the last 90 days.', url: faa ? 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.57' : 'https://www.transport.gov.mt/PEL-95-Guidance-to-Flight-Instructors-Recording-of-flight-time.pdf-f8182' });
    if (faa) { const n = landingCurrency('nightLandings'); out.push({ id: 'night', title: 'Carrying passengers at night', kind: 'calc', until: n?.until || '', detail: n ? `3 night full-stop landings in the last 90 days. Current until ${fmtDate(n.until, { day: 'numeric', month: 'short' })}.` : 'Needs 3 full-stop landings at night (1 hour after sunset to 1 hour before sunrise) in the last 90 days.', note: '14 CFR § 61.57(b). Log night landings on each flight to track this.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.57' }); }
    (docs.custom || []).forEach((c, i) => out.push({ id: 'c' + i, title: c.label, kind: 'custom', value: c.date, until: c.date, i }));
    return out;
  }
  function revalidation() {
    const p = state.profile, docs = docsOf(p); if (regimeOf(p) === 'faa' || !docs.rating) return null;
    const start = (() => { const d = parseISO(docs.rating); d.setFullYear(d.getFullYear() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const w = state.flights.filter(f => f.date >= start && f.date <= docs.rating);
    return { start, end: docs.rating, rows: [['Flight time', sum(w, f => f.minutes) / 60, 12, 'h'], ['As pilot in command', sum(w.filter(f => f.role !== 'dual'), f => f.minutes) / 60, 6, 'h'], ['Take-offs and landings', sum(w, f => f.landings), 12, ''], ['With an instructor', sum(w.filter(f => f.role === 'dual'), f => f.minutes) / 60, 1, 'h']] };
  }
  function currencyPage() {
    if (!isAdv()) { shell('currency', { title: 'Currency', sub: 'Medical, rating and recency rules, worked out from your logbook.' }, paywall('Always know what you can fly.', 'Track your medical and rating expiry, passenger and night currency, and revalidation by experience, with reminders before anything lapses.')); return; }
    const items = currencyItems(), rv = revalidation();
    shell('currency', { title: 'Currency', sub: 'The dates and recent-experience rules that decide what you can fly, worked out from your logbook.' },
      `<div class="grid">
        <section class="span-8 cur-list">${items.map(it => { const [cls, txt] = it.kind === 'calc' ? (it.until ? dueState(it.until) : ['bad', 'Not current']) : dueState(it.until); return `<article class="tile cur ${cls}">
          <div class="cur-top"><h2>${esc(it.title)}</h2><span class="chip cur-${cls}">${esc(txt)}</span></div>
          ${it.kind === 'calc' ? `<p>${esc(it.detail)}</p>` : `<label class="field"><span>${esc(it.label || 'Date')}</span><div class="cur-row"><input type="date" value="${esc(it.value || '')}" data-doc="${esc(it.id)}" ${it.kind === 'custom' ? `data-ci="${it.i}"` : ''}>${it.kind === 'custom' ? `<button type="button" class="icon-btn" data-delc="${it.i}" aria-label="Remove">${ico('close')}</button>` : ''}</div></label>`}
          ${it.note ? `<p class="footnote">${esc(it.note)}${it.url ? ` <a class="link" href="${esc(it.url)}" target="_blank" rel="noopener">Source</a>` : ''}</p>` : ''}
        </article>`; }).join('')}
          <form class="tile add-doc" data-adddoc><div class="tile-head"><h2>Add another date</h2></div><div class="fields" style="grid-template-columns:2fr 1fr auto;align-items:end"><label class="field"><span>What it is</span><input name="label" maxlength="60" placeholder="e.g. Radio licence, theory exam deadline"></label><label class="field"><span>Date</span><input name="date" type="date"></label><button class="btn btn-ink">Add</button></div></form>
        </section>
        <aside class="span-4" style="display:grid;gap:16px;align-content:start">
          ${rv ? `<section class="tile"><div class="tile-head"><h2>Revalidation by experience</h2></div><p class="hint" style="margin-bottom:14px">Between ${esc(fmtDate(rv.start, { day: 'numeric', month: 'short', year: 'numeric' }))} and your rating expiry.</p><div class="bars">${rv.rows.map(([k, v, need, u]) => `<div class="bar-row"><div><span>${k}</span><b>${u ? v.toFixed(1) : v} / ${need}${u ? ' ' + u : ''}</b></div><div class="bar-track"><i style="width:${Math.min(100, v / need * 100)}%;background:${v >= need ? 'var(--ok)' : 'var(--electric)'}"></i></div></div>`).join('')}</div><p class="footnote">FCL.740.A: 12 hours including 6 as PIC, 12 take-offs and landings, and a 1-hour training flight with an instructor. An instructor or examiner signs it off. <a class="link" href="https://www.caa.co.uk/general-aviation/pilot-licences/part-fcl-requirements/ratings/single-engine-piston-rating-for-aeroplanes/" target="_blank" rel="noopener">UK CAA guidance</a></p></section>` : ''}
          <section class="tile"><div class="tile-head"><h2>How this works</h2></div><p class="hint">Expiry dates come from your own documents, so they’re exact. Recent-experience rules are counted from the flights in your logbook. Your licence, your instructor and your authority have the final say.</p></section>
        </aside>
      </div>`);
    const save = async docs => { try { await saveProfile({ docs: JSON.stringify(docs) }); currencyPage(); } catch (x) { toast(x.message); } };
    $$('[data-doc]').forEach(el => el.onchange = () => { const d = docsOf(state.profile); if (el.dataset.ci != null) d.custom[+el.dataset.ci].date = el.value; else d[el.dataset.doc] = el.value; save(d); });
    $$('[data-delc]').forEach(b => b.onclick = () => { const d = docsOf(state.profile); d.custom.splice(+b.dataset.delc, 1); save(d); });
    const af = $('[data-adddoc]'); af.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(af)); if (!v.label.trim() || !v.date) return; const d = docsOf(state.profile); d.custom = [...(d.custom || []), { label: v.label.trim().slice(0, 60), date: v.date }].slice(0, 10); save(d); };
  }
  const nextDue = () => currencyItems().filter(i => i.until && i.kind !== 'calc').map(i => ({ ...i, d: daysUntil(i.until) })).sort((a, b) => a.d - b.d)[0];

  /* ================= logbook export / import / print ================= */
  const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function exportCSV() {
    const cols = ['date', 'departure', 'arrival', 'aircraft', 'registration', 'role', 'minutes', 'hours', 'landings', 'night_landings', 'instructor', 'lesson', 'cost', 'notes'];
    const rows = sorted().reverse().map(f => [f.date, upper(f.departure), upper(f.arrival), f.aircraft, f.registration, f.role, f.minutes, (f.minutes / 60).toFixed(1), f.landings, f.nightLandings || 0, f.instructor, f.lesson, f.cost ?? '', f.notes]);
    const blob = new Blob([[cols, ...rows].map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `boplo-logbook-${todayISO()}.csv`; document.body.append(a); a.click(); a.remove();
  }
  function printLogbook() {
    const p = state.profile, faa = regimeOf(p) === 'faa', fl = sorted().reverse(), me = 'SELF';
    const head = faa ? ['Date', 'Make and model', 'Ident', 'From', 'To', 'Day ldg', 'Night ldg', 'SEL', 'Dual received', 'PIC', 'Solo', 'Total', 'Remarks'] : ['Date', 'Departure', 'Arrival', 'Type', 'Registration', 'Total time', 'Name of PIC', 'Ldg day', 'Ldg night', 'PIC', 'Dual', 'Remarks'];
    const T = m => hm(m);
    const rows = fl.map(f => { const n = f.nightLandings || 0, d = f.landings - n, pic = f.role !== 'dual' ? f.minutes : 0, dual = f.role === 'dual' ? f.minutes : 0; return faa ? [f.date, f.aircraft, f.registration, upper(f.departure), upper(f.arrival), d, n, T(f.minutes), dual ? T(dual) : '', pic ? T(pic) : '', f.role === 'solo' ? T(f.minutes) : '', T(f.minutes), f.lesson || ''] : [f.date, upper(f.departure), upper(f.arrival), f.aircraft, f.registration, T(f.minutes), f.role === 'dual' ? (f.instructor || 'Instructor') : me, d, n, pic ? T(pic) : '', dual ? T(dual) : '', f.lesson || '']; });
    const tot = faa ? ['Totals', '', '', '', '', sum(fl, f => f.landings - (f.nightLandings || 0)), sum(fl, f => f.nightLandings || 0), T(sum(fl, f => f.minutes)), T(sum(fl.filter(f => f.role === 'dual'), f => f.minutes)), T(sum(fl.filter(f => f.role !== 'dual'), f => f.minutes)), T(sum(fl.filter(f => f.role === 'solo'), f => f.minutes)), T(sum(fl, f => f.minutes)), ''] : ['Totals', '', '', '', '', T(sum(fl, f => f.minutes)), '', sum(fl, f => f.landings - (f.nightLandings || 0)), sum(fl, f => f.nightLandings || 0), T(sum(fl.filter(f => f.role !== 'dual'), f => f.minutes)), T(sum(fl.filter(f => f.role === 'dual'), f => f.minutes)), ''];
    printDoc('Logbook', `<div data-landscape></div><h1>Pilot logbook: ${esc(p.name)}</h1><p class="meta">${esc([p.licence, p.authority].filter(Boolean).join(' · '))} · ${fl.length} flights · printed ${esc(fmtDate(todayISO(), { day: 'numeric', month: 'long', year: 'numeric' }))}${p.openingMinutes ? ` · brought forward ${T(p.openingMinutes)}` : ''}</p>
      <table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr>${tot.map(c => `<td>${esc(c)}</td>`).join('')}</tr></tfoot></table>
      <p class="small">Columns follow the ${faa ? 'common FAA logbook layout' : 'EASA/UK Part-FCL logbook layout (AMC1 FCL.050)'}. Departure and arrival times aren’t recorded in Boplo. Check what format your authority and school accept for your official logbook.</p>`);
  }
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',' || c === ';' || c === '\t') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }
  function importRows(text) {
    const rows = parseCSV(text); if (rows.length < 2) throw new Error('That file has no flights in it.');
    const h = rows[0].map(x => x.trim().toLowerCase().replace(/[^a-z]/g, ''));
    const col = (...names) => h.findIndex(x => names.some(n => x === n || x.includes(n)));
    const C = { date: col('date'), dep: col('departure', 'from', 'origin'), arr: col('arrival', 'to', 'destination'), type: col('aircraft', 'type', 'makemodel', 'model'), reg: col('registration', 'reg', 'ident', 'tail'), role: col('role', 'function'), min: col('minutes'), dur: col('hours', 'duration', 'totaltime', 'total', 'time'), ldg: col('landings', 'ldg'), nld: col('nightlandings', 'nightldg'), ins: col('instructor'), les: col('lesson', 'exercise'), notes: col('notes', 'remarks', 'comments'), cost: col('cost') };
    if (C.date < 0) throw new Error('Add a “date” column to your file.');
    const dur = s => { s = String(s || '').trim(); if (!s) return 0; if (/^\d+:\d{1,2}$/.test(s)) { const [a, b] = s.split(':').map(Number); return a * 60 + b; } const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 60) : 0; };
    const date = s => { s = String(s || '').trim(); let m; if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const us = regimeOf(state.profile) === 'faa'; const [d, mo] = us ? [m[2], m[1]] : [m[1], m[2]]; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; } return s; };
    const role = s => { s = String(s || '').toLowerCase(); return /dual|instr|student/.test(s) ? 'dual' : /solo/.test(s) ? 'solo' : /pic|p1|command/.test(s) ? 'pic' : 'dual'; };
    const g = (r, i) => i >= 0 ? (r[i] || '').trim() : '';
    return rows.slice(1).map(r => ({ date: date(g(r, C.date)), departure: g(r, C.dep), arrival: g(r, C.arr) || g(r, C.dep), aircraft: g(r, C.type), registration: g(r, C.reg), role: role(g(r, C.role)), minutes: C.min >= 0 ? Math.round(+g(r, C.min) || 0) : dur(g(r, C.dur)), landings: Math.round(+g(r, C.ldg) || 0), nightLandings: Math.round(+g(r, C.nld) || 0), instructor: g(r, C.ins), lesson: g(r, C.les), notes: g(r, C.notes), cost: g(r, C.cost) === '' ? null : +g(r, C.cost), points: [], routeKind: 'endpoints' }));
  }
  function importSheet() {
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Import flights</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body"><p>Upload a CSV from a spreadsheet or another logbook app. Boplo looks for columns named <b>date</b>, <b>from</b>, <b>to</b>, <b>aircraft</b>, <b>registration</b>, <b>role</b>, <b>duration</b> (h:mm or decimal hours) or <b>minutes</b>, <b>landings</b> and <b>remarks</b>.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><label class="btn btn-line">Choose a CSV file<input type="file" accept=".csv,text/csv" data-file hidden></label><label class="btn btn-blue btn-has-spark">Scan paper logbook pages ${spark}<input type="file" accept="image/*" multiple data-scan hidden></label><label class="btn btn-line">GPS tracks (GPX, KML, IGC)<input type="file" accept=".gpx,.kml,.igc,application/gpx+xml,application/vnd.google-earth.kml+xml" multiple data-gpx hidden></label></div>
      <p class="hint">Scanning: photograph each page flat, in good light, with the whole page in view. Boplo reads the rows and you check them before anything is saved.</p>
      <div data-prev></div><p class="form-error" role="alert"></p></div>
      <footer class="sheet-foot"><span class="hint" data-count></span><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Cancel</button><button type="button" class="btn btn-blue" data-go disabled>Import</button></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => sheet.close()); sheet.showModal();
    let rows = [];
    const err = sheet.querySelector('.form-error'), go = sheet.querySelector('[data-go]');
    sheet.querySelector('[data-file]').onchange = async e => {
      err.textContent = ''; const file = e.target.files[0]; if (!file) return;
      try { rows = importRows(await file.text()); }
      catch (x) { err.textContent = x.message; return; }
      const good = rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.minutes > 0 && r.departure);
      sheet.querySelector('[data-prev]').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Route</th><th>Aircraft</th><th>Role</th><th class="r">Time</th><th class="r">Ldg</th></tr></thead><tbody>${rows.slice(0, 6).map(r => `<tr><td>${esc(r.date)}</td><td class="route">${esc(upper(r.departure))} → ${esc(upper(r.arrival))}</td><td>${esc(r.aircraft || r.registration)}</td><td>${esc(roleName(r.role))}</td><td class="r">${hm(r.minutes)}</td><td class="r">${r.landings}</td></tr>`).join('')}</tbody></table></div>`;
      sheet.querySelector('[data-count]').textContent = `${good.length} of ${rows.length} rows look complete.`;
      rows = good; go.disabled = !good.length; go.textContent = `Import ${good.length} flight${good.length === 1 ? '' : 's'}`;
    };
    // paper logbook pages: shrink each photo, read it on the server, then show every row for checking and editing
    const shrink = file => new Promise((res, rej) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', .82)); }; img.onerror = () => rej(new Error('That photo couldn’t be opened. Try a JPEG or PNG.')); img.src = URL.createObjectURL(file); });
    let scanned = [];
    const hmIn = m => m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '';
    const drawScan = notes => {
      sheet.querySelector('[data-prev]').innerHTML = `${notes ? `<p class="callout">${esc(notes)}</p>` : ''}<div class="table-wrap scan-table"><table><thead><tr><th></th><th>Date</th><th>From</th><th>To</th><th>Aircraft</th><th>Reg</th><th>Role</th><th>Time</th><th>Ldg</th></tr></thead><tbody>${scanned.map((r, i) => `<tr class="${r.confidence && r.confidence < .6 ? 'low' : ''}" data-row="${i}"><td><input type="checkbox" data-k="use" ${r.use ? 'checked' : ''} aria-label="Import this row"></td><td><input type="date" data-k="date" value="${esc(r.date)}"></td><td><input data-k="departure" value="${esc(r.departure)}"></td><td><input data-k="arrival" value="${esc(r.arrival)}"></td><td><input data-k="aircraft" value="${esc(r.aircraft)}"></td><td><input data-k="registration" value="${esc(r.registration)}"></td><td><select data-k="role">${['dual', 'solo', 'pic'].map(x => `<option value="${x}" ${r.role === x ? 'selected' : ''}>${esc(roleName(x))}</option>`).join('')}</select></td><td><input data-k="time" value="${hmIn(r.minutes)}" placeholder="h:mm" inputmode="numeric"></td><td><input data-k="landings" type="number" min="0" value="${r.landings || 0}"></td></tr>`).join('')}</tbody></table></div>
        <p class="hint">Rows highlighted in amber were hard to read. Check every row against your logbook, then import.</p>`;
      const upd = () => { const good = scanned.filter(r => r.use && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.minutes > 0 && r.departure); rows = good.map(r => ({ date: r.date, departure: r.departure, arrival: r.arrival || r.departure, aircraft: r.aircraft, registration: r.registration, role: r.role, minutes: r.minutes, landings: +r.landings || 0, nightLandings: +r.nightLandings || 0, instructor: r.instructor, lesson: '', notes: r.notes, cost: null, points: [], routeKind: 'endpoints' })); sheet.querySelector('[data-count]').textContent = `${good.length} of ${scanned.length} rows ready.`; go.disabled = !good.length; go.textContent = `Import ${good.length} flight${good.length === 1 ? '' : 's'}`; };
      sheet.querySelectorAll('[data-row]').forEach(tr => tr.oninput = e => { const r = scanned[+tr.dataset.row], k = e.target.dataset.k; if (k === 'use') r.use = e.target.checked; else if (k === 'time') { const v = e.target.value.trim(), m = v.match(/^(\d+):(\d{1,2})$/); r.minutes = m ? +m[1] * 60 + +m[2] : Math.round((parseFloat(v.replace(',', '.')) || 0) * 60); } else r[k] = e.target.value; upd(); });
      upd();
    };
    sheet.querySelector('[data-gpx]').onchange = async e => { err.textContent = ''; const box = sheet.querySelector('[data-prev]'); box.innerHTML = '<p class="hint">Reading your tracks…</p>'; await importTracks(e.target.files, box); go.disabled = true; sheet.querySelector('[data-count]').textContent = ''; };
    sheet.querySelector('[data-scan]').onchange = async e => {
      err.textContent = ''; const files = [...e.target.files].slice(0, 10); if (!files.length) return;
      const box = sheet.querySelector('[data-prev]'); let notes = [];
      for (let i = 0; i < files.length; i++) {
        box.innerHTML = `<p class="hint">Reading page ${i + 1} of ${files.length}… this takes about 20 seconds a page.</p>`;
        try {
          const data = await shrink(files[i]);
          let r;
          if (preview) r = { rows: [{ date: addDays(todayISO(), -400), departure: 'EGHP', arrival: 'EGHP', aircraft: 'PA-28', registration: 'G-BOPL', minutes: 65, role: 'dual', landings: 4, confidence: .9 }, { date: addDays(todayISO(), -393), departure: 'EGHP', arrival: 'EGTF', aircraft: 'PA-28', registration: 'G-BOPL', minutes: 80, role: 'dual', landings: 1, confidence: .5 }], notes: 'Example scan in the example desk.' };
          else {
            const res = await fetch('/flight/flights/scan', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: data, type: 'image/jpeg', regime: regimeOf(state.profile) }), signal: AbortSignal.timeout ? AbortSignal.timeout(75000) : undefined });
            r = await res.json().catch(() => ({})); if (res.status === 402) { sheet.close(); upgradeSheet(r.error); return; } if (!res.ok) throw new Error(r.error || 'The page couldn’t be read.');
          }
          scanned = scanned.concat((r.rows || []).map(x => ({ ...x, use: true }))); if (r.notes) notes.push(r.notes);
        } catch (x) { err.textContent = `Page ${i + 1}: ${x.name === 'TimeoutError' ? 'took too long to read. Try again.' : x.message}`; }
      }
      if (!scanned.length) { box.innerHTML = '<p class="hint">No flights were found on those pages.</p>'; return; }
      drawScan(notes.join(' '));
    };
    go.onclick = async () => {
      go.disabled = true; err.textContent = '';
      try {
        let saved = [], errors = [];
        if (preview) saved = rows.map((r, i) => ({ ...r, id: 'imp-' + i + Math.random().toString(36).slice(2) }));
        else for (let i = 0; i < rows.length; i += 500) { const r = await api('flights/import', 'POST', { flights: rows.slice(i, i + 500) }); saved = saved.concat(r.flights); errors = errors.concat(r.errors || []); }
        state.flights = [...saved, ...state.flights]; sheet.close(); render(); toast(`Imported ${saved.length} flight${saved.length === 1 ? '' : 's'}${errors.length ? `, skipped ${errors.length}` : ''}.`);
      } catch (x) { err.textContent = x.message; go.disabled = false; }
    };
  }

  /* ================= instructor sharing ================= */
  function shareTile() {
    const on = state.profile.shareOn;
    return `<section class="tile share-tile"><div class="tile-head"><h2>Share with your instructor</h2>${on ? '<span class="chip ok">Link is on</span>' : ''}</div>
      <p class="hint">A read-only page with your next lesson, preparation, syllabus progress and recent debriefs. No sign-in needed to view it, and you can turn it off any time.</p>
      <div data-sharebox style="margin-top:12px"></div>
      <div class="actions" style="margin-top:12px">${on ? '<button class="btn btn-line btn-sm" data-shareoff>Turn off the link</button>' : '<span></span>'}<div class="right"><button class="btn btn-ink btn-sm" data-shareon>${on ? 'Make a new link' : 'Create a link'}</button></div></div></section>`;
  }
  function wireShare() {
    const box = $('[data-sharebox]'); if (!box) return;
    const show = url => { box.innerHTML = `<div class="share-link"><input readonly value="${esc(url)}" aria-label="Share link"><button class="btn btn-blue btn-sm" data-copy>Copy</button></div><p class="footnote">Only people with this link can open it. Making a new link turns this one off.</p>`; box.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { box.querySelector('input').select(); } }; };
    const on = $('[data-shareon]'); if (on && !isAdv()) on.onclick = () => upgradeSheet('Sharing with your instructor is part of Advanced.');
    else if (on) on.onclick = async () => { on.disabled = true; try { const r = preview ? { token: 'example' } : await api('share', 'POST', {}); state.profile.shareOn = true; progressPage(); show(`${location.origin}/share.html?t=${r.token}`); } catch (x) { toast(x.message); on.disabled = false; } };
    const off = $('[data-shareoff]'); if (off) off.onclick = async () => { try { if (!preview) await api('share', 'DELETE'); state.profile.shareOn = false; progressPage(); toast('Sharing turned off.'); } catch (x) { toast(x.message); } };
  }

  /* ================= radio practice ================= */
  const PHON = { alpha: 'a', alfa: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f', golf: 'g', hotel: 'h', india: 'i', juliet: 'j', juliett: 'j', kilo: 'k', lima: 'l', mike: 'm', november: 'n', oscar: 'o', papa: 'p', quebec: 'q', romeo: 'r', sierra: 's', tango: 't', uniform: 'u', victor: 'v', whiskey: 'w', whisky: 'w', xray: 'x', yankee: 'y', zulu: 'z', zero: '0', one: '1', wun: '1', two: '2', three: '3', tree: '3', four: '4', fower: '4', five: '5', fife: '5', six: '6', seven: '7', eight: '8', ait: '8', nine: '9', niner: '9', thousand: '000', hundred: '00', decimal: '' };
  const LETTER = Object.fromEntries('alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey x-ray yankee zulu'.split(' ').map(w => [w[0], w[0].toUpperCase() + w.slice(1)]));
  const DIGIT = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Niner'];
  const spell = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '').split('').map(c => /\d/.test(c) ? DIGIT[+c] : LETTER[c.toLowerCase()]).join(' ');
  const compact = t => String(t || '').toLowerCase().replace(/x-ray/g, 'xray').split(/[^a-z0-9.]+/).filter(Boolean).map(w => PHON[w] ?? w).join('').replace(/\./g, '');
  function radioScenarios() {
    const p = state.profile, faa = regimeOf(p) === 'faa';
    const reg = upper(p.registration || (faa ? 'N123AB' : 'G-ABCD')).replace(/\s/g, '');
    const cs = spell(reg), csC = compact(cs), type = p.aircraft || (faa ? 'Cessna 172' : 'PA-28');
    const abbr = faa ? `${type.split(/\s/)[0]} ${spell(reg.slice(-3))}` : `${spell(reg[0])} ${spell(reg.slice(-2))}`, abC = compact(abbr), abReg = faa ? compact(reg.slice(-3)) : compact(reg[0] + reg.slice(-2));
    const code = upper(p.airport).split(/[\s·]/)[0] || (faa ? 'KAPA' : 'EGHP');
    const place = (String(p.airport || '').split('·')[1] || '').trim().replace(/\s+(Airfield|Airport|Aerodrome)$/i, '') || (faa ? 'Centennial' : 'Popham');
    const cs1 = { k: 'Your callsign', re: [csC, abC, abReg, compact(reg)] };
    const shortCS = { k: 'Your callsign', re: [csC, abC, abReg, compact(reg)] };
    const may = { k: 'MAYDAY three times', test: t => (t.match(/mayday/g) || []).length >= 3 };
    const S = faa ? [
      { id: 'f-ctaf', title: 'Position report at a non-towered airport', situation: `You’re on the left downwind for runway 28 at ${place}, planning to land.`, atc: '', model: `${place} traffic, ${type} ${cs}, left downwind runway two eight, full stop, ${place}.`, el: [{ k: 'Starts with the airport and “traffic”', re: [compact(place) + 'traffic'] }, cs1, { k: 'Position: left downwind', re: ['leftdownwind'] }, { k: 'Runway 28', re: ['runway28', '28'] }, { k: 'Intentions (full stop or touch and go)', re: ['fullstop', 'touchandgo', 'land'] }, { k: 'Ends with the airport name', test: t => t.endsWith(compact(place)) }] },
      { id: 'f-gnd', title: 'Ground: ready to taxi', situation: `You’re at the flight school ramp at ${place} with ATIS information Bravo, departing VFR to the north.`, atc: '', model: `${place} Ground, ${type} ${cs}, at the flight school ramp, ready to taxi, VFR northbound, with information Bravo.`, el: [{ k: 'Who you’re calling (Ground)', re: ['ground'] }, cs1, { k: 'Where you are', re: ['ramp', 'parking', 'flightschool', 'apron'] }, { k: 'Ready to taxi', re: ['readytotaxi', 'taxi'] }, { k: 'VFR and direction', re: ['vfr'] }, { k: 'ATIS: information Bravo', re: ['informationb', 'withb', 'atisb'] }] },
      { id: 'f-hold', title: 'Read back a taxi clearance', situation: 'Ground replies with your taxi instructions. Read them back.', atc: `${abbr}, runway two eight, taxi via Alpha, hold short of runway two eight.`, model: `Runway two eight, taxi via Alpha, hold short runway two eight, ${abbr}.`, el: [{ k: 'Runway 28', re: ['runway28', '28'] }, { k: 'Taxi via Alpha', re: ['viaa', 'taxia', 'alpha'] }, { k: 'Hold short runway 28 (hold-short instructions must be read back)', re: ['holdshortrunway28', 'holdshortofrunway28', 'holdshort28', 'holdshort'] }, shortCS] },
      { id: 'f-to', title: 'Read back a take-off clearance', situation: 'Tower clears you for take-off.', atc: `${abbr}, wind two six zero at eight, runway two eight, cleared for takeoff.`, model: `Runway two eight, cleared for takeoff, ${abbr}.`, el: [{ k: 'Runway 28', re: ['runway28', '28'] }, { k: 'Cleared for takeoff', re: ['clearedfortakeoff', 'clearedtakeoff'] }, shortCS] },
      { id: 'f-may', title: 'MAYDAY: engine failure', situation: `Your engine has failed 10 miles north of ${place} at 3,500 ft, heading 180, two people on board. You’re going to make a forced landing.`, atc: '', model: `MAYDAY MAYDAY MAYDAY, ${place} Tower, ${type} ${cs}, engine failure, forced landing, one zero miles north of ${place}, three thousand five hundred feet, heading one eight zero, two persons on board.`, el: [may, cs1, { k: 'Nature of the emergency', re: ['engine', 'failure', 'fire', 'fuel'] }, { k: 'Intentions', re: ['forcedlanding', 'landing', 'land'] }, { k: 'Position', re: ['miles', 'north', 'south', 'east', 'west', 'overhead'] }, { k: 'Altitude', re: ['feet', 'altitude', '3500'] }, { k: 'Heading', re: ['heading'] }, { k: 'People on board', re: ['onboard', 'pob', 'souls'] }] }
    ] : [
      { id: 'u-check', title: 'Radio check', situation: `You’ve just started up at ${place} and want to check your radio with ${place} Radio.`, atc: '', model: `${place} Radio, ${cs}, radio check.`, reply: `${cs}, ${place} Radio, readability five.`, el: [{ k: 'Station you’re calling', re: [compact(place) + 'radio', compact(place)] }, cs1, { k: '“Radio check”', re: ['radiocheck'] }] },
      { id: 'u-taxi', title: 'Read back a taxi clearance', situation: 'ATC gives you taxi instructions and the pressure setting. Read back everything that must be read back.', atc: `${abbr}, taxi holding point Alpha One, runway two seven, QNH one zero one three.`, model: `Taxi holding point Alpha One, runway two seven, QNH one zero one three, ${abbr}.`, el: [{ k: 'Holding point Alpha One', re: ['holdingpointa1', 'a1'] }, { k: 'Runway 27', re: ['runway27', '27'] }, { k: 'QNH 1013', re: ['qnh1013', '1013'] }, shortCS] },
      { id: 'u-dep', title: 'Read back a take-off clearance', situation: 'Tower clears you for take-off and gives the surface wind.', atc: `${abbr}, runway two seven, cleared for take-off, surface wind two five zero degrees eight knots.`, model: `Runway two seven, cleared for take-off, ${abbr}.`, el: [{ k: 'Runway 27', re: ['runway27', '27'] }, { k: 'Cleared for take-off', re: ['clearedfortakeoff', 'clearedtakeoff'] }, shortCS] },
      { id: 'u-dw', title: 'Downwind call', situation: `You’re turning downwind in the circuit at ${place} and plan to land.`, atc: '', model: `${abbr}, downwind to land.`, el: [shortCS, { k: 'Downwind', re: ['downwind'] }, { k: 'Intentions (land, touch and go)', re: ['toland', 'land', 'touchandgo', 'fullstop', 'lowapproach'] }] },
      { id: 'u-may', title: 'MAYDAY: engine failure', situation: `Your engine has failed 10 miles north of ${place} at 2,500 ft, heading 180, two people on board. You’re going to make a forced landing.`, atc: '', model: `MAYDAY MAYDAY MAYDAY, ${place} Radio, ${cs}, ${type}, engine failure, forced landing, one zero miles north of ${place}, passing two thousand five hundred feet, heading one eight zero, student pilot, two persons on board.`, el: [may, { k: 'Station you’re calling', re: [compact(place), 'radio', 'information', 'centre', 'approach', 'tower'] }, cs1, { k: 'Nature of the emergency', re: ['engine', 'failure', 'fire', 'fuel'] }, { k: 'Intentions', re: ['forcedlanding', 'landing', 'land'] }, { k: 'Position', re: ['miles', 'north', 'south', 'east', 'west', 'overhead'] }, { k: 'Level or altitude', re: ['feet', 'altitude', 'flightlevel', '2500'] }, { k: 'Heading', re: ['heading'] }, { k: 'Pilot qualification', re: ['studentpilot', 'student', 'ppl', 'qualif'] }, { k: 'People on board', re: ['onboard', 'pob'] }] }
    ];
    return { S, cs, faa, reg };
  }
  // radio calls for simulator practice: what to say at each point, what the controller replies, and what gets checked
  function simRadio(kind, af, endId, wind) {
    const p = state.profile, faa = regimeOf(p) === 'faa';
    const reg = upper(p.registration || (faa ? 'N123AB' : 'G-ABCD')).replace(/\s/g, ''), cs = spell(reg), type = (p.aircraft || (faa ? 'Cessna' : '')).split(/\s/)[0];
    const abbr = faa ? `${type} ${spell(reg.slice(-3))}`.trim() : `${spell(reg[0])} ${spell(reg.slice(-2))}`;
    const place = String(af?.name || 'the airfield').replace(/\s+(International\s+)?(Airfield|Airport|Aerodrome)$/i, '').replace(/\s+Airport.*$/i, '');
    const towered = af && (af.type === 'L' || af.type === 'M'), unit = towered ? 'Tower' : faa ? 'Traffic' : 'Radio';
    const rwN = String(endId || '').replace(/^0/, '0'), rwSay = String(endId || '').split('').map(c => /\d/.test(c) ? DIGIT[+c].toLowerCase() : c === 'L' ? 'left' : c === 'R' ? 'right' : c === 'C' ? 'centre' : '').join(' ');
    const windSay = wind?.spd ? `${String(Math.round(wind.dir / 10) * 10).padStart(3, '0').split('').map(c => DIGIT[+c].toLowerCase()).join(' ')} degrees ${wind.spd} knots` : 'calm';
    const csEl = { k: 'Your callsign', re: [compact(cs), compact(abbr), compact(reg), faa ? compact(reg.slice(-3)) : compact(reg[0] + reg.slice(-2))] };
    const rwEl = { k: `Runway ${endId}`, re: ['runway' + compact(rwSay), compact(rwSay), 'runway' + String(endId).toLowerCase()] };
    const stEl = { k: `Who you’re calling (${place} ${unit})`, re: [compact(place) + compact(unit), compact(unit)] };
    const calls = [];
    if (kind === 'takeoff' || kind === 'circuit') {
      const ready = towered
        ? { id: 'ready', when: 'start', title: 'Ready for departure', hint: `You’re at the holding point for runway ${endId}. Tell the tower you’re ready.`, model: `${place} Tower, ${cs}, holding point runway ${rwSay}, ready for departure.`, el: [stEl, csEl, rwEl, { k: 'Ready for departure', re: ['readyfordeparture', 'readyfortakeoff', 'ready'] }],
          atc: `${abbr}, runway ${rwSay}, cleared for take-off, surface wind ${windSay}.`, readback: { title: 'Read back the take-off clearance', model: `Runway ${rwSay}, cleared for take-off, ${abbr}.`, el: [rwEl, { k: 'Cleared for take-off', re: ['clearedfortakeoff', 'clearedtotakeoff'] }, csEl] } }
        : { id: 'ready', when: 'start', title: faa ? 'Departure call' : 'Lining up', hint: faa ? `Announce you’re departing runway ${endId}.` : `Tell ${place} Radio you’re lining up on runway ${endId}.`, model: faa ? `${place} traffic, ${type} ${spell(reg.slice(-3))}, departing runway ${rwSay}${kind === 'circuit' ? ', remaining in the pattern' : ''}, ${place}.` : `${place} Radio, ${cs}, lining up runway ${rwSay}.`, el: faa ? [{ k: `${place} traffic`, re: [compact(place) + 'traffic', 'traffic'] }, csEl, rwEl, { k: 'Departing', re: ['departing', 'takingoff', 'departure'] }] : [stEl, csEl, rwEl, { k: 'Lining up', re: ['liningup', 'lineup', 'readyfordeparture'] }],
          atc: faa ? '' : `${abbr}, surface wind ${windSay}, take off at your discretion.` };
      calls.push(ready);
    }
    if (kind === 'circuit') calls.push(faa && !towered
      ? { id: 'downwind', when: 'downwind', title: 'Downwind call', hint: 'Announce your position on the downwind leg.', model: `${place} traffic, ${type} ${spell(reg.slice(-3))}, left downwind runway ${rwSay}, full stop, ${place}.`, el: [{ k: `${place} traffic`, re: [compact(place) + 'traffic', 'traffic'] }, csEl, { k: 'Downwind', re: ['downwind'] }, rwEl] }
      : { id: 'downwind', when: 'downwind', title: 'Downwind call', hint: 'You’re on the downwind leg, planning to land.', model: `${abbr}, downwind to land.`, el: [csEl, { k: 'Downwind', re: ['downwind'] }, { k: 'Your intentions (to land)', re: ['toland', 'land', 'fullstop', 'touchandgo'] }], atc: towered ? `${abbr}, number one, report final.` : '' });
    if (kind === 'circuit' || kind === 'long' || kind === 'short') {
      const fin = kind === 'long' ? 'long final' : 'final';
      calls.push(faa && !towered
        ? { id: 'final', when: kind === 'circuit' ? 'final' : 'start', title: 'Final call', hint: `Announce you’re on ${fin}.`, model: `${place} traffic, ${type} ${spell(reg.slice(-3))}, ${fin} runway ${rwSay}, full stop, ${place}.`, el: [{ k: `${place} traffic`, re: [compact(place) + 'traffic', 'traffic'] }, csEl, { k: 'Final', re: ['final'] }, rwEl] }
        : { id: 'final', when: kind === 'circuit' ? 'final' : 'start', title: kind === 'long' ? 'Long final call' : 'Final call', hint: `You’re on ${fin} for runway ${endId}.`, model: towered && kind !== 'circuit' ? `${place} Tower, ${cs}, ${fin} runway ${rwSay}.` : `${abbr}, ${fin}.`, el: kind !== 'circuit' && towered ? [stEl, csEl, { k: 'Final', re: ['final'] }, rwEl] : [csEl, { k: 'Final', re: ['final'] }],
            atc: towered ? `${abbr}, runway ${rwSay}, cleared to land, surface wind ${windSay}.` : `${abbr}, runway ${rwSay}, surface wind ${windSay}, land at your discretion.`,
            readback: towered ? { title: 'Read back the landing clearance', model: `Runway ${rwSay}, cleared to land, ${abbr}.`, el: [rwEl, { k: 'Cleared to land', re: ['clearedtoland'] }, csEl] } : null });
    }
    return { calls, compact, cs, abbr, unit, place, lang: navigator.language || 'en-GB' };
  }
  function radioPage(id) {
    if (!isAdv()) { shell('radio', { title: 'Radio practice', sub: 'Say your calls out loud and get them checked.' }, paywall('Sound confident on the radio.', 'Practise real scenarios with your own callsign. Boplo listens and checks every element of your call.')); return; }
    const { S, cs, faa, reg } = radioScenarios(), best = readJSON(state.profile.radio, {});
    const sc = S.find(s => s.id === id);
    if (!sc) {
      shell('radio', { title: 'Radio practice', sub: `Practise ${faa ? 'FAA' : 'UK and ICAO'}-style calls out loud. Boplo listens and checks you included everything.` },
        `<p class="callout draft"><b>Practice scripts.</b> Phraseology varies between airfields and countries; follow your school and ${faa ? 'the AIM' : 'CAP 413 or your national phraseology guide'}. Your callsign is <b>${esc(cs)}</b> (${esc(reg)}). Change your registration in your profile.</p>
        <div class="grid" style="margin-top:16px">${S.map(s => `<button type="button" class="tile subj span-4" data-sc="${s.id}"><span class="subj-top"><b>${esc(s.title)}</b>${best[s.id] != null ? `<span class="chip ${best[s.id] >= 100 ? 'ok' : 'warn'}">${best[s.id]}%</span>` : ''}</span><small>${esc(s.situation)}</small></button>`).join('')}</div>`);
      $$('[data-sc]').forEach(b => b.onclick = () => radioPage(b.dataset.sc));
      return;
    }
    shell('radio', { title: esc(sc.title), sub: esc(sc.situation), actions: '<button class="btn btn-line" data-rback>All scenarios</button>' },
      `<section class="tile quiz radio">
        ${sc.atc ? `<div class="atc"><span>ATC says</span><p>“${esc(sc.atc)}”</p>${'speechSynthesis' in window ? '<button type="button" class="btn btn-line btn-sm" data-say>Play</button>' : ''}</div>` : `<div class="atc you"><span>Your call</span><p>Make the call for this situation.</p></div>`}
        <label class="field"><span>Your transmission</span><textarea data-call rows="3" placeholder="Tap the microphone and speak, or type your call"></textarea></label>
        <div class="debrief-tools"><button type="button" class="btn btn-line btn-sm mic" data-rmic><svg class="ico" aria-hidden="true"><use href="#i-mic"/></svg><span>Speak</span></button><button type="button" class="btn btn-blue" data-check>Check my call</button></div>
        <div data-rres></div>
      </section>`);
    $('[data-rback]').onclick = () => radioPage();
    const ta = $('[data-call]'), mic = $('[data-rmic]');
    const say = $('[data-say]'); if (say) say.onclick = () => { const u = new SpeechSynthesisUtterance(sc.atc); u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); };
    let rec = null;
    if (!SR) { mic.disabled = true; mic.title = 'Voice needs Chrome, Edge or Safari.'; }
    else mic.onclick = () => { if (rec) { rec.stop(); return; } rec = new SR(); rec.lang = navigator.language || 'en-GB'; rec.interimResults = true; rec.continuous = true; rec.onresult = e => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; ta.value = t; }; rec.onend = () => { rec = null; mic.classList.remove('live'); mic.querySelector('span').textContent = 'Speak'; }; rec.start(); mic.classList.add('live'); mic.querySelector('span').textContent = 'Listening… tap to stop'; };
    $('[data-check]').onclick = async () => {
      const t = compact(ta.value); if (!t) { ta.focus(); return; }
      const res = sc.el.map(e => ({ k: e.k, ok: e.test ? e.test(t) : e.re.some(r => r && t.includes(r)) })), score = Math.round(res.filter(r => r.ok).length / res.length * 100);
      $('[data-rres]').innerHTML = `<div class="radio-res"><div class="result-score ${score === 100 ? 'pass' : 'fail'}" style="padding:0"><b style="font-size:52px">${score}%</b><span>${score === 100 ? 'Everything included.' : 'Some parts are missing.'}</span></div>
        <ul class="radio-checks">${res.map(r => `<li class="${r.ok ? 'ok' : 'miss'}">${r.ok ? '✓' : '✗'} ${esc(r.k)}</li>`).join('')}</ul>
        <div class="model"><span>A model call</span><p>“${esc(sc.model)}”</p>${sc.reply ? `<span>Reply</span><p>“${esc(sc.reply)}”</p>` : ''}</div></div>`;
      const b = readJSON(state.profile.radio, {}); b[sc.id] = Math.max(b[sc.id] || 0, score);
      try { await saveProfile({ radio: JSON.stringify(b) }); } catch { }
    };
  }

  /* ================= simulator ================= */
  ui.sim = ui.sim || { wind: 'calm', start: 'ground', wx: (() => { try { return localStorage.getItem('boplo-sim-wx') || 'clear'; } catch { return 'clear'; } })(), time: 'day', ac: (() => { try { return localStorage.getItem('boplo-sim-ac') || 'auto'; } catch { return 'auto'; } })(), livery: (() => { try { return localStorage.getItem('boplo-sim-liv') || null; } catch { return null; } })() };
  const loadScript = (src, ok) => new Promise((res, rej) => { if (ok()) return res(); const s = document.createElement('script'); s.src = src; s.onload = () => ok() ? res() : rej(new Error('The simulator couldn’t load.')); s.onerror = () => rej(new Error('The simulator couldn’t load. Check your connection.')); document.head.append(s); });
  // graphics level: Fast is terrain and satellite imagery (no 3D city); Balanced and Detailed use the photo-real 3D scenery
  const simGfx = () => { try { const v = localStorage.getItem('boplo-sim-gfx'); if (v) return v; } catch { } return 'fast'; };
  const loadAircraftLib = () => window.__acLib = window.__acLib || loadScript('/flight-aircraft.js?v=4', () => !!window.BoploAircraft).then(() => loadScript('/flight-jets.js?v=10', () => !!window.BoploJets)).catch(e => { window.__acLib = null; throw e; });
  const loadSimLib = () => window.BoploSim ? Promise.resolve(window.BoploSim) : (window.__simLib = window.__simLib || Promise.all([loadAircraftLib(), loadScript('/flight-physics.js?v=7', () => !!window.BoploPhysics)]).then(() => { window.BoploJets?.install(); return loadScript('/flight-sim.js?v=63', () => !!window.BoploSim); }).then(() => window.BoploSim).catch(e => { window.__simLib = null; throw e; }));
  const simAircraft = src => { const A = window.BoploAircraft; if (!A) return null; const pick = ui.sim.ac || 'auto'; return pick !== 'auto' && A.byId(pick).id === pick ? pick : A.match(src?.aircraft) || A.match(state.profile?.aircraft) || 'c172'; };
  const rwyHdg = a => { const r = (a?.runways || []).filter(x => /^\d{2}/.test(x[0] || '')).sort((x, y) => (y[1] || 0) - (x[1] || 0))[0]; return r ? parseInt(r[0], 10) * 10 : 0; };
  async function openSim(src, mode) {
    if (mode === 'fly' && !isAdv() && !src.freeTry) return upgradeSheet('Flying the simulator yourself is part of Advanced. Replays are free, and you get two free short finals a day.');
    const p = state.profile, isPlan = !!src.inp, PRc = src.practice || null, PRfin = PRc && (PRc.kind === 'long' || PRc.kind === 'short');
    toast(mode === 'replay' ? 'Loading the replay…' : 'Loading the simulator…');
    try {
      const [Sim, dep, arr] = await Promise.all([loadSimLib(), isPlan ? anyAirfield(src.points[0]?.code) : anyAirfield(src.departure), isPlan ? anyAirfield(src.points[src.points.length - 1]?.code) : anyAirfield(src.arrival)]);
      let points = (src.points || []).map(x => ({ lat: +x.lat, lng: +x.lng })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
      if (!points.length && dep) points = [{ lat: dep.lat, lng: dep.lng }, ...(arr && arr.code !== dep.code ? [{ lat: arr.lat, lng: arr.lng }] : [])];
      if (!points.length) { toast('This flight has no route or known airfield to fly from.'); return; }
      const near = (a, pt) => a && pt && Math.abs(a.lat - pt.lat) < .03 && Math.abs(a.lng - pt.lng) < .04;
      const wps = isPlan ? src.points.filter(x => x.code).map(x => ({ code: x.code, lat: +x.lat, lng: +x.lng })) : [dep, arr].filter(Boolean).filter((a, i, l) => l.findIndex(b => b.code === a.code) === i).map(a => ({ code: a.code, lat: a.lat, lng: a.lng }));
      let wind = null, weather = null;
      const WXP = { clear: { visM: 40000 }, fair: { clouds: [{ cover: 'FEW', base: 3500 }], visM: 30000, turb: .12 }, scattered: { clouds: [{ cover: 'SCT', base: 2800 }], visM: 20000, turb: .25 }, broken: { clouds: [{ cover: 'BKN', base: 2200 }, { cover: 'SCT', base: 5500 }], visM: 14000, turb: .3 }, overcast: { clouds: [{ cover: 'OVC', base: 1600 }], visM: 9000, turb: .2 }, hazy: { clouds: [{ cover: 'FEW', base: 4000 }], visM: 4500, turb: .05 }, gusty: { clouds: [{ cover: 'SCT', base: 3000 }], visM: 25000, turb: .45, windRel: { off: 50, spd: 16, gust: 26 } } };
      const wxKey = src.wxOverride || ui.sim.wx;
      if (wxKey === 'live') {
        try { const pt = points[0], d = preview ? EX_WX : await api(`weather?${dep ? `ids=${encodeURIComponent(dep.code)}&` : ''}lat=${pt.lat}&lng=${pt.lng}`); const s = d.stations?.[0];
          if (s) {
            let clouds = (s.clouds || []).filter(c => c && c.cover && Number.isFinite(+c.base)).map(c => ({ cover: c.cover, base: +c.base }));
            if (!clouds.length && s.raw) clouds = [...s.raw.matchAll(/\b(FEW|SCT|BKN|OVC|VV)(\d{3})/g)].map(m => ({ cover: m[1], base: +m[2] * 100 }));
            const vs = String(s.visib ?? ''), sm = vs.includes('+') ? 10 : parseFloat(vs), raw4 = s.raw?.match(/\s(\d{4})\s/);
            const visM = Number.isFinite(sm) ? (sm >= 10 ? 16000 : sm * 1609) : raw4 ? (+raw4[1] >= 9999 ? 16000 : +raw4[1]) : 16000;
            weather = { clouds, visM, gust: +s.wgst || 0, from: s.id };
            if (Number.isFinite(+s.wdir) && s.wspd) wind = { dir: +s.wdir, spd: +s.wspd, from: s.id };
          } } catch { }
        if (!weather) toast('Live weather wasn’t available, so it’s clear skies.');
      } else weather = WXP[wxKey] || null;
      if (wind) { } // live weather already set the wind
      else if (isPlan && src.inp.wdir !== '' && src.inp.wspd !== '' && ui.sim.wind !== 'calm') wind = { dir: +src.inp.wdir, spd: +src.inp.wspd };
      else if (ui.sim.wind === 'live') {
        try { const pt = points[0], d = preview ? EX_WX : await api(`weather?${dep ? `ids=${encodeURIComponent(dep.code)}&` : ''}lat=${pt.lat}&lng=${pt.lng}`); const s = d.stations?.[0]; if (s && Number.isFinite(+s.wdir) && s.wspd) wind = { dir: +s.wdir, spd: +s.wspd, from: s.id }; } catch { }
      }
      const title = PRc ? `${PRACTICE[PRc.kind]} · ${upper(src.departure)}${PRc.end ? ' ' + PRc.end : ''}` : isPlan ? (src.name || 'Nav plan') : `${upper(src.departure) || '—'} → ${upper(src.arrival) || '—'}`;
      const subtitle = PRc ? (dep?.name || '') : isPlan ? '' : [fmtDate(src.date, { day: 'numeric', month: 'short', year: 'numeric' }), src.lesson].filter(Boolean).join(' · ');
      let googleKey = state.mapsKey || '';
      if (!googleKey) { try { googleKey = (await fetch('/flight/simkey').then(r => r.ok ? r.json() : {})).key || ''; } catch { } }
      Sim.open({
        googleKey,
        id: PRc ? `practice-${upper(src.departure)}-${PRc.end || ''}-${PRc.kind}` : isPlan ? 'plan-' + (src.name || '') : src.id, mode, start: PRc ? (PRfin ? 'air' : 'ground') : ui.sim.start, practice: PRc, title, subtitle, points, waypoints: wps, wind, weather, time: ui.sim.time || 'day', gfx: ui.sim.gfx || simGfx(),
        country: dep?.cc || arr?.cc || countryCodeOf(p), aircraft: src.aircraft || p.aircraft, cruiseFt: isPlan && +src.inp.alt ? +src.inp.alt : 0,
        fromElevFt: !PRfin && near(dep, points[0]) && Number.isFinite(dep.elev) ? dep.elev : null, toElevFt: near(arr, points[points.length - 1]) && Number.isFinite(arr.elev) ? arr.elev : null,
        depEnd: src.depEnd || '', arrEnd: src.arrEnd || '',
        runwayHdg: rwyHdg(dep), land: PRc?.kind !== 'takeoff', aircraftId: simAircraft(src), livery: ui.sim.livery || null, radio: PRc && ui.sim.radio !== false && isAdv() ? simRadio(PRc.kind, dep, PRc.end, wind) : null, noRetry: !!src.freeTry,
        onResult: PRc && !preview && !p.boardsOff ? r => api('community/scores', 'POST', { ...r, ap: upper(src.departure), aircraft: (window.BoploAircraft?.byId(simAircraft(src))?.name) || '', challenge: !!src.challenge }).then(x => `#${x.me?.rank} of ${x.total} at ${upper(src.departure)} this week${x.daily ? ` · #${x.daily.rank} in today’s challenge` : ''}`) : null,
        onUpgrade: () => upgradeSheet('Unlimited practice: take-offs, circuits, long and short finals at any airfield, and flying your own routes.'),
        depAirport: dep && !PRfin ? { code: dep.code, lat: dep.lat, lng: dep.lng, cc: dep.cc } : null, arrAirport: arr ? { code: arr.code, lat: arr.lat, lng: arr.lng, cc: arr.cc } : null
      });
    } catch (x) { toast(x.message); }
  }
  let simFreeLeft = null;
  const paintFree = () => { $$('[data-prk]').forEach(b => { const tag = b.querySelector('.pr-tag'); if (!tag) return; if (isAdv()) { tag.hidden = true; return; } tag.hidden = false; const free = b.dataset.prk === 'short'; tag.textContent = free ? (simFreeLeft == null ? '2 free a day' : simFreeLeft ? `${simFreeLeft} free left today` : 'Free tries used today') : 'Advanced'; tag.classList.toggle('free', free && simFreeLeft !== 0); b.classList.toggle('locked', !free || simFreeLeft === 0); }); };
  const PRACTICE = { takeoff: 'Take-off', circuit: 'Circuit', long: 'Long final', short: 'Short final' };
  // practice at any airfield: build a short route on the chosen runway end, then fly it as a normal sim session
  async function openPractice(code, endId, kind, opts = {}) {
    if (!isAdv() && kind !== 'short') return upgradeSheet('Take-offs, circuits and long finals are part of Advanced. Free includes two short finals a day.');
    const ap = await anyAirfield(code) || (opts.af ? { code: opts.af.code, name: opts.af.name, lat: opts.af.lat, lng: opts.af.lng, cc: opts.af.cc, type: 'M', runways: [] } : null); if (!ap) { toast('Pick an airfield from the list.'); return; }
    let freeTry = false;
    if (!isAdv()) {
      // Free: two short finals a day, counted on the server when one starts
      if (!preview) { try { const r = await api('sim/claim', 'POST', { kind }); simFreeLeft = r.left; paintFree(); } catch (e) { if (e.status !== 402) toast(e.message); return; } }
      freeTry = true;
    }
    const rows = ((await fetch(`/runways/${ap.cc}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))).rows || {})[ap.code] || [];
    const M = 111320, cosL = Math.cos(ap.lat * Math.PI / 180);
    const move = (pt, brg, m) => ({ lat: pt.lat + Math.cos(brg) * m / M, lng: pt.lng + Math.sin(brg) * m / (M * cosL) });
    const brgOf = (a, b) => Math.atan2((b.lng - a.lng) * cosL, b.lat - a.lat);
    let T = null, far = null, id = endId || '';
    const ends = rows.flatMap(r => [{ id: r[0], T: { lat: r[2], lng: r[3] }, far: { lat: r[4], lng: r[5] }, len: r[6] }, { id: r[1], T: { lat: r[4], lng: r[5] }, far: { lat: r[2], lng: r[3] }, len: r[6] }]);
    let e = ends.find(x => x.id === endId) || [...ends].sort((a, b) => (b.len || 0) - (a.len || 0))[0];
    if (e) { T = e.T; far = e.far; id = e.id; }
    else {
      // no surveyed runway: use the published heading through the airfield's reference point
      const ident = endId || String(ap.runways?.[0]?.[0] || '09').split('/')[0], h = (parseInt(ident, 10) || 9) * 10 * Math.PI / 180, half = Math.max(250, (ap.runways?.[0]?.[1] || 600) / 2);
      T = move(ap, h + Math.PI, half); far = move(ap, h, half); id = ident;
    }
    const brg = brgOf(T, far), len = Math.hypot((far.lat - T.lat) * M, (far.lng - T.lng) * M * cosL);
    const pts = kind === 'takeoff' ? [T, far, move(far, brg, 9000)] : kind === 'circuit' ? [T, move(T, brg, Math.min(len, 1000))]
      : [move(T, brg + Math.PI, kind === 'long' ? 11112 : 3704), T];
    if (freeTry && simFreeLeft != null) toast(simFreeLeft ? `Free short final: ${simFreeLeft} left today.` : 'That’s your last free short final today.');
    return openSim({ id: 'practice', departure: ap.code, arrival: ap.code, points: pts.map(x => ({ lat: x.lat, lng: x.lng })), practice: { kind, end: id }, aircraft: state.profile.aircraft, freeTry, wxOverride: opts.weather, challenge: !!opts.challenge }, 'fly');
  }
  const simmable = () => sorted().filter(f => f.points?.length || upper(f.departure));
  // worldwide route planner: pick airports and runways on a map, then fly or replay the route in the simulator
  const loadRouteLib = () => window.BoploRoute ? Promise.resolve(window.BoploRoute) : loadScript('/flight-route.js?v=6', () => !!window.BoploRoute).then(() => window.BoploRoute);
  async function openRoutePlanner() {
    const btn = $('[data-rpopen]'); if (btn) btn.disabled = true;
    try {
      const [R] = await Promise.all([loadRouteLib(), loadAircraftLib().catch(() => { })]);
      const A = window.BoploAircraft, id = simAircraft({ aircraft: state.profile.aircraft }), t = A?.byId?.(id);
      await R.open({
        home: upper(state.profile.airport), country: countryCodeOf(state.profile), jet: t?.kind === 'jet', speedKt: t?.perf?.cruise || 110,
        onFly: (r, mode) => openSim({ id: 'route-' + r.name, name: r.name, points: r.points, inp: { alt: r.alt, wdir: '', wspd: '' }, depEnd: r.depEnd, arrEnd: r.arrEnd, aircraft: state.profile.aircraft }, mode)
      });
    } catch (e) { toast(e.message || 'The map couldn’t open.'); }
    finally { const b = $('[data-rpopen]'); if (b) b.disabled = false; }
  }
  function simPage() {
    const list = simmable(), plans = navStore().logs || [];
    const card = (f, i) => `<article class="tile sim-pick">
        <div class="sim-thumb">${f.points?.length > 1 ? trackSVG([f], 320, 180) : `<div class="mini-empty"><b>${esc(upper(f.departure))}</b>A circuit from this airfield</div>`}</div>
        <div class="sim-pick-body"><b>${esc(upper(f.departure))} → ${esc(upper(f.arrival))}</b><small>${esc([fmtDate(f.date, { day: 'numeric', month: 'short', year: 'numeric' }), f.lesson || f.aircraft, hm(f.minutes) + ' h'].filter(Boolean).join(' · '))}</small></div>
        <div class="sim-pick-actions"><button class="btn btn-line btn-sm" data-simr="${i}">Replay</button><button class="btn btn-blue btn-sm" data-simf="${i}">Fly it</button></div>
      </article>`;
    shell('sim', { title: 'Simulator', sub: 'Fly your logged routes again over real 3D terrain. Watch a replay, or take the controls yourself.' },
      `<section class="tile dark sim-hero">${contours('a')}
        <div><span class="kicker">Mini flight simulator</span><h2 class="display">Your routes, flown again.</h2><p>Every route you log or plan can be replayed or flown: take off, follow the gates, and land. Works with a keyboard, a gamepad, or your phone’s touch and tilt.</p></div>
        <form class="sim-opts" data-simopts>
          <fieldset><legend>Start</legend><div class="segmented">${[['ground', 'On the runway'], ['air', 'In the air']].map(([v, l]) => `<label><input type="radio" name="start" value="${v}" ${ui.sim.start === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
          <fieldset><legend>Weather</legend><select name="wx" class="sim-wxsel">${[['live', 'Live at departure (METAR)'], ['clear', 'Clear skies'], ['fair', 'Fair, a few cumulus'], ['scattered', 'Scattered cloud, light bumps'], ['broken', 'Broken cloud'], ['overcast', 'Low overcast'], ['hazy', 'Hazy, 4 km visibility'], ['gusty', 'Gusty crosswind (16 G26 kt)']].map(([v, l]) => `<option value="${v}" ${ui.sim.wx === v ? 'selected' : ''}>${l}</option>`).join('')}</select></fieldset>
          <fieldset><legend>Time of day</legend><div class="segmented">${[['day', 'Day'], ['golden', 'Golden hour'], ['night', 'Night']].map(([v, l]) => `<label><input type="radio" name="time" value="${v}" ${(ui.sim.time || 'day') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
          <fieldset><legend>Wind</legend><div class="segmented">${[['calm', 'Calm'], ['live', 'Live at departure']].map(([v, l]) => `<label><input type="radio" name="wind" value="${v}" ${ui.sim.wind === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
          <fieldset><legend>Graphics</legend><div class="segmented">${[['fast', 'Fast'], ['balanced', 'Balanced'], ['detailed', 'Detailed 3D']].map(([v, l]) => `<label><input type="radio" name="gfx" value="${v}" ${(ui.sim.gfx || simGfx()) === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
        </form>
      </section>
      <section class="tile rp-box" aria-labelledby="rp-h">
        <div class="rp-box-art" aria-hidden="true"><svg viewBox="0 0 320 150"><path d="M30 118 C 90 40, 170 30, 290 52" fill="none" stroke="#9ED8FF" stroke-width="2.4" stroke-dasharray="1 0"/><path d="M30 118 C 90 40, 170 30, 290 52" fill="none" stroke="#0A62FF" stroke-width="9" opacity=".35"/><g fill="#040B22" stroke="#9ED8FF" stroke-width="2"><circle cx="30" cy="118" r="6"/><circle cx="290" cy="52" r="6"/><circle cx="160" cy="44" r="4"/></g><path d="M18 128l26-20M280 62l22-18" stroke="#DDEBFF" stroke-width="4"/></svg></div>
        <div class="rp-box-t"><h2 class="section-h" id="rp-h">Fly anywhere in the world</h2><p class="hint">Open the world map, tap a departure and an arrival, pick the runways and add waypoints. Every airport on Earth with real runway headings and lengths. The autopilot can follow the route.</p>
        <div class="rp-box-act"><button type="button" class="btn btn-blue" data-rpopen>${ico('map')}Open the world map</button>${(() => { try { const r = JSON.parse(localStorage.getItem('boplo-route') || 'null'); const a = r?.points?.[0]?.code, b = r?.points?.length > 1 ? r.points[r.points.length - 1].code : ''; return a && b ? `<span class="rp-last">Last route: <b>${esc(a)} → ${esc(b)}</b></span>` : ''; } catch { return ''; } })()}</div></div>
      </section>
      <section class="tile pr-box" aria-labelledby="pr-h">
        <div class="pr-head"><div><h2 class="section-h" id="pr-h">Practise at any airfield</h2><p class="hint">Take-offs, circuits and approaches on real runways anywhere in ${esc(state.profile.country || 'your country')}. You get a debrief against checkride standards.</p></div></div>
        <div class="pr-row">
          <label class="pr-f"><span>Airfield</span><input type="text" list="pr-afs" data-prap value="${esc(ui.sim.prAp || upper(state.profile.airport).split(/[\s·]/)[0] || '')}" placeholder="Search by code or name" autocomplete="off" spellcheck="false"><datalist id="pr-afs" data-prlist></datalist></label>
          <label class="pr-f"><span>Runway</span><select data-prrw><option value="">Longest runway</option></select></label>
        </div>
        <label class="sim-radio-opt"><input type="checkbox" data-prradio ${ui.sim.radio !== false ? 'checked' : ''}> <span><b>Radio calls</b> Make your calls out loud as you fly (or type them) and get each one checked, with the controller’s replies. Advanced.</span></label>
        <div class="pr-kinds">${[['takeoff', 'Take-off', 'Line up, roll, rotate and climb away to 1,000 ft'], ['circuit', 'Circuit', 'A full left-hand circuit and landing'], ['long', 'Long final', 'Established at 6 NM, 1,900 ft'], ['short', 'Short final', 'Established at 2 NM, 650 ft, landing flap']].map(([k, l, d]) => `<button type="button" class="pr-kind" data-prk="${k}"><span class="pr-tag" hidden></span><b>${l}</b><small>${d}</small></button>`).join('')}</div>
      </section>
      <section class="ac-pick" aria-labelledby="ac-h"><div class="ac-head"><div><h2 class="section-h" id="ac-h">Aircraft</h2><p class="hint" data-acnote></p></div><button type="button" class="ac-auto-btn" data-acauto aria-pressed="false">${ico('logbook')}Match my logbook</button></div><div class="ac-grid" data-acgrid><p class="hint">Loading aircraft…</p></div></section>
      <p class="footnote" style="margin:10px 2px 18px">A game-like practice toy for fun and route familiarisation. It isn’t an approved training device, and its flight model is simplified.</p>
      ${list.length ? `<h2 class="section-h">Logged flights</h2><div class="sim-grid">${list.slice(0, 24).map(card).join('')}</div>` : `<div class="tile empty center"><h3>Log a flight to fly it again.</h3><p>Flights with a plotted route or a GPS track replay best. A flight from a known airfield gives you a circuit.</p><button class="btn btn-blue btn-has-spark" data-add>Log a flight ${spark}</button></div>`}
      ${plans.length ? `<h2 class="section-h">Nav plans</h2><div class="sim-grid">${plans.map((s, i) => `<article class="tile sim-pick"><div class="sim-thumb">${trackSVG([{ id: 'p' + i, points: s.points, departure: s.points[0]?.code, arrival: s.points[s.points.length - 1]?.code, routeKind: 'route' }], 320, 180)}</div><div class="sim-pick-body"><b>${esc(s.name || 'Plan')}</b><small>${esc(s.points.map(x => x.code).filter(Boolean).join(' → ') || s.points.length + ' points')}${s.inp?.alt ? ` · ${esc(s.inp.alt)} ft` : ''}</small></div><div class="sim-pick-actions"><button class="btn btn-line btn-sm" data-simpr="${i}">Replay</button><button class="btn btn-blue btn-sm" data-simpf="${i}">Fly it</button></div></article>`).join('')}</div>` : ''}`);
    const paintAc = () => {
      const A = window.BoploAircraft, grid = $('[data-acgrid]'); if (!A || !grid) return;
      const auto = A.match(state.profile.aircraft), cur = ui.sim.ac || 'auto', shown = cur === 'auto' ? auto : cur;
      const tog = $('[data-acauto]'); if (tog) { tog.setAttribute('aria-pressed', String(cur === 'auto')); tog.onclick = () => { ui.sim.ac = 'auto'; try { localStorage.setItem('boplo-sim-ac', 'auto'); } catch { } paintAc(); }; }
      const card = t => `<button type="button" class="ac-card ${shown === t.id ? 'on' : ''}" data-ac="${t.id}" aria-pressed="${shown === t.id}">
          <span class="ac-img"><img src="/aircraft/${t.id}.webp?v=3" alt="" width="640" height="360" loading="lazy" decoding="async">${cur === 'auto' && auto === t.id ? '<span class="ac-badge">Your aircraft</span>' : t.kind === 'jet' ? `<span class="ac-badge jet">${esc(t.cat)}</span>` : ''}</span>
          <span class="ac-txt"><b>${esc(t.name)}</b><small>${esc(t.blurb)}</small><span class="ac-perf">${t.kind === 'jet' ? `<span>Approach ${t.perf.appr} kt</span><span>${t.perf.climb} fpm</span><span>Rotate ${t.perf.vr} kt</span>` : `<span>${t.perf.cruise} kt</span><span>${t.perf.climb} fpm</span><span>Vs ${t.perf.vs} kt</span>`}</span></span></button>`;
      const trainers = A.TYPES.filter(t => t.kind !== 'jet'), jets = A.TYPES.filter(t => t.kind === 'jet'), LV = A.LIVERIES || {};
      const shownJet = jets.find(t => t.id === shown), livNow = ui.sim.livery && LV[ui.sim.livery] ? ui.sim.livery : shownJet?.livery;
      grid.innerHTML = `<h3 class="ac-group">Trainers</h3>${trainers.map(card).join('')}${jets.length ? `<h3 class="ac-group">Jets <small>Just for fun: bigger aircraft with jet engines, retractable gear and spoilers.</small></h3>${jets.map(card).join('')}${shownJet ? `<div class="ac-liv" role="group" aria-label="Livery"><span>Livery</span>${Object.entries(LV).map(([k, l]) => `<button type="button" data-liv="${k}" aria-pressed="${k === livNow}"><i style="background:${l.tail}"></i>${esc(l.name)}</button>`).join('')}</div>` : ''}` : ''}`;
      $$('[data-liv]').forEach(b => b.onclick = () => { ui.sim.livery = b.dataset.liv; try { localStorage.setItem('boplo-sim-liv', ui.sim.livery); } catch { } paintAc(); });
      $$('[data-ac]').forEach(b => b.onclick = () => { ui.sim.ac = b.dataset.ac; try { localStorage.setItem('boplo-sim-ac', ui.sim.ac); } catch { } paintAc(); });
      const note = $('[data-acnote]'); if (note) note.textContent = cur === 'auto' ? 'Each flight flies in the aircraft you logged for it.' + (auto ? '' : ' Unknown types use the Cessna 172.') : `Every flight flies in the ${A.byId(cur).name}.`;
    };
    loadAircraftLib().then(paintAc).catch(() => { const g = $('[data-acgrid]'); if (g) g.innerHTML = '<p class="hint">Aircraft didn’t load. You’ll fly the standard trainer.</p>'; });
    const fo = $('[data-simopts]'); fo.onchange = () => { const v = Object.fromEntries(new FormData(fo)); ui.sim.start = v.start; ui.sim.wind = v.wind; ui.sim.wx = v.wx; ui.sim.time = v.time; ui.sim.gfx = v.gfx; try { localStorage.setItem('boplo-sim-wx', v.wx); localStorage.setItem('boplo-sim-gfx', v.gfx); } catch { } };
    // practice picker: airfields in the pilot's country, runway ends from the surveyed runway data
    { const cc = countryCodeOf(state.profile), inp = $('[data-prap]'), sel = $('[data-prrw]'), dl = $('[data-prlist]');
      let afs = [];
      const fillRw = async () => {
        const c = upper(inp.value).split(/[\s·]/)[0]; ui.sim.prAp = c; const ap = afs.find(a => a.code === c) || (c ? await anyAirfield(c) : null);
        sel.innerHTML = '<option value="">Longest runway</option>'; if (!ap) return;
        // start the exact-runway lookup now, while the student is still choosing, so the sim has it when it opens
        loadSimLib().then(S => S.prefetch?.({ code: ap.code, lat: ap.lat, lng: ap.lng, cc: ap.cc || cc })).catch(() => { });
        const rows = ((await fetch(`/runways/${ap.cc || cc}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))).rows || {})[ap.code] || [];
        const ends = rows.length ? rows.flatMap(r => [[r[0], r[6]], [r[1], r[6]]]) : (ap.runways || []).flatMap(r => String(r[0] || '').split('/').map(x => [x, r[1]]));
        sel.innerHTML += ends.filter(x => x[0]).map(([id, l]) => `<option value="${esc(id)}" ${ui.sim.prRw === id ? 'selected' : ''}>Runway ${esc(id)}${l ? ` · ${Math.round(l)} m` : ''}</option>`).join('');
      };
      if (window.BoploMap && cc) BoploMap.airfields(cc).then(l => { afs = l.map(a => ({ ...a, cc })); dl.innerHTML = afs.filter(a => a.type !== 'W').map(a => `<option value="${esc(a.code)} · ${esc(a.name)}"></option>`).join(''); fillRw(); });
      inp.onchange = fillRw; sel.onchange = () => { ui.sim.prRw = sel.value; };
      const rr = $('[data-prradio]'); if (rr) rr.onchange = () => { ui.sim.radio = rr.checked; };
      paintFree(); if (!isAdv() && !preview) api('sim/usage').then(r => { if (!r.unlimited) { simFreeLeft = r.left; paintFree(); } }).catch(() => { });
      $$('[data-prk]').forEach(b => b.onclick = () => { const c = upper(inp.value).split(/[\s·]/)[0]; if (!c) { inp.focus(); toast('Pick an airfield first.'); return; } openPractice(c, sel.value, b.dataset.prk); }); }
    $('[data-rpopen]').onclick = () => openRoutePlanner();
    $$('[data-simr]').forEach(b => b.onclick = () => openSim(list[+b.dataset.simr], 'replay'));
    $$('[data-simf]').forEach(b => b.onclick = () => openSim(list[+b.dataset.simf], 'fly'));
    $$('[data-simpr]').forEach(b => b.onclick = () => openSim(plans[+b.dataset.simpr], 'replay'));
    $$('[data-simpf]').forEach(b => b.onclick = () => openSim(plans[+b.dataset.simpf], 'fly'));
  }

  /* ================= community: Q&A, landing leaderboards, students nearby ================= */
  const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : s < 86400 * 7 ? `${Math.floor(s / 86400)} d ago` : fmtDate(new Date(t).toISOString().slice(0, 10), { day: 'numeric', month: 'short' }); };
  const pilotTag = b => `<span class="pilot"><span class="avatar sm" aria-hidden="true">${esc((b?.name || 'P')[0])}</span><b>${esc(b?.name || 'Pilot')}</b>${b?.airfield ? `<small>${esc(b.airfield)}</small>` : ''}${b?.licence ? `<small>${esc(b.licence)}</small>` : ''}</span>`;
  const DEMO_Q = { topics: [['general', 'General'], ['training', 'Training and lessons'], ['exams', 'Theory exams'], ['checkride', 'Skill test and checkride'], ['radio', 'Radio'], ['navigation', 'Navigation'], ['weather', 'Weather'], ['aircraft', 'Aircraft'], ['costs', 'Costs and schools'], ['medical', 'Medicals']], questions: [
    { id: 'd1', title: 'How did you deal with nerves before your first solo?', excerpt: 'My instructor says I’m ready but I keep overthinking the go-around. Anything that helped you?', topic: 'training', score: 14, answers: 6, at: Date.now() - 7200e3, last: Date.now() - 1800e3, my: 0, by: { name: 'Priya', airfield: 'EGHP', licence: 'PPL(A)' } },
    { id: 'd2', title: 'Best way to learn the air law questions on VFR minima?', excerpt: 'I keep mixing up the class D and G numbers.', topic: 'exams', score: 9, answers: 3, at: Date.now() - 86400e3, last: Date.now() - 20000e3, my: 0, by: { name: 'Tom', airfield: 'EGTF', licence: 'PPL(A)' } },
    { id: 'd3', title: 'Crosswind landings in a PA-28: wing down or crab?', excerpt: '', topic: 'aircraft', score: 5, answers: 0, at: Date.now() - 3 * 86400e3, last: Date.now() - 3 * 86400e3, my: 0, by: { name: 'Lucía', airfield: 'LEVC', licence: 'LAPL(A)' } }] };
  const cApi = (path, method, body) => preview ? Promise.reject(Object.assign(new Error('The example desk can’t post to the community.'), { status: 400 })) : api('community/' + path, method, body);

  async function communityPage() {
    const st = ui.cq || (ui.cq = { topic: '', sort: 'new', q: '', open: null });
    if (st.open) return questionView(st.open);
    shell('community', { title: 'Community', sub: 'Ask other student pilots, share what worked, and help the next person.', actions: `<button class="btn btn-blue btn-has-spark" data-newq>Ask a question ${spark}</button>` },
      `<p class="callout">Be kind and specific. Answers here are from other students, not instructors: check anything that matters with your school.</p>
      <div class="c-tools"><label class="search">${ico('search')}<span class="sr">Search questions</span><input data-cqs value="${esc(st.q)}" placeholder="Search questions"></label>
        <div class="segmented" data-csort>${[['new', 'Latest'], ['top', 'Top'], ['open', 'Unanswered']].map(([v, l]) => `<label><input type="radio" name="csort" value="${v}" ${st.sort === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <div class="c-topics" data-ctopics></div>
      <div data-clist><div class="tile"><p class="hint">Loading questions…</p></div></div>`);
    $('[data-newq]').onclick = () => askSheet();
    const load = async () => {
      let d; try { d = preview ? DEMO_Q : await cApi(`posts?sort=${st.sort}${st.topic ? '&topic=' + st.topic : ''}${st.q ? '&q=' + encodeURIComponent(st.q) : ''}`); } catch (x) { $('[data-clist]').innerHTML = `<div class="tile empty center"><h3>The community didn’t load.</h3><p>${esc(x.message)}</p></div>`; return; }
      ui.cTopics = d.topics;
      $('[data-ctopics]').innerHTML = [['', 'All topics'], ...d.topics].map(([k, l]) => `<button type="button" class="chip ${st.topic === k ? 'on' : ''}" data-ctopic="${k}">${esc(l)}</button>`).join('');
      $$('[data-ctopic]').forEach(b => b.onclick = () => { st.topic = b.dataset.ctopic; load(); });
      const qs = preview ? d.questions.filter(q => (!st.topic || q.topic === st.topic) && (st.sort !== 'open' || !q.answers)) : d.questions;
      $('[data-clist]').innerHTML = qs.length ? `<div class="c-list">${qs.map(q => `<button type="button" class="tile c-q" data-openq="${esc(q.id)}">
          <div class="c-votes"><b>${q.score}</b><small>votes</small></div><div class="c-ans ${q.answers ? 'has' : ''}"><b>${q.answers}</b><small>${q.answers === 1 ? 'answer' : 'answers'}</small></div>
          <div class="c-body"><h3>${esc(q.title)}</h3>${q.excerpt ? `<p>${esc(q.excerpt)}</p>` : ''}<div class="c-meta"><span class="chip">${esc((d.topics.find(t => t[0] === q.topic) || ['', 'General'])[1])}</span>${pilotTag(q.by)}<small>${esc(ago(q.last || q.at))}</small></div></div></button>`).join('')}</div>`
        : `<div class="tile empty center"><h3>${st.q || st.topic || st.sort === 'open' ? 'Nothing here yet.' : 'Be the first to ask.'}</h3><p>Questions about lessons, exams, checkrides, radio, costs: anything another student might know.</p><button class="btn btn-blue" data-newq2>Ask a question</button></div>`;
      $$('[data-openq]').forEach(b => b.onclick = () => { st.open = b.dataset.openq; communityPage(); scrollTo(0, 0); });
      const n2 = $('[data-newq2]'); if (n2) n2.onclick = () => askSheet();
    };
    let qt = 0; $('[data-cqs]').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value.trim(); load(); }, 350); };
    $('[data-csort]').onchange = e => { st.sort = e.target.value; load(); };
    load();
  }
  function askSheet() {
    const topics = ui.cTopics || DEMO_Q.topics;
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Ask the community</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <form class="sheet-body" data-askf novalidate><label class="field"><span>Your question</span><input name="title" maxlength="140" required placeholder="e.g. How did you prepare for the navigation exam?"></label>
        <label class="field"><span>Topic</span><select name="topic">${topics.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>Details <i>(optional)</i></span><textarea name="body" rows="5" maxlength="3000" placeholder="Add context: your licence, aircraft, what you’ve tried."></textarea></label>
        <p class="hint">Others see your first name, home airfield and licence. Don’t share personal details, and follow your instructor’s advice over anything posted here.</p><p class="form-error" role="alert"></p></form>
      <footer class="sheet-foot"><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Cancel</button><button type="button" class="btn btn-blue" data-post>Post question</button></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => sheet.close()); sheet.showModal();
    sheet.querySelector('[data-post]').onclick = async e => {
      const f = sheet.querySelector('[data-askf]'), v = Object.fromEntries(new FormData(f)), err = sheet.querySelector('.form-error'); e.target.disabled = true; err.textContent = '';
      try { const r = await cApi('posts', 'POST', v); sheet.close(); ui.cq.open = r.id; communityPage(); } catch (x) { err.textContent = x.message; e.target.disabled = false; }
    };
  }
  async function questionView(id) {
    const st = ui.cq, owner = !!B().owner;
    shell('community', { title: 'Community', actions: '<button class="btn btn-line" data-cback>All questions</button>' }, '<div data-cq><div class="tile"><p class="hint">Loading…</p></div></div>');
    $('[data-cback]').onclick = () => { st.open = null; communityPage(); };
    let d;
    try { d = preview ? { question: { ...DEMO_Q.questions.find(q => q.id === id), body: DEMO_Q.questions.find(q => q.id === id)?.excerpt || '' }, answers: id === 'd1' ? [{ id: 'a1', body: 'Chair-fly the whole circuit the night before, out loud, including the go-around. It made it feel routine.', score: 8, at: Date.now() - 5000e3, my: 0, by: { name: 'Jack', airfield: 'EGHP', licence: 'PPL(A)' } }] : [] } : await cApi('posts/' + id); }
    catch (x) { $('[data-cq]').innerHTML = `<div class="tile empty center"><h3>${esc(x.message)}</h3></div>`; return; }
    const q = d.question, topic = ((ui.cTopics || DEMO_Q.topics).find(t => t[0] === q.topic) || ['', 'General'])[1];
    const voteBox = p => `<div class="c-vote" data-pid="${esc(p.id)}"><button type="button" class="${p.my > 0 ? 'on' : ''}" data-v="1" aria-label="Helpful" ${p.mine ? 'disabled' : ''}>▲</button><b>${p.score}</b><button type="button" class="${p.my < 0 ? 'on' : ''}" data-v="-1" aria-label="Not helpful" ${p.mine ? 'disabled' : ''}>▼</button></div>`;
    const actions = p => `<div class="c-acts">${p.mine || owner ? `<button type="button" class="link" data-del="${esc(p.id)}">Delete</button>` : ''}${!p.mine ? `<button type="button" class="link" data-rep="${esc(p.id)}">Report</button>` : ''}${p.hidden ? '<span class="chip warn">Hidden after reports</span>' : ''}${owner && p.reports ? `<span class="chip">${p.reports} reports</span>` : ''}</div>`;
    $('[data-cq]').innerHTML = `<article class="tile c-full">${voteBox(q)}<div><span class="chip">${esc(topic)}</span><h2 class="c-title">${esc(q.title)}</h2>${q.body ? `<div class="c-text">${esc(q.body).replace(/\n/g, '<br>')}</div>` : ''}<div class="c-meta">${pilotTag(q.by)}<small>${esc(ago(q.at))}</small></div>${actions(q)}</div></article>
      <h3 class="section-h">${d.answers.length} ${d.answers.length === 1 ? 'answer' : 'answers'}</h3>
      ${d.answers.map(a => `<article class="tile c-full ans">${voteBox(a)}<div><div class="c-text">${esc(a.body).replace(/\n/g, '<br>')}</div><div class="c-meta">${pilotTag(a.by)}<small>${esc(ago(a.at))}</small></div>${actions(a)}</div></article>`).join('')}
      <form class="tile c-reply" data-reply><label class="field"><span>Your answer</span><textarea name="body" rows="4" maxlength="3000" placeholder="Share what worked for you"></textarea></label><p class="form-error" role="alert"></p><div class="actions"><span class="hint">Shown with your first name, home airfield and licence.</span><button class="btn btn-blue">Post answer</button></div></form>`;
    $$('[data-pid]').forEach(box => box.querySelectorAll('[data-v]').forEach(b => b.onclick = async () => { const cur = box.querySelector('.on')?.dataset.v, v = cur === b.dataset.v ? 0 : +b.dataset.v; try { const r = await cApi('vote', 'POST', { id: box.dataset.pid, v }); box.querySelector('b').textContent = r.score; box.querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', +x.dataset.v === r.my)); } catch (x) { toast(x.message); } }));
    $$('[data-del]').forEach(b => b.onclick = async () => { if (!confirmInline(b, 'Delete?')) return; try { await cApi('posts/' + b.dataset.del, 'DELETE'); if (b.dataset.del === q.id) { st.open = null; communityPage(); } else questionView(id); } catch (x) { toast(x.message); } });
    $$('[data-rep]').forEach(b => b.onclick = async () => { try { await cApi('report', 'POST', { id: b.dataset.rep, reason: 'reported' }); b.textContent = 'Reported'; b.disabled = true; toast('Thanks. Posts reported by several people are hidden until reviewed.'); } catch (x) { toast(x.message); } });
    $('[data-reply]').onsubmit = async e => { e.preventDefault(); const f = e.target, err = f.querySelector('.form-error'), btn = f.querySelector('button'); btn.disabled = true; err.textContent = ''; try { await cApi(`posts/${id}/answers`, 'POST', Object.fromEntries(new FormData(f))); questionView(id); } catch (x) { err.textContent = x.message; btn.disabled = false; } };
  }
  // ask once before a destructive click: the first click arms the button, the second confirms
  /* ================= flight recorder, GPS file import, offline desk and phone notifications ================= */
  const KT_MS = 1.943844, R_E = 6371000;
  const distM = (a, b) => { const r = Math.PI / 180, h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2; return 2 * R_E * Math.asin(Math.sqrt(h)); };
  // a recorded or imported track ({lat,lng,alt?,t?}) to logbook facts: block time, take-offs and landings, end points
  function analyseTrack(pts) {
    const P = pts.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const timed = P.filter(p => Number.isFinite(p.t)).length > P.length * .8;
    if (!timed) return { points: P, minutes: null, landings: null, first: P[0], last: P[P.length - 1] };
    for (let i = 1; i < P.length; i++) { const dt = (P[i].t - P[i - 1].t) / 1000; P[i].gs = Number.isFinite(P[i].gs) ? P[i].gs : dt > 0 ? distM(P[i - 1], P[i]) / dt * KT_MS : P[i - 1].gs || 0; }
    if (P[0]) P[0].gs = P[0].gs || 0;
    const moving = P.filter(p => p.gs > 6), start = moving[0]?.t ?? P[0].t, end = moving[moving.length - 1]?.t ?? P[P.length - 1].t;
    const ground = P.filter(p => p.gs < 12 && Number.isFinite(p.alt)).map(p => p.alt).sort((a, b) => a - b), fieldAlt = ground.length ? ground[Math.floor(ground.length / 2)] : null;
    let air = false, landings = 0, fast = 0, slow = 0, low = 0, takeoff = null;
    for (const p of P) {
      const agl = fieldAlt != null && Number.isFinite(p.alt) ? p.alt - fieldAlt : null;
      if (!air) { fast = p.gs >= 40 ? fast + 1 : 0; if (fast >= 3 || (agl != null && agl > 60 && p.gs > 35)) { air = true; takeoff = takeoff || p.t; fast = 0; low = 0; } }
      else {
        slow = p.gs < 35 ? slow + 1 : 0; low = air === true && agl != null && agl < 12 && p.gs < 85 ? low + 1 : 0;
        // a full stop ends the flight segment; a touch-and-go is counted once, then waits until it climbs away
        if (slow >= 3) { if (air === true) landings++; air = false; slow = 0; low = 0; }
        else if (low >= 3) { landings++; air = 'touched'; low = 0; }
        else if (air === 'touched' && agl != null && agl > 40) air = true;
      }
    }
    if (air === 'touched') air = false;
    return { points: P, minutes: Math.max(1, Math.round((end - start) / 60000)), landings, takeoff, first: P[0], last: P[P.length - 1], date: new Date(start).toISOString().slice(0, 10), airborne: !!takeoff };
  }
  const thin = (P, max = 1500) => { if (P.length <= max) return P; const k = P.length / max, out = []; for (let i = 0; i < max; i++) out.push(P[Math.floor(i * k)]); out.push(P[P.length - 1]); return out; };
  async function nearestField(pt) { if (!pt || !window.BoploMap) return ''; const cc = countryCodeOf(state.profile); const list = cc ? await BoploMap.airfields(cc) : []; let best = null, bd = 4000; for (const a of list) { const d = distM(pt, a); if (d < bd) { bd = d; best = a; } } return best ? best.code : ''; }
  async function draftFromTrack(pts, extra = {}) {
    const a = analyseTrack(pts), p = state.profile;
    const [dep, arr] = await Promise.all([nearestField(a.first), nearestField(a.last)]);
    return { date: a.date || todayISO(), departure: dep, arrival: arr || dep, minutes: a.minutes ?? '', landings: a.landings ?? '', aircraft: p.aircraft || '', registration: p.registration || '', role: 'dual', points: thin(a.points).map(x => ({ lat: +x.lat.toFixed(6), lng: +x.lng.toFixed(6) })), routeKind: 'track', notes: '', ...extra };
  }

  // ---- the recorder: keeps the screen awake, saves as it goes so a reload doesn't lose the flight ----
  const REC = 'boplo-rec';
  const recLoad = () => { try { return JSON.parse(localStorage.getItem(REC) || 'null'); } catch { return null; } };
  const recSave = r => { try { localStorage.setItem(REC, JSON.stringify(r)); } catch { } };
  let recWatch = null, recWake = null, recTick = 0;
  function recorderSheet() {
    if (!navigator.geolocation) { toast('This device can’t share its location.'); return; }
    let r = recLoad() || { pts: [], startedAt: Date.now(), running: false };
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Record a flight</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body rec">
        <div class="rec-big"><div><span>Time</span><b data-rt>0:00</b></div><div><span>Groundspeed</span><b data-rgs>—</b></div><div><span>Altitude</span><b data-ralt>—</b></div><div><span>Landings</span><b data-rld>0</b></div></div>
        <p class="rec-state" data-rstate>Ready. Start when you’re strapped in; Boplo works out the take-off, the landings and your times.</p>
        <p class="hint">Keep Boplo open with the screen on (it stays awake while recording), and the phone somewhere it can see the sky. Recording uses your location only on this device until you save the flight. Never let it distract you: set it up before engine start.</p>
        <p class="form-error" role="alert"></p></div>
      <footer class="sheet-foot"><button type="button" class="btn btn-line" data-rdiscard ${r.pts.length ? '' : 'hidden'}>Discard</button><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-blue btn-has-spark" data-rgo>${r.running ? 'Stop and log it' : r.pts.length ? 'Resume' : 'Start recording'} ${spark}</button></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => sheet.close()); sheet.showModal();
    const $s = q => sheet.querySelector(q), err = $s('.form-error');
    const paint = () => {
      if (!sheet.open || !$s('[data-rt]')) return;
      const a = r.pts.length > 2 ? analyseTrack(r.pts.map(x => ({ ...x }))) : null, last = r.pts[r.pts.length - 1];
      const sec = r.running || r.pts.length ? Math.round(((r.running ? Date.now() : last?.t || Date.now()) - r.startedAt) / 1000) : 0;
      $s('[data-rt]').textContent = `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}${sec < 3600 ? ':' + String(sec % 60).padStart(2, '0') : ''}`;
      $s('[data-rgs]').textContent = last && Number.isFinite(last.gs) ? `${Math.round(last.gs)} kt` : '—';
      $s('[data-ralt]').textContent = last && Number.isFinite(last.alt) ? `${Math.round(last.alt / 0.3048).toLocaleString('en-GB')} ft` : '—';
      $s('[data-rld]').textContent = a?.landings ?? 0;
      $s('[data-rstate]').textContent = !r.running ? (r.pts.length ? `Paused · ${r.pts.length} points recorded.` : $s('[data-rstate]').textContent) : !a ? 'Recording. Waiting for a GPS fix…' : a.airborne ? `Recording · airborne since ${new Date(a.takeoff).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : last?.gs > 6 ? 'Recording · taxiing' : 'Recording · on the ground';
    };
    const onPos = pos => {
      const c = pos.coords, t = pos.timestamp || Date.now(), last = r.pts[r.pts.length - 1];
      if (c.accuracy > 80) return;
      const pt = { lat: c.latitude, lng: c.longitude, alt: Number.isFinite(c.altitude) ? c.altitude : undefined, t, gs: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed * KT_MS : undefined };
      if (last && t - last.t < 2000) return;
      if (last && distM(last, pt) < 8 && t - last.t < 15000) return;
      if (!Number.isFinite(pt.gs) && last) pt.gs = distM(last, pt) / ((t - last.t) / 1000) * KT_MS;
      r.pts.push(pt); if (r.pts.length > 9000) r.pts = r.pts.filter((_, i) => i % 2 === 0);
      if (!r.saveT || t - r.saveT > 15000) { r.saveT = t; recSave(r); }
      paint();
    };
    const startRec = async () => {
      err.textContent = ''; r.running = true; if (!r.pts.length) r.startedAt = Date.now(); recSave(r);
      recWatch = navigator.geolocation.watchPosition(onPos, e => { err.textContent = e.code === 1 ? 'Allow location access for Boplo to record the flight.' : 'No GPS signal yet. Keep the phone where it can see the sky.'; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
      try { recWake = await navigator.wakeLock?.request('screen'); } catch { }
      clearInterval(recTick); recTick = setInterval(paint, 1000);
      $s('[data-rgo]').innerHTML = `Stop and log it ${spark}`; $s('[data-rdiscard]').hidden = false; paint();
    };
    const stopRec = () => { if (recWatch != null) navigator.geolocation.clearWatch(recWatch); recWatch = null; try { recWake?.release(); } catch { } recWake = null; clearInterval(recTick); r.running = false; recSave(r); };
    $s('[data-rgo]').onclick = async () => {
      if (!r.running) return startRec();
      stopRec();
      if (r.pts.length < 3) { err.textContent = 'Not enough GPS points were recorded to log a flight.'; return; }
      const draft = await draftFromTrack(r.pts);
      try { localStorage.removeItem(REC); } catch { }
      sheet.close(); setTimeout(() => flightSheet(draft), 50); toast('Check the details, add your debrief and save.');
    };
    $s('[data-rdiscard]').onclick = e => { if (!confirmInline(e.target, 'Discard it?')) return; stopRec(); try { localStorage.removeItem(REC); } catch { } r = { pts: [], startedAt: Date.now(), running: false }; sheet.close(); toast('Recording discarded.'); };
    addEventListener('visibilitychange', async () => { if (r.running && document.visibilityState === 'visible' && !recWake) { try { recWake = await navigator.wakeLock?.request('screen'); } catch { } } });
    if (r.running) { r.running = false; startRec(); } else paint();
  }

  // ---- GPS files from ForeFlight, SkyDemon, Garmin and others: GPX, KML (including gx:Track) and IGC ----
  function parseTrackFile(name, text) {
    const n = name.toLowerCase(), pts = [];
    if (/\.gpx$/.test(n) || /<gpx[\s>]/i.test(text)) {
      for (const m of text.matchAll(/<(trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) { const lat = +(m[2].match(/lat="([^"]+)"/) || [])[1], lng = +(m[2].match(/lon="([^"]+)"/) || [])[1], ele = (m[3].match(/<ele>([^<]+)<\/ele>/) || [])[1], time = (m[3].match(/<time>([^<]+)<\/time>/) || [])[1]; pts.push({ lat, lng, alt: ele != null ? +ele : undefined, t: time ? Date.parse(time) : undefined }); }
    } else if (/\.kml$/.test(n) || /<kml[\s>]/i.test(text)) {
      const when = [...text.matchAll(/<when>([^<]+)<\/when>/g)].map(m => Date.parse(m[1])), gx = [...text.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map(m => m[1].trim().split(/\s+/).map(Number));
      if (gx.length) gx.forEach(([lng, lat, alt], i) => pts.push({ lat, lng, alt, t: when[i] }));
      else for (const m of text.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)) m[1].trim().split(/\s+/).forEach(c => { const [lng, lat, alt] = c.split(',').map(Number); pts.push({ lat, lng, alt }); });
    } else if (/\.igc$/.test(n) || /^B\d{6}\d{7}[NS]\d{8}[EW]/m.test(text)) {
      const d = (text.match(/HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/) || []); const base = d.length ? Date.UTC(2000 + +d[3], +d[2] - 1, +d[1]) : Date.now();
      for (const m of text.matchAll(/^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])[AV](\d{5})(\d{5})/gm)) { const lat = (+m[4] + +m[5] / 60000) * (m[6] === 'S' ? -1 : 1), lng = (+m[7] + +m[8] / 60000) * (m[9] === 'W' ? -1 : 1); pts.push({ lat, lng, alt: +m[11] || +m[10], t: base + ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 }); }
    }
    return pts.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
  }
  async function importTracks(files, box) {
    const out = [];
    for (const f of [...files].slice(0, 12)) {
      try { const pts = parseTrackFile(f.name, await f.text()); if (pts.length < 2) throw new Error('no track points found'); out.push({ name: f.name, draft: await draftFromTrack(pts) }); }
      catch (x) { out.push({ name: f.name, error: x.message }); }
    }
    box.innerHTML = `<div class="trk-list">${out.map((o, i) => o.error ? `<div class="trk bad"><b>${esc(o.name)}</b><small>Couldn’t read it: ${esc(o.error)}</small></div>` : `<div class="trk"><div><b>${esc(o.draft.date)} · ${esc(upper(o.draft.departure) || '?')} → ${esc(upper(o.draft.arrival) || '?')}</b><small>${esc(o.name)} · ${o.draft.points.length} points${o.draft.minutes ? ' · ' + hm(o.draft.minutes) : ''}${o.draft.landings !== '' ? ` · ${o.draft.landings} landing${o.draft.landings === 1 ? '' : 's'}` : ''}</small></div><button type="button" class="btn btn-blue btn-sm" data-trk="${i}">Review and log</button></div>`).join('')}</div><p class="hint">Times and landings are worked out from the track. Check them against your logbook before saving.</p>`;
    box.querySelectorAll('[data-trk]').forEach(b => b.onclick = () => { const d = out[+b.dataset.trk].draft; b.disabled = true; b.textContent = 'Opened'; sheet.close(); setTimeout(() => flightSheet(d), 50); });
  }

  // ---- offline: keep the last desk on this device and queue flights logged without a connection ----
  const OUTBOX = 'boplo-outbox', SNAP = 'boplo-ws';
  const isOffline = x => !navigator.onLine || x instanceof TypeError || x?.name === 'TimeoutError' || x?.name === 'AbortError' || (x?.status === 503 && /reachable/i.test(x?.message || ''));
  function saveSnapshot(ws) { try { const lite = { ...ws, flights: (ws.flights || []).map((f, i) => i < 60 ? f : { ...f, points: (f.points || []).length > 2 ? [f.points[0], f.points[f.points.length - 1]] : f.points }) }; localStorage.setItem(SNAP, JSON.stringify(lite)); } catch { try { localStorage.removeItem(SNAP); } catch { } } }
  const loadSnapshot = () => { try { return JSON.parse(localStorage.getItem(SNAP) || 'null'); } catch { return null; } };
  const outbox = () => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { return []; } };
  const setOutbox = l => { try { localStorage.setItem(OUTBOX, JSON.stringify(l)); } catch { } };
  function queueFlight(data) { const id = 'local-' + Date.now().toString(36); setOutbox([...outbox(), { id, data }]); return { ...data, id, pending: true }; }
  let flushing = false;
  async function flushOutbox() {
    if (flushing || preview || !navigator.onLine) return; const q = outbox(); if (!q.length) return; flushing = true; let done = 0;
    for (const item of q) {
      try { const r = await api('flights', 'POST', item.data); state.flights = [r.flight, ...state.flights.filter(f => f.id !== item.id)]; setOutbox(outbox().filter(x => x.id !== item.id)); done++; }
      catch (x) { if (isOffline(x)) break; if (x.status >= 400 && x.status < 500) { setOutbox(outbox().filter(x2 => x2.id !== item.id)); toast(`A flight saved offline couldn’t be added: ${x.message}`); } }
    }
    flushing = false; if (done) { state.offline = false; render(); toast(`${done} flight${done === 1 ? '' : 's'} logged offline ${done === 1 ? 'is' : 'are'} now saved to your account.`); }
  }
  addEventListener('online', () => { flushOutbox(); if (state.offline) { state.offline = false; start(); } });
  addEventListener('offline', () => { toast('You’re offline. Your desk keeps working, and flights you log are saved when you reconnect.'); });

  // ---- phone notifications (web push) ----
  const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !preview;
  const b64ToU8 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  async function setPush(on) {
    if (!pushOK()) throw new Error('This browser can’t show notifications.');
    if (iOS && !standalone()) throw new Error('On iPhone, add Boplo to your Home Screen first (Share → Add to Home Screen), then turn notifications on from the app.');
    const reg = await navigator.serviceWorker.ready;
    if (!on) { const s = await reg.pushManager.getSubscription(); if (s) { await api('push/subscribe', 'DELETE', { endpoint: s.endpoint }).catch(() => { }); await s.unsubscribe().catch(() => { }); } return false; }
    const perm = await Notification.requestPermission(); if (perm !== 'granted') throw new Error('Notifications are blocked for Boplo. Allow them in your browser or phone settings.');
    const { key } = await api('push/key');
    let s = await reg.pushManager.getSubscription(); if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    await api('push/subscribe', 'POST', { subscription: s.toJSON() });
    await api('push/test', 'POST').catch(() => { });
    return true;
  }
  async function pushState() { if (!pushOK()) return false; try { const reg = await navigator.serviceWorker.getRegistration(); const s = reg && await reg.pushManager.getSubscription(); return !!s && Notification.permission === 'granted'; } catch { return false; } }

  const confirmInline = (b, label) => { if (b.dataset.armed) return true; b.dataset.armed = '1'; const t = b.textContent; b.textContent = label; setTimeout(() => { delete b.dataset.armed; b.textContent = t; }, 3000); return false; };

  /* ---- leaderboards ---- */
  async function boardsPage() {
    const p = state.profile, home = upper(p.airport).split(/[\s·]/)[0];
    const st = ui.cb || (ui.cb = { ap: home, kind: 'short', period: 'week' });
    shell('leaderboards', { title: 'Landing leaderboards', sub: 'Your best simulator landing at each airfield, against everyone else’s. A new daily challenge every day.' }, '<div data-cbx><div class="tile"><p class="hint">Loading…</p></div></div>');
    let d;
    try { d = preview ? { challenge: { date: todayISO(), code: 'LPMA', name: 'Madeira', runway: '05', weather: 'gusty', kind: 'short' }, daily: { rows: [{ rank: 1, score: 93, by: { name: 'Lucía', airfield: 'LEVC' }, aircraft: 'Cessna 172S' }, { rank: 2, score: 88, by: { name: 'Tom', airfield: 'EGTF' }, aircraft: 'PA-28' }], me: null }, local: { rows: [{ rank: 1, score: 86, by: { name: 'Priya', airfield: 'EGHP' }, aircraft: 'PA-28' }], me: null }, mine: [], busy: [{ ap: 'LPMA', pilots: 12, best: 93 }, { ap: 'EGHP', pilots: 4, best: 86 }], week: todayISO() }
      : await cApi(`boards?ap=${encodeURIComponent(st.ap || '')}&kind=${st.kind}&period=${st.period}`); }
    catch (x) { $('[data-cbx]').innerHTML = `<div class="tile empty center"><h3>Leaderboards didn’t load.</h3><p>${esc(x.message)}</p></div>`; return; }
    const ch = d.challenge, WXN = { clear: 'clear skies', fair: 'fair weather', scattered: 'scattered cloud', broken: 'broken cloud', overcast: 'low overcast', hazy: 'haze', gusty: 'a gusty crosswind' };
    const table = (b, empty) => b?.rows?.length ? `<ol class="c-board">${b.rows.map(r => `<li class="${r.me ? 'me' : ''}"><span class="rk">${r.rank}</span>${pilotTag(r.by)}<small>${esc(r.aircraft || '')}</small><b>${r.score}</b></li>`).join('')}</ol>${b.me && b.me.rank > b.rows.length ? `<p class="hint">You’re #${b.me.rank} with ${b.me.score}.</p>` : ''}` : `<p class="hint">${empty}</p>`;
    const KN = { short: 'Short final', long: 'Long final', circuit: 'Circuit' };
    $('[data-cbx]').innerHTML = `<div class="grid">
      <section class="tile dark span-12 c-challenge">${contours('a')}<div><span class="kicker">Daily challenge · ${esc(fmtDate(ch.date, { weekday: 'long', day: 'numeric', month: 'long' }))}</span><h2 class="display">Short final at ${esc(ch.name)}, runway ${esc(ch.runway)}</h2><p>Everyone flies the same approach today in ${esc(WXN[ch.weather] || ch.weather)}. Best landing score wins. ${isAdv() ? '' : 'It counts as one of your two free short finals.'}</p>
        <button class="btn btn-light btn-has-spark" data-flych>Fly today’s challenge ${spark}</button></div>
        <div class="c-today"><h3>Today’s top landings</h3>${table(d.daily, 'No one has flown it yet. Be first.')}${d.daily?.me ? `<p class="hint light">Your best today: ${d.daily.me.score} (#${d.daily.me.rank})</p>` : ''}</div></section>
      <section class="tile span-8"><div class="tile-head"><h2>Airfield board</h2></div>
        <form class="fields c-bform" data-cbform><label class="field"><span>Airfield</span><input name="ap" list="cb-afs" value="${esc(st.ap || '')}" placeholder="Code or name" autocomplete="off"><datalist id="cb-afs"></datalist></label>
          <label class="field"><span>Exercise</span><select name="kind">${Object.entries(KN).map(([k, l]) => `<option value="${k}" ${st.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Period</span><select name="period"><option value="week" ${st.period === 'week' ? 'selected' : ''}>This week</option><option value="all" ${st.period === 'all' ? 'selected' : ''}>All time</option></select></label></form>
        ${st.ap ? table(d.local, `No ${KN[st.kind].toLowerCase()} landings at ${esc(st.ap)} ${st.period === 'week' ? 'this week' : 'yet'}. Fly one from the Simulator’s practice section.`) : '<p class="hint">Choose an airfield.</p>'}
        <p class="footnote">Score out of 100: touchdown rate (40), touchdown point against the aim point (25), centreline (20) and speed (15). Only practice landings in the simulator count.</p></section>
      <aside class="span-4" style="display:grid;gap:16px;align-content:start">
        <section class="tile"><div class="tile-head"><h2>Your bests</h2></div>${d.mine?.length ? `<div class="airports">${d.mine.map(m => `<div><span>${esc(m.ap)} · ${esc(KN[m.kind] || m.kind)}</span><b>${m.best}</b></div>`).join('')}</div>` : '<p class="hint">Land in the simulator’s practice mode and your score is posted here.</p>'}
          <label class="sim-radio-opt" style="margin-top:14px"><input type="checkbox" data-boardson ${p.boardsOff ? '' : 'checked'}><span>Post my practice landings to the leaderboards</span></label></section>
        <section class="tile"><div class="tile-head"><h2>Busiest this week</h2></div>${d.busy?.length ? `<div class="airports">${d.busy.map(b => `<div><button type="button" class="link" data-cbap="${esc(b.ap)}">${esc(b.ap)}</button><b>${b.pilots} pilot${b.pilots === 1 ? '' : 's'} · best ${b.best}</b></div>`).join('')}</div>` : '<p class="hint">Nothing flown yet this week.</p>'}</section>
      </aside></div>`;
    if (window.BoploMap && countryCodeOf(p)) BoploMap.airfields(countryCodeOf(p)).then(list => { const dl = $('#cb-afs'); if (dl) dl.innerHTML = list.filter(a => a.type !== 'W').map(a => `<option value="${esc(a.code)} · ${esc(a.name)}"></option>`).join(''); });
    const f = $('[data-cbform]'); f.onchange = () => { const v = Object.fromEntries(new FormData(f)); st.ap = upper(v.ap).split(/[\s·]/)[0]; st.kind = v.kind; st.period = v.period; boardsPage(); };
    $$('[data-cbap]').forEach(b => b.onclick = () => { st.ap = b.dataset.cbap; st.kind = 'short'; boardsPage(); });
    $('[data-flych]').onclick = () => openPractice(ch.code, ch.runway, 'short', { weather: ch.weather, challenge: true, af: ch });
    $('[data-boardson]').onchange = async e => { try { await saveProfile({ boardsOff: !e.target.checked }); toast(e.target.checked ? 'Your landings will be posted.' : 'Your landings won’t be posted.'); } catch (x) { toast(x.message); } };
  }

  /* ---- students nearby and messages ---- */
  async function studentsPage() {
    const p = state.profile, st = ui.cs || (ui.cs = { chat: null });
    if (st.chat) return chatView(st.chat);
    shell('students', { title: 'Students nearby', sub: 'Find other student pilots at your airfield and nearby: study together, share lifts, swap notes.' }, '<div data-csx><div class="tile"><p class="hint">Loading…</p></div></div>');
    let d, t;
    try { [d, t] = preview ? [{ listed: false, located: true, people: [{ pid: 'a'.repeat(16), name: 'Priya', airfield: 'EGHP', licence: 'PPL(A)', school: 'Popham Flying School', bio: 'Theory exams next month. Happy to quiz each other.', km: 0, sameField: true }, { pid: 'b'.repeat(16), name: 'Tom', airfield: 'EGTF', licence: 'PPL(A)', bio: '', km: 48 }] }, { threads: [] }] : await Promise.all([cApi('people'), cApi('msgs')]); }
    catch (x) { $('[data-csx]').innerHTML = `<div class="tile empty center"><h3>This didn’t load.</h3><p>${esc(x.message)}</p></div>`; return; }
    $('[data-csx]').innerHTML = `<div class="grid">
      <section class="tile span-8"><div class="tile-head"><h2>Near ${esc(upper(p.airport).split(/[\s·]/)[0] || 'you')}</h2><span class="chip">${d.people.length} pilot${d.people.length === 1 ? '' : 's'}</span></div>
        ${d.people.length ? `<div class="c-people">${d.people.map(x => `<div class="c-person"><span class="avatar" aria-hidden="true">${esc(x.name[0])}</span><div><b>${esc(x.name)}</b><small>${esc([x.airfield, x.licence, x.school].filter(Boolean).join(' · '))}${x.km != null ? ` · ${x.sameField ? 'your airfield' : x.km + ' km away'}` : ''}</small>${x.bio ? `<p>${esc(x.bio)}</p>` : ''}</div><button type="button" class="btn btn-line btn-sm" data-msg="${esc(x.pid)}" data-name="${esc(x.name)}">Message</button></div>`).join('')}</div>`
          : `<p class="hint">${d.listed ? 'No other students listed within 250 km yet. Share Boplo with your school.' : 'No one listed nearby yet, or you haven’t joined the directory.'}</p>`}
      </section>
      <aside class="span-4" style="display:grid;gap:16px;align-content:start">
        <section class="tile"><div class="tile-head"><h2>Your listing</h2>${d.listed ? '<span class="chip ok">Visible</span>' : '<span class="chip">Hidden</span>'}</div>
          <form data-dirf class="fields" style="grid-template-columns:1fr"><label class="sim-radio-opt"><input type="checkbox" name="dirOn" ${d.listed ? 'checked' : ''}><span><b>Show me to students nearby</b> They see your first name, home airfield, licence and school, and can message you.</span></label>
            <label class="field"><span>A line about you <i>(optional)</i></span><input name="dirBio" maxlength="160" value="${esc(p.dirBio || '')}" placeholder="e.g. Solo done, studying for air law, flies Saturdays"></label>
            <button class="btn btn-ink btn-sm" style="justify-self:start">Save</button></form>
          ${!p.airport ? '<p class="form-error">Set your home airfield in your profile so nearby pilots can find you.</p>' : ''}</section>
        <section class="tile"><div class="tile-head"><h2>Messages</h2>${t.unread ? `<span class="chip warn">${t.unread} new</span>` : ''}</div>${t.threads.length ? `<div class="c-threads">${t.threads.map(x => `<button type="button" data-thread="${esc(x.with.pid || '')}" data-name="${esc(x.with.name)}" class="${x.unread ? 'unread' : ''}"><b>${esc(x.with.name)} <small>${esc(x.with.airfield || '')}</small></b><span>${x.mine ? 'You: ' : ''}${esc(x.last)}</span><small>${esc(ago(x.at))}</small></button>`).join('')}</div>` : '<p class="hint">No messages yet.</p>'}</section>
      </aside></div>`;
    $$('[data-msg],[data-thread]').forEach(b => b.onclick = () => { const id = b.dataset.msg || b.dataset.thread; if (!id) return; st.chat = { pid: id, name: b.dataset.name }; studentsPage(); });
    $('[data-dirf]').onsubmit = async e => {
      e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)), on = v.dirOn === 'on';
      let lat = p.homeLat, lng = p.homeLng; const af = p.airport ? await anyAirfield(upper(p.airport).split(/[\s·]/)[0]) : null; if (af) { lat = af.lat; lng = af.lng; }
      try { await saveProfile({ dirOn: on, dirBio: v.dirBio, homeLat: lat, homeLng: lng }); toast(on ? 'You’re listed for students nearby.' : 'You’re hidden from the directory.'); studentsPage(); } catch (x) { toast(x.message); }
    };
  }
  async function chatView(c) {
    shell('students', { title: esc(c.name || 'Messages'), actions: '<button class="btn btn-line" data-cback>Back</button>' }, '<div data-chat><div class="tile"><p class="hint">Loading…</p></div></div>');
    $('[data-cback]').onclick = () => { ui.cs.chat = null; studentsPage(); };
    let d; try { d = preview ? { with: { name: c.name }, blocked: false, messages: [] } : await cApi('msgs/' + c.pid); } catch (x) { $('[data-chat]').innerHTML = `<div class="tile empty center"><h3>${esc(x.message)}</h3></div>`; return; }
    $('[data-chat]').innerHTML = `<section class="tile c-chat"><div class="tile-head"><div>${pilotTag(d.with)}</div><button type="button" class="link" data-block>${d.blocked ? 'Unblock' : 'Block'}</button></div>
      <div class="c-msgs" data-msgs>${d.messages.length ? d.messages.map(m => `<div class="c-msg ${m.mine ? 'mine' : ''}"><p>${esc(m.body).replace(/\n/g, '<br>')}</p><small>${esc(ago(m.at))}</small></div>`).join('') : '<p class="hint">Say hello. Keep it friendly; never share passwords or payment details.</p>'}</div>
      ${d.blocked ? '<p class="hint">You’ve blocked this pilot.</p>' : `<form class="c-send" data-send><textarea name="body" rows="2" maxlength="1500" placeholder="Write a message"></textarea><button class="btn btn-blue">${ico('send')}<span class="sr">Send</span></button></form>`}</section>`;
    const box = $('[data-msgs]'); box.scrollTop = box.scrollHeight;
    const f = $('[data-send]'); if (f) { const ta = f.querySelector('textarea'); ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } }; f.onsubmit = async e => { e.preventDefault(); const body = ta.value.trim(); if (!body) return; try { await cApi('msgs/' + c.pid, 'POST', { body }); chatView(c); } catch (x) { toast(x.message); } }; ta.focus(); }
    $('[data-block]').onclick = async e => { if (!d.blocked && !confirmInline(e.target, 'Block them?')) return; try { await cApi('block/' + c.pid, d.blocked ? 'DELETE' : 'POST'); chatView(c); } catch (x) { toast(x.message); } };
  }

  function deleteAccountSheet() {
    const adv = B().plan === 'advanced';
    sheet.innerHTML = `<form data-del novalidate><div class="sheet-head"><h2 class="display" id="sheet-title">Delete your account</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body"><p>This permanently deletes your profile, every flight, your notes and your instructor link. ${adv ? 'Your subscription is cancelled straight away and won’t renew. ' : ''}It can’t be undone.</p><p class="hint">Download your data first if you want to keep it. Stripe keeps payment records that tax law requires.</p>
        <label class="field"><span>Type DELETE to confirm</span><input name="confirm" autocomplete="off" spellcheck="false"></label><p class="form-error" role="alert"></p></div>
      <footer class="sheet-foot"><span></span><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Keep my account</button><button class="btn btn-danger">Delete everything</button></div></footer></form>`;
    sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => sheet.close());
    const f = sheet.querySelector('[data-del]'), err = f.querySelector('.form-error');
    f.onsubmit = async e => { e.preventDefault(); if (f.confirm.value.trim() !== 'DELETE') { err.textContent = 'Type DELETE in capitals to confirm.'; return; } const btn = f.querySelector('.btn-danger:not([data-close])'); btn.disabled = true; try { await api('account/delete', 'POST', { confirm: 'DELETE' }); location.href = '/?deleted=1'; } catch (x) { err.textContent = x.message; btn.disabled = false; } };
    sheet.showModal();
  }
  /* ================= plan and billing ================= */
  const B = () => state.billing || { plan: 'free', status: 'none', trialAvailable: false, trialDays: 0, prices: { monthly: { amount: 1199, currency: 'usd' }, yearly: { amount: 9999, currency: 'usd' } }, limits: { flights: 15, navPlans: 1 }, ready: false };
  const isAdv = () => preview || B().plan === 'advanced';
  const money2 = (cents, cur = 'usd') => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(cents / 100); } catch { return '$' + (cents / 100).toFixed(2); } };
  const longDate = ms => ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  ui.billInterval = ui.billInterval || 'yearly';
  const ADV_FEATURES = [
    ['Ask Boplo, 40 a day', 'Your aviation study assistant, with answers from official sources and your own desk.'],
    ['Unlimited logbook', 'Every flight, debrief and track, with CSV import from other logbooks.'],
    ['Nav logs', 'Unlimited saved plans with headings, times and fuel for every leg.'],
    ['Currency and expiry', 'Medical, rating and recency rules worked out from your logbook.'],
    ['Study and mock exams', 'Practice by subject and timed mock exams with a pass mark.'],
    ['Radio practice', 'Speak your calls and get each element checked.'],
    ['Instructor link', 'A read-only page for your instructor with prep, progress and debriefs.'],
    ['Unlimited simulator practice', 'Take-offs, circuits and approaches at any airfield, and fly your own routes. Free includes two short finals a day.'],
    ['Voice debrief tidy-up', 'Speak your debrief and get it organised into notes.']
  ];
  function paywall(title, text) {
    const b = B();
    return `<section class="tile dark paywall">${contours('b')}
      <span class="kicker">Advanced</span><h2 class="display">${esc(title)}</h2><p>${esc(text)}</p>
      <div class="actions"><a class="btn btn-light btn-has-spark" href="#plan">${b.trialAvailable ? `Start your ${b.trialDays}-day free trial` : 'Upgrade to Advanced'} ${spark}</a><a class="link" href="#plan" style="color:var(--ice)">See what’s included</a></div>
    </section>`;
  }
  function upgradeSheet(message) {
    const b = B();
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Part of Advanced</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body"><p>${esc(message)}</p><ul class="check-list">${ADV_FEATURES.slice(0, 5).map(([t]) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <footer class="sheet-foot"><span class="hint">${b.trialAvailable ? `${b.trialDays} days free, then ${money2(Math.round(b.prices.yearly.amount / 12))} a month, billed yearly.` : ''}</span><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Not now</button><a class="btn btn-blue btn-has-spark" href="#plan">${b.trialAvailable ? 'Start free trial' : 'Upgrade'} ${spark}</a></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => sheet.close());
    sheet.querySelector('a[href="#plan"]').onclick = () => sheet.close();
    sheet.showModal();
  }
  const gateOr = (what, fn) => (...a) => { if (isAdv()) return fn(...a); upgradeSheet(`${what} is part of Advanced.`); };

  function planPage() {
    const b = B(), adv = b.plan === 'advanced' && !preview && b.enforced !== false;
    const iv = ui.billInterval, pr = b.prices[iv], other = b.prices[iv === 'yearly' ? 'monthly' : 'yearly'];
    const save = Math.floor((1 - b.prices.yearly.amount / (b.prices.monthly.amount * 12)) * 100), saveAmt = money2(b.prices.monthly.amount * 12 - b.prices.yearly.amount, b.prices.yearly.currency);
    const statusLine = !adv ? '' : b.status === 'trialing' ? `Free trial until ${longDate(b.trialEnd)}. ${b.cancelAtPeriodEnd ? 'It won’t renew.' : `Then ${money2(b.prices[b.interval || 'yearly'].amount)} ${b.interval === 'monthly' ? 'a month' : 'a year'}.`}`
      : b.cancelAtPeriodEnd ? `Cancelled. You keep Advanced until ${longDate(b.periodEnd)}.` : b.status === 'past_due' ? 'Your last payment didn’t go through. Update your card to keep Advanced.' : `Renews on ${longDate(b.periodEnd)}.`;
    shell('plan', { title: 'Plan & billing', sub: adv ? 'Your subscription and payment details.' : 'Start free. Go Advanced when the hours add up.' },
      `${preview ? '<p class="callout">The example desk shows every Advanced feature. Sign in to see your own plan.</p>' : ''}
      ${!b.ready && !preview ? '<p class="callout warn">Payments are being set up. You can keep using the Free plan in the meantime.</p>' : ''}
      ${adv && b.owner ? `<section class="tile dark plan-now">${contours('a')}
          <div><span class="kicker">Your plan</span><h2 class="display">Advanced · owner</h2><p>Complimentary owner access. It never expires and nothing is billed.</p></div>
        </section>` : adv && b.school && !['active', 'trialing', 'past_due'].includes(b.status) ? `<section class="tile dark plan-now">${contours('a')}
          <div><span class="kicker">Your plan</span><h2 class="display">Advanced · ${esc(b.school.name)}</h2><p>Paid for by your flight school while you’re a member. Nothing is billed to you.</p></div>
          <div class="plan-now-actions"><a class="btn btn-light" href="#school">${b.school.role === 'student' ? 'Your school' : 'School dashboard'}</a></div>
        </section>` : adv ? `<section class="tile dark plan-now">${contours('a')}
          <div><span class="kicker">Your plan</span><h2 class="display">Advanced${b.interval ? ` · ${b.interval === 'monthly' ? 'monthly' : 'yearly'}` : ''}</h2><p>${esc(statusLine)}</p></div>
          <div class="plan-now-actions">
            <button class="btn btn-light" data-portal>Payment method and invoices</button>
            ${b.cancelAtPeriodEnd ? '<button class="btn btn-ghost" data-resume>Keep my subscription</button>' : '<button class="btn btn-ghost" data-cancel>Cancel subscription</button>'}
          </div>
        </section>
        ${b.interval === 'monthly' && !b.cancelAtPeriodEnd && b.status !== 'past_due' ? `<section class="tile plan-upsell"><div><h3>Switch to yearly and save ${saveAmt}</h3><p>${money2(Math.round(b.prices.yearly.amount / 12))} a month instead of ${money2(b.prices.monthly.amount)}, billed ${money2(b.prices.yearly.amount)} once a year.${b.status === 'trialing' ? ' Your free trial carries on.' : ' What’s left of this month is credited.'}</p></div><button class="btn btn-blue" data-toyearly>Switch to yearly</button></section>` : ''}` : `
        <div class="bill-toggle" role="group" aria-label="Billing period">
          <button type="button" data-iv="yearly" aria-pressed="${iv === 'yearly'}">Yearly <span>Save ${save}%</span></button>
          <button type="button" data-iv="monthly" aria-pressed="${iv === 'monthly'}">Monthly</button>
        </div>
        <div class="grid plan-grid">
          <section class="tile span-5 plan-card">
            <h2>Free</h2><p class="plan-price"><b>$0</b><span>forever</span></p>
            <ul class="check-list"><li>Log up to ${b.limits.flights} flights</li><li>Licence goal, progress and milestones</li><li>Lesson preparation</li><li>Live weather at any airport</li><li>Chart map, analytics and cost planner</li><li>Nav log with ${b.limits.navPlans} saved plan</li><li>Simulator replays</li><li>Ask Boplo: 3 questions a day</li><li>Export and print your logbook any time</li></ul>
            <p class="hint">${preview ? '' : 'You’re on Free.'}</p>
          </section>
          <section class="tile dark span-7 plan-card adv">${contours('b')}
            <h2>Advanced</h2>
            <p class="plan-price"><b>${money2(iv === 'yearly' ? Math.round(pr.amount / 12) : pr.amount, pr.currency)}</b><span>${iv === 'yearly' ? `a month, billed ${money2(pr.amount, pr.currency)} yearly` : 'a month'}</span></p>
            <p class="plan-save">${iv === 'yearly' ? `You save ${saveAmt} a year compared with monthly. One payment covers a full year of training.` : `That’s ${money2(pr.amount * 12, pr.currency)} a year. <button type="button" class="link" data-iv="yearly">Switch to yearly and save ${saveAmt}</button>`}</p>
            <ul class="feat-list">${ADV_FEATURES.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul>
            <button class="btn btn-light btn-has-spark" data-checkout ${preview || !b.ready ? 'disabled' : ''}>${b.trialAvailable ? `Start ${b.trialDays}-day free trial` : `Upgrade for ${money2(pr.amount, pr.currency)}`} ${spark}</button>
            <p class="plan-small">${b.trialAvailable ? `Free for ${b.trialDays} days, then ${money2(pr.amount, pr.currency)} ${iv === 'yearly' ? 'a year' : 'a month'}${b.tax ? ' plus any tax' : ''}. Cancel before the trial ends and you won’t be charged.` : `Billed ${iv === 'yearly' ? 'yearly' : 'monthly'}${b.tax ? ', plus any tax' : ''}. Cancel any time.`} <a class="link" href="/refunds.html" target="_blank" style="color:var(--ice)">Refunds</a></p>
          </section>
        </div>`}
      ${!adv && !preview ? `<section class="tile plan-school"><div><h3>Training at a flight school?</h3><p>If your school is on Boplo, join with its code and Advanced is covered. Running a school? One plan covers every student, with a dashboard for your instructors.</p></div><div class="plan-school-actions"><a class="btn btn-line" href="#school">Enter a school code</a><a class="link" href="/schools.html">Plans for schools</a></div></section>` : ''}
      <p class="footnote" style="margin-top:16px">Payments are processed securely by Stripe. Boplo never sees or stores your card number. Prices in US dollars. <a class="link" href="/terms.html" target="_blank">Terms</a> · <a class="link" href="/privacy.html" target="_blank">Privacy</a> · <a class="link" href="/refunds.html" target="_blank">Refunds and cancellation</a></p>`);
    $$('[data-iv]').forEach(x => x.onclick = () => { ui.billInterval = x.dataset.iv; planPage(); });
    const co = $('[data-checkout]'); if (co) co.onclick = () => checkoutSheet(ui.billInterval);
    const pt = $('[data-portal]'); if (pt) pt.onclick = async () => { pt.disabled = true; try { location.href = (await api('billing/portal', 'POST', {})).url; } catch (x) { toast(x.message); pt.disabled = false; } };
    const cn = $('[data-cancel]'); if (cn) cn.onclick = () => confirmCancel();
    const ty = $('[data-toyearly]'); if (ty) ty.onclick = () => confirmYearly(saveAmt);
    const rs = $('[data-resume]'); if (rs) rs.onclick = async () => { rs.disabled = true; try { state.billing = await api('billing/resume', 'POST', {}); toast('Your subscription will continue.'); planPage(); } catch (x) { toast(x.message); rs.disabled = false; } };
  }
  function confirmYearly(saveAmt) {
    const b = B(), yr = money2(b.prices.yearly.amount, b.prices.yearly.currency);
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Switch to yearly?</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body"><p>${b.status === 'trialing' ? `Your free trial carries on until ${longDate(b.trialEnd)}. After that you’re billed ${yr} a year instead of ${money2(b.prices.monthly.amount)} a month.` : `You’re charged ${yr} today, minus a credit for the unused part of this month. After that it renews once a year.`} That saves you ${saveAmt} a year.</p><p class="form-error" role="alert"></p></div>
      <footer class="sheet-foot"><span></span><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Not now</button><button type="button" class="btn btn-blue" data-yes>Switch to yearly</button></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => sheet.close());
    sheet.querySelector('[data-yes]').onclick = async e => { e.target.disabled = true; try { state.billing = await api('billing/switch', 'POST', { interval: 'yearly' }); sheet.close(); toast('You’re on yearly now.'); planPage(); } catch (x) { sheet.querySelector('.form-error').textContent = x.message; e.target.disabled = false; } };
    sheet.showModal();
  }
  function confirmCancel() {
    const b = B();
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Cancel Advanced?</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body"><p>${b.status === 'trialing' ? `Your trial ends on ${longDate(b.trialEnd)} and you won’t be charged.` : `You keep Advanced until ${longDate(b.periodEnd)}, then your desk moves to Free.`} Your flights and notes stay. Anything beyond the Free limits stays readable, and you can export it any time.</p></div>
      <footer class="sheet-foot"><span></span><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Keep Advanced</button><button type="button" class="btn btn-danger" data-yes>Cancel subscription</button></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => sheet.close());
    sheet.querySelector('[data-yes]').onclick = async e => { e.target.disabled = true; try { state.billing = await api('billing/cancel', 'POST', {}); sheet.close(); toast('Cancelled. Nothing more will be charged.'); planPage(); } catch (x) { toast(x.message); e.target.disabled = false; } };
    sheet.showModal();
  }

  /* checkout: Boplo's own sheet, with Stripe's Payment Element for the card or wallet */
  const loadStripe = () => window.Stripe ? Promise.resolve(window.Stripe) : (window.__stripeLib = window.__stripeLib || new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.onload = () => res(window.Stripe); s.onerror = () => { window.__stripeLib = null; rej(new Error('The payment form couldn’t load. Check your connection or ad blocker.')); }; document.head.append(s); }));
  async function checkoutSheet(interval) {
    const b = B(), pr = b.prices[interval], per = interval === 'yearly' ? 'a year' : 'a month', every = interval === 'yearly' ? 'every year' : 'every month';
    let promo = null, stripeJs = null, elements = null, started = null, addr = null, step = b.tax ? 'address' : 'pay';
    const trialNow = () => b.trialAvailable && !promo?.skipTrial;
    const firstAmt = () => promo ? promo.firstAmount : pr.amount;
    sheet.innerHTML = `<form class="checkout" data-pay novalidate>
      <div class="sheet-head"><h2 class="display" id="sheet-title" data-title></h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body">
        <div class="pay-summary" data-sum></div>
        <div class="pay-promo" data-promo><button type="button" class="link" data-promo-open>Have a code?</button></div>
        ${b.tax ? '<div data-addr class="pay-el"></div>' : ''}
        <div data-el class="pay-el"><div class="pay-loading">Loading the secure payment form…</div></div>
        <label class="pay-agree"><input type="checkbox" name="agree" required> <span data-agree></span></label>
        <p class="form-error" role="alert"></p>
      </div>
      <footer class="sheet-foot"><span class="hint pay-lock">${ico('lock')}Secured by Stripe</span><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Cancel</button><button class="btn btn-blue btn-has-spark" data-go disabled><span data-golabel></span> ${spark}</button></div></footer>
    </form>`;
    sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => sheet.close());
    sheet.showModal();
    const form = sheet.querySelector('[data-pay]'), err = sheet.querySelector('.form-error'), go = sheet.querySelector('[data-go]'), q = s2 => sheet.querySelector(s2);
    const paint = () => {
      const t = trialNow(), f = firstAmt();
      q('[data-title]').textContent = t ? 'Start your free trial' : 'Upgrade to Advanced';
      q('[data-sum]').innerHTML = `<div><b>Boplo Flight Advanced</b><small>${interval === 'yearly' ? 'Yearly' : 'Monthly'}${promo ? ` · code ${esc(promo.code)}: ${esc(promo.label)}` : ''}</small></div>
        <div class="r"><b>${t ? `${b.trialDays} days free` : money2(f, pr.currency)}${!t && promo && f !== pr.amount ? ` <s>${money2(pr.amount, pr.currency)}</s>` : ''}</b><small>${t ? `then ${money2(f, pr.currency)}${promo && f !== pr.amount ? ` (then ${money2(pr.amount, pr.currency)})` : ''} ${per}` : (promo && f !== pr.amount ? `today, then ${money2(pr.amount, pr.currency)} ${per}` : per)}${b.tax ? ' + tax' : ''}</small></div>`;
      q('[data-agree]').innerHTML = `I agree to the <a href="/terms.html" target="_blank">Terms</a> and understand that ${t ? `after ${b.trialDays} days I’ll be charged ${money2(f, pr.currency)}` : `I’ll be charged ${money2(f, pr.currency)} today`}${promo && f !== pr.amount ? `, then ${money2(pr.amount, pr.currency)} ${every}` : ` ${every}`} until I cancel. I can cancel any time in Plan &amp; billing. <a href="/refunds.html" target="_blank">Refund policy</a>.`;
      q('[data-golabel]').textContent = step === 'address' ? 'Continue to payment' : t ? 'Start free trial' : `Pay ${money2(f, pr.currency)}`;
    };
    paint();
    const appearance = { theme: 'stripe', variables: { colorPrimary: '#0A62FF', colorText: '#050B1F', colorTextSecondary: '#3E4C6E', colorDanger: '#D93A4A', fontFamily: 'Archivo, system-ui, sans-serif', borderRadius: '12px', spacingUnit: '4px' }, rules: { '.Input': { border: '1px solid rgba(5,11,31,.14)', boxShadow: 'none' }, '.Input:focus': { borderColor: '#0A62FF', boxShadow: '0 0 0 3px rgba(10,98,255,.15)' }, '.Label': { fontWeight: '550' } } };
    const fonts = [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;550;620&display=swap' }];
    // (re)start the subscription on the server and mount the payment form for it
    const begin = async () => {
      go.disabled = true; q('[data-el]').innerHTML = '<div class="pay-loading">Loading the secure payment form…</div>';
      const out = await api('billing/subscribe', 'POST', { interval, address: addr || undefined, promo: promo?.code });
      if (out.active) { sheet.close(); await finishCheckout(); return; }
      started = out;
      elements = stripeJs.elements({ clientSecret: out.clientSecret, appearance, fonts });
      const pe = elements.create('payment', { layout: { type: 'tabs' }, business: { name: 'Boplo' }, terms: { card: 'never' } });
      q('[data-el]').innerHTML = ''; pe.mount(q('[data-el]'));
      pe.on('ready', () => { go.disabled = false; });
    };
    // promotion codes
    q('[data-promo-open]').onclick = () => {
      q('[data-promo]').innerHTML = `<div class="promo-row"><input name="promo" placeholder="Enter your code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" aria-label="Promotion code"><button type="button" class="btn btn-line btn-sm" data-apply>Apply</button></div><small data-pmsg></small>`;
      const inp = q('[name=promo]'), msg = q('[data-pmsg]'); inp.focus();
      const apply = async () => {
        const code = inp.value.trim(); if (!code) return; msg.textContent = 'Checking…'; msg.className = '';
        try {
          promo = await api('billing/promo', 'POST', { code, interval });
          msg.textContent = `${promo.code} applied: ${promo.label}${promo.skipTrial ? ', charged today' : ''}.`; msg.className = 'ok';
          paint(); if (step === 'pay' && stripeJs) await begin();
        } catch (x) { promo = null; msg.textContent = x.message; msg.className = 'bad'; paint(); }
      };
      q('[data-apply]').onclick = apply; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } };
    };
    try {
      const S = await loadStripe(); stripeJs = S(b.publishableKey);
      if (b.tax) {
        // billing address first, so the right tax can be worked out before the subscription starts
        const ae = stripeJs.elements({ appearance, fonts }).create('address', { mode: 'billing', fields: { phone: 'never' } });
        ae.mount(q('[data-addr]'));
        q('[data-el]').innerHTML = '<div class="pay-loading">Enter your billing address, then continue to payment.</div>';
        go.disabled = false;
        form.onsubmit = async e => {
          e.preventDefault(); if (step === 'pay') return pay();
          const v = await ae.getValue(); if (!v.complete) { err.textContent = 'Complete your billing address.'; return; }
          err.textContent = ''; const a2 = v.value.address; addr = { country: a2.country, postal_code: a2.postal_code, line1: a2.line1, city: a2.city, state: a2.state };
          try { step = 'pay'; paint(); await begin(); } catch (x) { step = 'address'; paint(); err.textContent = x.message; go.disabled = false; }
        };
      } else { form.onsubmit = e => { e.preventDefault(); pay(); }; await begin(); }
    } catch (x) { err.textContent = x.message; q('[data-el]').innerHTML = ''; }
    async function pay() {
      err.textContent = '';
      if (!form.agree.checked) { err.textContent = 'Tick the box to agree to the terms.'; return; }
      if (!started) return;
      go.disabled = true; q('[data-golabel]').textContent = 'Confirming…';
      const confirmParams = { return_url: `${location.origin}/flight-app.html#plan` };
      const r = started.mode === 'setup' ? await stripeJs.confirmSetup({ elements, confirmParams, redirect: 'if_required' }) : await stripeJs.confirmPayment({ elements, confirmParams, redirect: 'if_required' });
      if (r.error) { err.textContent = r.error.message || 'The payment didn’t go through.'; go.disabled = false; paint(); return; }
      await finishCheckout();
    }
  }
  async function finishCheckout() {
    for (let i = 0; i < 8; i++) {
      try { state.billing = await api('billing/sync', 'POST', {}); } catch { }
      if (B().plan === 'advanced') break;
      await new Promise(r => setTimeout(r, 1500));
    }
    if (sheet.open) sheet.close();
    if (B().plan === 'advanced') { toast(B().status === 'trialing' ? 'Your free trial has started. Enjoy Advanced.' : 'Welcome to Advanced.'); location.hash = '#plan'; render(); }
    else toast('Payment received. Your plan will update in a moment.');
  }

  /* ================= Ask Boplo ================= */
  const askKey = () => 'boplo-ask-' + (state.user?.id || state.user?.email || 'me');
  const askLoad = () => { if (preview) return ASK_SAMPLE.map(m => ({ ...m })); try { return JSON.parse(localStorage.getItem(askKey()) || '[]'); } catch { return []; } };
  const askSave = list => { if (preview) return; try { localStorage.setItem(askKey(), JSON.stringify(list.slice(-40))); } catch { } };
  const ASK_SAMPLE = [
    { role: 'user', content: 'Why does the aircraft stall even when the airspeed looks fine?' },
    { role: 'assistant', content: 'A wing stalls when it goes past its **critical angle of attack**, not at a particular airspeed. Airspeed is only a rough guide because the stall speed changes with load.\n\n- **In a turn or pull-up** the wing has to make more lift, so it needs a higher angle of attack. At 60° of bank the load factor is 2, and the stall speed rises by about 41%.\n- **Heavier aircraft** stall at a higher indicated speed.\n- **Flaps** lower the stall speed.\n\nSo you can stall at a "safe-looking" speed if you load the wing up, for example by pulling hard in a steep turn. The fix is always the same: reduce the angle of attack first.\n\nSources: PHAK (Aerodynamics of Flight), AFH (Maintaining Aircraft Control)' }
  ];
  function askContext() {
    const p = state.profile || {}, fl = sorted(), mins = sum(fl, f => f.minutes) + (p.openingMinutes || 0);
    const byRole = r => hrs(sum(fl.filter(f => f.role === r), f => f.minutes));
    const lines = [
      `First name: ${String(p.name || '').split(/\s+/)[0] || 'unknown'}`,
      `Training: ${[p.licence, p.authority].filter(Boolean).join(' with ')} (licensing system: ${regimeOf(p)}, country: ${p.country || '—'})`,
      p.airport ? `Home airfield: ${p.airport}` : '', p.aircraft ? `Aircraft: ${[p.aircraft, p.registration].filter(Boolean).join(' ')}` : '', p.school ? `School: ${p.school}` : '',
      `Logged: ${fl.length} flights, ${hrs(mins)} h total (dual ${byRole('dual')} h, solo ${byRole('solo')} h, PIC ${byRole('pic')} h), ${sum(fl, f => f.landings)} landings${p.openingMinutes ? `, including ${hrs(p.openingMinutes)} h from before Boplo` : ''}`,
      p.goalHours ? `Hours goal: ${p.goalHours}` : '', p.target ? `Target date: ${p.target}` : '',
      p.nextLesson ? `Next lesson: ${p.nextLesson}${p.lessonDate ? ` on ${p.lessonDate}` : ''}` : '',
      parseChecks(p.checklist).length ? `Preparation checklist: ${parseChecks(p.checklist).map(c => `${c.done ? '[done]' : '[to do]'} ${c.text}`).join('; ')}` : '',
      p.questions ? `Questions for the instructor: ${String(p.questions).replace(/\n+/g, '; ')}` : '',
      p.topics ? `Theory to revisit: ${p.topics}` : ''
    ];
    try { const { s, st } = syllabusState(p); const d = s.items.filter(i => st[i.id] === 'd').length, inp = s.items.filter(i => st[i.id] === 'p'); lines.push(`Syllabus (${s.title}): ${d} of ${s.items.length} done${inp.length ? `; in progress: ${inp.map(i => `${i.id} ${i.name}`).join(', ')}` : ''}`); } catch { }
    try { const due = nextDue(); if (due) lines.push(`Next expiry: ${due.title} ${due.d < 0 ? 'expired' : `in ${due.d} days`}`); } catch { }
    const recent = fl.slice(0, 5).map(f => `- ${f.date} ${upper(f.departure)}→${upper(f.arrival)}, ${roleName(f.role)}, ${hm(f.minutes)}${f.lesson ? `, ${f.lesson}` : ''}${f.notes ? `. Debrief: ${String(f.notes).replace(/\s+/g, ' ').slice(0, 220)}` : ''}`);
    if (recent.length) lines.push('Recent flights:\n' + recent.join('\n'));
    return lines.filter(Boolean).join('\n').slice(0, 3400);
  }
  // small, safe markdown: escape first, then a few inline and block rules
  function md(text, sources = {}) {
    const inline = s => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    const out = []; let list = null;
    const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; } };
    for (const raw of String(text).split('\n')) {
      const line = raw.trimEnd();
      const src = line.match(/^\s*\**sources?\**:\**\s*(.+)$/i);
      if (src) {
        flush();
        const chips = src[1].split(/[,;]\s*(?![^()]*\))/).map(x => x.trim().replace(/\.$/, '')).filter(Boolean).map(x => { const key = Object.keys(sources).sort((a, b) => b.length - a.length).find(k => x.toUpperCase().startsWith(k.toUpperCase())); const s2 = key && sources[key]; return s2 ? `<a class="src" href="${esc(s2.url)}" target="_blank" rel="noopener" title="${esc(s2.title)}">${esc(x)}</a>` : `<span class="src">${esc(x)}</span>`; });
        out.push(`<div class="srcs"><span>Sources</span>${chips.join('')}</div>`); continue;
      }
      const ul = line.match(/^\s*[-•*]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/), h = line.match(/^#{1,4}\s+(.*)$/);
      if (ul || ol) { const t = ul ? 'ul' : 'ol'; if (!list || list.t !== t) { flush(); list = { t, items: [] }; } list.items.push((ul || ol)[1]); continue; }
      flush();
      if (h) out.push(`<p class="h">${inline(h[1])}</p>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    flush(); return out.join('');
  }
  // one streamed request to /flight/ask; calls onText with the text so far, resolves with the final text
  async function streamAsk(body, onText) {
    const res = await fetch('/flight/ask', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok || !(res.headers.get('Content-Type') || '').includes('event-stream')) {
      const out = await res.json().catch(() => ({}));
      if (res.status === 402) upgradeSheet(out.error || 'Ask Boplo has more questions on Advanced.');
      throw new Error(out.error || 'Boplo couldn’t answer just now. Try again in a moment.');
    }
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '', text = '', err = null, last = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.t) text += ev.t;
        if (ev.error) err = ev.error;
        if (ev.done && askUsageInfo) { askUsageInfo.left = ev.left ?? askUsageInfo.left; }
      }
      if (performance.now() - last > 60) { last = performance.now(); onText?.(text); }
    }
    onText?.(text);
    if (err && !text) throw new Error(err);
    if (!text) throw new Error('Boplo didn’t answer. Try asking again.');
    return text;
  }
  const askOnce = (q, onText) => streamAsk({ messages: [{ role: 'user', content: q }], context: askContext() }, onText);

  const EXAM_FOCUS = [['all', 'Whole oral'], ['airspace', 'Airspace and rules'], ['weather', 'Weather'], ['performance', 'Performance and planning'], ['systems', 'Aircraft systems'], ['emergencies', 'Emergencies'], ['navigation', 'Navigation'], ['human', 'Human factors']];
  const examStore = (k, v) => { const key = askKey() + '-' + k; try { if (v === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(v)); } catch { } return null; };
  const scoreOf = t => { const m = String(t || '').match(/Score:\s*\**\s*(\d{1,3})\s*\/\s*100/i); return m ? Math.min(100, Number(m[1])) : null; };
  const resultOf = t => (String(t || '').match(/Result:\s*\**\s*([^\n*]+)/i) || [])[1]?.trim() || '';
  const TTS = 'speechSynthesis' in window;
  const speakable = t => String(t).replace(/^##.*$/gm, '').replace(/^\s*sources?:.*$/gim, '').replace(/[*_`#>]/g, '').replace(/\n+/g, ' ').trim();
  ui.askMode = ui.askMode || (() => { try { return localStorage.getItem('boplo-ask-mode') || 'chat'; } catch { return 'chat'; } })();
  let askBusy = false, askSources = null, askUsageInfo = null;
  async function askPage() {
    const p = state.profile, first = String(p.name || '').split(/\s+/)[0], exam = ui.askMode === 'exam';
    let msgs = exam ? (preview ? [] : examStore('exam') || []) : askLoad();
    const setup = { focus: 'all', style: 'friendly', questions: 10, voice: false, ...(examStore('exam-setup') || {}) };
    const history = examStore('exam-history') || [];
    const debriefed = exam && msgs.some(m => m.role === 'assistant' && scoreOf(m.content) != null);
    const sugg = [
      p.nextLesson ? `Help me prepare for ${p.nextLesson}` : 'What should I prepare before my next lesson?',
      'Quiz me on air law, one question at a time',
      'Decode this METAR: EGLL 211650Z 27016KT 9999 FEW041 10/04 Q1006',
      'Why does an aircraft stall?',
      state.flights.some(f => f.notes) ? 'Look at my recent debriefs. What should I work on?' : 'How do I make a good radio call in the circuit?',
      regimeOf(p) === 'faa' ? 'What are the VFR weather minimums in Class E airspace?' : 'What are the VMC minima in class G airspace?'
    ];
    const modeToggle = `<div class="bill-toggle ask-modes" role="group" aria-label="Mode"><button type="button" data-mode="chat" aria-pressed="${!exam}">Ask</button><button type="button" data-mode="exam" aria-pressed="${exam}">Mock checkride${isAdv() ? '' : ` ${ico('lock')}`}</button></div>`;
    const gated = exam && !isAdv();
    shell('ask', { title: 'Ask Boplo', sub: exam ? 'Practise your oral exam with an AI examiner that asks, pushes back and scores you.' : 'Your aviation study assistant. It knows your desk and answers from official sources.', actions: `${modeToggle}${gated ? '' : `<button class="btn btn-line" data-newchat>${exam ? 'New checkride' : 'New chat'}</button>`}` },
      gated ? paywall('Rehearse your checkride out loud.', 'An AI examiner runs a realistic oral exam for your licence, asks follow-ups when an answer is thin, and gives you a scored debrief with what to study next. Speak your answers or type them.')
      : `<div class="ask${exam ? ' exam' : ''}">
        <div class="ask-log" data-log aria-live="polite"></div>
        <form class="ask-bar" data-askform ${exam && (!msgs.length || debriefed) ? 'hidden' : ''}>
          <textarea name="q" rows="1" maxlength="2000" placeholder="${preview ? 'Sign in to ask your own questions' : exam ? 'Answer the examiner…' : 'Ask about theory, rules, weather, radio, or your training…'}" ${preview ? 'disabled' : ''} aria-label="${exam ? 'Your answer' : 'Your question'}"></textarea>
          ${SR ? `<button type="button" class="icon-btn ask-mic" data-askmic aria-label="Speak" ${preview ? 'disabled' : ''}><svg class="ico" aria-hidden="true"><use href="#i-mic"/></svg></button>` : ''}
          <button class="btn btn-blue ask-send" data-send ${preview ? 'disabled' : ''} aria-label="Send">${ico('send')}</button>
        </form>
        ${exam && msgs.length && !debriefed ? `<div class="exam-bar"><span data-qn></span>${TTS ? `<label class="switch"><input type="checkbox" data-voice ${setup.voice ? 'checked' : ''}><span></span>Voice</label>` : ''}<button type="button" class="btn btn-ink btn-sm" data-end>End and get my debrief</button></div>` : ''}
        <p class="ask-foot"><span data-left></span>${exam ? 'Practice only. A real examiner and your instructor decide when you’re ready.' : 'Boplo can make mistakes. It’s a study aid, not a flight briefing or your instructor. Check anything important with them and official sources.'}</p>
      </div>`);
    $$('[data-mode]').forEach(b => b.onclick = () => { if (askBusy) return; ui.askMode = b.dataset.mode; try { localStorage.setItem('boplo-ask-mode', ui.askMode); } catch { } window.speechSynthesis?.cancel(); askPage(); });
    if (gated) return;
    const log = $('[data-log]'), form = $('[data-askform]'), ta = form.q;
    const save = () => exam ? (!preview && examStore('exam', msgs.filter(m => !m.error && !m.pending).slice(-60))) : askSave(msgs.filter(m => !m.error));
    const empty = () => exam ? `<section class="tile dark ask-hello exam-setup">${contours('b')}<div class="ask-mark"><svg aria-hidden="true"><use href="#spark"/></svg></div>
        <h2 class="display">Mock checkride</h2><p>A practice oral exam for ${esc(licenceOf(p))} under ${esc(regimeOf(p) === 'faa' ? 'the FAA ACS' : regimeOf(p) === 'uk' ? 'UK CAA rules' : regimeOf(p) === 'easa' ? 'EASA rules' : 'your authority’s rules')}. The examiner sets a scenario, asks one question at a time and follows up like the real thing.</p>
        <div class="exam-opts">
          <div><span>Focus</span><div class="ask-sugg">${EXAM_FOCUS.map(([k, t]) => `<button type="button" data-focus="${k}" aria-pressed="${setup.focus === k}">${esc(t)}</button>`).join('')}</div></div>
          <div class="exam-row"><div><span>Examiner</span><div class="ask-sugg">${[['friendly', 'Friendly'], ['strict', 'Strict']].map(([k, t]) => `<button type="button" data-style="${k}" aria-pressed="${setup.style === k}">${t}</button>`).join('')}</div></div>
          <div><span>Length</span><div class="ask-sugg">${[8, 12, 16].map(n => `<button type="button" data-len="${n}" aria-pressed="${setup.questions === n}">${n} questions</button>`).join('')}</div></div>
          ${TTS ? `<div><span>Voice</span><div class="ask-sugg"><button type="button" data-voiceopt aria-pressed="${setup.voice}">${setup.voice ? 'On: examiner speaks, you answer out loud' : 'Off: read and type'}</button></div></div>` : ''}</div>
        </div>
        <button class="btn btn-light btn-has-spark" data-begin ${preview ? 'disabled' : ''}>Start the checkride ${spark}</button>
        ${history.length ? `<div class="exam-hist"><span>Recent scores</span>${history.slice(-5).reverse().map(h => `<b class="${h.s >= 75 ? 'pass' : h.s >= 60 ? 'mid' : 'fail'}" title="${esc(fmtDate(h.d))} · ${esc(h.f)}">${h.s}</b>`).join('')}</div>` : ''}
      </section>`
      : `<section class="tile dark ask-hello">${contours('b')}<div class="ask-mark"><svg aria-hidden="true"><use href="#spark"/></svg></div><h2 class="display">${first ? `Hi ${esc(first)}.` : 'Hi.'} What are we studying today?</h2><p>Ask anything about flying theory, rules, weather, radio or your own training. Boplo cites official sources and knows your desk.</p><div class="ask-sugg">${sugg.map(x => `<button type="button" data-sugg>${esc(x)}</button>`).join('')}</div></section>`;
    const bubble = (m, i) => {
      if (m.role === 'user' && m.start) return `<div class="exam-start">${esc(m.label || 'Checkride started')}</div>`;
      if (m.role === 'user') return `<div class="amsg mine"><div>${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
      const sc = exam && !m.pending ? scoreOf(m.content) : null;
      return `<div class="amsg bo" data-i="${i}"><span class="bo-av" aria-hidden="true"><svg><use href="#spark"/></svg></span><div class="bo-body">${sc != null ? `<div class="exam-score ${sc >= 75 ? 'pass' : sc >= 60 ? 'mid' : 'fail'}"><b>${sc}<small>/100</small></b><span>${esc(resultOf(m.content) || 'Debrief')}</span></div>` : ''}${m.error ? `<p class="form-error">${esc(m.error)}</p>` : md(String(m.content).replace(/^##\s*Debrief\s*$/im, '').replace(/^Score:.*$/im, '').replace(/^Result:.*$/im, ''), askSources || {})}${m.content && !m.pending ? `<div class="bo-tools"><button type="button" class="link" data-copy="${i}">Copy</button>${exam && TTS && sc == null ? `<button type="button" class="link" data-say="${i}">Read aloud</button>` : ''}</div>` : ''}${m.pending && !m.content ? '<span class="typing"><i></i><i></i><i></i></span>' : ''}</div></div>`;
    };
    const paint = (scroll = true) => {
      log.innerHTML = msgs.length ? msgs.map(bubble).join('') + (exam && debriefed ? `<div class="exam-again"><button class="btn btn-blue btn-has-spark" data-again>Start another checkride ${spark}</button><a class="btn btn-line" href="#study">Practise in Study</a></div>` : '') : empty();
      $$('[data-sugg]').forEach(b => b.onclick = () => { ta.value = b.textContent; send(); });
      $$('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(msgs[+b.dataset.copy].content); b.textContent = 'Copied'; } catch { } });
      $$('[data-say]').forEach(b => b.onclick = () => say(msgs[+b.dataset.say].content, false));
      $$('[data-focus]').forEach(b => b.onclick = () => { setup.focus = b.dataset.focus; examStore('exam-setup', setup); paint(false); });
      $$('[data-style]').forEach(b => b.onclick = () => { setup.style = b.dataset.style; examStore('exam-setup', setup); paint(false); });
      $$('[data-len]').forEach(b => b.onclick = () => { setup.questions = Number(b.dataset.len); examStore('exam-setup', setup); paint(false); });
      $$('[data-voiceopt]').forEach(b => b.onclick = () => { setup.voice = !setup.voice; examStore('exam-setup', setup); paint(false); });
      const bg = $('[data-begin]'); if (bg) bg.onclick = () => { const f = EXAM_FOCUS.find(x => x[0] === setup.focus)[1]; msgs = [{ role: 'user', start: true, label: `Checkride started · ${f} · ${setup.style === 'strict' ? 'strict' : 'friendly'} examiner · ${setup.questions} questions`, content: 'Begin the mock checkride now: set the scenario and ask your first question.' }]; save(); askPage(); };
      const ag = $('[data-again]'); if (ag) ag.onclick = () => { msgs = []; save(); askPage(); };
      const qn = $('[data-qn]'); if (qn) { const n = msgs.filter(m => m.role === 'assistant' && m.content).length; qn.textContent = `Question ${Math.min(n, setup.questions)} of about ${setup.questions}`; }
      if (scroll) log.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    };
    const left = () => { const u = askUsageInfo, el = $('[data-left]'); if (el) el.textContent = preview ? 'Example conversation. ' : u ? (u.on === false ? 'Ask Boplo is offline right now. ' : `${u.left} of ${u.limit} ${exam ? 'turns' : 'questions'} left today. `) : ''; };
    paint(false); left();
    if (!preview && !askSources) api('ask/usage').then(r => { askSources = r.sources; askUsageInfo = r; left(); paint(false); }).catch(() => { });
    else if (preview && !askSources) { askSources = { PHAK: { title: 'FAA Pilot’s Handbook of Aeronautical Knowledge', url: 'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak' }, AFH: { title: 'FAA Airplane Flying Handbook', url: 'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/airplane_handbook' } }; paint(false); }
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; };
    ta.oninput = grow;
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
    form.onsubmit = e => { e.preventDefault(); send(); };
    const nc = $('[data-newchat]'); if (nc) nc.onclick = () => { if (askBusy) return; window.speechSynthesis?.cancel(); msgs = []; save(); if (exam) askPage(); else { paint(); ta.focus(); } };
    const vt = $('[data-voice]'); if (vt) vt.onchange = () => { setup.voice = vt.checked; examStore('exam-setup', setup); if (!vt.checked) speechSynthesis.cancel(); };
    const mic = $('[data-askmic]'); let rec = null;
    const listen = (auto = false) => {
      if (!SR || rec) return; rec = new SR(); rec.lang = navigator.language || 'en-GB'; rec.interimResults = true;
      const base = ta.value ? ta.value.trim() + ' ' : ''; let heard = '';
      rec.onresult = e => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; heard = t; ta.value = base + t; grow(); };
      rec.onend = () => { rec = null; mic?.classList.remove('live'); if (auto && heard.trim() && document.body.contains(ta)) send(); };
      rec.onerror = () => { };
      try { rec.start(); mic?.classList.add('live'); } catch { rec = null; }
    };
    if (mic && SR) mic.onclick = () => { if (rec) { rec.stop(); return; } window.speechSynthesis?.cancel(); listen(exam && setup.voice); };
    function say(text, thenListen) {
      if (!TTS) return; speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(speakable(text)); u.lang = regimeOf(p) === 'faa' ? 'en-US' : 'en-GB'; u.rate = 1.02;
      if (thenListen && SR) u.onend = () => { if (document.body.contains(ta) && ui.askMode === 'exam') listen(true); };
      speechSynthesis.speak(u);
    }
    const de = $('[data-end]'); if (de) de.onclick = () => { if (askBusy) return; ta.value = '[END] Please stop here and give me my debrief.'; send(); };
    async function send() {
      if (preview || askBusy) return;
      const q = ta.value.trim(); if (!q && !(exam && msgs.length === 1)) return;
      ta.value = ''; grow(); askBusy = true; window.speechSynthesis?.cancel();
      if (q) msgs.push({ role: 'user', content: q });
      const bot = { role: 'assistant', content: '', pending: true }; msgs.push(bot); paint();
      const hist = msgs.filter(m => !m.pending && !m.error).map(m => ({ role: m.role, content: m.content }));
      try {
        await streamAsk({ messages: hist, context: askContext(), ...(exam ? { mode: 'examiner', setup } : {}) }, t => { bot.content = t; const el = log.querySelector(`[data-i="${msgs.length - 1}"] .bo-body`); if (el) { el.innerHTML = md(t, askSources || {}); log.lastElementChild?.scrollIntoView({ block: 'end' }); } });
      } catch (x) { bot.error = x.message; }
      left();
      bot.pending = false; if (bot.error && !bot.content) { msgs.pop(); msgs.push({ role: 'assistant', content: '', error: bot.error }); }
      askBusy = false; save();
      const sc = exam ? scoreOf(bot.content) : null;
      if (sc != null) { const f = EXAM_FOCUS.find(x => x[0] === setup.focus)?.[1] || ''; examStore('exam-history', [...history, { d: todayISO(), s: sc, f }].slice(-20)); askPage(); return; }
      paint();
      if (bot.error && !bot.content && q) ta.value = q;
      if (exam && setup.voice && bot.content) say(bot.content, true);
    }
    if (exam && msgs.length === 1 && msgs[0].start) send();
    if (!exam && ui.askPrefill) { ta.value = ui.askPrefill; ui.askPrefill = null; send(); }
  }

  /* ================= more (mobile) ================= */
  function morePage() {
    const items = [['profile', 'Profile', 'Licence, aircraft, rates and your data', 'profile'], ['plan', 'Plan & billing', isAdv() ? 'Your plan, renewal and invoices' : 'Upgrade to Advanced', 'plan'], ['school', 'Flight school', SCH() ? SCH().name : 'Join your school with its code, or set up your school', 'school']];
    shell('more', { title: 'Account', sub: state.user?.email ? `Signed in as ${esc(state.user.email)}` : '' }, `<div class="more-grid">${items.map(([id, t, d, ic]) => `<a class="tile more-item" href="#${id}">${ico(ic)}<span><b>${t}</b><small>${esc(d)}</small></span></a>`).join('')}${B().owner && !preview ? `<a class="tile more-item" href="/owner.html">${ico('analytics')}<span><b>Owner analytics</b><small>Visits, sign-ups, plans and revenue</small></span></a>` : ''}</div>
      <div class="acct-links"><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="/refunds.html">Refunds</a><a href="mailto:support@boplo.app">Contact support</a><button type="button" class="link" data-logout>${preview ? 'Leave example desk' : 'Sign out'}</button></div>`);
    $$('[data-logout]').forEach(b => b.onclick = logout);
  }


  /* ================= voice debrief ================= */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function wireDebrief(form) {
    const ta = form.querySelector('[name=notes]'), mic = form.querySelector('[data-mic]'), tidy = form.querySelector('[data-tidy]'), out = form.querySelector('[data-tidied]');
    let rec = null, base = '';
    if (mic) {
      if (!SR) { mic.title = 'Voice notes need Chrome, Edge or Safari.'; mic.disabled = true; mic.classList.add('off'); }
      else mic.onclick = () => {
        if (rec) { rec.stop(); return; }
        rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-GB'; base = ta.value ? ta.value.trim() + ' ' : '';
        rec.onresult = e => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; ta.value = base + t.trim(); };
        rec.onend = () => { rec = null; mic.classList.remove('live'); mic.querySelector('span').textContent = 'Speak your debrief'; };
        rec.onerror = () => { rec = null; mic.classList.remove('live'); };
        rec.start(); mic.classList.add('live'); mic.querySelector('span').textContent = 'Listening… tap to stop';
      };
    }
    if (tidy && !isAdv()) tidy.onclick = () => upgradeSheet('Tidying your debrief is part of Advanced.');
    else if (tidy) tidy.onclick = async () => {
      const err = form.querySelector('.form-error'); err.textContent = '';
      tidy.disabled = true; tidy.textContent = 'Tidying…';
      try {
        const lesson = form.querySelector('[name=lesson]')?.value || '';
        const r = preview ? { summary: 'Navigation went well overall; the reservoir turn was late.', wentWell: ['Radio calls were clear', 'Held altitude well on the first leg'], workOn: ['Start timing turns from overhead, not abeam'], nextPrep: ['Re-plan the reservoir leg timing'], questions: ['When should I divert if a turn point is late?'] } : await api('debrief', 'POST', { transcript: ta.value, lesson });
        const block = (t, l) => l.length ? `${t}\n${l.map(x => '• ' + x).join('\n')}` : '';
        const text = [r.summary, block('Went well:', r.wentWell), block('Work on:', r.workOn), block('Prepare next time:', r.nextPrep), block('Ask my instructor:', r.questions)].filter(Boolean).join('\n\n');
        out.innerHTML = `<div class="tidied"><pre>${esc(text)}</pre><div class="actions"><span class="hint">Only what you said, tidied up.</span><div class="right"><button type="button" class="btn btn-line btn-sm" data-discard>Keep my original</button><button type="button" class="btn btn-ink btn-sm" data-use>Use this${r.nextPrep.length || r.questions.length ? ' and add to next lesson' : ''}</button></div></div></div>`;
        out.querySelector('[data-discard]').onclick = () => { out.innerHTML = ''; };
        out.querySelector('[data-use]').onclick = async () => {
          ta.value = text; out.innerHTML = '';
          if (r.nextPrep.length || r.questions.length) {
            const p = state.profile, checks = parseChecks(p.checklist).concat(r.nextPrep.map(t => ({ done: false, text: t })));
            const qs = [String(p.questions || '').trim(), ...r.questions].filter(Boolean).join('\n');
            try { await saveProfile({ checklist: writeChecks(checks), questions: qs.slice(0, 3000) }); toast('Added to your next lesson.'); } catch { }
          }
        };
      } catch (x) { err.textContent = x.message; }
      tidy.disabled = false; tidy.textContent = 'Tidy with Boplo';
    };
  }

  /* ---------------- flight sheet ---------------- */
  function flightSheet(f = {}) {
    const p = state.profile, editing = !!f.id;
    const role = f.role || 'dual';
    const coords = (f.points || []).map(x => `${x.lat},${x.lng}`).join('\n');
    sheet.innerHTML = `<form method="dialog" novalidate data-sheet>
      <header class="sheet-head"><h2 id="sheet-title" class="display">${editing ? 'Flight record' : 'Log a flight'}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></header>
      <div class="sheet-body">${editing ? debriefBlock(f) : ''}
        ${!editing && !f.points?.length ? '<button type="button" class="rec-cta" data-record><span class="rec-dot"></span><span><b>About to fly? Record it with GPS</b><small>Boplo fills in the times, landings and track for you.</small></span></button>' : ''}${!editing && f.routeKind === 'track' && f.points?.length ? `<p class="callout">From your GPS track: ${f.points.length} points${f.minutes ? `, ${hm(f.minutes)}` : ''}${f.landings !== '' && f.landings != null ? `, ${f.landings} landing${f.landings === 1 ? '' : 's'}` : ''}. Check the times and add your debrief.</p>` : ''}
        <div class="group"><h3>The flight</h3><div class="fields">
          ${input('Date', 'date', f.date || todayISO(), 'date', `required max="${todayISO()}"`)}
          ${duration('Flight time', 'minutes', f.minutes ?? '', true)}
          ${input('From', 'departure', f.departure || upper(p.airport).split(/[\s·]/)[0] || '', 'text', 'required maxlength="100" placeholder="ICAO code, e.g. EGHP" list="af-list" autocomplete="off"')}
          ${input('To', 'arrival', f.arrival || '', 'text', 'required maxlength="100" placeholder="ICAO code" list="af-list" autocomplete="off"')}
          <datalist id="af-list"></datalist>
          ${input('Aircraft', 'aircraft', f.aircraft ?? p.aircraft ?? '', 'text', 'maxlength="100"', true)}
          ${input('Registration', 'registration', f.registration ?? p.registration ?? '', 'text', 'maxlength="100"', true)}
        </div></div>
        <div class="group"><h3>Your role</h3>
          <div class="segmented" role="radiogroup" aria-label="Your role">${['dual', 'solo', 'pic'].map(r => `<label><input type="radio" name="role" value="${r}" ${role === r ? 'checked' : ''}><span>${roleLong(r)}</span></label>`).join('')}</div>
          <div class="fields">
            ${input('Landings', 'landings', f.landings ?? 1, 'number', 'required min="0" max="100" step="1" inputmode="numeric"')}
            ${input('Of which at night', 'nightLandings', f.nightLandings ?? 0, 'number', 'min="0" max="100" step="1" inputmode="numeric"', true)}
            ${input('Instructor', 'instructor', f.instructor || '', 'text', 'maxlength="100"', true)}
          </div>
        </div>
        <div class="group"><h3>Lesson and debrief</h3><div class="fields">
          <label class="field full"><span>Lesson or exercise <i>(optional)</i></span><input name="lesson" value="${esc(f.lesson || (editing ? '' : p.nextLesson || ''))}" maxlength="100"></label>
          ${input('Debrief notes', 'notes', f.notes || '', 'textarea', 'placeholder="What went well, what to work on next time"', true)}
          ${input('One thing that clicked today', 'win', f.win || '', 'text', 'maxlength="200" placeholder="e.g. My first properly held-off landing"', true)}
          <div class="debrief-tools full" style="grid-column:1/-1"><button type="button" class="btn btn-line btn-sm mic" data-mic><svg class="ico" aria-hidden="true"><use href="#i-mic"/></svg><span>Speak your debrief</span></button><button type="button" class="btn btn-ink btn-sm" data-tidy>Tidy with Boplo</button><span class="hint">Talk it through after the flight, then tidy it into notes.</span></div>
          <div class="full" style="grid-column:1/-1" data-tidied></div>
        </div></div>
        <div class="group"><h3>Cost <span class="hint" style="font-weight:400">optional</span></h3><div class="fields">
          ${input(`What this flight cost (${esc(currencyOf(p))})`, 'cost', f.cost ?? '', 'number', `min="0" max="100000" step="0.01" inputmode="decimal" placeholder="${Number(p.rateAircraft || 0) ? 'Leave blank to estimate from your rates' : 'e.g. 210'}"`)}
        </div></div>
        <details class="more" ${coords ? 'open' : ''}><summary>Route on the map <span class="hint" style="margin-left:auto;margin-right:12px" data-route-hint>${coords ? `${(f.points || []).length} points` : 'optional'}</span></summary>
          <div class="plot-cta"><button type="button" class="btn btn-ink btn-has-spark" data-plot>${ico('map')} Plot on the map ${spark}</button><span class="hint">Or leave it: picking known airfields for From and To draws a start-to-end line for you.</span></div>
          <div class="fields">
            <label class="field full"><span>Coordinates</span><textarea name="coordinates" placeholder="51.1939,-1.2347&#10;50.7800,-1.8425" spellcheck="false">${esc(coords)}</textarea><small>One latitude,longitude pair per line. Two points draw a dashed start-to-end line; many points draw your track.</small></label>
            ${select('These points are', 'routeKind', [['route', 'A route I plotted'], ['endpoints', 'Start and end points'], ['track', 'A recorded track']], f.routeKind || 'endpoints')}
          </div>
        </details>
        <p class="form-error" role="alert"></p>
      </div>
      <footer class="sheet-foot">
        ${editing ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-danger" data-delete>Delete flight</button>${f.points?.length || upper(f.departure) ? '<button type="button" class="btn btn-line" data-simthis>Fly it again</button>' : ''}</div>` : `<span class="hint">${preview ? 'Example desk: not saved.' : ''}</span>`}
        <div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Cancel</button><button class="btn btn-blue btn-has-spark" type="submit">${editing ? 'Save changes' : 'Save flight'} ${spark}</button></div>
      </footer>
    </form>`;
    const form = sheet.querySelector('form'), err = sheet.querySelector('.form-error');
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => sheet.close());
    sheet.onclick = e => { if (e.target === sheet) sheet.close(); };
    sheet.showModal();
    wireDebrief(form);
    const simB = sheet.querySelector('[data-simthis]'); if (simB) simB.onclick = () => { sheet.close(); openSim(f, 'replay'); };
    const cc = countryCodeOf(p);
    let afList = [];
    if (window.BoploMap && cc) BoploMap.airfields(cc).then(list => { afList = list; const dl = sheet.querySelector('#af-list'); if (dl) dl.innerHTML = list.slice(0, 6000).map(a => `<option value="${esc(a.code)}">${esc(a.name)}${a.city ? ' · ' + esc(a.city) : ''}</option>`).join(''); });
    const plotBtn = sheet.querySelector('[data-plot]');
    if (plotBtn) plotBtn.onclick = () => {
      if (!window.BoploMap) return;
      const dlg = document.getElementById('plot'), ta = form.querySelector('[name=coordinates]');
      const cur = ta.value.trim() ? ta.value.trim().split(/\n+/).map(l => l.split(/[,\s]+/).map(Number)).filter(x => x.length === 2 && x.every(Number.isFinite)).map(([lat, lng]) => ({ lat, lng })) : [];
      dlg.showModal();
      BoploMap.mountPlotter(dlg, {
        country: cc, home: upper(p.airport).split(/[\s·]/)[0], points: cur, from: form.departure.value, to: form.arrival.value,
        onCancel: () => dlg.close(),
        onDone: ({ points, from, to }) => {
          dlg.close();
          ta.value = points.map(x => `${x.lat},${x.lng}`).join('\n');
          if (points.length > 1) form.routeKind.value = 'route';
          if (from) form.departure.value = from;
          if (to) form.arrival.value = to;
          const h = sheet.querySelector('[data-route-hint]'); if (h) h.textContent = points.length ? `${points.length} points` : 'optional';
        }
      });
    };
    form.onsubmit = async e => {
      e.preventDefault(); err.textContent = '';
      const btn = form.querySelector('[type=submit]');
      try {
        const v = Object.fromEntries(new FormData(form));
        const minutes = readDuration(form, 'minutes');
        if (!v.date) throw new Error('Choose the date you flew.');
        if (v.date > todayISO()) throw new Error('Log completed flights only.');
        if (!v.departure.trim() || !v.arrival.trim()) throw new Error('Enter where you flew from and to.');
        if (!minutes || minutes < 1 || minutes > 1440) throw new Error('Enter the flight time in hours and minutes.');
        const points = v.coordinates.trim() ? v.coordinates.trim().split(/\n+/).map((line, i) => {
          const parts = line.split(/[,\s]+/).filter(Boolean); const [lat, lng] = parts.map(Number);
          if (parts.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error(`Check route line ${i + 1}: use latitude,longitude.`);
          return { lat, lng };
        }) : [];
        let kind = v.routeKind;
        if (!points.length && afList.length && window.BoploMap) {
          const a = BoploMap.findAirfield(afList, v.departure), b = BoploMap.findAirfield(afList, v.arrival);
          if (a && b && a.code !== b.code) { points.push({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }); kind = 'endpoints'; }
        }
        const data = { cost: v.cost === '' ? null : Number(v.cost), date: v.date, minutes, departure: v.departure.trim(), arrival: v.arrival.trim(), aircraft: v.aircraft, registration: v.registration, role: v.role || 'dual', landings: Number(v.landings || 0), nightLandings: Math.min(Number(v.nightLandings || 0), Number(v.landings || 0)), instructor: v.instructor, lesson: v.lesson, notes: v.notes, points, routeKind: kind };
        data.win = String(v.win || '').trim().slice(0, 200);
        btn.disabled = true; const msBefore = new Set(milestones().map(m => m.title));
        let saved, queued = false;
        try { saved = preview ? { flight: { ...data, id: f.id || 'demo-' + Math.random().toString(36).slice(2) } } : await api(editing ? 'flights/' + f.id : 'flights', editing ? 'PUT' : 'POST', data); }
        catch (x) { if (!editing && isOffline(x)) { saved = { flight: queueFlight(data) }; queued = true; } else throw x; }
        state.flights = [saved.flight, ...state.flights.filter(x => x.id !== saved.flight.id)];
        sheet.close(); render(); toast(queued ? 'You’re offline: the flight is saved on this device and goes to your account when you reconnect.' : editing ? 'Flight updated.' : 'Flight saved.');
        if (!editing) { const fresh = milestones().filter(m => !msBefore.has(m.title) && m.title !== 'First flight logged'); if (fresh.length) setTimeout(() => celebrate(fresh.sort((a, b) => (b.title === 'First solo') - (a.title === 'First solo'))[0]), 700); }
      } catch (x) { err.textContent = x.message; btn.disabled = false; err.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); }
    };
    sheet.querySelectorAll('[data-record]').forEach(b => b.onclick = () => { sheet.close(); setTimeout(recorderSheet, 50); });
    const del = sheet.querySelector('[data-delete]');
    if (del) del.onclick = async () => {
      if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Delete for good'; return; }
      del.disabled = true;
      try { if (!preview) await api('flights/' + f.id, 'DELETE'); state.flights = state.flights.filter(x => x.id !== f.id); sheet.close(); render(); toast('Flight deleted.'); }
      catch (x) { err.textContent = x.message; del.disabled = false; }
    };
  }

  /* ================= flight schools ================= */
  const SCH = () => state.school || null;
  const isStaffSch = () => ['admin', 'instructor'].includes(SCH()?.role);
  ui.schoolMeta = { trialDays: 0, plans: { school: { label: 'School', amount: 99900, currency: 'usd', seats: 25, staff: 10 }, school_plus: { label: 'School Plus', amount: 199900, currency: 'usd', seats: 75, staff: 25 } } };
  ui.schoolPlan = 'school'; ui.rosterFilter = 'all';
  function addSchoolNav() {
    if (!isStaffSch() || HUBS.some(h => h[0] === 'school')) return;
    PAGES.push(['school', 'My school', 'school']);
    HUBS.push(['school', 'My school', 'school', ['school'], 'School']);
  }
  const money0 = (cents, cur = 'usd') => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100); } catch { return '$' + Math.round(cents / 100); } };
  const daysSince = s => s ? -daysUntil(s) : null;
  // a page that works before the person has set up their own training desk (school owners, instructors)
  function schoolFrame(head, body) {
    if (state.profile?.complete) return shell('school', head, body);
    document.title = `${head.title.replace(/<[^>]+>/g, '')} · Boplo Flight`;
    root.innerHTML = `<div class="solo-shell"><header class="solo-top">${brand('/')}<div class="solo-acct">${state.user?.email ? `<span>${esc(state.user.email)}</span>` : ''}<button type="button" class="btn btn-line btn-sm" data-logout>${preview ? 'Leave example' : 'Sign out'}</button></div></header>
      <main class="solo-main"><div class="page">${preview ? `<div class="preview-bar"><span><b>Example school.</b> Sample students; nothing is saved.</span><a class="btn btn-light btn-sm" href="/schools.html">Back to school plans</a></div>` : ''}<header class="page-head"><div><h1 class="display">${head.title}</h1>${head.sub ? `<p>${head.sub}</p>` : ''}</div>${head.actions ? `<div class="head-actions">${head.actions}</div>` : ''}</header>${body}
      <p class="footnote" style="margin-top:32px">Learning to fly yourself? <a class="link" href="#overview">Set up your own flight desk</a>.</p></div></main></div>`;
    $$('[data-logout]').forEach(b => b.onclick = logout);
  }
  async function refreshSchool() {
    if (preview) return;
    try { const r = await api('school'); state.school = r.school; ui.schoolMeta = { trialDays: r.trialDays, plans: r.plans }; addSchoolNav(); } catch { }
  }
  function schoolPage() {
    if (!ui.schoolLoaded) { ui.schoolLoaded = true; refreshSchool().then(() => { if (current() === 'school') schoolPage(); }); }
    const s = SCH();
    if (!s) return schoolSetup();
    if (s.role === 'student') return schoolStudent();
    return schoolDash();
  }
  const planCards = sel => { const m = ui.schoolMeta; return `<div class="sch-plans" role="radiogroup" aria-label="School plan">${Object.entries(m.plans).map(([k, p]) => `<label class="sch-plan${sel === k ? ' on' : ''}"><input type="radio" name="plan" value="${k}" ${sel === k ? 'checked' : ''}><b>${esc(p.label)}</b><span class="sch-price">${money0(p.amount, p.currency)}<small> a year</small></span><span>Up to ${p.seats} students and ${p.staff} instructors</span></label>`).join('')}</div>
    <p class="hint">${m.trialDays ? `${m.trialDays} days free, then billed yearly. Cancel before the trial ends and you won’t be charged.` : 'Billed yearly. Cancel any time.'} More than 75 students? <a class="link" href="/schools.html#contact">Ask us for a quote</a>.</p>`; };
  function setupForm(name = '') {
    return `<form class="sch-setup" data-setup novalidate>${input('School name', 'name', name, 'text', 'maxlength="80" autocomplete="organization" required placeholder="e.g. Popham Flying School"')}
      ${planCards(ui.schoolPlan)}
      <p class="form-error" role="alert"></p>
      <button class="btn btn-blue btn-has-spark" ${preview ? 'disabled' : ''}>Continue to payment ${spark}</button>
      <p class="footnote">You’ll pay on Stripe’s secure checkout page. You can add your company’s tax ID there.</p></form>`;
  }
  function wireSetup() {
    const f = $('[data-setup]'); if (!f) return;
    f.querySelectorAll('[name=plan]').forEach(r => r.onchange = () => { ui.schoolPlan = r.value; f.querySelectorAll('.sch-plan').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); });
    f.onsubmit = async e => {
      e.preventDefault(); const err = f.querySelector('.form-error'), btn = f.querySelector('button'); err.textContent = '';
      const name = f.querySelector('[name=name]').value.trim(); if (name.length < 2) { err.textContent = 'Enter your school’s name.'; return; }
      btn.disabled = true; btn.textContent = 'Opening checkout…';
      try { location.href = (await api('school/create', 'POST', { name, plan: ui.schoolPlan })).url; } catch (x) { err.textContent = x.message; btn.disabled = false; btn.innerHTML = `Continue to payment ${spark}`; }
    };
  }
  function schoolSetup() {
    schoolFrame({ title: 'Flight school', sub: 'Join your school with its code, or set Boplo up for your whole school.' },
      `<div class="grid">
        <section class="tile span-5"><div class="tile-head"><h2>Join your school</h2></div>
          <p class="hint" style="margin-bottom:14px">Your school gives you a code. Joining gives you Advanced, paid for by your school.</p>
          <form class="sch-join" data-joinform>${input('School code', 'code', '', 'text', 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="e.g. K7PX4M2Q"')}<p class="form-error" role="alert"></p><button class="btn btn-line">Join school</button></form>
        </section>
        <section class="tile span-7"><div class="tile-head"><h2>Set up your school</h2></div>
          <p class="hint" style="margin-bottom:14px">One yearly plan covers every student and instructor. Instructors get a dashboard of each student’s hours, progress and next lesson.</p>
          ${setupForm()}
        </section>
      </div>`);
    const jf = $('[data-joinform]'); jf.onsubmit = e => { e.preventDefault(); const c = jf.querySelector('[name=code]').value.trim(); if (!c) { jf.querySelector('.form-error').textContent = 'Enter the code your school gave you.'; return; } joinSheet(c); };
    wireSetup();
  }
  const SHARED = 'your name and email, flights and hours, lesson notes and debriefs, syllabus progress, exam dates and scores, and your next lesson. They can debrief your flights, set your next lesson and sign off syllabus lessons, but they can’t change your flights or notes';
  function schoolStudent() {
    const s = SCH();
    schoolFrame({ title: esc(s.name), sub: 'Your flight school on Boplo.' },
      `<section class="tile dark plan-now">${contours('a')}<div><span class="kicker">${s.active ? 'Covered by your school' : 'Plan not active'}</span><h2 class="display">${s.active ? 'Advanced, paid for by ' + esc(s.name) : esc(s.name) + '’s plan has lapsed'}</h2><p>${s.active ? 'Everything in Advanced is unlocked while you’re a member.' : 'You’re on Free until your school renews. Your records are all still here.'}</p></div></section>
      ${s.active ? `<section class="tile" style="margin-top:16px" aria-labelledby="cob-h"><div class="tile-head"><h2 id="cob-h">You and your instructors</h2></div><p class="hint" style="margin-bottom:12px">Debriefs, lesson plans and sign-offs from ${esc(s.name)} land here. Message your instructors any time.</p><div data-cobox><p class="hint">Loading…</p></div></section>` : ''}
      <section class="tile" style="margin-top:16px"><div class="tile-head"><h2>What your instructors can see</h2></div>
        <p>While you’re a member, ${esc(s.name)}’s instructors can see ${SHARED}.</p>
        <p class="hint" style="margin-top:10px">Leaving stops sharing straight away. You keep all your records, and your desk moves to Free unless you have your own plan.</p>
        <button type="button" class="btn btn-line" data-leave style="margin-top:14px">Leave ${esc(s.name)}</button></section>`);
    if (s.active) studentCoach();
    $('[data-leave]').onclick = () => {
      sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Leave ${esc(s.name)}?</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
        <div class="sheet-body"><p>Your instructors will stop seeing your training. Your desk moves to Free unless you have your own plan. You can rejoin later with the school’s code.</p><p class="form-error" role="alert"></p></div>
        <footer class="sheet-foot"><span></span><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Stay</button><button type="button" class="btn btn-danger" data-yes>Leave school</button></div></footer>`;
      sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => sheet.close());
      sheet.querySelector('[data-yes]').onclick = async e => { e.target.disabled = true; try { if (!preview) { state.school = (await api('school/leave', 'POST', {})).school; state.billing = await api('billing'); } sheet.close(); toast(`You’ve left ${s.name}.`); render(); } catch (x) { sheet.querySelector('.form-error').textContent = x.message; e.target.disabled = false; } };
      sheet.showModal();
    };
  }
  async function joinSheet(code) {
    let info;
    try { info = preview ? { name: 'Popham Flying School', role: 'student', active: true } : await api('school/lookup', 'POST', { code }); } catch (x) { toast(x.message); return; }
    const staff = info.role === 'instructor';
    sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Join ${esc(info.name)}${staff ? ' as an instructor' : ''}?</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      <div class="sheet-body">${staff ? `<p>You’ll see the school’s students on Boplo: their hours, progress and next lessons. Your own desk gets Advanced, paid for by ${esc(info.name)}.</p>` : `<p>You get Boplo Advanced, paid for by ${esc(info.name)}.</p><p class="callout" style="margin-top:12px">${esc(info.name)}’s instructors will be able to see ${SHARED}. You can leave the school at any time.</p>`}
      ${info.active ? '' : `<p class="callout warn" style="margin-top:12px">${esc(info.name)}’s plan isn’t active right now, so you can’t join yet.</p>`}<p class="form-error" role="alert"></p></div>
      <footer class="sheet-foot"><span></span><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Not now</button><button type="button" class="btn btn-blue" data-yes ${info.active ? '' : 'disabled'}>Join school</button></div></footer>`;
    sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => sheet.close());
    sheet.querySelector('[data-yes]').onclick = async e => {
      e.target.disabled = true;
      try { if (!preview) { state.school = (await api('school/join', 'POST', { code })).school; state.billing = await api('billing'); addSchoolNav(); } sheet.close(); toast(`Welcome to ${info.name}.`); if (state.profile?.complete || staff) { location.hash = '#school'; render(); } }
      catch (x) { sheet.querySelector('.form-error').textContent = x.message; e.target.disabled = false; }
    };
    sheet.showModal();
  }
  // per-student signals the roster sorts and flags on
  function rosterRow(m) {
    const reg = regimeOf(m), lic = R.licence(reg, m.licence), goal = m.goalHours || lic?.minHours || (reg === 'faa' ? 40 : 45);
    let syl = null; try { const S = R.syllabusFor(reg), st = readJSON(m.syllabus)[S.id] || {}; syl = Math.round(S.items.filter(i => st[i.id] === 'd').length / S.items.length * 100); } catch { }
    const quiet = m.lastFlight ? daysSince(m.lastFlight) : null;
    const flag = m.role !== 'student' ? '' : !m.setup ? 'Hasn’t set up Boplo yet' : !m.flights ? (daysSince(new Date(m.joinedAt).toISOString().slice(0, 10)) > 7 ? 'No flights logged yet' : '') : quiet > 21 ? `Hasn’t flown in ${quiet} days` : '';
    const waiting = m.role === 'student' && ((m.unread || 0) + (m.toDebrief || 0)) > 0;
    return { ...m, goal, goalPct: Math.min(100, Math.round(m.minutes / 60 / goal * 100)), syl, quiet, flag, waiting };
  }
  const lastFlew = r => r.lastFlight ? (r.quiet <= 0 ? 'Today' : r.quiet === 1 ? 'Yesterday' : `${r.quiet} days ago`) : '—';
  async function loadRoster(force) {
    if (preview) { ui.roster = demoRoster(); return; }
    if (!force && ui.roster && Date.now() - ui.rosterAt < 60000) return;
    try { ui.roster = (await api('school/roster')).members; ui.rosterAt = Date.now(); ui.rosterErr = ''; } catch (x) { ui.rosterErr = x.message; ui.roster = ui.roster || null; }
  }
  function schoolDash() {
    const s = SCH(), admin = s.role === 'admin';
    if (!s.active) {
      schoolFrame({ title: esc(s.name), sub: admin ? 'Finish setting up your school’s plan.' : 'Your school on Boplo.' },
        admin ? `<section class="tile"><div class="tile-head"><h2>${s.status === 'canceled' ? 'Renew your school plan' : 'Choose your school plan'}</h2></div>${setupForm(s.name)}</section>` : `<p class="callout warn">${esc(s.name)}’s Boplo plan isn’t active, so the student dashboard is closed. Ask the person who manages the plan to renew it.</p>`);
      wireSetup(); return;
    }
    if (!ui.roster || ui.rosterAt < Date.now() - 60000) { if (!ui.rosterLoading) { ui.rosterLoading = true; loadRoster().finally(() => { ui.rosterLoading = false; if (current() === 'school') schoolDash(); }); } }
    const rows = (ui.roster || []).map(rosterRow), students = rows.filter(r => r.role === 'student'), staff = rows.filter(r => r.role !== 'student');
    const active14 = students.filter(r => r.quiet != null && r.quiet <= 14).length, flagged = students.filter(r => r.flag), hours30 = students.reduce((n, r) => n + r.recentMinutes, 0), waiting = students.filter(r => r.waiting), nMsg = students.reduce((n, r) => n + (r.unread || 0), 0), nDeb = students.reduce((n, r) => n + (r.toDebrief || 0), 0);
    const f = ui.rosterFilter, list = (f === 'staff' ? staff : f === 'attention' ? flagged : f === 'waiting' ? waiting : students).slice().sort((a, b) => f === 'staff' ? a.name.localeCompare(b.name) : (!!b.waiting - !!a.waiting) || (!!b.flag - !!a.flag) || ((b.quiet ?? 9999) - (a.quiet ?? 9999)));
    const status = !admin ? '' : s.status === 'trialing' ? `Free trial until ${longDate(s.trialEnd)}. ${s.cancelAtPeriodEnd ? 'It won’t renew.' : `Then ${money0(s.amount, s.currency)} a year.`}` : s.cancelAtPeriodEnd ? `Cancelled. Your school keeps Boplo until ${longDate(s.periodEnd)}.` : s.status === 'past_due' ? 'The last payment didn’t go through. Update the card to keep your school on Boplo.' : `Renews on ${longDate(s.periodEnd)}.`;
    schoolFrame({ title: esc(s.name), sub: `${esc(s.planLabel)} plan${status ? ' · ' + esc(status) : ''}`, actions: admin ? `<button class="btn btn-line" data-rename>Rename</button><button class="btn btn-line" data-billing ${preview ? 'disabled' : ''}>Billing and invoices</button>` : '' },
      `${s.status === 'past_due' && admin ? '<p class="callout warn" style="margin-bottom:16px">Payment failed. Update the card under Billing and invoices so your students keep Advanced.</p>' : ''}
      <section class="stats" aria-label="School at a glance" style="margin-bottom:16px">
        <div class="stat"><span>Students</span><b>${s.students}<small>of ${s.seats}</small></b><em>${s.staff} instructor${s.staff === 1 ? '' : 's'}</em></div>
        <div class="stat"><span>Flew in the last 14 days</span><b>${active14}</b><em>${students.length ? Math.round(active14 / students.length * 100) + '% of students' : 'No students yet'}</em></div>
        <div class="stat"><span>Need a nudge</span><b>${flagged.length}</b><em>Quiet 3+ weeks, or not started</em></div>
        <div class="stat"><span>Hours, last 30 days</span><b>${hrs(hours30)}<small>h</small></b><em>Logged by your students</em></div>
      </section>
      ${waiting.length ? `<button type="button" class="co-waiting" data-rf="waiting">${ico('ask')}<span><b>Waiting on you</b> ${[nMsg && `${nMsg} message${nMsg === 1 ? '' : 's'} from students`, nDeb && `${nDeb} dual flight${nDeb === 1 ? '' : 's'} to debrief`].filter(Boolean).join(' · ')}</span><em>Show them</em></button>` : ''}
      <div class="grid">
        <section class="tile span-12 sch-invite" aria-label="Invite" ${students.length ? 'style="order:2"' : ''}>
          <div class="sch-inv-col"><h2>Invite students</h2><p class="hint">Students join with this code or link and get Advanced straight away. They see exactly what’s shared before they join, and can leave any time.</p>
            <div class="sch-code" aria-label="Student code">${esc(s.studentCode || '')}</div>
            <div class="sch-code-actions"><button type="button" class="btn btn-blue btn-sm" data-copy="${esc(s.studentLink || '')}">Copy student link</button>${navigator.share ? `<button type="button" class="btn btn-line btn-sm" data-share="${esc(s.studentLink || '')}">Share</button>` : ''}${admin ? '<button type="button" class="btn btn-line btn-sm" data-newcode="student">New code</button>' : ''}</div></div>
          <div class="sch-inv-col"><h2>Invite instructors</h2><p class="hint">Instructors see this dashboard and get Advanced for their own flying. Keep this code for your team.</p>
            <div class="sch-code small" aria-label="Instructor code">${esc(s.staffCode || '')}</div>
            <div class="sch-code-actions"><button type="button" class="btn btn-line btn-sm" data-copy="${esc(s.staffLink || '')}">Copy instructor link</button>${admin ? '<button type="button" class="btn btn-line btn-sm" data-newcode="staff">New code</button>' : ''}</div></div>
        </section>
        <section class="tile span-12 sch-roster" aria-labelledby="ro-h">
          <div class="tile-head"><h2 id="ro-h">Students</h2><div class="filter" role="group" aria-label="Show">${[['all', `All ${students.length}`], ['waiting', `Waiting on you ${waiting.length}`], ['attention', `Need a nudge ${flagged.length}`], ['staff', `Instructors ${staff.length}`]].map(([v, l]) => `<button data-rf="${v}" aria-pressed="${f === v}">${l}</button>`).join('')}</div></div>
          ${ui.rosterErr ? `<p class="callout warn">${esc(ui.rosterErr)}</p>` : !ui.roster ? '<p class="hint">Loading your students…</p>' : !list.length ? `<div class="empty center"><h3>${f === 'attention' ? 'Everyone’s flying.' : f === 'waiting' ? 'You’re all caught up.' : f === 'staff' ? 'No other instructors yet.' : 'No students yet.'}</h3><p>${f === 'waiting' ? 'No unread messages, and every recent dual flight has a debrief.' : f === 'attention' ? 'Nobody has gone quiet for more than three weeks.' : f === 'staff' ? 'Share the instructor code with your team.' : 'Share your student code or link, and students appear here as they join.'}</p></div>` : f === 'staff'
            ? `<div class="airports">${list.map(r => `<div><span>${esc(r.name)}${r.role === 'admin' ? ' <i class="hint">manages the plan</i>' : ''}</span><b>${esc(r.email)}</b></div>`).join('')}</div>`
            : `<div class="table-wrap flat"><table><thead><tr><th>Student</th><th class="r">Hours</th><th>Last flew</th><th>Syllabus</th><th>Hours goal</th><th>Next lesson</th></tr></thead><tbody>${list.map(r => `<tr data-student="${esc(r.id)}" tabindex="0" aria-label="Open ${esc(r.name)}">
                <td><b>${esc(r.name)}</b>${r.flag ? `<small class="sch-flag">${esc(r.flag)}</small>` : `<small>${esc([r.licence, r.authority].filter(Boolean).join(' · '))}</small>`}${r.waiting ? `<span class="co-badges">${r.unread ? `<i class="co-dot">${r.unread} new message${r.unread === 1 ? '' : 's'}</i>` : ''}${r.toDebrief ? `<i class="co-dot soft">${r.toDebrief} to debrief</i>` : ''}</span>` : ''}</td>
                <td class="r"><b>${hrs(r.minutes)}</b><small>${hrs(r.soloMinutes)} solo</small></td>
                <td>${lastFlew(r)}</td>
                <td>${r.syl == null ? '—' : `<span class="sch-mini" role="img" aria-label="${r.syl}% of syllabus done"><i style="width:${r.syl}%"></i></span><small>${r.syl}%</small>`}</td>
                <td><span class="sch-mini" role="img" aria-label="${r.goalPct}% of ${r.goal} hours"><i style="width:${r.goalPct}%"></i></span><small>${r.goalPct}% of ${r.goal} h</small></td>
                <td>${r.nextLesson ? `${esc(r.nextLesson)}${r.lessonDate ? `<small>${esc(fmtDate(r.lessonDate))}</small>` : ''}` : '—'}</td></tr>`).join('')}</tbody></table></div>
              <div class="cards">${list.map(r => `<button class="card" data-student="${esc(r.id)}"><span class="froute"><b>${esc(r.name)}</b><small>${r.waiting ? [r.unread && `${r.unread} new message${r.unread === 1 ? '' : 's'}`, r.toDebrief && `${r.toDebrief} to debrief`].filter(Boolean).join(' · ') : r.flag ? esc(r.flag) : `Last flew ${lastFlew(r).toLowerCase()} · ${r.goalPct}% of ${r.goal} h`}</small></span><span class="ftime">${hrs(r.minutes)} h</span></button>`).join('')}</div>`}
        </section>
        </section>
      </div>`);
    $$('[data-rf]').forEach(b => b.onclick = () => { ui.rosterFilter = b.dataset.rf; schoolDash(); });
    $$('[data-student]').forEach(el => { el.onclick = () => studentSheet(el.dataset.student); el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } }; });
    $$('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied.'); } catch { toast(b.dataset.copy); } });
    $$('[data-share]').forEach(b => b.onclick = () => navigator.share({ title: `Join ${s.name} on Boplo`, text: `Join ${s.name} on Boplo Flight. Your school covers Advanced.`, url: b.dataset.share }).catch(() => { }));
    $$('[data-newcode]').forEach(b => b.onclick = async () => {
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'The old code stops working. Confirm?'; return; }
      b.disabled = true; try { if (!preview) state.school = (await api('school/codes', 'POST', { which: b.dataset.newcode })).school; toast('New code ready. The old one no longer works.'); schoolDash(); } catch (x) { toast(x.message); b.disabled = false; }
    });
    const bl = $('[data-billing]'); if (bl) bl.onclick = async () => { bl.disabled = true; try { location.href = (await api('school/portal', 'POST', {})).url; } catch (x) { toast(x.message); bl.disabled = false; } };
    const rn = $('[data-rename]'); if (rn) rn.onclick = () => {
      sheet.innerHTML = `<div class="sheet-head"><h2 class="display" id="sheet-title">Rename your school</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
        <form class="sheet-body" data-rn>${input('School name', 'name', s.name, 'text', 'maxlength="80" required')}<p class="form-error" role="alert"></p></form>
        <footer class="sheet-foot"><span></span><div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Cancel</button><button type="button" class="btn btn-blue" data-yes>Save</button></div></footer>`;
      sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => sheet.close());
      const go = async () => { const name = sheet.querySelector('[name=name]').value.trim(); try { state.school = preview ? { ...s, name } : (await api('school/rename', 'POST', { name })).school; sheet.close(); schoolDash(); } catch (x) { sheet.querySelector('.form-error').textContent = x.message; } };
      sheet.querySelector('[data-yes]').onclick = go; sheet.querySelector('[data-rn]').onsubmit = e => { e.preventDefault(); go(); };
      sheet.showModal();
    };
  }
  /* ---------------- coaching: shared pieces ---------------- */
  const RATING = { 'needs-work': 'Needs more work', 'on-track': 'On track', great: 'Really good' };
  const coAgo = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(new Date(t).toISOString().slice(0, 10), { day: 'numeric', month: 'short' }); };
  const flLabel = f => f ? `${fmtDate(f.date, { day: 'numeric', month: 'short' })} · ${upper(f.departure)} → ${upper(f.arrival)}` : 'a flight';
  // one note in the thread; `mine` decides which side a message sits on
  function coItem(it, { flights = [], mine = false } = {}) {
    const who = `<span class="co-who">${esc(it.author || (it.fromStaff ? 'Instructor' : 'Student'))} · ${esc(coAgo(it.at))}</span>`;
    if (it.kind === 'msg') return `<div class="co-msg${mine ? ' me' : ''}">${who}<p>${esc(it.text)}</p></div>`;
    if (it.kind === 'debrief') { const f = flights.find(x => x.id === it.flightId); return `<div class="co-card">${who}<h4>${ico('logbook')}Debrief for ${esc(flLabel(f))}</h4><span class="chip co-r-${esc(it.rating)}">${esc(RATING[it.rating] || '')}</span>${it.wentWell ? `<p><b>Went well.</b> ${esc(it.wentWell)}</p>` : ''}${it.workOn ? `<p><b>Work on.</b> ${esc(it.workOn)}</p>` : ''}${it.note ? `<p>${esc(it.note)}</p>` : ''}</div>`; }
    if (it.kind === 'plan') return `<div class="co-card">${who}<h4>${ico('prepare')}Next lesson: ${esc(it.lesson)}</h4>${it.date ? `<span class="chip">${esc(fmtDate(it.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>` : ''}${it.prep?.length ? `<ul class="co-prep">${it.prep.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${it.note ? `<p>${esc(it.note)}</p>` : ''}</div>`;
    if (it.kind === 'signoff') return `<div class="co-card co-slim">${who}<h4>${ico('check')}${it.status === 'd' ? 'Signed off' : it.status === 'p' ? 'Marked in progress' : 'Reopened'}: ${esc(it.itemName || 'syllabus lesson')}</h4>${it.note ? `<p>${esc(it.note)}</p>` : ''}</div>`;
    return '';
  }
  const coThread = (items, opts) => items.length ? `<div class="co-thread">${items.slice().sort((a, b) => a.at - b.at).map(it => coItem(it, { ...opts, mine: opts.staff ? it.fromStaff : !it.fromStaff })).join('')}</div>` : `<p class="hint">${opts.staff ? 'Nothing here yet. Debrief a flight, set the next lesson or send a message, and the student sees it in their desk.' : 'Nothing from your instructors yet. Send them a message, or they’ll debrief your flights here.'}</p>`;
  const coComposer = (ph) => `<form class="co-compose" data-cocompose><label class="sr" for="co-text">Message</label><textarea id="co-text" name="text" rows="2" maxlength="2000" placeholder="${esc(ph)}"></textarea><button class="btn btn-blue btn-sm">Send</button></form>`;

  /* ---------------- coaching: instructor view of one student ---------------- */
  async function studentSheet(id, tab) {
    const s = SCH(), admin = s.role === 'admin';
    let d; try { d = preview ? demoStudent(id) : await api('school/students/' + encodeURIComponent(id)); } catch (x) { toast(x.message); return; }
    ui.coStudent = { id, d }; ui.coTab = tab || ui.coTab || 'coach';
    const r = (ui.roster || []).find(m => m.id === id); if (r) { r.unread = 0; }
    drawStudent();
    sheet.showModal();
  }
  function drawStudent(form) {
    const s = SCH(), admin = s.role === 'admin', { id, d } = ui.coStudent;
    const st = d.student, reg = regimeOf(st), lic = R.licence(reg, st.licence), goal = st.goalHours || lic?.minHours || (reg === 'faa' ? 40 : 45);
    let S = null, sylState = {}; try { S = R.syllabusFor(reg); sylState = readJSON(d.syllabus)[S.id] || {}; } catch { }
    const signs = readJSON(d.signoffs) || {};
    let exams = []; try { exams = (JSON.parse(d.exams || '[]') || []).filter(e => e.date && daysUntil(e.date) >= 0); } catch { }
    const mocks = d.study?.mocks || [], thread = d.thread || [];
    const debriefOf = fid => thread.filter(t => t.kind === 'debrief' && t.flightId === fid).sort((a, b) => b.at - a.at)[0];
    const tab = ui.coTab;
    const done = S ? S.items.filter(i => sylState[i.id] === 'd').length : 0;
    const tabs = [['coach', 'Coaching'], ['flights', `Flights${d.recent.filter(f => f.role === 'dual' && !debriefOf(f.id)).length ? ` <i class="co-dot">${d.recent.filter(f => f.role === 'dual' && !debriefOf(f.id)).length}</i>` : ''}`], ['syllabus', 'Syllabus'], ['record', 'Record']];
    let body = '';
    if (form === 'plan') body = `<form class="co-form" data-coplan><h3>Set ${esc(firstName(st.name) || 'their')}’s next lesson</h3><p class="hint">It goes straight into their desk: the lesson, the date and a prep checklist they tick off.</p>
      <div class="fields">${input('Lesson', 'lesson', d.next.lesson || '', 'text', 'maxlength="120" required placeholder="e.g. Lesson 12 · Navigation"')}${input('Date', 'date', d.next.date || '', 'date', '', true)}</div>
      <label class="field full"><span>Prep before the lesson <i>(one per line)</i></span><textarea name="prep" rows="4" maxlength="1400" placeholder="Plot the route and mark the turn points&#10;Read the radio calls for the zone transit&#10;Chair-fly the forced landing drill"></textarea></label>
      ${input('Note for them', 'note', '', 'textarea', 'rows="2" maxlength="800"', true)}
      <p class="form-error" role="alert"></p><div class="co-acts"><button type="button" class="btn btn-line" data-coback>Cancel</button><button class="btn btn-blue">Send to ${esc(firstName(st.name) || 'student')}</button></div></form>`;
    else if (form && form.startsWith('debrief:')) {
      const fid = form.slice(8), f = d.recent.find(x => x.id === fid), prev = debriefOf(fid) || {};
      body = `<form class="co-form" data-codebrief="${esc(fid)}"><h3>Debrief: ${esc(flLabel(f))}</h3>${f?.lesson ? `<p class="hint">${esc(f.lesson)}</p>` : ''}${f?.notes ? `<p class="callout" style="margin:8px 0 4px"><b>Their notes:</b> ${esc(f.notes.slice(0, 400))}</p>` : ''}
        <div class="co-rate" role="radiogroup" aria-label="How it went">${Object.entries(RATING).map(([k, l]) => `<label><input type="radio" name="rating" value="${k}" ${(prev.rating || 'on-track') === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        ${input('What went well', 'wentWell', prev.wentWell || '', 'textarea', 'rows="2" maxlength="600"', true)}${input('What to work on next', 'workOn', prev.workOn || '', 'textarea', 'rows="2" maxlength="600"', true)}${input('Anything else', 'note', prev.note || '', 'textarea', 'rows="2" maxlength="1200"', true)}
        <p class="form-error" role="alert"></p><div class="co-acts"><button type="button" class="btn btn-line" data-coback>Cancel</button><button class="btn btn-blue">${prev.id ? 'Update debrief' : 'Send debrief'}</button></div></form>`;
    }
    else if (tab === 'coach') body = `<div class="co-quick"><button type="button" class="btn btn-line btn-sm" data-coform="plan">${ico('prepare')} Set next lesson</button>${d.recent[0] ? `<button type="button" class="btn btn-line btn-sm" data-coform="debrief:${esc(d.recent[0].id)}">${ico('logbook')} Debrief last flight</button>` : ''}<button type="button" class="btn btn-line btn-sm" data-cotab="syllabus">${ico('check')} Sign off lessons</button></div>
      <div class="co-next"><span class="hint">Next lesson</span><b>${esc(d.next.lesson || 'Not set yet')}</b>${d.next.date ? `<span class="chip">${esc(fmtDate(d.next.date))}</span>` : ''}${d.next.questions ? `<p class="hint" style="margin-top:6px"><b>Their questions for you:</b></p><p class="pre">${esc(d.next.questions)}</p>` : ''}</div>
      ${coThread(thread, { flights: d.recent, staff: true })}${coComposer(`Message ${firstName(st.name) || 'your student'}…`)}`;
    else if (tab === 'flights') body = d.recent.length ? `<div class="sch-flights">${d.recent.map(f => { const db = debriefOf(f.id); return `<div class="sch-fl"><div><b>${esc(flLabel(f))}</b><span class="chip role-${esc(f.role)}"><i></i>${esc(roleName(f.role))}</span><span class="r">${hm(f.minutes)}</span></div>${f.lesson ? `<small>${esc(f.lesson)}</small>` : ''}${f.notes ? `<p>${esc(f.notes.slice(0, 280))}${f.notes.length > 280 ? '…' : ''}</p>` : ''}
      <div class="co-flfoot">${db ? `<span class="chip co-r-${esc(db.rating)}">${ico('check')}Debriefed · ${esc(RATING[db.rating] || '')}</span><button type="button" class="link" data-coform="debrief:${esc(f.id)}">Edit debrief</button>` : `<button type="button" class="btn ${f.role === 'dual' ? 'btn-blue' : 'btn-line'} btn-sm" data-coform="debrief:${esc(f.id)}">Debrief this flight</button>`}</div></div>`; }).join('')}</div>` : '<p class="hint">No flights logged yet.</p>';
    else if (tab === 'syllabus') body = S ? `<div class="tile-head"><h3>${esc(S.title)}</h3><span class="chip">${done} of ${S.items.length} done</span></div><div class="syl-bar"><i style="width:${Math.round(done / S.items.length * 100)}%"></i></div>
      <p class="hint" style="margin:10px 0">Sign off a lesson when it’s complete. ${esc(firstName(st.name) || 'The student')} sees who signed it off.</p>
      <div class="co-syl">${S.items.map(i => { const v = sylState[i.id] || '', so = signs[S.id + ':' + i.id]; return `<div class="co-si"><span><b>${esc(i.name)}</b>${so && v === 'd' ? `<small>Signed off by ${esc(so.by)}, ${esc(fmtDate(new Date(so.at).toISOString().slice(0, 10), { day: 'numeric', month: 'short' }))}</small>` : v === 'd' ? '<small>Marked done by the student</small>' : ''}</span><div class="seg-s" role="group" aria-label="${esc(i.name)}">${[['', 'Not yet'], ['p', 'In progress'], ['d', 'Signed off']].map(([k, l]) => `<button type="button" data-sign="${esc(i.id)}" data-v="${k}" aria-pressed="${v === k}">${l}</button>`).join('')}</div></div>`; }).join('')}</div>` : '<p class="hint">This student hasn’t chosen a licence yet, so there’s no syllabus to sign off.</p>';
    else body = `<div class="stats"><div class="stat"><span>Total</span><b>${hrs(d.totals.minutes)}<small>h</small></b><em>${Math.min(100, Math.round(d.totals.minutes / 60 / goal * 100))}% of ${goal} h</em></div><div class="stat"><span>Solo and PIC</span><b>${hrs(d.totals.solo)}<small>h</small></b></div><div class="stat"><span>Flights</span><b>${d.totals.flights}</b></div><div class="stat"><span>Landings</span><b>${d.totals.landings}</b></div></div>
      ${exams.length || mocks.length ? `<div class="tile-head" style="margin-top:18px"><h3>Theory</h3></div><div class="airports">${exams.map(e => `<div><span>${esc(e.name)}</span><b>${esc(fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</b></div>`).join('')}${mocks.slice(-3).reverse().map(m => `<div><span>Mock exam, ${esc(fmtDate(m.d, { day: 'numeric', month: 'short' }))}</span><b>${m.s}%</b></div>`).join('')}</div>` : '<p class="hint" style="margin-top:14px">No exam dates or mock exams yet.</p>'}`;
    sheet.innerHTML = `<div class="sheet-head"><div><h2 class="display" id="sheet-title">${esc(st.name || 'Student')}</h2><p class="hint" style="margin-top:4px">${esc([st.licence, st.authority, st.airport, st.aircraft].filter(Boolean).join(' · '))}</p></div><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></div>
      ${form ? '' : `<nav class="co-tabs" aria-label="Student">${tabs.map(([k, l]) => `<button type="button" data-cotab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</nav>`}
      <div class="sheet-body sch-detail">${body}<p class="form-error" role="alert"></p></div>
      <footer class="sheet-foot">${admin && !form ? '<button type="button" class="btn btn-line" data-remove>Remove from school</button>' : '<span></span>'}<div class="right" style="margin-left:auto"><button type="button" class="btn btn-blue" data-close>Done</button></div></footer>`;
    wireStudent();
  }
  async function coPost(payload) {
    const { id, d } = ui.coStudent;
    const item = preview ? { id: 'x' + Date.now(), at: Date.now(), fromStaff: true, author: preview ? 'Sam Patel' : 'You', ...payload } : (await api('school/coach', 'POST', { studentId: id, ...payload })).item;
    if (item.kind === 'debrief') d.thread = d.thread.filter(t => !(t.kind === 'debrief' && t.flightId === item.flightId && t.fromStaff));
    d.thread.push(item);
    if (item.kind === 'plan') { d.next.lesson = item.lesson; if (item.date) d.next.date = item.date; const r = (ui.roster || []).find(m => m.id === id); if (r) { r.nextLesson = item.lesson; if (item.date) r.lessonDate = item.date; } }
    if (item.kind === 'debrief') { const r = (ui.roster || []).find(m => m.id === id); if (r && r.toDebrief) r.toDebrief = d.recent.filter(f => f.role === 'dual' && !d.thread.some(t => t.kind === 'debrief' && t.flightId === f.id)).length; }
    return item;
  }
  function wireStudent() {
    const s = SCH(), { id, d } = ui.coStudent, err = sheet.querySelector('.form-error');
    sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = () => { sheet.close(); if (current() === 'school') schoolDash(); });
    sheet.querySelectorAll('[data-cotab]').forEach(b => b.onclick = () => { ui.coTab = b.dataset.cotab; drawStudent(); });
    sheet.querySelectorAll('[data-coform]').forEach(b => b.onclick = () => drawStudent(b.dataset.coform));
    sheet.querySelectorAll('[data-coback]').forEach(b => b.onclick = () => drawStudent());
    const busy = (btn, on, txt) => { btn.disabled = on; if (txt) btn.textContent = txt; };
    const cm = sheet.querySelector('[data-cocompose]');
    if (cm) cm.onsubmit = async e => { e.preventDefault(); const t = cm.text.value.trim(); if (!t) return; const b = cm.querySelector('button'); busy(b, true); try { await coPost({ kind: 'msg', text: t }); drawStudent(); const th = sheet.querySelector('.co-thread'); if (th) th.lastElementChild?.scrollIntoView({ block: 'nearest' }); } catch (x) { err.textContent = x.message; busy(b, false); } };
    const pf = sheet.querySelector('[data-coplan]');
    if (pf) pf.onsubmit = async e => { e.preventDefault(); const b = pf.querySelector('button.btn-blue'); busy(b, true, 'Sending…'); try { await coPost({ kind: 'plan', lesson: pf.lesson.value.trim(), date: pf.date.value, prep: pf.prep.value.split('\n').map(x => x.trim()).filter(Boolean), note: pf.note.value.trim() }); toast(`Sent. ${firstName(d.student.name) || 'They'} will see it in their desk.`); ui.coTab = 'coach'; drawStudent(); } catch (x) { pf.querySelector('.form-error').textContent = x.message; busy(b, false, 'Try again'); } };
    const df = sheet.querySelector('[data-codebrief]');
    if (df) df.onsubmit = async e => { e.preventDefault(); const b = df.querySelector('button.btn-blue'); busy(b, true, 'Sending…'); try { await coPost({ kind: 'debrief', flightId: df.dataset.codebrief, rating: df.querySelector('[name=rating]:checked')?.value, wentWell: df.wentWell.value.trim(), workOn: df.workOn.value.trim(), note: df.note.value.trim() }); toast('Debrief sent.'); drawStudent(); } catch (x) { df.querySelector('.form-error').textContent = x.message; busy(b, false, 'Try again'); } };
    sheet.querySelectorAll('[data-sign]').forEach(b => b.onclick = async () => {
      let S; try { S = R.syllabusFor(regimeOf(d.student)); } catch { return; }
      const item = S.items.find(i => i.id === b.dataset.sign), v = b.dataset.v;
      b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      try { await coPost({ kind: 'signoff', sylId: S.id, itemId: item.id, itemName: item.name, status: v }); const all = readJSON(d.syllabus) || {}; all[S.id] = { ...(all[S.id] || {}) }; if (v) all[S.id][item.id] = v; else delete all[S.id][item.id]; d.syllabus = JSON.stringify(all); const so = readJSON(d.signoffs) || {}; if (v === 'd') so[S.id + ':' + item.id] = { by: state.profile?.name || 'you', at: Date.now() }; else delete so[S.id + ':' + item.id]; d.signoffs = JSON.stringify(so); drawStudent(); }
      catch (x) { err.textContent = x.message; drawStudent(); }
    });
    const rm = sheet.querySelector('[data-remove]');
    if (rm) rm.onclick = async () => {
      if (!rm.classList.contains('armed')) { rm.classList.add('armed'); rm.textContent = `Remove ${d.student.name || 'student'}? Tap again`; return; }
      rm.disabled = true; try { if (!preview) await api('school/remove', 'POST', { userId: id }); ui.roster = (ui.roster || []).filter(m => m.id !== id); state.school = { ...s, students: Math.max(0, s.students - 1) }; sheet.close(); toast('Removed. They keep their own records.'); schoolDash(); } catch (x) { err.textContent = x.message; rm.disabled = false; }
    };
  }
  /* ---------------- coaching: the student's side ---------------- */
  const inSchool = () => SCH()?.role === 'student' && SCH()?.active;
  async function loadCoach() {
    if (!inSchool()) return;
    if (preview) { state.coach = { unread: 2, debriefs: [], latest: demoThread()[2], school: SCH().name }; return; }
    try { state.coach = await api('coach/count'); } catch { }
  }
  // overview tile: the latest thing an instructor sent, or an invitation to message them
  function coachTile() {
    if (!inSchool()) return '';
    const c = state.coach || {}, it = c.latest, s = SCH();
    const line = !it ? `Your instructors at ${esc(s.name)} can debrief your flights, set your next lesson and sign off lessons here.` : it.kind === 'debrief' ? `${esc(it.author)} debriefed your flight · ${esc(RATING[it.rating] || '')}${it.workOn ? `. Work on: ${esc(it.workOn.slice(0, 90))}` : ''}` : it.kind === 'plan' ? `${esc(it.author)} set your next lesson: ${esc(it.lesson)}` : it.kind === 'signoff' ? `${esc(it.author)} ${it.status === 'd' ? 'signed off' : 'updated'} ${esc(it.itemName || 'a lesson')}` : `${esc(it.author)}: “${esc(it.text.slice(0, 110))}${it.text.length > 110 ? '…' : ''}”`;
    return `<section class="tile span-12 co-tile${c.unread ? ' new' : ''}" aria-labelledby="co-h"><div class="co-tile-ic">${ico('ask')}</div><div class="co-tile-tx"><h2 id="co-h">From your instructor${c.unread ? ` <span class="co-dot">${c.unread} new</span>` : ''}</h2><p>${line}</p></div><a class="btn ${c.unread ? 'btn-blue' : 'btn-line'} btn-sm" href="#school">${c.unread ? 'Open' : it ? 'See all' : 'Message your instructor'}</a></section>`;
  }
  // inside a logged flight: the instructor's debrief, if there is one
  function debriefBlock(f) {
    const db = (state.coach?.debriefs || []).find(x => x.flightId === f.id);
    if (!db) return '';
    return `<div class="co-card co-in-sheet"><span class="co-who">Debrief from ${esc(db.author || 'your instructor')}</span><span class="chip co-r-${esc(db.rating)}">${esc(RATING[db.rating] || '')}</span>${db.wentWell ? `<p><b>Went well.</b> ${esc(db.wentWell)}</p>` : ''}${db.workOn ? `<p><b>Work on.</b> ${esc(db.workOn)}</p>` : ''}${db.note ? `<p>${esc(db.note)}</p>` : ''}</div>`;
  }
  async function studentCoach() {
    const box = $('[data-cobox]'); if (!box) return;
    let items;
    try { items = preview ? demoThread() : (await api('coach')).items; } catch (x) { box.innerHTML = `<p class="callout warn">${esc(x.message)}</p>`; return; }
    if (state.coach) state.coach.unread = 0;
    const draw = () => {
      box.innerHTML = coThread(items, { flights: state.flights, staff: false }) + coComposer('Ask your instructor something, or tell them how it’s going…');
      const cm = box.querySelector('[data-cocompose]');
      cm.onsubmit = async e => { e.preventDefault(); const t = cm.text.value.trim(); if (!t) return; const b = cm.querySelector('button'); b.disabled = true; try { items.push(preview ? { id: 'm' + Date.now(), kind: 'msg', text: t, fromStaff: false, author: state.profile?.name || 'You', at: Date.now() } : (await api('coach/msg', 'POST', { text: t })).item); draw(); toast('Sent to your instructors.'); } catch (x) { toast(x.message); b.disabled = false; } };
    };
    draw();
  }
  function demoThread() {
    const t = n => Date.now() - n * 36e5, f = sorted();
    return [
      { id: 'd1', kind: 'debrief', fromStaff: true, author: 'Rosa Diaz', flightId: f[0]?.id, rating: 'on-track', wentWell: 'Radio calls were clear and you held 2,000 ft well on the first leg.', workOn: 'Start the turn timing from overhead the reservoir, not abeam it.', at: t(50) },
      { id: 'd2', kind: 'msg', fromStaff: false, author: state.profile?.name || 'Alex Morgan', text: 'Thanks! Should I re-plan the reservoir leg before Saturday?', at: t(30) },
      { id: 'd3', kind: 'plan', fromStaff: true, author: 'Rosa Diaz', lesson: 'Lesson 12 · Navigation', date: (() => { const d = new Date(Date.now() + 4 * 864e5); return d.toISOString().slice(0, 10); })(), prep: ['Re-plan the reservoir leg with the forecast wind', 'Work out diversion timings to Thruxton', 'Read through the zone transit calls'], note: 'Yes, and bring the printed log.', at: t(26) },
      { id: 'd4', kind: 'signoff', fromStaff: true, author: 'Rosa Diaz', itemName: 'Forced landings without power', status: 'd', at: t(25) }
    ];
  }
  // example school for ?preview=1#school
  function demoRoster() {
    const ago = n => { const d = parseISO(todayISO()); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const ahead = n => { const d = parseISO(todayISO()); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    const syl = keys => JSON.stringify({ 'easa-ppl-a': Object.fromEntries(keys.map(k => [k, 'd'])) });
    const base = ['1', '1E', '2', '3', '4', '5', '6', '7', '8', '9', '10A', '10B', '11', '12', '13', '12E/13E', '14', '15', '16', '17', '18A', '18B', '18C', '19'];
    const P = [['Alex Morgan', 2, 892, 70, 'Lesson 12 · Navigation', 4, 17], ['Priya Shah', 1, 1904, 420, 'Qualifying cross-country', 2, 22], ['Tom Okafor', 26, 610, 40, 'Circuits', 0, 12], ['Grace Lee', 5, 1260, 160, 'Forced landings', 6, 15], ['Ben Walsh', 41, 380, 0, 'Stalling', 0, 8], ['Hannah Novak', 9, 2310, 640, 'Skill test prep', 3, 23], ['Leo Martins', null, 0, 0, '', 0, 0]];
    return [{ id: 'adm', role: 'admin', name: 'Sam Patel', email: 'sam@pophamflying.example', joinedAt: Date.now() - 90 * 864e5 }, { id: 'ins', role: 'instructor', name: 'Rosa Diaz', email: 'rosa@pophamflying.example', joinedAt: Date.now() - 80 * 864e5 },
      ...P.map(([name, last, min, solo, next, inDays, n], i) => ({ id: 'st' + i, role: 'student', name, email: '', joinedAt: Date.now() - (i === 6 ? 12 : 70) * 864e5, licence: 'PPL(A)', authority: 'UK CAA', regime: 'uk', countryCode: 'GB', goalHours: 45, setup: i !== 6 || true, syllabus: syl(base.slice(0, n)), nextLesson: next, lessonDate: inDays ? ahead(inDays) : '', flights: Math.round(min / 60), minutes: min, soloMinutes: solo, landings: Math.round(min / 12), lastFlight: last == null ? '' : ago(last), recentMinutes: last != null && last < 30 ? Math.min(min, 240 - i * 20) : 0, lastMock: null, unread: i === 0 ? 1 : 0, toDebrief: i === 1 ? 2 : i === 3 ? 1 : 0 }))];
  }
  function demoStudent(id) {
    const m = demoRoster().find(r => r.id === id) || demoRoster()[2];
    return { student: { id, name: m.name, licence: m.licence, authority: m.authority, regime: 'uk', countryCode: 'GB', airport: 'EGHP · Popham', aircraft: 'PA-28 Warrior', goalHours: 45, openingMinutes: 0 }, next: { lesson: m.nextLesson, date: m.lessonDate, questions: 'When would you divert if the reservoir turn is late?' }, syllabus: m.syllabus, exams: JSON.stringify([{ name: 'Navigation', date: m.lessonDate || todayISO() }]), study: { mocks: [{ d: todayISO(), s: 81 }] }, totals: { flights: m.flights, minutes: m.minutes, solo: m.soloMinutes, landings: m.landings }, recent: id === 'st0' ? sorted().slice(0, 8).map(f => ({ ...f })) : [], signoffs: '', thread: id === 'st0' ? demoThread().filter(t => t.kind !== 'signoff') : [] };
  }

  async function finishSchoolCheckout() {
    toast('Confirming your school plan…');
    for (let i = 0; i < 8; i++) {
      try { const r = await api('school/sync', 'POST', {}); state.school = r.school; if (r.school?.active) { state.billing = await api('billing'); addSchoolNav(); ui.roster = null; toast(r.school.status === 'trialing' ? 'Your school’s free trial has started. Share the student code to invite students.' : 'Your school is on Boplo. Share the student code to invite students.'); render(); return; } } catch { }
      await new Promise(r => setTimeout(r, 1500 + i * 500));
    }
    toast('Payment is still being confirmed. Refresh in a minute.'); render();
  }
  /* ---------------- router ---------------- */
  function render() {
    if (!state.profile?.complete) { if (current() === 'school') { schoolPage(); return; } ui.step = Math.min(4, state.profile?.step || 0); onboard(); return; }
    const k = current(); if (k !== 'study') quiz = null;
    ({ overview, logbook, map: mapPage, analytics, prepare, profile: profilePage, progress: progressPage, budget: budgetPage, study: studyPage, weather: weatherPage, navlog: navPage, preflight: preflightPage, community: communityPage, leaderboards: boardsPage, students: studentsPage, sim: simPage, plan: planPage, school: schoolPage, ask: askPage, currency: currencyPage, radio: () => radioPage(), more: morePage })[k]();
  }
  addEventListener('hashchange', () => { if (sheet.open) sheet.close(); const pl = document.getElementById('plot'); if (pl?.open) pl.close(); const sm = document.getElementById('sim'); if (sm?.open) sm.close(); if (state.profile?.complete) { render(); scrollTo({ top: 0, behavior: 'instant' }); } });

  /* ---------------- example desk ---------------- */
  function demo() {
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ago = n => { const d = parseISO(todayISO()); d.setDate(d.getDate() - n); return iso(d); };
    const ahead = n => { const d = parseISO(todayISO()); d.setDate(d.getDate() + n); return iso(d); };
    const POP = { lat: 51.1939, lng: -1.2347 };
    let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const interp = (a, b, n) => Array.from({ length: n }, (_, i) => ({ lat: a.lat + (b.lat - a.lat) * i / n + (rnd() - .5) * .002, lng: a.lng + (b.lng - a.lng) * i / n + (rnd() - .5) * .003 }));
    const circuit = () => { const c = [{ lat: 51.1939, lng: -1.2347 }, { lat: 51.1985, lng: -1.2005 }, { lat: 51.2125, lng: -1.2055 }, { lat: 51.2080, lng: -1.2780 }, { lat: 51.1925, lng: -1.2740 }, { lat: 51.1939, lng: -1.2347 }]; let o = []; for (let i = 0; i < c.length - 1; i++) o = o.concat(interp(c[i], c[i + 1], 6)); o.push(c[c.length - 1]); return o; };
    const loop = wps => { let o = []; for (let i = 0; i < wps.length - 1; i++) o = o.concat(interp(wps[i], wps[i + 1], 14)); o.push(wps[wps.length - 1]); return o; };
    const area = loop([POP, { lat: 51.255, lng: -1.19 }, { lat: 51.27, lng: -1.30 }, { lat: 51.22, lng: -1.36 }, POP]);
    const nav = loop([POP, { lat: 51.2083, lng: -1.48 }, { lat: 51.11, lng: -1.49 }, { lat: 51.06, lng: -1.31 }, POP]);
    const F = [
      [118, 'Lesson 1 · Effects of controls', 'dual', 55, 1, 'Light touch on the controls. Use the horizon, not the instruments.', area, 'track'],
      [109, 'Lesson 2 · Straight and level', 'dual', 60, 1, 'Trim more often. Hold attitude, then check.', area, 'track'],
      [99, 'Lesson 3 · Climbing and descending', 'dual', 62, 1, 'Power, attitude, trim. Remember to look out during the climb.', area, 'track'],
      [90, 'Lesson 4 · Medium turns', 'dual', 58, 1, 'Balance with rudder going into the turn. Good lookout.', area, 'track'],
      [80, 'Lesson 5 · Slow flight', 'dual', 65, 1, 'Stay ahead of the aircraft at low speed.', area, 'track'],
      [70, 'Lesson 6 · Stalling', 'dual', 60, 1, 'Recovery was smooth. Work on the HASELL checks from memory.', area, 'track'],
      [59, 'Lesson 7 · Circuits', 'dual', 70, 5, 'Downwind spacing drifted wide. Use the road as a reference.', circuit(), 'track'],
      [49, 'Lesson 8 · Circuits', 'dual', 68, 6, 'Flare height better. Keep the centreline on short final.', circuit(), 'track'],
      [38, 'Lesson 9 · Glide approaches', 'dual', 66, 5, 'Judged two of three glides well. Fly the base turn earlier.', circuit(), 'track'],
      [29, 'Lesson 10 · First solo', 'solo', 18, 1, 'First solo circuit. Calm and on speed.', circuit(), 'track'],
      [19, 'Lesson 11 · Solo consolidation', 'solo', 52, 5, 'Five full-stop landings. Radio calls more confident.', circuit(), 'track'],
      [8, 'Lesson 11b · Navigation planning', 'dual', 75, 1, 'Turn at the reservoir was 40 seconds late. Start the timing from overhead, not abeam.', nav, 'track']
    ];
    state = {
      user: { display_name: 'Alex Morgan', email: '' }, mapsKey: '',
      profile: {
        name: 'Alex Morgan', country: 'United Kingdom', countryCode: 'GB', regime: 'uk', authority: 'UK CAA', licence: 'PPL(A)', airport: 'EGHP · Popham', school: 'Example flying club',
        aircraft: 'PA-28 Warrior', registration: 'G-BOPL', frequency: 'Weekly', topics: 'Air law, navigation',
        target: ahead(240), goalHours: 40, openingMinutes: 0, nextLesson: 'Lesson 12 · Navigation', lessonDate: ahead(4),
        questions: 'When would you divert if the reservoir turn is late?\nWhich frequency do I change to first after departure?',
        notes: 'Plan the route the evening before and print the log.', checklist: '[x] Plot the route and mark the turn points\n[x] Work out diversion timings\n[ ] Read through the radio calls\n[ ] Check the aircraft tech log',
        currency: 'GBP', rateAircraft: 185, rateInstructor: 45,
        syllabus: JSON.stringify({ 'easa-ppl-a': Object.fromEntries(['1', '1E', '2', '3', '4', '5', '6', '7', '8', '9', '10A', '10B', '11', '12', '13', '12E/13E', '14'].map(k => [k, 'd']).concat([['15', 'd'], ['16', 'p'], ['18A', 'p'], ['RT', 'p']])) }),
        study: JSON.stringify({ al1: [1, 1], al2: [1, 1], al5: [0, 1], me1: [1, 1], me3: [0, 1], me5: [1, 1], na3: [0, 2], na4: [1, 1], pf2: [1, 1], _mocks: [{ d: ago(9), s: 69 }, { d: ago(2), s: 81 }] }),
        docs: JSON.stringify({ medical: ahead(410), rating: ahead(300), custom: [{ label: 'FRTOL radio practical', date: ahead(52) }] }),
        navlogs: JSON.stringify({ logs: [{ name: 'Popham → Lasham → Romsey', points: [{ lat: 51.1939, lng: -1.2347, code: 'EGHP' }, { lat: 51.1872, lng: -1.0335, code: 'EGHL' }, { lat: 50.99, lng: -1.4967, code: '' }, { lat: 51.1939, lng: -1.2347, code: 'EGHP' }], inp: { tas: 95, wdir: 250, wspd: 15, vari: 1, vdir: 'W', burn: 32, unit: 'L', taxi: 4, reserve: 45, alt: 2400 } }] }),
        radio: JSON.stringify({ 'u-check': 100, 'u-taxi': 75 }),
        complete: true, step: 4
      },
      flights: F.map(([d, lesson, role, minutes, landings, notes, points, routeKind], i) => ({ id: 'demo-' + i, date: ago(d), departure: 'EGHP', arrival: 'EGHP', aircraft: 'PA-28 Warrior', registration: 'G-BOPL', role, minutes, landings, instructor: role === 'dual' ? 'Sam Patel' : '', lesson, notes, points, routeKind }))
    };
  }

  /* ---------------- start ---------------- */
  if ('serviceWorker' in navigator && !preview && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { }));
  async function start() {
    const jm = location.hash.match(/^#join=([A-Za-z0-9-]{4,20})$/); if (jm) { try { localStorage.setItem('boplo-join', jm[1]); } catch { } history.replaceState(null, '', location.pathname + location.search + '#school'); }
    if (preview) { demo(); if (current() === 'school') state.school = { role: 'admin', id: 'demo', name: 'Popham Flying School', plan: 'school', planLabel: 'School', seats: 25, staffSeats: 10, students: 7, staff: 2, active: true, status: 'active', studentCode: 'K7PX4M2Q', staffCode: 'T9HW3RCE', studentLink: location.origin + '/flight-app.html#join=K7PX4M2Q', staffLink: location.origin + '/flight-app.html#join=T9HW3RCE', periodEnd: Date.now() + 200 * 864e5, amount: 99900, currency: 'usd' }; addSchoolNav(); state.billing = { plan: 'advanced', status: 'active', interval: 'yearly', trialAvailable: false, trialDays: 0, prices: { monthly: { amount: 1199, currency: 'usd' }, yearly: { amount: 9999, currency: 'usd' } }, limits: { flights: 15, navPlans: 1 }, ready: false }; render(); return; }
    try {
      const ws = await api('workspace'); if (!ws.user) throw new Error('Your desk couldn’t load your account.');
      if (!ws.profile?.complete) { try { const plan = JSON.parse(localStorage.getItem('boplo-plan') || 'null'); if (plan && plan.countryCode) { const pr = ws.profile || {}; const r = R.regimeFor(plan.countryCode); ws.profile = { countryCode: plan.countryCode, country: R.nameFor(plan.countryCode), regime: r, authority: R.authorityFor(plan.countryCode) || '', licence: plan.licence, goalHours: plan.goalHours, rateAircraft: plan.rateAircraft, rateInstructor: plan.rateInstructor, currency: plan.currency, lessonsPerWeek: plan.lessonsPerWeek, ...Object.fromEntries(Object.entries(pr).filter(([, v]) => v !== '' && v != null && v !== 0)) }; } } catch { } }
      state = ws; state.billing = ws.billing || null; state.school = ws.school || null; addSchoolNav(); saveSnapshot(ws); setTimeout(flushOutbox, 1500);
      loadCoach().then(() => { if (state.coach && current() === 'overview' && state.profile?.complete && !sheet.open) render(); });
      try { const f = localStorage.getItem('boplo-first'); if (f && !localStorage.getItem('boplo-first-sent')) api('attrib', 'POST', JSON.parse(f)).then(() => localStorage.setItem('boplo-first-sent', '1')).catch(() => { }); } catch { }
      const q = new URLSearchParams(location.search);
      try { if (localStorage.getItem('boplo-school-intent')) { localStorage.removeItem('boplo-school-intent'); if (!state.school) history.replaceState(null, '', location.pathname + '#school'); } } catch { }
      if (q.get('school_checkout')) { history.replaceState(null, '', location.pathname + '#school'); render(); finishSchoolCheckout(); return; }
      let pj = null; try { pj = localStorage.getItem('boplo-join'); if (pj) localStorage.removeItem('boplo-join'); } catch { }
      if (pj && !(state.school && state.school.active)) { render(); setTimeout(() => joinSheet(pj), 300); return; }
      if (q.get('setup_intent') || q.get('payment_intent')) { history.replaceState(null, '', location.pathname + '#plan'); render(); finishCheckout(); return; }
      try { const intent = JSON.parse(localStorage.getItem('boplo-intent') || 'null'); if (intent?.plan && ws.profile?.complete) { localStorage.removeItem('boplo-intent'); ui.billInterval = intent.plan === 'monthly' ? 'monthly' : 'yearly'; if (B().plan !== 'advanced') location.hash = '#plan'; } } catch { }
      render();
    }
    catch (e) {
      const snap = isOffline(e) ? loadSnapshot() : null;
      if (snap?.user) { state = snap; state.billing = snap.billing || null; state.offline = true; const q = outbox(); if (q.length) state.flights = [...q.map(x => ({ ...x.data, id: x.id, pending: true })), ...state.flights.filter(f => !q.some(x => x.id === f.id))]; render(); return; }
      if (e.status === 401) auth(); else failure(e);
    }
  }
  start();
})();
