/* Boplo tower radio: an optional, never-ending ambient ATC frequency.
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
  const FIELDS = [
    { name: 'Popham', unit: 'Radio', freq: '129.805', rwys: ['26', '08'], style: 'uk' }, { name: 'Wycombe', unit: 'Tower', freq: '126.555', rwys: ['24', '06'], style: 'uk' },
    { name: 'Valencia', unit: 'Tower', freq: '118.155', rwys: ['12', '30'], style: 'icao' }, { name: 'Cuatro Vientos', unit: 'Tower', freq: '118.700', rwys: ['28', '10'], style: 'icao' },
    { name: 'Bournemouth', unit: 'Tower', freq: '125.605', rwys: ['26', '08'], style: 'uk' }, { name: 'Shoreham', unit: 'Tower', freq: '124.930', rwys: ['20', '02'], style: 'uk' },
    { name: 'Palo Alto', unit: 'Tower', freq: '118.6', rwys: ['31', '13'], style: 'faa' }, { name: 'Centennial', unit: 'Tower', freq: '118.9', rwys: ['35R', '17L'], style: 'faa' }
  ];
  // keep the same airfield for the whole visit, across pages
  const F = (() => { try { const k = +sessionStorage.getItem('boplo-radio-field'); if (FIELDS[k]) return FIELDS[k]; const i = Math.floor(Math.random() * FIELDS.length); sessionStorage.setItem('boplo-radio-field', i); return FIELDS[i]; } catch { return rnd(FIELDS); } })(), faa = F.style === 'faa';
  let rw = F.rwys[0], qnh = 1009 + Math.floor(Math.random() * 14), wdir = 0, wspd = 0;
  const rwSay = r => r.split('').map(c => /\d/.test(c) ? NUM[+c] : c === 'L' ? 'left' : c === 'R' ? 'right' : '').join(' ');
  const setWind = () => { const h = parseInt(rw, 10) * 10; wdir = ((h + Math.round(between(-40, 40) / 10) * 10) % 360 + 360) % 360 || 360; wspd = Math.round(between(4, 14)); };
  setWind();
  const windSay = () => faa ? `wind ${say(String(wdir).padStart(3, '0'))} at ${wspd}` : `surface wind ${say(String(wdir).padStart(3, '0'))} degrees ${wspd} knots`;
  const qnhSay = () => faa ? `altimeter ${say(String(Math.round(qnh * .02953 * 100)))}` : `QNH ${say(String(qnh))}`;
  const station = `${F.name} ${F.unit}`;
  const mkReg = () => faa ? 'N' + (100 + Math.floor(Math.random() * 899)) + rnd('ABCDEFGHJKLMNPRSTUVWXYZ'.split('')) + rnd('ABCDEFGHJKLMNPRSTUVWXYZ'.split('')) : (rnd(['G', 'G', 'G', 'EC', 'D', 'F', 'EI']) + '-' + Array.from({ length: 4 }, () => rnd('ABCDEFGHIJKLMNOPRSTUVWXYZ'.split(''))).join('')).slice(0, 6);
  const TYPES = faa ? ['Cessna', 'Skyhawk', 'Cherokee', 'Archer', 'Cirrus', 'Diamond Star'] : ['PA-28', 'Cessna 152', 'Cessna 172', 'DA40', 'Tecnam', 'Robin'];
  const traffic = () => { const r = mkReg(), t = rnd(TYPES), full = faa ? `${t} ${say(r.slice(1))}` : say(r.replace('-', '')), short = faa ? `${t.split(' ')[0]} ${say(r.slice(-3))}` : `${say(r[0])} ${say(r.slice(-2))}`; return { full, short, t }; };
  const hp = rnd(['Alpha', 'Alpha One', 'Bravo', 'Charlie']);
  const SCRIPTS = [
    () => { const a = traffic(); return [['p', `${station}, ${a.full}, radio check, ${F.freq.split('.').map(say).join(' decimal ')}.`], ['c', `${a.short}, ${station}, readability five.`]]; },
    () => { const a = traffic(); return [['p', `${station}, ${a.full}, ${a.t}, at the flying club, request taxi for circuits.`], ['c', `${a.short}, taxi holding point ${hp}, runway ${rwSay(rw)}, ${qnhSay()}.`], ['p', `Holding point ${hp}, runway ${rwSay(rw)}, ${qnhSay()}, ${a.short}.`]]; },
    () => { const a = traffic(); return [['p', `${a.short}, ready for departure.`], ['c', `${a.short}, runway ${rwSay(rw)}, cleared for take-off, ${windSay()}.`], ['p', `Runway ${rwSay(rw)}, cleared for take-off, ${a.short}.`]]; },
    () => { const a = traffic(); return [['p', `${a.short}, downwind to land.`], ['c', chance(.5) ? `${a.short}, number one.` : `${a.short}, number two, follow the ${rnd(TYPES)} on base.`], ['p', chance(.5) ? `${a.short}.` : `Traffic in sight, ${a.short}.`]]; },
    () => { const a = traffic(); return [['p', `${a.short}, final.`], ['c', `${a.short}, runway ${rwSay(rw)}, cleared to land, ${windSay()}.`], ['p', `Cleared to land runway ${rwSay(rw)}, ${a.short}.`]]; },
    () => { const a = traffic(); return [['p', `${a.short}, final, touch and go.`], ['c', `${a.short}, runway ${rwSay(rw)}, cleared touch and go, ${windSay()}.`], ['p', `Cleared touch and go, ${a.short}.`]]; },
    () => { const a = traffic(); return [['p', `${a.short}, going around.`], ['c', `${a.short}, roger, report downwind.`], ['p', `Wilco, ${a.short}.`]]; },
    () => { const a = traffic(); return [['p', `${station}, ${a.full}, ${rnd(['five miles south', 'overhead the reservoir', 'ten miles north-west', 'at the town'])}, two thousand feet, inbound for landing, information ${rnd(PH)}.`], ['c', `${a.short}, join ${rnd(['left', 'right'])} hand downwind runway ${rwSay(rw)}, ${qnhSay()}, report downwind.`], ['p', `Join downwind runway ${rwSay(rw)}, ${qnhSay()}, wilco, ${a.short}.`]]; },
    () => { const a = traffic(); return [['p', `${a.short}, final, full stop. First solo.`], ['c', `${a.short}, runway ${rwSay(rw)}, cleared to land, ${windSay()}. And congratulations.`], ['p', `Cleared to land, thank you, ${a.short}.`]]; },
    () => { const a = traffic(); return [['c', `${a.short}, traffic is a ${rnd(TYPES)} ${rnd(['one mile ahead', 'in your two o’clock, a mile and a half', 'on a long final'])}, same level.`], ['p', chance(.6) ? `Traffic in sight, ${a.short}.` : `Looking, ${a.short}.`]]; },
    () => { const a = traffic(); return [['p', `${a.short}, request wind check.`], ['c', `${a.short}, ${windSay()}.`]]; },
    () => { qnh += chance(.5) ? 1 : -1; return [['c', `All stations, ${station}, ${qnhSay()}.`]]; },
    () => { const a = traffic(); return [['p', `${a.short}, vacated, taxiing to the club.`], ['c', `${a.short}, roger.`]]; },
    () => { if (!chance(.25)) return null; rw = rw === F.rwys[0] ? F.rwys[1] : F.rwys[0]; setWind(); return [['c', `All stations, ${station}, runway in use is now ${rwSay(rw)}, ${windSay()}.`]]; }
  ];

  /* ---------- sound: hiss, squelch and mic clicks from Web Audio, voices from speech synthesis ---------- */
  let ctx = null, hiss = null, squelch = null, voices = [], vC = null, vP = [];
  const pickVoices = () => {
    voices = synth ? synth.getVoices().filter(v => /^en(-|_|$)/i.test(v.lang)) : [];
    const pref = faa ? /en-US/i : /en-GB|en-IE|en-AU/i, good = voices.filter(v => pref.test(v.lang)), pool = (good.length ? good : voices).sort((a, b) => (/(premium|enhanced|natural|neural|siri)/i.test(b.name) - /(premium|enhanced|natural|neural|siri)/i.test(a.name)));
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
    u.rate = who === 'c' ? 1.08 : between(1.02, 1.16); u.pitch = who === 'c' ? .95 : between(.85, 1.15); u.volume = .55;
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
      if (i >= s.length) { playing = false; timer = setTimeout(next, between(6000, 15000)); return; }
      const [who, text] = s[i++]; speak(who, text, () => { timer = setTimeout(step, between(900, 2200)); });
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
  el.innerHTML = `<span class="cap" aria-live="off"></span><button type="button" aria-pressed="false" title="Ambient air traffic control radio"><svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg><span class="lbl">Tower radio</span><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span></button>`;
  const btn = el.querySelector('button'), lbl = el.querySelector('.lbl'), cap = el.querySelector('.cap');
  let waiting = false;
  function setCaption(t) { current = t; cap.textContent = t; cap.classList.toggle('show', !!t); el.classList.toggle('tx', !!t); }
  function paint() {
    el.classList.toggle('on', on); el.classList.toggle('off', !on && !waiting); btn.setAttribute('aria-pressed', String(on));
    lbl.textContent = on ? (paused ? 'Radio paused' : `${F.name} ${F.unit} · ${F.freq}`) : waiting ? 'Tap anywhere for radio' : 'Tower radio';
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
