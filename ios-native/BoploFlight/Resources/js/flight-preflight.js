/* Boplo preflight maths: weight and balance, take-off and landing performance, sun times, crosswind and minimums.
   Pure functions, no DOM, so they can be checked in Node (scripts/preflight-check.cjs).
   Default aircraft figures are typical published values for the type; every aircraft is different, so pilots enter
   their own empty weight and arm from the aircraft's weight and balance report, and check arms against its POH. */
(function (root) {
  const LB = 0.453592, USG = 3.78541;
  // fuel: kg per litre and lb per US gallon (avgas 100LL)
  const AVGAS = { kgL: 0.72, lbG: 6 };

  // units: 'lb' types use pounds and inches, 'kg' types use kilograms and metres. fuel in the type's own unit.
  // stations: arm, optional max load; group lets two baggage areas share a combined maximum.
  // envelope: normal-category CG envelope as [arm, weight] points, clockwise.
  // perf: sea level, ISA, max weight, zero wind, paved dry runway. Ground roll and distance to/from 50 ft, in metres.
  const TYPES = {
    c152: {
      name: 'Cessna 152', units: 'lb', mtow: 1670, mlw: 1670, empty: [1129, 30.7], source: 'C152 POH (1978 on)',
      stations: [{ id: 'front', label: 'Pilot and passenger', arm: 39 }, { id: 'bag1', label: 'Baggage area 1', arm: 64, max: 120, group: 'bag' }, { id: 'bag2', label: 'Baggage area 2', arm: 84, max: 40, group: 'bag' }],
      groups: { bag: 120 }, fuel: { arm: 42, usable: 24.5, unit: 'USG', burn: 6 },
      envelope: [[31.0, 1100], [31.0, 1350], [32.65, 1670], [36.5, 1670], [36.5, 1100]],
      perf: { toRoll: 221, to50: 408, ldRoll: 145, ld50: 366 }, speeds: { vr: 50, vy: 67, vref: 54 }
    },
    c172: {
      name: 'Cessna 172S', units: 'lb', mtow: 2550, mlw: 2550, empty: [1663, 39.6], source: 'C172S POH',
      stations: [{ id: 'front', label: 'Pilot and front passenger', arm: 37 }, { id: 'rear', label: 'Rear passengers', arm: 73 }, { id: 'bagA', label: 'Baggage area A', arm: 95, max: 120, group: 'bag' }, { id: 'bagB', label: 'Baggage area B', arm: 123, max: 50, group: 'bag' }],
      groups: { bag: 120 }, fuel: { arm: 48, usable: 53, unit: 'USG', burn: 8.5 },
      envelope: [[35.0, 1500], [35.0, 1950], [41.0, 2550], [47.3, 2550], [47.3, 1500]],
      perf: { toRoll: 293, to50: 497, ldRoll: 175, ld50: 407 }, speeds: { vr: 55, vy: 74, vref: 63 }
    },
    pa28: {
      name: 'Piper PA-28-161 Warrior', units: 'lb', mtow: 2325, mlw: 2325, empty: [1500, 86.0], source: 'PA-28-161 POH',
      stations: [{ id: 'front', label: 'Pilot and front passenger', arm: 80.5 }, { id: 'rear', label: 'Rear passengers', arm: 118.1 }, { id: 'bag', label: 'Baggage', arm: 142.8, max: 200 }],
      fuel: { arm: 95, usable: 48, unit: 'USG', burn: 9 },
      envelope: [[83.0, 1200], [83.0, 1950], [87.0, 2325], [93.0, 2325], [93.0, 1200]],
      perf: { toRoll: 297, to50: 454, ldRoll: 181, ld50: 340 }, speeds: { vr: 55, vy: 79, vref: 63 }
    },
    da40: {
      name: 'Diamond DA40', units: 'kg', mtow: 1150, mlw: 1150, empty: [800, 2.44], source: 'DA40 AFM (typical)', approx: true,
      stations: [{ id: 'front', label: 'Front seats', arm: 2.30 }, { id: 'rear', label: 'Rear seats', arm: 3.25 }, { id: 'bag', label: 'Baggage', arm: 3.65, max: 30 }],
      fuel: { arm: 2.63, usable: 148, unit: 'L', burn: 35 },
      envelope: [[2.40, 780], [2.40, 980], [2.46, 1150], [2.59, 1150], [2.59, 780]],
      perf: { toRoll: 330, to50: 530, ldRoll: 250, ld50: 480 }, speeds: { vr: 59, vy: 66, vref: 71 }
    },
    // the types below ship with their maximum weights and station names only: enter the arms from your POH
    da20: { name: 'Diamond DA20 Katana', units: 'kg', mtow: 800, mlw: 800, empty: [0, 0], needsArms: true, stations: [{ id: 'front', label: 'Seats' }, { id: 'bag', label: 'Baggage', max: 20 }], fuel: { usable: 91, unit: 'L', burn: 22 }, envelope: [], perf: { toRoll: 270, to50: 460, ldRoll: 180, ld50: 420 }, speeds: { vr: 50, vy: 66, vref: 60 }, approx: true },
    p2008: { name: 'Tecnam P2008', units: 'kg', mtow: 650, mlw: 650, empty: [0, 0], needsArms: true, stations: [{ id: 'front', label: 'Seats' }, { id: 'bag', label: 'Baggage', max: 20 }], fuel: { usable: 120, unit: 'L', burn: 18 }, envelope: [], perf: { toRoll: 190, to50: 360, ldRoll: 150, ld50: 340 }, speeds: { vr: 44, vy: 66, vref: 55 }, approx: true },
    dr400: { name: 'Robin DR400', units: 'kg', mtow: 900, mlw: 900, empty: [0, 0], needsArms: true, stations: [{ id: 'front', label: 'Front seats' }, { id: 'rear', label: 'Rear seats' }, { id: 'bag', label: 'Baggage', max: 60 }], fuel: { usable: 109, unit: 'L', burn: 25 }, envelope: [], perf: { toRoll: 280, to50: 520, ldRoll: 200, ld50: 470 }, speeds: { vr: 55, vy: 70, vref: 65 }, approx: true },
    sr20: { name: 'Cirrus SR20', units: 'lb', mtow: 3050, mlw: 3050, empty: [0, 0], needsArms: true, stations: [{ id: 'front', label: 'Front seats' }, { id: 'rear', label: 'Rear seats' }, { id: 'bag', label: 'Baggage', max: 130 }], fuel: { usable: 56, unit: 'USG', burn: 10 }, envelope: [], perf: { toRoll: 390, to50: 600, ldRoll: 270, ld50: 510 }, speeds: { vr: 65, vy: 96, vref: 78 }, approx: true },
    cub: { name: 'Piper J-3 Cub', units: 'lb', mtow: 1220, mlw: 1220, empty: [0, 0], needsArms: true, stations: [{ id: 'front', label: 'Front seat' }, { id: 'rear', label: 'Rear seat' }, { id: 'bag', label: 'Baggage', max: 20 }], fuel: { usable: 12, unit: 'USG', burn: 4 }, envelope: [], perf: { toRoll: 112, to50: 220, ldRoll: 90, ld50: 230 }, speeds: { vr: 40, vy: 45, vref: 45 }, approx: true },
    custom: { name: 'Other aircraft', units: 'kg', mtow: 0, mlw: 0, empty: [0, 0], needsArms: true, stations: [{ id: 'front', label: 'Front seats' }, { id: 'rear', label: 'Rear seats' }, { id: 'bag', label: 'Baggage' }], fuel: { usable: 0, unit: 'L', burn: 0 }, envelope: [], perf: { toRoll: 0, to50: 0, ldRoll: 0, ld50: 0 }, speeds: {}, approx: true }
  };

  // merge the pilot's own figures (empty weight and arm, arms, limits, envelope, performance) over the type defaults
  function aircraft(typeId, mine = {}) {
    const T = TYPES[typeId] || TYPES.custom, o = mine || {};
    const st = T.stations.map(s => ({ ...s, arm: Number.isFinite(+o.arms?.[s.id]) && o.arms[s.id] !== '' ? +o.arms[s.id] : s.arm, max: Number.isFinite(+o.max?.[s.id]) && o.max?.[s.id] !== '' ? +o.max[s.id] : s.max }));
    const num = (v, d) => v !== '' && v != null && Number.isFinite(+v) ? +v : d;
    return {
      ...T, id: typeId, stations: st,
      empty: [num(o.emptyW, T.empty[0]), num(o.emptyArm, T.empty[1])],
      mtow: num(o.mtow, T.mtow), mlw: num(o.mlw, T.mlw),
      fuel: { ...T.fuel, arm: num(o.fuelArm, T.fuel.arm), usable: num(o.fuelUsable, T.fuel.usable), burn: num(o.burn, T.fuel.burn) },
      envelope: Array.isArray(o.envelope) && o.envelope.length >= 3 ? o.envelope : T.envelope,
      perf: { ...T.perf, ...Object.fromEntries(Object.entries(o.perf || {}).filter(([, v]) => v !== '' && Number.isFinite(+v)).map(([k, v]) => [k, +v])) },
      custom: !!(o.emptyW || o.emptyArm)
    };
  }

  // fuel quantity to weight in the type's mass unit
  const fuelMass = (A, qty) => {
    const q = +qty || 0, u = A.fuel.unit;
    const litres = u === 'L' ? q : u === 'USG' ? q * USG : u === 'IG' ? q * 4.54609 : q;
    const kg = litres * AVGAS.kgL;
    return A.units === 'lb' ? (u === 'USG' ? q * AVGAS.lbG : kg / LB) : kg;
  };

  // is a point inside a polygon (ray casting)
  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  // full loading calculation: loads = {stationId: weight}, fuel = {start, burn (quantity used in flight)}
  function wb(A, loads = {}, fuel = {}) {
    const rows = [], issues = [];
    const [ew, ea] = A.empty;
    if (!(ew > 0) || !(ea !== 0 && Number.isFinite(ea))) issues.push({ k: 'empty', t: 'Enter your aircraft’s empty weight and arm from its weight and balance report.' });
    rows.push({ id: 'empty', label: 'Basic empty weight', w: ew, arm: ea, m: ew * ea });
    const groupSum = {};
    for (const s of A.stations) {
      const w = +loads[s.id] || 0;
      if (w && !Number.isFinite(s.arm)) issues.push({ k: s.id, t: `Enter the arm for ${s.label.toLowerCase()} from your POH.` });
      if (s.max && w > s.max) issues.push({ k: s.id, t: `${s.label}: ${w} is over the ${s.max} ${A.units} limit.`, bad: true });
      if (s.group) groupSum[s.group] = (groupSum[s.group] || 0) + w;
      rows.push({ id: s.id, label: s.label, w, arm: s.arm, m: w * (s.arm || 0) });
    }
    for (const [g, max] of Object.entries(A.groups || {})) if ((groupSum[g] || 0) > max) issues.push({ k: g, t: `Baggage areas combined: ${groupSum[g]} is over the ${max} ${A.units} limit.`, bad: true });
    const fq = +fuel.start || 0, fw = fuelMass(A, fq);
    if (fq > A.fuel.usable && A.fuel.usable) issues.push({ k: 'fuel', t: `Fuel: ${fq} ${A.fuel.unit} is more than the ${A.fuel.usable} ${A.fuel.unit} usable.`, bad: true });
    if (fq && !Number.isFinite(A.fuel.arm)) issues.push({ k: 'fuel', t: 'Enter the fuel arm from your POH.' });
    rows.push({ id: 'fuel', label: `Fuel (${fq} ${A.fuel.unit})`, w: fw, arm: A.fuel.arm, m: fw * (A.fuel.arm || 0) });
    const W = rows.reduce((a, r) => a + r.w, 0), M = rows.reduce((a, r) => a + r.m, 0), cg = W ? M / W : 0;
    const used = Math.min(+fuel.burn || 0, fq), lw = W - fuelMass(A, used), lm = M - fuelMass(A, used) * (A.fuel.arm || 0), lcg = lw ? lm / lw : 0;
    const env = A.envelope || [];
    const toIn = env.length >= 3 ? inside(env, cg, W) : null, ldIn = env.length >= 3 ? inside(env, lcg, lw) : null;
    if (A.mtow && W > A.mtow) issues.push({ k: 'mtow', t: `Take-off weight ${round(W, A)} is over the ${A.mtow} ${A.units} maximum.`, bad: true });
    if (A.mlw && lw > A.mlw) issues.push({ k: 'mlw', t: `Landing weight ${round(lw, A)} is over the ${A.mlw} ${A.units} maximum landing weight.`, bad: true });
    if (toIn === false && !(A.mtow && W > A.mtow)) issues.push({ k: 'cg', t: 'Take-off centre of gravity is outside the envelope.', bad: true });
    if (ldIn === false) issues.push({ k: 'lcg', t: 'Landing centre of gravity is outside the envelope.', bad: true });
    if (!env.length) issues.push({ k: 'env', t: 'Add the CG envelope from your POH to check the limits.' });
    const ok = !issues.some(i => i.bad) && toIn !== false && ldIn !== false && !issues.some(i => i.k === 'empty');
    return { rows, W, M, cg, lw, lcg, toIn, ldIn, ok, issues, units: A.units, fuelW: fw };
  }
  const round = (v, A) => A.units === 'kg' ? Math.round(v) : Math.round(v);

  // atmosphere
  const pressureAlt = (elevFt, qnh) => elevFt + (1013.25 - (+qnh || 1013.25)) * 27;
  const isaTemp = paFt => 15 - 1.98 * paFt / 1000;
  const densityAlt = (paFt, oat) => paFt + 118.8 * ((Number.isFinite(+oat) ? +oat : isaTemp(paFt)) - isaTemp(paFt));

  // wind relative to a runway heading (degrees true or magnetic, same reference as the wind)
  function components(rwyHdg, windDir, windSpd) {
    if (!windSpd || windDir == null || windDir === 'VRB') return { head: 0, cross: 0, from: '' };
    const a = (windDir - rwyHdg) * Math.PI / 180;
    const head = windSpd * Math.cos(a), cross = windSpd * Math.sin(a);
    return { head, cross: Math.abs(cross), from: cross > 0.5 ? 'right' : cross < -0.5 ? 'left' : '' };
  }

  // UK CAA Safety Sense 7 factors, with the weight effect and the POH-style wind correction.
  // surface: 'paved', 'paved-wet', 'grass', 'grass-wet', 'grass-long'
  const SURF = {
    paved: { to: 1, ld: 1, label: 'Paved, dry' }, 'paved-wet': { to: 1, ld: 1.15, label: 'Paved, wet' },
    grass: { to: 1.2, ld: 1.15, label: 'Short dry grass' }, 'grass-wet': { to: 1.3, ld: 1.35, label: 'Short wet grass' },
    'grass-long': { to: 1.3, ld: 1.3, label: 'Long dry grass' }
  };
  function performance(A, c) {
    const P = A.perf; if (!P || !P.to50) return null;
    const pa = pressureAlt(+c.elevFt || 0, c.qnh), isa = isaTemp(pa), oat = Number.isFinite(+c.oat) && c.oat !== '' ? +c.oat : isa;
    const da = densityAlt(pa, oat), W = +c.weight || A.mtow, wr = A.mtow ? Math.max(.6, W / A.mtow) : 1;
    const s = SURF[c.surface] || SURF.paved, head = +c.head || 0, slope = +c.slope || 0;
    const lines = [];
    const f = (base, kind) => {
      let v = base, steps = [];
      const alt = kind === 'to' ? 1 + .10 * Math.max(0, pa) / 1000 : 1 + .05 * Math.max(0, pa) / 1000; v *= alt; steps.push(['Pressure altitude ' + Math.round(pa) + ' ft', alt]);
      const tF = kind === 'to' ? 1 + .10 * Math.max(0, oat - isa) / 10 : 1 + .05 * Math.max(0, oat - isa) / 10; v *= tF; steps.push([`Temperature ${Math.round(oat)}°C (ISA ${Math.round(isa)}°C)`, tF]);
      const wF = wr * wr; v *= wF; steps.push([`Weight ${Math.round(W)} ${A.units}`, wF]);
      const sF = kind === 'to' ? s.to : s.ld; v *= sF; steps.push([s.label, sF]);
      // headwind: 10% less per 9 kt (POH rule); tailwind: 10% more per 2 kt
      const hF = head >= 0 ? Math.max(.6, 1 - .10 * head / 9) : 1 + .10 * (-head) / 2; v *= hF; steps.push([head >= 0 ? `Headwind ${Math.round(head)} kt` : `Tailwind ${Math.round(-head)} kt`, hF]);
      // slope: 10% per 2% uphill on take-off, downhill on landing
      const up = kind === 'to' ? Math.max(0, slope) : Math.max(0, -slope), slF = 1 + .10 * up / 2; v *= slF; steps.push([kind === 'to' ? `Uphill slope ${up}%` : `Downhill slope ${up}%`, slF]);
      return { v, steps };
    };
    const to = f(P.to50, 'to'), toR = f(P.toRoll, 'to'), ld = f(P.ld50, 'ld'), ldR = f(P.ldRoll, 'ld');
    const SF = { to: 1.33, ld: 1.43 };
    return { pa, da, oat, isa, to: { roll: toR.v, d50: to.v, req: to.v * SF.to, steps: to.steps }, ld: { roll: ldR.v, d50: ld.v, req: ld.v * SF.ld, steps: ld.steps }, sf: SF, approx: !!A.approx };
  }

  // sunrise, sunset and end of civil twilight (NOAA algorithm), local times returned as Date objects
  function sun(lat, lng, dateISO) {
    const d = new Date(dateISO + 'T12:00:00Z'), rad = Math.PI / 180;
    const J = d / 864e5 + 2440587.5, n = Math.round(J - 2451545 - .0009 - lng / 360);
    const Js = 2451545 + .0009 + -lng / 360 + n, M = (357.5291 + .98560028 * (Js - 2451545)) % 360;
    const Cc = 1.9148 * Math.sin(M * rad) + .02 * Math.sin(2 * M * rad) + .0003 * Math.sin(3 * M * rad);
    const lam = (M + 102.9372 + Cc + 180) % 360, Jt = Js + .0053 * Math.sin(M * rad) - .0069 * Math.sin(2 * lam * rad);
    const dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.44 * rad));
    const at = h => { const c = (Math.sin(h * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec)); if (c < -1 || c > 1) return null; const w = Math.acos(c) / rad; return [Jt - w / 360, Jt + w / 360].map(j => new Date((j - 2440587.5) * 864e5)); };
    const s = at(-0.833), cv = at(-6);
    return { rise: s?.[0] || null, set: s?.[1] || null, dawn: cv?.[0] || null, dusk: cv?.[1] || null };
  }

  // METAR facts used by the minimums check
  function metarFacts(st) {
    const raw = String(st?.raw || '');
    const ceil = (() => { const l = (st?.clouds || []).filter(c => /BKN|OVC|VV/.test(c.cover)).map(c => +c.base).filter(Number.isFinite); if (l.length) return Math.min(...l); const m = [...raw.matchAll(/\b(BKN|OVC|VV)(\d{3})/g)].map(x => +x[2] * 100); return m.length ? Math.min(...m) : null; })();
    const vs = String(st?.visib ?? ''), sm = vs.includes('+') ? 10 : parseFloat(vs);
    let visKm = Number.isFinite(sm) ? (sm >= 10 ? 10 : sm * 1.609) : null;
    const m4 = raw.match(/\s(\d{4})\s/); if (visKm == null && m4) visKm = +m4[1] >= 9999 ? 10 : +m4[1] / 1000;
    if (/CAVOK/.test(raw)) visKm = 10;
    return { wdir: st?.wdir === 'VRB' ? null : +st?.wdir, wspd: +st?.wspd || 0, gust: +st?.wgst || 0, visKm, ceil, temp: Number.isFinite(+st?.temp) ? +st.temp : null, qnh: Number.isFinite(+st?.altim) ? +st.altim : null, raw };
  }
  // personal minimums: { wind, gust, cross, visKm, ceil } ; returns [{label, value, limit, state: 'go'|'caution'|'nogo'}]
  function minimums(mins, facts, xwind) {
    const out = [];
    const add = (label, v, lim, worse, fmt) => { if (lim === '' || lim == null || !Number.isFinite(+lim) || v == null || !Number.isFinite(v)) return; const L = +lim, bad = worse ? v > L : v < L, near = worse ? v > L * .85 : v < L * 1.15; out.push({ label, value: fmt(v), limit: fmt(L), state: bad ? 'nogo' : near ? 'caution' : 'go' }); };
    add('Wind', facts.wspd, mins.wind, true, v => Math.round(v) + ' kt');
    add('Gusts', facts.gust || facts.wspd, mins.gust, true, v => Math.round(v) + ' kt');
    add('Crosswind', xwind, mins.cross, true, v => Math.round(v) + ' kt');
    add('Visibility', facts.visKm, mins.visKm, false, v => (v >= 10 ? '10+' : v.toFixed(1)) + ' km');
    if (facts.ceil != null) add('Cloud ceiling', facts.ceil, mins.ceil, false, v => Math.round(v) + ' ft');
    else if (mins.ceil) out.push({ label: 'Cloud ceiling', value: 'No ceiling', limit: Math.round(mins.ceil) + ' ft', state: 'go' });
    const worst = out.some(o => o.state === 'nogo') ? 'nogo' : out.some(o => o.state === 'caution') ? 'caution' : out.length ? 'go' : null;
    return { rows: out, worst };
  }

  const api = { TYPES, aircraft, wb, fuelMass, inside, pressureAlt, isaTemp, densityAlt, components, performance, SURF, sun, metarFacts, minimums };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BoploPreflight = api;
})(typeof window !== 'undefined' ? window : globalThis);
