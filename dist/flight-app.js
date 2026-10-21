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
    if (!res.ok) throw Object.assign(new Error(out.error || 'Something went wrong. Try again.'), { status: res.status });
    return out;
  }

  /* ---------------- state ---------------- */
  let state = { user: null, profile: null, flights: [], mapsKey: '' };
  const ui = { step: 0, q: '', role: 'all', range: '365', mapSel: null };

  const PAGES = [
    ['overview', 'Overview', 'overview'],
    ['logbook', 'Logbook', 'logbook'],
    ['map', 'Map', 'map'],
    ['analytics', 'Analytics', 'analytics'],
    ['prepare', 'Prepare', 'prepare']
  ];
  const LEGACY = { today: 'overview', log: 'logbook', lesson: 'prepare' };
  const current = () => { const h = location.hash.slice(1); const k = LEGACY[h] || h; return [...PAGES.map(p => p[0]), 'profile'].includes(k) ? k : 'overview'; };

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
        input('Theory to revisit', 'topics', p.topics, 'text', 'maxlength="200" placeholder="e.g. Air law, meteorology"', true)],
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
        <nav aria-label="Flight desk">${PAGES.map(([id, label, icon]) => `<a href="#${id}" ${page === id ? 'aria-current="page"' : ''}>${ico(icon)}${label}</a>`).join('')}</nav>
        <div class="me">
          <div class="me-row"><span class="avatar" aria-hidden="true">${esc(initials(p.name))}</span><div style="min-width:0"><b>${esc(p.name)}</b><small>${esc([p.licence, p.authority].filter(Boolean).join(' · '))}</small></div></div>
          <div class="me-actions"><a href="#profile" ${page === 'profile' ? 'aria-current="page"' : ''}>${ico('profile')}Profile</a><button data-logout>${ico('out')}${preview ? 'Leave' : 'Sign out'}</button></div>
        </div>
      </div></aside>
      <header class="topbar">${brand('#overview')}<div style="display:flex;gap:8px;align-items:center"><a class="icon-btn" href="#profile" aria-label="Profile" style="background:transparent;border-color:var(--hair-d);color:#fff">${ico('profile')}</a><button class="btn btn-blue btn-has-spark" data-add>Log flight ${spark}</button></div></header>
      <main class="main"><div class="page">
        ${preview ? `<div class="preview-bar"><span><b>Example desk.</b> These are sample records; changes aren’t saved.</span><a class="btn btn-light btn-sm" href="/flight-app.html">Open my own desk</a></div>` : ''}
        <header class="page-head"><div><h1 class="display">${head.title}</h1>${head.sub ? `<p>${head.sub}</p>` : ''}</div>${head.actions ? `<div class="head-actions">${head.actions}</div>` : ''}</header>
        ${body}
      </div></main>
      <nav class="tabbar" aria-label="Flight desk">${PAGES.map(([id, label, icon]) => `<a href="#${id}" ${page === id ? 'aria-current="page"' : ''}>${ico(icon)}${label}</a>`).join('')}</nav>
    </div>`;
    $$('[data-add]').forEach(b => b.onclick = () => flightSheet());
    $$('[data-logout]').forEach(b => b.onclick = logout);
    $$('[data-flight]').forEach(b => b.onclick = () => flightSheet(state.flights.find(f => f.id === b.dataset.flight)));
  }

  /* ---------------- pages ---------------- */
  function flightRows(list) {
    return list.map(f => `<button class="frow" data-flight="${esc(f.id)}">
      <span class="fdate"><b>${esc(fmtDate(f.date, { day: 'numeric', month: 'short' }))}</b>${esc(fmtDate(f.date, { weekday: 'short' }))}</span>
      <span class="froute"><b>${esc(upper(f.departure))} → ${esc(upper(f.arrival))}</b><small>${esc(f.lesson || f.aircraft || 'Flight')}</small></span>
      <span class="chip role-${esc(f.role)}"><i></i>${esc(roleName(f.role))}</span>
      <span class="ftime">${hm(f.minutes)}<small>${f.landings} ldg</small></span>
    </button>`).join('');
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
      `<div class="grid">
        <section class="tile dark next span-7" aria-labelledby="next-h">${contours('b')}
          <div class="tile-head"><h2 id="next-h">Up next</h2><span class="chip">${esc(when)}</span></div>
          <h3 class="display">${esc(p.nextLesson || 'Add your next lesson')}</h3>
          <div class="next-meta">${p.lessonDate ? `<span><b>${esc(fmtDate(p.lessonDate, { weekday: 'long', day: 'numeric', month: 'long' }))}</b></span>` : ''}${p.airport ? `<span>${esc(p.airport)}</span>` : ''}${p.aircraft ? `<span>${esc(p.aircraft)}</span>` : ''}</div>
          ${firstQ ? `<p class="next-q">${esc(firstQ)}</p>` : ''}
          <div class="next-foot">
            ${checks.length ? `<span class="progress"><span class="progress-bar"><i style="width:${checks.length ? done / checks.length * 100 : 0}%"></i></span>${done} of ${checks.length} prepared</span>` : '<span class="progress">No preparation checklist yet</span>'}
            <a class="btn btn-light btn-has-spark" href="#prepare">Prepare ${spark}</a>
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

        <section class="stats span-12" aria-label="Totals">
          <div class="stat"><span>Total time</span><b>${hrs(totalMin())}<small>h</small></b><em>${p.openingMinutes ? `Includes ${hrs(p.openingMinutes)} h from before` : 'From your logged flights'}</em></div>
          <div class="stat"><span>Last 30 days</span><b>${hrs(sum(last30, f => f.minutes))}<small>h</small></b><em>${last30.length} flight${last30.length === 1 ? '' : 's'}</em></div>
          <div class="stat"><span>Landings</span><b>${sum(state.flights, f => f.landings)}</b><em>Across all flights</em></div>
          <div class="stat"><span>Solo and PIC</span><b>${hrs(sum(state.flights.filter(f => f.role !== 'dual'), f => f.minutes))}<small>h</small></b><em>${hrs(sum(state.flights.filter(f => f.role === 'dual'), f => f.minutes))} h dual</em></div>
        </section>

        <section class="tile span-7" aria-labelledby="recent-h">
          <div class="tile-head"><h2 id="recent-h">Recent flights</h2>${list.length ? '<a class="link" href="#logbook">Open logbook</a>' : ''}</div>
          ${list.length ? `<div class="flist">${flightRows(list.slice(0, 5))}</div>` : `<div class="empty"><h3>Your first flight goes here.</h3><p>Log the time, role, landings and what you learned while it’s fresh.</p><button class="btn btn-blue btn-has-spark" data-add>Log a flight ${spark}</button></div>`}
        </section>

        <section class="tile span-5" aria-labelledby="track-h">
          <div class="tile-head"><h2 id="track-h">Latest track</h2>${latest ? '<a class="link" href="#map">Open map</a>' : ''}</div>
          <div class="mini">${latest ? trackSVG([latest], 480, 300) : `<div class="mini-empty"><b>No track yet</b>Add coordinates to a flight and its route is drawn here.</div>`}</div>
          ${latest ? `<div class="mini-meta"><span><b>${esc(upper(latest.departure))} → ${esc(upper(latest.arrival))}</b> · ${esc(fmtDate(latest.date))}</span><span>${hm(latest.minutes)} · ${esc(roleName(latest.role))}</span></div>` : ''}
        </section>
      </div>`);
  }

  function logbook() {
    const q = ui.q.toLowerCase();
    const list = sorted().filter(f => (ui.role === 'all' || f.role === ui.role) && (!q || [f.departure, f.arrival, f.aircraft, f.registration, f.instructor, f.lesson, f.notes, f.date].join(' ').toLowerCase().includes(q)));
    const totalM = sum(list, f => f.minutes);
    shell('logbook', { title: 'Logbook', sub: 'Every flight you’ve logged, with the context behind it.', actions: '<button class="btn btn-blue btn-has-spark" data-add>Log a flight ' + spark + '</button>' },
      state.flights.length ? `
      <div class="toolbar">
        <label class="search">${ico('search')}<span class="sr">Search flights</span><input type="search" data-q value="${esc(ui.q)}" placeholder="Search airfield, lesson, aircraft…"></label>
        <div class="filter" role="group" aria-label="Role">${[['all', 'All'], ['dual', 'Dual'], ['solo', 'Solo'], ['pic', 'PIC']].map(([v, l]) => `<button data-role="${v}" aria-pressed="${ui.role === v}">${l}</button>`).join('')}</div>
        <span class="count" aria-live="polite">${list.length} flight${list.length === 1 ? '' : 's'} · ${hm(totalM)} h</span>
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

  function prepare() {
    const p = state.profile; let checks = parseChecks(p.checklist);
    const recent = sorted().slice(0, 3);
    shell('prepare', { title: 'Prepare', sub: 'Your notes and questions for the next lesson, with the last debriefs beside them.' },
      `<form class="grid" data-prep novalidate>
        <section class="tile span-7"><div class="tile-head"><h2>Next lesson</h2></div>
          <div class="fields">
            ${input('Lesson', 'nextLesson', p.nextLesson, 'text', 'maxlength="200" placeholder="e.g. Lesson 12 · Navigation"')}
            ${input('Date', 'lessonDate', p.lessonDate, 'date')}
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
        <section class="tile span-5"><div class="tile-head"><h2>From your last flights</h2>${recent.length ? '<a class="link" href="#logbook">Logbook</a>' : ''}</div>
          ${recent.length ? recent.map(f => `<div class="debrief"><small>${esc(fmtDate(f.date))} · ${esc(f.lesson || `${upper(f.departure)} → ${upper(f.arrival)}`)}</small><p class="${f.notes ? '' : 'none'}">${esc(f.notes || 'No debrief notes for this flight.')}</p></div>`).join('') : '<p class="hint">Debrief notes from your flights will show here.</p>'}
        </section>
      </form>`);
    const form = $('[data-prep]'), box = $('[data-checks]'), nw = $('[data-new]');
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
      try { const v = Object.fromEntries(new FormData(form)); ['nw'].forEach(k => delete v[k]); await saveProfile({ nextLesson: v.nextLesson, lessonDate: v.lessonDate, questions: v.questions, notes: v.notes, checklist: writeChecks(checks) }); toast('Preparation saved.'); prepare(); }
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
        <div class="span-12 actions"><p class="form-error" role="alert"></p><span class="hint">${state.user?.email ? `Signed in as ${esc(state.user.email)}` : ''}</span><div class="right"><button type="button" class="btn btn-line" data-logout>${ico('out')}${preview ? 'Leave example' : 'Sign out'}</button><button class="btn btn-blue btn-has-spark" type="submit">Save profile ${spark}</button></div></div>
      </form>`);
    $$('[data-logout]').forEach(b => b.onclick = logout);
    const form = $('[data-profile]');
    bindTraining(form, p);
    form.onsubmit = async e => {
      e.preventDefault(); const err = $('.form-error', form), btn = form.querySelector('[type=submit]'); err.textContent = '';
      const bad = [...form.querySelectorAll('input[required], select[required]')].find(i => !String(i.value).trim()); if (bad) { err.textContent = 'Name, country and authority are required.'; bad.focus(); return; }
      const v = Object.fromEntries(new FormData(form)); if (v.countryCode) v.country = R.nameFor(v.countryCode); v.openingMinutes = readDuration(form, 'openingMinutes'); v.goalHours = Number(v.goalHours || 0);
      btn.disabled = true;
      try { await saveProfile({ ...v, complete: true, step: 4 }); toast('Profile saved.'); profilePage(); } catch (x) { err.textContent = x.message; btn.disabled = false; }
    };
  }

  /* ---------------- flight sheet ---------------- */
  function flightSheet(f = {}) {
    const p = state.profile, editing = !!f.id;
    const role = f.role || 'dual';
    const coords = (f.points || []).map(x => `${x.lat},${x.lng}`).join('\n');
    sheet.innerHTML = `<form method="dialog" novalidate data-sheet>
      <header class="sheet-head"><h2 id="sheet-title" class="display">${editing ? 'Flight record' : 'Log a flight'}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ico('close')}</button></header>
      <div class="sheet-body">
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
            ${input('Instructor', 'instructor', f.instructor || '', 'text', 'maxlength="100"', true)}
          </div>
        </div>
        <div class="group"><h3>Lesson and debrief</h3><div class="fields">
          <label class="field full"><span>Lesson or exercise <i>(optional)</i></span><input name="lesson" value="${esc(f.lesson || (editing ? '' : p.nextLesson || ''))}" maxlength="100"></label>
          ${input('Debrief notes', 'notes', f.notes || '', 'textarea', 'placeholder="What went well, what to work on next time"', true)}
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
        ${editing ? '<button type="button" class="btn btn-danger" data-delete>Delete flight</button>' : `<span class="hint">${preview ? 'Example desk: not saved.' : ''}</span>`}
        <div class="right" style="display:flex;gap:10px;margin-left:auto"><button type="button" class="btn btn-line" data-close>Cancel</button><button class="btn btn-blue btn-has-spark" type="submit">${editing ? 'Save changes' : 'Save flight'} ${spark}</button></div>
      </footer>
    </form>`;
    const form = sheet.querySelector('form'), err = sheet.querySelector('.form-error');
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = () => sheet.close());
    sheet.onclick = e => { if (e.target === sheet) sheet.close(); };
    sheet.showModal();
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
        const data = { date: v.date, minutes, departure: v.departure.trim(), arrival: v.arrival.trim(), aircraft: v.aircraft, registration: v.registration, role: v.role || 'dual', landings: Number(v.landings || 0), instructor: v.instructor, lesson: v.lesson, notes: v.notes, points, routeKind: kind };
        btn.disabled = true;
        const saved = preview ? { flight: { ...data, id: f.id || 'demo-' + Math.random().toString(36).slice(2) } } : await api(editing ? 'flights/' + f.id : 'flights', editing ? 'PUT' : 'POST', data);
        state.flights = [saved.flight, ...state.flights.filter(x => x.id !== saved.flight.id)];
        sheet.close(); render(); toast(editing ? 'Flight updated.' : 'Flight saved.');
      } catch (x) { err.textContent = x.message; btn.disabled = false; err.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); }
    };
    const del = sheet.querySelector('[data-delete]');
    if (del) del.onclick = async () => {
      if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Delete for good'; return; }
      del.disabled = true;
      try { if (!preview) await api('flights/' + f.id, 'DELETE'); state.flights = state.flights.filter(x => x.id !== f.id); sheet.close(); render(); toast('Flight deleted.'); }
      catch (x) { err.textContent = x.message; del.disabled = false; }
    };
  }

  /* ---------------- router ---------------- */
  function render() {
    if (!state.profile?.complete) { ui.step = Math.min(4, state.profile?.step || 0); onboard(); return; }
    ({ overview, logbook, map: mapPage, analytics, prepare, profile: profilePage })[current()]();
  }
  addEventListener('hashchange', () => { if (state.profile?.complete) { render(); scrollTo({ top: 0, behavior: 'instant' }); } });

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
      [170, 'Lesson 1 · Effects of controls', 'dual', 55, 1, 'Light touch on the controls. Use the horizon, not the instruments.', area, 'track'],
      [160, 'Lesson 2 · Straight and level', 'dual', 60, 1, 'Trim more often. Hold attitude, then check.', area, 'track'],
      [146, 'Lesson 3 · Climbing and descending', 'dual', 62, 1, 'Power, attitude, trim. Remember to look out during the climb.', area, 'track'],
      [133, 'Lesson 4 · Medium turns', 'dual', 58, 1, 'Balance with rudder going into the turn. Good lookout.', area, 'track'],
      [118, 'Lesson 5 · Slow flight', 'dual', 65, 1, 'Stay ahead of the aircraft at low speed.', area, 'track'],
      [104, 'Lesson 6 · Stalling', 'dual', 60, 1, 'Recovery was smooth. Work on the HASELL checks from memory.', area, 'track'],
      [86, 'Lesson 7 · Circuits', 'dual', 70, 5, 'Downwind spacing drifted wide. Use the road as a reference.', circuit(), 'track'],
      [72, 'Lesson 8 · Circuits', 'dual', 68, 6, 'Flare height better. Keep the centreline on short final.', circuit(), 'track'],
      [57, 'Lesson 9 · Glide approaches', 'dual', 66, 5, 'Judged two of three glides well. Fly the base turn earlier.', circuit(), 'track'],
      [43, 'Lesson 10 · First solo', 'solo', 18, 1, 'First solo circuit. Calm and on speed.', circuit(), 'track'],
      [29, 'Lesson 11 · Solo consolidation', 'solo', 52, 5, 'Five full-stop landings. Radio calls more confident.', circuit(), 'track'],
      [12, 'Lesson 11b · Navigation planning', 'dual', 75, 1, 'Turn at the reservoir was 40 seconds late. Start the timing from overhead, not abeam.', nav, 'track']
    ];
    state = {
      user: { display_name: 'Alex Morgan', email: '' }, mapsKey: '',
      profile: {
        name: 'Alex Morgan', country: 'United Kingdom', countryCode: 'GB', regime: 'uk', authority: 'UK CAA', licence: 'PPL(A)', airport: 'EGHP · Popham', school: 'Example flying club',
        aircraft: 'PA-28 Warrior', registration: 'G-BOPL', frequency: 'Weekly', topics: 'Air law, navigation',
        target: ahead(240), goalHours: 40, openingMinutes: 0, nextLesson: 'Lesson 12 · Navigation', lessonDate: ahead(4),
        questions: 'When would you divert if the reservoir turn is late?\nWhich frequency do I change to first after departure?',
        notes: 'Plan the route the evening before and print the log.', checklist: '[x] Plot the route and mark the turn points\n[x] Work out diversion timings\n[ ] Read through the radio calls\n[ ] Check the aircraft tech log',
        complete: true, step: 4
      },
      flights: F.map(([d, lesson, role, minutes, landings, notes, points, routeKind], i) => ({ id: 'demo-' + i, date: ago(d), departure: 'EGHP', arrival: 'EGHP', aircraft: 'PA-28 Warrior', registration: 'G-BOPL', role, minutes, landings, instructor: role === 'dual' ? 'Sam Patel' : '', lesson, notes, points, routeKind }))
    };
  }

  /* ---------------- start ---------------- */
  async function start() {
    if (preview) { demo(); render(); return; }
    try { const ws = await api('workspace'); if (!ws.user) throw new Error('Your desk couldn’t load your account.'); state = ws; render(); }
    catch (e) { if (e.status === 401) auth(); else failure(e); }
  }
  start();
})();
