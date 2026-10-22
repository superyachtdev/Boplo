/* Boplo ATC radio: an optional, never-ending busy airport frequency (approach or tower).
   Off until the visitor switches it on; the choice is remembered. Browsers only allow sound after a click or key
   press, so a remembered "on" resumes at the first interaction. Voices are the device's own text-to-speech; the radio
   texture (hiss, squelch, mic clicks) is made with Web Audio. It pauses in the simulator, on radio practice and when
   the tab is hidden. Every exchange is invented: no real recordings are used. */
(function () {
  if (window.__boploRadio) return; window.__boploRadio = true;
  const KEY = 'boplo-radio', synth = window.speechSynthesis;
  const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: v => { try { localStorage.setItem(KEY, v); } catch { } } };
  const rnd = a => a[Math.floor(Math.random() * a.length)], chance = p => Math.random() < p, between = (a, b) => a + Math.random() * (b - a);

  /* ---------- the frequency: airfield, traffic and what they say ---------- */
  const PH = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu'.split(' ');
  const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
  const say = s => String(s).split('').map(c => /\d/.test(c) ? NUM[+c] : /[A-Z]/.test(c) ? PH[c.charCodeAt(0) - 65] : '').filter(Boolean).join(' ');
  // busy airports: approach and tower frequencies with airline traffic, controller-heavy and almost never quiet
  const FIELDS = [
    { name: 'Heathrow', unit: 'Director', freq: '119.730', rwys: ['27L', '27R'], style: 'uk', twr: '118.505', holds: ['Lambourne', 'Biggin', 'Ockham', 'Bovingdon'], apt: 'Heathrow' },
    { name: 'Heathrow', unit: 'Tower', freq: '118.505', rwys: ['27R', '27L'], style: 'uk', holds: [], apt: 'Heathrow' },
    { name: 'Madrid', unit: 'Approach', freq: '127.100', rwys: ['32L', '32R'], style: 'icao', twr: '118.150', holds: ['Toledo', 'Rober', 'Sotos'], apt: 'Barajas' },
    { name: 'Barcelona', unit: 'Approach', freq: '119.100', rwys: ['24R', '25R'], style: 'icao', twr: '118.100', holds: ['Sabadell', 'Castillejos', 'Vibim'], apt: 'Barcelona' },
    { name: 'Gatwick', unit: 'Director', freq: '126.825', rwys: ['26L', '26R'], style: 'uk', twr: '124.230', holds: ['Willo', 'Timba'], apt: 'Gatwick' },
    { name: 'SoCal', unit: 'Approach', freq: '124.300', rwys: ['24R', '25L'], style: 'faa', twr: '133.900', holds: ['Seavu', 'Riivr'], apt: 'LA' },
    { name: 'Kennedy', unit: 'Tower', freq: '119.100', rwys: ['31R', '22L'], style: 'faa', holds: [], apt: 'Kennedy' },
    { name: 'Schiphol', unit: 'Approach', freq: '121.200', rwys: ['18R', '06'], style: 'icao', twr: '118.280', holds: ['Artip', 'Sugol', 'River'], apt: 'Schiphol' }
  ];
  // keep the same frequency for the whole visit, across pages
  const F = (() => { try { const k = +sessionStorage.getItem('boplo-radio-field2'); if (FIELDS[k]) return FIELDS[k]; const i = Math.floor(Math.random() * FIELDS.length); sessionStorage.setItem('boplo-radio-field2', i); return FIELDS[i]; } catch { return rnd(FIELDS); } })(), faa = F.style === 'faa', tower = F.unit === 'Tower';
  let rw = rnd(F.rwys), qnh = 1006 + Math.floor(Math.random() * 18), wdir = 0, wspd = 0;
  const rwSay = r => r.split('').map(c => /\d/.test(c) ? NUM[+c] : c === 'L' ? 'left' : c === 'R' ? 'right' : c === 'C' ? 'centre' : '').join(' ');
  const setWind = () => { const h = parseInt(rw, 10) * 10; wdir = ((h + Math.round(between(-30, 30) / 10) * 10) % 360 + 360) % 360 || 360; wspd = Math.round(between(5, 16)); };
  setWind();
  const digits = n => String(n).split('').map(c => NUM[+c] ?? c).join(' ');
  const hdgSay = h => digits(String(h).padStart(3, '0'));
  const freqSay = f => { const [a, b] = f.split('.'); return `${digits(a)} ${faa ? 'point' : 'decimal'} ${digits(b.replace(/0+$/, '') || '0')}`; };
  const windSay = () => faa ? `wind ${hdgSay(wdir)} at ${wspd}` : `wind ${hdgSay(wdir)} degrees ${wspd} knots`;
  const qnhSay = () => faa ? `altimeter ${digits(Math.round(qnh * .02953 * 100))}` : `QNH ${digits(qnh)}`;
  const station = `${F.name} ${F.unit}`;
  const AIR = faa ? [['Delta', 2], ['United', 2], ['American', 2], ['Southwest', 2], ['JetBlue', 1], ['Alaska', 1], ['Spirit Wings', 1], ['FedEx', 1], ['Speedbird', 1], ['Lufthansa', 1], ['Virgin', 1], ['Cactus', 1]]
    : [['Speedbird', 3], ['Shamrock', 2], ['Iberia', 2], ['Vueling', 2], ['Ryanair', 2], ['Easy', 2], ['Lufthansa', 1], ['KLM', 1], ['Air France', 1], ['Swiss', 1], ['Emirates', 1], ['Qatari', 1], ['Air Europa', 1], ['Wizz Air', 1], ['Air Portugal', 1], ['Brussels Wings', 1], ['Channex', 1], ['Virgin', 1]];
  const AIRW = AIR.flatMap(([n, w]) => Array(w).fill(n));
  const LET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  // airline callsigns: ICAO style says the digits one by one and often ends in letters; FAA style groups the numbers
  const flight = () => {
    const al = rnd(AIRW), n = 1 + Math.floor(Math.random() * (chance(.5) ? 99 : 4999)), alpha = !faa && chance(.45);
    if (faa) { const s = String(n); const spoken = s.length === 4 ? `${+s.slice(0, 2)} ${s.slice(2) === '00' ? 'hundred' : s[2] === '0' ? 'zero ' + s[3] : +s.slice(2)}` : s.length === 3 ? `${s[0]} ${s[1] === '0' ? 'zero ' + s[2] : +s.slice(1)}` : s; return `${al} ${spoken}`; }
    const tail = alpha ? ' ' + say(rnd(LET.split('')) + rnd(LET.split(''))) : '';
    return `${al} ${digits(alpha ? n % 100 : n)}${tail}`;
  };
  const FL = () => { const fl = rnd([60, 70, 80, 90, 100, 110, 120, 130, 150, 170]); return faa ? (fl < 180 ? `${fl / 10 === Math.floor(fl / 10) ? digits(fl / 10).replace(/ /g, ' ') + ' thousand' : fl * 100}` : `flight level ${digits(fl)}`) : `flight level ${digits(String(fl).padStart(2, '0'))}`; };
  const ALT = () => { const a = rnd([3000, 4000, 5000, 6000, 7000]); return faa ? `${digits(a / 1000)} thousand` : `altitude ${digits(a / 1000)} thousand feet`; };
  const HDG = () => Math.round(between(1, 36)) * 10;
  const SPD = () => rnd([160, 170, 180, 190, 200, 210, 220, 230, 250]);
  const desc = faa ? 'descend and maintain' : 'descend';
  const ctrlOnly = (cs, text) => [['c', `${cs}, ${text}.`]];
  const rb = (cs, text) => [['p', `${text[0].toUpperCase() + text.slice(1)}, ${cs}.`]];
  const SCRIPTS = tower ? [
    () => { const a = flight(); return [['c', `${a}, ${windSay()}, runway ${rwSay(rw)}, cleared to land.`], ['p', `Cleared to land runway ${rwSay(rw)}, ${a}.`]]; },
    () => { const a = flight(); return [['c', `${a}, runway ${rwSay(rw)}, line up and wait.`], ['p', `Line up and wait runway ${rwSay(rw)}, ${a}.`]]; },
    () => { const a = flight(); return [['c', `${a}, runway ${rwSay(rw)}, ${windSay()}, cleared for take-off.`], ['p', `Cleared for take-off runway ${rwSay(rw)}, ${a}.`]]; },
    () => { const a = flight(); return [['p', `${station}, ${a}, ${faa ? 'six mile final' : 'established localiser'} runway ${rwSay(rw)}.`], ['c', `${a}, ${station}, continue approach, number ${digits(Math.round(between(2, 4)))}, ${windSay()}.`], ['p', `Continue, ${a}.`]]; },
    () => { const a = flight(), b = flight(); return [['c', `${a}, after the landing ${rnd(['Airbus', 'seven three seven', 'Embraer', 'seven eight seven'])} on short final, line up runway ${rwSay(rw)}, behind.`], ['p', `After the landing traffic, line up runway ${rwSay(rw)} behind, ${a}.`], ['c', `${b}, reduce to minimum approach speed, expect late landing clearance.`], ['p', `Minimum approach speed, ${b}.`]]; },
    () => { const a = flight(), g = freqSay(rnd(['121.900', '121.700', '118.705'])); return [['c', `${a}, vacate ${rnd(['left', 'right'])} via ${rnd(['Alpha Bravo', 'November One', 'Kilo', 'Bravo Four'])}, contact ground ${g}.`], ...rb(a, g)]; },
    () => { const a = flight(); return [['c', `${a}, go around, I say again, go around, ${faa ? 'fly runway heading, climb and maintain two thousand' : 'climb straight ahead altitude three thousand feet'}.`], ['p', `Going around, ${faa ? 'runway heading, two thousand' : 'straight ahead, three thousand feet'}, ${a}.`]]; },
    () => { const a = flight(), d = freqSay(rnd(['125.800', '120.520', '124.475', '135.050'])); return [['c', `${a}, contact ${faa ? 'departure' : 'London Control'} ${d}, good day.`], ['p', `${d[0].toUpperCase() + d.slice(1)}, good day, ${a}.`]]; },
    () => { const a = flight(), b = flight(); return [['c', `${a}, ${windSay()}, runway ${rwSay(rw)}, cleared to land.`], ['p', `Cleared to land, ${a}.`], ['c', `${b}, continue approach, ${windSay()}.`], ['p', `Continue, ${b}.`]]; }
  ] : [
    () => { const a = flight(), f = FL(); return [['c', `${a}, ${desc} ${f}.`], ...rb(a, `${desc[0].toUpperCase() + desc.slice(1)} ${f}`)]; },
    () => { const a = flight(), h = HDG(), sp = SPD(); return [['c', `${a}, turn ${rnd(['left', 'right'])} heading ${hdgSay(h)}, reduce speed ${digits(sp)} knots.`], ...rb(a, `Heading ${hdgSay(h)}, speed ${digits(sp)}`)]; },
    () => { const a = flight(), h = HDG(); return [['c', `${a}, turn ${rnd(['left', 'right'])} heading ${hdgSay(h)}, ${faa ? 'maintain three thousand until established, cleared ILS runway ' + rwSay(rw) + ' approach' : 'cleared ILS approach runway ' + rwSay(rw) + ', report established'}.`], ...rb(a, `Heading ${hdgSay(h)}, cleared ILS ${rwSay(rw)}`)]; },
    () => { const a = flight(), f = F.twr; return [['c', `${a}, contact ${F.apt} Tower ${freqSay(f)}, ${rnd(['goodbye', 'good day', 'bye bye'])}.`], ...rb(a, `${freqSay(f)}`)]; },
    () => { const a = flight(), f = FL(), al = ALT(); return [['p', `${station}, ${a}, ${f}, information ${rnd(PH)}.`], ['c', `${a}, ${station}, ${desc} ${al}, ${qnhSay()}, ${faa ? 'expect ILS runway ' + rwSay(rw) : 'vectors ILS runway ' + rwSay(rw)}.`], ...rb(a, `${desc[0].toUpperCase() + desc.slice(1)} ${al}, ${qnhSay()}`)]; },
    () => { const a = flight(), b = flight(), c = flight(), s1 = SPD(), s2 = SPD(); return [['c', `${a}, reduce speed ${digits(s1)} knots.`], ...rb(a, `${digits(s1)} knots`), ...(() => { const al = ALT(); return [['c', `${b}, ${desc} ${al}.`], ...rb(b, `${desc} ${al}`)]; })(), ['c', `${c}, maintain ${digits(s2)} knots to four miles.`], ...rb(c, `${digits(s2)} to four miles`)]; },
    () => { const a = flight(), h = F.holds.length ? rnd(F.holds) : 'the hold'; return [['c', `${a}, hold at ${h}, ${f2()}, expect onward clearance in ${digits(Math.round(between(5, 18)))} minutes.`], ...rb(a, `Hold at ${h}`)]; },
    () => { const a = flight(), n = digits(Math.round(between(3, 9))); return [['c', `${a}, ${faa ? 'traffic twelve o’clock, five miles, a seven three seven same direction, report it in sight' : 'you are number ' + n + ' in traffic, expect vectors for spacing'}.`], ['p', faa ? `${rnd(['Looking', 'Traffic in sight'])}, ${a}.` : `Number ${n}, ${a}.`]]; },
    () => { const a = flight(); return [['p', `${a}, established localiser ${rwSay(rw)}.`], ['c', `${a}, ${faa ? 'roger, contact Tower ' + freqSay(F.twr) : 'descend on the glidepath, contact Tower ' + freqSay(F.twr)}.`], ...rb(a, `Tower ${freqSay(F.twr)}`)]; },
    () => { const a = flight(), al = ALT(); return [['c', `${a}, say again your callsign.`], ['p', `${a}.`], ['c', `${a}, thank you, ${desc} ${al}.`], ...rb(a, `${desc} ${al}`)]; },
    () => { qnh += chance(.5) ? 1 : -1; return [['c', `All stations, ${station}, ${faa ? 'new altimeter ' + digits(Math.round(qnh * .02953 * 100)) : 'QNH now ' + digits(qnh)}.`]]; },
    () => ctrlOnly(flight(), `${rnd(['expedite descent', 'no speed restriction', 'resume own navigation', 'fly direct ' + (F.holds.length ? rnd(F.holds) : 'the final approach fix')])}`)
  ];
  function f2() { return faa ? 'as published, maintain one one thousand' : `${FL()}`; }
  /* ---------- sound: hiss, squelch and mic clicks from Web Audio, voices from speech synthesis ---------- */
  let ctx = null, hiss = null, squelch = null, voices = [], vC = null, vP = [];
  const pickVoices = () => {
    voices = synth ? synth.getVoices().filter(v => /^en(-|_|$)/i.test(v.lang)) : [];
    const pref = faa ? /en-US/i : F.style === 'icao' ? /en-GB|en-IE|en-US|en-AU/i : /en-GB|en-IE|en-AU/i, good = voices.filter(v => pref.test(v.lang)), pool = (good.length ? good : voices).sort((a, b) => (/(premium|enhanced|natural|neural|siri)/i.test(b.name) - /(premium|enhanced|natural|neural|siri)/i.test(a.name)));
    vC = pool[0] || null; vP = voices.filter(v => v !== vC).sort(() => Math.random() - .5).slice(0, 4);
  };
  if (synth) { pickVoices(); synth.onvoiceschanged = pickVoices; }
  function audio() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC();
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = .6;
    hiss = ctx.createGain(); hiss.gain.value = 0;
    squelch = ctx.createGain(); squelch.gain.value = 0;
    src.connect(bp); bp.connect(hiss); hiss.connect(ctx.destination);
    const sb = ctx.createBiquadFilter(); sb.type = 'highpass'; sb.frequency.value = 900; bp.connect(sb); sb.connect(squelch); squelch.connect(ctx.destination);
    src.start();
    return ctx;
  }
  const BG = .012, KEYED = .035;
  const click = () => { if (!ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = 1300; g.gain.setValueAtTime(.04, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .05); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .06); };
  const key = on => { if (!ctx) return; const t = ctx.currentTime; click(); hiss.gain.setTargetAtTime(on ? KEYED : BG, t, .02); if (!on) { squelch.gain.setValueAtTime(.09, t); squelch.gain.exponentialRampToValueAtTime(.0001, t + .22); } };

  /* ---------- player ---------- */
  let on = false, playing = false, timer = 0, lineNo = 0, current = '', paused = false;
  const blocked = () => document.hidden || !!document.getElementById('sim')?.open || /^#radio/.test(location.hash) || !!document.querySelector('[data-rmic].live,.mic.live');
  function speak(who, text, done) {
    if (!synth) return done();
    const u = new SpeechSynthesisUtterance(text);
    const v = who === 'c' ? vC : vP[lineNo % Math.max(1, vP.length)] || vC; if (v) { u.voice = v; u.lang = v.lang; } else u.lang = faa ? 'en-US' : 'en-GB';
    u.rate = who === 'c' ? 1.22 : between(1.15, 1.32); u.pitch = who === 'c' ? .95 : between(.82, 1.18); u.volume = who === 'c' ? .6 : .45;
    let ended = false; const end = () => { if (ended) return; ended = true; key(false); setCaption(''); done(); };
    u.onend = end; u.onerror = end; setTimeout(end, 1800 + text.length * 85);
    key(true); setCaption((who === 'c' ? F.unit.toUpperCase() : 'PILOT') + ' · ' + text);
    synth.speak(u); lineNo++;
  }
  function next() {
    clearTimeout(timer); if (!on) return;
    if (blocked()) { paused = true; paint(); timer = setTimeout(next, 1500); return; }
    if (paused) { paused = false; paint(); }
    let s = null; for (let i = 0; i < 6 && !s; i++) s = rnd(SCRIPTS)();
    let i = 0; playing = true;
    const step = () => {
      if (!on) { playing = false; return; }
      if (blocked()) { synth?.cancel(); key(false); playing = false; timer = setTimeout(next, 1500); return; }
      if (i >= s.length) { playing = false; timer = setTimeout(next, chance(.15) ? between(2500, 5000) : between(350, 1400)); return; }
      const [who, text] = s[i++]; speak(who, text, () => { timer = setTimeout(step, between(200, 650)); });
    };
    step();
  }
  function start() {
    const c = audio(); if (c && c.state === 'suspended') c.resume();
    if (hiss && ctx) hiss.gain.setTargetAtTime(BG, ctx.currentTime, .3);
    try { synth?.cancel(); const u = new SpeechSynthesisUtterance(''); u.volume = 0; synth?.speak(u); } catch { }
    on = true; waiting = false; paint(); timer = setTimeout(next, 900);
  }
  function stop() { on = false; clearTimeout(timer); try { synth?.cancel(); } catch { } if (hiss && ctx) hiss.gain.setTargetAtTime(0, ctx.currentTime, .1); setCaption(''); paint(); }

  /* ---------- the switch ---------- */
  const css = document.createElement('style');
  css.textContent = `.bradio{position:fixed;right:16px;bottom:16px;z-index:60;display:flex;align-items:center;gap:8px;max-width:min(420px,calc(100vw - 32px));font:600 13px/1.2 Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#E6EEFF;pointer-events:none}
  .bradio button{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px 0 10px;border-radius:999px;border:1px solid rgba(158,216,255,.25);background:rgba(4,11,34,.88);color:inherit;font:inherit;cursor:pointer;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 10px 30px rgba(0,0,0,.25);white-space:nowrap}
  .bradio button:hover{border-color:rgba(158,216,255,.5)}
  .bradio svg{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
  .bradio .bars{display:inline-flex;gap:2px;align-items:flex-end;height:14px}.bradio .bars i{width:3px;height:4px;border-radius:2px;background:#9ED8FF;opacity:.5}
  .bradio.on .bars i{animation:bradio 1.1s ease-in-out infinite}.bradio.on .bars i:nth-child(2){animation-delay:-.35s}.bradio.on .bars i:nth-child(3){animation-delay:-.7s}
  .bradio.on.tx .bars i{animation-duration:.45s;opacity:1}
  @keyframes bradio{50%{height:14px}}
  .bradio .cap{pointer-events:none;font-weight:500;font-size:12px;color:rgba(230,238,255,.85);background:rgba(4,11,34,.75);padding:6px 10px;border-radius:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px;opacity:0;transition:opacity .2s}
  .bradio .cap.show{opacity:1}
  .bradio.off button{animation:bradiop 2.6s ease-out 3}
  @keyframes bradiop{0%{box-shadow:0 0 0 0 rgba(10,98,255,.55),0 10px 30px rgba(0,0,0,.25)}70%{box-shadow:0 0 0 12px rgba(10,98,255,0),0 10px 30px rgba(0,0,0,.25)}}
  body.has-tabbar .bradio{bottom:calc(96px + env(safe-area-inset-bottom,0px))}
  @media (max-width:960px){.bradio{bottom:calc(16px + env(safe-area-inset-bottom,0px))}.bradio .cap{display:none}}
  @media (max-width:960px){.shell ~ .bradio,.bradio.in-app{bottom:calc(96px + env(safe-area-inset-bottom,0px))}}
  .bradio.lift{bottom:96px}@media (max-width:960px){.bradio.lift{bottom:calc(160px + env(safe-area-inset-bottom,0px))}.bradio .lbl{max-width:150px;overflow:hidden;text-overflow:ellipsis}}
  @media print{.bradio{display:none}}`;
  document.head.append(css);
  const el = document.createElement('div'); el.className = 'bradio off'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Tower radio');
  el.innerHTML = `<span class="cap" aria-live="off"></span><button type="button" aria-pressed="false" title="Ambient air traffic control radio"><svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg><span class="lbl">ATC radio</span><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span></button>`;
  const btn = el.querySelector('button'), lbl = el.querySelector('.lbl'), cap = el.querySelector('.cap');
  let waiting = false;
  function setCaption(t) { current = t; cap.textContent = t; cap.classList.toggle('show', !!t); el.classList.toggle('tx', !!t); }
  function paint() {
    el.classList.toggle('on', on); el.classList.toggle('off', !on && !waiting); btn.setAttribute('aria-pressed', String(on));
    lbl.textContent = on ? (paused ? 'Radio paused' : `${F.name} ${F.unit} · ${F.freq}`) : waiting ? 'Tap anywhere for radio' : 'ATC radio';
    btn.title = on ? 'Turn the tower radio off' : 'Ambient air traffic control radio: invented exchanges, voiced by your device';
  }
  btn.addEventListener('click', e => { e.stopPropagation(); if (on || waiting) { waiting = false; store.set('off'); stop(); } else { store.set('on'); start(); } });
  const mount = () => { document.body.append(el); el.classList.toggle('in-app', !!document.querySelector('.tabbar, #app')); paint(); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  const lift = () => el.classList.toggle('lift', location.hash === '#ask'); lift(); addEventListener('hashchange', lift);
  // remembered "on": resume at the first interaction anywhere on the page
  if (store.get() === 'on') {
    waiting = true; paint();
    const go = () => { removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); if (waiting && store.get() === 'on') start(); };
    addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && on) { try { synth?.cancel(); } catch { } key(false); } });
  if (!synth) btn.title = 'Your browser can’t play the radio voices.';
})();
