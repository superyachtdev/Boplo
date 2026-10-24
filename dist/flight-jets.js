/* Boplo Flight — jets for the simulator: a business jet and a regional jet built in code, and five airliners.
   The small jets are built as a glTF binary from a short spec (real dimensions in metres). The airliners use 3D models by amvlab
   (CC BY 4.0, https://github.com/amvlab/aircraft-models), re-oriented, rescaled and repainted, with landing gear added by Boplo.
   Liveries are Boplo's own or invented airlines, with no manufacturer marks.
   Performance figures are typical, rounded and used only to make each type feel right in a game-like flight model.
   glTF axes: +Y up, +Z forward, +X to the left wing. Registers itself with BoploAircraft and BoploPhysics. */
(() => {
  'use strict';
  const D2R = Math.PI / 180;
  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1]; };

  // liveries: base, tail, accent (stripe and tail art), belly, engines. All airline names are invented.
  const LIVERIES = {
    boplo: { name: 'Boplo', base: '#F5F7FA', tail: '#0A62FF', accent: '#9ED8FF', belly: '#F5F7FA', engine: '#0A62FF', art: 'spark' },
    northwind: { name: 'Northwind', base: '#F5F7FA', tail: '#0B1F3A', accent: '#2BC4B6', belly: '#0B1F3A', engine: '#0B1F3A', art: 'band' },
    solair: { name: 'Solair', base: '#F7F5F2', tail: '#F26B21', accent: '#FFC23D', belly: '#D9DCE1', engine: '#F26B21', art: 'sun' },
    fjord: { name: 'Fjord Air', base: '#F5F7FA', tail: '#C8102E', accent: '#F5F7FA', belly: '#F5F7FA', engine: '#9AA3AF', art: 'cross' },
    verde: { name: 'Verde', base: '#F5F7FA', tail: '#0F7B5F', accent: '#B6E36A', belly: '#F5F7FA', engine: '#F5F7FA', art: 'band' },
    plain: { name: 'Plain white', base: '#F5F7FA', tail: '#F5F7FA', accent: '#C9CED6', belly: '#F5F7FA', engine: '#C9CED6', art: 'none' }
  };

  // perf in knots and feet per minute: vs (clean stall), vr, appr (final approach), cruise (indicated, low level), vmax, climb.
  const JETS = [
    { id: 'bizjet', kind: 'jet', cat: 'Business jet', name: 'Light business jet', blurb: 'Six seats, T-tail and engines on the tail. Quick, nimble and climbs like a rocket.',
      span: 15.9, len: 15.6, dia: 1.7, hgt: 1.8, nose: .17, tailc: .3, upsweep: .35, windows: { from: .2, to: .5, pitch: .78, w: .34, h: .4, round: true },
      wing: { at: .5, root: 2.9, kink: 0, tip: 1.05, sweep: 14, dih: 3, t: [.13, .1], winglet: 'blended', wl: .9 },
      eng: { mount: 'rear', n: 2, dia: .78, len: 2.5, t: .76 },
      tail: { type: 'T', finH: 2.5, finRoot: 2.6, finTip: 1.3, finSweep: 38, stabSpan: 3.1, stabRoot: 1.35, stabTip: .7, stabSweep: 28 },
      gear: { track: 2.6, nose: .12, r: .3, leg: .55, mainWheels: 1, noseWheels: 1 }, livery: 'boplo',
      perf: { vs: 95, vr: 100, appr: 112, cruise: 250, vmax: 320, climb: 3500 } },
    { id: 'rj', kind: 'jet', cat: 'Regional jet', name: 'Regional jet', blurb: 'An 80-seat twinjet for short hops, sized like an E175. Light on the controls for an airliner.',
      span: 28.7, len: 31.7, dia: 3.0, hgt: 3.35, nose: .1, tailc: .22, upsweep: .4, windows: { from: .16, to: .72, pitch: .78, w: .3, h: .42 },
      wing: { at: .45, root: 5.2, kink: .36, kinkChord: 3.1, tip: 1.3, sweep: 25, dih: 5, t: [.13, .1], winglet: 'blended', wl: 1.6 },
      eng: { mount: 'wing', n: 2, dia: 1.45, len: 3.2, x: [.34] },
      tail: { type: 'conv', finH: 5.0, finRoot: 4.3, finTip: 1.8, finSweep: 40, stabSpan: 5.1, stabRoot: 2.6, stabTip: 1.1, stabSweep: 32 },
      gear: { track: 5.0, nose: .1, r: .5, leg: 1.0, mainWheels: 2, noseWheels: 2 }, livery: 'northwind',
      perf: { vs: 125, vr: 130, appr: 128, cruise: 250, vmax: 320, climb: 2800 } },
    // airliners use 3D models by amvlab (CC BY 4.0, github.com/amvlab/aircraft-models), re-oriented and rescaled offline; Boplo adds gear and liveries
    { id: 'narrow', kind: 'jet', cat: 'Airliner', name: 'Narrowbody airliner', blurb: 'The 180-seat workhorse of short-haul flying, modelled on the A320 family. Sharklets and all.',
      model: 'a320', span: 35.8, len: 38, geo: { dia: 4.35, chord: 7.79, mainZ: -4.67, noseZ: 7.42, bellyMain: -2.19, bellyNose: -1.9, noseTip: 11.6, tip: [17.9, 2.95, -11.65], fin: [0, 8.04, -23.93], yMin: -3.39 },
      gear: { track: 7.6, r: .58, leg: .9, mainWheels: 2, noseWheels: 2 }, livery: 'boplo', perf: { vs: 140, vr: 145, appr: 137, cruise: 250, vmax: 340, climb: 2500 } },
    { id: 'narrow2', kind: 'jet', cat: 'Airliner', name: 'Classic narrowbody', blurb: 'The best-selling jetliner shape, modelled on the 737: low to the ground with split winglets.',
      model: 'b737', span: 35.8, len: 38, geo: { dia: 4.09, chord: 7.39, mainZ: -4.44, noseZ: 9.06, bellyMain: -2.05, bellyNose: -1.95, noseTip: 13.24, tip: [17.9, 2.6, -12.43], fin: [0, 9.17, -23.66], yMin: -2.73 },
      gear: { track: 5.7, r: .56, leg: .55, mainWheels: 2, noseWheels: 2 }, livery: 'northwind', perf: { vs: 142, vr: 145, appr: 140, cruise: 250, vmax: 340, climb: 2500 } },
    { id: 'wide', kind: 'jet', cat: 'Airliner', name: 'Widebody airliner', blurb: 'A long-haul twin with a flexible composite wing, modelled on the 787. Big, smooth and stable.',
      model: 'b787', darkTail: true, span: 60.1, len: 58.6, geo: { dia: 6.44, chord: 11.7, mainZ: -7.02, noseZ: 14.25, bellyMain: -3.3, bellyNose: -2.91, noseTip: 20.7, tip: [30.05, 3.27, -19.76], fin: [0, 12.13, -36.55], yMin: -4.78 },
      gear: { track: 9.8, r: .68, leg: 1.3, mainWheels: 4, noseWheels: 2 }, livery: 'solair', perf: { vs: 145, vr: 155, appr: 145, cruise: 260, vmax: 340, climb: 2200 } },
    { id: 'wide2', kind: 'jet', cat: 'Airliner', name: 'Long-haul widebody', blurb: 'Curved wingtips and a long, slender fuselage, modelled on the A350. Built for 15-hour flights.',
      model: 'a350', span: 64.75, len: 64.7, geo: { dia: 6.25, chord: 11.43, mainZ: -6.86, noseZ: 16.95, bellyMain: -3.13, bellyNose: -2.87, noseTip: 24.06, tip: [32.38, 3.51, -21.77], fin: [0, 11.38, -39.13], yMin: -5.12 },
      gear: { track: 10.6, r: .7, leg: 1.4, mainWheels: 4, noseWheels: 2 }, livery: 'verde', perf: { vs: 145, vr: 155, appr: 142, cruise: 260, vmax: 340, climb: 2300 } },
    { id: 'jumbo', kind: 'jet', cat: 'Airliner', name: 'Double-deck superjumbo', blurb: 'The biggest passenger jet of all, modelled on the A380: two full decks, four engines and an 80-metre wing.',
      model: 'a380', span: 79.75, len: 73.3, geo: { dia: 8.01, chord: 15.79, mainZ: -9.48, noseZ: 16.99, bellyMain: -4.01, bellyNose: -3.66, noseTip: 25.05, tip: [39.88, 2.27, -28.71], fin: [0, 16.75, -45.57], yMin: -5.34 },
      gear: { track: 12.5, r: .7, leg: 1.2, mainWheels: 4, noseWheels: 2, bodyGear: true }, livery: 'fjord', perf: { vs: 145, vr: 150, appr: 140, cruise: 260, vmax: 340, climb: 1800 } }
  ];

  // flight-model data (BoploPhysics): mass (kg), wing area (m²), total thrust (N), flap notches, speeds (kt), wheelbase (m)
  const PHYS = {
    bizjet: { m: 7600, S: 30.0, span: 15.9, jet: true, T0: 2 * 17800, CD0: .024, spool: 2, agility: .9, flaps: [[0, 'UP'], [15, 'T/O'], [35, 'LDG']], vso: 88, vfe: 200, vno: 300, vne: 340, wb: 6.2, retract: true },
    rj: { m: 33000, S: 72.7, span: 28.7, jet: true, T0: 2 * 63000, CD0: .022, spool: 3, agility: .65, flaps: [[0, 'UP'], [7, '1'], [10, '2'], [20, '4'], [37, 'FULL']], vso: 105, vfe: 230, vno: 320, vne: 340, wb: 14.6, retract: true },
    narrow: { m: 64000, S: 122.6, span: 35.8, jet: true, T0: 2 * 120000, CD0: .021, spool: 4, agility: .55, flaps: [[0, 'UP'], [10, '1'], [15, '2'], [20, '3'], [35, 'FULL']], vso: 110, vfe: 230, vno: 340, vne: 350, wb: 12.6, retract: true },
    narrow2: { m: 62000, S: 124.6, span: 35.8, jet: true, T0: 2 * 121000, CD0: .021, spool: 4, agility: .55, flaps: [[0, 'UP'], [5, '5'], [15, '15'], [25, '25'], [30, '30']], vso: 112, vfe: 230, vno: 340, vne: 350, wb: 15.6, retract: true },
    wide: { m: 200000, S: 360, span: 60.1, jet: true, T0: 2 * 320000, CD0: .02, spool: 5, agility: .45, flaps: [[0, 'UP'], [5, '5'], [15, '15'], [20, '20'], [30, '30']], vso: 118, vfe: 250, vno: 340, vne: 350, wb: 25.6, retract: true },
    wide2: { m: 210000, S: 443, span: 64.75, jet: true, T0: 2 * 374000, CD0: .02, spool: 5, agility: .45, flaps: [[0, 'UP'], [10, '1'], [15, '2'], [20, '3'], [32, 'FULL']], vso: 116, vfe: 250, vno: 340, vne: 350, wb: 28.6, retract: true },
    jumbo: { m: 390000, S: 845, span: 79.75, jet: true, T0: 4 * 311000, CD0: .021, spool: 6, agility: .38, flaps: [[0, 'UP'], [10, '1'], [15, '2'], [20, '3'], [33, 'FULL']], vso: 115, vfe: 220, vno: 340, vne: 350, wb: 33.6, retract: true }
  };

  function fuselage(J) {
    const L = J.len, noseZ = J.wing.at * L;
    const at = t => {
      t = Math.min(1, Math.max(0, t));
      let w = J.dia, h = J.hgt, cy = 0;
      if (t < J.nose) { const u = t / J.nose, f = Math.pow(Math.max(0, 1 - (1 - u) ** 2), .5); w *= Math.max(.04, f); h *= Math.max(.04, Math.pow(Math.max(0, 1 - (1 - u) ** 2), .62)); cy = -J.hgt * .16 * (1 - u) ** 2; }
      else if (t > 1 - J.tailc) { const u = (t - (1 - J.tailc)) / J.tailc; w *= 1 - .9 * Math.pow(u, 1.15); h *= 1 - .87 * Math.pow(u, .95); cy = J.hgt * J.upsweep * Math.pow(u, 1.25); }
      if (J.hump && t < J.hump.to + .1) { const u = t < .015 ? 0 : t < J.hump.to ? Math.min(1, (t - .015) / .07) : Math.max(0, 1 - (t - J.hump.to) / .1), s = u * u * (3 - 2 * u), dh = J.hump.h * s * (t < J.nose ? Math.min(1, t / J.nose * 1.3) : 1); h += dh; cy += dh / 2; w *= t < J.nose ? 1 : 1 - .06 * s * 0; }
      return { z: noseZ - t * L, w, h, cy };
    };
    return { L, noseZ, tailZ: noseZ - L, at, tOfZ: z => (noseZ - z) / L };
  }

  // merge each part into one mesh with smooth normals, and write a glTF binary
  function writeGLB(parts) {
    const merge = list => { const pos = [], col = [], idx = []; for (const m of list) { const o = pos.length / 3; for (const v of m.pos) pos.push(v); for (const v of m.col) col.push(v); for (const i of m.idx) idx.push(i + o); } const nor = new Float32Array(pos.length); for (let i = 0; i < idx.length; i += 3) { const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3; const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; for (const k of [a, b, c]) { nor[k] += n[0]; nor[k + 1] += n[1]; nor[k + 2] += n[2]; } } for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; } return { pos: new Float32Array(pos), nor, col: new Float32Array(col), idx: new Uint32Array(idx) }; };
    const mat = (rough, metal, extra = {}) => ({ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: metal, roughnessFactor: rough }, doubleSided: true, ...extra });
    const MATS = { paint: mat(.26, .04), metal: mat(.3, .85), matte: mat(.7, .15), glass: mat(.06, .3), gear: mat(.55, .4), ailL: mat(.28, .04), ailR: mat(.28, .04), flapL: mat(.28, .04), flapR: mat(.28, .04), elev: mat(.28, .04), rud: mat(.28, .04) };
    const prims = Object.keys(parts).filter(k => parts[k].length).map(k => ({ name: k, geo: merge(parts[k]), mat: MATS[k] }));
    const chunks = [], views = [], accessors = []; let off = 0;
    const addView = (arr, target) => { const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - bytes.length % 4) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, target }); chunks.push(bytes); if (pad) chunks.push(new Uint8Array(pad)); off += bytes.length + pad; return views.length - 1; };
    const meshes = prims.map((p, pi) => {
      const { pos, nor, col, idx } = p.geo, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
      const acc = (view, type, comp, count, extra = {}) => { accessors.push({ bufferView: view, componentType: comp, count, type, ...extra }); return accessors.length - 1; };
      const aP = acc(addView(pos, 34962), 'VEC3', 5126, pos.length / 3, { min, max }), aN = acc(addView(nor, 34962), 'VEC3', 5126, nor.length / 3), aC = acc(addView(col, 34962), 'VEC4', 5126, col.length / 4), aI = acc(addView(idx, 34963), 'SCALAR', 5125, idx.length);
      return { name: p.name, primitives: [{ attributes: { POSITION: aP, NORMAL: aN, COLOR_0: aC }, indices: aI, material: pi }] };
    });
    const json = { asset: { version: '2.0', generator: 'Boplo Flight' }, scene: 0, scenes: [{ nodes: prims.map((_, i) => i) }], nodes: prims.map((p, i) => ({ mesh: i, name: p.name })), meshes, materials: prims.map(p => ({ name: p.name, ...p.mat })), accessors, bufferViews: views, buffers: [{ byteLength: off }] };
    let jsonBytes = new TextEncoder().encode(JSON.stringify(json)); const jpad = (4 - jsonBytes.length % 4) % 4;
    if (jpad) { const t = new Uint8Array(jsonBytes.length + jpad); t.set(jsonBytes); t.fill(32, jsonBytes.length); jsonBytes = t; }
    const total = 12 + 8 + jsonBytes.length + 8 + off, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jsonBytes, 20);
    let p = 20 + jsonBytes.length; dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004E4942, true); p += 8;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  // ---- 3D models: fetch once, repaint the texture in the livery's colours, and merge in the procedural gear ----
  const modelCache = new Map();
  const parseGLB = buf => { const dv = new DataView(buf), jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl))), bo = 20 + jl, bl = dv.getUint32(bo, true); return { json, bin: new Uint8Array(buf, bo + 8, bl) }; };
  const pad4 = n => (n + 3) & ~3;
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  // the source paint is replaced by hue class: dark saturated paint (tails, cheatlines) takes the livery's tail colour, light saturated paint its accent
  async function repaint(bytes, mime, LV, darkTail) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime })), cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0); const im = cx.getImageData(0, 0, cv.width, cv.height), d = im.data;
    const T = rgb(LV.tail), A = rgb(LV.accent), W = cv.width, H = cv.height, src = d.slice();
    // near-white paint: small dark marks with white on both sides are windows and outlines, which stay dark
    const white = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const j = (y * W + x) * 4, mx = Math.max(src[j], src[j + 1], src[j + 2]), mn = Math.min(src[j], src[j + 1], src[j + 2]); return mx > 190; };
    const R = Math.max(3, Math.round(W / 256));
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, sat = mx ? (mx - mn) / mx : 0;
      if (darkTail && mn >= 8 && mx <= 30) { d[i] = T[0] * .9; d[i + 1] = T[1] * .9; d[i + 2] = T[2] * .9; continue; }
      if (sat < .3 || v < .12) continue;
      if (v < .62) { const x = (i >> 2) % W, y = (i >> 2) / W | 0; if ((white(x - R, y) && white(x + R, y)) || (white(x, y - R) && white(x, y + R))) { d[i] = 28; d[i + 1] = 34; d[i + 2] = 44; continue; } }
      const dark = v < .62, tgt = dark ? T : A, k = .82 + .18 * Math.min(1.2, v / (dark ? .45 : .9));
      d[i] = Math.min(255, tgt[0] * k); d[i + 1] = Math.min(255, tgt[1] * k); d[i + 2] = Math.min(255, tgt[2] * k);
    }
    cx.putImageData(im, 0, 0);
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', .9));
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function assemble(model, LV, gearGLB, darkTail) {
    if (!modelCache.has(model)) modelCache.set(model, fetch(`/aircraft-models/${model}.glb?v=1`).then(r => { if (!r.ok) throw new Error('model ' + r.status); return r.arrayBuffer(); }));
    const M = parseGLB(await modelCache.get(model)), Gr = parseGLB(gearGLB.buffer.slice(gearGLB.byteOffset, gearGLB.byteOffset + gearGLB.byteLength));
    const j = JSON.parse(JSON.stringify(M.json)), gj = Gr.json, img = j.images[0], iv = j.bufferViews[img.bufferView];
    let tex = M.bin.subarray(iv.byteOffset || 0, (iv.byteOffset || 0) + iv.byteLength), mime = img.mimeType;
    try { tex = await repaint(tex, mime, LV, darkTail); mime = 'image/jpeg'; } catch (e) { /* keep the original paint */ }
    const texOff = pad4(M.bin.length), gearOff = pad4(texOff + tex.length), total = gearOff + Gr.bin.length, bin = new Uint8Array(pad4(total));
    bin.set(M.bin, 0); bin.set(tex, texOff); bin.set(Gr.bin, gearOff);
    j.bufferViews.push({ buffer: 0, byteOffset: texOff, byteLength: tex.length }); img.bufferView = j.bufferViews.length - 1; img.mimeType = mime;
    const vBase = j.bufferViews.length, aBase = j.accessors.length, mBase = (j.materials || []).length, meBase = j.meshes.length, nBase = j.nodes.length;
    for (const v of gj.bufferViews) j.bufferViews.push({ ...v, byteOffset: (v.byteOffset || 0) + gearOff });
    for (const a of gj.accessors) j.accessors.push({ ...a, bufferView: a.bufferView + vBase });
    j.materials = [...(j.materials || []), ...gj.materials];
    for (const m of gj.meshes) j.meshes.push({ ...m, primitives: m.primitives.map(p => ({ ...p, indices: p.indices + aBase, material: p.material + mBase, attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, v + aBase])) })) });
    for (const n of gj.nodes) j.nodes.push({ ...n, mesh: n.mesh + meBase });
    j.scenes[j.scene || 0].nodes.push(...gj.nodes.map((_, i) => nBase + i));
    j.buffers = [{ byteLength: bin.length }];
    let jb = new TextEncoder().encode(JSON.stringify(j)); const jp = pad4(jb.length);
    if (jp !== jb.length) { const t = new Uint8Array(jp).fill(32); t.set(jb); jb = t; }
    const out = new Uint8Array(12 + 8 + jb.length + 8 + bin.length), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
    dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jb, 20);
    const p = 20 + jb.length; dv.setUint32(p, bin.length, true); dv.setUint32(p + 4, 0x004E4942, true); out.set(bin, p + 8);
    return out;
  }

  function build(id, liveryId) {
    const J = JETS.find(j => j.id === id), LV = LIVERIES[liveryId] || LIVERIES[J.livery] || LIVERIES.boplo;
    const parts = { paint: [], metal: [], matte: [], glass: [], gear: [], ailL: [], ailR: [], flapL: [], flapR: [], elev: [], rud: [] };
    const C = { base: hex(LV.base), tail: hex(LV.tail), acc: hex(LV.accent), belly: hex(LV.belly), eng: hex(LV.engine), metal: [.78, .8, .83, 1], dark: [.06, .065, .075, 1], grey: [.5, .53, .58, 1], rubber: [.03, .03, .035, 1], glass: [.09, .12, .17, 1], door: [.6, .63, .68, 1] };
    const mesh = b => { const m = { pos: [], col: [], idx: [] }; parts[b].push(m); return m; };
    // loft rings into a surface; colour is one value, one per ring, or a function of (ring, point)
    function loft(b, rings, col, { closed = true, capStart = false, capEnd = false } = {}) {
      const m = mesh(b), n = rings[0].length, cf = typeof col === 'function' ? col : Array.isArray(col[0]) ? (i => col[i]) : (() => col);
      rings.forEach((r, i) => r.forEach((p, j) => { m.pos.push(p[0], p[1], p[2]); m.col.push(...cf(i, j, p)); }));
      const seg = closed ? n : n - 1;
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * n + j, bb = i * n + (j + 1) % n, c = (i + 1) * n + (j + 1) % n, d = (i + 1) * n + j; m.idx.push(a, bb, c, a, c, d); }
      const cap = (ri, flip) => { const r = rings[ri], cx = r.reduce((s, p) => s + p[0], 0) / n, cy = r.reduce((s, p) => s + p[1], 0) / n, cz = r.reduce((s, p) => s + p[2], 0) / n, k = m.pos.length / 3; m.pos.push(cx, cy, cz); m.col.push(...cf(ri, 0, r[0])); for (let j = 0; j < n; j++) { const a = ri * n + j, bb = ri * n + (j + 1) % n; flip ? m.idx.push(k, bb, a) : m.idx.push(k, a, bb); } };
      if (capStart) cap(0, false); if (capEnd) cap(rings.length - 1, true);
      return m;
    }
    const sup = (e, a) => Math.sign(a) * Math.pow(Math.abs(a), 2 / e);
    const ring = (z, cy, w, h, n = 40, e = 2.15, cx = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return [cx + w / 2 * sup(e, Math.cos(a)), cy + h / 2 * sup(e, Math.sin(a)), z]; });
    const arc = (s, a0, a1, n, k = 1.006, e = 2.15) => Array.from({ length: n }, (_, i) => { const a = a0 + (a1 - a0) * i / (n - 1); return [s.w / 2 * k * sup(e, Math.cos(a)), s.cy + s.h / 2 * k * sup(e, Math.sin(a)), s.z]; });
    const tube = (a, b, r, n = 10, col = C.grey, bucket = 'gear') => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d), u = d.map(v => v / L); const p = Math.abs(u[1]) < .9 ? [0, 1, 0] : [1, 0, 0]; let v1 = [u[1] * p[2] - u[2] * p[1], u[2] * p[0] - u[0] * p[2], u[0] * p[1] - u[1] * p[0]]; const l1 = Math.hypot(...v1); v1 = v1.map(x => x / l1); const v2 = [u[1] * v1[2] - u[2] * v1[1], u[2] * v1[0] - u[0] * v1[2], u[0] * v1[1] - u[1] * v1[0]]; const rr = c => Array.from({ length: n }, (_, i) => { const t = i / n * Math.PI * 2; return [c[0] + (v1[0] * Math.cos(t) + v2[0] * Math.sin(t)) * r, c[1] + (v1[1] * Math.cos(t) + v2[1] * Math.sin(t)) * r, c[2] + (v1[2] * Math.cos(t) + v2[2] * Math.sin(t)) * r]; }); loft(bucket, [rr(a), rr(b)], col, { capStart: true, capEnd: true }); };
    const thick = (t, s) => 5 * t * (.2969 * Math.sqrt(s) - .126 * s - .3516 * s * s + .2843 * s ** 3 - .1036 * s ** 4);
    const camb = (m, s) => m * (s < .4 ? (2 * .4 * s - s * s) / .16 : (1 - .8 + 2 * .4 * s - s * s) / .36);
    const foil = (t, m, n = 14, cut = null) => { const up = [], lo = []; for (let i = 0; i <= n; i++) { let s = (1 - Math.cos(i / n * Math.PI)) / 2; if (cut != null) s = Math.min(s, cut); up.push([s, camb(m, s) + thick(t, s)]); lo.push([s, camb(m, s) - thick(t, s)]); } return [...up.reverse(), ...lo.slice(1, -1)]; };
    // a control surface: the aerofoil aft of the hinge line, with enough points to shade smoothly like the rest of the wing
    const wedge = (t, m, cut, n = 7) => { const up = [], lo = []; for (let i = 0; i <= n; i++) { const s = cut + (1 - cut) * (1 - Math.cos(i / n * Math.PI / 2)); const th = Math.max(thick(t, s), .0012); up.push([s, camb(m, s) + th]); lo.push([s, camb(m, s) - th]); } return [...up, ...lo.reverse()]; };

    // ---- airliners from a 3D model: Boplo builds the landing gear here and load() adds the model with the livery painted on ----
    if (J.model) {
      const g = J.geo, G = J.gear, belly = g.bellyMain, wheelY = Math.min(belly - G.leg - G.r * 2, g.yMin - .45);
      const wheel = (x, z, r, wd) => { const tyre = []; for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2; tyre.push([x + wd / 2, wheelY + r + Math.sin(a) * r, z + Math.cos(a) * r]); } loft('gear', [tyre, tyre.map(p => [p[0] - wd, p[1], p[2]])], C.rubber, { closed: false });
        for (const sx of [1, -1]) { const hub = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; hub.push([x + sx * wd / 2 * 1.01, wheelY + r + Math.sin(a) * r * .62, z + Math.cos(a) * r * .62]); } loft('gear', [hub, hub.map(p => [x + sx * wd * .2, p[1], p[2]])], C.grey, { closed: true }); } };
      const bogie = (x, z, n, nose, top) => {
        const r = nose ? G.r * .7 : G.r, wd = r * .7;
        tube([x, top, z], [x, wheelY + r, z], nose ? .1 : .16, 10, C.metal);
        if (n === 2) { wheel(x + r * .55, z, r, wd); wheel(x - r * .55, z, r, wd); tube([x + r * .6, wheelY + r, z], [x - r * .6, wheelY + r, z], .07, 8, C.grey); }
        else { const dz = r * 1.15, k = n / 2; for (let i = 0; i < k; i++) { const zz = z + dz * (i - (k - 1) / 2) * 2; wheel(x + r * .6, zz, r, wd); wheel(x - r * .6, zz, r, wd); } tube([x, wheelY + r, z + dz * (k - 1)], [x, wheelY + r, z - dz * (k - 1)], .11, 8, C.grey); }
      };
      for (const sx of [1, -1]) bogie(sx * G.track / 2, g.mainZ, G.mainWheels, false, belly + .4);
      if (G.bodyGear) for (const sx of [1, -1]) bogie(sx * g.dia * .22, g.mainZ - 2.8, 4, false, belly + .2);
      bogie(0, g.noseZ, G.noseWheels, true, g.bellyNose + .3);
      const gearGLB = writeGLB(parts);
      const AC = { glb: null, S: J.span / 3.24, hub: [0, 0, 0], wheelDrop: -wheelY, groundAtt: 0, jet: true, surfaces: {},
        eye: [g.dia * .12, g.dia * .13, g.noseTip - g.dia * .62], beacon: [0, g.dia / 2 + .12, g.mainZ + 1],
        tips: { left: g.tip, right: [-g.tip[0], g.tip[1], g.tip[2]], tail: g.fin }, perf: J.perf, type: { ...J, gear: { type: 'tri' } }, livery: LV, length: J.len,
        credit: 'Aircraft model by amvlab (CC BY 4.0), modified by Boplo' };
      AC.load = async () => { if (!AC.glb) AC.glb = await assemble(J.model, LV, gearGLB, J.darkTail); return AC; };
      return AC;
    }

    // ---- fuselage, with belly colour, a cheatline, windows, doors and the flight deck glass ----
    const FU = fuselage(J), at = FU.at, ts = []; for (let t = 0; t <= 1.00001; t += .0125) ts.push(Math.min(1, t));
    for (let t = 0; t < J.nose; t += J.nose / 8) ts.push(t); ts.sort((a, b) => a - b);
    const fusRings = [...new Set(ts.map(t => +t.toFixed(5)))].map(t => { const s = at(t); return ring(s.z, s.cy, s.w, s.h); });
    loft('paint', fusRings, C.base, { capEnd: true });
    const body = ts.filter(t => t > J.nose * .5 && t < .985);
    // belly: an overlay a hair outside the skin, so its edge stays crisp
    if (LV.belly !== LV.base) loft('paint', body.map(t => arc(at(t), Math.PI * 1.15, Math.PI * 1.85, 14, 1.004)), C.belly, { closed: false });
    // cheatline under the windows on both sides
    for (const sd of [0, Math.PI]) {
      const a = sd ? Math.PI + .14 : -.14, s = sd ? 1 : -1;
      loft('paint', body.filter(t => t > J.windows.from - .04 && t < .9).map(t => arc(at(t), a - s * .025, a + s * .025, 3, 1.007)), C.acc, { closed: false });
    }
    // passenger windows: small dark panes along both sides
    const W = J.windows;
    for (const side of [1, -1]) {
      for (let z = FU.noseZ - W.from * FU.L; z > FU.noseZ - W.to * FU.L; z -= W.pitch) {
        const t = FU.tOfZ(z), s = at(t), a = .2, x = side * s.w / 2 * 1.006 * Math.cos(a) ** (2 / 2.15), y = s.cy + s.h / 2 * Math.sin(a) ** (2 / 2.15);
        const hw = W.w / 2, hh = W.h / 2, pts = [];
        for (let i = 0; i < 12; i++) { const th = i / 12 * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th); pts.push([x + side * .004, y + sn * hh, z + c * hw]); }
        const m = mesh('glass'), base = m.pos.length / 3; pts.forEach(p => { m.pos.push(...p); m.col.push(...C.glass); }); m.pos.push(x + side * .004, y, z); m.col.push(...C.glass);
        for (let i = 0; i < 12; i++) side > 0 ? m.idx.push(base + 12, base + i, base + (i + 1) % 12) : m.idx.push(base + 12, base + (i + 1) % 12, base + i);
      }
    }
    // doors: thin grey outlines, front and back on both sides
    const door = (t, dw, dh, side) => { const s = at(t), z0 = s.z, a = .08, x = side * s.w / 2 * 1.007, y = s.cy + s.h / 2 * Math.sin(a) * .5 - .1, e = .03;
      const quad = (y0, y1, za, zb) => { const m = mesh('paint'), b0 = m.pos.length / 3; [[y0, za], [y1, za], [y1, zb], [y0, zb]].forEach(([yy, zz]) => { m.pos.push(x, yy, zz); m.col.push(...C.door); }); side > 0 ? m.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3) : m.idx.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2); };
      quad(y - dh / 2, y + dh / 2, z0 + dw / 2, z0 + dw / 2 - e); quad(y - dh / 2, y + dh / 2, z0 - dw / 2 + e, z0 - dw / 2); quad(y + dh / 2 - e, y + dh / 2, z0 + dw / 2, z0 - dw / 2); quad(y - dh / 2, y - dh / 2 + e, z0 + dw / 2, z0 - dw / 2); };
    for (const side of [1, -1]) { door(W.from - .025, .85, Math.min(1.85, J.hgt * .48), side); door(W.to + .025, .8, Math.min(1.8, J.hgt * .46), side); }
    // flight deck windows: a dark band round the upper nose, with frame posts
    { const t0 = J.nose * (J.hump ? .6 : .66), t1 = J.nose * .9, st = []; for (let i = 0; i <= 6; i++) st.push(t0 + (t1 - t0) * i / 6);
      // the panes run from the side windows up to the front windscreens; a little lower at the back, like a real flight deck
      loft('glass', st.map((t, i) => { const s = at(t), k = i / 6; return arc(s, .5 - .08 * k, Math.PI - .5 + .08 * k, 24, 1.008); }), C.glass, { closed: false });
      for (const a of [Math.PI / 2, Math.PI / 2 + .3, Math.PI / 2 - .3, Math.PI / 2 + .62, Math.PI / 2 - .62]) loft('paint', st.map(t => arc(at(t), a - .016, a + .016, 2, 1.012)), C.base, { closed: false }); }

    // ---- wing: swept, with a trailing-edge kink, dihedral, flaps and ailerons, and winglets ----
    const WG = J.wing, semi = J.span / 2, rootT = WG.at, rs = at(rootT), rootY = rs.cy - rs.h * .33, x0 = rs.w * .42;
    const wl = WG.winglet === 'blended' ? WG.wl * .4 : WG.winglet === 'raked' ? WG.wl : 0, tipX = semi - (WG.winglet === 'blended' ? WG.wl * .25 : wl);
    const kinkX = WG.kink ? semi * WG.kink : 0, tanS = Math.tan(WG.sweep * D2R), dih = Math.tan(WG.dih * D2R), flex = WG.flex || 0;
    const leZ = x => -tanS * x, yAt = x => rootY + x * dih + flex * (x / semi) ** 2;
    const chordAt = x => { if (WG.kink && x < kinkX) return WG.root + (WG.kinkChord - WG.root) * x / kinkX; const x1 = WG.kink ? kinkX : 0, c1 = WG.kink ? WG.kinkChord : WG.root; return c1 + (WG.tip - c1) * (x - x1) / (tipX - x1); };
    const thAt = x => WG.t[0] + (WG.t[1] - WG.t[0]) * Math.min(1, x / tipX), cm = .015;
    const pt = (side, x, s, v, y = yAt(x), z = leZ(x), c = chordAt(x), n = [0, 1]) => [side * x + side * n[0] * v * c, y + n[1] * v * c, z - s * c];
    const flapA = x0 + .25, flapB = WG.kink ? kinkX + (tipX - kinkX) * .52 : tipX * .62, ailA = flapB + .15, ailB = tipX * .93, CUT = .76;
    const xs = [...new Set([x0, x0 + .2, ...(WG.kink ? [kinkX] : []), flapA - .01, flapA + .01, flapB - .01, flapB + .01, ailA - .01, ailA + .01, ailB - .01, ailB + .01, tipX * .2, tipX * .4, tipX * .6, tipX * .8, tipX].map(v => +v.toFixed(4)))].map(x => Math.min(x, tipX)).filter(x => x >= x0 && x <= tipX + 1e-6).sort((a, b) => a - b);
    if (xs[xs.length - 1] < tipX) xs.push(tipX);
    const inFlap = x => x > flapA && x < flapB, inAil = x => x > ailA && x < ailB;
    const surfaces = {};
    for (const side of [1, -1]) {
      const rings = xs.map(x => foil(thAt(x), cm, 14, inFlap(x) || inAil(x) ? CUT : null).map(([s, v]) => pt(side, x, s, v)));
      // a root ring tucked inside the fuselage closes the wing at the body
      rings.unshift(foil(thAt(0), cm).map(([s, v]) => pt(side, x0 * .6, s, v)));
      loft('paint', side > 0 ? rings : rings.map(r => r.slice().reverse()), C.base, { capEnd: !wl });
      for (const [kind, a, b] of [['flap', flapA, flapB], ['ail', ailA, ailB]]) {
        const name = kind + (side > 0 ? 'L' : 'R'), sx = [a + .01, (a + b) / 2, b - .01]; if (WG.kink && kind === 'flap' && kinkX > a && kinkX < b) sx.splice(1, 1, kinkX);
        const wr = sx.map(x => wedge(thAt(x), cm, CUT).map(([s, v]) => pt(side, x, s, v)));
        loft(name, side > 0 ? wr : wr.map(r => r.slice().reverse()), C.base, { capStart: true, capEnd: true });
        const h0 = pt(side, a, CUT, camb(cm, CUT)), h1 = pt(side, b, CUT, camb(cm, CUT));
        surfaces[name] = { a: side > 0 ? h0 : h1, b: side > 0 ? h1 : h0, max: kind === 'ail' ? 20 : 40, kind };
      }
      // flap-track fairings under the trailing edge
      for (const x of [flapA + (flapB - flapA) * .3, flapA + (flapB - flapA) * .75, ailA - .1]) { const c = chordAt(x), z = leZ(x) - c * .55, y = yAt(x) - c * .04; loft('paint', [[z + c * .2, .02], [z, c * .07], [z - c * .4, c * .08], [z - c * .62, .02]].map(([zz, r]) => ring(zz, y - r * .6, r * .7, r * 1.2, 10, 2.2, side * x)), C.base, { capStart: true, capEnd: true }); }
      // winglet: a smooth curve up from the tip (blended), or a raked tip that sweeps back further
      if (WG.winglet === 'blended') {
        const R = WG.wl * .35, ty = yAt(tipX), tz = leZ(tipX), steps = [];
        for (let i = 1; i <= 6; i++) { const th = i / 6 * Math.PI / 2 * .92; steps.push([tipX + R * Math.sin(th), ty + R * (1 - Math.cos(th)), tz - R * Math.sin(th) * .9, WG.tip * (1 - .3 * i / 6), th]); }
        const top = steps[steps.length - 1]; steps.push([top[0] + WG.wl * .1, top[1] + WG.wl * .65, top[2] - WG.wl * .55, WG.tip * .42, top[4]]);
        const wr = [foil(thAt(tipX), cm).map(([s, v]) => pt(side, tipX, s, v)), ...steps.map(([x, y, z, c, th]) => foil(.1, 0).map(([s, v]) => [side * x - side * Math.sin(th) * v * c, y + Math.cos(th) * v * c, z - s * c]))];
        loft('paint', side > 0 ? wr : wr.map(r => r.slice().reverse()), (i) => i >= 4 ? C.tail : C.base, { capEnd: true });
      } else if (WG.winglet === 'raked') {
        const st = [0, .35, .7, 1].map(k => [tipX + wl * k, yAt(tipX) + WG.wl * .12 * k * k, leZ(tipX) - wl * k * Math.tan((WG.sweep + 18) * D2R) * 1.1 - k * .3, WG.tip * (1 - .72 * k)]);
        const wr = st.map(([x, y, z, c]) => foil(thAt(tipX) * .95, cm * .5).map(([s, v]) => [side * x, y + v * c, z - s * c]));
        loft('paint', side > 0 ? wr : wr.map(r => r.slice().reverse()), C.base, { capEnd: true });
      }
    }
    const tipOut = WG.winglet === 'raked' ? tipX + wl : tipX + (WG.winglet === 'blended' ? WG.wl * .45 : 0), tipY = yAt(tipX) + (WG.winglet === 'blended' ? WG.wl * .8 : .2), tipZ = leZ(tipX) - WG.tip * .4;
    // wing-to-body fairing: a flattened pod under the wing root
    { const zc = leZ(0) - WG.root * .45, len = WG.root * 1.5; loft('paint', [[zc + len * .55, .1], [zc + len * .35, .8], [zc, 1], [zc - len * .3, .85], [zc - len * .55, .15]].map(([z, k]) => ring(z, rootY + .05, rs.w * (.86 + .14 * k), rs.h * .32 * k + .05, 24, 2.4)), C.belly, { capStart: true, capEnd: true }); }

    // ---- engines ----
    const E = J.eng, engPos = [];
    const nacelle = (cx, cy, cz, side) => {
      const r = E.dia / 2, L = E.len, prof = [[0, .86], [.03, .97], [.08, 1], [.3, 1.02], [.58, .97], [.8, .86], [.9, .78]];
      loft('metal', [ring(cz + .02, cy, r * 1.62, r * 1.62, 28, 2, cx), ring(cz, cy, r * 1.72, r * 1.72, 28, 2, cx), ring(cz - L * .03, cy, r * 1.94, r * 1.94, 28, 2, cx)], C.metal, { closed: true });
      loft('paint', prof.slice(1).map(([k, f]) => ring(cz - L * k, cy, 2 * r * f, 2 * r * f, 28, 2, cx)), C.eng, { closed: true });
      // fan face and spinner deep in the intake
      loft('matte', [ring(cz - L * .05, cy, r * 1.62, r * 1.62, 28, 2, cx), ring(cz - L * .06, cy, .05, .05, 28, 2, cx)], C.dark, { closed: true });
      loft('metal', [[cz - L * .05, r * .34], [cz - L * .02, r * .22], [cz + L * .005, r * .02]].map(([z, rr]) => ring(z, cy, rr * 2, rr * 2, 16, 2, cx)), C.metal, { capEnd: true });
      // core nozzle and exhaust plug
      loft('metal', [[cz - L * .9, r * .74], [cz - L * 1.0, r * .62], [cz - L * 1.04, r * .5]].map(([z, rr]) => ring(z, cy, rr * 2, rr * 2, 24, 2, cx)), C.grey, { closed: true });
      loft('matte', [[cz - L * 1.0, r * .46], [cz - L * 1.1, r * .3], [cz - L * 1.2, r * .05]].map(([z, rr]) => ring(z, cy, rr * 2, rr * 2, 16, 2, cx)), C.dark, { capEnd: true });
      engPos.push([cx, cy, cz - L * 1.1]);
    };
    if (E.mount === 'wing') {
      for (const side of [1, -1]) for (const fx of E.x.flatMap(v => E.n === 4 ? [v] : [v])) {
        const x = semi * fx, cy = yAt(x) - E.dia * .62 - .12, cz = leZ(x) + E.len * .6;
        nacelle(side * x, cy, cz, side);
        // pylon from the top of the nacelle up into the wing
        const py = [cz - E.len * .1, cz - E.len * .4, cz - E.len * .75, leZ(x) - chordAt(x) * .55].map((z, i) => { const yb = cy + E.dia * .4, yt = yAt(x) + .1, w = .28 + i * .02; return [[side * x - w / 2, yb, z], [side * x + w / 2, yb, z], [side * x + w / 2, yt, z], [side * x - w / 2, yt, z]]; });
        loft('paint', side > 0 ? py : py.map(r => r.slice().reverse()), C.base, { capStart: true, capEnd: true });
      }
    } else {
      const s = at(E.t);
      for (const side of [1, -1]) {
        const cx = side * (s.w / 2 + E.dia * .75), cy = s.cy + s.h * .18, cz = s.z + E.len * .55;
        nacelle(cx, cy, cz, side);
        const py = [cz - E.len * .25, cz - E.len * .45, cz - E.len * .7].map(z => [[side * s.w * .3, cy - .12, z], [cx - side * E.dia * .3, cy - .12, z], [cx - side * E.dia * .3, cy + .12, z], [side * s.w * .3, cy + .12, z]]);
        loft('paint', side > 0 ? py : py.map(r => r.slice().reverse()), C.base, { capStart: true, capEnd: true });
      }
    }

    // ---- tail: fin with a rudder, and a stabiliser with elevators (low, or on top of the fin) ----
    const TL = J.tail, tTail = 1 - J.tailc * .55, tsF = at(tTail), finRootY = tsF.cy + tsF.h * .3, finRootZ = tsF.z + TL.finRoot * .55;
    const finTanS = Math.tan(TL.finSweep * D2R), finC = k => TL.finRoot + (TL.finTip - TL.finRoot) * k, finLE = k => finRootZ - finTanS * TL.finH * k, RC = .7;
    const finPt = (k, s, v) => [v * finC(k), finRootY + TL.finH * k, finLE(k) - s * finC(k)];
    const finK = [-.15, 0, .25, .5, .75, 1];
    loft('paint', finK.map(k => foil(.11, 0, 12, RC).map(([s, v]) => finPt(k, s, v))), C.tail, { capEnd: true });
    const rk = [.04, .4, .7, .97];
    loft('rud', rk.map(k => wedge(.11, 0, RC).map(([s, v]) => finPt(k, s, v))), C.tail, { capStart: true, capEnd: true });
    surfaces.rud = { a: finPt(rk[0], RC, 0), b: finPt(rk[rk.length - 1], RC, 0), max: 25, kind: 'rud' };
    // tail art on both sides of the fin, just proud of the surface
    const art = (side) => {
      const off = (k, s) => { const c = finC(k), v = thick(.11, Math.min(s, .99)) + .004 / c; return [side * v * c, finRootY + TL.finH * k, finLE(k) - s * c]; };
      const poly = (pts, col) => { const m = mesh('paint'), b0 = m.pos.length / 3; pts.forEach(([k, s]) => { m.pos.push(...off(k, s)); m.col.push(...col); }); for (let i = 1; i < pts.length - 1; i++) side > 0 ? m.idx.push(b0, b0 + i, b0 + i + 1) : m.idx.push(b0, b0 + i + 1, b0 + i); };
      if (LV.art === 'spark') { const ck = .55, cs = .45, R = .28, r = .07, pts = []; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, rr = i % 2 ? r : R; pts.push([ck + Math.cos(a) * rr * 1.1, cs + Math.sin(a) * rr * (TL.finH / finC(.55)) * .55]); } poly([[ck, cs], ...pts, pts[0]], C.acc); }
      else if (LV.art === 'band') { poly([[.18, .25], [.18, .66], [.42, .74], [.42, .33]], C.acc); poly([[.5, .38], [.5, .78], [.62, .82], [.62, .44]], C.acc); }
      else if (LV.art === 'sun') { const ck = .55, cs = .5, pts = []; for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2; pts.push([ck + Math.cos(a) * .2, cs + Math.sin(a) * .2 * (TL.finH / finC(.55)) * .55]); } poly([[ck, cs], ...pts], C.acc); }
      else if (LV.art === 'cross') { poly([[.45, .15], [.45, .82], [.58, .86], [.58, .2]], C.acc); poly([[.22, .3], [.85, .48], [.85, .58], [.22, .4]], C.acc); }
    };
    if (LV.art !== 'none') { art(1); art(-1); }
    const stabTop = TL.type === 'T', stY = stabTop ? finRootY + TL.finH - .05 : tsF.cy - tsF.h * .05, stLE = stabTop ? finLE(1) + .1 : at(1 - J.tailc * .7).z + .2;
    const stTan = Math.tan(TL.stabSweep * D2R), stC = k => TL.stabRoot + (TL.stabTip - TL.stabRoot) * k, EC = .7;
    const stPt = (side, k, s, v) => [side * Math.max(TL.stabSpan * k, .1), stY + TL.stabSpan * k * Math.tan((stabTop ? -2 : 6) * D2R) + v * stC(k), stLE - stTan * TL.stabSpan * k - s * stC(k)];
    const stK = [0, .3, .6, .85, 1];
    for (const side of [1, -1]) {
      const main = stK.map(k => foil(.1, 0, 12, EC).map(([s, v]) => stPt(side, k, s, v)));
      loft('paint', side > 0 ? main : main.map(q => q.slice().reverse()), stabTop ? C.tail : C.base, { capEnd: true });
      const el = [.05, .5, .97].map(k => wedge(.1, 0, EC).map(([s, v]) => stPt(side, k, s, v)));
      loft('elev', side > 0 ? el : el.map(q => q.slice().reverse()), stabTop ? C.tail : C.base, { capStart: true, capEnd: true });
    }
    surfaces.elev = { a: stPt(-1, 1, EC, 0), b: stPt(1, 1, EC, 0), max: 25, kind: 'elev' };

    // ---- landing gear (its own node, so the simulator can retract it) ----
    const G = J.gear, beltT = rootT + WG.root / FU.L * .55, bs = at(beltT), belly = bs.cy - bs.h / 2, wheelY = belly - G.leg - G.r * 2, mainZ = leZ(0) - WG.root * .62;
    const wheel = (x, z, r, wd) => { const tyre = []; for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2; tyre.push([x + wd / 2, wheelY + r + Math.sin(a) * r, z + Math.cos(a) * r]); } loft('gear', [tyre, tyre.map(p => [p[0] - wd, p[1], p[2]])], C.rubber, { closed: false });
      for (const sx of [1, -1]) { const hub = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; hub.push([x + sx * wd / 2 * 1.01, wheelY + r + Math.sin(a) * r * .62, z + Math.cos(a) * r * .62]); } loft('gear', [hub, hub.map(p => [x + sx * wd * .2, p[1], p[2]])], C.grey, { closed: true }); } };
    const bogie = (x, z, n, nose) => {
      const r = nose ? G.r * .7 : G.r, wd = r * .7, top = nose ? at(G.nose).cy - at(G.nose).h * .42 : belly + .3;
      tube([x, top, z], [x, wheelY + r, z], nose ? .09 : .14, 10, C.metal);
      if (n === 1) wheel(x, z, r, wd);
      else if (n === 2) { wheel(x + r * .55, z, r, wd); wheel(x - r * .55, z, r, wd); tube([x + r * .6, wheelY + r, z], [x - r * .6, wheelY + r, z], .06, 8, C.grey); }
      else { const dz = r * 1.15, k = n / 2; for (let i = 0; i < k; i++) { const zz = z + dz * (i - (k - 1) / 2) * 2; wheel(x + r * .6, zz, r, wd); wheel(x - r * .6, zz, r, wd); } tube([x, wheelY + r, z + dz * (k - 1)], [x, wheelY + r, z - dz * (k - 1)], .1, 8, C.grey); }
    };
    for (const sx of [1, -1]) bogie(sx * G.track / 2, mainZ, G.mainWheels, false);
    if (G.bodyGear) for (const sx of [1, -1]) bogie(sx * bs.w * .22, mainZ - 2.6, 4, false);
    const noseZ = at(G.nose).z; bogie(0, noseZ, G.noseWheels, true);

    const out = writeGLB(parts);
    const eyeS = at(J.nose * .8), eye = [J.dia * .14, eyeS.cy + eyeS.h * .2, eyeS.z - .4];
    const fix = v => { let { a, b } = v; const flip = v.kind === 'rud' ? b[1] < a[1] : b[0] < a[0]; if (flip) [a, b] = [b, a]; const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d); return { ...v, pivot: a, axis: d.map(x => x / l) }; };
    return { glb: out, S: J.span / 3.24, hub: [0, 0, 0], wheelDrop: -wheelY, groundAtt: 0, eye, jet: true, engines: engPos, surfaces: Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, fix(v)])), tips: { left: [tipOut, tipY, tipZ], right: [-tipOut, tipY, tipZ], tail: [0, stabTop ? finRootY + TL.finH + .3 : at(.995).cy, at(.995).z] }, perf: J.perf, type: { ...J, gear: { type: 'tri' } }, livery: LV, length: J.len };
  }

  // side silhouette for the aircraft picker
  function profileSVG(id, w = 220, h = 90) {
    const J = JETS.find(j => j.id === id); if (J.model) return '';
    const FU = fuselage(J), at = FU.at;
    const finTop = at(1 - J.tailc * .55).cy + J.hgt * .3 + J.tail.finH, bot = -J.hgt / 2 - J.gear.leg - J.gear.r * 2;
    const k = Math.min((w - 12) / J.len, (h - 6) / (finTop - bot)), X = z => w / 2 + (z - (FU.noseZ - J.len / 2)) * k, Y = y => h - 3 - (y - bot) * k;
    const ts = []; for (let t = 0; t <= 1.0001; t += .02) ts.push(Math.min(1, t));
    const top = ts.map(t => { const s = at(t); return [X(s.z), Y(s.cy + s.h / 2)]; }), lo = ts.map(t => { const s = at(t); return [X(s.z), Y(s.cy - s.h / 2)]; }).reverse();
    const path = [...top, ...lo].map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + 'Z';
    const TL = J.tail, tt = at(1 - J.tailc * .55), fy = tt.cy + tt.h * .3, fz = tt.z + TL.finRoot * .55, sw = Math.tan(TL.finSweep * D2R) * TL.finH;
    const fin = `<path d="M${X(fz)} ${Y(fy)}L${X(fz - sw)} ${Y(fy + TL.finH)}L${X(fz - sw - TL.finTip)} ${Y(fy + TL.finH)}L${X(fz - TL.finRoot)} ${Y(fy)}Z"/>`;
    const rs = at(J.wing.at), wy = rs.cy - rs.h * .33, wz = -Math.tan(J.wing.sweep * D2R) * J.span * .2;
    const wing = `<path class="w" d="M${X(0)} ${Y(wy)}L${X(wz)} ${Y(wy + .3)}L${X(wz - J.wing.tip * 1.5)} ${Y(wy + .3)}L${X(-J.wing.root)} ${Y(wy)}Z"/>`;
    const E = J.eng, eng = E.mount === 'wing' ? `<rect class="w" x="${X(E.len * .6 - J.span * .17 * Math.tan(J.wing.sweep * D2R))}" y="${Y(wy - E.dia * .12)}" width="${E.len * k}" height="${E.dia * k}" rx="${E.dia * k * .45}" transform="translate(${-E.len * k} 0)"/>` : (() => { const s = at(E.t); return `<rect class="w" x="${X(s.z + E.len * .55)}" y="${Y(s.cy + s.h * .18 + E.dia / 2)}" width="${E.len * k}" height="${E.dia * k}" rx="${E.dia * k * .45}"/>`; })();
    const wy0 = Y(bot), r = J.gear.r * k, mz = -J.wing.root * .62, nz = at(J.gear.nose).z;
    const wheels = `<circle cx="${X(mz)}" cy="${wy0 - r}" r="${r}"/><circle cx="${X(nz)}" cy="${wy0 - r * .7}" r="${r * .7}"/>`;
    return `<svg viewBox="0 0 ${w} ${h}" class="ac-svg" aria-hidden="true"><g class="b">${wheels}<path d="${path}"/>${fin}</g>${wing}${eng}</svg>`;
  }

  // register with the aircraft library and the flight model
  function install() {
    const P = window.BoploPhysics; if (P && P.DATA) for (const [k, v] of Object.entries(PHYS)) P.DATA[k] = v;
    const A = window.BoploAircraft; if (!A || A.__jets) return !!A;
    for (const j of JETS) if (!A.TYPES.some(t => t.id === j.id)) A.TYPES.push(j);
    const isJet = id => JETS.some(j => j.id === id);
    const oBuild = A.build, oModel = A.model, oProfile = A.profileSVG, oById = A.byId, oMatch = A.match;
    A.build = (id, livery) => isJet(id) ? build(id, livery) : oBuild(id);
    A.model = id => { if (!isJet(id)) return oModel(id); const P = JETS.find(j => j.id === id).perf; return { ...P, vy: P.vr * 1.3, thrust: 0, drag: 0 }; };
    A.profileSVG = (id, w, h) => isJet(id) ? profileSVG(id, w, h) : oProfile(id, w, h);
    A.byId = id => JETS.find(j => j.id === id) || oById(id);
    A.match = text => { const s = String(text || '').toLowerCase().replace(/[\s-]/g, ''); if (/737|b73/.test(s)) return 'narrow2'; if (/a32|a319|a321|narrow/.test(s)) return 'narrow'; if (/a35/.test(s)) return 'wide2'; if (/787|b78|a33|777|b77|767|wide/.test(s)) return 'wide'; if (/747|b74|a38|jumbo/.test(s)) return 'jumbo'; if (/e17|e19|crj|e-jet|regional/.test(s)) return 'rj'; if (/citation|phenom|learjet|bizjet|hondajet|pc24/.test(s)) return 'bizjet'; return oMatch(text); };
    A.LIVERIES = LIVERIES; A.JETS = JETS; A.isJet = isJet; A.__jets = true;
    return true;
  }
  window.BoploJets = { JETS, LIVERIES, PHYS, build, profileSVG, install };
  install();
})();
