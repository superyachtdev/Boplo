// Autopilot check: node scripts/sim-autopilot-check.cjs (full trip per type: take-off, cruise, approach, flare, rollout).
// Fly a full trip with the autopilot laws: take off from runway A heading north, cruise, land on runway B 20 km north.
global.window = {}; require(__dirname + '/../dist/flight-aircraft.js'); require(__dirname + '/../dist/flight-physics.js');
const A = window.BoploAircraft, PH = window.BoploPhysics, KT = PH.KT, cl = (v, a, b) => Math.max(a, Math.min(b, v));
for (const T of A.TYPES) {
  const b = A.build(T.id), fm = PH.create(T.id, T.perf, { tail: T.gear.type === 'tail', groundAt: (x, z) => z > 9000 && z < 11000 ? 40 * Math.sin(x / 500) + 40 : 0, groundAtt: b.groundAtt }), { s, c, p } = fm, dt = 1 / 60;
  const Ld = 20000, TDZ = 300, DG = 330 * .3048 / 1852, cruise = 700, run = 1200;
  fm.reset({ hdg: 0 }); let t = 0, landedOnce = false, events = [], maxBank = 0, minIas = 999, phase0 = '';
  while (t < 1500 && !s.crashed) {
    const remain = Ld + run * .5 - s.z, approach = remain < 7000;
    let phase = s.ground ? (landedOnce ? 'rollout' : 'takeoff') : 'air';
    const prof = Math.min(cruise, Math.max(0, s.z - 400) * .09, Math.max(0, remain - run * .5 - TDZ - 60) * DG + 0);
    const tg = { phase, trk: -s.x * .02, alt: prof, spd: approach ? (s.agl < 60 ? p.appr : p.appr + 10) : p.cruise * .9, flaps: approach ? (remain < 4000 ? p.notch.length - 1 : Math.min(1, p.notch.length - 1)) : 0, bankMax: 20 };
    if (!s.ground && approach && s.agl < 5) tg.phase = 'flare'; tg.approach = approach;
    if (!s.ground && !approach && prof - s.alt > 30) tg.thr = 1, tg.spd = undefined;
    if (approach && !s.ground) tg.alt = Math.max(0, remain - run * .5 - TDZ) * DG;
    if (tg.phase !== phase0) { events.push(`${tg.phase}@${Math.round(s.z)}m ${(s.ias / KT).toFixed(0)}kt`); phase0 = tg.phase; }
    PH.pilot(fm, tg, dt); fm.step(dt); t += dt;
    if (!s.ground) { maxBank = Math.max(maxBank, Math.abs(s.bank)); minIas = Math.min(minIas, s.ias / KT); }
    if (s.touch && s.ground && !landedOnce && s.z > Ld - 2000 && s.touch.t > t - .1) { landedOnce = true; events.push(`TOUCH ${s.touch.fpm.toFixed(0)}fpm p${s.touch.pitch.toFixed(1)} at ${Math.round(s.z - (Ld - run * .5))}m past thr ${(s.ias / KT).toFixed(0)}kt`); }
    if (landedOnce && s.gs < .5) { events.push(`STOP ${Math.round(s.z - (Ld - run * .5))}m past thr, x ${s.x.toFixed(1)}`); break; }
    if (s.stalled) { events.push('STALL ' + Math.round(s.z)); }
  }
  console.log(`${T.id}: ${s.crashed ? 'CRASH ' + s.crash : ''} ${events.slice(0, 12).join(' > ')} | maxBank ${maxBank.toFixed(0)} minIas ${minIas.toFixed(0)} t ${t.toFixed(0)}s`);
}
