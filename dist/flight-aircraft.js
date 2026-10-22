/* Boplo Flight — training aircraft for the simulator.
   Each type is built in code as a glTF binary from a short spec (real dimensions in metres), so there are no model files to download.
   Shapes are simplified and liveries are generic: no manufacturer marks. Performance figures are typical book values, rounded,
   used only to make each type feel different in a game-like flight model. glTF axes: +Y up, +Z forward, +X to the left wing. */
window.BoploAircraft = (() => {
  'use strict';
  const D2R = Math.PI / 180;
  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1]; };

  // fuselage families: [t from nose (0) to tail (1), width factor, height factor, centre rise (× height)]
  const FAM = {
    cabin: [[0, .3, .3, 0], [.03, .62, .62, .02], [.08, .86, .84, .04], [.16, .97, .96, .06], [.28, 1, 1, .08], [.4, .98, .97, .09], [.52, .8, .76, .13], [.66, .55, .5, .18], [.8, .34, .32, .22], [.92, .18, .18, .25], [.99, .07, .08, .27], [1, .02, .03, .27]],
    sleek: [[0, .24, .24, 0], [.04, .6, .58, .02], [.12, .9, .86, .05], [.24, 1, 1, .08], [.36, .95, .9, .1], [.48, .62, .55, .14], [.62, .36, .32, .18], [.78, .24, .22, .2], [.92, .16, .16, .22], [1, .04, .05, .23]],
    cub: [[0, .52, .56, 0], [.04, .86, .86, .02], [.14, 1, 1, .04], [.3, 1, 1, .06], [.45, .86, .84, .09], [.6, .62, .6, .13], [.75, .4, .38, .18], [.9, .2, .2, .22], [1, .03, .04, .24]]
  };

  // perf: stall (clean, kt), rotate, approach, cruise, max level speed, climb (fpm). Book values rounded; sim only.
  const TYPES = [
    { id: 'c152', name: 'Cessna 152', blurb: 'Two-seat high-wing trainer. Forgiving, slow and light on the controls.', span: 10.1, len: 7.3, fus: 'cabin', W: 1.02, H: 1.3, e: 3.2,
      wing: { pos: 'high', le: .55, secs: [[0, 0, 1.6], [2.6, 0, 1.6], [5.05, .25, 1.1]], dih: 1.5, struts: true }, tail: { type: 'conv', stab: [[0, 1.05], [1.65, .72]], fin: [[0, 1.4], [1.25, .7]], finSweep: .9 },
      canopy: { type: 'cabin', t: [.12, .42] }, gear: { type: 'tri', track: 2.3, r: .2, fair: false, legLen: .55 }, livery: ['#F4F5F7', '#B3262E', '#3A0E12'],
      perf: { vs: 44, vr: 50, appr: 60, cruise: 95, vmax: 110, climb: 715 } },
    { id: 'c172', name: 'Cessna 172', blurb: 'The world’s most common trainer. Four seats, stable and easy to land.', span: 11, len: 8.3, fus: 'cabin', W: 1.1, H: 1.42, e: 3.2,
      wing: { pos: 'high', le: .6, secs: [[0, 0, 1.63], [2.7, 0, 1.63], [5.5, .3, 1.12]], dih: 1.7, struts: true }, tail: { type: 'conv', stab: [[0, 1.15], [1.75, .78]], fin: [[0, 1.55], [1.35, .75]], finSweep: 1 },
      canopy: { type: 'cabin', t: [.12, .44] }, gear: { type: 'tri', track: 2.5, r: .21, fair: true, legLen: .58 }, livery: ['#F4F5F7', '#1D4FB5', '#0B1E4E'],
      perf: { vs: 48, vr: 55, appr: 65, cruise: 120, vmax: 125, climb: 730 } },
    { id: 'pa28', name: 'Piper PA-28 Warrior', blurb: 'Low-wing four-seater with a stabilator. Solid in turbulence.', span: 10.7, len: 7.3, fus: 'cabin', W: 1.12, H: 1.25, e: 2.8,
      wing: { pos: 'low', le: .7, secs: [[0, 0, 1.6], [2.4, 0, 1.6], [5.35, .35, 1.05]], dih: 7 }, tail: { type: 'conv', stab: [[0, 1.0], [2, .8]], fin: [[0, 1.5], [1.3, .75]], finSweep: 1, stabilator: true },
      canopy: { type: 'cabin', t: [.14, .42], low: true }, gear: { type: 'tri', track: 3.05, r: .2, fair: true, legLen: .52 }, livery: ['#F4F5F7', '#0A62FF', '#06102A'],
      perf: { vs: 50, vr: 55, appr: 66, cruise: 115, vmax: 122, climb: 644 } },
    { id: 'da40', name: 'Diamond DA40', blurb: 'Composite four-seater with a T-tail and a big bubble canopy. Slippery and quick.', span: 11.9, len: 8.0, fus: 'sleek', W: 1.16, H: 1.25, e: 2.3,
      wing: { pos: 'low', le: .55, secs: [[0, 0, 1.42], [1.2, .05, 1.36], [5.95, .45, .72]], dih: 5 }, tail: { type: 'T', stab: [[0, .95], [1.6, .7]], fin: [[0, 1.6], [1.45, .95]], finSweep: 1.1 },
      canopy: { type: 'bubble', t: [.1, .42], hh: .36 }, gear: { type: 'tri', track: 2.97, r: .2, fair: true, legLen: .55 }, livery: ['#F6F7F9', '#2F6FD6', '#152447'],
      perf: { vs: 52, vr: 59, appr: 71, cruise: 140, vmax: 147, climb: 1070 } },
    { id: 'da20', name: 'Diamond DA20 Katana', blurb: 'Light two-seat composite trainer with a T-tail. Glides beautifully.', span: 10.9, len: 7.2, fus: 'sleek', W: 1.02, H: 1.12, e: 2.2,
      wing: { pos: 'low', le: .5, secs: [[0, 0, 1.3], [1.1, .05, 1.25], [5.45, .4, .66]], dih: 4 }, tail: { type: 'T', stab: [[0, .85], [1.45, .6]], fin: [[0, 1.45], [1.25, .85]], finSweep: 1.05 },
      canopy: { type: 'bubble', t: [.1, .36], hh: .4 }, gear: { type: 'tri', track: 2.2, r: .19, fair: true, legLen: .5 }, livery: ['#F6F7F9', '#E2583E', '#3B1A12'],
      perf: { vs: 42, vr: 51, appr: 60, cruise: 120, vmax: 135, climb: 1000 } },
    { id: 'p2008', name: 'Tecnam P2008', blurb: 'Modern two-seat high-wing trainer with no struts and a stabilator.', span: 9.0, len: 6.9, fus: 'sleek', W: 1.14, H: 1.3, e: 2.6,
      wing: { pos: 'high', le: .5, secs: [[0, 0, 1.45], [4.5, 0, 1.45]], dih: 1 }, tail: { type: 'conv', stab: [[0, .85], [1.45, .85]], fin: [[0, 1.55], [1.3, .8]], finSweep: .9, stabilator: true },
      canopy: { type: 'cabin', t: [.08, .4] }, gear: { type: 'tri', track: 1.9, r: .19, fair: false, legLen: .55 }, livery: ['#F4F5F7', '#1C8C5E', '#0B3324'],
      perf: { vs: 44, vr: 48, appr: 58, cruise: 110, vmax: 118, climb: 850 } },
    { id: 'dr400', name: 'Robin DR400', blurb: 'French wooden low-wing with cranked wingtips and a sliding canopy. Lovely handling.', span: 8.72, len: 6.96, fus: 'cabin', W: 1.08, H: 1.2, e: 2.7,
      wing: { pos: 'low', le: .65, secs: [[0, 0, 1.71], [2.96, 0, 1.71], [4.36, .1, 1.3]], dih: 0, crank: { x: 2.96, dih: 14 } }, tail: { type: 'conv', stab: [[0, .9], [1.6, .75]], fin: [[0, 1.4], [1.15, .7]], finSweep: 1.1, stabilator: true },
      canopy: { type: 'bubble', t: [.14, .46], hh: .34 }, gear: { type: 'tri', track: 2.6, r: .2, fair: true, legLen: .5 }, livery: ['#F4F5F7', '#C0262D', '#3B0C0F'],
      perf: { vs: 50, vr: 55, appr: 65, cruise: 110, vmax: 125, climb: 600 } },
    { id: 'sr20', name: 'Cirrus SR20', blurb: 'Glass-cockpit four-seater with a tapered composite wing. Fast and modern.', span: 11.7, len: 7.9, fus: 'sleek', W: 1.25, H: 1.35, e: 2.5,
      wing: { pos: 'low', le: .6, secs: [[0, 0, 1.6], [1.3, .05, 1.5], [5.85, .4, .78]], dih: 4.5 }, tail: { type: 'conv', stab: [[0, 1.0], [2, .7]], fin: [[0, 1.6], [1.3, .85]], finSweep: 1.15 },
      canopy: { type: 'cabin', t: [.1, .4], low: true }, gear: { type: 'tri', track: 3.0, r: .21, fair: true, legLen: .58 }, livery: ['#F4F5F7', '#5A6372', '#1A1E26'],
      perf: { vs: 56, vr: 65, appr: 80, cruise: 150, vmax: 155, climb: 830 } },
    { id: 'cub', name: 'Piper J-3 Cub', blurb: 'The classic tailwheel trainer. Slow, simple and pure stick-and-rudder.', span: 10.7, len: 6.8, fus: 'cub', W: .76, H: 1.2, e: 4,
      wing: { pos: 'high', le: .35, secs: [[0, 0, 1.6], [5.35, 0, 1.6]], dih: 1, struts: true }, tail: { type: 'conv', stab: [[0, .9], [1.5, .7]], fin: [[0, 1.0], [.95, .8]], finSweep: .5 },
      canopy: { type: 'cabin', t: [.12, .36] }, gear: { type: 'tail', track: 1.85, r: .27, fair: false, legLen: .62 }, livery: ['#F2C230', '#121212', '#121212'], tips: false,
      perf: { vs: 33, vr: 38, appr: 50, cruise: 65, vmax: 76, climb: 450 } }
  ];
  const byId = id => TYPES.find(t => t.id === id) || TYPES[2];
  // match free text from a logbook ("PA-28 Warrior", "C172", "Cessna 152") to a type
  function match(text) {
    const s = String(text || '').toLowerCase().replace(/[\s-]/g, '');
    if (!s) return null;
    const rules = [[/152|c150|cessna150/, 'c152'], [/172|skyhawk/, 'c172'], [/pa28|warrior|archer|cherokee|piper28/, 'pa28'], [/da40|diamondstar/, 'da40'], [/da20|katana|eclipse/, 'da20'], [/p2008|tecnam|p2002|p92/, 'p2008'], [/dr400|robin|dr40|regent/, 'dr400'], [/sr20|sr22|cirrus/, 'sr20'], [/cub|j3|supercub|pa18/, 'cub']];
    return (rules.find(([r]) => r.test(s)) || [])[1] || null;
  }

  function fuselageRings(T) {
    const fam = FAM[T.fus], noseZ = T.wing.le + T.len * (T.fus === 'cub' ? .23 : T.fus === 'sleek' ? .27 : .26);
    return { noseZ, tailZ: noseZ - T.len, at: t => { // interpolate the family at t
      let i = 0; while (i < fam.length - 2 && fam[i + 1][0] < t) i++;
      const [t0, w0, h0, c0] = fam[i], [t1, w1, h1, c1] = fam[i + 1], k = (t - t0) / ((t1 - t0) || 1);
      return { z: noseZ - t * T.len, w: (w0 + (w1 - w0) * k) * T.W, h: (h0 + (h1 - h0) * k) * T.H, cy: (c0 + (c1 - c0) * k) * T.H };
    }, stations: fam.map(([t]) => t) };
  }

  function build(id) {
    const T = byId(id);
    const parts = { paint: [], matte: [], glass: [], blades: [], disc: [] };
    const [CBASE, CACC, CTRIM] = T.livery.map(hex), CTIP = T.tips === false ? hex(T.livery[0]) : CACC, GREY = [.42, .45, .5, 1], DARK = [.07, .075, .085, 1], RUBBER = [.035, .035, .04, 1], GLASS = [.13, .19, .27, 1];
    const mesh = b => { const m = { pos: [], col: [], idx: [] }; parts[b].push(m); return m; };
    function loft(b, rings, colors, { closed = true, capStart = false, capEnd = false } = {}) {
      const m = mesh(b), n = rings[0].length;
      rings.forEach((r, i) => r.forEach(p => { m.pos.push(p[0], p[1], p[2]); m.col.push(...(Array.isArray(colors[0]) ? colors[i] : colors)); }));
      const seg = closed ? n : n - 1;
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * n + j, bb = i * n + (j + 1) % n, c = (i + 1) * n + (j + 1) % n, d = (i + 1) * n + j; m.idx.push(a, bb, c, a, c, d); }
      const cap = (ri, flip) => { const r = rings[ri], cx = r.reduce((s, p) => s + p[0], 0) / n, cy = r.reduce((s, p) => s + p[1], 0) / n, cz = r.reduce((s, p) => s + p[2], 0) / n, k = m.pos.length / 3; m.pos.push(cx, cy, cz); m.col.push(...(Array.isArray(colors[0]) ? colors[ri] : colors)); for (let j = 0; j < n; j++) { const a = ri * n + j, bb = ri * n + (j + 1) % n; flip ? m.idx.push(k, bb, a) : m.idx.push(k, a, bb); } };
      if (capStart) cap(0, false); if (capEnd) cap(rings.length - 1, true);
      return m;
    }
    const sup = (e, a) => Math.sign(a) * Math.pow(Math.abs(a), 2 / e);
    const ring = (z, cy, w, h, n = 24, e = T.e, cx = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return [cx + w / 2 * sup(e, Math.cos(a)), cy + h / 2 * sup(e, Math.sin(a)), z]; });
    const arc = (z, cy, w, h, a0, a1, n, k = 1.012, e = T.e) => Array.from({ length: n }, (_, i) => { const a = a0 + (a1 - a0) * i / (n - 1); return [w / 2 * k * sup(e, Math.cos(a)), cy + h / 2 * k * sup(e, Math.sin(a)), z]; });
    const tube = (a, b, r, n = 8, col = GREY, bucket = 'matte') => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d), u = d.map(v => v / L); let p = Math.abs(u[1]) < .9 ? [0, 1, 0] : [1, 0, 0]; const v1 = [u[1] * p[2] - u[2] * p[1], u[2] * p[0] - u[0] * p[2], u[0] * p[1] - u[1] * p[0]], l1 = Math.hypot(...v1); v1.forEach((x, i) => v1[i] = x / l1); const v2 = [u[1] * v1[2] - u[2] * v1[1], u[2] * v1[0] - u[0] * v1[2], u[0] * v1[1] - u[1] * v1[0]]; const rr = c => Array.from({ length: n }, (_, i) => { const t = i / n * Math.PI * 2; return [c[0] + r * (Math.cos(t) * v1[0] + Math.sin(t) * v2[0]), c[1] + r * (Math.cos(t) * v1[1] + Math.sin(t) * v2[1]), c[2] + r * (Math.cos(t) * v1[2] + Math.sin(t) * v2[2])]; }); loft(bucket, [rr(a), rr(b)], col, { capStart: true, capEnd: true }); };
    const foil = (t, camber = .02, n = 10) => { const up = [], lo = []; for (let i = 0; i <= n; i++) { const s = (1 - Math.cos(i / n * Math.PI)) / 2, yt = 5 * t * (.2969 * Math.sqrt(s) - .126 * s - .3516 * s * s + .2843 * s ** 3 - .1036 * s ** 4), yc = camber * (s < .4 ? (2 * .4 * s - s * s) / .16 : (1 - .8 + 2 * .4 * s - s * s) / .36); up.push([s, yc + yt]); lo.push([s, yc - yt]); } return [...up.reverse(), ...lo.slice(1, -1)]; };

    // ---- fuselage ----
    const FU = fuselageRings(T), fine = []; for (let t = 0; t <= 1.0001; t += .025) fine.push(Math.min(1, t));
    const secAt = FU.at;
    loft('paint', fine.map(t => { const s = secAt(t); return ring(s.z, s.cy, s.w, s.h); }), CBASE, { capEnd: true });
    // cheatline on both sides, belly trim
    for (const side of [0, Math.PI]) {
      const ts = fine.filter(t => t > .06 && t < .9);
      loft('paint', ts.map(t => { const s = secAt(t); return arc(s.z, s.cy - s.h * .06, s.w, s.h, side - .07, side + .07, 4); }), CACC, { closed: false });
      loft('paint', ts.map(t => { const s = secAt(t); return arc(s.z, s.cy - s.h * .06, s.w, s.h, side + (side ? .16 : -.16) - .025, side + (side ? .16 : -.16) + .025, 3, 1.014); }), CTRIM, { closed: false });
    }
    // spinner and cowl intakes
    const n0 = secAt(0), hubZ = FU.noseZ + .06;
    loft('paint', [[FU.noseZ + .01, n0.cy, n0.w * .95, n0.h * .95], [hubZ, n0.cy, n0.w * .72, n0.h * .72], [hubZ + .14, n0.cy, n0.w * .45, n0.h * .45], [hubZ + .24, n0.cy, n0.w * .14, n0.h * .14], [hubZ + .28, n0.cy, .01, .01]].map(f => ring(...f, 16, 2)), CACC, { capEnd: true });
    for (const sx of [1, -1]) loft('matte', [0, .01].map(dz => ring(FU.noseZ - .04 - dz, n0.cy - n0.h * .1, n0.w * .25, n0.h * .18, 10, 3, sx * n0.w * .22)), DARK, { capStart: true });

    // ---- cabin glass ----
    const cv = T.canopy;
    if (cv.type === 'cabin') {
      const [ta, tb] = cv.t, ts = []; for (let t = ta; t <= tb + 1e-6; t += (tb - ta) / 10) ts.push(t);
      const a0 = cv.low ? .32 : .16, a1 = Math.PI - a0;
      loft('glass', ts.map(t => { const s = secAt(t); return arc(s.z, s.cy, s.w, s.h, a0, a1, 18, 1.016); }), GLASS, { closed: false });
      // window posts
      for (const t of [ta + (tb - ta) * .32, ta + (tb - ta) * .66]) { const s = secAt(t), s2 = secAt(t + .008); loft('paint', [arc(s.z, s.cy, s.w, s.h, a0, a1, 18, 1.02), arc(s2.z, s2.cy, s2.w, s2.h, a0, a1, 18, 1.02)], CBASE, { closed: false }); }
    } else {
      const [ta, tb] = cv.t, hh = (cv.hh || .5) * T.H, rings = [];
      for (let i = 0; i <= 8; i++) { const t = ta + (tb - ta) * i / 8, s = secAt(t), bump = Math.sin(Math.PI * Math.pow(i / 8, .8)); rings.push(ring(s.z, s.cy + s.h / 2 - hh * .15 + hh * .42 * bump, s.w * (.5 + .38 * bump), Math.max(.02, hh * bump * 1.05), 24, 2.1)); }
      loft('glass', rings, GLASS, { capStart: true, capEnd: true });
    }

    // ---- wing ----
    const WG = T.wing, wf = foil(.15, .025), rootT = (FU.noseZ - WG.le) / T.len, rs = secAt(rootT);
    const rootY = WG.pos === 'high' ? rs.cy + rs.h / 2 - .1 : rs.cy - rs.h / 2 + .14;
    const tipX = WG.secs[WG.secs.length - 1][0];
    const yAt = x => { if (WG.crank && x > WG.crank.x) return rootY + WG.crank.x * Math.tan(WG.dih * D2R) + (x - WG.crank.x) * Math.tan(WG.crank.dih * D2R); return rootY + x * Math.tan(WG.dih * D2R); };
    const secAtX = x => { const S = WG.secs; let i = 0; while (i < S.length - 2 && S[i + 1][0] < x) i++; const [x0, s0, c0] = S[i], [x1, s1, c1] = S[i + 1], k = (x - x0) / ((x1 - x0) || 1); return [WG.le - (s0 + (s1 - s0) * k), c0 + (c1 - c0) * k]; };
    const xs = [...new Set([0, ...WG.secs.map(s => s[0]), ...(WG.crank ? [WG.crank.x] : []), tipX * .25, tipX * .5, tipX * .75, tipX - .4, tipX - .05])].filter(x => x <= tipX).sort((a, b) => a - b);
    const tipCol = x => x >= tipX - .4 && T.tips !== false ? CACC : CBASE;
    for (const side of [1, -1]) {
      const rings = xs.map(x => { const [zLE, c] = secAtX(x), y = yAt(x); return wf.map(([s, v]) => [side * Math.max(x, rs.w * .3), y + v * c, zLE - s * c]); });
      loft('paint', side > 0 ? rings : rings.map(r => r.slice().reverse()), xs.map(tipCol), { capEnd: true });
      // flap / aileron hinge line
      const hinge = xs.filter(x => x > rs.w * .5).map(x => { const [zLE, c] = secAtX(x), y = yAt(x) + c * .045; return [[side * x, y, zLE - c * .72 + .015], [side * x, y + .003, zLE - c * .72 - .015]]; });
      if (hinge.length > 1) loft('matte', hinge, GREY, { closed: false });
      if (WG.struts) {
        const sx = tipX * .45, [zLE, c] = secAtX(sx), ws = yAt(sx) - c * .06, fs = secAt(rootT + .02);
        tube([side * sx, ws, zLE - c * .3], [side * fs.w * .45, fs.cy - fs.h * .35, zLE - c * .3], .035, 8, CBASE, 'paint');
        if (T.id === 'cub') tube([side * sx * .92, ws, zLE - c * .75], [side * fs.w * .45, fs.cy - fs.h * .35, zLE - c * .32], .03, 8, CBASE, 'paint');
      }
    }
    const tipZ = secAtX(tipX), tipY = yAt(tipX);

    // ---- tail ----
    const TL = T.tail, tf = foil(.1, 0), tailS = secAt(.94), finRootZ = FU.tailZ + TL.fin[0][1] + .05, finTop = TL.fin[1][0] || 1;
    const finH = TL.fin[1][0], finLE = h => finRootZ - h * TL.finSweep / finH * .9;
    const fin = [0, .3, .6, .85, 1].map(k => { const h = finH * k, c = TL.fin[0][1] + (TL.fin[1][1] - TL.fin[0][1]) * k; return tf.map(([s, v]) => [v * c, tailS.cy + tailS.h * .3 + h, finLE(h) - s * c]); });
    loft('paint', fin, [CBASE, CBASE, CTIP, CTIP, CTIP], { capEnd: true });
    const stabY = TL.type === 'T' ? tailS.cy + tailS.h * .3 + finH * .98 : tailS.cy + (T.wing.pos === 'low' ? tailS.h * .05 : 0);
    const stabLE = TL.type === 'T' ? finLE(finH) - .05 : FU.tailZ + TL.stab[0][1] + .15;
    for (const side of [1, -1]) { const span = TL.stab[1][0], r = [0, .5, 1].map(k => { const c = TL.stab[0][1] + (TL.stab[1][1] - TL.stab[0][1]) * k; return tf.map(([s, v]) => [side * Math.max(span * k, .05), stabY + v * c, stabLE - k * .12 - s * c]); }); loft('paint', side > 0 ? r : r.map(q => q.slice().reverse()), [CBASE, CBASE, CTIP], { capEnd: true }); }

    // ---- landing gear ----
    const G = T.gear, belly = secAt(rootT).cy - secAt(rootT).h / 2, wheelY = belly - G.legLen;
    const wheel = (x, z, r, fair) => {
      const tyre = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI * 2; tyre.push([x + r * .45, wheelY + r + Math.sin(a) * r, z + Math.cos(a) * r]); }
      loft('matte', [tyre, tyre.map(p => [p[0] - r * .9, p[1], p[2]])], RUBBER, { closed: false });
      if (fair) loft('paint', [[z + r * 2.1, r * .15, r * .25], [z + r * 1.3, r * .9, r * 1.2], [z, r * 1.1, r * 1.55], [z - r * 1.2, r * 1, r * 1.3], [z - r * 2.2, r * .25, r * .35]].map(([zz, w, h]) => ring(zz, wheelY + r * 1.05, w, h, 16, 2.2, x)), CBASE, { capStart: true, capEnd: true });
    };
    let groundAtt = 0, tailWheel = null;
    const mainZ = G.type === 'tail' ? WG.le - .05 : WG.le - secAtX(0)[1] * .62 - .1;
    for (const sx of [1, -1]) {
      const x = sx * G.track / 2;
      if (G.type === 'tail' || T.wing.pos === 'high') tube([sx * rs.w * .35, belly + .05, mainZ + (G.type === 'tail' ? .25 : 0)], [x, wheelY + G.r, mainZ], .035);
      else tube([x * .9, yAt(Math.abs(x)) - .05, mainZ], [x, wheelY + G.r, mainZ], .04);
      wheel(x, mainZ, G.r, G.fair);
    }
    if (G.type === 'tri') {
      const nz = FU.noseZ - .45, ns = secAt(.04); tube([0, ns.cy - ns.h * .4, nz + .05], [0, wheelY + G.r * .85, nz], .035); wheel(0, nz, G.r * .85, G.fair);
    } else {
      const tz = FU.tailZ + .35, ts = secAt(.95), r = .09; tube([0, ts.cy - ts.h / 2, tz + .1], [0, ts.cy - ts.h / 2 - .2 + r, tz], .02);
      tailWheel = [0, ts.cy - ts.h / 2 - .2, tz]; wheel(0, tz, r, false);
      groundAtt = Math.atan2(tailWheel[1] - wheelY, mainZ - tz) / D2R; // nose-up angle sitting on the tailwheel
    }

    // ---- propeller ----
    const PR = Math.min(.95, T.H * .72), hub = [0, n0.cy, hubZ + .04];
    for (const sgn of [1, -1]) { const b = []; for (const [rk, c, tw] of [[.06, .1, .35], [.35, .12, .28], [.7, .1, .18], [1, .06, .1]]) { const r = rk * PR, cc = c * PR * .6; b.push([[sgn * r, -cc / 2, Math.sin(tw * sgn) * cc / 2], [sgn * r, cc / 2, -Math.sin(tw * sgn) * cc / 2], [sgn * r, cc / 2, -Math.sin(tw * sgn) * cc / 2 - .025], [sgn * r, -cc / 2, Math.sin(tw * sgn) * cc / 2 - .025]]); } loft('blades', b, DARK, { capEnd: true }); }
    { const m = mesh('disc'); for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; m.pos.push(Math.cos(a) * PR, Math.sin(a) * PR, 0); m.col.push(.3, .32, .36, 1); } m.pos.push(0, 0, 0); m.col.push(.3, .32, .36, 1); for (let i = 0; i < 40; i++) m.idx.push(40, i, (i + 1) % 40); }

    // ---- merge and write the GLB ----
    const merge = list => { const pos = [], col = [], idx = []; for (const m of list) { const o = pos.length / 3; pos.push(...m.pos); col.push(...m.col); m.idx.forEach(i => idx.push(i + o)); } const nor = new Float32Array(pos.length); for (let i = 0; i < idx.length; i += 3) { const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3]; const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; for (const k of [a, b, c]) { nor[k] += n[0]; nor[k + 1] += n[1]; nor[k + 2] += n[2]; } } for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; } return { pos: new Float32Array(pos), nor, col: new Float32Array(col), idx: new Uint32Array(idx) }; };
    const prims = [
      ['paint', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: .05, roughnessFactor: .32 }, doubleSided: true }],
      ['matte', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: .2, roughnessFactor: .7 }, doubleSided: true }],
      ['glass', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: .85, roughnessFactor: .06 }, doubleSided: true }],
      ['blades', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: .3, roughnessFactor: .5 }, doubleSided: true }],
      ['disc', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, .14], metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'BLEND', doubleSided: true }]
    ].map(([k, mat]) => ({ name: k, geo: merge(parts[k]), mat }));
    const chunks = [], views = [], accessors = []; let off = 0;
    const addView = (arr, target) => { const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - bytes.length % 4) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, target }); chunks.push(bytes); if (pad) chunks.push(new Uint8Array(pad)); off += bytes.length + pad; return views.length - 1; };
    const meshes = prims.map((p, pi) => {
      const { pos, nor, col, idx } = p.geo, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
      const acc = (view, type, comp, count, extra = {}) => { accessors.push({ bufferView: view, componentType: comp, count, type, ...extra }); return accessors.length - 1; };
      const aP = acc(addView(pos, 34962), 'VEC3', 5126, pos.length / 3, { min, max }), aN = acc(addView(nor, 34962), 'VEC3', 5126, nor.length / 3), aC = acc(addView(col, 34962), 'VEC4', 5126, col.length / 4), aI = acc(addView(idx, 34963), 'SCALAR', 5125, idx.length);
      return { name: p.name, primitives: [{ attributes: { POSITION: aP, NORMAL: aN, COLOR_0: aC }, indices: aI, material: pi }] };
    });
    const json = { asset: { version: '2.0', generator: 'Boplo Flight' }, scene: 0, scenes: [{ nodes: [0, 1, 2, 3, 4] }],
      nodes: [{ mesh: 0, name: 'paint' }, { mesh: 1, name: 'matte' }, { mesh: 2, name: 'glass' }, { mesh: 3, name: 'blades', translation: hub }, { mesh: 4, name: 'disc', translation: hub }],
      meshes, materials: prims.map(p => ({ name: p.name, ...p.mat })), accessors, bufferViews: views, buffers: [{ byteLength: off }] };
    let jsonBytes = new TextEncoder().encode(JSON.stringify(json)); const jpad = (4 - jsonBytes.length % 4) % 4;
    if (jpad) { const t = new Uint8Array(jsonBytes.length + jpad); t.set(jsonBytes); t.fill(32, jsonBytes.length); jsonBytes = t; }
    const total = 12 + 8 + jsonBytes.length + 8 + off, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jsonBytes, 20);
    let p = 20 + jsonBytes.length; dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004E4942, true); p += 8;
    for (const c of chunks) out.set(c, p), p += c.length;
    return { glb: out, S: T.span / 3.24, hub, wheelDrop: -wheelY, groundAtt, tips: { left: [tipX, tipY, tipZ[0] - tipZ[1] * .3], right: [-tipX, tipY, tipZ[0] - tipZ[1] * .3], tail: [0, tailS.cy + tailS.h * .3 + finH, finLE(finH) - TL.fin[1][1]] }, perf: T.perf, type: T };
  }

  // flight-model numbers from the book figures: thrust and drag that give the type's top speed and climb rate
  function model(id) {
    const P = byId(id).perf, vy = P.vs * 1.45, vyMs = vy * .514444, climbMs = P.climb * .3048 / 60;
    const thrust = climbMs * 19.07 / (vyMs * (1 - (vy / P.vmax) ** 2)), drag = thrust / (P.vmax * P.vmax);
    return { ...P, thrust, drag, vy };
  }

  // a side-view silhouette for the picker, from the same spec
  function profileSVG(id, w = 220, h = 90) {
    const T = byId(id), FU = fuselageRings(T), r0 = FU.at((FU.noseZ - T.wing.le) / T.len), ts9 = FU.at(.94);
    const yBot = r0.cy - r0.h / 2 - T.gear.legLen, yTop = ts9.cy + ts9.h * .3 + T.tail.fin[1][0];
    const k = Math.min((w - 16) / T.len, (h - 6) / (yTop - yBot)), Y = y => h - 3 - (y - yBot) * k, x0 = (w - T.len * k) / 2;
    const px = z => x0 + (z - FU.tailZ) * k; // nose on the right
    const ts = []; for (let t = 0; t <= 1.0001; t += .05) ts.push(Math.min(1, t));
    const top = ts.map(t => { const s = FU.at(t); return [px(s.z), Y(s.cy + s.h / 2)]; }), bot = ts.map(t => { const s = FU.at(t); return [px(s.z), Y(s.cy - s.h / 2)]; }).reverse();
    const path = [...top, ...bot].map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + 'Z';
    const rootT = (FU.noseZ - T.wing.le) / T.len, rs = FU.at(rootT), c0 = T.wing.secs[0][2];
    const wy = T.wing.pos === 'high' ? rs.cy + rs.h / 2 : rs.cy - rs.h / 2 + .14;
    const wing = `<rect x="${(px(T.wing.le) - c0 * k).toFixed(1)}" y="${(Y(wy) - .1 * k).toFixed(1)}" width="${(c0 * k).toFixed(1)}" height="${(.2 * k).toFixed(1)}" rx="${(.1 * k).toFixed(1)}"/>`;
    const tailS = FU.at(.94), fh = T.tail.fin[1][0], fz = FU.tailZ + T.tail.fin[0][1] + .05, fc0 = T.tail.fin[0][1], fc1 = T.tail.fin[1][1], sweep = T.tail.finSweep * .9;
    const fy0 = Y(tailS.cy + tailS.h * .3), fy1 = Y(tailS.cy + tailS.h * .3 + fh);
    const fin = `<path d="M${px(fz)} ${fy0}L${px(fz - sweep)} ${fy1}L${px(fz - sweep - fc1)} ${fy1}L${px(fz - fc0)} ${fy0}Z"/>`;
    const canopy = T.canopy.type === 'bubble' ? (() => { const a = FU.at(T.canopy.t[0]), b = FU.at(T.canopy.t[1]), m = FU.at((T.canopy.t[0] + T.canopy.t[1]) / 2), hh = (T.canopy.hh || .5) * T.H; return `<path class="g" d="M${px(a.z)} ${Y(a.cy + a.h / 2)}Q${px(m.z)} ${Y(m.cy + m.h / 2 + hh * 1.1)} ${px(b.z)} ${Y(b.cy + b.h / 2)}Z"/>`; })()
      : (() => { const a = FU.at(T.canopy.t[0] + .02), b = FU.at(T.canopy.t[1]); return `<path class="g" d="M${px(a.z)} ${Y(a.cy + a.h * .12)}L${px(a.z - .25)} ${Y(a.cy + a.h * .42)}L${px(b.z + .2)} ${Y(b.cy + b.h * .4)}L${px(b.z)} ${Y(b.cy + b.h * .12)}Z"/>`; })();
    const belly = rs.cy - rs.h / 2, wy0 = Y(belly - T.gear.legLen), r = T.gear.r * k;
    const mainZ = T.gear.type === 'tail' ? T.wing.le - .05 : T.wing.le - c0 * .62 - .1;
    const wheels = `<circle cx="${px(mainZ)}" cy="${wy0 - r}" r="${r}"/>` + (T.gear.type === 'tri' ? `<circle cx="${px(FU.noseZ - .45)}" cy="${wy0 - r * .85}" r="${r * .85}"/>` : `<circle cx="${px(FU.tailZ + .35)}" cy="${Y(FU.at(.95).cy - FU.at(.95).h / 2 - .11)}" r="${.09 * k}"/>`);
    return `<svg viewBox="0 0 ${w} ${h}" class="ac-svg" aria-hidden="true"><g class="b">${wheels}<path d="${path}"/>${fin}</g><g class="w">${wing}</g>${canopy}</svg>`;
  }

  return { TYPES, byId, match, build, model, profileSVG };
})();
