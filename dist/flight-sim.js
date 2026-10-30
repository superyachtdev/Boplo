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
  const IMG = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
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
    // exact ground height from the full-detail z14 tile (null until that tile has loaded)
    const ready = new Map();
    const sampleAt = (lng, lat) => {
      const n = 2 ** MAXZ, fx = (lng + 180) / 360 * n, r = lat * Math.PI / 180, fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n, tx = Math.floor(fx), ty = Math.floor(fy), k = MAXZ + '/' + tx + '/' + ty;
      const h = ready.get(k); if (!h) { tile(MAXZ, tx, ty).then(d => { ready.set(k, d); if (ready.size > 120) ready.delete(ready.keys().next().value); }).catch(() => { }); return null; }
      const u = clamp((fx - tx) * 256 - .5, 0, 255), v = clamp((fy - ty) * 256 - .5, 0, 255), x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), ax = u - x0, ay = v - y0;
      return (h[y0 * 256 + x0] * (1 - ax) + h[y0 * 256 + x1] * ax) * (1 - ay) + (h[y1 * 256 + x0] * (1 - ax) + h[y1 * 256 + x1] * ax) * ay;
    };
    const provider = new C.CustomHeightmapTerrainProvider({ width: N, height: N, tilingScheme: new C.WebMercatorTilingScheme(), credit: 'Terrain: AWS Terrain Tiles', callback: (x, y, level) => {
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
    provider.sampleAt = sampleAt;
    return provider;
  }
  function loadCSS() { if (document.querySelector('link[data-simcss]')) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/flight-sim.css?v=22'; l.dataset.simcss = '1'; document.head.append(l); }

  /* ---------------- local frame (metres, x east, z north) ---------------- */
  function frame(lat0, lng0) {
    const kx = Math.cos(lat0 * D2R) * 111320, kz = 111132;
    // the frame is flat (equirectangular), so on a long route east-west metres stretch by cos(lat)/cos(lat0) away from the start:
    // sx() is that stretch at a given z, used to turn frame headings into true ones for drawing
    const c0 = Math.cos(lat0 * D2R);
    return { lat0, to: (lat, lng) => [(lng - lng0) * kx, (lat - lat0) * kz], ll: (x, z) => [lng0 + x / kx, lat0 + z / kz], sx: z => Math.cos((lat0 + z / kz) * D2R) / c0 };
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

  /* ---------------- runways: real geometry from OurAirports, drawn by us ---------------- */
  const rwCache = {};
  /* ---- OpenStreetMap runway geometry (see airportRunways) ---- */
  const osmKey = code => 'boplo-osmrw:' + code, osmPending = {};
  // cached runways (14 days), or a cached "OSM has none here" (2 days); null when we don't know yet
  const osmCached = code => { try { const c = JSON.parse(localStorage.getItem(osmKey(code)) || 'null'); if (c && Array.isArray(c.r) && Date.now() - c.t < (c.r.length ? 14 : 2) * 864e5) return c.r; } catch { } return null; };
  function fetchOSM(ap) {
    if (!ap?.code || !Number.isFinite(ap.lat)) return Promise.resolve([]);
    const hit = osmCached(ap.code); if (hit) return Promise.resolve(hit);
    if (osmPending[ap.code]) return osmPending[ap.code];
    const save = r => { try { localStorage.setItem(osmKey(ap.code), JSON.stringify({ t: Date.now(), r })); } catch { } return r; };
    const q = `[out:json][timeout:25];way["aeroway"="runway"](around:4000,${ap.lat.toFixed(5)},${ap.lng.toFixed(5)});out geom tags;`;
    const shape = j => (j.elements || []).filter(e => e.type === 'way' && e.geometry?.length >= 2).map(e => { const g = e.geometry.map(p => [p.lat, p.lon]), t = e.tags || {}; let w = parseFloat(t.width); if (/ft|'/.test(String(t.width))) w *= .3048; return { ref: t.ref || '', width: w > 5 && w < 120 ? w : null, surface: t.surface || '', area: (g.length > 3 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1]) || t.area === 'yes', pts: g }; });
    // Overpass straight from the browser (it often refuses Cloudflare), trying the main server and a mirror; when it
    // works, share it with Boplo's server so the next pilot at this airfield gets it instantly
    const direct = url => fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q) }).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(shape)
      .then(r => { if (r.length && ap.cc) fetch('/flight/runways/osm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: ap.code, cc: ap.cc, runways: r }) }).catch(() => { }); return r; });
    return osmPending[ap.code] = new Promise(res => {
      let left = 3, emptyOK = false; const done = (r, ok) => { if (left < 0) return; if (r?.length) { left = -9; res(save(r)); return; } if (ok) emptyOK = true; if (--left === 0) { delete osmPending[ap.code]; res(emptyOK ? save([]) : []); } };
      fetch(`/flight/runways/osm?code=${encodeURIComponent(ap.code)}&lat=${ap.lat.toFixed(5)}&lng=${ap.lng.toFixed(5)}`).then(r => r.ok ? r.json() : {}).then(j => done(j.runways, !j.unavailable && Array.isArray(j.runways))).catch(() => done(null));
      direct('https://overpass-api.de/api/interpreter').then(r => done(r, true)).catch(() => done(null));
      direct('https://maps.mail.ru/osm/tools/overpass/api/interpreter').then(r => done(r, true)).catch(() => done(null));
    });
  }
  const loadRunways = cc => !cc || !/^[A-Z]{2}$/.test(cc) ? Promise.resolve({}) : (rwCache[cc] ||= fetch(`/runways/${cc}.json`).then(r => r.ok ? r.json() : { rows: {} }).then(d => d.rows || {}).catch(() => ({})));
  const PAVED = s => s === 'asphalt' || s === 'concrete' || s === 'other' || !s;
  // ICAO threshold stripe count by runway width
  const stripesFor = w => w >= 60 ? 16 : w >= 45 ? 12 : w >= 30 ? 8 : w >= 23 ? 6 : 4;
  function runwayCanvas(rw) {
    const W = rw.wid, Lm = rw.len, cw = 256, ch = Math.min(4096, Math.max(512, Math.round(Lm * 2.2)));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d');
    const mx = cw / W, my = ch / Lm; // pixels per metre across and along
    const Y = u => ch - u * my;        // u metres from end A (canvas bottom) to end B (top)
    const paved = PAVED(rw.surf);
    // surface
    const base = rw.surf === 'concrete' ? [138, 140, 142] : paved ? [52, 55, 60] : rw.surf === 'grass' ? [86, 118, 58] : rw.surf === 'water' ? [40, 80, 120] : [150, 126, 92];
    g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, cw, ch);
    // texture: speckle, tyre marks on pavement, mowing stripes on grass
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < ch * 3; i++) { const v = (rnd() - .5) * (paved ? 26 : 34); g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`; g.fillRect(rnd() * cw, rnd() * ch, 2 + rnd() * 3, 2 + rnd() * 6); }
    if (!paved && rw.surf === 'grass') { for (let x = 0; x < cw; x += cw / 6) { g.fillStyle = (x / (cw / 6)) % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'; g.fillRect(x, 0, cw / 6, ch); } }
    if (paved) {
      g.fillStyle = 'rgba(15,15,15,.35)';
      for (const end of [0, 1]) for (let k = 0; k < 40; k++) { const u0 = 250 + rnd() * 500, x = cw * (.38 + rnd() * .24); const yy = end ? Y(Lm - u0) : Y(u0); g.fillRect(x, yy - 60 * my, 3 + rnd() * 4, (60 + rnd() * 220) * my * (end ? 1 : -1)); }
    }
    if (paved) {
      const white = 'rgba(244,244,240,.92)'; g.fillStyle = white;
      // edge lines (where wide enough) and centreline: 30 m dashes, 20 m gaps
      if (W >= 18) { g.fillRect(.9 * mx, 0, .9 * mx, ch); g.fillRect(cw - 1.8 * mx, 0, .9 * mx, ch); }
      const cl = Math.max(.3, W >= 30 ? .9 : .45) * mx;
      for (let u = 6 + 30 + 12 + 9 + 12 + 10; u < Lm - (6 + 30 + 12 + 9 + 12 + 10); u += 50) g.fillRect(cw / 2 - cl / 2, Y(u + 30), cl, 30 * my);
      const endMarks = (ident, disp, flip) => {
        const at = u => flip ? Lm - u : u; // distance from this end's threshold
        const put = (u, len, x, w) => { const a = at(u), b = at(u + len); g.fillRect(x, Y(Math.max(a, b)), w, Math.abs(b - a) * my); };
        const d = Math.min(disp || 0, Lm * .3);
        if (d > 20) { // displaced threshold: arrows and a bar
          g.fillRect(0, Y(at(d)) - (flip ? 0 : 3 * my), cw, 3 * my);
          for (let u = 20; u < d - 20; u += 40) put(u, 18, cw / 2 - .45 * mx, .9 * mx);
        }
        const n = stripesFor(W), sw = 1.8, gp = Math.max(.6, (W - 6 - n * sw) / n);
        for (let i = 0; i < n; i++) put(d + 6, 30, (3 + i * (sw + gp) + (i >= n / 2 ? gp : 0)) * mx, sw * mx);
        // designator: number, with any L/R/C letter nearer the threshold
        const m = String(ident || '').toUpperCase().match(/^(\d{1,2})([LRC]?)$/);
        if (m) {
          const num = m[1].padStart(2, '0'), letter = m[2], u0 = d + 6 + 30 + 12;
          const glyph = (txt, u, hM) => {
            g.save(); const yy = Y(at(u + hM / 2)); g.translate(cw / 2, yy); if (flip) g.rotate(Math.PI);
            g.scale(1, my / mx); const px = hM * mx; g.font = `700 ${px}px "Archivo Narrow", "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
            const w = g.measureText(txt).width, maxW = cw * .8; if (w > maxW) g.scale(maxW / w, 1);
            g.fillText(txt, 0, 0); g.restore();
          };
          if (letter) { glyph(letter, u0, 9); glyph(num, u0 + 9 + 6, 9); } else glyph(num, u0, 9);
        }
        // aiming point and touchdown zone on longer runways
        if (Lm >= 800) {
          const aim = Lm >= 2400 ? 400 : Lm >= 1200 ? 300 : 250, aw = W >= 30 ? 6 : 4;
          put(d + aim, Lm >= 1200 ? 45 : 30, cw / 2 - (W * .18 + aw) * mx, aw * mx); put(d + aim, Lm >= 1200 ? 45 : 30, cw / 2 + W * .18 * mx, aw * mx);
          if (Lm >= 1500 && W >= 30) for (const u of [150, 450, 600, 750, 900].filter(u => u < Lm / 2 - 100)) { const bars = u < 300 ? 3 : u < 700 ? 2 : 1; for (let k = 0; k < bars; k++) { put(d + u, 22.5, cw / 2 - (W * .3 + k * 2.6) * mx, 1.8 * mx); put(d + u, 22.5, cw / 2 + (W * .3 + k * 2.6 - 1.8) * mx, 1.8 * mx); } }
        }
      };
      endMarks(rw.le, rw.leD, false); endMarks(rw.he, rw.heD, true);
    } else {
      // unpaved: white edge markers every 90 m and painted end bars
      g.fillStyle = 'rgba(250,250,245,.9)';
      for (let u = 0; u < Lm; u += 90) { g.fillRect(0, Y(u) - 3 * my, 1.2 * mx, 3 * my); g.fillRect(cw - 1.2 * mx, Y(u) - 3 * my, 1.2 * mx, 3 * my); }
      g.fillRect(0, Y(2), cw, 1.2 * my); g.fillRect(0, Y(Lm - .8), cw, 1.2 * my);
    }
    return c;
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
      const secs = [[.12, .52, .62], [.5, .52, .62], [1, .5, .58], [1.39, .465, .505], [1.4, .464, .503], [1.58, .44, .46], [1.62, .42, .4]];
      const rings = secs.map(([x, zLE, c]) => wingSec(wf, side * x, zLE, c, -.13 + (x - .12) * dih));
      loft('paint', side > 0 ? rings : rings.map(r => r.slice().reverse()), secs.map(([x]) => x >= 1.4 ? BLUE : WHITE), { capEnd: true });
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

  /* ---------------- six-pack instrument panel, drawn on one canvas ---------------- */
  function drawSixPack(cv, d) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const wide = W / H > 3.2, cols = wide ? 6 : 3, rows = wide ? 1 : 2, side = wide ? Math.min(150, W * .16) : 0;
    const cell = Math.min((W - side - 16) / cols, (H - 8) / rows), r = cell * .46;
    const x0 = (W - side - cell * cols) / 2, y0 = (H - cell * rows) / 2;
    const at = i => [x0 + (i % cols + .5) * cell, y0 + (Math.floor(i / cols) + .5) * cell];
    const A = a => (a - 90) * D2R; // degrees clockwise from 12 o'clock → canvas radians
    const font = (px, w = 600) => `${w} ${Math.max(7, px)}px Archivo, "Helvetica Neue", Arial, sans-serif`;
    function bezel(cx, cy) {
      g.save(); g.beginPath(); g.arc(cx, cy, r * 1.06, 0, 7); const bz = g.createLinearGradient(cx, cy - r, cx, cy + r); bz.addColorStop(0, '#2B313D'); bz.addColorStop(1, '#0B0E14'); g.fillStyle = bz; g.fill();
      g.beginPath(); g.arc(cx, cy, r * .97, 0, 7); g.fillStyle = '#0D1017'; g.fill(); g.restore();
    }
    const tick = (cx, cy, a, r1, r2, w = 1.4, col = '#E8ECF2') => { g.beginPath(); g.moveTo(cx + Math.cos(A(a)) * r1, cy + Math.sin(A(a)) * r1); g.lineTo(cx + Math.cos(A(a)) * r2, cy + Math.sin(A(a)) * r2); g.strokeStyle = col; g.lineWidth = w; g.stroke(); };
    const label = (cx, cy, a, rr, txt, px) => { g.fillStyle = '#E8ECF2'; g.font = font(px); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, cx + Math.cos(A(a)) * rr, cy + Math.sin(A(a)) * rr); };
    const needle = (cx, cy, a, len, w, col = '#F4F6FA', tail = .18) => { g.save(); g.translate(cx, cy); g.rotate(A(a) + Math.PI / 2); g.beginPath(); g.moveTo(-w / 2, len * tail); g.lineTo(-w * .32, -len * .82); g.lineTo(0, -len); g.lineTo(w * .32, -len * .82); g.lineTo(w / 2, len * tail); g.closePath(); g.fillStyle = col; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 3; g.fill(); g.restore(); };
    const hub = (cx, cy) => { g.beginPath(); g.arc(cx, cy, r * .07, 0, 7); g.fillStyle = '#20252F'; g.fill(); };
    const title = (cx, cy, t, dy = .38) => { g.fillStyle = '#8B96A8'; g.font = font(r * .13, 650); g.textAlign = 'center'; g.fillText(t, cx, cy + r * dy); };
    const arc = (cx, cy, rr, a1, a2, col, w) => { g.beginPath(); g.arc(cx, cy, rr, A(a1), A(a2)); g.strokeStyle = col; g.lineWidth = w; g.stroke(); };

    // 1 airspeed
    { const [cx, cy] = at(0); bezel(cx, cy); const mx = Math.ceil((d.vne + 25) / 20) * 20, ang = v => 20 + clamp(v, 0, mx) / mx * 320;
      if (d.vfe) arc(cx, cy, r * .74, ang(d.vso), ang(d.vfe), '#F2F4F7', r * .06);
      arc(cx, cy, r * .82, ang(d.vs), ang(d.vno), '#22B35A', r * .075); arc(cx, cy, r * .82, ang(d.vno), ang(d.vne), '#E8B923', r * .075); tick(cx, cy, ang(d.vne), r * .74, r * .9, 3, '#E0362D');
      for (let v = 0; v <= mx; v += 10) tick(cx, cy, ang(v), r * (v % 20 ? .82 : .76), r * .9, v % 20 ? 1 : 1.6);
      for (let v = 40; v <= mx; v += 20) label(cx, cy, ang(v), r * .6, String(v), r * .15);
      title(cx, cy, 'KNOTS', .25); needle(cx, cy, ang(d.ias), r * .86, r * .07); hub(cx, cy); }
    // 2 attitude
    { const [cx, cy] = at(1); bezel(cx, cy); g.save(); g.beginPath(); g.arc(cx, cy, r * .93, 0, 7); g.clip();
      g.translate(cx, cy); g.rotate(-d.bank * D2R); const py = d.pitch * r * .035;
      g.fillStyle = '#3D8DE8'; g.fillRect(-r * 2, -r * 3 + py, r * 4, r * 3); g.fillStyle = '#7A4F2A'; g.fillRect(-r * 2, py, r * 4, r * 3);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-r * 2, py); g.lineTo(r * 2, py); g.stroke();
      for (let p = -20; p <= 20; p += 5) if (p) { const yy = py - p * r * .035, w = p % 10 ? r * .14 : r * .28; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-w, yy); g.lineTo(w, yy); g.stroke(); if (!(p % 10)) { g.fillStyle = '#fff'; g.font = font(r * .11); g.textAlign = 'left'; g.fillText(String(Math.abs(p)), w + 3, yy + 3); } }
      g.restore();
      for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) tick(cx, cy, b, r * .8, r * (b % 30 ? .88 : .94), b ? 1.6 : 2.4);
      g.save(); g.translate(cx, cy); g.rotate(-d.bank * D2R); g.beginPath(); g.moveTo(0, -r * .79); g.lineTo(-r * .06, -r * .68); g.lineTo(r * .06, -r * .68); g.closePath(); g.fillStyle = '#FFB22E'; g.fill(); g.restore();
      g.strokeStyle = '#FFB22E'; g.lineWidth = r * .05; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - r * .5, cy); g.lineTo(cx - r * .16, cy); g.lineTo(cx - r * .08, cy + r * .08); g.moveTo(cx + r * .5, cy); g.lineTo(cx + r * .16, cy); g.lineTo(cx + r * .08, cy + r * .08); g.stroke(); g.lineCap = 'butt';
      g.beginPath(); g.arc(cx, cy, r * .03, 0, 7); g.fillStyle = '#FFB22E'; g.fill(); }
    // 3 altimeter
    { const [cx, cy] = at(2); bezel(cx, cy); for (let i = 0; i < 50; i++) tick(cx, cy, i * 7.2, r * (i % 5 ? .84 : .76), r * .9, i % 5 ? 1 : 1.8);
      for (let i = 0; i < 10; i++) label(cx, cy, i * 36, r * .62, String(i), r * .17);
      const ft = Math.max(0, d.altFt); g.fillStyle = '#05070B'; g.fillRect(cx + r * .2, cy - r * .1, r * .42, r * .2); g.fillStyle = '#E8ECF2'; g.font = font(r * .12); g.textAlign = 'center'; g.fillText(d.qnh, cx + r * .41, cy + r * .045);
      title(cx, cy, 'FEET', .3);
      needle(cx, cy, ft / 10000 * 360, r * .35, r * .03, '#E8ECF2'); needle(cx, cy, (ft % 10000) / 10000 * 360, r * .55, r * .1); needle(cx, cy, (ft % 1000) / 1000 * 360, r * .85, r * .06); hub(cx, cy); }
    // 4 turn coordinator
    { const [cx, cy] = at(cols === 6 ? 3 : 3); bezel(cx, cy);
      for (const s of [-1, 1]) { tick(cx, cy, 90 * s + 0 - 90 * s + (s > 0 ? 90 : -90) - (s > 0 ? 0 : 0), r * .72, r * .86, 2); tick(cx, cy, s > 0 ? 90 + 18 : -90 - 18, r * .72, r * .86, 2); }
      g.fillStyle = '#E8ECF2'; g.font = font(r * .13); g.textAlign = 'center'; g.fillText('L', cx - r * .72, cy + r * .3); g.fillText('R', cx + r * .72, cy + r * .3);
      title(cx, cy, '2 MIN', -.48);
      g.save(); g.translate(cx, cy - r * .05); g.rotate(clamp(d.turn / 3, -1.6, 1.6) * 18 * D2R); g.fillStyle = '#F4F6FA';
      g.fillRect(-r * .62, -r * .03, r * 1.24, r * .06); g.beginPath(); g.arc(0, 0, r * .1, 0, 7); g.fill(); g.fillRect(-r * .02, -r * .22, r * .04, r * .14); g.restore();
      const by = cy + r * .48; g.save(); g.beginPath(); g.ellipse(cx, by, r * .46, r * .1, 0, 0, 7); g.fillStyle = '#E9E2C8'; g.fill(); g.strokeStyle = '#05070B'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - r * .1, by - r * .1); g.lineTo(cx - r * .1, by + r * .1); g.moveTo(cx + r * .1, by - r * .1); g.lineTo(cx + r * .1, by + r * .1); g.stroke();
      g.beginPath(); g.arc(cx + clamp(d.slip / 8, -1, 1) * r * .36, by, r * .085, 0, 7); g.fillStyle = '#111'; g.fill(); g.restore(); }
    // 5 heading (HSI): card, heading bug, course arrow and deviation bar
    { const [cx, cy] = at(4); bezel(cx, cy); g.save(); g.translate(cx, cy); g.rotate(-d.hdg * D2R);
      for (let h = 0; h < 360; h += 5) { g.save(); g.rotate(h * D2R); g.beginPath(); g.moveTo(0, -r * .88); g.lineTo(0, -r * (h % 10 ? .82 : .76)); g.strokeStyle = '#E8ECF2'; g.lineWidth = h % 30 ? 1 : 1.8; g.stroke();
        if (!(h % 30)) { g.fillStyle = '#E8ECF2'; g.font = font(r * .15); g.textAlign = 'center'; g.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[h] || String(h / 10), 0, -r * .6); } g.restore(); }
      if (d.bug != null) { g.save(); g.rotate(d.bug * D2R); g.fillStyle = '#FF8C2E'; g.fillRect(-r * .08, -r * .92, r * .16, r * .07); g.restore(); }
      if (d.crs != null) { g.save(); g.rotate(d.crs * D2R); g.strokeStyle = '#F25CC8'; g.lineWidth = r * .045; g.beginPath(); g.moveTo(0, -r * .7); g.lineTo(0, -r * .36); g.moveTo(0, r * .36); g.lineTo(0, r * .7); g.stroke();
        g.fillStyle = '#F25CC8'; g.beginPath(); g.moveTo(0, -r * .78); g.lineTo(-r * .07, -r * .66); g.lineTo(r * .07, -r * .66); g.fill();
        for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.arc(k * r * .14, 0, r * .025, 0, 7); g.fillStyle = '#E8ECF2'; g.fill(); }
        g.strokeStyle = '#F25CC8'; g.beginPath(); g.moveTo(clamp(d.dev, -1, 1) * r * .28, -r * .32); g.lineTo(clamp(d.dev, -1, 1) * r * .28, r * .32); g.stroke(); g.restore(); }
      g.restore();
      g.fillStyle = '#FFB22E'; g.beginPath(); g.moveTo(cx, cy - r * .9); g.lineTo(cx - r * .06, cy - r * 1.0); g.lineTo(cx + r * .06, cy - r * 1.0); g.fill();
      g.strokeStyle = '#FFB22E'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - r * .14, cy + r * .05); g.lineTo(cx + r * .14, cy + r * .05); g.moveTo(cx, cy - r * .12); g.lineTo(cx, cy + r * .16); g.moveTo(cx - r * .06, cy + r * .14); g.lineTo(cx + r * .06, cy + r * .14); g.stroke(); }
    // 6 vertical speed
    { const [cx, cy] = at(5), ang = v => -90 + clamp(v, -2000, 2000) / 2000 * 170; bezel(cx, cy);
      for (let v = -2000; v <= 2000; v += 100) tick(cx, cy, ang(v), r * (v % 500 ? .82 : .74), r * .9, v % 500 ? 1 : 1.8);
      for (const v of [0, 5, 10, 15, 20]) { label(cx, cy, ang(v * 100), r * .6, String(v), r * .15); if (v) label(cx, cy, ang(-v * 100), r * .6, String(v), r * .15); }
      title(cx, cy, 'UP', -.25); title(cx, cy, 'DOWN', .32); g.fillStyle = '#8B96A8'; g.font = font(r * .1, 650); g.fillText('100 FT/MIN', cx + r * .12, cy + r * .08);
      needle(cx, cy, ang(d.vsFpm), r * .86, r * .07); hub(cx, cy); }
    // engine and systems column
    if (side) {
      const sx = W - side + 4, w = side - 12; let y = (H - 8 - cell) / 2 + 8;
      g.fillStyle = 'rgba(13,16,23,.92)'; g.beginPath(); g.roundRect ? g.roundRect(sx, y - 4, w, cell, 10) : g.rect(sx, y - 4, w, cell); g.fill();
      const row = (k, v, col = '#E8ECF2') => { g.font = font(cell * .085, 650); g.fillStyle = '#8B96A8'; g.textAlign = 'left'; g.fillText(k, sx + 10, y + cell * .1); g.fillStyle = col; g.textAlign = 'right'; g.font = font(cell * .1, 700); g.fillText(v, sx + w - 10, y + cell * .1); y += cell * .135; };
      row('RPM', String(d.rpm)); row('THROTTLE', `${Math.round(d.thr * 100)}%`); row('FLAPS', d.flaps); row('TRIM', d.trim > .04 ? `${Math.round(d.trim * 100)}% UP` : d.trim < -.04 ? `${Math.round(-d.trim * 100)}% DN` : 'NEUTRAL');
      const lamp = (t, onC, on, i) => { const bw = (w - 26) / 2, bx = sx + 10 + (i % 2) * (bw + 6), by = y + Math.floor(i / 2) * cell * .14; g.fillStyle = on ? onC : '#1C212B'; g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, cell * .11, 4) : g.rect(bx, by, bw, cell * .11); g.fill(); g.fillStyle = on ? '#0B0E14' : '#5C6678'; g.font = font(cell * .07, 750); g.textAlign = 'center'; g.fillText(t, bx + bw / 2, by + cell * .078); };
      lamp('PARK', '#E0362D', d.park, 0); lamp('BRAKE', '#E8B923', d.brake, 1); lamp('CARB', '#3FA2FF', d.carb, 2); lamp('A-RUD', '#22B35A', d.autoRud, 3); lamp('STALL', '#E0362D', d.stall, 4); lamp('AP', '#22B35A', d.ap, 5);
    }
  }

  /* ---------------- audio ---------------- */
  function engineAudio(jet = false) {
    let ac, out, eng, eng2, lp, wind, wg, horn, hg, rumble, rg, on = false;
    return {
      start() {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)(); out = ac.createGain(); out.gain.value = store.get('mute', false) ? 0 : .16; out.connect(ac.destination);
          lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = .7;
          const eg = ac.createGain(); eg.gain.value = .55; lp.connect(eg); eg.connect(out);
          eng = ac.createOscillator(); eng.type = jet ? 'sine' : 'sawtooth'; eng.frequency.value = 40; eng.connect(lp); eng.start();
          eng2 = ac.createOscillator(); eng2.type = jet ? 'sine' : 'square'; eng2.frequency.value = 81; const g2 = ac.createGain(); g2.gain.value = .25; eng2.connect(g2); g2.connect(lp); eng2.start();
          const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          wind = ac.createBufferSource(); wind.buffer = buf; wind.loop = true; const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = .5; wg = ac.createGain(); wg.gain.value = 0; wind.connect(bp); bp.connect(wg); wg.connect(out); wind.start();
          if (jet) { lp.type = 'bandpass'; lp.Q.value = 1.2; rumble = ac.createBufferSource(); rumble.buffer = buf; rumble.loop = true; rumble.playbackRate.value = .6; const rl = ac.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 380; rg = ac.createGain(); rg.gain.value = 0; rumble.connect(rl); rl.connect(rg); rg.connect(out); rumble.start(); }
          horn = ac.createOscillator(); horn.type = 'triangle'; horn.frequency.value = 1550; hg = ac.createGain(); hg.gain.value = 0; horn.connect(hg); hg.connect(out); horn.start();
          on = true;
        } catch { on = false; }
      },
      update(thr, kt, stall, running) {
        if (!on) return; const t = ac.currentTime, rpm = running ? .35 + thr * .65 : 0;
        if (jet) { // turbine whine that rises with N1, and a roar that swells with thrust
          eng.frequency.setTargetAtTime(500 + rpm * 2400, t, .6); eng2.frequency.setTargetAtTime(340 + rpm * 1500, t, .6); lp.frequency.setTargetAtTime(700 + rpm * 2600, t, .6);
          rg.gain.setTargetAtTime(running ? .25 + thr * 1.1 : 0, t, .5); wg.gain.setTargetAtTime(clamp(kt / 260, 0, 1) * .5, t, .3);
        } else {
        eng.frequency.setTargetAtTime(28 + rpm * 62, t, .15); eng2.frequency.setTargetAtTime((28 + rpm * 62) * 2.02, t, .15);
        lp.frequency.setTargetAtTime(300 + rpm * 700, t, .2);
        wg.gain.setTargetAtTime(clamp(kt / 130, 0, 1) * .5, t, .3);
        }
        hg.gain.setTargetAtTime(stall ? .18 : 0, t, .03);
      },
      mute(m) { if (on) out.gain.setTargetAtTime(m ? 0 : .16, ac.currentTime, .05); },
      pause(p) { if (on) (p ? ac.suspend() : ac.resume()).catch(() => { }); },
      stop() { if (on) { try { ac.close(); } catch { } } on = false; }
    };
  }

  /* ---------------- glass flight display: tapes, compass, side controls and info bar (in the style of mobile flight sims) ---------------- */
  function pfdHTML(jet) {
    const sp = [], al = [], rose = [], lad = [], htp = [];
    for (let v = 0; v <= 450; v += 5) { const y = -v * 4; sp.push(`<line x1="${v % 10 ? 50 : 42}" x2="58" y1="${y}" y2="${y}"/>${v % 20 === 0 ? `<text x="36" y="${y + 4}">${v}</text>` : ''}`); }
    for (let a = -1000; a <= 45000; a += 100) { const y = -a * .4; al.push(`<line x1="0" x2="${a % 500 ? 7 : 14}" y1="${y}" y2="${y}"/>${a % 500 === 0 ? `<text x="20" y="${y + 4}">${a.toLocaleString('en-GB')}</text>` : ''}`); }
    for (let d = 0; d < 360; d += 5) { const big = d % 10 === 0, lab = d % 30 === 0 ? ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10)) : ''; rose.push(`<g transform="rotate(${d})"><line x1="0" x2="0" y1="-78" y2="${big ? -69 : -73}"/>${lab ? `<text x="0" y="-56">${lab}</text>` : ''}</g>`); }
    // HUD pitch ladder: 6 units a degree; the horizon is a long broken line, climb rungs solid, dive rungs dashed
    const K = 6;
    for (let p = -90; p <= 90; p += 5) {
      if (!p) continue; const y = -p * K, w = p % 10 ? 22 : 46, g = 26, tip = p > 0 ? 7 : -7;
      lad.push(`<g class="${p < 0 ? 'dn' : ''}"><path d="M${-g - w} ${y + tip}V${y}H${-g}M${g} ${y}H${g + w}V${y + tip}"/>${p % 10 ? '' : `<text x="${-g - w - 6}" y="${y + 4}" text-anchor="end">${Math.abs(p)}</text><text x="${g + w + 6}" y="${y + 4}">${Math.abs(p)}</text>`}</g>`);
    }
    // heading tape across the top of the HUD: 4 units a degree, drawn 0–720 so it can scroll past north
    for (let d = 0; d <= 720; d += 5) { const x = d * 4, n = d % 360, big = d % 10 === 0, lab = d % 30 === 0 ? ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] || String(n / 10).padStart(2, '0')) : ''; htp.push(`<line x1="${x}" x2="${x}" y1="0" y2="${big ? 9 : 5}"/>${lab ? `<text x="${x}" y="22">${lab}</text>` : ''}`); }
    const bankT = [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60].map(b => `<line x1="0" x2="0" y1="-118" y2="${Math.abs(b) % 30 ? -112 : -108}" transform="rotate(${b})"/>`).join('');
    return `<div class="pfd" data-pfd>
      <div class="ibar" data-ibar role="group" aria-label="Flight data. Tap a box to change what it shows."></div>
      <div class="hud" aria-hidden="true"><svg viewBox="-210 -165 420 330">
        <defs><clipPath id="hudclip"><rect x="-190" y="-122" width="380" height="252" rx="16"/></clipPath><clipPath id="htclip"><rect x="-120" y="-162" width="240" height="34"/></clipPath></defs>
        <g clip-path="url(#hudclip)"><g data-hroll><g data-hpitch><path class="hz" d="M-600 0H-34M34 0H600"/><g class="lad">${lad.join('')}</g></g></g></g>
        <g class="bank">${bankT}<path d="M0 -122l-5 -8h10z" class="bz"/></g>
        <g data-hbank><path d="M0 -105l-6 9h12z" class="bp"/></g>
        <g class="wl"><path d="M-62 0H-26L-14 12L0 0L14 12L26 0H62"/><circle r="1.6"/></g>
        <g data-fpv class="fpv"><circle r="7"/><path d="M-19 0H-7M7 0H19M0 -7V-15"/></g>
        <g clip-path="url(#htclip)"><g data-htape transform="translate(0 -158)">${htp.join('')}<path data-hbug class="hbug" d="M0 0l-7 0v-6h14v6z"/><path data-htrk class="htrk" d="M0 4l4 6-4 6-4-6z"/></g></g>
        <path d="M0 -127l-5 7h10z" class="lub"/>
        <text data-hwarn class="hwarn" x="0" y="86" text-anchor="middle"></text>
      </svg></div>
      <div class="pfd-tape pfd-spd"><svg viewBox="0 -180 64 360"><defs><clipPath id="pfdcs"><rect x="0" y="-180" width="64" height="360"/></clipPath></defs><g clip-path="url(#pfdcs)"><g data-spdt><rect data-sband class="sband" x="58" width="6" y="0" height="0"/><rect data-aband class="aband" x="58" width="6" y="0" height="0"/><rect data-oband class="oband" x="58" width="6" y="-1800" height="0"/>${sp.join('')}<path data-sbug class="sbug" d="M58 0l6 -6v12z"/></g><line data-strend class="trend" x1="61" x2="61" y1="0" y2="0"/></g></svg><div class="pfd-box"><b data-pspd>0</b></div><small class="pfd-cap" data-pspdl>IAS</small><small class="pfd-sub" data-pgs>GS 0</small></div>
      <div class="pfd-tape pfd-alt"><svg viewBox="0 -180 72 360"><defs><clipPath id="pfdca"><rect x="0" y="-180" width="72" height="360"/></clipPath></defs><g clip-path="url(#pfdca)"><g data-altt>${al.join('')}<path data-abug class="abug" d="M0 0l-0 -8h6v16h-6z"/></g><rect data-gndb x="0" y="200" width="72" height="400" class="pfd-gnd"/></g></svg><div class="pfd-box"><b data-palt>0</b></div><small class="pfd-cap">ALT</small><small class="pfd-sub" data-pagl>AGL 0</small><div class="pfd-vsi"><i data-pvsi></i><small data-pvs>0</small></div></div>
      <div class="pfd-rose"><svg viewBox="-82 -82 164 164"><circle r="80" class="pfd-rose-bg"/><g data-rose>${rose.join('')}<path data-rbug d="M0 -80l-5 -0l0 -7h10l0 7z" class="pfd-bug"/><path data-rcrs d="M0 -50L-4 -42H4Z M0 50L-3 44H3Z" class="pfd-crs"/></g><path d="M0 -84l-6 -9h12z" class="pfd-lubber"/><path d="M0 -22L-8 10L0 5L8 10Z" class="pfd-plane"/></svg><b data-phdg>000°</b></div>
      <div class="pfd-flaps">
        <div class="pfd-lever" data-flever><span>Flaps</span><div class="pfd-lv-track" data-flvtrack></div><b data-pfflaps>UP</b></div>
        <div class="pfd-fl"><span>Trim</span><button type="button" data-pf="trimup" aria-label="Trim nose up">▲</button><div class="pfd-trimbar"><i data-pftrimi></i></div><b data-pftrim>0</b><button type="button" data-pf="trimdn" aria-label="Trim nose down">▼</button></div>
      </div>
      <div class="pfd-btns" role="toolbar" aria-label="Aircraft controls" aria-orientation="vertical">
        ${jet ? '<button type="button" class="pfd-dk" data-pf="gear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v7M8 10h8M12 10v3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/></svg><b data-pfgear>Down</b><span>Gear</span></button><button type="button" class="pfd-dk" data-pf="spoiler"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15l9-3 9 3M6 13.5l2.5-5M15.5 8.5l2.5 5"/></svg><b data-pfsp>In</b><span>Spoilers</span></button><button type="button" class="pfd-dk" data-pf="rev"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M9 8l-4 4 4 4M15 8l4 4-4 4"/></svg><b data-pfrev>Off</b><span>Reverse</span></button>' : ''}
        <button type="button" class="pfd-dk" data-pf="brake"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M4 8a9 9 0 0 1 3-3.5M20 8a9 9 0 0 0-3-3.5"/></svg><b>Hold</b><span>Brakes</span></button>
        <button type="button" class="pfd-dk" data-pf="park"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="3"/><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/></svg><b data-pfpark>Off</b><span>Park</span></button>
        <button type="button" class="pfd-dk" data-pf="lights"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg><b data-pflt>Off</b><span>Lights</span></button>
        <button type="button" class="pfd-dk pfd-ap" data-pf="appanel" aria-expanded="false"><b class="ap-t">A/P</b><span data-pfap>Off</span></button>
        <button type="button" class="pfd-dk" data-pf="gates"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="6" height="12" rx="1"/><rect x="14" y="6" width="6" height="12" rx="1"/></svg><b data-pfgt>Off</b><span>Gates</span></button>
        ${jet ? '' : '<button type="button" class="pfd-dk" data-pf="panel"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/></svg><b>Gauges</b><span>Panel</span></button>'}
      </div>
      <div class="pfd-thr" data-pfthr><span data-pfthrl>${jet ? 'THR' : 'PWR'}</span><div class="pfd-thr-track" title="Throttle: drag, or R and F"><i data-pfthrf></i><em data-pfthrn></em><b data-pfthrk></b></div><small data-pfthrv>0%</small></div>
    </div>`;
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
          <button type="button" class="sim-b" data-sixb aria-pressed="false" title="Instrument panel (I)"><svg viewBox="0 0 24 24"><circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/></svg><span>Panel</span></button>
          <button type="button" class="sim-b" data-ap aria-pressed="false" title="Autopilot (P)"><span>AP</span></button>
          <button type="button" class="sim-b" data-mapb aria-pressed="false" aria-label="Map" title="Map (O)"><svg viewBox="0 0 24 24"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/></svg></button>
          <button type="button" class="sim-b" data-gates aria-pressed="false" title="Route gates (G)"><svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="12" rx="1.5"/><rect x="9" y="9.5" width="6" height="5" rx="1"/></svg></button>
          <button type="button" class="sim-b" data-todb aria-label="Time of day" aria-expanded="false" title="Time of day"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg></button>
          <button type="button" class="sim-b" data-setb aria-label="Control settings" title="Controls (K)"><svg viewBox="0 0 24 24"><path d="M5 7h9M18 7h1M5 17h3M12 17h7"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button>
          <button type="button" class="sim-b" data-mute aria-label="Sound" title="Sound (M)"><svg viewBox="0 0 24 24"><path d="M4 9.5h4L13 5v14l-5-4.5H4z"/><path data-wave d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg></button>
          <button type="button" class="sim-b" data-pause aria-label="Pause" title="Pause (Space)"><svg viewBox="0 0 24 24"><path data-pp d="M8 5v14M16 5v14"/></svg></button>
          <button type="button" class="sim-b sim-x" data-exit aria-label="Leave the simulator" title="Leave (Esc)"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div>
      </header>
      <div class="sim-warn" data-warn role="status" aria-live="assertive"></div>
      <div class="sim-tod" data-tod hidden role="dialog" aria-label="Time of day">
        <div class="sim-tod-h"><div><span>Time of day</span><b data-todv>10:36</b></div><button type="button" class="sim-tod-x" data-todx aria-label="Close">×</button></div>
        <input type="range" min="0" max="1439" step="1" value="636" data-todr aria-label="Time of day, local solar time">
        <div class="sim-tod-scale" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
        <div class="sim-tod-p">${[['sunrise', 'Sunrise'], ['morning', 'Morning'], ['noon', 'Noon'], ['golden', 'Golden hour'], ['sunset', 'Sunset'], ['dusk', 'Dusk'], ['night', 'Night']].map(([k, l]) => `<button type="button" data-todp="${k}">${l}</button>`).join('')}</div>
        <small>Local solar time where you took off. The sun, sky, light and shadows follow it.</small>
      </div>
      <div class="sim-nmap" data-mini hidden role="region" aria-label="Map of your route"><canvas data-minic></canvas><button type="button" class="sim-nmap-x" data-minix aria-label="Hide the map">×</button><div class="sim-nmap-z"><button type="button" data-miniz="-1" aria-label="Zoom out">−</button><b data-minir>10 NM</b><button type="button" data-miniz="1" aria-label="Zoom in">+</button></div></div>
      <div class="sim-radio" data-radio hidden role="region" aria-label="Radio" aria-live="polite">
        <div class="sr-top"><span class="sr-k" data-rk>Radio · your call</span><button type="button" class="sr-x" data-rskip aria-label="Skip this call">Skip</button></div>
        <b data-rtitle></b><small data-rhint></small>
        <p class="sr-atc" data-ratc hidden></p>
        <p class="sr-said" data-rsaid hidden></p>
        <ul class="sr-res" data-rres hidden></ul>
        <div class="sr-row"><button type="button" class="sr-ptt" data-rptt><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg><span>Hold to talk</span><kbd>N</kbd></button><button type="button" class="sr-ex" data-rex>Example</button></div>
        <form class="sr-type" data-rtype hidden><input data-rin placeholder="Type your call and press Enter" autocomplete="off"><button>Send</button></form>
      </div>
      <div class="sim-set" data-set hidden role="dialog" aria-label="Control settings">
        <div class="sim-set-h"><b>Controls</b><button type="button" class="sim-b" data-setx aria-label="Close"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
        <label class="sim-set-r"><span>Sensitivity curve <small>more curve = finer control near centre</small></span><input type="range" min="0" max="85" data-cs="expo"></label>
        <label class="sim-set-r"><span>Pitch and roll rate <small>how fast the keys move the controls</small></span><input type="range" min="30" max="200" data-cs="keyRate"></label>
        <label class="sim-check"><input type="checkbox" data-cs="invert"> Invert pitch (push to climb)</label>
        <label class="sim-check"><input type="checkbox" data-cs="autoRudder"> Auto-rudder (coordinates turns and keeps you straight on the runway)</label>
        <label class="sim-check"><input type="checkbox" data-cs="centre"> Keys spring back to centre when released</label>
        <label class="sim-check"><input type="checkbox" data-cs="mouse"> Mouse yoke (move the mouse to fly; Shift-drag or right-drag to look around) <small>Y</small></label>
        <div class="sim-set-pad" data-padset>
          <b>Joystick, yoke or gamepad</b> <small data-padname>Move a control or press a button to wake it up.</small>
          <div class="sim-set-axes">${[['roll', 'Roll (ailerons)'], ['pitch', 'Pitch (elevator)'], ['yaw', 'Rudder'], ['thr', 'Throttle']].map(([k, l]) => `<label><span>${l}</span><select data-axis="${k}"></select><button type="button" class="sim-mini" data-detect="${k}">Detect</button><label class="sim-inv"><input type="checkbox" data-axinv="${k}"> Rev</label><i data-axbar="${k}"><b></b></i></label>`).join('')}</div>
        </div>
      </div>
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
        <div class="sim-sys" aria-label="Aircraft systems">
          <div class="sim-trim" title="Elevator trim (T / G)"><span>Trim</span><div><i data-trimi></i></div></div>
          <span class="sim-ind" data-ind="park" title="Parking brake (Shift+B)">PARK</span><span class="sim-ind" data-ind="brake" title="Brakes (B)">BRK</span>
          ${o.jet ? '' : '<span class="sim-ind" data-ind="carb" title="Carb heat (H)">CARB</span>'}<span class="sim-ind" data-ind="rud" title="Auto-rudder (U)">AUTO RUD</span>
          <span class="sim-rpm"><b data-rpm>0</b> rpm</span>
        </div>
      </div>
      ${pfdHTML(!!o.jet)}
      <canvas class="sim-six" data-six aria-hidden="true"></canvas>
      <div class="ap-panel" data-apbar hidden role="dialog" aria-label="Autopilot">
        <div class="ap-head"><b>Autopilot</b><button type="button" class="ap-master" data-apmaster aria-pressed="false"><i></i><span data-apms>Off</span></button><button type="button" class="ap-x" data-apclose aria-label="Close autopilot panel">×</button></div>
        <div class="ap-row ap-nav"><button type="button" class="ap-tog" data-apm="lnav" aria-pressed="false">LNAV</button><small>Steer along the route</small></div>
        <div class="ap-row ap-nav"><button type="button" class="ap-tog" data-apm="vnav" aria-pressed="false">VNAV</button><small>Climb and descend on the route’s profile</small></div>
        <div class="ap-row"><button type="button" class="ap-tog" data-apm="hdg" aria-pressed="false">HDG</button><button type="button" class="ap-st" data-apd="hdg" data-d="-5" aria-label="HDG down">−</button><b data-apv="hdg">—</b><button type="button" class="ap-st" data-apd="hdg" data-d="5" aria-label="HDG up">+</button></div>
        <div class="ap-row"><button type="button" class="ap-tog" data-apm="alt" aria-pressed="false">ALT</button><button type="button" class="ap-st" data-apd="alt" data-d="-500" aria-label="ALT down">−</button><b data-apv="alt">—</b><button type="button" class="ap-st" data-apd="alt" data-d="500" aria-label="ALT up">+</button></div>
        <div class="ap-row"><button type="button" class="ap-tog" data-apm="vs" aria-pressed="false">V/S</button><button type="button" class="ap-st" data-apd="vs" data-d="-100" aria-label="V/S down">−</button><b data-apv="vs">—</b><button type="button" class="ap-st" data-apd="vs" data-d="100" aria-label="V/S up">+</button></div>
        <div class="ap-row"><button type="button" class="ap-tog" data-apm="spd" aria-pressed="false">SPD</button><button type="button" class="ap-st" data-apd="spd" data-d="-5" aria-label="SPD down">−</button><b data-apv="spd">—</b><button type="button" class="ap-st" data-apd="spd" data-d="5" aria-label="SPD up">+</button></div>
        <small class="ap-note">Each mode flies one thing. Anything without a mode is yours: LNAV on its own steers while you fly the pitch and power. A firm stick input takes that axis back.</small>
      </div>
      <div class="sim-replay" data-replaybar hidden>
        <button type="button" class="sim-b" data-play aria-label="Play or pause"><svg viewBox="0 0 24 24"><path data-pp2 d="M8 5v14M16 5v14"/></svg></button>
        <div class="sim-speeds" role="group" aria-label="Replay speed">${[1, 2, 4, 8, 16, 32].map(x => `<button type="button" data-rate="${x}">${x}×</button>`).join('')}</div>
        <input type="range" min="0" max="1000" value="0" data-scrub aria-label="Position along the route">
        <span class="sim-time" data-time>0:00</span>
      </div>
      <div class="sim-touch" data-touch hidden>
        <div class="sim-stick" data-stick><i data-knob></i><span>Pull back to climb</span></div>
        <div class="sim-rud" data-rud aria-label="Rudder"><i data-rudk></i><span>Rudder</span></div>
        <div class="sim-tilt"><button type="button" class="sim-b" data-tilt>Tilt to steer</button>
          <div class="sim-tbtns"><button type="button" class="sim-b" data-flapd="-1" aria-label="Flaps up">Flaps −</button><button type="button" class="sim-b" data-flapd="1" aria-label="Flaps down">Flaps +</button>
          <button type="button" class="sim-b" data-trimb="1" aria-label="Trim nose up">Trim ▲</button><button type="button" class="sim-b" data-trimb="-1" aria-label="Trim nose down">Trim ▼</button>
          <button type="button" class="sim-b" data-brakeb>Brake</button><button type="button" class="sim-b" data-pbrake>Park</button></div></div>
        <div class="sim-thrslider"><span>Power</span><input type="range" min="0" max="100" value="70" data-thrrange aria-label="Throttle" orient="vertical"></div>
      </div>
      <div class="sim-card-wrap" data-cardwrap><div class="sim-card" data-card><div class="sim-load"><div class="sim-spin"></div><b>Loading terrain…</b><small>Real elevation data for your route.</small></div></div></div>`;
  }

  /* ================= open ================= */
  async function open(opts) {
    loadCSS();
    const cesiumP = loadCesium(); cesiumP.catch(() => { }); // download the 3D engine while the runways are worked out
    const old = document.getElementById('sim');
    if (old) { if (old.open) old.close(); old.removeAttribute('id'); setTimeout(() => old.remove(), 0); }
    const dlg = document.createElement('dialog'); dlg.id = 'sim'; dlg.setAttribute('aria-label', 'Flight simulator'); document.body.append(dlg);
    const O = Object.assign({ mode: 'replay', start: 'ground', title: 'Route', subtitle: '', points: [], wind: null, cruiseFt: 0, kind: 'track' }, opts);
    try { window.BoploJets?.install(); } catch { }
    O.jet = !!window.BoploAircraft?.isJet?.(O.aircraftId);
    dlg.innerHTML = `<div class="sim">${hudHTML(O)}</div>`;
    dlg.showModal();
    const root = dlg.querySelector('.sim'), $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    let alive = true, raf = 0, viewer = null;
    const coarse = matchMedia('(pointer: coarse)').matches;
    // graphics level. Fast: terrain and satellite imagery, no 3D city. Balanced: the photo-real 3D scenery at a lighter level of
    // detail and screen-resolution rendering. Detailed: full 3D detail, sharp on high-density screens, HDR and sun glare.
    const GFX = ['fast', 'balanced', 'detailed'].includes(O.gfx) ? O.gfx : 'fast';
    const SSE0 = GFX === 'detailed' ? (coarse ? 18 : 12) : (coarse ? 32 : 24), RES0 = GFX === 'detailed' && !coarse ? Math.min(1, 1.5 / (window.devicePixelRatio || 1)) : 1;
    const audio = engineAudio(O.jet);
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
    /* ---- runways at the departure and arrival airfields ---- */
    const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const unit = (a, b) => { const d = dist2(a, b) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
    const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
    const leftOf = v => [-v[1], v[0]];
    const windFrom = O.wind && O.wind.spd >= 5 ? O.wind.dir * D2R : null;
    // practice mode at any airport: { kind: 'takeoff' | 'circuit' | 'long' | 'short', end: runway end ident }
    const PR = O.practice || null, PRF = PR && (PR.kind === 'long' || PR.kind === 'short');
    // runway positions from OpenStreetMap (traced from imagery), which line up with the scenery far better than
    // OurAirports' runway ends; cached on the server and in the browser, with a short timeout so loading never waits long
    // a lookup the simulator page started early is reused; otherwise wait up to 12 s on a first visit
    const osmFor = ap => { const c = osmCached(ap.code); if (c) return Promise.resolve(c); return Promise.race([fetchOSM(ap), new Promise(res => setTimeout(() => res([]), 12000))]); };
    const normId = id => String(id || '').toUpperCase().trim().replace(/^0+(?=\d)/, '');
    // the centreline of an OSM runway: a line way end to end, or the long axis of a runway drawn as an area
    const osmAxis = o => {
      const q = o.pts.map(([la, ln]) => F.to(la, ln));
      if (!o.area) return { A: q[0], B: q[q.length - 1], wid: o.width };
      const v = q.slice(0, -1), n = v.length, cx = v.reduce((a, p) => a + p[0], 0) / n, cz = v.reduce((a, p) => a + p[1], 0) / n;
      let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of v) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
      const th = .5 * Math.atan2(2 * sxz, sxx - szz), d = [Math.cos(th), Math.sin(th)], pr = v.map(([x, z]) => (x - cx) * d[0] + (z - cz) * d[1]), wd = v.map(([x, z]) => -(x - cx) * d[1] + (z - cz) * d[0]);
      const lo = Math.min(...pr), hi = Math.max(...pr);
      return { A: [cx + d[0] * lo, cz + d[1] * lo], B: [cx + d[0] * hi, cz + d[1] * hi], wid: o.width || (Math.max(...wd) - Math.min(...wd)) };
    };
    function alignToOSM(list, osm, ap) {
      const ax = osm.map(o => ({ o, ...osmAxis(o), ids: String(o.ref || '').toUpperCase().split(/[\/\-]/).map(normId).filter(Boolean), raw: String(o.ref || '').toUpperCase().split(/[\/\-]/).map(x => x.trim()).filter(Boolean) })).filter(a => dist2(a.A, a.B) > 120);
      const used = new Set();
      for (const rw of list) {
        const dir = unit(rw.A, rw.B), mid = add(rw.A, dir, rw.len / 2);
        let best = null, bs = Infinity;
        for (const a of ax) {
          if (used.has(a)) continue;
          const ad = unit(a.A, a.B), ang = Math.acos(clamp(Math.abs(ad[0] * dir[0] + ad[1] * dir[1]), 0, 1)) * R2D, am = add(a.A, ad, dist2(a.A, a.B) / 2), md = dist2(am, mid);
          const refOK = a.ids.includes(normId(rw.le)) && a.ids.includes(normId(rw.he));
          if (ang > (refOK ? 20 : 10) || md > (refOK ? 1200 : 600)) continue;
          const sc = md + ang * 40 - (refOK ? 800 : 0); if (sc < bs) { bs = sc; best = a; }
        }
        if (!best) continue;
        used.add(best);
        const [A, B] = dist2(best.A, rw.A) <= dist2(best.B, rw.A) ? [best.A, best.B] : [best.B, best.A];
        rw.A = A; rw.B = B; rw.len = dist2(A, B); if (best.wid > 5) rw.wid = clamp(best.wid, 10, 75); rw.osm = true; rw.approx = 0;
      }
      // a runway OSM knows about that the runway list doesn't (common at small strips): add it from its ref
      if (!list.length) for (const a of ax) {
        if (used.has(a) || a.ids.length < 2) continue;
        const hdgAB = norm360(Math.atan2(a.B[0] - a.A[0], a.B[1] - a.A[1]) * R2D), n1 = parseInt(a.ids[0], 10) * 10;
        const [A, B] = Number.isFinite(n1) && Math.abs(wrap180(hdgAB - n1)) > 90 ? [a.B, a.A] : [a.A, a.B], len = dist2(A, B), surf = /grass|turf|ground|dirt|earth/.test(a.o.surface) ? 'grass' : a.o.surface ? 'asphalt' : 'grass';
        list.push({ A, B, len, wid: clamp(a.wid || (PAVED(surf) ? 23 : 18), 10, 75), le: a.raw[0], he: a.raw[1], surf, lit: 0, leD: 0, heD: 0, approx: 0, osm: true, code: ap.code });
      }
    }
    async function airportRunways(ap) {
      if (!ap || !Number.isFinite(ap.lat)) return null;
      const C0 = F.to(ap.lat, ap.lng), [all, osm] = await Promise.all([loadRunways(ap.cc), osmFor(ap)]), rows = all[ap.code] || [];
      const list = rows.map(r => { const A = F.to(r[2], r[3]), B = F.to(r[4], r[5]), len = dist2(A, B); return len < 120 ? null : { A, B, len, wid: clamp(r[7] || (PAVED(r[8]) ? (len > 1800 ? 45 : len > 1100 ? 30 : 23) : 18), 10, 75), le: r[0], he: r[1], surf: r[8], lit: r[9], leD: r[10] || 0, heD: r[11] || 0, approx: r[12], code: ap.code }; }).filter(Boolean);
      try { if (osm?.length) alignToOSM(list, osm, ap); } catch (e) { console.warn('osm runways', e); }
      return { ap, C0, list };
    }
    const [depR, arrR0] = await Promise.all([airportRunways(O.depAirport), O.arrAirport && O.depAirport && O.arrAirport.code === O.depAirport.code ? null : airportRunways(O.arrAirport)]);
    const arrR = arrR0 || depR;
    const nearAp = (R0, p, m = 3500) => R0 && dist2(R0.C0, p) < m;
    const depOn = nearAp(depR, P[0]) && O.start !== 'air', arrOn = O.land !== false && nearAp(arrR, P[P.length - 1]);
    // a made-up grass strip when an airfield has no published runway, laid along the way you'll go
    const stripFor = (R0, hdg) => { const f = [Math.sin(hdg), Math.cos(hdg)]; const A = add(R0.C0, f, -275), B = add(R0.C0, f, 275); const r = { A, B, len: 550, wid: 18, le: '', he: '', surf: 'grass', leD: 0, heD: 0, approx: 2, code: R0.ap.code }; R0.list.push(r); return r; };
    const endsOf = rw => [{ rw, T: rw.A, far: rw.B, disp: rw.leD, id: rw.le }, { rw, T: rw.B, far: rw.A, disp: rw.heD, id: rw.he }].map(e => ({ ...e, dir: unit(e.T, e.far), hdg: Math.atan2(e.far[0] - e.T[0], e.far[1] - e.T[1]) }));
    // best runway end: into a real wind, otherwise lined up with where the route goes, preferring long paved runways
    function pickEnd(R0, want, force) {
      if (!R0.list.length) stripFor(R0, want ?? windFrom ?? 0);
      let best = null, bs = -Infinity;
      for (const rw of R0.list) for (const e of endsOf(rw)) {
        const head = windFrom != null ? Math.cos(windFrom - e.hdg) * O.wind.spd : 0;
        const align = want != null ? Math.cos(wrap180((want - e.hdg) * R2D) * D2R) : 0;
        const sc = (windFrom != null ? head * 3 : 0) + align * 6 + Math.min(rw.len, 2500) / 1000 + (PAVED(rw.surf) ? 1 : 0) - (rw.approx ? .5 : 0) + (PR?.end && e.id === PR.end ? 100 : 0) + (force && e.id === force ? 200 : 0);
        if (sc > bs) { bs = sc; best = e; }
      }
      return best;
    }
    const bearing = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
    let depE = null, arrE = null, rwys = [], rollEnd = 0, miniAps = [];
    const circuitLike = span < 6000 && (!arrR || !depR || arrR === depR);
    if (depOn || arrOn) {
      if (circuitLike && depOn) {
        // circuits or a short local flight: a standard left-hand circuit off the real runway
        const e = pickEnd(depR, P.length > 1 ? bearing(P[0], P.find(p => dist2(p, P[0]) > 800) || P[1]) : null, O.depEnd || O.arrEnd);
        depE = arrE = e; const f = e.dir, l = leftOf(f), at = (a, b) => add(add(e.T, f, a), l, b), Ln = e.rw.len;
        const td = Math.max(e.disp, 0);
        P = [at(25, 0), at(Ln, 0), at(Ln + 800, 0), at(Ln + 1150, 380), at(Ln + 1150, 1000), at(-900, 1000), at(-1350, 560), at(-1300, 0), at(td, 0), at(Ln - 60, 0)];
        synthetic = true; rollEnd = Ln - 60 - td;
      } else {
        const outbound = depOn ? (P.find(p => dist2(p, depR.C0) > 2500) || P[P.length - 1]) : null;
        if (depOn) depE = pickEnd(depR, outbound && dist2(outbound, depR.C0) > 1000 ? bearing(depR.C0, outbound) : null, O.depEnd);
        const inbound = arrOn ? ([...P].reverse().find(p => dist2(p, arrR.C0) > 3500) || P[0]) : null;
        if (arrOn) arrE = pickEnd(arrR, inbound && dist2(inbound, arrR.C0) > 1000 ? bearing(inbound, arrR.C0) : null, O.arrEnd);
        const clearDep = depE ? depE.rw.len + 1800 : 0, clearArr = arrE ? 6000 : 0;
        let mid = P.filter(p => (!depE || dist2(p, depR.C0) > clearDep) && (!arrE || dist2(p, arrR.C0) > clearArr));
        const out = [];
        if (depE) out.push(add(depE.T, depE.dir, 25), depE.far, add(depE.far, depE.dir, 1800));
        else out.push(P[0]);
        out.push(...mid);
        if (arrE) {
          const f = arrE.dir, Ta = add(arrE.T, f, Math.max(arrE.disp, 0)), FA = add(Ta, f, -5500), last = out[out.length - 1];
          const inc = unit(last, FA), turn = Math.acos(clamp(inc[0] * f[0] + inc[1] * f[1], -1, 1)) * R2D;
          // already established on the extended centreline (a practice final): fly straight in
          const back = (Ta[0] - last[0]) * f[0] + (Ta[1] - last[1]) * f[1], lat = Math.abs((last[0] - Ta[0]) * f[1] - (last[1] - Ta[1]) * f[0]);
          if (back > 1200 && back < 6500 && lat < 400) { out.push(Ta, add(arrE.far, f, -60)); rollEnd = arrE.rw.len - 60 - Math.max(arrE.disp, 0); }
          else { if (turn > 65) { const l = leftOf(f), side = Math.sign((last[0] - Ta[0]) * l[0] + (last[1] - Ta[1]) * l[1]) || 1; out.push(add(add(Ta, f, -2500), l, side * 3200), add(add(Ta, f, -7000), l, side * 1500)); }
          out.push(FA, Ta, add(arrE.far, f, -60)); rollEnd = arrE.rw.len - 60 - Math.max(arrE.disp, 0); }
        } else out.push(P[P.length - 1]);
        P = out.filter((p, i, a) => !i || dist2(p, a[i - 1]) > 15);
      }
      rwys = [...new Set([...(depR?.list || []), ...(arrR?.list || [])])];
    } else if (P.length < 2 || span < 400) { P = circuitAround(P[0], (O.runwayHdg || 0) * D2R); synthetic = true; }
    // circuits and local tracks: start along the first stretch of the route
    const path = buildPath(P);
    const circuit = (circuitLike || synthetic) && !(PR && PR.kind !== 'circuit');
    const L = path.len;

    /* ---- 3D scenery (CesiumJS) ---- */
    let C;
    try { C = await cesiumP; } catch (e) { fail(e.message); wireX(); return { close: destroy }; }
    if (!alive) return { close: destroy };
    const startLL = F.ll(P[0][0], P[0][1]);
    try {
      viewer = new C.CesiumWidget($('[data-map]'), {
        baseLayer: false, skyAtmosphere: new C.SkyAtmosphere(), shadows: !coarse, terrainShadows: C.ShadowMode.RECEIVE_ONLY, useDefaultRenderLoop: false,
        useBrowserRecommendedResolution: GFX !== 'detailed' || !!coarse, msaaSamples: coarse ? 1 : GFX === 'detailed' ? 4 : 2, creditContainer: $('[data-credits]'), requestRenderMode: false
      });
    } catch (e) { fail('Your browser couldn’t start 3D graphics (WebGL). Try an up-to-date Chrome, Edge or Safari.'); wireX(); return { close: destroy }; }
    const scene = viewer.scene, camera = scene.camera;
    scene.screenSpaceCameraController.enableInputs = false;
    scene.postProcessStages.fxaa.enabled = true;
    // render sharp on high-density screens (capped for speed), with high dynamic range so the sun, sky and paint read like a photo
    // high dynamic range with Khronos' neutral tone mapper: bright sky reflections on the paint stay bright without washing out
    if (!coarse && GFX !== 'fast') { try { scene.highDynamicRange = true; if (C.Tonemapper?.PBR_NEUTRAL != null) scene.postProcessStages.tonemapper = C.Tonemapper.PBR_NEUTRAL; } catch { } }
    scene.fog.enabled = true; scene.fog.density = 1.6e-4; scene.fog.minimumBrightness = .25;
    camera.frustum.fov = C.Math.toRadians(66); camera.frustum.near = .5;
    // ---- time of day: the sun, sky, light on the scenery and fog all follow one clock you can move during the flight ----
    // local solar time at the departure airfield; the presets on the sim page set the starting hour
    const TOD = O.time || 'day';
    const SUN = (() => { const d = new Date(), N = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); return { day0: (d.setUTCHours(0, 0, 0, 0), d.getTime()), dec: 23.44 * Math.sin(2 * Math.PI * (284 + N) / 365) * D2R, lat: startLL[1] * D2R }; })();
    const sunElev = h => Math.asin(Math.sin(SUN.lat) * Math.sin(SUN.dec) + Math.cos(SUN.lat) * Math.cos(SUN.dec) * Math.cos((h - 12) * 15 * D2R)) * R2D;
    // the hour (morning or evening) when the sun is at a given elevation
    const hourFor = (elev, pm = true) => { const c = (Math.sin(elev * D2R) - Math.sin(SUN.lat) * Math.sin(SUN.dec)) / (Math.cos(SUN.lat) * Math.cos(SUN.dec)); const a = Math.acos(clamp(c, -1, 1)) * R2D / 15; return pm ? 12 + a : 12 - a; };
    const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1), lerp3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
    // ---- cinematic light, keyed by sun elevation (night, blue hour, sunset, golden hour, day). Each key sets:
    // L scenery light · sky shift [brightness, saturation, hue] · haze colour · haze distance (m) · grade gain · grade lift
    // · contrast · saturation · vignette · sunlight colour · sunlight intensity · reflections [diffuse, specular] · sun glow · bloom
    const KEYS = [
      { e: -14, L: [.1, .12, .22], S: [-.88, -.3, 0], hz: [.03, .04, .08], hz2: [.03, .04, .08], hd: 9000, g: [.82, .9, 1.12], lf: [0, .01, .03], c: 1.08, sat: .8, v: .55, lc: [.55, .65, 1], li: .25, ibl: [.12, .35], sg: 0, bl: -.2, sk: 0 },
      { e: -6, L: [.3, .29, .42], S: [-.5, 0, 0], hz: [.6, .4, .42], hz2: [.2, .2, .33], hd: 15000, g: [.95, .93, 1.05], lf: [.02, 0, .04], c: 1.1, sat: .95, v: .5, lc: [.75, .6, .8], li: .5, ibl: [.3, .6], sg: .6, bl: -.25, sk: .5 },
      { e: -1, L: [.6, .47, .44], S: [-.08, 0, 0], hz: [1, .6, .4], hz2: [.42, .4, .55], hd: 22000, g: [1.06, .97, .9], lf: [.02, 0, .03], c: 1.12, sat: 1.05, v: .48, lc: [1, .6, .38], li: 1.5, ibl: [.45, .9], sg: 3, bl: -.2, sk: .8 },
      { e: 5, L: [.9, .8, .68], S: [-.02, .04, 0], hz: [1, .78, .58], hz2: [.62, .66, .78], hd: 28000, g: [1.06, 1, .92], lf: [.012, 0, .015], c: 1.1, sat: 1.08, v: .4, lc: [1, .78, .55], li: 1.8, ibl: [.6, 1], sg: 2, bl: -.28, sk: .4 },
      { e: 18, L: [1, 1, 1], S: [0, .04, 0], hz: [.85, .85, .88], hz2: [.72, .8, .93], hd: 45000, g: [1, 1, 1], lf: [0, 0, 0], c: 1.06, sat: 1.06, v: .26, lc: [1, .98, .95], li: 2, ibl: [1, 1], sg: 1, bl: -.4, sk: 0 }
    ];
    const mix = (a, b, t) => Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], t)) : lerp(a, b, t);
    const lightAt = e => { if (e <= KEYS[0].e) return KEYS[0]; for (let i = 1; i < KEYS.length; i++) if (e <= KEYS[i].e) { const A = KEYS[i - 1], B = KEYS[i], t = (e - A.e) / (B.e - A.e), o = {}; for (const k of Object.keys(A)) o[k] = mix(A[k], B[k], t); return o; } return KEYS[KEYS.length - 1]; };
    const sky = { hour: TOD === 'night' ? hourFor(-16) : TOD === 'golden' ? hourFor(6) : 10.6, elev: 45, L: [1, 1, 1], dark: false, dim: false };
    let LIGHT = [1, 1, 1], starBox = null, flare = null, tintShader = null, grade = null, rwStRef = () => [];
    if (!coarse && GFX === 'detailed') { try { flare = C.PostProcessStageLibrary.createLensFlareStage(); Object.assign(flare.uniforms, { intensity: .7, distortion: 1.4, ghostDispersal: .32, haloWidth: .32, dirtAmount: 0, earthRadius: C.Ellipsoid.WGS84.maximumRadius }); scene.postProcessStages.add(flare); } catch (e) { console.warn('flare', e); flare = null; } }
    // colour grade over the whole frame: warm gain and lifted shadows at sunset, filmic contrast, a soft vignette
    try {
      grade = scene.postProcessStages.add(new C.PostProcessStage({ name: 'boplo_grade', uniforms: { u_gain: new C.Cartesian3(1, 1, 1), u_lift: new C.Cartesian3(0, 0, 0), u_con: 1.06, u_sat: 1.08, u_vig: .28, u_sky: 0 },
        // the open sky (nothing in the depth buffer) is recoloured at dawn and dusk: Cesium's scattering goes teal at low sun,
        // so its brightness is mapped onto a sunset palette, deep blue overhead through rose to orange and gold at the horizon
        fragmentShader: `uniform sampler2D colorTexture; uniform sampler2D depthTexture; uniform vec3 u_gain; uniform vec3 u_lift; uniform float u_con; uniform float u_sat; uniform float u_vig; uniform float u_sky; in vec2 v_textureCoordinates;
          vec3 pal(float t) { t = clamp(t, 0.0, 1.0); vec3 a = vec3(0.12, 0.17, 0.4), b = vec3(0.55, 0.36, 0.58), c = vec3(1.0, 0.56, 0.36), d = vec3(1.0, 0.86, 0.62);
            return t < 0.35 ? mix(a, b, t / 0.35) : t < 0.7 ? mix(b, c, (t - 0.35) / 0.35) : mix(c, d, (t - 0.7) / 0.3); }
          void main() { vec4 c = texture(colorTexture, v_textureCoordinates); vec3 base = c.rgb;
            if (u_sky > 0.0) { float dep = czm_readDepth(depthTexture, v_textureCoordinates); if (dep >= 0.9999) { float l = dot(base, vec3(0.3, 0.5, 0.2)); base = mix(base, pal(pow(l, 1.4) * 1.15) * (0.6 + 0.6 * l), u_sky); } }
            vec3 col = base * u_gain + u_lift * (1.0 - base);
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(vec3(l), col, u_sat);
            col = (col - 0.5) * u_con + 0.5; vec2 d = v_textureCoordinates - 0.5; col *= clamp(1.0 - u_vig * dot(d, d) * 2.2, 0.0, 1.0);
            out_FragColor = vec4(clamp(col, 0.0, 1.0), c.a); }` }));
    } catch (e) { console.warn('grade', e); grade = null; }
    // a light bloom so the sun and lit cloud edges glow (skipped on phones and the fast setting)
    const bloom = !coarse && GFX !== 'fast' ? scene.postProcessStages.bloom : null;
    if (bloom) { try { bloom.enabled = true; Object.assign(bloom.uniforms, { glowOnly: false, contrast: 119, brightness: -.4, delta: .9, sigma: 3.2, stepSize: 1 }); } catch { } }
    try { const sa = scene.skyAtmosphere; if (sa) sa.perFragmentAtmosphere = true; if (scene.atmosphere && C.DynamicAtmosphereLightingType) scene.atmosphere.dynamicLighting = C.DynamicAtmosphereLightingType.SUNLIGHT; } catch { }
    const C3 = a => new C.Cartesian3(a[0], a[1], a[2]);
    function applyTime(h) {
      sky.hour = ((h % 24) + 24) % 24; const e = sunElev(sky.hour); sky.elev = e;
      viewer.clock.currentTime = C.JulianDate.fromDate(new Date(SUN.day0 + (sky.hour - startLL[0] / 15) * 3600e3)); viewer.clock.shouldAnimate = false;
      const K = lightAt(e), L = K.L; LIGHT = L; sky.L = L; sky.dark = e < -7; sky.dim = e < 4;
      const avg = (L[0] + L[1] + L[2]) / 3;
      try { const sa = scene.skyAtmosphere; if (sa) { sa.brightnessShift = K.S[0]; sa.saturationShift = K.S[1]; sa.hueShift = K.S[2]; sa.atmosphereMieCoefficient = new C.Cartesian3(21e-6 * (1 + K.sg * .5), 21e-6 * (1 + K.sg * .5), 21e-6 * (1 + K.sg * .5)); sa.atmosphereMieAnisotropy = .9 + K.sg * .02; } } catch { }
      try { scene.sun.show = true; scene.sun.glowFactor = Math.max(.6, K.sg); } catch { }
      // stars once the sky is dark enough
      try { if (sky.dark && !starBox && C.SkyBox.createEarthSkyBox) starBox = C.SkyBox.createEarthSkyBox(); if (starBox) { scene.skyBox = starBox; starBox.show = e < -5; } } catch { }
      scene.backgroundColor = C.Color.fromCssColorString(e < -8 ? '#04060d' : e < -3 ? '#0d1530' : '#5E93D8');
      // sunlight on the aircraft and our own models: warm and low at sunset, blue and faint at night
      try { scene.light.color = new C.Color(K.lc[0], K.lc[1], K.lc[2], 1); scene.light.intensity = K.li; } catch { }
      if (model) { try { model.color = C.Color.WHITE; if (model.imageBasedLighting) model.imageBasedLighting.imageBasedLightingFactor = new C.Cartesian2(K.ibl[0], K.ibl[1]); } catch { } }
      if (scene.shadowMap) scene.shadowMap.darkness = lerp(.2, .55, (e + 6) / 8) - (e > 12 ? .15 : 0);
      // the photo scenery has the sun baked in: tint it, and fade the distance into a coloured haze (warm at sunset, blue by day)
      const hazeD = Math.min(K.hd, typeof visM === 'number' ? visM * 1.1 : K.hd);
      try { if (tileset) {
        if (!tintShader) { tintShader = new C.CustomShader({ uniforms: { u_light: { type: C.UniformType.VEC3, value: C3(L) }, u_haze: { type: C.UniformType.VEC3, value: C3(K.hz) }, u_haze2: { type: C.UniformType.VEC3, value: C3(K.hz2) }, u_hk: { type: C.UniformType.FLOAT, value: 1 / hazeD } },
          fragmentShaderText: 'void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) { vec3 p = fsInput.attributes.positionEC; float d = length(p); float h = clamp(1.0 - exp(-d * u_hk), 0.0, 0.8); float s = pow(max(dot(p / max(d, 1.0), czm_sunDirectionEC), 0.0), 3.0); material.diffuse = mix(material.diffuse * u_light, mix(u_haze2, u_haze, s), h); }' }); tileset.customShader = tintShader; }
        else { tintShader.setUniform('u_light', C3(L)); tintShader.setUniform('u_haze', C3(K.hz)); tintShader.setUniform('u_haze2', C3(K.hz2)); tintShader.setUniform('u_hk', 1 / hazeD); } } } catch (e2) { console.warn('tint', e2); }
      if (!tileset) { const L0 = scene.imageryLayers.get(0); if (L0) { L0.brightness = Math.max(.15, avg); } scene.globe.enableLighting = e < 15; }
      scene.fog.minimumBrightness = lerp(.05, .3, (e + 8) / 14);
      if (grade) { const u = grade.uniforms; u.u_gain = C3(K.g); u.u_lift = C3(K.lf); u.u_con = K.c; u.u_sat = K.sat; u.u_vig = K.v; u.u_sky = K.sk; }
      if (bloom) { try { bloom.uniforms.brightness = K.bl; } catch { } }
      if (flare) flare.enabled = e > -1;
      // clouds: lit warm from below at sunset, dim at dusk, near-black at night
      try { const cc = new C.Color(Math.min(1, K.lc[0] * .5 + L[0] * .6), Math.min(1, K.lc[1] * .5 + L[1] * .55), Math.min(1, K.lc[2] * .5 + L[2] * .55), 1); for (const c of cloudCells) { c.c.brightness = clamp(avg * 1.05, .08, 1.05); c.c.color = cc; } } catch { }
      // runway surfaces are drawn by us, so they take the light directly (the first call comes before they exist)
      try { for (const r of rwStRef()) { const m = r.prim?.appearance?.material; if (m) m.uniforms.color = new C.Color(L[0], L[1], L[2], 1); } } catch { }
      dlg.dataset.tod = e < -6 ? 'night' : e < 10 ? 'golden' : 'day';
      const tl = $('[data-todv]'); if (tl) tl.textContent = `${String(Math.floor(sky.hour)).padStart(2, '0')}:${String(Math.floor(sky.hour % 1 * 60)).padStart(2, '0')}`;
      const tr = $('[data-todr]'); if (tr && document.activeElement !== tr) tr.value = Math.round(sky.hour * 60);
    }
    if (scene.shadowMap) { scene.shadowMap.size = GFX === 'detailed' ? 2048 : 1024; scene.shadowMap.maximumDistance = 350; scene.shadowMap.softShadows = GFX === 'detailed'; scene.shadowMap.darkness = .4; }
    // keep the scene rendering while things load
    let pumping = true; (function pump() { if (!alive || !pumping) return; try { viewer.resize(); viewer.render(); } catch { } requestAnimationFrame(pump); })();
    const LLH = (x, z, h) => { const [lng, lat] = F.ll(x, z); return C.Cartesian3.fromDegrees(lng, lat, h); };
    const carto = (x, z) => { const [lng, lat] = F.ll(x, z); return C.Cartographic.fromDegrees(lng, lat); };
    // look at the departure while scenery loads
    camera.setView({ destination: LLH(P[0][0] - Math.sin(path.at(80)[2]) * 400, P[0][1] - Math.cos(path.at(80)[2]) * 400, (O.fromElevFt || 0) * FT + 250), orientation: { heading: path.at(80)[2], pitch: C.Math.toRadians(-22), roll: 0 } });

    let tileset = null, scenery = 'globe';
    if (O.googleKey && GFX !== 'fast') {
      try {
        tileset = await C.createGooglePhotorealistic3DTileset({ key: O.googleKey, onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: SSE0, dynamicScreenSpaceError: true, dynamicScreenSpaceErrorFactor: 18, foveatedScreenSpaceError: true, cacheBytes: 640 * 1024 * 1024, skipLevelOfDetail: true, shadows: C.ShadowMode.RECEIVE_ONLY });
        scene.primitives.add(tileset); scene.globe.show = false; scenery = 'google';
        let failed = 0; tileset.tileFailed.addEventListener(() => failed++);
        const ok = await Promise.race([new Promise(r => tileset.initialTilesLoaded.addEventListener(() => r(true))), new Promise(r => setTimeout(() => r(false), 14000))]);
        if (!ok && failed > 0) throw new Error('Google 3D tiles failed to load');
      } catch (e) { if (tileset) { try { scene.primitives.remove(tileset); } catch { } } tileset = null; scene.globe.show = true; scenery = 'globe'; console.warn('Google 3D tiles unavailable', e); }
    }
    if (!tileset) {
      scene.terrainProvider = terrariumTerrain(C);
      // satellite imagery draped on the terrain: Google's 2D satellite tiles when a Maps key is configured (sharp at airport
      // level), otherwise Sentinel-2 cloudless (10 m pixels)
      let gsat = null;
      if (O.googleKey) { try { const r = await Promise.race([fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(O.googleKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' }) }), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 6000))]); const j = r.ok ? await r.json() : null; if (j?.session) gsat = j.session; } catch (e) { console.warn('satellite tiles', e); } }
      if (gsat) scene.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${gsat}&key=${encodeURIComponent(O.googleKey)}`, tilingScheme: new C.WebMercatorTilingScheme(), maximumLevel: 19, credit: new C.Credit('Imagery © Google · Terrain: AWS Terrain Tiles') }));
      else scene.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: IMG, tilingScheme: new C.WebMercatorTilingScheme(), maximumLevel: 14, credit: new C.Credit('Imagery: Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0 · Terrain: AWS Terrain Tiles') }));
      const g = scene.globe; g.depthTestAgainstTerrain = true; g.showGroundAtmosphere = true; g.maximumScreenSpaceError = 2; g.tileCacheSize = 600; g.preloadSiblings = true; g.enableLighting = false;
    }
    root.classList.toggle('is-google', scenery === 'google');
    // light level: tint the photo scenery (it has its own baked lighting) and the imagery for dusk and night
    // visibility and cloud from the weather (METAR or a preset)
    const WX = O.weather || {};
    const visM = clamp(WX.visM || 30000, 800, 60000);
    scene.fog.density = clamp(2.4 / visM, 5e-5, 2.2e-3);
    // objects the ground sampler must ignore. Points, lines and labels are picked as their own items, not as their
    // collection, so each one is tagged with UI and the tag is excluded too.
    const UI = 'boplo-sim-ui', exclude = [UI];
    const tagged = col => { const a = col.add.bind(col); col.add = (o = {}) => a({ id: UI, ...o }); return col; };
    const cloudLayers = (WX.clouds || []).filter(c => /FEW|SCT|BKN|OVC|VV/.test(c.cover) && Number.isFinite(+c.base)).slice(0, 3);
    let cloudCol = null; const cloudCells = [];
    try {
      if (cloudLayers.length && C.CloudCollection) {
        cloudCol = scene.primitives.add(new C.CloudCollection({ noiseDetail: 16, noiseOffset: new C.Cartesian3(Math.random() * 100, 0, 0) }));
        const R = 9000, per = { FEW: 10, SCT: 28, BKN: 60, OVC: 110, VV: 110 };
        for (const L of cloudLayers) {
          const n = Math.round(Math.min(110, per[L.cover] || 20) * (GFX === 'detailed' ? 1 : .6)), base = (+L.base) * FT;
          for (let i = 0; i < n; i++) {
            // each cloud is a cluster of smaller puffs: the procedural clouds stay crisp at this size
            const a = Math.random() * 2 * Math.PI, rr = Math.sqrt(Math.random()) * R, cw = (L.cover === 'OVC' ? 1400 : 600) + Math.random() * 700, np = GFX === 'detailed' ? (L.cover === 'OVC' ? 4 : 3) : 2;
            for (let j = 0; j < np; j++) {
              const w = cw * (.38 + Math.random() * .22), h = w * (.5 + Math.random() * .3), ox = (Math.random() - .5) * cw * .75, oz = (Math.random() - .5) * cw * .45, oy = (Math.random() - .3) * h * .35;
              cloudCells.push({ dx: Math.cos(a) * rr + ox, dz: Math.sin(a) * rr + oz, base: base + oy, w, h, c: cloudCol.add({ position: C.Cartesian3.ZERO, scale: new C.Cartesian2(w, h), maximumSize: new C.Cartesian3(26 + Math.random() * 10, 12 + Math.random() * 8, 18), slice: .32 + Math.random() * .22, brightness: TOD === 'night' ? .12 : TOD === 'golden' ? .9 : 1.05, color: TOD === 'golden' ? C.Color.fromCssColorString('#ffd9b8') : C.Color.WHITE }) });
            }
          }
        }
        exclude.push(cloudCol);
      }
    } catch (e) { console.warn('clouds', e); cloudCol = null; }
    // clouds stay in a ring around the aircraft: ones that fall behind wrap round to the far side
    let cloudT = 99;
    const updateClouds = () => {
      if (!cloudCol) return; const R = 9000;
      for (const k of cloudCells) {
        let x = k.x ?? st.x + k.dx, z = k.z ?? st.z + k.dz; const dx = x - st.x, dz = z - st.z;
        if (Math.abs(dx) > R) x -= Math.sign(dx) * 2 * R; if (Math.abs(dz) > R) z -= Math.sign(dz) * 2 * R;
        if (x !== k.x || z !== k.z) { k.x = x; k.z = z; const gh = elevAt(x, z) ?? g0; k.c.position = LLH(x, z, Math.max(k.base + g0, gh + 150) + k.h * .45); }
      }
    };

    // aircraft
    const AC = window.BoploAircraft ? BoploAircraft.build(O.aircraftId, O.livery) : aircraftGLB();
    if (AC.load) { try { await AC.load(); } catch (e) { console.warn('aircraft model', e); } }
    const glbUrl = URL.createObjectURL(new Blob([AC.glb || new Uint8Array(0)], { type: 'model/gltf-binary' }));
    cleanups.push(() => URL.revokeObjectURL(glbUrl));
    if (AC.credit) try { viewer.creditDisplay.addStaticCredit(new C.Credit('<a href="https://github.com/FGMEMBERS" target="_blank" rel="noopener">' + AC.credit + '</a>', true)); } catch { }
    const PF = window.BoploAircraft ? BoploAircraft.model(O.aircraftId) : { vs: 47, vr: 55, appr: 62, cruise: 98, vmax: 115, thrust: 2.645, drag: .0002 };
    AC.groundAtt = AC.groundAtt || 0;
    let model = null, bladeNode = null, discNode = null, gearNode = null, gearShown = 1; const surfNodes = {}, surfAng = {};
    try {
      // reflections: a live environment map of the sky and ground around the aircraft, so the clear-coated paint and glass
      // mirror the real sky (and the sunset) as it flies
      const envOpts = { enabled: true, maximumPositionEpsilon: 2000, maximumSecondsDifference: 600, brightness: 1.05, saturation: 1, groundAlbedo: .3, groundColor: new C.Color(.3, .32, .27, 1) };
      try { model = await C.Model.fromGltfAsync({ url: glbUrl, shadows: coarse ? C.ShadowMode.DISABLED : C.ShadowMode.CAST_ONLY, forwardAxis: C.Axis.Z, upAxis: C.Axis.Y, environmentMapOptions: envOpts }); }
      catch { model = await C.Model.fromGltfAsync({ url: glbUrl, shadows: coarse ? C.ShadowMode.DISABLED : C.ShadowMode.CAST_ONLY, forwardAxis: C.Axis.Z, upAxis: C.Axis.Y }); }
      scene.primitives.add(model);
      model.readyEvent.addEventListener(() => { bladeNode = model.getNode('blades'); discNode = model.getNode('disc'); gearNode = model.getNode('gear'); for (const k of Object.keys(AC.surfaces || {})) { const n = model.getNode(k); if (n) surfNodes[k] = n; } });
    } catch (e) { console.warn('aircraft model', e); }
    applyTime(sky.hour);
    const lights = tagged(scene.primitives.add(new C.PointPrimitiveCollection()));
    const navL = lights.add({ color: C.Color.fromCssColorString('#ff3344'), pixelSize: 5 }), navR = lights.add({ color: C.Color.fromCssColorString('#33ff77'), pixelSize: 5 }), strobe = lights.add({ color: C.Color.WHITE, pixelSize: 9, show: false });
    const beacon = lights.add({ color: C.Color.fromCssColorString('#ff2a1f'), pixelSize: 7, show: false }), landL = lights.add({ color: C.Color.fromCssColorString('#fff6dc'), pixelSize: 11, show: false }), taxiL = lights.add({ color: C.Color.fromCssColorString('#fff6dc'), pixelSize: 8, show: false }), landR = lights.add({ color: C.Color.fromCssColorString('#fff6dc'), pixelSize: 11, show: false });
    let landingLights = O.mode === 'replay';
    const lines = tagged(scene.primitives.add(new C.PolylineCollection()));
    const flownLine = lines.add({ positions: [], width: 2.5, material: C.Material.fromType('Color', { color: new C.Color(1, .82, .29, .65) }) });
    const gatePool = Array.from({ length: 20 }, () => lines.add({ positions: [], width: 3, show: false, material: C.Material.fromType('Color', { color: new C.Color(1, 1, 1, .5) }) }));
    // dashed route line draped on the ground or the 3D city
    let routeGround = null;
    try {
      routeGround = scene.groundPrimitives.add(new C.GroundPolylinePrimitive({ geometryInstances: new C.GeometryInstance({ geometry: new C.GroundPolylineGeometry({ positions: P.map(p => LLH(p[0], p[1], 0)), width: 3.5 }) }), appearance: new C.PolylineMaterialAppearance({ material: C.Material.fromType('PolylineDash', { color: new C.Color(1, 1, 1, .7), gapColor: C.Color.TRANSPARENT, dashLength: 22 }) }), asynchronous: true }));
    } catch { }
    const labels = tagged(scene.primitives.add(new C.LabelCollection()));
    exclude.push(...[model, lights, lines, labels, routeGround].filter(Boolean));

    // ground height under a point: rendered 3D tiles, or the terrain globe
    const gcache = new Map();
    // With photo tiles, the ground right under the aircraft is often off-screen and drops to a coarse tile that can be
    // 50-100 m wrong, which used to make the aircraft "touch down" in mid-air. So the physics ground away from runways
    // is the elevation model (AWS terrain, MSL) lifted by the local geoid; a tile height is used only when it agrees.
    const dem = tileset ? terrariumTerrain(C) : null;
    let geoN = 0, geoKnown = !tileset; // local geoid (ellipsoid − MSL); set from a runway or the start point below
    const rawGround = (x, z) => { try {
      const c = carto(x, z), lng = C.Math.toDegrees(c.longitude), lat = C.Math.toDegrees(c.latitude);
      if (!tileset) { const h = scene.terrainProvider.sampleAt(lng, lat); return Number.isFinite(h) ? h : null; }
      const t = scene.sampleHeight(c, exclude, .6), d = dem.sampleAt(lng, lat);
      if (d != null && geoKnown) { const g = d + geoN; return Number.isFinite(t) && t > g - 8 && t < g + 15 ? t : g; }
      return Number.isFinite(t) ? t : null;
    } catch { return null; } };
    const elevAt = (x, z, fresh) => { const k = Math.round(x / 20) + ',' + Math.round(z / 20), now = performance.now(), c = gcache.get(k); if (c && !fresh && now - c.t < 1500 && c.e != null) return c.e; const e = rawGround(x, z); gcache.set(k, { e, t: now }); if (gcache.size > 600) gcache.delete(gcache.keys().next().value); return e ?? c?.e ?? null; };
    // wait for the scenery at the start, then read the ground height there (most detailed)
    const mostDetailed = async pts => {
      try {
        if (tileset) { const r = await Promise.race([scene.sampleHeightMostDetailed(pts.map(p => carto(...p)), exclude), new Promise(res => setTimeout(() => res(null), 15000))]); return r ? r.map(c => Number.isFinite(c?.height) ? c.height : null) : pts.map(() => null); }
        for (let i = 0; i < 60; i++) { const v = pts.map(p => { const [lng, lat] = F.ll(...p); return scene.terrainProvider.sampleAt(lng, lat); }); if (v.every(x => x != null)) return v; await new Promise(r => setTimeout(r, 200)); }
        return pts.map(() => null);
      } catch { return pts.map(() => null); }
    };
    const landPt = arrE ? add(arrE.T, arrE.dir, Math.max(arrE.disp, 0)) : P[P.length - 1];
    const last = landPt, sameEnd = !arrE && Math.hypot(last[0] - P[0][0], last[1] - P[0][1]) < 1500;
    // runway surfaces: sample the ground along each runway (centre and both sides) so our runway sits on the scenery
    const rwSt = rwys.map(rw => { const n = Math.max(2, Math.ceil(rw.len / 80) + 1), f = unit(rw.A, rw.B), l = leftOf(f), pts = []; for (let i = 0; i < n; i++) { const c = add(rw.A, f, rw.len * i / (n - 1)); pts.push(c, add(c, l, rw.wid * .35), add(c, l, -rw.wid * .35)); } return { rw, n, f, l, pts, h: [] }; });
    rwStRef = () => rwSt;
    let [h0, h1] = await mostDetailed([P[0], sameEnd ? P[0] : last]);
    const rwPts = rwSt.flatMap(r => r.pts), hs = [null, null, ...(rwPts.length ? await mostDetailed(rwPts) : [])];
    if (!alive) return { close: destroy };
    // the detailed samples can time out on slow connections: then wait (up to 25 s) for the scenery under the start
    // and read the ground directly, so the runway and the aircraft are placed once, on the real surface
    if (tileset && (h0 == null || rwSt.some((r, i) => !r.pts.some((_, j) => Number.isFinite(hs[2 + rwSt.slice(0, i).reduce((n, q) => n + q.pts.length, 0) + j]))))) {
      for (let i = 0; i < 80 && alive && (elevAt(P[0][0], P[0][1], true) == null || (i < 40 && !tileset.tilesLoaded)); i++) await new Promise(r => setTimeout(r, 300));
      if (h0 == null) h0 = elevAt(P[0][0], P[0][1], true);
      let k = 2; for (const r of rwSt) for (const pt of r.pts) { if (!Number.isFinite(hs[k])) hs[k] = elevAt(pt[0], pt[1], true); k++; }
    }
    if (!alive) return { close: destroy };
    // Google tiles use heights above the ellipsoid; the airfield's published elevation tells us the local geoid offset
    if (tileset && h0 != null && O.fromElevFt != null) { const n = h0 - O.fromElevFt * FT; if (Math.abs(n) < 110) { geoN = n; geoKnown = true; } }
    let g0 = h0 ?? ((O.fromElevFt || 0) * FT + geoN);
    let g1 = sameEnd ? g0 : (h1 ?? (O.toElevFt != null ? O.toElevFt * FT + geoN : g0));
    // if the detailed start height wasn't ready in time, fix the datum from the first real ground reading at the start
    let datumFixed = !(tileset && h0 == null);
    // shape each runway: robust end heights, a straight slope between them, small local variation
    const shapeRunways = (hs, only = null) => { let k = 2, any = false; const med = a => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
      for (const r of rwSt) {
        if (only && r !== only) { k += r.n * 3; continue; }
        const raw = []; for (let i = 0; i < r.n; i++, k += 3) raw.push(med([hs[k], hs[k + 1], hs[k + 2]]));
        const ok = raw.filter(Number.isFinite), fallback = ok.length ? med(ok) : (r.guess ?? g0) - .35; if (ok.length) any = true;
        r.pending = !ok.length;
        const ha = med(raw.slice(0, 3)) ?? fallback, hb = med(raw.slice(-3)) ?? fallback;
        r.h = raw.map((v, i) => { const lin = ha + (hb - ha) * i / (r.n - 1); return Number.isFinite(v) ? lin + clamp(v - lin, -1.2, 1.2) : lin; });
        for (let i = 1; i < r.n - 1; i++) r.h[i] = (r.h[i - 1] + r.h[i] * 2 + r.h[i + 1]) / 4;
        r.h = r.h.map(v => v + .35);
      }
      return any;
    };
    rwSt.forEach(r => { r.guess = arrR && arrR !== depR && arrR.list.includes(r.rw) && !(depR?.list || []).includes(r.rw) ? g1 : g0; });
    let rwSampled = shapeRunways(hs);
    const rwAt = (x, z) => {
      for (const r of rwSt) {
        const dx = x - r.rw.A[0], dz = z - r.rw.A[1], u = dx * r.f[0] + dz * r.f[1], w = dx * r.l[0] + dz * r.l[1];
        if (u < -8 || u > r.rw.len + 8 || Math.abs(w) > r.rw.wid / 2 + 6) continue;
        const t = clamp(u / r.rw.len, 0, 1) * (r.n - 1), i = Math.min(r.n - 2, Math.floor(t)), a = t - i;
        return { h: r.h[i] + (r.h[i + 1] - r.h[i]) * a, surf: r.rw.surf === 'concrete' || r.rw.surf === 'asphalt' || r.rw.surf === 'other' || !r.rw.surf ? 'paved' : r.rw.surf };
      }
      return null;
    };
    const rwHeight = (x, z) => rwAt(x, z)?.h ?? null;
    // draw them: a textured strip mesh with real markings, receiving shadows. Rebuilt if the ground height is corrected later.
    const rwImg = new Map();
    function drawRunways() {
     for (const r of rwSt) {
      try {
        if (r.prim) { scene.primitives.remove(r.prim); const i = exclude.indexOf(r.prim); if (i >= 0) exclude.splice(i, 1); r.prim = null; }
        if (tileset && r.rw.osm) continue;
        const n = r.n, pos = new Float64Array(n * 6), nor = new Float32Array(n * 6), sts = new Float32Array(n * 4), idx = new Uint16Array((n - 1) * 6);
        for (let i = 0; i < n; i++) {
          const c = add(r.rw.A, r.f, r.rw.len * i / (n - 1));
          [add(c, r.l, r.rw.wid / 2), add(c, r.l, -r.rw.wid / 2)].forEach((p, j) => { const q = LLH(p[0], p[1], r.h[i]), nn = C.Ellipsoid.WGS84.geodeticSurfaceNormal(q, new C.Cartesian3()); pos.set([q.x, q.y, q.z], (i * 2 + j) * 3); nor.set([nn.x, nn.y, nn.z], (i * 2 + j) * 3); sts.set([j, i / (n - 1)], (i * 2 + j) * 2); });
          if (i < n - 1) idx.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], i * 6);
        }
        const geometry = new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos }), normal: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: nor }), st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: sts }) }, indices: idx, primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) });
        const prim = scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry }), appearance: new C.MaterialAppearance({ material: C.Material.fromType('Image', { image: rwImg.get(r.rw) || (rwImg.set(r.rw, runwayCanvas(r.rw).toDataURL('image/png')), rwImg.get(r.rw)), color: new C.Color(LIGHT[0], LIGHT[1], LIGHT[2], 1) }), flat: true, faceForward: true, translucent: false, closed: false }), asynchronous: false, shadows: C.ShadowMode.RECEIVE_ONLY }));
        exclude.push(prim); r.prim = prim;
      } catch (e) { console.warn('runway', e); }
     }
    }
    // airport lighting: edge, threshold and end lights on every runway; approach lights and a PAPI on the arrival runway
    const rwLights = tagged(scene.primitives.add(new C.PointPrimitiveCollection())); exclude.push(rwLights);
    const LS = { near: new C.NearFarScalar(150, 1.5, 9000, .45), fade: new C.NearFarScalar(4000, 1, 16000, 0) };
    const W_ = C.Color.fromCssColorString('#FFF4D6'), GRN = C.Color.fromCssColorString('#46FF8A'), RED = C.Color.fromCssColorString('#FF3B30'), PW = C.Color.fromCssColorString('#FFFFFF');
    let papi = [], rabbit = []; const lightScale = TOD === 'night' ? 1.6 : TOD === 'golden' ? 1.25 : 1; if (TOD === 'night') LS.fade = new C.NearFarScalar(8000, 1, 30000, 0);
    const rwPoint = (r, u, w, dy = .25) => { const c = add(add(r.rw.A, r.f, u), r.l, w), t = clamp(u / r.rw.len, 0, 1) * (r.n - 1), i = Math.min(r.n - 2, Math.floor(t)), a = t - i, h = (r.h[i] ?? g0) + ((r.h[i + 1] ?? g0) - (r.h[i] ?? g0)) * a; return { c, h: h + dy }; };
    function buildRunwayLights() {
      rwLights.removeAll(); papi = []; rabbit = [];
      const pt = (p, color, size = 5) => rwLights.add({ position: LLH(p.c[0], p.c[1], p.h), color, pixelSize: size * lightScale, scaleByDistance: LS.near, translucencyByDistance: LS.fade });
      for (const r of rwSt) {
        const paved = PAVED(r.rw.surf), Lr = r.rw.len, hw = r.rw.wid / 2 + 1.5; if (!paved && !r.rw.lit) continue;
        for (let u = 0; u <= Lr + .1; u += 60) for (const sd of [1, -1]) pt(rwPoint(r, u, sd * hw), W_, 4.5);
        const activeEnd = arrE && r.rw === arrE.rw ? (arrE.T === r.rw.A ? 'A' : 'B') : depE && r.rw === depE.rw ? (depE.T === r.rw.A ? 'A' : 'B') : null;
        for (let w = -r.rw.wid / 2; w <= r.rw.wid / 2 + .1; w += 3) { pt(rwPoint(r, .5, w), activeEnd === 'B' ? RED : GRN, 5); pt(rwPoint(r, Lr - .5, w), activeEnd === 'A' ? RED : GRN, 5); }
      }
      if (arrE && PAVED(arrE.rw.surf)) {
        const r = rwSt.find(q => q.rw === arrE.rw); if (!r) return;
        const fromA = arrE.T === r.rw.A, dirU = fromA ? 1 : -1, uT = fromA ? Math.max(arrE.disp, 0) : r.rw.len - Math.max(arrE.disp, 0);
        // approach lights: centreline bars out to 720 m, a crossbar at 300 m, and a sequenced flasher running towards the runway
        if (r.rw.len > 1200) for (let d = 30; d <= 720; d += 30) {
          const u = uT - dirU * d, bar = d === 300 ? 7 : 2;
          for (let k = -bar; k <= bar; k++) pt(rwPoint(r, u, k * 1.6, .8 + d * .004), W_, d === 300 ? 5 : 4.5);
          if (d >= 330) rabbit.push(rwLights.add({ position: LLH(...(p => [p.c[0], p.c[1], p.h])(rwPoint(r, u, 0, 1.6 + d * .004))), color: PW, pixelSize: 9, show: false, scaleByDistance: LS.near, translucencyByDistance: LS.fade }));
        }
        rabbit.reverse();
        // PAPI on the left of the runway at the aiming point: 4 units, transition angles 2.5° … 3.5° from the outside in
        const uA = uT + dirU * Math.min(arrE.rw.len >= 1200 ? 300 : 150, rollEnd * .3), side = fromA ? 1 : -1;
        [2.5, 2.83, 3.17, 3.5].forEach((ang, i) => { const p = rwPoint(r, uA, side * (r.rw.wid / 2 + 15 + (3 - i) * 9), .6); papi.push({ p, ang, prim: rwLights.add({ position: LLH(p.c[0], p.c[1], p.h), color: PW, pixelSize: 7, scaleByDistance: LS.near, translucencyByDistance: new C.NearFarScalar(6000, 1, 14000, 0) }) }); });
      }
    }
    drawRunways(); buildRunwayLights();
    const shiftRunways = d => { if (!rwSt.length || !d) return; rwSt.forEach(r => { r.h = r.h.map(v => v + d); }); drawRunways(); buildRunwayLights(); };
    if (rwSt.length) { const a = rwHeight(P[0][0], P[0][1]); if (a != null && depE) g0 = a; const b = rwHeight(landPt[0], landPt[1]); if (b != null && arrE) g1 = b; }
    // Google tiles are heights above the ellipsoid: the gap to the published field elevation is the local geoid, which
    // the altimeter has to take off. Measure it on a runway (not under the aircraft, which may be miles out on final).
    const geoFrom = (E, ft) => { if (!tileset || !E || ft == null) return null; const r = rwSt.find(q => q.rw === E.rw); if (!r || r.pending) return null; const h = rwHeight(...add(E.T, E.dir, Math.min(150, E.rw.len / 4))); if (h == null) return null; const n = h - .35 - ft * FT; return Math.abs(n) < 110 ? n : null; };
    { const n = geoFrom(depE, O.fromElevFt) ?? geoFrom(arrE, O.toElevFt); if (n != null) { geoN = n; geoKnown = true; datumFixed = true; } }
    // no runway to measure on: compare the detailed tile height at the start with the elevation model there
    if (tileset && !geoKnown && h0 != null) {
      const [lng, lat] = F.ll(P[0][0], P[0][1]); let d = null;
      for (let i = 0; i < 25 && alive && (d = dem.sampleAt(lng, lat)) == null; i++) await new Promise(r => setTimeout(r, 200));
      if (d != null && Math.abs(h0 - d) < 110) { geoN = h0 - d; geoKnown = true; }
    }
    // warm the elevation model along the first few kilometres of the route
    if (dem) for (let s0 = 0; s0 < Math.min(L, 6000); s0 += 250) { const [x, z] = path.at(s0); const [lng, lat] = F.ll(x, z); dem.sampleAt(lng, lat); }
    // labels: route waypoints and nearby airfields
    const labelStyle = { font: '600 15px Archivo, system-ui, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.fromCssColorString('#06102A'), outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, scaleByDistance: new C.NearFarScalar(1500, 1, 40000, .55), translucencyByDistance: new C.NearFarScalar(30000, 1, 60000, 0) };
    if (O.country && window.BoploMap?.airfields) BoploMap.airfields(O.country).then(list => {
      if (!alive) return;
      const addMini = l => { const have = new Set(miniAps.map(o => o.code)); miniAps = miniAps.concat(l.filter(a => a.type !== 'W' && !a.code.includes('-') && !have.has(a.code)).map(a => ({ code: a.code, t: a.type, xz: F.to(a.lat, a.lng) })).filter(o => Math.hypot(...o.xz) < L + 150000)); };
      addMini(list);
      [O.depAirport?.cc, O.arrAirport?.cc].filter((c, i, l) => c && c !== O.country && l.indexOf(c) === i).forEach(c => BoploMap.airfields(c).then(l => alive && addMini(l)).catch(() => { }));
      list.filter(a => a.type !== 'S' && a.type !== 'H' && Number.isFinite(a.elev)).map(a => ({ a, xz: F.to(a.lat, a.lng) })).filter(o => Math.hypot(...o.xz) < Math.max(70000, L + 40000)).slice(0, 220)
        .forEach(({ a, xz }) => labels.add({ ...labelStyle, text: a.code, position: LLH(xz[0], xz[1], a.elev * FT + geoN + 45), fillColor: C.Color.fromCssColorString('#CFE8FF'), font: '600 13px Archivo, system-ui, sans-serif' }));
    });

    function placeAircraft() {
      if (!model) return;
      const pos = LLH(st.x, st.z, st.alt + AC.wheelDrop);
      const sx = F.sx(st.z), th = Math.abs(sx - 1) < 1e-4 ? st.hdg : Math.atan2(Math.sin(st.hdg * D2R) * sx, Math.cos(st.hdg * D2R)) * R2D;
      const hpr = new C.HeadingPitchRoll(C.Math.toRadians(th - 90), C.Math.toRadians(st.att ?? st.pitch), C.Math.toRadians(st.bank));
      C.Transforms.headingPitchRollToFixedFrame(pos, hpr, C.Ellipsoid.WGS84, undefined, model.modelMatrix);
      model.show = !st.crashed && !cockpit(); lights.show = !cockpit();
      // nav lights: model frame after axis conversion is x forward, y left, z up
      const at = ([gx, gy, gz]) => C.Matrix4.multiplyByPoint(model.modelMatrix, new C.Cartesian3(gz, gx, gy), new C.Cartesian3());
      navL.position = at(AC.tips.left); navR.position = at(AC.tips.right); strobe.position = at(AC.tips.tail); strobe.show = (st.t % 1.3) < .06;
      // beacon on the fin, landing lights in the wing leading edge
      if (AC.beacon || AC.surfaces?.rud) { const r = AC.surfaces?.rud; beacon.position = at(AC.beacon || [0, r.pivot[1] + (r.axis[1] * 1.3), r.pivot[2] + .2]); beacon.show = (st.t % 1.1) < .14 && fs.rpm > 0; }
      // landing lights: in the wing roots on airliners (from the model), in the wing leading edge on trainers; a taxi light on the nose gear.
      // They're small in daylight and bloom at dusk and night
      landL.show = landR.show = landingLights; taxiL.show = landingLights && !!AC.taxi && (fs.gearPos ?? 1) > .9;
      if (landingLights) {
        const Lp = AC.land || [AC.tips.left[0] * .42, AC.tips.left[1] - .25, AC.tips.left[2] + .9], px = sky.dark ? 13 : sky.dim ? 10 : 6;
        landL.position = at([Math.abs(Lp[0]), Lp[1], Lp[2]]); landR.position = at([-Math.abs(Lp[0]), Lp[1], Lp[2]]); landL.pixelSize = landR.pixelSize = px;
        if (taxiL.show) { taxiL.position = at(AC.taxi); taxiL.pixelSize = px * .75; }
      }
      // control surfaces follow the controls (TE-down is a negative rotation about each hinge axis)
      const n = FM.p.notch[fc.flaps] || FM.p.notch[0], rud = fs.rud ?? fc.rudder;
      const want = { flap: -n.deg, ailL: -fc.aileron * 18, ailR: fc.aileron * 18, elev: fc.elevator * (AC.surfaces?.elev?.max || 22), rud: rud * 25, spoil: (fs.spoilerPos || 0) * 42 };
      const fanStep = ((fs.n1 || 0) / 100) * 2 * Math.PI * realDt * 2.2; fanA = (fanA + fanStep) % (Math.PI * 2);
      for (const [k, node] of Object.entries(surfNodes)) {
        const sf = AC.surfaces[k], kind = (sf.kind === 'stabilator' ? 'elev' : sf.kind) || k.replace(/\d+$/, '').replace(/[LR]$/, ''), side = sf.side ?? (/R\d*$/.test(k) ? -1 : 1);
        let v;
        if (kind === 'fan') v = fanA * R2D;
        else {
          const tgt = kind === 'ail' ? want[side > 0 ? 'ailL' : 'ailR'] : kind === 'elev' ? fc.elevator * (sf.max || 22) : (want[kind] ?? 0), cur = surfAng[k] ?? 0, rate = kind === 'flap' ? 12 : kind === 'spoil' ? 60 : 120;
          v = cur + clamp(tgt - cur, -rate * realDt, rate * realDt); if (Math.abs(v - cur) < 1e-4 && surfAng[k] != null) continue;
        }
        surfAng[k] = v;
        const p = new C.Cartesian3(...sf.pivot), q = C.Quaternion.fromAxisAngle(new C.Cartesian3(...sf.axis), v * D2R);
        node.matrix = C.Matrix4.multiply(C.Matrix4.fromTranslation(p), C.Matrix4.multiply(C.Matrix4.fromRotationTranslation(C.Matrix3.fromQuaternion(q)), C.Matrix4.fromTranslation(C.Cartesian3.negate(p, new C.Cartesian3())), new C.Matrix4()), new C.Matrix4());
      }
      // retractable gear: slides up into the body as it retracts and disappears once stowed
      if (gearNode) { const g = fs.gearPos ?? 1; if (Math.abs(g - gearShown) > .002 || g === 0 || g === 1) { gearShown = g; gearNode.show = g > .04; gearNode.matrix = C.Matrix4.fromTranslation(new C.Cartesian3(0, (1 - g) * AC.wheelDrop * .55, -(1 - g) * 1.2)); } }
      // propeller: spin the blades, fade in the disc at high rpm
      const rpm = fs.rpm || 0;
      propA = (propA + rpm / 60 * 2 * Math.PI * realDt * (rpm > 1200 ? .07 : 1)) % (Math.PI * 2);
      if (bladeNode) bladeNode.matrix = C.Matrix4.multiply(C.Matrix4.fromTranslation(new C.Cartesian3(...AC.hub)), C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationZ(propA)), new C.Matrix4());
      if (discNode) discNode.show = rpm > 1200;
    }
    let propA = 0, fanA = 0, realDt = .016, gateT = 0;
    function updateGates() {
      const W = circuit ? 70 : 110, Hh = circuit ? 40 : 60, pr = path.project(st.x, st.z), near = showGates && CAMS[camI][0] !== 'High' ? gates.filter(g => g.s > pr.s + 15).slice(0, 5) : [];
      gatePool.forEach(p => p.show = false);
      near.forEach((g, i) => {
        const d = Math.hypot(g.x - st.x, g.z - st.z), a = (i === 0 ? .85 : .45) * clamp(1 - d / (circuit ? 2400 : 6000), 0, 1) * clamp((d - 90) / 220, 0, 1);
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
      const B0 = clamp(4.6 * AC.S / 3.4 / Math.tan((as < 1 ? .34 : .24) * hfov), 16, 170), B = B0 * kB, Hc = (B0 * .2 + 1.5) * kH;
      camH += wrap180(st.hdg - camH) * Math.min(1, dt * (CAMS[camI][0] === 'High' ? 1.2 : 2.6));
      camPitchLag += ((st.att ?? st.pitch) - camPitchLag) * Math.min(1, dt * 3);
      camD += (depBase - camD) * Math.min(1, dt * 3);
      const dep = clamp(camD - camPitchLag * .55 + (st.ground ? 2 : 0), 2, 60);
      const ch = (camH + orb.yaw) * D2R, f = [Math.sin(ch), Math.cos(ch)], ex = -f[0] * B * orb.zoom, ez = -f[1] * B * orb.zoom;
      let ey = Hc * (orb.zoom > 1 ? orb.zoom : 1) + AC.wheelDrop + Math.tan(orb.pitch * D2R) * B * orb.zoom;
      const gEye = elevAt(st.x + ex, st.z + ez); if (gEye != null) ey = Math.max(ey, gEye - st.alt + 3);
      const camName = CAMS[camI][0];
      if (cockpit() || camName === 'Wing') {
        // attitude-locked cameras: the pilot's eye in the left seat, or on the left wing looking forward along the fuselage
        const e = camName === 'Wing' ? [AC.tips.left[0] * 1.05, AC.tips.left[1] + .9, AC.tips.left[2] + 1.6] : (AC.eye || [.25, .4, .4]), F = fs.F, U = fs.U, R = fs.R, bx = -e[0], by = e[1] + AC.wheelDrop, bz = e[2];
        const px = st.x + F[0] * bz + U[0] * by + R[0] * bx, pz = st.z + F[2] * bz + U[2] * by + R[2] * bx, py = st.alt + F[1] * bz + U[1] * by + R[1] * bx;
        const fov = C.Math.toRadians(camName === 'Wing' ? 62 : 72 / Math.max(.6, Math.min(orb.zoom, 1.6)));
        if (Math.abs(camera.frustum.fov - fov) > 1e-3) { camera.frustum.fov = fov; camera.frustum.near = .1; }
        const yaw = orb.yaw + (camName === 'Wing' ? 128 : 0), pit = orb.pitch * -1 + (camName === 'Wing' ? -9 : -4);
        // look direction built from the aircraft's body axes, so head-turns stay correct in any attitude
        const cy = Math.cos(yaw * D2R), sy = Math.sin(yaw * D2R), cp = Math.cos(pit * D2R), sp = Math.sin(pit * D2R);
        const dir = [0, 1, 2].map(i => F[i] * cy * cp + R[i] * sy * cp + U[i] * sp), rgt = [0, 1, 2].map(i => R[i] * cy - F[i] * sy);
        const upv = [dir[1] * rgt[2] - dir[2] * rgt[1], dir[2] * rgt[0] - dir[0] * rgt[2], dir[0] * rgt[1] - dir[1] * rgt[0]]; // basis is east, up, north (left-handed), as in the flight model
        const dest = LLH(px, pz, py), enu = C.Transforms.eastNorthUpToFixedFrame(dest), sxc = F.sx(st.z), toW = v => C.Cartesian3.normalize(C.Matrix4.multiplyByPointAsVector(enu, new C.Cartesian3(v[0] * sxc, v[2], v[1]), new C.Cartesian3()), new C.Cartesian3());
        camera.setView({ destination: dest, orientation: { direction: toW(dir), up: toW(upv) } });
      } else if (camName === 'Flyby') {
        // a camera parked ahead on the flight path, just off to one side: the aircraft flies past it, then it jumps ahead again
        const ahead = clamp(st.gs * 9, 250, 1600), passed = flyAt && ((st.x - flyAt[0]) * Math.sin(st.trk * D2R) + (st.z - flyAt[1]) * Math.cos(st.trk * D2R)) > ahead * .45;
        if (!flyAt || passed || Math.hypot(st.x - flyAt[0], st.z - flyAt[1]) > ahead * 2.5) { const tk = st.trk * D2R, off = AC.type.span * 1.6 + 12, c0 = [st.x + Math.sin(tk) * ahead + Math.cos(tk) * off, st.z + Math.cos(tk) * ahead - Math.sin(tk) * off]; flyAt = [c0[0], c0[1], Math.max((elevAt(c0[0], c0[1]) ?? st.gnd) + 2, st.alt - (st.agl > 30 ? 6 : 0) + AC.wheelDrop * .5)]; }
        const dx = st.x - flyAt[0], dz = st.z - flyAt[1], dy = st.alt + AC.wheelDrop - flyAt[2], dh = Math.max(1, Math.hypot(dx, dz));
        const fov = clamp(2 * Math.atan(AC.type.span * 1.5 / Math.hypot(dh, dy) / orb.zoom), .12, 1.05);
        if (Math.abs(camera.frustum.fov - fov) > 1e-4) { camera.frustum.fov = fov; camera.frustum.near = 1; }
        camera.setView({ destination: LLH(flyAt[0], flyAt[1], flyAt[2]), orientation: { heading: Math.atan2(dx, dz), pitch: Math.atan2(dy, dh), roll: 0 } });
      } else if (camName === 'Tower') {
        // a fixed camera beside the nearest airport (or a fly-by point ahead on the route) that tracks and zooms onto the aircraft
        if (!towerAt || Math.hypot(st.x - towerAt[0], st.z - towerAt[1]) > 7000) {
          const ap = [depR, arrR].filter(Boolean).map(R0 => [R0, Math.hypot(st.x - R0.C0[0], st.z - R0.C0[1])]).sort((a, b) => a[1] - b[1])[0];
          if (ap && ap[1] < 6000) { const rw = ap[0].list[0], f2 = rw ? unit(rw.A, rw.B) : [1, 0], l2 = leftOf(f2), c0 = rw ? add(add(rw.A, f2, rw.len * .45), l2, rw.wid / 2 + 160) : ap[0].C0; towerAt = [c0[0], c0[1], (elevAt(c0[0], c0[1]) ?? st.gnd) + 28]; }
          else { const tk = st.trk * D2R; const c0 = [st.x + Math.sin(tk) * 900 + Math.cos(tk) * 120, st.z + Math.cos(tk) * 900 - Math.sin(tk) * 120]; towerAt = [c0[0], c0[1], Math.max((elevAt(c0[0], c0[1]) ?? st.gnd) + 30, st.alt - 40)]; }
        }
        const dx = st.x - towerAt[0], dz = st.z - towerAt[1], dy = st.alt + AC.wheelDrop - towerAt[2], dh = Math.max(1, Math.hypot(dx, dz)), dist = Math.hypot(dh, dy);
        const fov = clamp(2 * Math.atan(AC.type.span * 2.4 / dist / orb.zoom), .03, 1.1);
        if (Math.abs(camera.frustum.fov - fov) > 1e-4) { camera.frustum.fov = fov; camera.frustum.near = 1; }
        camera.setView({ destination: LLH(towerAt[0], towerAt[1], towerAt[2]), orientation: { heading: Math.atan2(dx, dz), pitch: Math.atan2(dy, dh), roll: 0 } });
      } else {
        if (camName === 'Orbit' && !paused) orb.yaw = (orb.yaw + dt * 9) % 360;
        if (camera.frustum.fov !== C.Math.toRadians(66)) { camera.frustum.fov = C.Math.toRadians(66); camera.frustum.near = .5; }
        camera.setView({ destination: LLH(st.x + ex, st.z + ez, st.alt + ey), orientation: { heading: ch, pitch: C.Math.toRadians(-dep), roll: 0 } });
      }
      placeAircraft();
      { const want = shadowsOK && st.agl < 250; if (scene.shadowMap && scene.shadowMap.enabled !== want) scene.shadowMap.enabled = want; }
      gateT += dt; if (gateT > .2) { gateT = 0; updateGates(); }
      cloudT += dt; if (cloudT > 1) { cloudT = 0; updateClouds(); }
      if (papi.length) { const ey = st.alt + AC.wheelDrop + 1.2; for (const u of papi) { const d = Math.hypot(st.x - u.p.c[0], st.z - u.p.c[1]), ang = Math.atan2(ey - u.p.h, Math.max(1, d)) * R2D; u.prim.color = ang > u.ang ? PW : RED; } }
      if (rabbit.length) { const k = Math.floor((performance.now() / 1000 * 2 % 1) * rabbit.length * 1.6); rabbit.forEach((b, i) => { b.show = i === k; }); }
      viewer.resize(); viewer.render();
    }
    const flownPts = [];
    let cruise = 0; const planCruise = () => { cruise = O.cruiseFt ? O.cruiseFt * FT + geoN : (circuit ? g0 + 1000 * FT : Math.max(g0, g1) + 2200 * FT); }; planCruise();
    const AIM = arrE ? Math.min(arrE.rw.len >= 1200 ? 300 : 150, rollEnd * .3) : 0, ROLL = circuit ? 420 : 500, LROLL = 380, TDZ = arrE ? Math.max(120, rollEnd - AIM) : Math.min(circuit ? 520 : 650, L * .12), CG = circuit ? 0.09 : (AC.jet ? 700 : 500) * FT / NM, DG = PRF ? Math.tan(3 * D2R) : circuit ? 0.06 : 330 * FT / NM;
    const groundStart = O.start !== 'air', landEnd = O.land !== false;
    const prof = s => { const up = groundStart ? g0 + Math.max(0, s - ROLL) * CG : cruise, dn = landEnd ? g1 + Math.max(0, L - TDZ - s) * DG : cruise; return Math.min(cruise, up, dn); };

    // route gates every few hundred metres where the route is airborne
    const gates = [];
    const planGates = () => { gates.length = 0; for (let s = circuit ? 250 : 400; s < L - 60; s += circuit ? 200 : 450) { const a = prof(s); if (a - Math.min(g0, g1) > 25) { const [x, z, h] = path.at(s); gates.push({ x, z, y: a, h, s }); } } }; planGates();
    function fixDatum(groundHere) {
      if (datumFixed) return; datumFixed = true;
      const shift = groundHere - g0; if (Math.abs(shift) < 2 || Math.abs(shift) > 150) return;
      if (O.fromElevFt != null) geoN = groundHere - O.fromElevFt * FT;
      g0 += shift; g1 += shift; planCruise(); planGates(); lastG += shift; if (!rwSampled && !rwAt(fs.x, fs.z)) shiftRunways(shift); if (fs.ground) { fs.alt = groundAt(fs.x, fs.z); fs.v[1] = 0; } else fs.alt += shift;
      // and try again for proper runway heights now the scenery has loaded
      if (!rwSampled && rwPts.length && !rwAt(fs.x, fs.z)) mostDetailed(rwPts).then(v => { if (alive && !rwAt(fs.x, fs.z) && shapeRunways([null, null, ...v])) { rwSampled = true; drawRunways(); buildRunwayLights(); } });
    }

    /* ---- aircraft state: a physics model (flight-physics.js) behind the same fields the HUD and scoring use ---- */
    let flareNow = false;
    const st = { flaps: 0, x: 0, z: 0, alt: 0, hdg: 0, pitch: 0, bank: 0, v: 0, thr: 0, ground: true, crashed: false, landed: false, vs: 0, trk: 0, gs: 0, stall: false, t: 0, agl: 0, gnd: g0 };
    // a preset can ask for a crosswind relative to the departure runway
    if (WX.windRel && depE) O.wind = { dir: norm360(depE.hdg * R2D + WX.windRel.off), spd: WX.windRel.spd };
    const wind = O.wind && O.wind.spd ? { x: -Math.sin(O.wind.dir * D2R) * O.wind.spd * KT, z: -Math.cos(O.wind.dir * D2R) * O.wind.spd * KT, dir: O.wind.dir, spd: O.wind.spd } : { x: 0, z: 0, spd: 0 };
    const gustKt = WX.windRel?.gust || WX.gust || 0, gustK = gustKt && wind.spd ? clamp((gustKt - wind.spd) / wind.spd, 0, 2) : 0;
    const turbI = WX.turb ?? ((cloudLayers.some(c => /SCT|BKN/.test(c.cover)) ? .35 : 0) + (wind.spd > 14 ? .3 : 0));
    let gTarget = 0, gNow = 0; const tv = [0, 0, 0];
    const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += Math.random(); return (u - 3) / .7071; };
    // gusts (a slow random swing up to the reported gust) and turbulence (filtered noise, stronger low down in wind)
    function windAt(dt) {
      if (Math.random() < dt / 3.5) gTarget = Math.random() ** 1.5; gNow += (gTarget - gNow) * Math.min(1, dt / 1.8);
      const lowMech = wind.spd > 10 && st.agl < 300 ? wind.spd / 25 : 0, I = (turbI + lowMech * .5) * (st.ground ? .2 : 1);
      for (let i = 0; i < 3; i++) tv[i] += -tv[i] * dt / 1.1 + gauss() * Math.sqrt(dt) * I * 1.5;
      const g = 1 + gNow * gustK;
      return [wind.x * g + tv[0], tv[1] * .7, wind.z * g + tv[2]];
    }
    const windV = [wind.x, 0, wind.z];
    let lastG = g0, rwLazyT = 0;
    // scenery not loaded under the aircraft yet: keep the last known ground while rolling, assume none in the air
    // On the approach, real terrain stays below the obstacle-clearance surface (a 2% slope rising from the threshold), so a bad
    // height sample (a coarse scenery tile, a spike in the elevation model) can never put the "ground" under the aircraft in mid-air.
    const approachCap = (x, z) => {
      if (!arrE) return Infinity;
      const f = arrE.dir, dx = x - landPt[0], dz = z - landPt[1], u = -(dx * f[0] + dz * f[1]), w = Math.abs(dx * f[1] - dz * f[0]);
      if (u < -40 || u > 16000 || w > 200 + u * .15) return Infinity;
      return (rwHeight(landPt[0], landPt[1]) ?? g1) + Math.max(0, u) * .02;
    };
    const groundAt = (x, z) => {
      const air = !fs?.ground, r = rwAt(x, z), e = elevAt(x, z);
      if (r) return lastG = r.h;
      if (e != null) return lastG = air ? Math.min(e, approachCap(x, z)) : e;
      return fs?.ground ? lastG : lastG - 3000;
    };
    const FM = BoploPhysics.create(O.aircraftId || 'c172', PF, { tail: AC.type?.gear?.type === 'tail', groundAtt: AC.groundAtt, parkingAtStart: O.mode !== 'replay', groundAt, surfaceAt: (x, z) => rwAt(x, z)?.surf || 'grass' });
    const fs = FM.s, fc = FM.c;
    const sync = () => {
      st.x = fs.x; st.z = fs.z; st.alt = fs.alt; st.hdg = fs.hdg; st.pitch = fs.pitch; st.att = fs.pitch; st.bank = fs.bank; st.v = fs.ias; st.vs = fs.vs; st.gs = fs.gs; st.trk = fs.trk;
      st.ground = fs.ground; st.crashed = fs.crashed; st.crash = fs.crash; st.stall = fs.stallWarn; st.thr = fs.power; st.flaps = FM.notches > 1 ? fc.flaps / (FM.notches - 1) : 0; st.agl = fs.agl ?? 0; st.gnd = fs.alt - (fs.agl ?? 0);
      st.landed = fs.landed; if (fs.landed && fs.touch && !st.touch) { st.touch = { ...fs.touch, at: path.project(st.x, st.z).s }; st.landedOnce = true; }
    };
    let pscore = null, apprPwr = null;
    const PRN = PR ? ({ takeoff: 'Take-off', circuit: 'Circuit', long: 'Long final', short: 'Short final' })[PR.kind] + (arrE?.id || depE?.id ? ' · runway ' + (arrE?.id || depE?.id) : '') : '';
    const PRT = !PR ? '' : PR.kind === 'takeoff' ? `Line up, release the parking brake, full power, keep straight on the centreline and rotate at about ${PF.vr} kt. Climb at Vy (${Math.round(PF.vy)} kt) on the runway heading. The exercise ends at 1,000 ft above the airfield.`
      : PR.kind === 'circuit' ? 'Take off, fly a left-hand circuit and land back on the same runway. Follow the gates.'
      : `You’re established on a ${PR.kind === 'long' ? '6 NM' : '2 NM'} final${PR.kind === 'long' ? ' with take-off flap' : ' with landing flap'}, trimmed, at about ${PF.appr + (PR.kind === 'long' ? 12 : 3)} kt. Hold the 3° glidepath (the PAPI shows two white and two red), stay on the centreline, cross the threshold at about ${PF.appr} kt and land in the touchdown zone.`;
    function place(s, airborne) {
      const [x, z, h] = path.at(s);
      const gh = rwHeight(x, z) ?? elevAt(x, z, true); st.gk = gh != null || (!airborne && s === 0);
      const alt = airborne ? Math.max(prof(s), (gh ?? g0) + 150) : (gh ?? g0);
      const spd = PRF ? PF.appr + (PR.kind === 'long' ? 12 : 3) : PF.cruise * (circuit ? .82 : .92);
      FM.reset({ x, z, alt, hdg: h * R2D, airborne, speed: spd * KT, pitch: PRF ? -3 : 0 });
      if (PRF && airborne) {
        // configured for the approach: flaps, trimmed for the approach speed, power for a 3° descent
        FM.c.flaps = PR.kind === 'short' ? FM.notches - 1 : Math.min(1, FM.notches - 1); FM.c.trim = FM.trimFor(spd * KT);
        if (apprPwr == null) { try { apprPwr = BoploPhysics.approachPower(O.aircraftId || 'c172', PF, { tail: AC.type?.gear?.type === 'tail', groundAtt: AC.groundAtt }, spd * KT, FM.c.flaps); } catch { apprPwr = .35; } }
        FM.c.throttle = apprPwr;
        FM.s.power = FM.c.throttle; try { thrTarget = FM.c.throttle; } catch { } // not declared yet on the first placement const tr = $('[data-thrrange]'); if (tr) tr.value = Math.round(FM.c.throttle * 100);
      }
      pscore = { gsN: 0, gsSum: 0, spdSum: 0, clN: 0, clMax: 0, liftAt: null, rot: null, vySum: 0, vyN: 0 };
      FM.ap = null; st.touch = null; st.landedOnce = false; st.airT = airborne ? 10 : 0; lastG = gh ?? g0;
      sync(); path.reset(); path.seed(s);
    }
    const replay = O.mode === 'replay';
    const INHG = /^(US|CA)$/.test(O.country || '');
    place(0, !groundStart);

    /* ---- input ---- */
    const keys = new Set(), ctl = { roll: 0, pitch: 0, yaw: 0 };
    const gateKey = PRF ? 'gatesFinal' : 'gates';
    let showGates = !replay && store.get(gateKey, !PRF);
    const CS = Object.assign({ expo: .35, keyRate: 1, centre: true, mouse: false, axes: { roll: 0, pitch: 1, yaw: 2, thr: -1 }, axInv: { roll: false, pitch: false, yaw: false, thr: true } }, store.get('ctl', {}));
    const saveCS = () => store.set('ctl', CS);
    let mouseV = null;
    let invert = store.get('invert', false), apOn = replay, paused = true, rate = replay ? store.get('rate', 4) : 1, camI = 0, tilt = null, stickV = null, thrTarget = fc.throttle, rudV = null;
    fc.autoRudder = store.get('autorudder', true);
    let showSix = store.get('six2', false); // the glass display is the default; the round gauges are one tap away
    // autopilot modes: NAV follows the route (lateral and vertical) with auto-throttle; HDG / ALT / SPD hold selected values
    // autopilot modes work on separate axes, as in Infinite Flight: lateral (LNAV follows the route, or HDG), vertical
    // (VNAV follows the route profile, or ALT with an optional V/S rate, or V/S alone) and speed (SPD). Axes without a mode stay yours.
    const AP = { lnav: false, vnav: false, hdg: null, alt: null, spd: null, vs: null }; let apPanel = false;
    const apLat = () => replay || (apOn && (AP.lnav || AP.hdg != null)), apVert = () => replay || (apOn && (AP.vnav || AP.alt != null || AP.vs != null)), apSpd = () => replay || (apOn && AP.spd != null);
    const CAMS = [['Chase', 1, 1, 8.5], ['Cockpit', 0, 0, 0], ['Wing', 0, 0, 0], ['Flyby', 0, 0, 0], ['Tower', 0, 0, 0], ['Orbit', 1.25, 1.3, 9], ['Wide', 4.2, 4.5, 11], ['High', 26, 34, 32]];
    let flyAt = null;
    const orb = { yaw: 0, pitch: 0, zoom: 1 }; let towerAt = null;
    const flapStep = d => { if (replay) return; fc.flaps = clamp(fc.flaps + d, 0, FM.notches - 1); tipNow = `Flaps ${FM.flapLabel()}`; tipUntil = performance.now() + 1400; };
    const trimStep = d => { if (replay) return; fc.trim = clamp(fc.trim + d, -1, 1); };
    const gearToggle = () => { if (replay) return; if (fs.ground && fc.gear) { tipNow = 'The gear stays down on the ground'; tipUntil = performance.now() + 1600; return; } fc.gear = fc.gear ? 0 : 1; tipNow = fc.gear ? 'Gear down' : 'Gear up'; tipUntil = performance.now() + 1400; };
    const spoilerToggle = () => { if (replay) return; fc.spoiler = fc.spoiler ? 0 : 1; tipNow = fc.spoiler ? 'Spoilers out' : 'Spoilers in'; tipUntil = performance.now() + 1400; };
    on(window, 'keydown', e => {
      if (!alive) return; const k = e.key.toLowerCase();
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (k === 'n') { e.preventDefault(); if (!e.repeat) radioPTT(true); return; }
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'pageup', 'pagedown', 'home', 'end', 'f6', 'f7'].includes(k)) e.preventDefault();
      if (e.repeat && [' ', 'c', 'p', 'm', 'v', '[', ']', 'f6', 'f7', 'i', 'u', 'h', 'j'].includes(k)) return;
      if (k === ' ') { togglePause(); return; }
      if (k === 'c') { cycleCam(); return; }
      if (k === 'i') { setSix(!showSix); return; }
      if (k === 'p' && !replay) { setAP(!apOn); return; }
      if (k === 'm') { toggleMute(); return; }
      if ((k === 'v' && !e.shiftKey) || k === ']' || k === 'f7') { flapStep(1); return; }
      if ((k === 'v' && e.shiftKey) || k === '[' || k === 'f6') { flapStep(-1); return; }
      if (k === 'home' || k === 't') { trimStep(.04); return; }
      if (k === 'end' || (k === 'g' && !e.shiftKey)) { trimStep(-.04); return; }
      if (k === 'b' && e.shiftKey || (k === '.' && (e.ctrlKey || e.metaKey))) { if (!replay) { fc.parking = !fc.parking; tipNow = fc.parking ? 'Parking brake set' : 'Parking brake released'; tipUntil = performance.now() + 1500; } return; }
      if (k === 'g' && e.shiftKey && AC.jet && !replay) { gearToggle(); return; }
      if (k === '/' && AC.jet && !replay) { spoilerToggle(); return; }
      if (k === 'l') { landingLights = !landingLights; tipNow = landingLights ? 'Landing lights on' : 'Landing lights off'; tipUntil = performance.now() + 1200; return; }
      if (k === 'h' && !replay && !O.jet) { fc.carbHeat = !fc.carbHeat; tipNow = fc.carbHeat ? 'Carb heat on' : 'Carb heat off'; tipUntil = performance.now() + 1400; return; }
      if (k === 'u' && !replay) { fc.autoRudder = !fc.autoRudder; store.set('autorudder', fc.autoRudder); tipNow = fc.autoRudder ? 'Auto-rudder on' : 'Auto-rudder off: use Q and E for the rudder'; tipUntil = performance.now() + 2200; return; }
      if (k === 'k') { openSet(); return; }
      if (k === 'o' && !e.repeat) { setMini(!miniOn); return; }
      if (k === 'f2' && AC.jet && !replay && !e.repeat) { e.preventDefault(); fc.reverse = !fc.reverse; tipNow = fc.reverse ? 'Reversers armed' : 'Reversers stowed'; tipUntil = performance.now() + 1600; return; }
      if (k === 'y' && !replay) { CS.mouse = !CS.mouse; saveCS(); syncSet(); tipNow = CS.mouse ? 'Mouse yoke on: move the mouse to fly' : 'Mouse yoke off'; tipUntil = performance.now() + 1800; return; }
      if (k === 'escape' && !$('[data-set]').hidden) { $('[data-set]').hidden = true; e.stopImmediatePropagation(); return; }
      if (k === 'j') { showGates = !showGates; store.set(gateKey, showGates); $('[data-gates]')?.setAttribute('aria-pressed', String(showGates)); return; }
      if (/^[0-9]$/.test(k) && !replay) { thrTarget = k === '0' ? 1 : +k / 10; return; }
      keys.add(k);
    });
    on(window, 'keyup', e => { const k = e.key.toLowerCase(); if (k === 'n') radioPTT(false); keys.delete(k); });
    on(window, 'blur', () => keys.clear());
    // touch stick (elevator and ailerons) and rudder slider
    const stick = $('[data-stick]'), knob = $('[data-knob]');
    const stickMove = e => { const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2 - 18; let dx = e.clientX - cx, dy = e.clientY - cy; const m = Math.hypot(dx, dy); if (m > R) { dx *= R / m; dy *= R / m; } knob.style.transform = `translate(${dx}px,${dy}px)`; stickV = { roll: dx / R, pitch: dy / R }; };
    on(stick, 'pointerdown', e => { stick.setPointerCapture(e.pointerId); stickMove(e); });
    on(stick, 'pointermove', e => { if (stickV) stickMove(e); });
    const stickEnd = () => { stickV = null; knob.style.transform = ''; };
    on(stick, 'pointerup', stickEnd); on(stick, 'pointercancel', stickEnd);
    const rud = $('[data-rud]'), rudK = $('[data-rudk]');
    const rudMove = e => { const r = rud.getBoundingClientRect(); const v = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1); rudV = Math.abs(v) < .08 ? 0 : v; rudK.style.left = `${(v + 1) * 50}%`; };
    on(rud, 'pointerdown', e => { rud.setPointerCapture(e.pointerId); rudMove(e); });
    on(rud, 'pointermove', e => { if (rudV != null) rudMove(e); });
    const rudEnd = () => { rudV = null; rudK.style.left = '50%'; };
    on(rud, 'pointerup', rudEnd); on(rud, 'pointercancel', rudEnd);
    const thrRange = $('[data-thrrange]'); thrRange.oninput = () => { thrTarget = thrRange.value / 100; };
    // glass display: side buttons and the throttle lever
    $$('[data-pf]').forEach(b => {
      const a = b.dataset.pf;
      if (a === 'brake') { on(b, 'pointerdown', () => { touchBrake = true; }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) on(b, ev, () => { touchBrake = false; }); return; }
      b.onclick = () => ({ gear: gearToggle, spoiler: spoilerToggle, trimup: () => trimStep(.04), trimdn: () => trimStep(-.04), flapup: () => flapStep(-1), flapdn: () => flapStep(1),
        park: () => { if (!replay) fc.parking = !fc.parking; }, ap: () => { if (!replay) setAP(!apOn); }, appanel: () => { apPanel = !apPanel; apUI(); }, rev: () => { if (!replay) { fc.reverse = !fc.reverse; tipNow = fc.reverse ? 'Reversers armed: they deploy on the ground with the thrust levers at idle, then add power' : 'Reversers stowed'; tipUntil = performance.now() + 2600; } }, lights: () => { landingLights = !landingLights; },
        gates: () => { showGates = !showGates; store.set(gateKey, showGates); $('[data-gates]')?.setAttribute('aria-pressed', String(showGates)); }, cam: cycleCam, panel: () => setSix(true) })[a]?.();
    });
    { const tr = $('[data-pfthr] .pfd-thr-track'); if (tr) { let drag = false; const set = e => { const r = tr.getBoundingClientRect(); thrTarget = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); };
      on(tr, 'pointerdown', e => { if (replay) return; drag = true; tr.setPointerCapture(e.pointerId); set(e); }); on(tr, 'pointermove', e => { if (drag) set(e); }); on(tr, 'pointerup', () => { drag = false; }); on(tr, 'pointercancel', () => { drag = false; }); } }
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
    $$('[data-flapd]').forEach(b => b.onclick = () => flapStep(+b.dataset.flapd));
    $$('[data-trimb]').forEach(b => { let iv = 0; const go = () => trimStep(+b.dataset.trimb * .03); b.onpointerdown = () => { go(); iv = setInterval(go, 120); }; b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearInterval(iv); });
    let touchBrake = false; const bk = $('[data-brakeb]'); bk.onpointerdown = () => { touchBrake = true; bk.classList.add('on'); }; bk.onpointerup = bk.onpointerleave = bk.onpointercancel = () => { touchBrake = false; bk.classList.remove('on'); };
    $('[data-pbrake]').onclick = () => { fc.parking = !fc.parking; };
    $('[data-touch]').hidden = replay || !coarse;
    root.classList.toggle('is-replay', replay); root.classList.toggle('is-touch', coarse && !replay);

    function readInput(dt) {
      const k = a => a.some(x => keys.has(x));
      let r = (k(['arrowright', 'd']) ? 1 : 0) - (k(['arrowleft', 'a']) ? 1 : 0);
      let p = (k(['arrowdown', 's']) ? 1 : 0) - (k(['arrowup', 'w']) ? 1 : 0);
      let y = (k(['e', 'x']) ? 1 : 0) - (k(['q', 'z']) ? 1 : 0);
      if (k(['=', '+', 'pageup', 'r', 'shift'])) thrTarget = clamp(thrTarget + dt * .6, 0, 1);
      if (k(['-', '_', 'pagedown', 'f', 'control'])) thrTarget = clamp(thrTarget - dt * .6, 0, 1);
      let brake = k(['b', '.']) || touchBrake ? 1 : 0;
      const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
      if (pad) {
        const ax = pad.axes, bt = i => pad.buttons[i]?.pressed;
        const axv = n => { const i = CS.axes[n]; if (i == null || i < 0 || i >= ax.length) return null; return CS.axInv[n] ? -ax[i] : ax[i]; };
        const ar = axv('roll'), ap2 = axv('pitch'), ay = axv('yaw'), at2 = axv('thr');
        if (ar != null && Math.abs(ar) > .06) r = ar; if (ap2 != null && Math.abs(ap2) > .06) p = ap2; if (ay != null && Math.abs(ay) > .1) y = ay;
        if (at2 != null) { if (padThr0 == null) padThr0 = at2; if (Math.abs(at2 - padThr0) > .05) { padThr0 = 9; thrTarget = clamp((at2 + 1) / 2, 0, 1); } }
        const up = pad.buttons[7]?.value || 0, dn = pad.buttons[6]?.value || 0; if (up || dn) thrTarget = clamp(thrTarget + (up - dn) * dt * .7, 0, 1);
        if (padName !== pad.id) { padName = pad.id; const pn = $('[data-padname]'); if (pn) pn.textContent = pad.id.replace(/\(.*?\)/g, '').trim() || 'Controller connected'; fillAxes(ax.length); }
        padAxes = ax;
        if (bt(0)) brake = 1;
        padEdge('fu', bt(5), () => flapStep(1)); padEdge('fd', bt(4), () => flapStep(-1)); padEdge('ap', bt(3), () => setAP(!apOn)); padEdge('cam', bt(2), cycleCam);
        if (bt(12)) trimStep(dt * .5); if (bt(13)) trimStep(-dt * .5);
      }
      if (CS.mouse && mouseV && !replay) { r = mouseV.roll; p = mouseV.pitch; }
      if (stickV) { r = stickV.roll; p = stickV.pitch; }
      if (tilt) { if (Math.abs(tilt.roll) > .06) r = clamp(tilt.roll, -1, 1); if (Math.abs(tilt.pitch) > .06) p = clamp(tilt.pitch, -1, 1); }
      if (rudV != null) y = rudV;
      else if (stickV && fs.ground) y = stickV.roll; // on the ground the stick steers the nosewheel too, as there's no rudder slider on a phone
      if (invert) p = -p;
      // a firm input on an axis the autopilot is flying takes that axis back (the other modes stay on)
      if (apOn && !replay) {
        if (Math.abs(r) > .45 && apLat()) { AP.lnav = false; AP.hdg = null; tipNow = 'Lateral autopilot off: you have the roll'; tipUntil = performance.now() + 2200; apAfter(); }
        if (Math.abs(p) > .45 && apVert()) { AP.vnav = false; AP.alt = AP.vs = null; tipNow = 'Vertical autopilot off: you have the pitch'; tipUntil = performance.now() + 2200; apAfter(); }
      }
      // keyboard input ramps for smoothness; analogue inputs pass straight through
      const ramp = (cur, tgt, rr = 4) => cur + clamp(tgt - cur, -dt * rr * CS.keyRate, dt * rr * CS.keyRate);
      // keys that don't spring back hold their deflection (like trimming the yoke by hand)
      const hold = (cur, tgt, rr) => !CS.centre && tgt === 0 ? cur : ramp(cur, tgt, rr);
      const analog = stickV || pad || tilt || (CS.mouse && mouseV);
      const expo = v => { const a = Math.abs(v), e = CS.expo; return Math.sign(v) * ((1 - e) * a + e * a * a * a); };
      ctl.roll = analog ? expo(r) : hold(ctl.roll, r, 4); ctl.pitch = analog ? expo(p) : hold(ctl.pitch, p, 2.5); ctl.yaw = rudV != null || pad || (stickV && fs.ground) ? expo(y) : ramp(ctl.yaw, y, 3);
      ctl.brake = brake;
      if (!apOn && !replay) { fc.aileron = ctl.roll; fc.elevator = ctl.pitch; fc.rudder = ctl.yaw; fc.throttle = thrTarget; fc.brake = brake; }
      // auto-rudder on the runway: steer for a point on the centreline ahead (like a pilot looking down the runway),
      // so the take-off and landing rolls stay straight; your own rudder input always takes priority
      if ((!apOn || !apLat()) && !replay && fc.autoRudder && fs.ground && Math.abs(ctl.yaw) < .05 && fs.gs > 1.5) {
        const r = rwSt.find(q => { const dx = fs.x - q.rw.A[0], dz = fs.z - q.rw.A[1], u = dx * q.f[0] + dz * q.f[1], w = dx * q.l[0] + dz * q.l[1]; return u > -10 && u < q.rw.len + 10 && Math.abs(w) < q.rw.wid / 2 + 8; });
        if (r) {
          const sgn = Math.cos((fs.hdg - Math.atan2(r.f[0], r.f[1]) * R2D) * D2R) >= 0 ? 1 : -1, dir = [r.f[0] * sgn, r.f[1] * sgn];
          const off = -((fs.x - r.rw.A[0]) * r.l[0] + (fs.z - r.rw.A[1]) * r.l[1]), look = 30 + fs.gs * 1.5;
          const want = Math.atan2(dir[0] * look + r.l[0] * off, dir[1] * look + r.l[1] * off) * R2D, err = wrap180(want - fs.hdg);
          // ask for a gentle yaw rate towards that heading, then work out the nosewheel angle that gives it
          // (the steering gets weaker with speed, as in the flight model), so it settles instead of swinging
          const tail = !!FM.p.tail, wr = clamp(err * D2R * 1.1, -.18, .18), vf = Math.max(2, fs.gs), maxS = (tail ? 18 : 28) * D2R * (1 - clamp(vf / 35, 0, .75));
          fc.rudder = clamp(Math.atan(wr * (FM.p.wb || 1.7) / vf) / maxS, -1, 1);
        }
      }
      if (Math.abs(thrRange.value / 100 - thrTarget) > .02 && document.activeElement !== thrRange) thrRange.value = Math.round(thrTarget * 100);
    }
    let padName = null, padAxes = [], padThr0 = null, detecting = null;
    function fillAxes(n) { $$('[data-axis]').forEach(sel => { const k = sel.dataset.axis; sel.innerHTML = `<option value="-1">None</option>` + Array.from({ length: Math.max(n, 4) }, (_, i) => `<option value="${i}">Axis ${i + 1}</option>`).join(''); sel.value = String(CS.axes[k] ?? -1); }); }
    function syncSet() {
      const el = $('[data-set]'); if (!el) return;
      $$('[data-cs]').forEach(i => { const k = i.dataset.cs; if (i.type === 'checkbox') i.checked = k === 'invert' ? invert : k === 'autoRudder' ? fc.autoRudder : !!CS[k]; else i.value = k === 'expo' ? Math.round(CS.expo * 100) : Math.round(CS.keyRate * 100); });
      $$('[data-axinv]').forEach(i => { i.checked = !!CS.axInv[i.dataset.axinv]; });
      if (!$('[data-axis] option')) fillAxes(padAxes.length || 4);
    }
    function openSet() { const el = $('[data-set]'); el.hidden = !el.hidden; if (!el.hidden) syncSet(); }
    $('[data-setb]').onclick = openSet; $('[data-setx]').onclick = () => { $('[data-set]').hidden = true; };
    $$('[data-cs]').forEach(i => i.oninput = () => { const k = i.dataset.cs;
      if (k === 'invert') { invert = i.checked; store.set('invert', invert); }
      else if (k === 'autoRudder') { fc.autoRudder = i.checked; store.set('autorudder', fc.autoRudder); }
      else if (i.type === 'checkbox') CS[k] = i.checked;
      else CS[k] = k === 'expo' ? i.value / 100 : i.value / 100;
      saveCS(); });
    $$('[data-axis]').forEach(sel => sel.onchange = () => { CS.axes[sel.dataset.axis] = +sel.value; if (sel.dataset.axis === 'thr') padThr0 = null; saveCS(); });
    $$('[data-axinv]').forEach(i => i.onchange = () => { CS.axInv[i.dataset.axinv] = i.checked; saveCS(); });
    $$('[data-detect]').forEach(b => b.onclick = () => { detecting = { k: b.dataset.detect, base: [...padAxes], b }; b.textContent = 'Move it…'; });
    // live axis bars in the settings panel, and axis detection (the axis that moves furthest wins)
    setInterval(() => { const el = $('[data-set]'); if (!el || el.hidden || !alive) return;
      const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null; if (!pad) return; padAxes = [...pad.axes];
      if (detecting) { const d = padAxes.map((v, i) => Math.abs(v - (detecting.base[i] ?? 0))), i = d.indexOf(Math.max(...d)); if (d[i] > .5) { CS.axes[detecting.k] = i; saveCS(); detecting.b.textContent = 'Detect'; detecting = null; fillAxes(padAxes.length); } }
      $$('[data-axbar]').forEach(bar => { const k = bar.dataset.axbar, i = CS.axes[k]; let v = i >= 0 ? padAxes[i] ?? 0 : 0; if (CS.axInv[k]) v = -v; bar.firstChild.style.left = `${(v + 1) * 50}%`; });
    }, 80);
    // mouse yoke: the pointer's position across the view is the control position (centre = neutral)
    on($('[data-map]'), 'pointermove', e => { if (e.pointerType !== 'mouse') return; const r = $('[data-map]').getBoundingClientRect(); const dz = v => Math.abs(v) < .04 ? 0 : (v - Math.sign(v) * .04) / .96;
      mouseV = { roll: dz(clamp(((e.clientX - r.left) / r.width * 2 - 1) * 1.6, -1, 1)), pitch: dz(clamp(((e.clientY - r.top) / r.height * 2 - 1) * 1.8, -1, 1)) }; });
    on($('[data-map]'), 'pointerleave', () => { if (CS.mouse) mouseV = { roll: 0, pitch: 0 }; });
    const padPrev = {}; function padEdge(id, down, fn) { if (down && !padPrev[id]) fn(); padPrev[id] = down; }

    /* ---- autopilot: works out targets from the route, then flies the controls (BoploPhysics.pilot) ---- */
    function autopilot(dt) {
      const pr = path.project(st.x, st.z), vk = st.v / KT, remain = L - pr.s;
      const look = clamp(st.gs * 7, 180, 900), [tx, tz] = path.at(pr.s + look);
      const routeTrk = Math.atan2(tx - st.x, tz - st.z) * R2D;
      const approach = landEnd && remain < (circuit ? 1500 : 5000) && (replay || (AP.lnav && AP.vnav));
      const t = { phase: st.ground ? (st.landedOnce ? 'rollout' : 'takeoff') : 'air', trk: routeTrk, bankMax: st.agl < 60 && approach ? 6 : 25, approach };
      if (st.ground) { const [ax, az] = path.at(pr.s + Math.max(60, st.gs * 4)); t.trk = Math.atan2(ax - st.x, az - st.z) * R2D; t.flaps = 0; }
      if (!replay && AP.hdg != null && !st.ground) { t.trk = AP.hdg; t.useHdg = true; }
      // vertical: route profile, or the selected altitude
      let ta = prof(pr.s + Math.max(st.v, 20) * 5);
      if (approach && remain < 3500) ta = Math.min(ta, st.gnd + Math.max(0, remain - TDZ) * DG);
      if (!approach) { const ah = path.at(pr.s + 900), ga = elevAt(ah[0], ah[1]); if (ga != null) ta = Math.max(ta, ga + 160); ta = Math.max(ta, st.gnd + 120); }
      if (!replay && AP.alt != null) ta = AP.alt * FT + geoN;
      t.alt = ta;
      // selected vertical speed: flown towards the selected altitude, or held on its own
      if (!replay && AP.vs != null) { const v = AP.vs * FT / 60; if (AP.alt != null) { t.vsUp = t.vsDn = Math.max(.5, Math.abs(v)); } else { t.vs = v; t.alt = undefined; } }
      // on the approach the autopilot adds flap as it gets closer, but never takes away flap you already have
      if (approach) { t.spd = st.agl < 60 ? PF.appr : PF.appr + 10; t.flaps = Math.max(fc.flaps, remain < (circuit ? 900 : 3000) ? FM.notches - 1 : Math.min(1, FM.notches - 1)); if (st.agl < 5) t.phase = 'flare'; }
      else { t.spd = PF.cruise * (circuit ? .82 : .92); t.flaps = 0; if (ta - st.alt > 40 && !st.ground) { t.thr = 1; t.spd = undefined; } }
      if (!replay && AP.spd != null && !approach) { t.spd = AP.spd; t.thr = undefined; }
      // like a real autopilot, it leaves the flaps to you; and once you pick your own modes, the throttle is yours unless SPD is on
      if (!replay) t.flaps = undefined; // like a real autopilot, it leaves the flaps to you
      flareNow = t.phase === 'flare';
      if (!replay && approach && !st.ground && st.agl < 200 * FT && remain < 2500) { setAP(false); tipNow = 'Autopilot disconnected at 200 ft. You have control: land the aircraft'; tipUntil = performance.now() + 4000; return; }
      const trim0 = fc.trim, park0 = fc.parking;
      BoploPhysics.pilot(FM, t, dt);
      // hand back every axis the autopilot isn't flying
      if (!replay) {
        if (!apLat()) { fc.aileron = ctl.roll; fc.rudder = ctl.yaw; }
        if (!apVert()) { fc.elevator = ctl.pitch; fc.trim = trim0; }
        if (!apSpd()) fc.throttle = thrTarget;
        fc.brake = apSpd() ? Math.max(fc.brake, ctl.brake || 0) : (ctl.brake || 0); fc.parking = park0;
      }
      if (apSpd()) thrTarget = fc.throttle;
    }

    // Photo tiles load coarse first, and a coarse tile can be tens of metres off. Once the detailed tiles around a runway
    // have loaded (we're within a few km and the tileset says it's settled), measure the runway again; if it moved,
    // move the runway, its lights, the glidepath and, early in an approach or on the ground, the aircraft with it.
    let refineT = 0;
    function refineRunways(dt) {
      if (!tileset || replay) return; refineT += dt; if (refineT < 1.5) return; refineT = 0;
      if (!tileset.tilesLoaded) return;
      for (const r of rwSt) {
        if ((r.refined || 0) >= 2 || r.pending) continue;
        const c = add(r.rw.A, r.f, r.rw.len / 2), d = Math.hypot(c[0] - st.x, c[1] - st.z);
        if (d > (r.refined ? 2500 : 7000)) continue;
        const vals = r.pts.map(pt => elevAt(pt[0], pt[1], true)); if (vals.filter(Number.isFinite).length < r.pts.length * .6) continue;
        const old = r.h.slice(), all = [null, null]; for (const q of rwSt) for (let j = 0; j < q.pts.length; j++) all.push(q === r ? vals[j] : null);
        shapeRunways(all, r); r.refined = (r.refined || 0) + 1;
        const dif = r.h.map((v, i) => v - old[i]).sort((a, b) => a - b), shift = dif[dif.length >> 1];
        if (Math.abs(shift) < .6) continue;
        const onIt = fs.ground && rwAt(fs.x, fs.z) && rwSt.find(q => q === r);
        drawRunways(); buildRunwayLights();
        if (arrE && r.rw === arrE.rw) { const b = rwHeight(landPt[0], landPt[1]); if (b != null) g1 = b; }
        if (depE && r.rw === depE.rw) { const a = rwHeight(P[0][0], P[0][1]); if (a != null && fs.ground) g0 = a; }
        const n = geoFrom(depE, O.fromElevFt) ?? geoFrom(arrE, O.toElevFt); if (n != null) geoN = n;
        planCruise(); planGates();
        if (onIt) { fs.alt = groundAt(fs.x, fs.z); fs.v[1] = 0; lastG = fs.alt; }
        else if (!fs.ground && PRF && arrE && r.rw === arrE.rw && st.t < 45) fs.alt += shift;
        sync();
      }
    }

    /* ---- flight model ---- */
    function step(dt) {
      st.t += dt;
      FM.step(dt, windAt(dt));
      if (!datumFixed && groundStart) { const gr = elevAt(st.x, st.z); if (gr != null && Math.hypot(st.x - P[0][0], st.z - P[0][1]) < 600) fixDatum(gr + (rwSt.length && depE ? .35 : 0)); }
      st.gk = elevAt(st.x, st.z) != null || !!rwAt(st.x, st.z);
      rwLazyT += dt; refineRunways(dt);
      if (rwLazyT > 2 && rwSt.some(r => r.pending)) { rwLazyT = 0;
        for (const r of rwSt) { if (!r.pending || rwAt(st.x, st.z)) continue; const c = add(r.rw.A, r.f, r.rw.len / 2); if (Math.hypot(c[0] - st.x, c[1] - st.z) > 9000) continue;
          const vals = r.pts.map(pt => elevAt(pt[0], pt[1], true)); if (vals.filter(Number.isFinite).length < r.pts.length / 2) continue;
          const all = [null, null]; for (const q of rwSt) for (let j = 0; j < q.pts.length; j++) all.push(q === r ? vals[j] : null);
          shapeRunways(all, r); r.pending = false; drawRunways(); buildRunwayLights();
          if (arrE && r.rw === arrE.rw) { const b = rwHeight(landPt[0], landPt[1]); if (b != null) { g1 = b; planGates(); } } }
      }
      sync();
      if (!st.ground) st.airT = (st.airT || 0) + dt;
    }

    /* ---- score (fly mode) ---- */
    const score = { t: 0, tube: 0, xteSum: 0, altSum: 0, maxAlt: st.alt, dist: 0, n: 0 };
    let lastFlown = 0, lastX = st.x, lastZ = st.z;

    let camH = st.hdg, camD = 8.5, camPitchLag = 0;

    /* ---- HUD ---- */
    let apT = 0;
    const H = { six: $('[data-six]'), trim: $('[data-trimi]'), rpm: $('[data-rpm]'), ind: Object.fromEntries($$('[data-ind]').map(e => [e.dataset.ind, e])), ias: $('[data-ias]'), alt: $('[data-alt]'), vs: $('[data-vs]'), hdg: $('[data-hdg]'), tape: $('[data-tape]'), hor: $('[data-hor]'), bp: $('[data-bankptr]'), thr: $('[data-thr]'), flaps: $('[data-flaps]'), wp: $('[data-wp]'), wpd: $('[data-wpd]'), warn: $('[data-warn]'), needle: $('[data-needle]'), xte: $('[data-xte]'), bug: $('[data-bugi]'), time: $('[data-time]'), scrub: $('[data-scrub]') };
    const wpts = (O.waypoints || []).map(w => ({ ...w, s: path.project(...F.to(w.lat, w.lng), true).s })); path.seed(0);
    let warnText = '', tipText = '', tipNow = '', tipUntil = 0;
    const tipEl = document.createElement('div'); tipEl.className = 'sim-tip'; tipEl.setAttribute('role', 'status'); $('[data-warn]').after(tipEl);
    const PE = { spdt: $('[data-spdt]'), altt: $('[data-altt]'), gnd: $('[data-gndb]'), spd: $('[data-pspd]'), alt: $('[data-palt]'), gs: $('[data-pgs]'), agl: $('[data-pagl]'), vsi: $('[data-pvsi]'), vs: $('[data-pvs]'), rose: $('[data-rose]'), rbug: $('[data-rbug]'), rcrs: $('[data-rcrs]'), hdg: $('[data-phdg]'),
      gear: $('[data-pfgear]'), sp: $('[data-pfsp]'), rev: $('[data-pfrev]'), trim: $('[data-pftrim]'), trimi: $('[data-pftrimi]'), flaps: $('[data-pfflaps]'), park: $('[data-pfpark]'), ap: $('[data-pfap]'), lt: $('[data-pflt]'), gt: $('[data-pfgt]'), thf: $('[data-pfthrf]'), thn: $('[data-pfthrn]'), thk: $('[data-pfthrk]'), thv: $('[data-pfthrv]'),
      roll: $('[data-hroll]'), pitch: $('[data-hpitch]'), bank: $('[data-hbank]'), fpv: $('[data-fpv]'), htape: $('[data-htape]'), hbug: $('[data-hbug]'), htrk: $('[data-htrk]'), hwarn: $('[data-hwarn]'),
      sband: $('[data-sband]'), aband: $('[data-aband]'), oband: $('[data-oband]'), sbug: $('[data-sbug]'), strend: $('[data-strend]'), abug: $('[data-abug]'), ibar: $('[data-ibar]'), flv: $('[data-flvtrack]') };
    let pfdN = 0, iasPrev = null, trendKt = 0;
    // ---- info bar (top): tap a box to cycle what it shows, like Infinite Flight; the choice is remembered per screen size
    const ISA_A = h => 340.29 * Math.sqrt(Math.max(216.65, 288.15 - .0065 * h) / 288.15);
    const IB = {
      ias: ['IAS', () => `${Math.round(st.ground && st.v / KT < 5 ? 0 : st.v / KT)} kt`],
      gs: ['GS', () => `${Math.round(st.gs / KT)} kt`],
      tas: ['TAS', () => `${Math.round((fs.tas ?? st.v) / KT)} kt`],
      mach: ['Mach', () => `M ${((fs.tas ?? st.v) / ISA_A(st.alt - geoN)).toFixed(2).replace(/^0/, '')}`],
      alt: ['ALT MSL', () => `${(Math.round((st.alt - geoN) / FT / 10) * 10).toLocaleString('en-GB')} ft`],
      agl: ['AGL', () => `${(Math.round(Math.max(0, st.agl / FT) / 10) * 10).toLocaleString('en-GB')} ft`],
      vs: ['V/S', () => { const f = Math.round(st.vs / FT * 60 / 50) * 50; return `${f > 0 ? '+' : f < 0 ? '−' : ''}${Math.abs(f).toLocaleString('en-GB')} fpm`; }],
      hdg: ['HDG', () => `${pad3(st.hdg)}°`],
      trk: ['TRK', () => `${pad3(st.trk)}°`],
      wind: ['Wind', () => O.wind?.spd ? `${pad3(O.wind.dir)}° / ${Math.round(O.wind.spd)} kt` : 'Calm'],
      next: ['Next', () => `${H.wp.textContent} ${(H.wpd.textContent.split('·')[1] || '').trim()}`],
      ete: ['ETE next', () => (H.wpd.textContent.split('·')[2] || '—').trim()],
      dest: ['To dest', () => { const pr = path.project(st.x, st.z); return `${Math.max(0, (L - pr.s) / NM).toFixed((L - pr.s) / NM < 10 ? 1 : 0)} NM`; }],
      eta: ['ETE dest', () => { const pr = path.project(st.x, st.z); return st.gs > 10 ? mmss((L - pr.s) / st.gs) : '—'; }],
      eng: [AC.jet ? 'N1' : 'RPM', () => AC.jet ? `${Math.round(fs.n1 || 0)}%` : `${fs.rpm || 0}`],
      flaps: ['Flaps', () => FM.notches > 1 ? FM.flapLabel() : '—'],
      g: ['Load', () => `${(fs.g ?? 1).toFixed(1)} g`],
      aoa: ['AoA', () => `${((fs.alpha || 0) * R2D).toFixed(1)}°`]
    };
    const IB_KEYS = Object.keys(IB).filter(k => AC.jet || k !== 'mach');
    let ibN = 0, ibSel = [], ibCells = [];
    function buildIbar() {
      const w = root.clientWidth, n = w < 560 || root.clientHeight < 520 ? 4 : w < 980 ? 6 : 8; if (n === ibN) return; ibN = n;
      const def = { 4: ['ias', 'alt', 'vs', 'next'], 6: ['ias', 'gs', 'alt', 'vs', 'hdg', 'next'], 8: ['ias', 'gs', 'alt', 'vs', 'hdg', 'next', 'ete', 'dest'] }[n];
      ibSel = store.get('ibar2-' + n, def).filter(k => IB[k] && IB_KEYS.includes(k)); while (ibSel.length < n) ibSel.push(def.find(k => !ibSel.includes(k)) || 'gs');
      PE.ibar.innerHTML = ibSel.map((k, i) => `<button type="button" class="ib" data-ibi="${i}" aria-label="${esc(IB[k][0])}, tap to change"><span>${esc(IB[k][0])}</span><b>—</b></button>`).join('');
      ibCells = [...PE.ibar.querySelectorAll('.ib')].map(b => ({ b, l: b.firstChild, v: b.lastChild }));
      ibCells.forEach((c, i) => c.b.onclick = () => {
        const cur = IB_KEYS.indexOf(ibSel[i]); let nx = cur;
        for (let j = 1; j <= IB_KEYS.length; j++) { const k = IB_KEYS[(cur + j) % IB_KEYS.length]; if (!ibSel.includes(k)) { nx = IB_KEYS.indexOf(k); break; } }
        ibSel[i] = IB_KEYS[nx]; store.set('ibar2-' + ibN, ibSel); c.l.textContent = IB[ibSel[i]][0]; c.b.setAttribute('aria-label', `${IB[ibSel[i]][0]}, tap to change`); c.v.textContent = IB[ibSel[i]][1]();
      });
    }
    // flap lever on the right edge: one stop per notch, tap a stop to move there
    if (PE.flv) {
      const n = FM.notches; PE.flv.innerHTML = Array.from({ length: n }, (_, i) => `<button type="button" data-fln="${i}" style="top:${n > 1 ? i / (n - 1) * 100 : 0}%" aria-label="Flaps ${esc((FM.p.notch[i] || {}).label || i)}"><span>${esc((FM.p.notch[i] || {}).label || '')}</span></button>`).join('') + '<b data-flvk></b>';
      PE.flvk = $('[data-flvk]');
      $$('[data-fln]').forEach(b => b.onclick = () => { const d = +b.dataset.fln - fc.flaps; if (d) flapStep(d); });
      if (n < 2) $('[data-flever]').classList.add('none');
    }
    const hudK = 6;
    function pfd(vk, pr) {
      const ias = st.ground && vk < 5 ? 0 : vk, altFt = (st.alt - geoN) / FT, aglFt = Math.max(0, st.agl / FT), fpm = st.vs / FT * 60;
      // HUD: pitch ladder, bank, flight path marker, heading tape
      const b = st.bank, pt = st.att ?? st.pitch;
      PE.roll.setAttribute('transform', `rotate(${-b})`); PE.pitch.setAttribute('transform', `translate(0 ${pt * hudK})`); PE.bank.setAttribute('transform', `rotate(${-b})`);
      if (st.gs > 8 * KT || !st.ground) {
        const gam = Math.atan2(st.vs, Math.max(st.gs, 1)) * R2D, drift = clamp(wrap180(st.trk - st.hdg), -25, 25);
        const dx = drift * hudK, dy = (pt - gam) * hudK, th = -b * D2R, x = clamp(dx * Math.cos(th) - dy * Math.sin(th), -160, 160), y = clamp(dx * Math.sin(th) + dy * Math.cos(th), -100, 110);
        PE.fpv.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`); PE.fpv.style.opacity = 1;
      } else PE.fpv.style.opacity = .35;
      const near = (a, ref) => a + Math.round((ref - a) / 360) * 360, h = st.hdg < 180 ? st.hdg + 360 : st.hdg;
      PE.htape.setAttribute('transform', `translate(${(-h * 4).toFixed(1)} -158)`);
      PE.htrk.setAttribute('transform', `translate(${(near(st.trk, h) * 4).toFixed(1)} 0)`);
      const bug = apOn && AP.hdg != null ? AP.hdg : null; PE.hbug.style.display = bug == null ? 'none' : ''; if (bug != null) PE.hbug.setAttribute('transform', `translate(${(near(bug, h) * 4).toFixed(1)} 0)`);
      // speed tape with the stall band, trend arrow and selected speed
      PE.spdt.setAttribute('transform', `translate(0 ${ias * 4})`); PE.spd.textContent = Math.round(ias);
      { const now = performance.now(), dtp = iasPrev ? (now - iasPrev.t) / 1000 : 0; if (dtp > .01 && dtp < .5 && !paused) trendKt += ((ias - iasPrev.v) / dtp * 10 - trendKt) * .15; iasPrev = { v: ias, t: now }; }
      PE.strend.setAttribute('y2', clamp(-trendKt * 4, -160, 160).toFixed(1));
      PE.altt.setAttribute('transform', `translate(0 ${altFt * .4})`); PE.alt.textContent = (Math.round(altFt / 10) * 10).toLocaleString('en-GB');
      PE.gnd.setAttribute('y', (altFt - (st.alt - st.agl - geoN) / FT) * .4 + 0);
      PE.vsi.style.height = `${Math.min(50, Math.abs(fpm) / 40)}%`; PE.vsi.classList.toggle('dn', fpm < 0); PE.vs.textContent = `${fpm >= 0 ? '+' : '−'}${Math.abs(Math.round(fpm / 50) * 50)}`;
      PE.rose.setAttribute('transform', `rotate(${-st.hdg})`); PE.hdg.textContent = pad3(st.hdg) + '°';
      PE.rbug.style.display = bug == null ? 'none' : ''; if (bug != null) PE.rbug.setAttribute('transform', `rotate(${bug})`);
      const eng = AC.jet ? (fs.n1 || 0) : (fs.power ?? st.thr) * 100;
      PE.thf.style.height = `${Math.round(thrTarget * 100)}%`; PE.thk.style.bottom = `${Math.round(thrTarget * 100)}%`; PE.thn.style.height = `${clamp(AC.jet ? (eng - 20) / 80 * 100 : eng, 0, 100)}%`;
      PE.thv.textContent = fc.reverse && fs.ground ? 'REV' : AC.jet ? `${Math.round(fs.n1 || 0)}%` : `${Math.round(thrTarget * 100)}%`;
      if (PE.flvk) { const n = FM.notches; PE.flvk.style.top = `${n > 1 ? fc.flaps / (n - 1) * 100 : 0}%`; }
      // warnings, most urgent first, on the HUD
      const vsCur = (() => { const n = FM.notches, f = n > 1 ? fc.flaps / (n - 1) : 0, vso = FM.p.vso || PF.vs * .85; return PF.vs + (vso - PF.vs) * f; })();
      const vfe = fc.flaps > 0 && FM.p.vfe ? FM.p.vfe : null, vlim = vfe ?? (FM.p.vne ? FM.p.vne * .97 : PF.vmax * 1.12);
      let w = '';
      if (!st.ground && !st.crashed) {
        if (fs.stallWarn) w = 'STALL';
        else if (st.agl < 300 && fpm < -1800 - st.agl * 3) w = 'PULL UP';
        else if (ias > vlim) w = vfe ? 'FLAP OVERSPEED' : 'OVERSPEED';
        else if (AC.jet && (fs.gearPos ?? 1) < .95 && st.agl < 250 && fpm < -200) w = 'GEAR';
        else if (Math.abs(st.bank) > 50) w = 'BANK ANGLE';
      }
      if (PE.hwarn.textContent !== w) { PE.hwarn.textContent = w; PE.hwarn.classList.toggle('red', w === 'STALL' || w === 'PULL UP'); }
      if (++pfdN % 6) return; // the rest changes slowly: refresh a few times a second
      PE.sband.setAttribute('y', (-vsCur * 4).toFixed(1)); PE.sband.setAttribute('height', (vsCur * 4).toFixed(1));
      PE.aband.setAttribute('y', (-vsCur * 1.13 * 4).toFixed(1)); PE.aband.setAttribute('height', (vsCur * .13 * 4).toFixed(1));
      PE.oband.setAttribute('y', (-1800).toFixed(1)); PE.oband.setAttribute('height', Math.max(0, 1800 - vlim * 4).toFixed(1));
      const sb = apOn && AP.spd != null ? AP.spd : null; PE.sbug.style.display = sb == null ? 'none' : ''; if (sb != null) PE.sbug.setAttribute('transform', `translate(0 ${-sb * 4})`);
      const ab = apOn && AP.alt != null ? AP.alt : null; PE.abug.style.display = ab == null ? 'none' : ''; if (ab != null) PE.abug.setAttribute('transform', `translate(0 ${-ab * .4})`);
      PE.gs.textContent = `GS ${Math.round(st.gs / KT)}`; PE.agl.textContent = aglFt < 2500 ? `RA ${Math.round(aglFt / 10) * 10}` : `AGL ${(Math.round(aglFt / 100) * 100).toLocaleString('en-GB')}`;
      if (PE.gear) { const g = fs.gearPos ?? 1; PE.gear.textContent = g >= .99 ? 'Down' : g <= .01 ? 'Up' : 'Moving'; PE.gear.parentElement.classList.toggle('on', g >= .99); PE.gear.parentElement.classList.toggle('warn', g > .01 && g < .99); }
      if (PE.sp) { PE.sp.textContent = (fs.spoilerPos || 0) > .5 ? 'Out' : fc.spoiler ? 'Armed' : 'In'; PE.sp.parentElement.classList.toggle('on', (fs.spoilerPos || 0) > .5 || !!fc.spoiler); }
      if (PE.rev) { PE.rev.textContent = fs.revPos > .5 ? 'Deployed' : fc.reverse ? 'Armed' : 'Off'; PE.rev.parentElement.classList.toggle('on', !!fc.reverse); PE.rev.parentElement.classList.toggle('warn', fs.revPos > .5); }
      PE.trim.textContent = Math.abs(fc.trim) < .04 ? '0' : `${fc.trim > 0 ? '+' : '−'}${Math.round(Math.abs(fc.trim) * 100)}`; if (PE.trimi) PE.trimi.style.bottom = `${50 + fc.trim * 46}%`;
      PE.flaps.textContent = FM.notches > 1 ? FM.flapLabel() : '—';
      PE.park.textContent = fc.parking ? 'Set' : 'Off'; PE.park.parentElement.classList.toggle('on', fc.parking);
      PE.ap.textContent = apOn ? 'On' : 'Off'; PE.ap.parentElement.classList.toggle('on', apOn);
      PE.lt.textContent = landingLights ? 'On' : 'Off'; PE.lt.parentElement.classList.toggle('on', landingLights);
      PE.gt.textContent = showGates ? 'On' : 'Off'; PE.gt.parentElement.classList.toggle('on', showGates);
      buildIbar(); ibCells.forEach((c, i) => { const t = IB[ibSel[i]][1](); if (c.v.textContent !== t) c.v.textContent = t; });
      if (apPanel && pfdN % 12 === 0) apUI();
    }
    function hud() {
      const vk = st.v / KT, pr = path.project(st.x, st.z);
      H.ias.textContent = Math.round(st.ground && vk < 5 ? 0 : vk);
      H.alt.textContent = Math.max(0, Math.round((st.alt - geoN) / FT / 10) * 10).toLocaleString('en-GB');
      const fpm = Math.round(st.vs / FT * 60 / 50) * 50; H.vs.textContent = `${fpm > 0 ? '↑' : fpm < 0 ? '↓' : ''}${Math.abs(fpm)} fpm`;
      H.hdg.textContent = pad3(st.hdg) + '°';
      H.tape.setAttribute('transform', `translate(${120 - (st.hdg + 180) * 4} 0)`);
      H.hor.setAttribute('transform', `rotate(${-st.bank}) translate(0 ${(st.att ?? st.pitch) * 2.2})`); H.bp.setAttribute('transform', `rotate(${-st.bank})`);
      H.thr.style.height = `${Math.round(st.thr * 100)}%`;
      H.trim.style.bottom = `${50 + fc.trim * 46}%`; H.rpm.textContent = fs.rpm;
      const lamp = (k, v) => H.ind[k]?.classList.toggle('on', !!v); lamp('park', fc.parking); lamp('brake', fc.brake > .05); lamp('carb', fc.carbHeat); lamp('rud', fc.autoRudder);
      H.flaps.textContent = FM.notches > 1 ? `Flaps ${FM.flapLabel()}` : 'No flaps'; H.flaps.classList.toggle('on', fc.flaps > 0);
      if (root.classList.contains('hud-on')) pfd(vk, pr);
      drawMini();
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
      else if (st.stall) w = fs.stalled ? 'Stall' : 'Stall warning';
      else if (!st.ground && st.agl < 100 && st.vs < -4 && !(landEnd && L - pr.s < 2500)) w = 'Pull up';
      else if (!st.ground && vk > PF.vmax * 1.25) w = 'Overspeed';
      if (w !== warnText) { warnText = w; H.warn.textContent = w; H.warn.classList.toggle('on', !!w); }
      if (showSix || cockpit()) {
        const [cx2, cz2] = path.at(pr.s + 400), crs = norm360(Math.atan2(cx2 - st.x, cz2 - st.z) * R2D);
        drawSixPack(H.six, { ias: st.v / KT, pitch: st.pitch, bank: st.bank, altFt: (st.alt - geoN) / FT, vsFpm: st.vs / FT * 60, hdg: st.hdg, turn: fs.turn || 0, slip: fs.slip || 0,
          bug: AP.hdg != null && apOn ? AP.hdg : null, crs: replay || AP.lnav ? crs : null, dev: (pr.side > 0 ? 1 : -1) * pr.d / NM / (circuit ? .5 : 2),
          vs: FM.p.vs, vso: FM.p.vso || FM.p.vs, vfe: FM.p.vfe, vno: FM.p.vno, vne: FM.p.vne, qnh: INHG ? '29.92' : '1013', rpm: fs.rpm, thr: fs.power, flaps: FM.notches > 1 ? FM.flapLabel() : '—', trim: fc.trim,
          park: fc.parking, brake: fc.brake > .05, carb: fc.carbHeat, autoRud: fc.autoRudder, stall: st.stall, ap: apOn });
      }
      if (apOn && !replay) { apT = (apT || 0) + 1; if (apT % 10 === 0) apUI(); }
      let tip = '';
      if (performance.now() < tipUntil) tip = tipNow;
      else if (!replay && !apOn && !st.crashed) {
        if (st.ground && fc.parking && thrTarget > .2) tip = coarse ? 'The parking brake is on: tap Park to release it' : 'The parking brake is on: press Shift+B to release it';
        else if (st.ground && !st.landedOnce && st.thr < .5) tip = coarse ? 'Push the power slider up to start your take-off roll' : 'Add power: hold R, or press 0 for full power';
        else if (st.ground && !st.landedOnce && vk > PF.vr - 12) tip = coarse ? 'Gently pull the stick back to lift off' : `Gently hold ↓ (or S) to lift off at about ${PF.vr} kt`;
        else if (!st.ground && !PRF && depE && st.t < 60 && st.agl < 200) tip = 'Climb towards the first gate';
        else if (!st.ground && landEnd && L - pr.s < 2500 && L - pr.s > 300) tip = 'Line up with the route, reduce power and descend gently to land';
      }
      if (tip !== tipText) { tipText = tip; tipEl.textContent = tip; tipEl.classList.toggle('on', !!tip); }
      if (replay) { H.time.textContent = `${mmss(st.t)} · ${(pr.s / NM).toFixed(1)}/${(L / NM).toFixed(1)} NM`; if (document.activeElement !== H.scrub) H.scrub.value = Math.round(pr.s / L * 1000); }
      return pr;
    }

    /* ---- controls ---- */
    function apUI() {
      const bar = $('[data-apbar]'); bar.hidden = !apPanel || replay;
      $('[data-pf="appanel"]')?.setAttribute('aria-expanded', String(apPanel && !replay));
      const on = m => m === 'lnav' || m === 'vnav' ? AP[m] : AP[m] != null;
      $$('[data-apm]').forEach(b => b.setAttribute('aria-pressed', String(apOn && on(b.dataset.apm))));
      const ms = $('[data-apmaster]'); ms.setAttribute('aria-pressed', String(apOn)); $('[data-apms]').textContent = apOn ? 'On' : 'Off';
      const v = m => AP[m] ?? apCur(m);
      $('[data-apv="hdg"]').textContent = pad3(v('hdg')) + '°'; $('[data-apv="alt"]').textContent = v('alt').toLocaleString('en-GB') + ' ft';
      $('[data-apv="spd"]').textContent = v('spd') + ' kt'; { const x = v('vs'); $('[data-apv="vs"]').textContent = `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toLocaleString('en-GB')} fpm`; }
      $$('[data-apv]').forEach(e => e.classList.toggle('sel', apOn && AP[e.dataset.apv] != null));
    }
    const apCur = m => m === 'hdg' ? Math.round(st.hdg) : m === 'alt' ? Math.round((st.alt - geoN) / FT / 100) * 100 : m === 'vs' ? Math.round(st.vs / FT * 60 / 100) * 100 : Math.round(st.v / KT);
    // after a mode change: the autopilot is on while any mode is
    function apAfter() { const any = AP.lnav || AP.vnav || AP.hdg != null || AP.alt != null || AP.vs != null || AP.spd != null; if (any !== apOn) setAP(any, true); else { FM.ap = null; apUI(); } }
    function setAP(v, keep) {
      apOn = v;
      if (v && !keep && !replay && !(AP.lnav || AP.vnav || AP.hdg != null || AP.alt != null || AP.vs != null || AP.spd != null)) { AP.lnav = true; AP.vnav = true; AP.spd = st.ground ? Math.round(PF.cruise * .9) : apCur('spd'); }
      if (!v && !keep) { AP.lnav = AP.vnav = false; AP.hdg = AP.alt = AP.vs = AP.spd = null; }
      if (v) FM.ap = null;
      $('[data-ap]').setAttribute('aria-pressed', String(v)); $('[data-ap]').classList.toggle('on', v); apUI();
    }
    $$('[data-apm]').forEach(b => b.onclick = () => {
      if (replay) return; const m = b.dataset.apm;
      if (m === 'lnav' || m === 'vnav') { AP[m] = !(apOn && AP[m]); if (AP[m]) { if (m === 'lnav') AP.hdg = null; else AP.alt = AP.vs = null; } }
      else if (apOn && AP[m] != null) AP[m] = null;
      else { AP[m] = apCur(m); if (m === 'hdg') AP.lnav = false; if (m === 'alt' || m === 'vs') AP.vnav = false; }
      if (!apOn) { apOn = true; FM.ap = null; for (const k of ['lnav', 'vnav']) if (k !== m && !AP[k]) AP[k] = false; } apAfter();
    });
    // − / + step the value; hold to keep stepping
    $$('[data-apd]').forEach(b => {
      const stepOnce = () => { if (replay) return; const m = b.dataset.apd; let dlt = +b.dataset.d; if (m === 'alt' && !AC.jet) dlt = Math.sign(dlt) * 100;
        if (AP[m] == null) { AP[m] = apCur(m); if (m === 'hdg') AP.lnav = false; if (m === 'alt' || m === 'vs') AP.vnav = false; }
        AP[m] = m === 'hdg' ? norm360(AP[m] + dlt) : m === 'spd' ? clamp(AP[m] + dlt, Math.round(PF.vs * 1.2), Math.round(PF.vmax)) : m === 'vs' ? clamp(AP[m] + dlt, AC.jet ? -6000 : -2000, AC.jet ? 6000 : 2000) : Math.max(0, AP[m] + dlt);
        if (!apOn) { apOn = true; FM.ap = null; } apAfter(); };
      let rep = 0, hold = 0; const stop = () => { clearTimeout(hold); clearInterval(rep); };
      b.onpointerdown = e => { e.preventDefault(); stepOnce(); hold = setTimeout(() => { rep = setInterval(stepOnce, 90); }, 380); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = stop; cleanups.push(stop);
      b.onclick = e => { if (e.detail === 0) stepOnce(); }; // keyboard
    });
    $('[data-apmaster]').onclick = () => { if (!replay) setAP(!apOn); };
    $('[data-apclose]').onclick = () => { apPanel = false; apUI(); };
    function setSix(v) { showSix = v; store.set('six2', v); applyView(); }
    /* ---- in-flight map: north up, your route, runways, waypoints and airfields around you ---- */
    const MINI_R = [1, 2, 5, 10, 25, 50, 100];
    let miniOn = false, miniRi = store.get('minir', 3), miniT = 0;
    const miniEl = $('[data-mini]'), miniC = $('[data-minic]');
    function setMini(v, save = true) { miniOn = v; miniEl.hidden = !v; $('[data-mapb]').setAttribute('aria-pressed', String(v)); if (save) store.set('minion', v); if (v) drawMini(true); }
    $('[data-mapb]').onclick = () => setMini(!miniOn);
    // time of day popover
    { const pop = $('[data-tod]'), btn = $('[data-todb]'), rng = $('[data-todr]');
      const show = v => { pop.hidden = !v; btn.setAttribute('aria-expanded', String(v)); btn.setAttribute('aria-pressed', String(v)); if (v) applyTime(sky.hour); };
      btn.onclick = () => show(pop.hidden); $('[data-todx]').onclick = () => show(false);
      rng.oninput = () => applyTime(rng.value / 60);
      const P = { sunrise: () => hourFor(1, false), morning: () => Math.min(9.5, hourFor(30, false)), noon: () => 12, golden: () => hourFor(7, true), sunset: () => hourFor(.3, true), dusk: () => hourFor(-4.5, true), night: () => hourFor(-18, true) };
      // presets glide there (the short way round the clock) so the light change plays out
      let anim = 0; $$('[data-todp]').forEach(b => b.onclick = () => { let to = P[b.dataset.todp](); if (!Number.isFinite(to)) to = 0; const from = sky.hour; let d = ((to - from) % 24 + 36) % 24 - 12; const t0 = performance.now(); cancelAnimationFrame(anim);
        const tick = now => { if (!alive) return; const k = Math.min(1, (now - t0) / 1400), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; applyTime(from + d * e); if (k < 1) anim = requestAnimationFrame(tick); }; anim = requestAnimationFrame(tick); }); }
    $('[data-minix]').onclick = () => setMini(false);
    // shown by default on bigger screens (bottom left, like Infinite Flight's map); hidden on phones until you open it
    if (!replay) requestAnimationFrame(() => setMini(store.get('minion', !coarse), false));
    $$('[data-miniz]').forEach(b => b.onclick = () => { miniRi = clamp(miniRi - +b.dataset.miniz, 0, MINI_R.length - 1); store.set('minir', miniRi); drawMini(true); });
    function drawMini(force) {
      if (!miniOn) return; const now = performance.now(); if (!force && now - miniT < 90) return; miniT = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = miniC.clientWidth, h = miniC.clientHeight; if (!w || !h) return;
      if (miniC.width !== Math.round(w * dpr)) { miniC.width = Math.round(w * dpr); miniC.height = Math.round(h * dpr); }
      const g = miniC.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const rNm = MINI_R[miniRi], k = Math.min(w, h) / 2 / (rNm * NM), cx = w / 2, cy = h / 2;
      $('[data-minir]').textContent = rNm + ' NM';
      const X = x => cx + (x - st.x) * k, Y = z => cy - (z - st.z) * k;
      g.lineCap = 'round'; g.lineJoin = 'round';
      // range ring
      g.strokeStyle = 'rgba(158,216,255,.16)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, Math.min(w, h) / 4, 0, 7); g.stroke();
      // airfields
      g.font = '600 10px Archivo, system-ui, sans-serif'; g.textAlign = 'center';
      for (const a of miniAps) {
        const x = X(a.xz[0]), y = Y(a.xz[1]); if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
        if (a.t === 'S' && rNm > 25) continue;
        g.fillStyle = 'rgba(4,11,34,.9)'; g.strokeStyle = 'rgba(158,216,255,.7)'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, a.t === 'L' ? 4 : 3, 0, 7); g.fill(); g.stroke();
        if (a.t === 'L' || (a.t === 'M' && rNm <= 50) || rNm <= 5) { g.fillStyle = 'rgba(222,233,255,.75)'; g.fillText(a.code, x, y + 14); }
      }
      // runways
      g.strokeStyle = '#DDEBFF'; for (const r of rwys) { g.lineWidth = Math.max(2, r.wid * k); g.beginPath(); g.moveTo(X(r.A[0]), Y(r.A[1])); g.lineTo(X(r.B[0]), Y(r.B[1])); g.stroke(); }
      // route
      g.strokeStyle = 'rgba(10,98,255,.55)'; g.lineWidth = 6; g.beginPath(); P.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke();
      g.strokeStyle = '#9ED8FF'; g.lineWidth = 2; g.stroke();
      // waypoints
      const nextW = wpts.find(q => q.s > path.project(st.x, st.z).s + 80);
      for (const q of wpts) { const [x0, z0] = F.to(q.lat, q.lng), x = X(x0), y = Y(z0); g.fillStyle = q === nextW ? '#FFD166' : '#9ED8FF'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.fillText(q.code || '', x, y - 10); }
      // you
      const hh = st.hdg * D2R; g.save(); g.translate(cx, cy); g.rotate(hh);
      g.fillStyle = '#fff'; g.strokeStyle = '#06102A'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.stroke(); g.fill(); g.restore();
      g.fillStyle = 'rgba(222,233,255,.85)'; g.textAlign = 'left'; g.fillText('N', 8, 16);
    }
    const cockpit = () => CAMS[camI][0] === 'Cockpit';
    function applyView() { const six = (showSix || cockpit()) && !AC.jet; root.classList.toggle('six-on', six); root.classList.toggle('hud-on', !six); root.classList.toggle('is-jet', !!AC.jet); { const pc = $('[data-pfcam]'); if (pc) pc.textContent = CAMS[camI][0]; } root.classList.toggle('is-cockpit', cockpit()); $('[data-sixb]').setAttribute('aria-pressed', String(six)); $('[data-sixb]').classList.toggle('on', six); $('[data-sixb]').hidden = !!AC.jet; }
    function cycleCam() { camI = (camI + 1) % CAMS.length; $('[data-caml]').textContent = CAMS[camI][0]; orb.yaw = orb.pitch = 0; orb.zoom = 1; towerAt = null; flyAt = null; applyView(); }
    // drag the view to orbit (chase cameras) or look around (cockpit and wing); wheel or pinch to zoom; double-click to reset
    { const mapEl = $('[data-map]'); let drag = null; const pts = new Map();
      on(mapEl, 'contextmenu', e => e.preventDefault());
      on(mapEl, 'pointerdown', e => { if (CS.mouse && e.pointerType === 'mouse' && e.button === 0 && !e.shiftKey) return; pts.set(e.pointerId, [e.clientX, e.clientY]); mapEl.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, d: pts.size === 2 ? Math.hypot(...[...pts.values()].reduce((a, b) => [a[0] - b[0], a[1] - b[1]])) : 0 }; });
      on(mapEl, 'pointermove', e => { if (!drag || !pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2) { const d = Math.hypot(...[...pts.values()].reduce((a, b) => [a[0] - b[0], a[1] - b[1]])); if (drag.d) orb.zoom = clamp(orb.zoom * drag.d / d, .35, 4); drag.d = d; return; }
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
        const lim = cockpit() || CAMS[camI][0] === 'Wing' ? [150, 60] : [180, 70];
        orb.yaw = clamp(orb.yaw + dx * .3, -lim[0], lim[0]); if (Math.abs(orb.yaw) >= 180) orb.yaw = 0; orb.pitch = clamp(orb.pitch + dy * .25, -lim[1], lim[1]); });
      const up = e => { pts.delete(e.pointerId); if (!pts.size) drag = null; };
      on(mapEl, 'pointerup', up); on(mapEl, 'pointercancel', up);
      on(mapEl, 'wheel', e => { e.preventDefault(); orb.zoom = clamp(orb.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12), .35, 4); }, { passive: false });
      on(mapEl, 'dblclick', () => { orb.yaw = orb.pitch = 0; orb.zoom = 1; }); }
    $('[data-sixb]').onclick = () => setSix(!showSix);
    function toggleMute() { const m = !store.get('mute', false); store.set('mute', m); audio.mute(m); $('[data-mute]').classList.toggle('off', m); }
    function togglePause(force) { paused = force ?? !paused; audio.pause(paused); const d = paused ? 'M8 5l11 7-11 7z' : 'M8 5v14M16 5v14'; $$('[data-pp],[data-pp2]').forEach(p => p.setAttribute('d', d)); root.classList.toggle('is-paused', paused); }
    applyView();
    $('[data-ap]').onclick = () => setAP(!apOn); $('[data-cam]').onclick = cycleCam; $('[data-mute]').onclick = toggleMute; $('[data-pause]').onclick = () => togglePause(); $('[data-play]').onclick = () => togglePause();
    $('[data-mute]').classList.toggle('off', store.get('mute', false));
    $('[data-gates]').setAttribute('aria-pressed', String(showGates)); $('[data-gates]').onclick = () => { showGates = !showGates; store.set(gateKey, showGates); $('[data-gates]').setAttribute('aria-pressed', String(showGates)); };
    if (replay) { $('[data-ap]').hidden = true; $('[data-replaybar]').hidden = false; }
    const rateBtns = () => $$('[data-rate]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.rate === rate)));
    $$('[data-rate]').forEach(b => b.onclick = () => { rate = +b.dataset.rate; store.set('rate', rate); rateBtns(); }); rateBtns();
    H.scrub.oninput = () => { const s = H.scrub.value / 1000 * L; const air = prof(s) - (elevAt(...path.at(s).slice(0, 2)) ?? g0) > 30; place(s, air); flownPts.length = 0; flownLine.positions = []; };
    $('[data-sub]').textContent = [O.subtitle, replay ? 'Replay' : 'Fly it', wind.spd ? `Wind ${pad3(wind.dir)}°/${wind.spd}${gustKt ? 'G' + gustKt : ''} kt` : 'Calm', ...cloudLayers.map(c => `${c.cover}${String(Math.round(c.base / 100)).padStart(3, '0')}`), visM < 9999 ? `Vis ${(visM / 1000).toFixed(visM < 5000 ? 1 : 0)} km` : ''].filter(Boolean).join(' · ');

    /* ---- ready card ---- */
    const ctrlHelp = coarse
      ? `<li><b>Stick</b> bottom left: pull back to raise the nose, push to lower it, sideways to bank. <b>Rudder</b> slider underneath.</li><li><b>Power</b> slider on the right; <b>Flaps</b>, <b>Trim</b>, <b>Brake</b> and <b>Park</b> buttons beside it. Or turn on <b>Tilt to steer</b>.</li>`
      : `<li><b>↑ ↓</b> / <b>W S</b> elevator (pull back to raise the nose) · <b>← →</b> / <b>A D</b> ailerons · <b>Q E</b> rudder</li><li><b>R F</b> or <b>+ −</b> throttle · <b>1–0</b> set power</li><li><b>V</b> / <b>Shift+V</b> flaps down / up (or <b>]</b> <b>[</b>) · <b>T G</b> trim nose up / down</li><li><b>B</b> brakes (hold) · <b>Shift+B</b> parking brake · ${O.jet ? '<b>Shift+G</b> landing gear · <b>/</b> spoilers' : '<b>H</b> carb heat'} · <b>U</b> auto-rudder on/off</li><li><b>P</b> autopilot · ${O.jet ? '' : '<b>I</b> instrument panel · '}<b>C</b> camera, including the cockpit · <b>J</b> route gates · <b>L</b> landing lights · <b>Space</b> pause · <b>M</b> sound</li><li><b>Drag</b> the view to look around, <b>scroll</b> to zoom, double-click to reset · <b>Y</b> mouse yoke · <b>K</b> control settings · <b>N</b> hold to talk on the radio</li><li>Joysticks, yokes and gamepads work too: map the axes (including a throttle lever) in <b>Controls</b>.</li>`;
    card(`<span class="sim-kicker">${replay ? 'Replay' : 'Fly it'} · ${esc(AC.type?.name || O.aircraft || 'Trainer')}</span><h2>${esc(O.title)}</h2>
      <p>${PR ? PRT : replay ? 'Sit back while the autopilot flies your logged route over real terrain. Change the speed, scrub along the route, or switch camera.' : `Fly the route yourself. Follow the gates and the dashed line, ${groundStart ? 'take off from the runway' : 'starting in the air'}${landEnd ? ', and land at the end' : ''}.`}</p>
      <div class="sim-facts"><div><span>Distance</span><b>${(L / NM).toFixed(1)} NM</b></div><div><span>${PRF ? 'Glidepath' : PR?.kind === 'takeoff' ? 'Climb to' : 'Planned height'}</span><b>${PRF ? '3°' : PR?.kind === 'takeoff' ? '1,000 ft AAL' : Math.round((cruise - geoN) / FT / 100) * 100 + ' ft'}</b></div><div><span>Wind</span><b>${wind.spd ? `${pad3(wind.dir)}° / ${wind.spd} kt` : 'Calm'}</b></div></div>
      ${replay ? '' : `<p class="sim-note">${PR ? '' : groundStart ? `Release the parking brake, add full power, keep straight with the rudder and raise the nose at about ${PF.vr} kt.` : 'You start in the air, trimmed for cruise.'} Flaps for landing; approach at about ${PF.appr} kt.</p><ul class="sim-help">${ctrlHelp}</ul><label class="sim-check"><input type="checkbox" data-inv ${invert ? 'checked' : ''}> Invert pitch (push to climb)</label>`}
      ${synthetic ? '<p class="sim-note">This flight has no recorded track, so you’ll fly a standard circuit from the departure airfield.</p>' : ''}
      <p class="sim-note">A practice toy for fun and route familiarisation, not a training device. Heights are estimated, not logged.</p>
      <div class="sim-actions"><button type="button" class="sim-btn ghost" data-x>Back</button><button type="button" class="sim-btn" data-go>${replay ? 'Play replay' : 'Start flying'}</button></div>`);
    wireX();
    const inv = $('[data-inv]'); if (inv) inv.onchange = () => { invert = inv.checked; store.set('invert', invert); };
    $('[data-go]').onclick = () => { card(''); audio.start(); togglePause(false); };
    setAP(apOn);

    /* ---- end card ---- */
    let ended = false;
    // practice scoring: glidepath, speed and centreline on a final; centreline, lift-off and climb speed on a take-off
    const sThr = arrE ? (() => { let bi = 0, bd = Infinity; path.P.forEach((q, i) => { const d = Math.hypot(q[0] - landPt[0], q[1] - landPt[1]); if (d < bd) { bd = d; bi = i; } }); return path.S[bi]; })() : 0; // no project(): it moves the path's search cursor
    function scorePractice(pr) {
      const P0 = pscore, kt = st.v / KT;
      if (PRF) {
        if (!st.ground && !st.landedOnce && pr.s < sThr) { P0.gsN++; P0.gsSum += Math.abs(st.alt - prof(pr.s)) / FT; P0.spdSum += Math.abs(kt - (L - TDZ - pr.s > 2500 && PR.kind === 'long' ? PF.appr + 8 : PF.appr)); P0.clSum = (P0.clSum || 0) + pr.d; }
        if (st.touch && P0.td == null) { P0.td = st.touch.at - sThr; P0.tdCl = pr.d; P0.tdKt = kt; }
      } else if (PR.kind === 'takeoff') {
        if (st.ground && !P0.liftAt) { P0.clMax = Math.max(P0.clMax, pr.d); if (kt > PF.vr * .95 && fc.elevator < -.1 && P0.rot == null) P0.rot = kt; }
        if (!st.ground && P0.liftAt == null) { P0.liftAt = pr.s; P0.liftKt = kt; }
        if (!st.ground && st.agl > 50 * FT) { P0.vyN++; P0.vySum += Math.abs(kt - PF.vy); P0.clSum = (P0.clSum || 0) + pr.d; }
      }
    }
    // one 0–100 landing score for the leaderboards: touchdown rate, touchdown point, centreline and speed
    function landingScore() {
      const P0 = pscore; if (!PR || !P0 || P0.td == null || !st.touch || st.crashed || PR.kind === 'takeoff') return null;
      const c01 = v => Math.max(0, Math.min(1, v)), aim = Math.min(arrE.rw.len >= 1200 ? 300 : 150, rollEnd * .3), fpm = Math.abs(st.touch.fpm || 0), vtd = (FM.p.vso || PF.vs * .9) * 1.1;
      const parts = { rate: 40 * c01(1 - Math.max(0, fpm - 150) / 450), point: P0.td < 0 ? 0 : 25 * c01(1 - Math.abs(P0.td - aim) / 350), line: 20 * c01(1 - (P0.tdCl || 0) / 12), speed: 15 * c01(1 - Math.abs((P0.tdKt || 0) - vtd) / 15) };
      return { score: Math.round(parts.rate + parts.point + parts.line + parts.speed), parts, fpm: -Math.round(fpm), td: Math.round(P0.td), cl: +(P0.tdCl || 0).toFixed(1), kt: Math.round(P0.tdKt || 0) };
    }
    function practiceFacts(kind) {
      const P0 = pscore; if (!PR || !P0 || replay || kind === 'crash') return '';
      const g = (v, ok, fine) => v <= ok ? 'great' : v <= fine ? 'ok' : 'firm', row = (l, v, cls) => `<div class="pr-${cls}"><span>${l}</span><b>${v}</b></div>`;
      const out = [];
      if (PRF) {
        if (P0.gsN) { const gs = P0.gsSum / P0.gsN, sp = P0.spdSum / P0.gsN, cl = P0.clSum / P0.gsN; out.push(row('Glidepath, average error', Math.round(gs) + ' ft', g(gs, 50, 120)), row('Speed, average error', sp.toFixed(1) + ' kt', g(sp, 4, 8)), row('Centreline, average error', Math.round(cl) + ' m', g(cl, 15, 40))); }
        if (P0.td != null) { const aim = Math.min(arrE.rw.len >= 1200 ? 300 : 150, rollEnd * .3), off = P0.td - aim; out.push(row('Touchdown', P0.td < 0 ? `${Math.round(-P0.td)} m short of the runway` : `${Math.round(P0.td)} m past the threshold`, P0.td < 0 ? 'firm' : g(Math.abs(off), 120, 280)), row('Touchdown off the centreline', Math.round(P0.tdCl) + ' m', g(P0.tdCl, 4, 9)), row('Touchdown speed', Math.round(P0.tdKt) + ' kt', g(Math.abs(P0.tdKt - (FM.p.vso || PF.vs * .9) * 1.1), 5, 10))); }
      } else if (PR.kind === 'takeoff') {
        out.push(row('Centreline on the roll, worst', P0.clMax.toFixed(1) + ' m', g(P0.clMax, 3, 8)));
        if (P0.liftAt != null) out.push(row('Lift-off', `${Math.round(P0.liftKt)} kt after ${Math.round(P0.liftAt)} m`, g(Math.abs(P0.liftKt - PF.vr), 5, 10)));
        if (P0.vyN) out.push(row(`Climb speed vs Vy ${Math.round(PF.vy)} kt, average error`, (P0.vySum / P0.vyN).toFixed(1) + ' kt', g(P0.vySum / P0.vyN, 4, 8)), row('Track on the climb-out, average error', Math.round(P0.clSum / P0.vyN) + ' m', g(P0.clSum / P0.vyN, 30, 80)));
      }
      return out.length ? `<div class="sim-facts sim-pr">${out.join('')}</div><p class="sim-note">Green is within normal checkride standards, amber is acceptable, red needs work.</p>` : '';
    }
    function finish(kind) {
      if (ended) return; ended = true; togglePause(true);
      const t = score.t, tube = score.n ? Math.round(score.tube / score.n * 100) : 0, xte = score.n ? score.xteSum / score.n / NM : 0;
      const touch = st.touch, ld = touch ? (touch.fpm > -250 ? ['Smooth landing', 'great'] : touch.fpm > -500 ? ['Good landing', 'ok'] : ['Firm landing', 'firm']) : null;
      const bestKey = 'best-' + (O.id || O.title), best = store.get(bestKey, null);
      if (!replay && kind !== 'crash' && (!best || tube > best)) store.set(bestKey, tube);
      card(`<span class="sim-kicker">${kind === 'crash' ? 'Flight over' : replay ? 'Replay finished' : PR ? 'Practice · ' + PRN : 'Route complete'}</span><h2>${kind === 'crash' ? 'Crashed' : ld ? ld[0] : kind === 'climb' ? 'Climbing away' : 'Well flown'}</h2>
        ${kind === 'crash' ? `<p>${esc(st.crash)}</p>` : ld ? `<p>Touchdown at ${Math.abs(Math.round(touch.fpm / 10) * 10)} fpm with ${Math.abs(Math.round(touch.bank))}° of bank.</p>` : ''}
        <div class="sim-facts"><div><span>Time</span><b>${mmss(t)}</b></div><div><span>Flown</span><b>${(score.dist / NM).toFixed(1)} NM</b></div><div><span>Highest</span><b>${Math.round((score.maxAlt - geoN) / FT / 10) * 10} ft</b></div>
        ${replay ? '' : `<div><span>On the route</span><b>${tube}%</b></div><div><span>Average off track</span><b>${xte < .1 ? Math.round(xte * NM) + ' m' : xte.toFixed(2) + ' NM'}</b></div><div><span>Your best</span><b>${best != null ? Math.max(best, kind === 'crash' ? 0 : tube) + '%' : (kind === 'crash' ? '—' : tube + '%')}</b></div>`}</div>
        ${(() => { const L = kind === 'land' && !replay ? landingScore() : null; return L ? `<div class="sim-score"><b>${L.score}</b><span>Landing score<small data-rank>${O.onResult ? 'Posting to the leaderboard…' : ''}</small></span></div>` : ''; })()}
        ${practiceFacts(kind)}${radioFacts()}
        ${replay || PR ? '' : '<p class="sim-note">“On the route” is the share of time within the gates’ width and 250 ft of the planned height.</p>'}
        <div class="sim-actions"><button type="button" class="sim-btn ghost" data-x>Done</button>${O.noRetry ? '<button type="button" class="sim-btn" data-more>Unlimited practice</button>' : `<button type="button" class="sim-btn" data-again>${replay ? 'Watch again' : 'Fly again'}</button>`}</div>`);
      wireX();
      { const L = kind === 'land' && !replay ? landingScore() : null; if (L && O.onResult) Promise.resolve(O.onResult({ ...L, kind: PR.kind, rw: arrE?.id || '' })).then(t => { const el = $('[data-rank]'); if (el) el.textContent = t || ''; }).catch(() => { const el = $('[data-rank]'); if (el) el.textContent = ''; }); }
      if (O.noRetry) { $('[data-more]').onclick = () => { destroy(); O.onUpgrade && O.onUpgrade(); }; return; }
      $('[data-again]').onclick = () => { ended = false; if (RAD) { rPend.length = 0; RAD.calls.forEach(c => rPend.push({ ...c })); radioLog.length = 0; rStartT = 0; rBusy = false; radioHide(); } Object.assign(score, { t: 0, tube: 0, xteSum: 0, altSum: 0, maxAlt: 0, dist: 0, n: 0 }); st.t = 0; st.touch = null; st.landedOnce = false; flownPts.length = 0; flownLine.positions = []; place(0, !groundStart); camH = st.hdg; card(''); togglePause(false); };
    }

    /* ---- radio calls during practice: prompt, listen (or type), check the elements, then the controller replies ---- */
    const RAD = O.radio && !replay ? O.radio : null, radioLog = [];
    let rCur = null, rRec = null, rText = '', rBusy = false;
    const rPend = RAD ? RAD.calls.map(c => ({ ...c })) : [];
    const SRc = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rUI = () => $('[data-radio]');
    const sayATC = (text, done) => {
      const box = $('[data-ratc]'); box.hidden = false; box.textContent = `${RAD.place} ${RAD.unit}: “${text}”`;
      try { if ('speechSynthesis' in window && !store.get('mute', false)) { const u = new SpeechSynthesisUtterance(text); u.rate = 1.12; u.pitch = .9; u.lang = RAD.lang; u.onend = () => done && done(); speechSynthesis.cancel(); speechSynthesis.speak(u); setTimeout(() => done && (done = done(), null), 9000); return; } } catch { }
      setTimeout(() => done && done(), 2600);
    };
    function radioShow(call, isReadback) {
      rCur = { ...call, isReadback }; rText = '';
      const ui = rUI(); ui.hidden = false; ui.classList.remove('done');
      $('[data-rk]').textContent = isReadback ? 'Radio · read back' : 'Radio · your call';
      $('[data-rtitle]').textContent = isReadback ? call.title : call.title; $('[data-rhint]').textContent = isReadback ? 'Read back the runway and the clearance, then your callsign.' : call.hint;
      ['[data-rsaid]', '[data-rres]'].forEach(q => { $(q).hidden = true; });
      if (!isReadback) $('[data-ratc]').hidden = true;
      $('[data-rex]').hidden = false; $('[data-rex]').textContent = 'Example';
      $('[data-rtype]').hidden = !!SRc; $('[data-rptt]').hidden = !SRc;
    }
    function radioCheck(text) {
      const call = rCur; if (!call || rBusy) return; rBusy = true;
      const t = RAD.compact(text), res = call.el.map(e => ({ k: e.k, ok: e.re.some(r => r && t.includes(r)) })), score = Math.round(res.filter(r => r.ok).length / res.length * 100);
      radioLog.push({ title: call.isReadback ? call.title : call.title, score, said: text });
      const said = $('[data-rsaid]'); said.hidden = false; said.textContent = `You: “${text}”`;
      const rr = $('[data-rres]'); rr.hidden = false; rr.innerHTML = res.map(r => `<li class="${r.ok ? 'ok' : 'miss'}">${r.ok ? '✓' : '✗'} ${esc(r.k)}</li>`).join('') + (score < 100 ? `<li class="model">Try: “${esc(call.model)}”</li>` : '');
      rUI().classList.add('done');
      const next = () => {
        rBusy = false;
        if (!call.isReadback && call.atc) sayATC(call.atc, () => { if (call.readback) radioShow({ ...call.readback, id: call.id + '-rb', el: call.readback.el, model: call.readback.model, title: call.readback.title }, true); else setTimeout(radioHide, 2500); });
        else setTimeout(radioHide, 2200);
      };
      setTimeout(next, score === 100 ? 900 : 2200);
    }
    function radioHide() { if (rBusy) return; rCur = null; rUI().hidden = true; }
    function radioPTT(down) {
      if (!rCur || rBusy) return;
      const b = $('[data-rptt]');
      if (!SRc) { if (down) { $('[data-rtype]').hidden = false; $('[data-rin]').focus(); } return; }
      if (down && !rRec) {
        try { speechSynthesis?.cancel(); } catch { }
        rText = ''; rRec = new SRc(); rRec.lang = RAD.lang; rRec.interimResults = true; rRec.continuous = true;
        rRec.onresult = e => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; rText = t; const sd = $('[data-rsaid]'); sd.hidden = false; sd.textContent = `You: “${t}”`; };
        rRec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { $('[data-rtype]').hidden = false; $('[data-rptt]').hidden = true; } };
        rRec.onend = () => { const t = rText.trim(); rRec = null; b.classList.remove('live'); b.querySelector('span').textContent = 'Hold to talk'; if (t) radioCheck(t); };
        try { rRec.start(); b.classList.add('live'); b.querySelector('span').textContent = 'Listening… release to send'; } catch { rRec = null; }
      } else if (!down && rRec) { try { rRec.stop(); } catch { } }
    }
    if (RAD) {
      const b = $('[data-rptt]');
      on(b, 'pointerdown', e => { e.preventDefault(); radioPTT(true); }); on(b, 'pointerup', () => radioPTT(false)); on(b, 'pointerleave', () => radioPTT(false)); on(b, 'pointercancel', () => radioPTT(false));
      $('[data-rskip]').onclick = () => { if (rCur && !rBusy) { radioLog.push({ title: rCur.title, score: 0, said: '', skipped: true }); radioHide(); } };
      $('[data-rex]').onclick = () => { if (rCur) { $('[data-rhint]').textContent = `Say: “${rCur.model}”`; $('[data-rex]').hidden = true; } };
      $('[data-rtype]').onsubmit = e => { e.preventDefault(); const i = $('[data-rin]'), t = i.value.trim(); if (!t) return; i.value = ''; i.blur(); $('[data-rtype]').hidden = !!SRc; radioCheck(t); };
    }
    // where the calls happen: at the start, on the downwind leg and on final (circuit), using the path's vertices
    const rS = { downwind: synthetic && path.P.length >= 9 ? path.S[4] + 150 : Infinity, final: synthetic && path.P.length >= 9 ? path.S[7] - 250 : Infinity };
    let rStartT = 0;
    function radioTick(dt, pr) {
      if (!RAD || rCur) return;
      rStartT += dt;
      const due = rPend.findIndex(c => c.when === 'start' ? rStartT > 1.2 : pr.s >= rS[c.when] && !st.ground);
      if (due >= 0) { const c = rPend.splice(due, 1)[0]; radioShow(c, false); }
    }
    function radioFacts() {
      if (!RAD || !radioLog.length) return '';
      const avg = Math.round(radioLog.reduce((a, r) => a + r.score, 0) / radioLog.length);
      return `<h3 class="sim-rh">Radio calls · ${avg}%</h3><div class="sim-facts sim-pr">${radioLog.map(r => `<div class="pr-${r.score >= 100 ? 'great' : r.score >= 60 ? 'ok' : 'firm'}"><span>${esc(r.title)}</span><b>${r.skipped ? 'Skipped' : r.score + '%'}</b></div>`).join('')}</div>`;
    }

    /* ---- loop ---- */
    let prev = performance.now(), hudT = 0;
    // adaptive quality: hold a smooth frame rate by trading scenery detail, render resolution and shadows
    const QUAL = [{ sse: SSE0, res: RES0, sh: true }, { sse: SSE0 * 1.4, res: RES0 * .9, sh: true }, { sse: SSE0 * 1.9, res: RES0 * .8, sh: false }, { sse: SSE0 * 2.5, res: RES0 * .7, sh: false }, { sse: SSE0 * 3.2, res: RES0 * .6, sh: false }];
    let qi = 0, fpsN = 0, fpsT = performance.now(), calm = 0;
    const applyQ = () => { const q = QUAL[qi]; if (tileset) tileset.maximumScreenSpaceError = q.sse; else scene.globe.maximumScreenSpaceError = 2 * q.sse / SSE0; viewer.resolutionScale = q.res; shadowsOK = q.sh && !coarse; };
    let shadowsOK = !coarse; applyQ();
    function loop(now) {
      if (!alive) return;
      raf = requestAnimationFrame(loop); pumping = false;
      fpsN++; if (now - fpsT > 2000) { const fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now;
        if (!document.hidden && !paused) { if (fps < 40 && qi < QUAL.length - 1) { qi++; applyQ(); calm = 0; } else if (fps > 57 && qi > 0 && ++calm > 4) { qi--; applyQ(); calm = 0; } } }
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
          if (PR && pscore && !replay) scorePractice(pr);
          radioTick(dt, pr);
          if (PR?.kind === 'takeoff' && !st.ground && st.agl > 1000 * FT) { finish('climb'); break; }
          if (st.crashed) { finish('crash'); break; }
          if (st.ground && st.landedOnce && st.v < 2) { finish('land'); break; }
          if (!landEnd && pr.s > L - 40) { finish('done'); break; }
          if (!st.ground && pr.s >= L - 5 && pr.d > 500) { finish('done'); break; }
        }
        if (replay && now - lastFlown > 700) { lastFlown = now; flownPts.push(LLH(st.x, st.z, st.alt + 1.5)); if (flownPts.length > 3000) flownPts.shift(); if (flownPts.length > 1) flownLine.positions = flownPts; }
        audio.update(st.thr, st.v / KT, st.stall && !st.ground, true);
      }
      frameDraw(real);
      hudT += real; if (hudT > .05) { hudT = 0; hud(); }
    }
    raf = requestAnimationFrame(loop);
    if (store.get("debug", false)) window.__boploSim = { viewer, st, C, tileset, model, path, FM, rwAt, elevAt, groundAt, approachCap, AP, dbg: () => ({ g0, g1, L, TDZ, DG, cruise, geoN, prof0: prof(0), arrE: arrE && arrE.id, depE: depE && depE.id, landPt, sThr, circuit }), key: k => { keys.add(k); }, unkey: k => keys.delete(k) };
    return { close: destroy };
  }

  return { open, prefetch: fetchOSM };
})();
