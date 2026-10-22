/* Boplo Flight — flight model for the simulator.
   A rigid-body model sized for light training aircraft: lift from angle of attack (so the wing stalls at its critical angle,
   not at a speed), induced and parasite drag, propeller thrust that falls with speed, pitch/roll/yaw dynamics with
   weathervane and dihedral stability, adverse yaw and prop effects, flaps in the type's real notches, elevator trim,
   and a ground model with nosewheel/tailwheel steering, brakes and rolling friction.
   It is tuned to feel right and to match book stall, climb and top speeds, not certified data: a practice toy, not an FSTD.
   World axes: x east, y up, z north (metres). Body axes: F nose, U top, R right wing. */
(function (root) {
  'use strict';
  const G = 9.80665, KT = 0.514444, D2R = Math.PI / 180, R2D = 180 / Math.PI, HP = 745.7;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const rho = h => 1.225 * Math.pow(Math.max(.2, 1 - 2.25577e-5 * Math.max(-500, h)), 4.2559);

  // Aircraft data: mass (kg, typical training weight), wing area (m²), engine (hp), flap notches (deg, label),
  // speeds in knots: vs (clean stall), vso (full-flap stall), vfe, vno, vne, vr, appr, cruise, vmax, wheelbase (m), gear type.
  const DATA = {
    c152: { m: 757, S: 14.9, hp: 110, flaps: [[0, 'UP'], [10, '10°'], [20, '20°'], [30, '30°']], vso: 36, vfe: 85, vno: 111, vne: 149, wb: 1.5 },
    c172: { m: 1043, S: 16.2, hp: 160, flaps: [[0, 'UP'], [10, '10°'], [20, '20°'], [30, '30°']], vso: 40, vfe: 85, vno: 129, vne: 163, wb: 1.65 },
    pa28: { m: 1055, S: 15.8, hp: 160, flaps: [[0, 'UP'], [10, '10°'], [25, '25°'], [40, '40°']], vso: 44, vfe: 103, vno: 126, vne: 160, wb: 1.9 },
    da40: { m: 1150, S: 13.5, hp: 180, flaps: [[0, 'UP'], [20, 'T/O'], [42, 'LDG']], vso: 49, vfe: 91, vno: 129, vne: 178, wb: 1.7 },
    da20: { m: 720, S: 11.6, hp: 125, flaps: [[0, 'UP'], [15, 'T/O'], [40, 'LDG']], vso: 39, vfe: 100, vno: 118, vne: 164, wb: 1.6 },
    p2008: { m: 650, S: 11.6, hp: 100, flaps: [[0, 'UP'], [15, 'T/O'], [35, 'LDG']], vso: 35, vfe: 70, vno: 108, vne: 138, wb: 1.45 },
    dr400: { m: 900, S: 13.6, hp: 118, flaps: [[0, 'UP'], [15, 'T/O'], [60, 'LDG']], vso: 44, vfe: 92, vno: 140, vne: 166, wb: 1.6 },
    sr20: { m: 1386, S: 13.5, hp: 215, flaps: [[0, 'UP'], [16, '50%'], [32, 'FULL']], vso: 50, vfe: 104, vno: 165, vne: 200, wb: 2.1 },
    cub: { m: 550, S: 16.6, hp: 65, flaps: [[0, '—']], vso: 33, vfe: 0, vno: 80, vne: 106, wb: 5 }
  };

  function params(id, perf, tail) {
    const d = DATA[id] || DATA.c172, P = perf, W = d.m * G;
    const span = { c152: 10.1, c172: 11, pa28: 10.7, da40: 11.9, da20: 10.9, p2008: 9, dr400: 8.72, sr20: 11.7, cub: 10.7 }[id] || 11;
    const AR = span * span / d.S, k = 1 / (Math.PI * .76 * AR), CLa = 2 * Math.PI * AR / (AR + 2.2) * .95;
    const qs = v => .5 * 1.225 * (v * KT) ** 2 * d.S;
    const CLmax = W / qs(P.vs), CLmaxF = W / qs(d.vso || P.vs);
    const maxDeg = d.flaps[d.flaps.length - 1][0] || 1;
    const notch = d.flaps.map(([deg, label]) => { const f = deg / maxDeg; const dCLmax = (CLmaxF - CLmax) * Math.pow(f, .8); return { deg, label, dCLmax, dCL0: dCLmax * .85, dCD: .055 * Math.pow(deg / 40, 1.6) }; });
    const a0 = -2.2 * D2R, aStall = a0 + CLmax / CLa;
    // propeller: thrust = η·P / sqrt(V² + V0²), static thrust about 14 N per hp
    const eta = .8, V0 = eta * HP / 19;
    const thrustAt = (V, pwr) => eta * pwr / Math.sqrt(V * V + V0 * V0);
    // parasite drag from the top speed at full power
    const vmax = P.vmax * KT, CLv = W / qs(P.vmax), CD0 = Math.max(.018, thrustAt(vmax, d.hp * HP) / qs(P.vmax) - k * CLv * CLv);
    return { ...d, ...P, id, W, span, AR, k, CLa, CLmax, a0, aStall, notch, eta, V0, CD0, thrustAt, Vref: P.cruise * KT, tail: !!tail };
  }

  function create(id, perf, opts = {}) {
    const p = params(id, perf, opts.tail);
    const ground = opts.groundAt || (() => 0), surface = opts.surfaceAt || (() => 'paved');
    const c = { elevator: 0, aileron: 0, rudder: 0, throttle: 0, flaps: 0, trim: 0, brake: 0, parking: false, carbHeat: false, autoRudder: true };
    const s = {};
    function reset({ x = 0, z = 0, alt = 0, hdg = 0, airborne = false, speed = 0, pitch = 0 } = {}) {
      const h = hdg * D2R, th = pitch * D2R;
      s.F = norm([Math.sin(h) * Math.cos(th), Math.sin(th), Math.cos(h) * Math.cos(th)]); s.R = [Math.cos(h), 0, -Math.sin(h)]; s.U = norm(cross(s.F, s.R));
      s.x = x; s.z = z; s.alt = alt; s.v = scale(s.F, airborne ? speed : 0); s.w = [0, 0, 0]; s.ground = !airborne; s.power = airborne ? .65 : 0; s.rpm = airborne ? 2300 : 0;
      s.crashed = false; s.crash = ''; s.touch = null; s.landed = false; s.t = 0; s.stallT = 0; s.buffet = 0; s.wingDrop = 0; s.g = 1; s.airT = airborne ? 30 : 0;
      if (p.tail && !airborne) tilt(opts.groundAtt || 11);
      Object.assign(c, { elevator: 0, aileron: 0, rudder: 0, brake: 0, parking: !airborne && !!opts.parkingAtStart });
      c.throttle = airborne ? .65 : 0; c.flaps = 0; c.trim = airborne ? trimFor(speed) : .15;
      derive();
    }
    // nose-up rotation about the right wing, used for the tailwheel sitting attitude
    function tilt(deg) { const a = deg * D2R, F = s.F, U = s.U; s.F = norm(add(scale(F, Math.cos(a)), U, Math.sin(a))); s.U = norm(cross(s.F, s.R)); }
    // trim position that holds a given airspeed hands-off in level flight
    function trimFor(Vms) { const n = p.notch[c.flaps] || p.notch[0], CL = p.W / (.5 * 1.225 * Vms * Vms * p.S), a = p.a0 - n.dCL0 / p.CLa + CL / p.CLa; return clamp((a * R2D - 4) / 9, -1, 1); }
    const trimAlpha = () => (4 + c.trim * 9) * D2R; // trim range: about −5° to +13° angle of attack

    function CLof(a, n) {
      const a0 = p.a0 - n.dCL0 / p.CLa, aS = p.aStall + (n.dCLmax - n.dCL0) / p.CLa - n.deg * .04 * D2R, CLm = p.CLa * (aS - a0);
      if (a <= aS && a >= -aS * .9) return { CL: p.CLa * (a - a0), stalled: false, aS };
      if (a > aS) { const over = a - aS; return { CL: CLm * Math.max(.5, 1 - over * 2.6) * (1 - .15 * Math.sin(s.t * 23) * Math.min(1, over * 8)), stalled: true, aS }; }
      return { CL: p.CLa * (-aS * .9 - a0) * Math.max(.5, 1 - (-aS * .9 - a) * 2.6), stalled: true, aS };
    }

    function step(dt, wind = [0, 0, 0]) {
      if (s.crashed) return;
      s.t += dt;
      const gh = ground(s.x, s.z), surf = surface(s.x, s.z), sig = rho(s.alt) / 1.225;
      const va = add(s.v, wind, -1), V = Math.max(.01, len(va)), vh = va.map(x => x / V);
      const u = dot(va, s.F), wu = dot(va, s.U), vr = dot(va, s.R);
      const alpha = Math.atan2(-wu, Math.max(.5, u)), beta = Math.asin(clamp(vr / V, -1, 1));
      const n = p.notch[c.flaps] || p.notch[0], qbar = .5 * rho(s.alt) * V * V;
      const { CL, stalled, aS } = CLof(alpha, n);
      const CD = p.CD0 + n.dCD + p.k * CL * CL + (stalled ? .12 : 0) + Math.abs(beta) * .25;
      // engine: power lags the throttle; carb heat costs a little power
      const pwrCmd = clamp(c.throttle, 0, 1) * (c.carbHeat ? .92 : 1);
      s.power += (pwrCmd - s.power) * Math.min(1, dt / .7);
      const pwr = s.power * p.hp * HP * Math.pow(sig, 1.1);
      const T = p.thrustAt(V, pwr) + (s.power < .05 ? -p.W * .006 * clamp(V / p.Vref, 0, 1.5) : 0);
      s.rpm = s.crashed ? 0 : Math.round(clamp(650 + 1650 * Math.sqrt(s.power) + V * 6 * (1 - s.power * .6), 0, 2750));
      // forces
      const Ldir = norm(cross(vh, s.R)), L = qbar * p.S * CL, D = qbar * p.S * CD, Y = -qbar * p.S * 1.1 * beta;
      let Fw = add(add(add(scale(Ldir, L), vh, -D), s.R, Y), s.F, T); Fw = add(Fw, [0, -p.W, 0]);
      // control power scales with dynamic pressure (propwash helps the tail at low speed)
      const qn = clamp(qbar / (.5 * 1.225 * p.Vref * p.Vref), 0, 3), qprop = qn + s.power * .35 * clamp(1 - V / p.Vref, 0, 1), vn = Math.sqrt(qn);
      // pitch: the elevator commands an angle of attack about the trimmed one; short-period dynamics with damping
      const aCmd = clamp(trimAlpha() + c.elevator * (c.elevator > 0 ? 23 : 12) * D2R - n.deg * .03 * D2R, -12 * D2R, 24 * D2R);
      const wsp = 3.6 * Math.max(.15, vn + s.power * .15 * clamp(1 - V / p.Vref, 0, 1));
      let qd = wsp * wsp * (aCmd - alpha) - 2 * .7 * wsp * s.w[1];
      // roll: aileron rate with damping, dihedral effect, stall wing drop
      let rudder = c.rudder;
      if (c.autoRudder && !s.ground) rudder = clamp(rudder + beta * 5 + c.aileron * .25 * clamp(CL, 0, 1.6) / 1.6, -1, 1);
      s.rud = rudder;
      if (stalled && !s.ground) { s.stallT += dt; if (!s.wingDrop) s.wingDrop = (Math.random() < .5 ? -1 : 1); } else { s.stallT = 0; s.wingDrop = 0; }
      let pd = 4.6 * c.aileron * qprop - 4.2 * s.w[0] * Math.max(.25, vn) - 2.2 * beta * qn + (s.wingDrop ? s.wingDrop * 1.4 * Math.min(1, s.stallT) * qn : 0);
      // yaw: rudder, weathervane stability, adverse yaw, prop effects (left-turning at high power and low speed)
      let rd = (1.5 * rudder) * qprop + 6.5 * beta * qn - .5 * c.aileron * clamp(CL, 0, 1.6) * qn - 3.2 * s.w[2] * Math.max(.25, vn) - .35 * s.power * clamp(1 - V / p.Vref, 0, 1);
      // ---- ground ----
      const agl = s.alt - gh, onGround = agl <= .02 && s.v[1] <= .5;
      if (onGround) {
        const fwdH = norm([s.F[0], 0, s.F[2]]), sideH = [fwdH[2], 0, -fwdH[0]], vg = [s.v[0], 0, s.v[2]], vf = dot(vg, fwdH), vl = dot(vg, sideH);
        const Lv = Math.max(0, L * Ldir[1]), N = Math.max(0, p.W - Lv - T * s.F[1]);
        const mu = (surf === 'grass' ? .06 : surf === 'dirt' ? .05 : .025) + (c.parking ? .55 : c.brake * .5);
        const fr = Math.min(Math.abs(vf) * p.m / dt * .9, mu * N) * Math.sign(vf);
        Fw = add(Fw, fwdH, -fr);
        // tyres stop sideways motion
        Fw = add(Fw, sideH, -vl * p.m * Math.min(1 / dt, 8));
        // steering: nosewheel (or tailwheel while the tail is down), stronger at low speed
        const tailDown = p.tail && pitchDeg() > (opts.groundAtt || 11) * .6;
        const steer = (p.tail && !tailDown ? 0 : rudder * (p.tail ? 18 : 28) * D2R * (1 - clamp(Math.abs(vf) / 35, 0, .75)));
        const rSteer = vf * Math.tan(steer) / p.wb;
        s.w[2] += (rSteer - s.w[2]) * Math.min(1, dt * 10) * (Math.abs(vf) > .3 ? 1 : 0) + rd * dt * (p.tail && !tailDown ? 1 : .15);
        if (Math.abs(vf) < .3 && Math.abs(c.rudder) < .01) s.w[2] *= .5;
        rd = 0;
        // wings stay level on the gear
        s.w[0] = 0; pd = 0; const bank = Math.atan2(-s.R[1], s.U[1]); if (Math.abs(bank) > 1e-4) s.w[0] = -bank * 5;
        // pitch: the nosewheel (or tailwheel) carries the aircraft until the elevator can lift it
        const th = pitchDeg(), rest = p.tail ? (opts.groundAtt || 11) : 0;
        const wNose = (3.6 * .72 * p.vr / p.cruise) ** 2 * .3;
        if (!p.tail) { if (th <= rest + .05 && qd < wNose) { qd = 0; s.w[1] = Math.max(0, s.w[1]) * 0; if (th < rest) s.w[1] = (rest - th) * D2R * 5; } else qd -= wNose; }
        else { if (th >= rest - .05 && qd > -wNose * .8) { qd = 0; s.w[1] = Math.min(0, s.w[1]) * 0; if (th > rest) s.w[1] = (rest - th) * D2R * 5; } else qd += wNose * .8; }
        if (th > 13 && !p.tail) { s.w[1] = Math.min(0, s.w[1]); qd = Math.min(0, qd); } // tail strike limit
      }
      // integrate
      s.w[0] += pd * dt; s.w[1] += qd * dt; s.w[2] += rd * dt;
      const [P_, Q_, R_] = s.w;
      const F = add(s.F, add(scale(s.U, Q_), s.R, R_), dt), U = add(s.U, add(scale(s.F, -Q_), s.R, P_), dt);
      s.F = norm(F); s.R = norm(cross(U, s.F)); s.U = norm(cross(s.F, s.R));
      const acc = scale(Fw, 1 / p.m);
      s.v = add(s.v, acc, dt);
      s.x += s.v[0] * dt; s.alt += s.v[1] * dt; s.z += s.v[2] * dt;
      s.g = dot(add(acc, [0, G, 0]), s.U) / G;
      // ---- contact ----
      const gh2 = ground(s.x, s.z);
      if (s.alt <= gh2) {
        const sink = -s.v[1], bank = Math.abs(Math.atan2(-s.R[1], s.U[1]) * R2D), th = pitchDeg();
        if (!s.ground) {
          const fpm = -sink / .3048 * 60;
          if (sink > 3.6) crash('You hit the ground descending too fast.');
          else if (bank > 11) crash('A wing touched the ground. Level the wings before landing.');
          else if (!p.tail && th < -2.5 && sink > .8) crash('The nosewheel hit first and collapsed. Hold the nose up in the flare.');
          else if (len(va) > p.vne * KT * .75) crash('Touched down far too fast.');
          else { s.touch = { fpm, bank, pitch: th, t: s.t }; s.landed = s.airT > 3; }
        }
        s.alt = gh2; if (s.v[1] < 0) s.v[1] = 0; s.ground = true;
      } else if (s.alt > gh2 + .15) { if (s.ground) { s.airT = 0; s.landed = false; } s.ground = false; }
      if (!s.ground) s.airT += dt;
      if (s.ground && p.tail && pitchDeg() < -3) crash('The propeller struck the ground. Keep the tail lower on a tailwheel aircraft.');
      s.alpha = alpha; s.beta = beta; s.stalled = stalled && !s.ground; s.stallWarn = !s.ground && alpha > aS - 2.5 * D2R; s.CL = CL; s.agl = s.alt - gh2; s.surf = surf;
      derive();
    }
    function crash(msg) { s.crashed = true; s.crash = msg; s.v = [0, 0, 0]; s.w = [0, 0, 0]; }
    const pitchDeg = () => Math.asin(clamp(s.F[1], -1, 1)) * R2D;
    function derive() {
      s.pitch = pitchDeg(); s.bank = Math.atan2(-s.R[1], s.U[1]) * R2D; s.hdg = (Math.atan2(s.F[0], s.F[2]) * R2D + 360) % 360;
      const va = s.v, V = len(va); s.tas = V; s.ias = V * Math.sqrt(rho(s.alt) / 1.225); s.vs = s.v[1];
      s.gs = Math.hypot(s.v[0], s.v[2]); s.trk = s.gs > 1 ? (Math.atan2(s.v[0], s.v[2]) * R2D + 360) % 360 : s.hdg;
      s.turn = s.w[2] * Math.cos(s.bank * D2R) * R2D + s.w[1] * Math.sin(s.bank * D2R) * R2D; // deg/s
      s.slip = (s.beta || 0) * R2D;
    }
    // world-space orientation for drawing: heading/pitch/bank already derived
    return { p, c, s, reset, step, trimFor, flapLabel: () => (p.notch[c.flaps] || p.notch[0]).label, notches: p.notch.length };
  }

  // Autopilot control laws, flying the aircraft through the same controls a pilot would use.
  // t: { phase: 'takeoff'|'rollout'|'air'|'flare', trk (deg, desired ground track), bankMax, alt (m) or vs (m/s), spd (kt IAS), thr (fixed throttle), flaps (notch) }
  const wrap180 = d => ((d % 360) + 540) % 360 - 180;
  function pilot(fm, t, dt) {
    const { s, c, p } = fm, ap = fm.ap || (fm.ap = { th: s.pitch, thr: c.throttle, i: 0 }), ias = s.ias / KT;
    const steer = () => clamp(wrap180(t.trk - s.hdg) * .09 - s.w[2] * R2D * .03, -1, 1);
    c.parking = false; c.aileron = 0;
    if (t.phase === 'takeoff') {
      c.throttle = 1; c.brake = 0; c.rudder = steer(); c.flaps = t.flaps ?? 0;
      c.elevator = p.tail ? (ias < p.vr * .6 ? -.45 : ias > p.vr ? .45 : 0) : (ias > p.vr ? .6 : 0);
      ap.th = Math.max(5, s.pitch); ap.thr = 1; return;
    }
    if (t.phase === 'rollout') {
      c.throttle = 0; c.rudder = steer(); c.elevator = p.tail ? .6 : (s.pitch > .5 ? .25 : 0);
      c.brake = ias < p.appr * .8 ? clamp((ias - 3) / 12, .25, .75) : 0; return;
    }
    // lateral: bank towards the desired track (or heading), coordinated by the auto-rudder
    c.rudder = 0;
    const err = wrap180(t.trk - (t.useHdg ? s.hdg : s.trk)), bmax = t.bankMax ?? 25;
    const desBank = clamp(err * 1.3, -bmax, bmax);
    c.aileron = clamp((desBank - s.bank) * .06 - s.w[0] * R2D * .012, -1, 1);
    // vertical: vertical speed from the altitude error, pitch from the vertical speed error
    let desVS = t.vs != null ? t.vs : clamp(((t.alt ?? s.alt) - s.alt) * .12, -(t.vsDn ?? 4), t.vsUp ?? 3.5);
    if (t.phase === 'flare') desVS = -Math.max(.45, s.agl * .3);
    // initial climb: keep climbing away from the runway at full power before following the profile
    const initial = t.phase === 'air' && !t.approach && s.airT < 25 && s.agl < 60;
    if (initial) desVS = Math.max(desVS, 2.2);
    const e = desVS - s.vs;
    ap.th = clamp(ap.th + e * .9 * dt, -10, 15);
    let thc = clamp(ap.th + e * 1.6, -12, 16);
    // speed protection: never let the airspeed bleed towards the stall
    const vmin = (t.phase === 'flare' ? p.vso * 1.05 : (s.ias / KT < 0 ? 0 : (c.flaps ? p.vso : p.vs) * 1.25));
    if (ias < vmin) { thc = Math.min(thc, s.pitch - (vmin - ias) * .6); ap.th = Math.min(ap.th, thc); }
    if (t.phase === 'flare') thc = Math.max(thc, p.tail ? 6 : 4);
    c.elevator = clamp((thc - s.pitch) * .085 - s.w[1] * R2D * .022, -1, 1);
    c.trim = clamp(c.trim + c.elevator * .12 * dt, -1, 1);   // auto-trim offloads the elevator
    // power: fixed, or auto-throttle on airspeed
    if (initial) { c.throttle = 1; ap.thr = 1; }
    else if (t.thr != null) { c.throttle = t.thr; ap.thr = t.thr; }
    else if (t.phase === 'flare') { c.throttle = s.agl < 3 ? 0 : Math.min(c.throttle, .12); ap.thr = c.throttle; }
    else { const se = (t.spd ?? p.cruise) - ias; ap.thr = clamp(ap.thr + se * .012 * dt, 0, 1); c.throttle = clamp(ap.thr + se * .05 - e * .02 * -1, 0, 1); }
    if (t.flaps != null) { const want = t.flaps; if (want < c.flaps || ias < (p.vfe || 999)) c.flaps = want; }
  }

  const api = { create, params, DATA, KT, pilot, wrap180 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BoploPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
