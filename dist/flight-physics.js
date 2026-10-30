/* Boplo Flight — flight model for the simulator.
   A rigid-body model sized for light training aircraft: lift from angle of attack (so the wing stalls at its critical angle,
   not at a speed), induced and parasite drag, propeller thrust that falls with speed, pitch/roll/yaw dynamics with
   weathervane and dihedral stability, adverse yaw and prop effects, flaps in the type's real notches, elevator trim,
   and a ground model with nosewheel/tailwheel steering, brakes and rolling friction.
   Also: ground effect (less induced drag and a little more lift within a wingspan of the ground), airspeed from the
   air mass rather than the ground (so wind shows up on the airspeed), jet thrust that lapses with altitude and Mach,
   spool-up that is slow from idle, idle thrust, thrust reversers, compressibility drag rise above the critical Mach,
   propeller torque, and tyres with a friction limit, so a crosswind or a fast turn can make them skid.
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
  // speed of sound in the standard atmosphere (troposphere, then the isothermal layer above 11 km)
  const sound = h => 340.29 * Math.sqrt(Math.max(216.65, 288.15 - .0065 * Math.max(-500, h)) / 288.15);

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
    const span = d.span || { c152: 10.1, c172: 11, pa28: 10.7, da40: 11.9, da20: 10.9, p2008: 9, dr400: 8.72, sr20: 11.7, cub: 10.7 }[id] || 11;
    const AR = span * span / d.S, k = 1 / (Math.PI * .76 * AR), CLa = 2 * Math.PI * AR / (AR + 2.2) * .95;
    const qs = v => .5 * 1.225 * (v * KT) ** 2 * d.S;
    const CLmax = W / qs(P.vs), CLmaxF = W / qs(d.vso || P.vs);
    const maxDeg = d.flaps[d.flaps.length - 1][0] || 1;
    const notch = d.flaps.map(([deg, label]) => { const f = deg / maxDeg; const dCLmax = (CLmaxF - CLmax) * Math.pow(f, .8); return { deg, label, dCLmax, dCL0: dCLmax * .85, dCD: .055 * Math.pow(deg / 40, 1.6) }; });
    const a0 = -2.2 * D2R, aStall = a0 + CLmax / CLa;
    // propeller: thrust = η·P / sqrt(V² + V0²), static thrust about 19 N per hp
    const eta = .8, V0 = eta * HP / 19;
    // jets: thrust (not power) falling with Mach (high-bypass fans lose a fifth of their thrust by 150 kt) and with air density;
    // `pwr` arrives as throttle × HP × density factor for props, so for jets the density lapse is applied in step()
    const thrustAt = d.jet ? (V, pwr, M = V / 340.3) => pwr / HP * d.T0 * Math.max(.3, 1 - .9 * M + .6 * M * M) : (V, pwr) => eta * pwr / Math.sqrt(V * V + V0 * V0);
    // parasite drag from the top speed at full power
    const vmax = P.vmax * KT, CLv = W / qs(P.vmax), CD0 = d.CD0 || Math.max(.018, thrustAt(vmax, d.hp * HP) / qs(P.vmax) - k * CLv * CLv);
    return { ...d, ...P, id, W, span, AR, k, CLa, CLmax, a0, aStall, notch, eta, V0, CD0, thrustAt, hp: d.jet ? 1 : d.hp, agility: d.agility || 1, spool: d.spool || .7, Vref: P.cruise * KT, tail: !!tail };
  }

  function create(id, perf, opts = {}) {
    const p = params(id, perf, opts.tail);
    const ground = opts.groundAt || (() => 0), surface = opts.surfaceAt || (() => 'paved');
    const c = { elevator: 0, aileron: 0, rudder: 0, throttle: 0, flaps: 0, trim: 0, brake: 0, parking: false, carbHeat: false, autoRudder: true, gear: 1, spoiler: 0 };
    const s = {};
    function reset({ x = 0, z = 0, alt = 0, hdg = 0, airborne = false, speed = 0, pitch = 0 } = {}) {
      const h = hdg * D2R, th = pitch * D2R;
      s.F = norm([Math.sin(h) * Math.cos(th), Math.sin(th), Math.cos(h) * Math.cos(th)]); s.R = [Math.cos(h), 0, -Math.sin(h)]; s.U = norm(cross(s.F, s.R));
      s.x = x; s.z = z; s.alt = alt; s.v = scale(s.F, airborne ? speed : 0); s.w = [0, 0, 0]; s.ground = !airborne; s.power = airborne ? .65 : 0; s.rpm = airborne ? 2300 : 0;
      s.gearPos = 1; s.revPos = 0; s.n1 = airborne ? 70 : 0; s.spoilerPos = 0; s.crashed = false; s.crash = ''; s.touch = null; s.landed = false; s.t = 0; s.stallT = 0; s.buffet = 0; s.wingDrop = 0; s.g = 1; s.airT = airborne ? 30 : 0;
      if (p.tail && !airborne) tilt(opts.groundAtt || 11);
      Object.assign(c, { elevator: 0, aileron: 0, rudder: 0, brake: 0, gear: 1, spoiler: 0, reverse: false, parking: !airborne && !!opts.parkingAtStart });
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
      const va = add(s.v, wind, -1), V = Math.max(.01, len(va)), vh = va.map(x => x / V), M = V / sound(s.alt);
      s.va = va;
      const u = dot(va, s.F), wu = dot(va, s.U), vr = dot(va, s.R);
      const alpha = Math.atan2(-wu, Math.max(.5, u)), beta = Math.asin(clamp(vr / V, -1, 1));
      const n = p.notch[c.flaps] || p.notch[0], qbar = .5 * rho(s.alt) * V * V;
      const cl0 = CLof(alpha, n), stalled = cl0.stalled, aS = cl0.aS;
      // ground effect: within a wingspan of the ground the wingtip vortices are squashed, so induced drag falls and lift rises a little
      const hb = (Math.max(0, s.alt - gh) + (p.jet ? 4 : 1.3)) / p.span, ge = (16 * hb) ** 2 / (1 + (16 * hb) ** 2);
      const CL = cl0.CL * (stalled ? 1 : 1 + .09 * (1 - ge));
      // jets: retractable gear (drag while down or moving) and spoilers (drag up, lift down); ground spoilers deploy at idle after touchdown
      if (p.retract) s.gearPos = clamp(s.gearPos + Math.sign((c.gear ? 1 : 0) - s.gearPos) * dt / 7, 0, 1); else s.gearPos = 1;
      const spCmd = p.jet ? Math.max(c.spoiler, s.ground && c.throttle < .08 && V > 25 ? 1 : 0) : 0;
      s.spoilerPos += (spCmd - s.spoilerPos) * Math.min(1, dt * 3);
      const CLs = CL * (1 - .45 * s.spoilerPos);
      // compressibility: drag rises steeply past the critical Mach (Lock's fourth-power rule)
      const Mcr = p.mcrit || .76, CDc = p.jet && M > Mcr ? 20 * (M - Mcr) ** 4 : 0;
      const CD = p.CD0 + n.dCD + p.k * ge * cl0.CL * cl0.CL + (stalled ? .12 : 0) + Math.abs(beta) * .25 + (p.retract ? .016 * s.gearPos : 0) + .05 * s.spoilerPos + CDc;
      // engine: power lags the throttle; carb heat costs a little power. A jet spools up slowly from idle and faster near the top,
      // and winds down quicker than it winds up
      const pwrCmd = clamp(c.throttle, 0, 1) * (c.carbHeat ? .92 : 1);
      const tau = p.jet ? (pwrCmd > s.power ? p.spool * (1.35 - .9 * s.power) : p.spool * .45) : p.spool;
      s.power += (pwrCmd - s.power) * Math.min(1, dt / Math.max(.1, tau));
      // thrust reversers: armed with the switch, they deploy on the ground (weight on wheels) and stow in the air
      { const want = p.jet && c.reverse && s.ground ? 1 : 0; s.revPos = clamp(s.revPos + clamp(want - s.revPos, -dt / 1.6, dt / 1.6), 0, 1); }
      let T;
      if (p.jet) {
        const Tf = p.thrustAt(V, s.power * HP, M) * Math.pow(sig, .85), Tidle = p.T0 * .035 * Math.pow(sig, .85) * Math.max(0, 1 - M * 2.5);
        T = (Tf + Tidle) * (1 - 1.35 * s.revPos); // reversers out: the fan's air is turned forwards, about a third of the thrust, backwards
      } else {
        const pwr = s.power * p.hp * HP * Math.pow(sig, 1.1);
        T = p.thrustAt(V, pwr) + (s.power < .05 ? -p.W * .006 * clamp(V / p.Vref, 0, 1.5) : 0);
      }
      if (p.jet) { s.n1 = s.crashed ? 0 : 21 + 79 * Math.sqrt(s.power); s.rpm = Math.round(s.n1 * 30); }
      else s.rpm = s.crashed ? 0 : Math.round(clamp(650 + 1650 * Math.sqrt(s.power) + V * 6 * (1 - s.power * .6), 0, 2750));
      // forces
      const Ldir = norm(cross(vh, s.R)), L = qbar * p.S * CLs, D = qbar * p.S * CD, Y = -qbar * p.S * 1.1 * beta;
      let Fw = add(add(add(scale(Ldir, L), vh, -D), s.R, Y), s.F, T); Fw = add(Fw, [0, -p.W, 0]);
      // control power scales with dynamic pressure (propwash helps the tail at low speed)
      const qn = clamp(qbar / (.5 * 1.225 * p.Vref * p.Vref), 0, 3), qprop = qn + (p.jet ? 0 : s.power * .35 * clamp(1 - V / p.Vref, 0, 1)), vn = Math.sqrt(qn), ag = p.agility;
      // pitch: the elevator commands an angle of attack about the trimmed one; short-period dynamics with damping
      const aCmd = clamp(trimAlpha() + c.elevator * (c.elevator > 0 ? 23 : 12) * D2R - n.deg * .03 * D2R, -12 * D2R, 24 * D2R);
      const wsp = 3.6 * (.55 + .45 * ag) * Math.max(.15, vn + (p.jet ? 0 : s.power * .15 * clamp(1 - V / p.Vref, 0, 1)));
      let qd = wsp * wsp * (aCmd - alpha) - 2 * .7 * wsp * s.w[1];
      // roll: aileron rate with damping, dihedral effect, stall wing drop
      let rudder = c.rudder;
      if (c.autoRudder && !s.ground) rudder = clamp(rudder + beta * 5 + c.aileron * .25 * clamp(CL, 0, 1.6) / 1.6, -1, 1);
      s.rud = rudder;
      if (stalled && !s.ground) { s.stallT += dt; if (!s.wingDrop) s.wingDrop = (Math.random() < .5 ? -1 : 1); } else { s.stallT = 0; s.wingDrop = 0; }
      let pd = 4.6 * ag * c.aileron * qprop - 4.2 * ag * s.w[0] * Math.max(.25, vn) - 2.2 * beta * qn + (s.wingDrop ? s.wingDrop * 1.4 * Math.min(1, s.stallT) * qn : 0)
        - (p.jet ? 0 : .22 * s.power * clamp(1 - V / p.Vref, 0, 1)); // engine torque rolls a propeller aircraft left at high power and low speed
      // yaw: rudder, weathervane stability, adverse yaw, prop effects (left-turning at high power and low speed)
      let rd = (1.5 * ag * rudder) * qprop + 6.5 * beta * qn - .5 * c.aileron * clamp(CL, 0, 1.6) * qn - 3.2 * s.w[2] * Math.max(.25, vn) - (p.jet ? 0 : .35 * s.power * clamp(1 - V / p.Vref, 0, 1));
      // ---- ground ----
      const agl = s.alt - gh, onGround = agl <= .02 && s.v[1] <= .5;
      if (onGround) {
        const fwdH = norm([s.F[0], 0, s.F[2]]), sideH = [fwdH[2], 0, -fwdH[0]], vg = [s.v[0], 0, s.v[2]], vf = dot(vg, fwdH), vl = dot(vg, sideH);
        const Lv = Math.max(0, L * Ldir[1]), N = Math.max(0, p.W - Lv - T * s.F[1]);
        const muMax = surf === 'grass' ? .4 : surf === 'dirt' ? .45 : .62; // what the tyres can grip (anti-skid brakes stop just short of it)
        const mu = (surf === 'grass' ? .08 : surf === 'dirt' ? .06 : .03) + Math.min(muMax - .05, c.parking ? .55 : c.brake * (p.jet ? .42 : .52));
        const fr = Math.min(Math.abs(vf) * p.m / dt * .9, mu * N) * Math.sign(vf);
        Fw = add(Fw, fwdH, -fr);
        // tyres stop sideways motion, up to the friction they have left after braking; past that they skid
        const side = -vl * p.m * Math.min(1 / dt, 8), sideMax = Math.max(0, Math.sqrt(Math.max(0, (muMax * N) ** 2 - fr * fr))) * 1.1;
        s.skid = Math.abs(side) > sideMax && Math.abs(vl) > .6;
        Fw = add(Fw, sideH, clamp(side, -sideMax, sideMax));
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
          if (p.retract && s.gearPos < .95) crash('You landed with the gear up. Lower the gear before you land.');
          else if (sink > 3.6) crash('You hit the ground descending too fast.');
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
      // airspeed comes from the air mass, not the ground: a headwind shows on the airspeed but not the ground speed
      const va = s.va || s.v, V = len(va); s.tas = V; s.ias = V * Math.sqrt(rho(s.alt) / 1.225); s.mach = V / sound(s.alt); s.vs = s.v[1];
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
    // climb and descent rates the type can actually manage: an airliner climbs at 2,000–3,000 fpm, a trainer at 500–700
    const up = t.vsUp ?? (p.jet ? 12.7 : 3.6), dn = t.vsDn ?? (p.jet ? 11 : 4.5);
    let desVS = t.vs != null ? t.vs : clamp(((t.alt ?? s.alt) - s.alt) * (p.jet ? .09 : .12), -dn, up);
    if (t.phase === 'flare') desVS = -Math.max(p.jet ? .9 : .45, s.agl * .3);
    // initial climb: keep climbing away from the runway at full power before following the profile
    const initial = t.phase === 'air' && !t.approach && s.airT < 25 && s.agl < 60;
    if (initial) desVS = Math.max(desVS, 2.2);
    const e = desVS - s.vs;
    ap.th = clamp(ap.th + e * .9 * dt, -10, 15);
    let thc = clamp(ap.th + e * 1.6, -12, 16);
    // speed protection: never let the airspeed bleed towards the stall
    const vmin = (t.phase === 'flare' ? p.vso * 1.05 : (s.ias / KT < 0 ? 0 : (c.flaps ? p.vso : p.vs) * (p.jet ? 1.12 : 1.25))); // (a jet's approach speed is only about 1.23 × its stall speed)
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

  // power that holds a steady descent at speed V (m/s) on a given path angle with the flaps set, trimmed hands-off.
  // Found by flying a throwaway copy of the aircraft; used to set up practice approaches already established.
  function approachPower(id, perf, opts, V, flaps, gammaDeg = 3) {
    const want = -V * Math.sin(gammaDeg * Math.PI / 180);
    const fly = thr => {
      const fm = create(id, perf, { ...opts, groundAt: () => -1e5, surfaceAt: null, parkingAtStart: false }), { s, c } = fm;
      fm.reset({ alt: 400, airborne: true, speed: V, pitch: -gammaDeg });
      c.flaps = flaps; c.trim = fm.trimFor(V); c.throttle = thr; s.power = thr;
      let sum = 0, n = 0; const dt = 1 / 30;
      for (let i = 0; i < 30 * 90; i++) { c.aileron = Math.max(-1, Math.min(1, -s.bank * .05 - s.w[0] * .3)); fm.step(dt, [0, 0, 0]); if (i > 30 * 20) { sum += s.vs; n++; } }
      return sum / n;
    };
    let lo = 0, hi = 1;
    for (let k = 0; k < 9; k++) { const m = (lo + hi) / 2; if (fly(m) < want) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  const api = { create, params, DATA, KT, pilot, wrap180, approachPower, rho, sound };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BoploPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
