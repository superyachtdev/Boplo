// Flight-model checks: node scripts/sim-physics-check.cjs (take-off, climb, top speed, stall speeds, landing per type).
global.window = {}; require(__dirname + '/../dist/flight-aircraft.js'); require(__dirname + '/../dist/flight-physics.js');
const A = window.BoploAircraft, PH = window.BoploPhysics, KT = PH.KT, cl = (v, a, b) => Math.max(a, Math.min(b, v));
for (const T of A.TYPES) {
  const b = A.build(T.id), fm = PH.create(T.id, T.perf, { tail: T.gear.type === 'tail', groundAt: () => 0, groundAtt: b.groundAtt }), { s, c, p } = fm, dt = 1 / 60, out = [];
  let thCmd = 0, mode = 'pitch';
  const step = () => { if (mode === 'pitch') c.elevator = cl((thCmd - s.pitch) * .08 - s.w[1] * 57.3 * .02, -1, 1); c.aileron = cl(-s.bank * .05 - s.w[0] * .3, -1, 1); fm.step(dt); };
  const kt = () => (s.ias / KT).toFixed(0), fpm = () => (s.vs / .3048 * 60).toFixed(0);
  // take-off
  fm.reset({ hdg: 90, groundAtt: b.groundAtt }); c.throttle = 1; mode = 'manual'; let lo = null, t = 0;
  while (t < 90 && !s.crashed) { const ias = s.ias / KT; c.elevator = p.tail ? (ias < p.vr * .6 ? -.45 : ias > p.vr ? .45 : 0) : (ias > p.vr ? .55 : 0); if (!s.ground) { mode = 'pitch'; thCmd = 8; break; } fm.step(dt); t += dt; }
  lo = `${kt()} kt, ${Math.round(s.x)} m`;
  for (let i = 0; i < 60 * 90; i++) { thCmd = cl(thCmd + (s.ias / KT - T.perf.vs * 1.45) * .002, -5, 15); step(); }
  out.push(`lift-off ${lo} | climb ${fpm()} fpm @${kt()} (book ${T.perf.climb} SL)`);
  for (let i = 0; i < 60 * 240; i++) { thCmd = cl(thCmd - s.vs * .002, -5, 10); step(); }
  out.push(`full-power level ${kt()} kt (book ${T.perf.vmax}) vs ${fpm()}`);
  c.throttle = .7; c.trim = fm.trimFor(s.tas * .93); mode = 'hands'; c.elevator = 0; for (let i = 0; i < 60 * 90; i++) { c.aileron = cl(-s.bank * .05 - s.w[0] * .3, -1, 1); fm.step(dt); }
  out.push(`70% hands-off ${kt()} kt ${fpm()} fpm`);
  mode = 'pitch'; thCmd = s.pitch;
  for (const fl of [0, p.notch.length - 1]) {
    c.flaps = fl; c.throttle = 0; let st = null; for (let i = 0; i < 60 * 90 && !st; i++) { thCmd = cl(thCmd - s.vs * .01, -5, 30); step(); if (s.stalled) st = kt(); }
    out.push(`stall ${p.notch[fl].label}: ${st} kt (book ${fl ? p.vso : T.perf.vs})`);
    c.throttle = 1; thCmd = -2; for (let i = 0; i < 60 * 8; i++) step(); for (let i = 0; i < 60 * 30; i++) { thCmd = cl(thCmd - s.vs * .002, -5, 10); step(); }
  }
  // descend and land
  c.flaps = p.notch.length - 1; let td = null;
  for (let i = 0; i < 60 * 900 && !td && !s.crashed; i++) {
    const desVS = s.agl > 10 ? -2.5 : -Math.max(.3, s.agl * .22);
    thCmd = cl(thCmd + (desVS - s.vs) * .01, -8, 12); c.throttle = s.agl < 4 ? 0 : cl(.25 + (p.appr - s.ias / KT) * .04, 0, 1); step(); if (s.touch) td = s.touch;
  }
  out.push(`landing ${s.crashed ? 'CRASH: ' + s.crash : `${td.fpm.toFixed(0)} fpm, pitch ${td.pitch.toFixed(1)}°, ${kt()} kt`}`);
  c.brake = 1; mode = 'manual'; c.elevator = 0; let d = 0; for (let i = 0; i < 60 * 90 && s.gs > .3; i++) { fm.step(dt); d += s.gs * dt; } out.push(`braked stop ${d.toFixed(0)} m`);
  console.log(`${T.name}: ` + out.join(' | '));
}
