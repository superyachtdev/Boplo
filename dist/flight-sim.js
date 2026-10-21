/* Boplo Flight — mini simulator.
   Replays a logged route over real 3D scenery, or lets the student fly it themselves.
   Engine: CesiumJS. Scenery: Google Photorealistic 3D Tiles when a Maps key with the Map Tiles API is configured,
   otherwise Sentinel-2 cloudless imagery (EOX) draped on AWS Terrain Tiles elevation.
   It is a game-like practice toy, not a training device: the flight model is deliberately simple. */
window.BoploSim = (() => {
  'use strict';
  const CES = 'https://cdn.jsdelivr.net/npm/cesium@1.144.0/Build/Cesium/';
  const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  // Sentinel-2 cloudless 2017 by EOX: CC BY 4.0 (later years are non-commercial, so this layer is pinned)
  const IMG = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2017_3857/default/g/{z}/{y}/{x}.jpg';
  const KT = 0.514444, FT = 0.3048, G = 9.81, NM = 1852, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const FOV = 0.6435011087932844; // MapLibre's vertical field of view
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap180 = d => ((d % 360) + 540) % 360 - 180;
  const norm360 = d => ((d % 360) + 360) % 360;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad3 = n => String(Math.round(norm360(n)) % 360).padStart(3, '0');
  const mmss = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const store = { get(k, d) { try { const v = localStorage.getItem('boplo-sim-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('boplo-sim-' + k, JSON.stringify(v)); } catch { } } };

  let cesReady = null;
  function loadCesium() {
    if (window.Cesium?.CesiumWidget) return Promise.resolve(window.Cesium);
    if (cesReady) return cesReady;
    window.CESIUM_BASE_URL = CES;
    cesReady = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = CES + 'Widgets/widgets.css'; document.head.append(css);
      const s = document.createElement('script'); s.src = CES + 'Cesium.js'; s.async = true;
      s.onload = () => window.Cesium ? res(window.Cesium) : rej(new Error('The 3D engine couldn’t load.'));
      s.onerror = () => { cesReady = null; rej(new Error('The 3D engine couldn’t load. Check your connection and try again.')); };
      document.head.append(s);
    });
    return cesReady;
  }
  // free terrain: AWS Terrain Tiles (Terrarium PNGs) fed to Cesium as a heightmap provider
  function terrariumTerrain(C) {
    const N = 65, MAXZ = 14, cache = new Map(), cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const tile = (z, x, y) => {
      const k = z + '/' + x + '/' + y; if (cache.has(k)) return cache.get(k);
      const p = fetch(DEM.replace('{z}', z).replace('{x}', x).replace('{y}', y)).then(r => { if (!r.ok) throw new Error('dem'); return r.blob(); }).then(b => createImageBitmap(b)).then(bmp => {
        ctx.drawImage(bmp, 0, 0); const d = ctx.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
        for (let i = 0; i < 65536; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        return h;
      });
      cache.set(k, p); p.catch(() => cache.delete(k)); if (cache.size > 300) cache.delete(cache.keys().next().value); return p;
    };
    return new C.CustomHeightmapTerrainProvider({ width: N, height: N, tilingScheme: new C.WebMercatorTilingScheme(), credit: 'Terrain: AWS Terrain Tiles', callback: (x, y, level) => {
      let z = level, tx = x, ty = y, sub = 1, ox = 0, oy = 0;
      if (z > MAXZ) { const d = z - MAXZ; sub = 2 ** d; tx = x >> d; ty = y >> d; ox = x - tx * sub; oy = y - ty * sub; z = MAXZ; }
      return tile(z, tx, ty).then(h => {
        const out = new Float32Array(N * N);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const u = clamp((ox + i / (N - 1)) / sub * 256 - .5, 0, 255), v = clamp((oy + j / (N - 1)) / sub * 256 - .5, 0, 255), x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), fx = u - x0, fy = v - y0;
          out[j * N + i] = (h[y0 * 256 + x0] * (1 - fx) + h[y0 * 256 + x1] * fx) * (1 - fy) + (h[y1 * 256 + x0] * (1 - fx) + h[y1 * 256 + x1] * fx) * fy;
        }
        return out;
      }).catch(() => new Float32Array(N * N));
    } });
  }
  function loadCSS() { if (document.querySelector('link[data-simcss]')) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/flight-sim.css?v=3'; l.dataset.simcss = '1'; document.head.append(l); }

  /* ---------------- local frame (metres, x east, z north) ---------------- */
  function frame(lat0, lng0) {
    const kx = Math.cos(lat0 * D2R) * 111320, kz = 111132;
    return { to: (lat, lng) => [(lng - lng0) * kx, (lat - lat0) * kz], ll: (x, z) => [lng0 + x / kx, lat0 + z / kz] };
  }

  /* ---------------- route path ---------------- */
  function simplify(P, tol) {
    if (P.length < 3) return P;
    const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
    const st = [[0, P.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let md = 0, mi = -1;
      const [ax, az] = P[a], [bx, bz] = P[b], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      for (let i = a + 1; i < b; i++) { const d = L < 1 ? Math.hypot(P[i][0] - ax, P[i][1] - az) : Math.abs((P[i][0] - ax) * dz - (P[i][1] - az) * dx) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return P.filter((_, i) => keep[i]);
  }
  function circuitAround([x, z], hdg) {
    // a standard left-hand circuit, about 1.6 km long and 1 km wide, when a flight has no track
    const f = [Math.sin(hdg), Math.cos(hdg)], l = [-f[1], f[0]], at = (a, b) => [x + f[0] * a + l[0] * b, z + f[1] * a + l[1] * b];
    return [at(0, 0), at(1600, 0), at(2300, 300), at(2300, 1000), at(-700, 1000), at(-1200, 500), at(-1100, 0), at(0, 0)];
  }
  function buildPath(P) {
    const S = [0];
    for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const len = S[S.length - 1];
    const at = s => {
      if (s > len && P.length > 1) { const a = P[P.length - 2], b = P[P.length - 1], h = Math.atan2(b[0] - a[0], b[1] - a[1]), e = s - len; return [b[0] + Math.sin(h) * e, b[1] + Math.cos(h) * e, h]; }
      s = clamp(s, 0, len); let lo = 0, hi = S.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
      const t = (s - S[lo]) / ((S[hi] - S[lo]) || 1);
      return [P[lo][0] + (P[hi][0] - P[lo][0]) * t, P[lo][1] + (P[hi][1] - P[lo][1]) * t, Math.atan2(P[hi][0] - P[lo][0], P[hi][1] - P[lo][1])];
    };
    // nearest point on the route, preferring continuity so closed loops (circuits) don't jump from the end back to the start
    let hint = 0, lastS = null;
    const project = (x, z, wide) => {
      let best = { d: Infinity, s: 0, side: 0, i: 0, score: Infinity };
      const a = wide ? 0 : Math.max(0, hint - 6), b = wide ? P.length - 1 : Math.min(P.length - 1, hint + 60);
      for (let i = a; i < b; i++) {
        const [ax, az] = P[i], [bx, bz] = P[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz), sv = S[i] + Math.sqrt(L2) * t;
        const score = d + (wide || lastS == null ? 0 : Math.max(0, Math.abs(sv - lastS) - 400) * 2);
        if (score < best.score - .01) best = { d, s: sv, side: Math.sign(dx * (z - az) - dz * (x - ax)), i, score };
      }
      hint = best.i; if (!wide) lastS = best.s; return best;
    };
    return { P, S, len, at, project, reset: () => { hint = 0; lastS = null; }, seed: v => { lastS = v; hint = 0; for (let i = 0; i < S.length - 1; i++) if (S[i] <= v) hint = i; } };
  }

  /* ---------------- aircraft model: a low-wing trainer, built as a glTF binary in code ----------------
     glTF axes: +Y up, +Z forward, +X to the left wing. Units are metres. */
  function aircraftGLB() {
    const S = 3.3; // model units to metres (10.8 m wingspan)
    const parts = { paint: [], matte: [], glass: [], blades: [], disc: [] };
    const WHITE = [.95, .96, .97, 1], BLUE = [.03, .28, .92, 1], NAVY = [.03, .07, .2, 1], GREY = [.42, .45, .5, 1], DARK = [.07, .075, .085, 1], RUBBER = [.035, .035, .04, 1], GLASS = [.1, .14, .2, 1];
    function mesh(bucket) { const m = { pos: [], col: [], idx: [] }; parts[bucket].push(m); return m; }
    // loft: rings of equal length joined into a smooth surface; closed rings by default
    function loft(bucket, rings, colors, { closed = true, capStart = false, capEnd = false } = {}) {
      const m = mesh(bucket), n = rings[0].length, base = m.pos.length / 3;
      rings.forEach((r, i) => r.forEach(p => { m.pos.push(p[0] * S, p[1] * S, p[2] * S); m.col.push(...(Array.isArray(colors[0]) ? colors[i] : colors)); }));
      const seg = closed ? n : n - 1;
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
        const a = base + i * n + j, b = base + i * n + (j + 1) % n, c = base + (i + 1) * n + (j + 1) % n, d = base + (i + 1) * n + j;
        m.idx.push(a, b, c, a, c, d);
      }
      const cap = (ri, flip) => { const r = rings[ri], cx = r.reduce((s, p) => s + p[0], 0) / n, cy = r.reduce((s, p) => s + p[1], 0) / n, cz = r.reduce((s, p) => s + p[2], 0) / n, k = m.pos.length / 3; m.pos.push(cx * S, cy * S, cz * S); m.col.push(...(Array.isArray(colors[0]) ? colors[ri] : colors)); for (let j = 0; j < n; j++) { const a = base + ri * n + j, b = base + ri * n + (j + 1) % n; flip ? m.idx.push(k, b, a) : m.idx.push(k, a, b); } };
      if (capStart) cap(0, false); if (capEnd) cap(rings.length - 1, true);
      return m;
    }
    const sup = (e, a) => Math.sign(a) * Math.pow(Math.abs(a), 2 / e);
    const ring = (z, cy, w, h, n = 24, e = 2.6, cx = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return [cx + w / 2 * sup(e, Math.cos(a)), cy + h / 2 * sup(e, Math.sin(a)), z]; });
    // aerofoil section (NACA 4-digit style), chord runs backwards from the leading edge
    const foil = (t, camber = .02, n = 10) => { const up = [], lo = []; for (let i = 0; i <= n; i++) { const s = (1 - Math.cos(i / n * Math.PI)) / 2, yt = 5 * t * (.2969 * Math.sqrt(s) - .126 * s - .3516 * s * s + .2843 * s ** 3 - .1036 * s ** 4), yc = camber * (s < .4 ? (2 * .4 * s - s * s) / .16 : (1 - .8 + 2 * .4 * s - s * s) / .36); up.push([s, yc + yt]); lo.push([s, yc - yt]); } return [...up.reverse(), ...lo.slice(1, -1)]; };
    const wingSec = (fp, span, zLE, chord, y, twist = 0) => fp.map(([s, v]) => [span, y + v * chord, zLE - s * chord]);
    const finSec = (fp, h, zLE, chord) => fp.map(([s, v]) => [v * chord, h, zLE - s * chord]);

    // fuselage: [z, centre y, width, height]
    const F = [[1.07, .0, .16, .15], [1.04, .01, .24, .23], [.95, .02, .3, .3], [.75, .04, .34, .36], [.5, .06, .36, .4], [.25, .08, .36, .42], [0, .08, .34, .4], [-.3, .07, .28, .32], [-.65, .07, .21, .24], [-1, .08, .15, .17], [-1.3, .1, .1, .12], [-1.52, .12, .05, .07], [-1.58, .125, .02, .03]];
    loft('paint', F.map(f => ring(...f)), WHITE, { capEnd: true });
    // cheatline and belly stripe: thin bands just outside the skin on both sides
    for (const side of [1, -1]) {
      const band = F.slice(2, 11).map(([z, cy, w, h]) => { const r = [], k = 1.012; for (let i = -2; i <= 2; i++) { const a = (side > 0 ? 0 : Math.PI) + i * .055; r.push([w / 2 * k * sup(2.6, Math.cos(a)), cy - .02 + h / 2 * k * sup(2.6, Math.sin(a)), z]); } return r; });
      loft('paint', band, BLUE, { closed: false });
      const thin = F.slice(2, 11).map(([z, cy, w, h]) => { const r = [], k = 1.014; for (let i = -1; i <= 1; i++) { const a = (side > 0 ? 0 : Math.PI) + .15 + i * .018 * side; r.push([w / 2 * k * sup(2.6, Math.cos(a)), cy - .02 + h / 2 * k * sup(2.6, Math.sin(a)), z]); } return r; });
      loft('paint', thin, NAVY, { closed: false });
    }
    // canopy: a glasshouse sitting on the cabin
    loft('glass', [[.66, .21, .2, .04], [.5, .24, .3, .16], [.3, .27, .33, .2], [.05, .27, .33, .19], [-.15, .25, .28, .12], [-.3, .22, .2, .04]].map(f => ring(...f, 24, 2.2)), GLASS, { capStart: true, capEnd: true });
    // spinner and cowling lip
    loft('paint', [[1.06, .02, .15, .15], [1.12, .02, .13, .13], [1.18, .02, .09, .09], [1.22, .02, .045, .045], [1.245, .02, .008, .008]].map(f => ring(...f, 16, 2)), BLUE, { capEnd: true });
    loft('matte', [[1.072, -.04, .1, .035], [1.06, -.04, .1, .035]].map(f => ring(...f, 12, 3)), DARK, { capStart: true });
    // wings: rectangular inner panel, tapered outer panel, 7° dihedral, blue tips
    const wf = foil(.15, .02), dih = Math.tan(7 * Math.PI / 180);
    for (const side of [1, -1]) {
      const secs = [[.12, .52, .62], [.5, .52, .62], [1, .5, .58], [1.42, .46, .5], [1.58, .44, .46], [1.62, .42, .4]];
      const rings = secs.map(([x, zLE, c]) => wingSec(wf, side * x, zLE, c, -.13 + (x - .12) * dih));
      loft('paint', side > 0 ? rings : rings.map(r => r.slice().reverse()), secs.map(([x]) => x > 1.4 ? BLUE : WHITE), { capEnd: true });
      // flap and aileron hinge lines (thin dark strips on top)
      loft('matte', [[.2, .66], [.95, .66], [1, .64], [1.5, .64]].map(([x, s]) => [[side * x, -.13 + (x - .12) * dih + .045, .52 - s * .62 + .008], [side * x, -.13 + (x - .12) * dih + .048, .52 - s * .62 - .008]]), GREY, { closed: false });
    }
    // stabilator and fin
    const tf = foil(.1, 0);
    for (const side of [1, -1]) { const r = [[.03, -1.2, .34], [.62, -1.24, .26], [.66, -1.25, .22]].map(([x, zLE, c]) => wingSec(tf, side * x, zLE, c, .12)); loft('paint', side > 0 ? r : r.map(q => q.slice().reverse()), WHITE, { capEnd: true }); }
    const fin = [[.12, -.92, .62], [.3, -1.1, .48], [.5, -1.27, .36], [.62, -1.36, .28], [.66, -1.4, .24]].map(([h, zLE, c]) => finSec(tf, h, zLE, c));
    loft('paint', fin, [WHITE, WHITE, BLUE, BLUE, BLUE], { capEnd: true });
    // landing gear: legs, wheel fairings, tyres
    for (const [x, z] of [[.44, .08], [-.44, .08], [0, .86]]) {
      loft('matte', [ring(z, -.13, .026, .026, 8, 2), ring(z, -.43, .026, .026, 8, 2)].map(r => r.map(([px, py, pz]) => [px + x, py, pz])), GREY);
      loft('paint', [[z + .17, -.47, .02, .02], [z + .12, -.47, .09, .12], [z, -.475, .11, .15], [z - .1, -.47, .1, .13], [z - .18, -.46, .03, .04]].map(f => ring(...f, 16, 2.2, x)), WHITE, { capStart: true, capEnd: true });
      const tyre = []; for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI * 2; tyre.push([x + .035, -.475 + Math.sin(a) * .075, z + Math.cos(a) * .075]); }
      loft('matte', [tyre, tyre.map(p => [p[0] - .07, p[1], p[2]])], RUBBER, { closed: false });
    }
    // propeller: two blades (spun by the simulator) and a translucent disc for when it's turning fast
    for (const sgn of [1, -1]) { const b = []; for (const [r, c, tw] of [[.03, .05, .35], [.12, .055, .28], [.22, .045, .18], [.3, .03, .1]]) { b.push([[sgn * r, -c / 2, Math.sin(tw * sgn) * c / 2], [sgn * r, c / 2, -Math.sin(tw * sgn) * c / 2], [sgn * r, c / 2, -Math.sin(tw * sgn) * c / 2 - .008], [sgn * r, -c / 2, Math.sin(tw * sgn) * c / 2 - .008]]); } loft('blades', b, DARK, { capEnd: true }); }
    { const r = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; r.push([Math.cos(a) * .31, Math.sin(a) * .31, 0]); } const m = mesh('disc'); r.forEach(p => { m.pos.push(p[0] * S, p[1] * S, 0); m.col.push(.3, .32, .36, 1); }); m.pos.push(0, 0, 0); m.col.push(.3, .32, .36, 1); for (let i = 0; i < 40; i++) m.idx.push(40, i, (i + 1) % 40); }

    // merge each bucket and compute smooth normals
    const merge = list => { const pos = [], col = [], idx = []; for (const m of list) { const o = pos.length / 3; pos.push(...m.pos); col.push(...m.col); m.idx.forEach(i => idx.push(i + o)); } const nor = new Float32Array(pos.length); for (let i = 0; i < idx.length; i += 3) { const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3]; const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; for (const k of [a, b, c]) { nor[k] += n[0]; nor[k + 1] += n[1]; nor[k + 2] += n[2]; } } for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; } return { pos: new Float32Array(pos), nor, col: new Float32Array(col), idx: new Uint32Array(idx) }; };
    const prims = [
      ['paint', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: .05, roughnessFactor: .32 }, doubleSided: true }],
      ['matte', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: .2, roughnessFactor: .7 }, doubleSided: true }],
      ['glass', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: .85, roughnessFactor: .06 }, doubleSided: true }],
      ['blades', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: .3, roughnessFactor: .5 }, doubleSided: true }],
      ['disc', { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, .14], metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'BLEND', doubleSided: true }]
    ].map(([k, mat]) => ({ name: k, geo: merge(parts[k]), mat }));

    // write the GLB
    const chunks = [], views = [], accessors = []; let off = 0;
    const addView = (arr, target) => { const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - bytes.length % 4) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, target }); chunks.push(bytes); if (pad) chunks.push(new Uint8Array(pad)); off += bytes.length + pad; return views.length - 1; };
    const meshes = prims.map(p => {
      const { pos, nor, col, idx } = p.geo, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
      const acc = (view, type, comp, count, extra = {}) => { accessors.push({ bufferView: view, componentType: comp, count, type, ...extra }); return accessors.length - 1; };
      const aP = acc(addView(pos, 34962), 'VEC3', 5126, pos.length / 3, { min, max }), aN = acc(addView(nor, 34962), 'VEC3', 5126, nor.length / 3), aC = acc(addView(col, 34962), 'VEC4', 5126, col.length / 4), aI = acc(addView(idx, 34963), 'SCALAR', 5125, idx.length);
      return { name: p.name, primitives: [{ attributes: { POSITION: aP, NORMAL: aN, COLOR_0: aC }, indices: aI, material: prims.indexOf(p) }] };
    });
    const hub = [0, .02 * S, 1.13 * S];
    const json = { asset: { version: '2.0', generator: 'Boplo Flight' }, scene: 0, scenes: [{ nodes: [0, 1, 2, 3, 4] }],
      nodes: [{ mesh: 0, name: 'paint' }, { mesh: 1, name: 'matte' }, { mesh: 2, name: 'glass' }, { mesh: 3, name: 'blades', translation: hub }, { mesh: 4, name: 'disc', translation: hub }],
      meshes, materials: prims.map(p => ({ name: p.name, ...p.mat })), accessors, bufferViews: views, buffers: [{ byteLength: off }] };
    let jsonBytes = new TextEncoder().encode(JSON.stringify(json)); const jpad = (4 - jsonBytes.length % 4) % 4;
    if (jpad) { const t = new Uint8Array(jsonBytes.length + jpad); t.set(jsonBytes); t.fill(32, jsonBytes.length); jsonBytes = t; }
    const total = 12 + 8 + jsonBytes.length + 8 + off, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jsonBytes, 20);
    let p = 20 + jsonBytes.length; dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004E4942, true); p += 8;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return { glb: out, S, hub, wheelDrop: .55 * S, tips: { left: [1.63 * S, .055 * S, .2 * S], right: [-1.63 * S, .055 * S, .2 * S], tail: [0, .66 * S, -1.55 * S] } };
  }

  /* ---------------- audio ---------------- */
  function engineAudio() {
    let ac, out, eng, eng2, lp, wind, wg, horn, hg, on = false;
    return {
      start() {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)(); out = ac.createGain(); out.gain.value = store.get('mute', false) ? 0 : .16; out.connect(ac.destination);
          lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = .7;
          const eg = ac.createGain(); eg.gain.value = .55; lp.connect(eg); eg.connect(out);
          eng = ac.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 40; eng.connect(lp); eng.start();
          eng2 = ac.createOscillator(); eng2.type = 'square'; eng2.frequency.value = 81; const g2 = ac.createGain(); g2.gain.value = .25; eng2.connect(g2); g2.connect(lp); eng2.start();
          const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          wind = ac.createBufferSource(); wind.buffer = buf; wind.loop = true; const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = .5; wg = ac.createGain(); wg.gain.value = 0; wind.connect(bp); bp.connect(wg); wg.connect(out); wind.start();
          horn = ac.createOscillator(); horn.type = 'triangle'; horn.frequency.value = 1550; hg = ac.createGain(); hg.gain.value = 0; horn.connect(hg); hg.connect(out); horn.start();
          on = true;
        } catch { on = false; }
      },
      update(thr, kt, stall, running) {
        if (!on) return; const t = ac.currentTime, rpm = running ? .35 + thr * .65 : 0;
        eng.frequency.setTargetAtTime(28 + rpm * 62, t, .15); eng2.frequency.setTargetAtTime((28 + rpm * 62) * 2.02, t, .15);
        lp.frequency.setTargetAtTime(300 + rpm * 700, t, .2);
        wg.gain.setTargetAtTime(clamp(kt / 130, 0, 1) * .5, t, .3);
        hg.gain.setTargetAtTime(stall ? .18 : 0, t, .03);
      },
      mute(m) { if (on) out.gain.setTargetAtTime(m ? 0 : .16, ac.currentTime, .05); },
      pause(p) { if (on) (p ? ac.suspend() : ac.resume()).catch(() => { }); },
      stop() { if (on) { try { ac.close(); } catch { } } on = false; }
    };
  }

  /* ---------------- HUD markup ---------------- */
  function hudHTML(o) {
    const ticks = []; for (let d = -180; d <= 540; d += 5) { const x = (d + 180) * 4, big = d % 30 === 0, lab = big ? ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[norm360(d)] || String(norm360(d) / 10).padStart(2, '0')) : ''; ticks.push(`<line x1="${x}" x2="${x}" y1="${big ? 0 : 5}" y2="${big ? 12 : 10}"/>${lab ? `<text x="${x}" y="26">${lab}</text>` : ''}`); }
    const ladder = []; for (let p = -30; p <= 30; p += 5) if (p) ladder.push(`<line x1="${p % 10 ? -8 : -15}" x2="${p % 10 ? 8 : 15}" y1="${-p * 2.2}" y2="${-p * 2.2}"/>${p % 10 ? '' : `<text x="20" y="${-p * 2.2 + 3}">${Math.abs(p)}</text>`}`);
    return `<div class="sim-map" data-map></div><div class="sim-credits" data-credits></div><div class="sim-vig" aria-hidden="true"></div>
      <header class="sim-top">
        <div class="sim-chip sim-route"><b>${esc(o.title)}</b><small data-sub>${esc(o.subtitle || '')}</small></div>
        <div class="sim-chip sim-next" data-nextbox><span data-nextl>Next</span><b data-wp>—</b><small data-wpd></small></div>
        <div class="sim-btns">
          <button type="button" class="sim-b" data-cam aria-label="Change camera" title="Camera (C)"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span data-caml>Chase</span></button>
          <button type="button" class="sim-b" data-ap aria-pressed="false" title="Autopilot (P)"><span>AP</span></button>
          <button type="button" class="sim-b" data-gates aria-pressed="false" title="Route gates (G)"><svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="12" rx="1.5"/><rect x="9" y="9.5" width="6" height="5" rx="1"/></svg></button>
          <button type="button" class="sim-b" data-mute aria-label="Sound" title="Sound (M)"><svg viewBox="0 0 24 24"><path d="M4 9.5h4L13 5v14l-5-4.5H4z"/><path data-wave d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg></button>
          <button type="button" class="sim-b" data-pause aria-label="Pause" title="Pause (Space)"><svg viewBox="0 0 24 24"><path data-pp d="M8 5v14M16 5v14"/></svg></button>
          <button type="button" class="sim-b sim-x" data-exit aria-label="Leave the simulator" title="Leave (Esc)"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div>
      </header>
      <div class="sim-warn" data-warn role="status" aria-live="assertive"></div>
      <div class="sim-panel" data-panel>
        <div class="sim-g"><span>Airspeed</span><b data-ias>0</b><small>kt</small></div>
        <div class="sim-adi" aria-hidden="true"><svg viewBox="-50 -50 100 100"><defs><clipPath id="adiclip"><circle r="46"/></clipPath></defs>
          <g clip-path="url(#adiclip)"><g data-hor><rect x="-120" y="-240" width="240" height="240" fill="#2F7BFF"/><rect x="-120" y="0" width="240" height="240" fill="#0A1A44"/><line x1="-120" x2="120" y1="0" y2="0" stroke="#fff" stroke-width="1.2"/><g class="ladder">${ladder.join('')}</g></g></g>
          <circle r="46" fill="none" stroke="rgba(158,216,255,.35)" stroke-width="1.5"/><g data-bankptr><path d="M0 -44 l-3.5 6h7z" fill="#9ED8FF"/></g>
          <path d="M-30 1h12l4 5 4-5h0M30 1h-12l-4 5-4-5" stroke="#FFD24A" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/><circle r="2" fill="#FFD24A"/></svg></div>
        <div class="sim-g"><span>Altitude</span><b data-alt>0</b><small data-vs>0 fpm</small></div>
        <div class="sim-hdg"><svg viewBox="0 0 240 30" preserveAspectRatio="none" class="sim-tape"><g data-tape>${ticks.join('')}</g></svg><b data-hdg>000°</b><i data-bugi></i></div>
        <div class="sim-cdi" data-cdi><div class="sim-cdi-scale"><i></i><i></i><i></i><i></i><i class="c"></i><i></i><i></i><i></i><i></i><span data-needle></span></div><small data-xte>On track</small></div>
        <div class="sim-thr" title="Throttle"><span>Power</span><div><i data-thr></i></div><small data-flaps>Flaps up</small></div>
      </div>
      <div class="sim-replay" data-replaybar hidden>
        <button type="button" class="sim-b" data-play aria-label="Play or pause"><svg viewBox="0 0 24 24"><path data-pp2 d="M8 5v14M16 5v14"/></svg></button>
        <div class="sim-speeds" role="group" aria-label="Replay speed">${[1, 2, 4, 8, 16, 32].map(x => `<button type="button" data-rate="${x}">${x}×</button>`).join('')}</div>
        <input type="range" min="0" max="1000" value="0" data-scrub aria-label="Position along the route">
        <span class="sim-time" data-time>0:00</span>
      </div>
      <div class="sim-touch" data-touch hidden>
        <div class="sim-stick" data-stick><i data-knob></i><span>Pull back to climb</span></div>
        <div class="sim-tilt"><button type="button" class="sim-b" data-tilt>Tilt to steer</button><button type="button" class="sim-b" data-flapb>Flaps</button></div>
        <div class="sim-thrslider"><span>Power</span><input type="range" min="0" max="100" value="70" data-thrrange aria-label="Throttle" orient="vertical"></div>
      </div>
      <div class="sim-card-wrap" data-cardwrap><div class="sim-card" data-card><div class="sim-load"><div class="sim-spin"></div><b>Loading terrain…</b><small>Real elevation data for your route.</small></div></div></div>`;
  }

  /* ================= open ================= */
  async function open(opts) {
    loadCSS();
    const old = document.getElementById('sim');
    if (old) { if (old.open) old.close(); old.removeAttribute('id'); setTimeout(() => old.remove(), 0); }
    const dlg = document.createElement('dialog'); dlg.id = 'sim'; dlg.setAttribute('aria-label', 'Flight simulator'); document.body.append(dlg);
    const O = Object.assign({ mode: 'replay', start: 'ground', title: 'Route', subtitle: '', points: [], wind: null, cruiseFt: 0, kind: 'track' }, opts);
    dlg.innerHTML = `<div class="sim">${hudHTML(O)}</div>`;
    dlg.showModal();
    const root = dlg.querySelector('.sim'), $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    let alive = true, raf = 0, viewer = null;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const audio = engineAudio();
    const cleanups = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };
    function destroy() {
      if (!alive) return; alive = false; cancelAnimationFrame(raf); cleanups.forEach(f => f()); audio.stop();
      try { viewer?.destroy(); } catch { } if (dlg.open) dlg.close(); dlg.remove(); O.onClose && O.onClose();
    }
    on(dlg, 'cancel', e => { e.preventDefault(); destroy(); });
    on(dlg, 'close', () => { if (alive) destroy(); });
    $('[data-exit]').onclick = destroy;
    const card = (html, wrapCls = '') => { const w = $('[data-cardwrap]'); w.className = 'sim-card-wrap ' + wrapCls; w.hidden = !html; if (html) $('[data-card]').innerHTML = html; };
    const fail = msg => card(`<h2>The simulator couldn’t start</h2><p>${esc(msg)}</p><div class="sim-actions"><button type="button" class="sim-btn" data-x>Close</button></div>`), wireX = () => { const x = $('[data-x]'); if (x) x.onclick = destroy; };

    /* ---- route geometry ---- */
    const raw = (O.points || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!raw.length) { fail('This flight has no route to fly. Plot it on the map first.'); wireX(); return { close: destroy }; }
    const F = frame(raw[0].lat, raw[0].lng);
    let P = raw.map(p => F.to(p.lat, p.lng));
    P = P.filter((p, i) => !i || Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) > 12);
    if (P.length > 2) P = simplify(P, 35);
    let synthetic = false;
    const span = P.reduce((m, p) => Math.max(m, Math.hypot(p[0], p[1])), 0);
    if (P.length < 2 || span < 400) { P = circuitAround(P[0], (O.runwayHdg || 0) * D2R); synthetic = true; }
    // circuits and local tracks: start along the first stretch of the route
    const path = buildPath(P);
    const circuit = span < 6000 || synthetic;
    const L = path.len;

    /* ---- 3D scenery (CesiumJS) ---- */
    let C;
    try { C = await loadCesium(); } catch (e) { fail(e.message); wireX(); return { close: destroy }; }
    if (!alive) return { close: destroy };
    const startLL = F.ll(P[0][0], P[0][1]);
    try {
      viewer = new C.CesiumWidget($('[data-map]'), {
        baseLayer: false, skyAtmosphere: new C.SkyAtmosphere(), shadows: !coarse, useDefaultRenderLoop: false,
        useBrowserRecommendedResolution: true, msaaSamples: coarse ? 1 : 4, creditContainer: $('[data-credits]'), requestRenderMode: false
      });
    } catch (e) { fail('Your browser couldn’t start 3D graphics (WebGL). Try an up-to-date Chrome, Edge or Safari.'); wireX(); return { close: destroy }; }
    const scene = viewer.scene, camera = scene.camera;
    scene.screenSpaceCameraController.enableInputs = false;
    scene.postProcessStages.fxaa.enabled = true;
    scene.fog.enabled = true; scene.fog.density = 1.6e-4; scene.fog.minimumBrightness = .25;
    camera.frustum.fov = C.Math.toRadians(66); camera.frustum.near = .5;
    // a fixed mid-morning sun at the departure airfield, for good shadows and colour
    { const d = new Date(); d.setUTCHours(0, 0, 0, 0); viewer.clock.currentTime = C.JulianDate.fromDate(new Date(d.getTime() + (10.6 - startLL[0] / 15) * 3600e3)); viewer.clock.shouldAnimate = false; }
    if (scene.shadowMap) { scene.shadowMap.size = 2048; scene.shadowMap.maximumDistance = 350; scene.shadowMap.softShadows = true; scene.shadowMap.darkness = .4; }
    // keep the scene rendering while things load
    let pumping = true; (function pump() { if (!alive || !pumping) return; try { viewer.resize(); viewer.render(); } catch { } requestAnimationFrame(pump); })();
    const LLH = (x, z, h) => { const [lng, lat] = F.ll(x, z); return C.Cartesian3.fromDegrees(lng, lat, h); };
    const carto = (x, z) => { const [lng, lat] = F.ll(x, z); return C.Cartographic.fromDegrees(lng, lat); };
    // look at the departure while scenery loads
    camera.setView({ destination: LLH(P[0][0] - Math.sin(path.at(80)[2]) * 400, P[0][1] - Math.cos(path.at(80)[2]) * 400, (O.fromElevFt || 0) * FT + 250), orientation: { heading: path.at(80)[2], pitch: C.Math.toRadians(-22), roll: 0 } });

    let tileset = null, scenery = 'globe';
    if (O.googleKey) {
      try {
        tileset = await C.createGooglePhotorealistic3DTileset({ key: O.googleKey, onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: coarse ? 22 : 14, dynamicScreenSpaceError: true, dynamicScreenSpaceErrorFactor: 18, foveatedScreenSpaceError: true, cacheBytes: 640 * 1024 * 1024, skipLevelOfDetail: true, shadows: C.ShadowMode.RECEIVE_ONLY });
        scene.primitives.add(tileset); scene.globe.show = false; scenery = 'google';
      } catch (e) { tileset = null; console.warn('Google 3D tiles unavailable', e); }
    }
    if (!tileset) {
      scene.terrainProvider = terrariumTerrain(C);
      scene.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: IMG, tilingScheme: new C.WebMercatorTilingScheme(), maximumLevel: 14, credit: new C.Credit('Imagery: Sentinel-2 cloudless 2017 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2017), CC BY 4.0 · Terrain: AWS Terrain Tiles') }));
      const g = scene.globe; g.depthTestAgainstTerrain = true; g.showGroundAtmosphere = true; g.maximumScreenSpaceError = coarse ? 3 : 2; g.tileCacheSize = 400; g.preloadSiblings = true; g.enableLighting = false;
    }
    root.classList.toggle('is-google', scenery === 'google');

    // aircraft
    const AC = aircraftGLB(), glbUrl = URL.createObjectURL(new Blob([AC.glb], { type: 'model/gltf-binary' }));
    cleanups.push(() => URL.revokeObjectURL(glbUrl));
    let model = null, bladeNode = null, discNode = null;
    try {
      model = await C.Model.fromGltfAsync({ url: glbUrl, shadows: coarse ? C.ShadowMode.DISABLED : C.ShadowMode.CAST_ONLY, forwardAxis: C.Axis.Z, upAxis: C.Axis.Y, imageBasedLighting: undefined });
      scene.primitives.add(model);
      model.readyEvent.addEventListener(() => { bladeNode = model.getNode('blades'); discNode = model.getNode('disc'); });
    } catch (e) { console.warn('aircraft model', e); }
    const lights = scene.primitives.add(new C.PointPrimitiveCollection());
    const navL = lights.add({ color: C.Color.fromCssColorString('#ff3344'), pixelSize: 5 }), navR = lights.add({ color: C.Color.fromCssColorString('#33ff77'), pixelSize: 5 }), strobe = lights.add({ color: C.Color.WHITE, pixelSize: 9, show: false });
    const lines = scene.primitives.add(new C.PolylineCollection());
    const flownLine = lines.add({ positions: [], width: 2.5, material: C.Material.fromType('Color', { color: new C.Color(1, .82, .29, .65) }) });
    const gatePool = Array.from({ length: 20 }, () => lines.add({ positions: [], width: 3, show: false, material: C.Material.fromType('Color', { color: new C.Color(1, 1, 1, .5) }) }));
    // dashed route line draped on the ground or the 3D city
    let routeGround = null;
    try {
      routeGround = scene.groundPrimitives.add(new C.GroundPolylinePrimitive({ geometryInstances: new C.GeometryInstance({ geometry: new C.GroundPolylineGeometry({ positions: P.map(p => LLH(p[0], p[1], 0)), width: 3.5 }) }), appearance: new C.PolylineMaterialAppearance({ material: C.Material.fromType('PolylineDash', { color: new C.Color(1, 1, 1, .7), gapColor: C.Color.TRANSPARENT, dashLength: 22 }) }), asynchronous: true }));
    } catch { }
    const labels = scene.primitives.add(new C.LabelCollection());
    const exclude = [model, lights, lines, labels, routeGround].filter(Boolean);

    // ground height under a point: rendered 3D tiles, or the terrain globe
    const gcache = new Map();
    const rawGround = (x, z) => { try { const c = carto(x, z); const h = tileset ? scene.sampleHeight(c, exclude, .6) : scene.globe.getHeight(c); return Number.isFinite(h) ? h : null; } catch { return null; } };
    const elevAt = (x, z, fresh) => { const k = Math.round(x / 20) + ',' + Math.round(z / 20), now = performance.now(), c = gcache.get(k); if (c && !fresh && now - c.t < 1500 && c.e != null) return c.e; const e = rawGround(x, z); gcache.set(k, { e, t: now }); if (gcache.size > 600) gcache.delete(gcache.keys().next().value); return e ?? c?.e ?? null; };
    // wait for the scenery at the start, then read the ground height there (most detailed)
    const mostDetailed = async pts => {
      try {
        if (tileset) { const r = await Promise.race([scene.sampleHeightMostDetailed(pts.map(p => carto(...p)), exclude), new Promise(res => setTimeout(() => res(null), 15000))]); return r ? r.map(c => Number.isFinite(c?.height) ? c.height : null) : pts.map(() => null); }
        const r = await Promise.race([C.sampleTerrain(scene.terrainProvider, 13, pts.map(p => carto(...p))), new Promise(res => setTimeout(() => res(null), 12000))]);
        return r ? r.map(c => Number.isFinite(c?.height) ? c.height : null) : pts.map(() => null);
      } catch { return pts.map(() => null); }
    };
    const last = P[P.length - 1], sameEnd = Math.hypot(last[0] - P[0][0], last[1] - P[0][1]) < 1500;
    const [h0, h1] = await mostDetailed(sameEnd ? [P[0], P[0]] : [P[0], last]);
    if (!alive) return { close: destroy };
    // Google tiles use heights above the ellipsoid; the airfield's published elevation tells us the local geoid offset
    let geoN = 0;
    if (tileset && h0 != null && O.fromElevFt != null) { const n = h0 - O.fromElevFt * FT; if (Math.abs(n) < 110) geoN = n; }
    const g0 = h0 ?? ((O.fromElevFt || 0) * FT + geoN);
    const g1 = sameEnd ? g0 : (h1 ?? (O.toElevFt != null ? O.toElevFt * FT + geoN : g0));
    // labels: route waypoints and nearby airfields
    const labelStyle = { font: '600 15px Archivo, system-ui, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.fromCssColorString('#06102A'), outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, scaleByDistance: new C.NearFarScalar(1500, 1, 40000, .55), translucencyByDistance: new C.NearFarScalar(30000, 1, 60000, 0) };
    if (O.country && window.BoploMap?.airfields) BoploMap.airfields(O.country).then(list => {
      if (!alive) return;
      list.filter(a => a.type !== 'S' && a.type !== 'H' && Number.isFinite(a.elev)).map(a => ({ a, xz: F.to(a.lat, a.lng) })).filter(o => Math.hypot(...o.xz) < Math.max(70000, L + 40000)).slice(0, 220)
        .forEach(({ a, xz }) => labels.add({ ...labelStyle, text: a.code, position: LLH(xz[0], xz[1], a.elev * FT + geoN + 45), fillColor: C.Color.fromCssColorString('#CFE8FF'), font: '600 13px Archivo, system-ui, sans-serif' }));
    });

    function placeAircraft() {
      if (!model) return;
      const pos = LLH(st.x, st.z, st.alt + AC.wheelDrop);
      const hpr = new C.HeadingPitchRoll(C.Math.toRadians(st.hdg - 90), C.Math.toRadians(st.att ?? st.pitch), C.Math.toRadians(st.bank));
      C.Transforms.headingPitchRollToFixedFrame(pos, hpr, C.Ellipsoid.WGS84, undefined, model.modelMatrix);
      model.show = !st.crashed;
      // nav lights: model frame after axis conversion is x forward, y left, z up
      const at = ([gx, gy, gz]) => C.Matrix4.multiplyByPoint(model.modelMatrix, new C.Cartesian3(gz, gx, gy), new C.Cartesian3());
      navL.position = at(AC.tips.left); navR.position = at(AC.tips.right); strobe.position = at(AC.tips.tail); strobe.show = (st.t % 1.3) < .06;
      // propeller: spin the blades, fade in the disc at high rpm
      const rpm = st.thr > .02 || st.v > 3 ? 600 + st.thr * 1900 : 0;
      propA = (propA + rpm / 60 * 2 * Math.PI * realDt * (rpm > 1200 ? .07 : 1)) % (Math.PI * 2);
      if (bladeNode) bladeNode.matrix = C.Matrix4.multiply(C.Matrix4.fromTranslation(new C.Cartesian3(...AC.hub)), C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationZ(propA)), new C.Matrix4());
      if (discNode) discNode.show = rpm > 1200;
    }
    let propA = 0, realDt = .016, gateT = 0;
    function updateGates() {
      const W = circuit ? 70 : 110, Hh = circuit ? 40 : 60, pr = path.project(st.x, st.z), near = showGates && camI !== 2 ? gates.filter(g => g.s > pr.s + 15).slice(0, 5) : [];
      gatePool.forEach(p => p.show = false);
      near.forEach((g, i) => {
        const d = Math.hypot(g.x - st.x, g.z - st.z), a = (i === 0 ? .85 : .45) * clamp(1 - d / (circuit ? 2400 : 6000), 0, 1) * clamp(d / 50, 0, 1);
        if (a < .03) return;
        const r = [Math.cos(g.h), -Math.sin(g.h)], pt = (u, v) => LLH(g.x + r[0] * u, g.z + r[1] * u, g.y + v);
        const c = W * .22, k = Hh * .3, col = i === 0 ? new C.Color(1, .84, .3, a) : new C.Color(1, 1, 1, a);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy], j) => {
          const p = gatePool[i * 4 + j]; if (!p) return;
          p.positions = [pt(sx * W / 2 - sx * c, sy * Hh / 2), pt(sx * W / 2, sy * Hh / 2), pt(sx * W / 2, sy * Hh / 2 - sy * k)];
          p.material.uniforms.color = col; p.show = true;
        });
      });
    }
    function frameDraw(dt) {
      realDt = dt;
      const w = root.clientWidth, h = root.clientHeight, as = w / Math.max(h, 1), fov = camera.frustum.fov;
      const hfov = as >= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) * as);
      const [, kB, kH, depBase] = CAMS[camI];
      const B0 = clamp(5.6 * AC.S / 3.4 / Math.tan((as < 1 ? .34 : .24) * hfov), 16, 70), B = B0 * kB, Hc = (B0 * .2 + 1.5) * kH;
      camH += wrap180(st.hdg - camH) * Math.min(1, dt * (camI === 2 ? 1.2 : 2.6));
      camPitchLag += ((st.att ?? st.pitch) - camPitchLag) * Math.min(1, dt * 3);
      camD += (depBase - camD) * Math.min(1, dt * 3);
      const dep = clamp(camD - camPitchLag * .55 + (st.ground ? 2 : 0), 2, 60);
      const ch = camH * D2R, f = [Math.sin(ch), Math.cos(ch)], ex = -f[0] * B, ez = -f[1] * B;
      let ey = Hc + AC.wheelDrop;
      const gEye = elevAt(st.x + ex, st.z + ez); if (gEye != null) ey = Math.max(ey, gEye - st.alt + 3);
      camera.setView({ destination: LLH(st.x + ex, st.z + ez, st.alt + ey), orientation: { heading: ch, pitch: C.Math.toRadians(-dep), roll: 0 } });
      placeAircraft();
      gateT += dt; if (gateT > .2) { gateT = 0; updateGates(); }
      viewer.resize(); viewer.render();
    }
    const flownPts = [];
    const cruise = O.cruiseFt ? O.cruiseFt * FT + geoN : (circuit ? g0 + 1000 * FT : Math.max(g0, g1) + 2200 * FT);
    const ROLL = circuit ? 420 : 500, LROLL = 380, TDZ = Math.min(circuit ? 520 : 650, L * .12), CG = circuit ? 0.09 : 500 * FT / NM, DG = circuit ? 0.06 : 330 * FT / NM;
    const groundStart = O.start !== 'air', landEnd = O.land !== false;
    const prof = s => { const up = groundStart ? g0 + Math.max(0, s - ROLL) * CG : cruise, dn = landEnd ? g1 + Math.max(0, L - TDZ - s) * DG : cruise; return Math.min(cruise, up, dn); };

    // route gates every few hundred metres where the route is airborne
    const gates = [];
    for (let s = circuit ? 250 : 400; s < L - 60; s += circuit ? 200 : 450) { const a = prof(s); if (a - Math.min(g0, g1) > 25) { const [x, z, h] = path.at(s); gates.push({ x, z, y: a, h, s }); } }

    /* ---- aircraft state ---- */
    let flapT = 0, flareNow = false;
    const st = { flaps: 0, x: 0, z: 0, alt: 0, hdg: 0, pitch: 0, bank: 0, v: 0, thr: 0, ground: true, crashed: false, landed: false, vs: 0, trk: 0, gs: 0, stall: false, t: 0, agl: 0, gnd: g0 };
    const wind = O.wind && O.wind.spd ? { x: -Math.sin(O.wind.dir * D2R) * O.wind.spd * KT, z: -Math.cos(O.wind.dir * D2R) * O.wind.spd * KT, dir: O.wind.dir, spd: O.wind.spd } : { x: 0, z: 0, spd: 0 };
    function place(s, airborne) {
      const [x, z, h] = path.at(s); st.x = x; st.z = z; st.hdg = h * R2D; st.trk = st.hdg; st.bank = 0; st.crashed = st.landed = false;
      st.airT = airborne ? 10 : 0; st.flaps = 0; flapT = 0; st.landedOnce = false; st.touch = null;
      if (airborne) { st.ground = false; st.alt = Math.max(prof(s), (elevAt(x, z) ?? g0) + 150); st.v = (circuit ? 85 : 95) * KT; st.thr = .72; st.pitch = 0; }
      else { st.ground = true; st.alt = elevAt(x, z) ?? g0; st.v = 0; st.thr = 0; st.pitch = 0; }
      const gh = elevAt(x, z, true); st.gk = gh != null || (!airborne && s === 0); st.gnd = gh ?? (airborne ? st.alt - 300 : st.alt);
      path.reset(); path.seed(s);
    }
    const replay = O.mode === 'replay';
    place(0, !groundStart);

    /* ---- input ---- */
    const keys = new Set(), ctl = { roll: 0, pitch: 0 };
    let showGates = !replay && store.get('gates', true);
    let invert = store.get('invert', false), apOn = replay, paused = true, rate = replay ? store.get('rate', 4) : 1, camI = 0, tilt = null, stickV = null, thrTarget = st.thr;
    const CAMS = [['Chase', 1, 1, 8.5], ['Wide', 4.2, 4.5, 11], ['High', 26, 34, 32]];
    on(window, 'keydown', e => {
      if (!alive) return; const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'pageup', 'pagedown'].includes(k)) e.preventDefault();
      if (e.repeat && (k === ' ' || k === 'c' || k === 'p' || k === 'm')) return;
      if (k === ' ') { togglePause(); return; }
      if (k === 'c') { cycleCam(); return; }
      if (k === 'p' && !replay) { setAP(!apOn); return; }
      if (k === 'm') { toggleMute(); return; }
      if (k === 'v' && !replay) { flapT = flapT ? 0 : 1; return; }
      if (k === 'g') { showGates = !showGates; store.set('gates', showGates); $('[data-gates]')?.setAttribute('aria-pressed', String(showGates)); return; }
      if (/^[0-9]$/.test(k) && !replay) { thrTarget = k === '0' ? 1 : +k / 10; return; }
      keys.add(k);
    });
    on(window, 'keyup', e => keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => keys.clear());
    // touch stick
    const stick = $('[data-stick]'), knob = $('[data-knob]');
    const stickMove = e => { const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2 - 18; let dx = e.clientX - cx, dy = e.clientY - cy; const m = Math.hypot(dx, dy); if (m > R) { dx *= R / m; dy *= R / m; } knob.style.transform = `translate(${dx}px,${dy}px)`; stickV = { roll: dx / R, pitch: dy / R }; };
    on(stick, 'pointerdown', e => { stick.setPointerCapture(e.pointerId); stickMove(e); });
    on(stick, 'pointermove', e => { if (stickV) stickMove(e); });
    const stickEnd = () => { stickV = null; knob.style.transform = ''; };
    on(stick, 'pointerup', stickEnd); on(stick, 'pointercancel', stickEnd);
    const thrRange = $('[data-thrrange]'); thrRange.oninput = () => { thrTarget = thrRange.value / 100; };
    $('[data-tilt]').onclick = async () => {
      if (tilt) { tilt = null; $('[data-tilt]').classList.remove('on'); $('[data-tilt]').textContent = 'Tilt to steer'; return; }
      try { if (window.DeviceOrientationEvent?.requestPermission) { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') return; } } catch { return; }
      tilt = { b0: null, g0: null, roll: 0, pitch: 0 }; $('[data-tilt]').classList.add('on'); $('[data-tilt]').textContent = 'Tilt on · tap to stop';
    };
    on(window, 'deviceorientation', e => {
      if (!tilt || e.beta == null) return; const ang = (screen.orientation?.angle ?? window.orientation ?? 0) % 360;
      if (tilt.b0 == null) { tilt.b0 = e.beta; tilt.g0 = e.gamma; }
      if (ang === 90) { tilt.roll = e.beta / 28; tilt.pitch = -(e.gamma - tilt.g0) / 22; }
      else if (ang === 270 || ang === -90) { tilt.roll = -e.beta / 28; tilt.pitch = (e.gamma - tilt.g0) / 22; }
      else { tilt.roll = e.gamma / 28; tilt.pitch = (e.beta - tilt.b0) / 22; }
    });
    $('[data-flapb]').onclick = () => { flapT = flapT ? 0 : 1; $('[data-flapb]').classList.toggle('on', !!flapT); };
    $('[data-touch]').hidden = replay || !coarse;
    root.classList.toggle('is-replay', replay); root.classList.toggle('is-touch', coarse && !replay);

    function readInput(dt) {
      const k = a => a.some(x => keys.has(x));
      let r = (k(['arrowright', 'd']) ? 1 : 0) - (k(['arrowleft', 'a']) ? 1 : 0);
      let p = (k(['arrowdown', 's']) ? 1 : 0) - (k(['arrowup', 'w']) ? 1 : 0);
      if (k(['=', '+', 'pageup', 'r', 'shift'])) thrTarget = clamp(thrTarget + dt * .6, 0, 1);
      if (k(['-', '_', 'pagedown', 'f', 'control'])) thrTarget = clamp(thrTarget - dt * .6, 0, 1);
      const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
      if (pad) { const ax = pad.axes; if (Math.abs(ax[0]) > .08) r = ax[0]; if (Math.abs(ax[1]) > .08) p = ax[1]; const up = pad.buttons[7]?.value || 0, dn = pad.buttons[6]?.value || 0; if (up || dn) thrTarget = clamp(thrTarget + (up - dn) * dt * .7, 0, 1); }
      if (stickV) { r = stickV.roll; p = stickV.pitch; }
      if (tilt) { if (Math.abs(tilt.roll) > .06) r = clamp(tilt.roll, -1, 1); if (Math.abs(tilt.pitch) > .06) p = clamp(tilt.pitch, -1, 1); }
      if (invert) p = -p;
      if (apOn && !replay && (Math.abs(r) > .35 || Math.abs(p) > .35)) { setAP(false); tipNow = 'Autopilot off: you have control'; tipUntil = performance.now() + 2500; }
      // keyboard input ramps for smoothness; analogue inputs pass straight through
      const ramp = (cur, tgt) => cur + clamp(tgt - cur, -dt * 5, dt * 5);
      ctl.roll = stickV || pad || tilt ? r : ramp(ctl.roll, r); ctl.pitch = stickV || pad || tilt ? p : ramp(ctl.pitch, p);
      if (Math.abs(thrRange.value / 100 - thrTarget) > .02 && document.activeElement !== thrRange) thrRange.value = Math.round(thrTarget * 100);
    }

    /* ---- autopilot (replay and AP) ---- */
    function autopilot(dt) {
      const pr = path.project(st.x, st.z), vk = st.v / KT, remain = L - pr.s;
      const look = clamp(st.v * 7, 180, 900), [tx, tz] = path.at(pr.s + look);
      let des = Math.atan2(tx - st.x, tz - st.z) * R2D;
      if (st.ground) {
        // take-off or landing roll: steer along the route, keep the wings level
        ctl.roll = clamp(wrap180(des - st.hdg) / 20, -1, 1);
        if (st.landedOnce) { thrTarget = 0; ctl.pitch = 0; return; }
        thrTarget = 1; ctl.pitch = vk > 58 ? .8 : 0; return;
      }
      const lowWings = st.agl < 15 && landEnd && remain < (circuit ? 1500 : 5000), err = wrap180(des - st.trk), desBank = clamp(err * 1.4, lowWings ? -4 : -30, lowWings ? 4 : 30);
      ctl.roll = clamp((desBank - st.bank) * .09, -1, 1);
      const agl = st.agl, approach = landEnd && remain < (circuit ? 1500 : 5000);
      let ta = prof(pr.s + st.v * 5);
      flapT = approach && vk < 100 ? 1 : 0;
      if (approach && remain < 3500) ta = Math.min(ta, st.gnd + Math.max(0, remain - TDZ) * DG);
      if (!approach) { const ah = path.at(pr.s + 900), ga = elevAt(ah[0], ah[1]); if (ga != null) ta = Math.max(ta, ga + 160); ta = Math.max(ta, st.gnd + (approach ? 0 : 120)); }
      let desVS = clamp((ta - st.alt) * .22, -3.8, 4.2);
      if (approach && remain < TDZ + 50) desVS = Math.min(desVS, -1.6); // past the aim point: commit to landing
      if (approach && agl < 4.5) desVS = -clamp(agl * .2, .45, .9); // flare
      flareNow = approach && agl < 4.5;
      let desPitch = Math.asin(clamp(desVS / Math.max(st.v, 20), -.35, .35)) * R2D + 0;
      // speed protection: never trade airspeed below the climb speed for height
      const vMin = approach ? (agl < 15 ? 52 : 62) : 70;
      if (vk < vMin) desPitch = Math.min(desPitch, (vk - (vMin - 12)) * .7);
      desPitch = clamp(desPitch, -10, 12);
      ctl.pitch = clamp((desPitch - st.pitch) * .3, -1, 1);
      const tgtV = approach ? (agl < 60 ? 62 : 72) : circuit ? 88 : 98;
      thrTarget = flareNow ? (agl < 1.5 ? 0 : .18) : desVS > 1.5 && !approach ? 1 : clamp(.62 + (tgtV - vk) * .05 + desVS * .04, .1, 1);
    }

    /* ---- flight model (simple, game-like) ---- */
    function step(dt) {
      st.t += dt;
      st.thr += clamp(thrTarget - st.thr, -dt * .8, dt * .8);
      st.flaps += clamp(flapT - st.flaps, -dt * .25, dt * .25);
      let vk = st.v / KT;
      const ge = elevAt(st.x, st.z); if (ge != null) { st.gnd = ge; st.gk = true; }
      if (!st.ground) st.airT = (st.airT || 0) + dt;
      if (st.ground) {
        st.bank += (0 - st.bank) * Math.min(1, dt * 6);
        st.pitch = clamp(st.pitch + ctl.pitch * 9 * dt * (vk > 40 ? 1 : 0) - (ctl.pitch <= 0 ? st.pitch * 2 * dt : 0), 0, 12);
        const acc = 2.7 * st.thr - .0002 * vk * vk - (st.thr < .05 ? (st.landed ? 4 : 1.2) : .25);
        vk = Math.max(0, vk + acc * dt); st.v = vk * KT;
        st.hdg = norm360(st.hdg + ctl.roll * 18 * dt * Math.min(1, vk / 15 + .3));
        st.alt = st.gnd; st.vs = 0;
        if (vk > 52 && st.pitch >= 4) { st.ground = false; st.landed = false; st.airT = 0; st.alt += .4; }
      } else {
        const vsStall = (47 - 6 * st.flaps) / Math.sqrt(Math.max(.3, Math.cos(st.bank * D2R)));
        st.stall = vk < vsStall;
        st.bank = clamp(st.bank + ctl.roll * 48 * dt - (Math.abs(ctl.roll) < .05 && !apOn ? st.bank * .35 * dt : 0), -65, 65);
        st.pitch = clamp(st.pitch + ctl.pitch * 11 * dt, -25, 25);
        if (st.stall) { st.pitch -= 9 * dt; st.bank += Math.sin(st.t * 3) * 6 * dt; }
        const acc = 2.645 * st.thr - .0002 * (1 + .9 * st.flaps) * vk * vk - 19.07 * Math.sin(st.pitch * D2R) - Math.abs(st.bank) * .004;
        vk = clamp(vk + acc * dt, 0, 175); st.v = vk * KT;
        const lift = clamp((vk - 26) / 20, 0, 1);
        st.vs = st.v * Math.sin(st.pitch * D2R) * lift - (1 - lift) * 7;
        st.hdg = norm360(st.hdg + G * Math.tan(st.bank * D2R) / Math.max(st.v, 15) * R2D * dt * lift);
        st.alt += st.vs * dt;
      }
      const hv = st.v * Math.cos(st.pitch * D2R), gx = hv * Math.sin(st.hdg * D2R) + (st.ground ? 0 : wind.x), gz = hv * Math.cos(st.hdg * D2R) + (st.ground ? 0 : wind.z);
      st.x += gx * dt; st.z += gz * dt; st.gs = Math.hypot(gx, gz); if (st.gs > 2) st.trk = norm360(Math.atan2(gx, gz) * R2D); else st.trk = st.hdg;
      st.agl = st.alt - st.gnd;
      // what the pilot sees: flight path plus angle of attack, which grows as the aircraft slows
      const aoa = st.ground ? 0 : clamp(1.5 + 6 * ((62 / Math.max(st.v / KT, 38)) ** 2 - 1) - st.flaps * 1.5, -1, 13);
      st.att = (st.ground ? st.pitch : st.pitch + aoa);
      if (!st.gk && !st.ground) st.agl = Math.max(st.agl, 300); // scenery under us not loaded yet
      if (!st.ground && st.agl <= .3 && (st.airT || 0) < 2.5) { st.alt = st.gnd + .3; st.agl = .3; st.vs = Math.max(st.vs, 0); }
      else if (!st.ground && st.agl <= .3) {
        const fpm = st.vs / FT * 60;
        if (fpm > -800 && Math.abs(st.bank) < 14 && st.pitch > -5 && st.v / KT < 95) { st.ground = true; st.landed = true; st.landedOnce = true; st.alt = st.gnd; st.touch = { fpm, bank: st.bank, at: path.project(st.x, st.z).s, t: st.t }; st.pitch = Math.max(0, st.pitch); }
        else { st.crashed = true; st.alt = st.gnd; st.crash = fpm <= -800 ? 'You hit the ground descending too fast.' : Math.abs(st.bank) >= 14 ? 'A wing touched the ground. Level the wings before landing.' : 'The aircraft hit the ground nose-first.'; }
      }
    }

    /* ---- score (fly mode) ---- */
    const score = { t: 0, tube: 0, xteSum: 0, altSum: 0, maxAlt: st.alt, dist: 0, n: 0 };
    let lastFlown = 0, lastX = st.x, lastZ = st.z;

    let camH = st.hdg, camD = 8.5, camPitchLag = 0;

    /* ---- HUD ---- */
    const H = { ias: $('[data-ias]'), alt: $('[data-alt]'), vs: $('[data-vs]'), hdg: $('[data-hdg]'), tape: $('[data-tape]'), hor: $('[data-hor]'), bp: $('[data-bankptr]'), thr: $('[data-thr]'), flaps: $('[data-flaps]'), wp: $('[data-wp]'), wpd: $('[data-wpd]'), warn: $('[data-warn]'), needle: $('[data-needle]'), xte: $('[data-xte]'), bug: $('[data-bugi]'), time: $('[data-time]'), scrub: $('[data-scrub]') };
    const wpts = (O.waypoints || []).map(w => ({ ...w, s: path.project(...F.to(w.lat, w.lng), true).s })); path.seed(0);
    let warnText = '', tipText = '', tipNow = '', tipUntil = 0;
    const tipEl = document.createElement('div'); tipEl.className = 'sim-tip'; tipEl.setAttribute('role', 'status'); $('[data-warn]').after(tipEl);
    function hud() {
      const vk = st.v / KT, pr = path.project(st.x, st.z);
      H.ias.textContent = Math.round(st.ground && vk < 5 ? 0 : vk);
      H.alt.textContent = Math.max(0, Math.round((st.alt - geoN) / FT / 10) * 10).toLocaleString('en-GB');
      const fpm = Math.round(st.vs / FT * 60 / 50) * 50; H.vs.textContent = `${fpm > 0 ? '↑' : fpm < 0 ? '↓' : ''}${Math.abs(fpm)} fpm`;
      H.hdg.textContent = pad3(st.hdg) + '°';
      H.tape.setAttribute('transform', `translate(${120 - (st.hdg + 180) * 4} 0)`);
      H.hor.setAttribute('transform', `rotate(${-st.bank}) translate(0 ${(st.att ?? st.pitch) * 2.2})`); H.bp.setAttribute('transform', `rotate(${-st.bank})`);
      H.thr.style.height = `${Math.round(st.thr * 100)}%`;
      H.flaps.textContent = st.flaps > .95 ? 'Flaps down' : st.flaps < .05 ? 'Flaps up' : 'Flaps…'; H.flaps.classList.toggle('on', st.flaps > .05);
      // next waypoint
      let next = wpts.find(w => w.s > pr.s + 80);
      const endS = L, [nx, nz] = next ? F.to(next.lat, next.lng) : path.at(endS);
      const brg = norm360(Math.atan2(nx - st.x, nz - st.z) * R2D), dist = Math.hypot(nx - st.x, nz - st.z) / NM;
      H.wp.textContent = next ? next.code : (synthetic ? 'Circuit' : 'End');
      H.wpd.textContent = `${pad3(brg)}° · ${dist.toFixed(1)} NM${st.gs > 10 ? ` · ${mmss(dist * NM / st.gs)}` : ''}`;
      const rel = wrap180(brg - st.hdg); H.bug.style.left = `calc(50% + ${clamp(rel * 4, -112, 112)}px)`; H.bug.style.opacity = Math.abs(rel) > 28 ? .45 : 1;
      // cross-track
      const nm = pr.d / NM, full = circuit ? .5 : 1, side = pr.side > 0 ? 'left' : 'right';
      H.needle.style.left = `${50 + clamp((pr.side > 0 ? 1 : -1) * nm / full, -1, 1) * 45}%`;
      H.xte.textContent = pr.d < 60 ? 'On track' : `${nm < .1 ? Math.round(pr.d) + ' m' : nm.toFixed(1) + ' NM'} ${side} of track`;
      // warnings
      let w = '';
      if (st.crashed) w = 'Crashed';
      else if (st.stall) w = 'Stall';
      else if (!st.ground && st.agl < 100 && st.vs < -4 && !(landEnd && L - pr.s < 2500)) w = 'Pull up';
      else if (!st.ground && vk > 150) w = 'Overspeed';
      if (w !== warnText) { warnText = w; H.warn.textContent = w; H.warn.classList.toggle('on', !!w); }
      let tip = '';
      if (performance.now() < tipUntil) tip = tipNow;
      else if (!replay && !apOn && !st.crashed) {
        if (st.ground && !st.landedOnce && st.thr < .5) tip = coarse ? 'Push the power slider up to start your take-off roll' : 'Add power: hold R, or press 0 for full power';
        else if (st.ground && !st.landedOnce && vk > 42) tip = coarse ? 'Gently pull the stick back to lift off' : 'Gently hold ↓ (or S) to lift off at about 55 kt';
        else if (!st.ground && st.t < 60 && st.agl < 200) tip = 'Climb towards the first gate';
        else if (!st.ground && landEnd && L - pr.s < 2500 && L - pr.s > 300) tip = 'Line up with the route, reduce power and descend gently to land';
      }
      if (tip !== tipText) { tipText = tip; tipEl.textContent = tip; tipEl.classList.toggle('on', !!tip); }
      if (replay) { H.time.textContent = `${mmss(st.t)} · ${(pr.s / NM).toFixed(1)}/${(L / NM).toFixed(1)} NM`; if (document.activeElement !== H.scrub) H.scrub.value = Math.round(pr.s / L * 1000); }
      return pr;
    }

    /* ---- controls ---- */
    function setAP(v) { apOn = v; $('[data-ap]').setAttribute('aria-pressed', String(v)); $('[data-ap]').classList.toggle('on', v); }
    function cycleCam() { camI = (camI + 1) % CAMS.length; $('[data-caml]').textContent = CAMS[camI][0]; }
    function toggleMute() { const m = !store.get('mute', false); store.set('mute', m); audio.mute(m); $('[data-mute]').classList.toggle('off', m); }
    function togglePause(force) { paused = force ?? !paused; audio.pause(paused); const d = paused ? 'M8 5l11 7-11 7z' : 'M8 5v14M16 5v14'; $$('[data-pp],[data-pp2]').forEach(p => p.setAttribute('d', d)); root.classList.toggle('is-paused', paused); }
    $('[data-ap]').onclick = () => setAP(!apOn); $('[data-cam]').onclick = cycleCam; $('[data-mute]').onclick = toggleMute; $('[data-pause]').onclick = () => togglePause(); $('[data-play]').onclick = () => togglePause();
    $('[data-mute]').classList.toggle('off', store.get('mute', false));
    $('[data-gates]').setAttribute('aria-pressed', String(showGates)); $('[data-gates]').onclick = () => { showGates = !showGates; store.set('gates', showGates); $('[data-gates]').setAttribute('aria-pressed', String(showGates)); };
    if (replay) { $('[data-ap]').hidden = true; $('[data-replaybar]').hidden = false; }
    const rateBtns = () => $$('[data-rate]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.rate === rate)));
    $$('[data-rate]').forEach(b => b.onclick = () => { rate = +b.dataset.rate; store.set('rate', rate); rateBtns(); }); rateBtns();
    H.scrub.oninput = () => { const s = H.scrub.value / 1000 * L; const air = prof(s) - (elevAt(...path.at(s).slice(0, 2)) ?? g0) > 30; place(s, air); flownPts.length = 0; flownLine.positions = []; };
    $('[data-sub]').textContent = [O.subtitle, replay ? 'Replay' : 'Fly it', wind.spd ? `Wind ${pad3(wind.dir)}°/${wind.spd} kt` : 'Calm'].filter(Boolean).join(' · ');

    /* ---- ready card ---- */
    const ctrlHelp = coarse
      ? `<li><b>Stick</b> bottom left: pull back to climb, push to descend, sideways to bank.</li><li><b>Power</b> slider on the right. Or turn on <b>Tilt to steer</b>.</li>`
      : `<li><b>↑ ↓</b> or <b>W S</b>: nose down / nose up (pull back to climb)</li><li><b>← →</b> or <b>A D</b>: bank left / right</li><li><b>R F</b> or <b>+ −</b>: more or less power · <b>1–0</b> set power</li><li><b>V</b> flaps (use them to slow down for landing) · <b>G</b> route gates</li><li><b>P</b> autopilot · <b>C</b> camera · <b>Space</b> pause · <b>M</b> sound</li><li>A gamepad works too.</li>`;
    card(`<span class="sim-kicker">${replay ? 'Replay' : 'Fly it'} · ${esc(O.aircraft || 'Trainer')}</span><h2>${esc(O.title)}</h2>
      <p>${replay ? 'Sit back while the autopilot flies your logged route over real terrain. Change the speed, scrub along the route, or switch camera.' : `Fly the route yourself. Follow the gates and the dashed line, ${groundStart ? 'take off from the runway' : 'starting in the air'}${landEnd ? ', and land at the end' : ''}.`}</p>
      <div class="sim-facts"><div><span>Distance</span><b>${(L / NM).toFixed(1)} NM</b></div><div><span>Planned height</span><b>${Math.round((cruise - geoN) / FT / 100) * 100} ft</b></div><div><span>Wind</span><b>${wind.spd ? `${pad3(wind.dir)}° / ${wind.spd} kt` : 'Calm'}</b></div></div>
      ${replay ? '' : `<ul class="sim-help">${ctrlHelp}</ul><label class="sim-check"><input type="checkbox" data-inv ${invert ? 'checked' : ''}> Invert pitch (push to climb)</label>`}
      ${synthetic ? '<p class="sim-note">This flight has no recorded track, so you’ll fly a standard circuit from the departure airfield.</p>' : ''}
      <p class="sim-note">A practice toy for fun and route familiarisation, not a training device. Heights are estimated, not logged.</p>
      <div class="sim-actions"><button type="button" class="sim-btn ghost" data-x>Back</button><button type="button" class="sim-btn" data-go>${replay ? 'Play replay' : 'Start flying'}</button></div>`);
    wireX();
    const inv = $('[data-inv]'); if (inv) inv.onchange = () => { invert = inv.checked; store.set('invert', invert); };
    $('[data-go]').onclick = () => { card(''); audio.start(); togglePause(false); };
    setAP(apOn);

    /* ---- end card ---- */
    let ended = false;
    function finish(kind) {
      if (ended) return; ended = true; togglePause(true);
      const t = score.t, tube = score.n ? Math.round(score.tube / score.n * 100) : 0, xte = score.n ? score.xteSum / score.n / NM : 0;
      const touch = st.touch, ld = touch ? (touch.fpm > -250 ? ['Smooth landing', 'great'] : touch.fpm > -500 ? ['Good landing', 'ok'] : ['Firm landing', 'firm']) : null;
      const bestKey = 'best-' + (O.id || O.title), best = store.get(bestKey, null);
      if (!replay && kind !== 'crash' && (!best || tube > best)) store.set(bestKey, tube);
      card(`<span class="sim-kicker">${kind === 'crash' ? 'Flight over' : replay ? 'Replay finished' : 'Route complete'}</span><h2>${kind === 'crash' ? 'Crashed' : ld ? ld[0] : 'Well flown'}</h2>
        ${kind === 'crash' ? `<p>${esc(st.crash)}</p>` : ld ? `<p>Touchdown at ${Math.abs(Math.round(touch.fpm / 10) * 10)} fpm with ${Math.abs(Math.round(touch.bank))}° of bank.</p>` : ''}
        <div class="sim-facts"><div><span>Time</span><b>${mmss(t)}</b></div><div><span>Flown</span><b>${(score.dist / NM).toFixed(1)} NM</b></div><div><span>Highest</span><b>${Math.round((score.maxAlt - geoN) / FT / 10) * 10} ft</b></div>
        ${replay ? '' : `<div><span>On the route</span><b>${tube}%</b></div><div><span>Average off track</span><b>${xte < .1 ? Math.round(xte * NM) + ' m' : xte.toFixed(2) + ' NM'}</b></div><div><span>Your best</span><b>${best != null ? Math.max(best, kind === 'crash' ? 0 : tube) + '%' : (kind === 'crash' ? '—' : tube + '%')}</b></div>`}</div>
        ${replay ? '' : '<p class="sim-note">“On the route” is the share of time within the gates’ width and 250 ft of the planned height.</p>'}
        <div class="sim-actions"><button type="button" class="sim-btn ghost" data-x>Done</button><button type="button" class="sim-btn" data-again>${replay ? 'Watch again' : 'Fly again'}</button></div>`);
      wireX();
      $('[data-again]').onclick = () => { ended = false; Object.assign(score, { t: 0, tube: 0, xteSum: 0, altSum: 0, maxAlt: 0, dist: 0, n: 0 }); st.t = 0; st.touch = null; st.landedOnce = false; flownPts.length = 0; flownLine.positions = []; place(0, !groundStart); camH = st.hdg; card(''); togglePause(false); };
    }

    /* ---- loop ---- */
    let prev = performance.now(), hudT = 0;
    function loop(now) {
      if (!alive) return;
      raf = requestAnimationFrame(loop); pumping = false;
      const real = Math.min(.1, (now - prev) / 1000); prev = now;
      if (!paused && !ended) {
        let simT = real * rate;
        readInput(real);
        while (simT > 1e-4) {
          const dt = Math.min(.04, simT); simT -= dt;
          if (apOn) autopilot(dt);
          step(dt);
          // score
          score.t += dt; const pr = path.project(st.x, st.z); score.dist += Math.hypot(st.x - lastX, st.z - lastZ); lastX = st.x; lastZ = st.z; score.maxAlt = Math.max(score.maxAlt, st.alt);
          if (!st.ground) { score.n++; score.xteSum += pr.d; const ae = Math.abs(st.alt - prof(pr.s)); if (pr.d < (circuit ? 90 : 140) / 2 + 60 && ae < 250 * FT) score.tube++; }
          if (st.crashed) { finish('crash'); break; }
          if (st.ground && st.landedOnce && st.v < 2) { finish('land'); break; }
          if (!landEnd && pr.s > L - 40) { finish('done'); break; }
          if (!st.ground && pr.s >= L - 5 && pr.d > 500) { finish('done'); break; }
        }
        if (now - lastFlown > 700) { lastFlown = now; flownPts.push(LLH(st.x, st.z, st.alt + 1.5)); if (flownPts.length > 3000) flownPts.shift(); if (flownPts.length > 1) flownLine.positions = flownPts; }
        audio.update(st.thr, st.v / KT, st.stall && !st.ground, true);
      }
      frameDraw(real);
      hudT += real; if (hudT > .05) { hudT = 0; hud(); }
    }
    raf = requestAnimationFrame(loop);
    return { close: destroy };
  }

  return { open };
})();
