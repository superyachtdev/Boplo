/* Boplo Flight — mini flight simulator.
   Replays a logged route, or lets the student fly it again, over real terrain.
   MapLibre GL + OpenFreeMap vector tiles + AWS Terrain Tiles (Mapzen terrarium DEM).
   The aircraft is a small low-wing trainer drawn in a MapLibre custom WebGL layer.
   Flight model: a simple point-mass trainer (lift, drag, thrust, gravity). It's a game, not a training device. */
window.BoploSim = (() => {
  'use strict';
  const KT = 0.514444, FT = 0.3048, G = 9.81, RE = 6371008.8;
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const wrap = d => ((d % 360) + 360) % 360, adiff = (a, b) => ((b - a + 540) % 360) - 180;
  const move = (p, b, d) => ({ lat: p.lat + deg(d * Math.cos(rad(b)) / RE), lng: p.lng + deg(d * Math.sin(rad(b)) / (RE * Math.cos(rad(p.lat)))) });
  const dist = (a, b) => Math.hypot(rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2)), rad(b.lat - a.lat)) * RE;
  const brg = (a, b) => wrap(deg(Math.atan2(rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2)), rad(b.lat - a.lat))));
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };

  /* ---------------- route geometry ---------------- */
  function resample(q, step) {
    const out = [q[0]]; let carry = 0;
    for (let i = 0; i < q.length - 1; i++) {
      const a = q[i], b = q[i + 1], d = dist(a, b); if (!d) continue;
      let t = step - carry;
      while (t <= d) { out.push({ lat: a.lat + (b.lat - a.lat) * t / d, lng: a.lng + (b.lng - a.lng) * t / d }); t += step; }
      carry = d - (t - step);
    }
    const last = q[q.length - 1]; if (dist(out[out.length - 1], last) > 1) out.push(last);
    return out;
  }
  function smooth(p, w) {
    const n = p.length, o = new Array(n);
    for (let i = 0; i < n; i++) { const k = Math.min(w, i, n - 1 - i); let la = 0, ln = 0; for (let j = i - k; j <= i + k; j++) { la += p[j].lat; ln += p[j].lng; } o[i] = { lat: la / (2 * k + 1), lng: ln / (2 * k + 1) }; }
    return o;
  }
  function simplify(pts, tol) { // Douglas–Peucker, metres
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let mx = 0, at = -1;
      const A = pts[a], B = pts[b], ab = dist(A, B), bAB = brg(A, B);
      for (let i = a + 1; i < b; i++) { const d = ab < 1 ? dist(A, pts[i]) : Math.abs(Math.sin(rad(brg(A, pts[i]) - bAB)) * dist(A, pts[i])); if (d > mx) { mx = d; at = i; } }
      if (mx > tol) { keep[at] = 1; st.push([a, at], [at, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function buildPath(points) {
    const q = [];
    for (const x of points || []) { const p = { lat: +x.lat, lng: +x.lng }; if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue; if (!q.length || dist(q[q.length - 1], p) > 20) q.push(p); }
    if (q.length < 2) return null;
    let s = resample(q, 30); s = smooth(smooth(s, 8), 8);
    const cum = new Float64Array(s.length); for (let i = 1; i < s.length; i++) cum[i] = cum[i - 1] + dist(s[i - 1], s[i]);
    const len = cum[s.length - 1]; if (len < 400) return null;
    let hint = 0;
    const at = d => {
      d = clamp(d, 0, len);
      if (cum[hint] > d) hint = 0;
      while (hint < s.length - 2 && cum[hint + 1] < d) hint++;
      const a = s[hint], b = s[hint + 1], t = (d - cum[hint]) / ((cum[hint + 1] - cum[hint]) || 1);
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    };
    // nearest point on the path to p, searched near a previous index
    const nearest = (p, near) => {
      let best = Infinity, bi = 0; const lo = near == null ? 0 : Math.max(0, near - 80), hi = near == null ? s.length - 1 : Math.min(s.length - 1, near + 160);
      for (let i = lo; i <= hi; i++) { const d = dist(p, s[i]); if (d < best) { best = d; bi = i; } }
      return { i: bi, d: best, s: cum[bi] };
    };
    const closed = dist(q[0], q[q.length - 1]) < 1500;
    return { pts: s, cum, len, raw: q, at, nearest, closed, wps: simplify(q, Math.max(250, len / 60)) };
  }

  /* ---------------- aircraft model ---------------- */
  function planeMesh() {
    const out = [];
    let col = [1, 1, 1];
    const tri = (a, b, c) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
      for (const p of [a, b, c]) out.push(...p, ...n, ...col);
    };
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    const hexa = (b, t) => { quad(b[0], b[1], b[2], b[3]); quad(t[3], t[2], t[1], t[0]); for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b[i], b[j], t[j], t[i]); } };
    const S = [[1.05, .02, .12, .12], [.86, .03, .26, .26], [.45, .07, .34, .38], [.0, .08, .32, .36], [-.55, .07, .22, .24], [-1.25, .1, .1, .12], [-1.5, .12, .05, .08]];
    const ring = ([z, y, w, h]) => [[-w / 2, y - h / 2, z], [w / 2, y - h / 2, z], [w / 2, y + h / 2, z], [-w / 2, y + h / 2, z]];
    col = [.96, .97, 1];
    for (let i = 0; i < S.length - 1; i++) { const A = ring(S[i]), B = ring(S[i + 1]); for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; if (k === 0) col = [.04, .38, 1]; else col = [.96, .97, 1]; quad(A[k], A[j], B[j], B[k]); } }
    col = [.96, .97, 1];
    { const A = ring(S[0]), B = ring(S[S.length - 1]); quad(A[0], A[1], A[2], A[3]); quad(B[3], B[2], B[1], B[0]); }
    col = [.08, .14, .28];
    hexa([[-.15, .25, .62], [.15, .25, .62], [.15, .25, -.1], [-.15, .25, -.1]], [[-.1, .3, .4], [.1, .3, .4], [.1, .32, .02], [-.1, .32, .02]]);
    col = [.97, .98, 1];
    for (const s of [-1, 1]) { const r = .14, tip = 1.62; hexa([[s * r, -.13, .5], [s * tip, -.04, .4], [s * tip, -.04, .1], [s * r, -.13, .02]], [[s * r, -.08, .48], [s * tip, -.015, .39], [s * tip, -.015, .11], [s * r, -.08, .04]]); }
    col = [.04, .38, 1];
    for (const s of [-1, 1]) hexa([[s * 1.5, -.045, .4], [s * 1.62, -.04, .4], [s * 1.62, -.04, .1], [s * 1.5, -.045, .1]], [[s * 1.5, -.012, .39], [s * 1.62, -.01, .39], [s * 1.62, -.01, .11], [s * 1.5, -.012, .11]]);
    col = [.97, .98, 1];
    for (const s of [-1, 1]) hexa([[s * .04, .09, -1.18], [s * .6, .11, -1.3], [s * .6, .11, -1.46], [s * .04, .09, -1.5]], [[s * .04, .12, -1.18], [s * .6, .13, -1.3], [s * .6, .13, -1.46], [s * .04, .12, -1.5]]);
    col = [.04, .38, 1];
    hexa([[-.02, .14, -1.0], [-.02, .14, -1.52], [.02, .14, -1.52], [.02, .14, -1.0]], [[-.015, .62, -1.42], [-.015, .62, -1.6], [.015, .62, -1.6], [.015, .62, -1.42]]);
    tri([0, .02, 1.22], [-.06, -.04, 1.05], [.06, -.04, 1.05]); tri([0, .02, 1.22], [.06, -.04, 1.05], [.06, .08, 1.05]);
    tri([0, .02, 1.22], [.06, .08, 1.05], [-.06, .08, 1.05]); tri([0, .02, 1.22], [-.06, .08, 1.05], [-.06, -.04, 1.05]);
    // landing gear: three small legs and wheels
    col = [.15, .17, .22];
    for (const [x, z] of [[-.55, .25], [.55, .25], [0, .85]]) { hexa([[x - .02, -.38, z - .02], [x + .02, -.38, z - .02], [x + .02, -.38, z + .02], [x - .02, -.38, z + .02]], [[x - .02, -.12, z - .02], [x + .02, -.12, z - .02], [x + .02, -.12, z + .02], [x - .02, -.12, z + .02]]); hexa([[x - .04, -.46, z - .09], [x + .04, -.46, z - .09], [x + .04, -.46, z + .09], [x - .04, -.46, z + .09]], [[x - .04, -.32, z - .09], [x + .04, -.32, z - .09], [x + .04, -.32, z + .09], [x - .04, -.32, z + .09]]); }
    return new Float32Array(out);
  }
  const mul = (a, b) => { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  // aircraft axes in east-north-up for heading, pitch and bank (degrees)
  function axes(h, p, b) {
    const ch = Math.cos(rad(h)), sh = Math.sin(rad(h)), cp = Math.cos(rad(p)), sp = Math.sin(rad(p)), cb = Math.cos(rad(b)), sb = Math.sin(rad(b));
    const f0 = [sh, ch, 0], r0 = [ch, -sh, 0];
    const f = [f0[0] * cp, f0[1] * cp, sp], u1 = [-f0[0] * sp, -f0[1] * sp, cp];
    const r = [r0[0] * cb - u1[0] * sb, r0[1] * cb - u1[1] * sb, -u1[2] * sb], u = [u1[0] * cb + r0[0] * sb, u1[1] * cb + r0[1] * sb, u1[2] * cb];
    return { f, r, u };
  }
  const SCALE = 3.4; // model units to metres (about an 11 m wingspan)
  function planeLayer(getState) {
    let prog, vao, count, U = {};
    const VS = `#version 300 es
    in vec3 aPos; in vec3 aNor; in vec3 aCol;
    uniform mat4 uMVP; uniform mat3 uN;
    out vec3 vN; out vec3 vC;
    void main(){ vN=uN*aNor; vC=aCol; gl_Position=uMVP*vec4(aPos,1.); }`;
    const FS = `#version 300 es
    precision highp float;
    in vec3 vN; in vec3 vC; uniform float uShadow; out vec4 o;
    void main(){
      if(uShadow>0.){ o=vec4(0.02,0.04,0.1,uShadow); return; }
      vec3 n=normalize(vN); vec3 L=normalize(vec3(.35,-.45,.82));
      float d=abs(dot(n,L)); float sky=.5+.5*abs(n.z);
      o=vec4(vC*(.38+.62*d)*(.85+.15*sky),1.);
    }`;
    return {
      id: 'boplo-plane', type: 'custom', renderingMode: '3d',
      onAdd(map, gl) {
        const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
        prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
        ['uMVP', 'uN', 'uShadow'].forEach(k => U[k] = gl.getUniformLocation(prog, k));
        const d = planeMesh(); count = d.length / 9;
        vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
        [['aPos', 0], ['aNor', 12], ['aCol', 24]].forEach(([n, o]) => { const l = gl.getAttribLocation(prog, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 36, o); });
        gl.bindVertexArray(null);
      },
      render(gl, matrix) {
        const s = getState(); if (!s || s.hidePlane) return;
        const mc = maplibregl.MercatorCoordinate.fromLngLat([s.lng, s.lat], s.alt), u = mc.meterInMercatorCoordinateUnits() * SCALE;
        const { f, r, u: up } = axes(s.hdg, s.pitch, s.bank);
        const col = (v, z = true) => [v[0] * u, -v[1] * u, z ? v[2] * u : 0, 0];
        gl.useProgram(prog); gl.bindVertexArray(vao); gl.disable(gl.CULL_FACE);
        gl.uniformMatrix3fv(U.uN, false, new Float32Array([...r, ...up, ...f]));
        // soft shadow straight below
        const agl = s.alt - s.ground;
        if (agl < 400) {
          const g = maplibregl.MercatorCoordinate.fromLngLat([s.lng, s.lat], s.ground + .3);
          const M = new Float64Array([...col(r, false), ...col(up, false), ...col(f, false), g.x, g.y, g.z, 1]);
          gl.uniformMatrix4fv(U.uMVP, false, new Float32Array(mul(matrix, M)));
          gl.uniform1f(U.uShadow, .32 * (1 - agl / 400));
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
          gl.drawArrays(gl.TRIANGLES, 0, count);
        }
        const M = new Float64Array([...col(r), ...col(up), ...col(f), mc.x, mc.y, mc.z, 1]);
        gl.uniformMatrix4fv(U.uMVP, false, new Float32Array(mul(matrix, M)));
        gl.uniform1f(U.uShadow, 0);
        gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
        gl.drawArrays(gl.TRIANGLES, 0, count);
        gl.bindVertexArray(null);
      }
    };
  }

  /* ---------------- daytime chart style ---------------- */
  function style(route) {
    const nameF = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
    const m = w => ['interpolate', ['exponential', 2], ['zoom'], 10, w / 50, 18, w * 5.2]; // approx. metres to pixels at mid latitudes
    return {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>' },
        route: { type: 'geojson', data: gj(route) }, trail: { type: 'geojson', data: gj([]) }, wps: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Mapzen / AWS Terrain Tiles</a>' }
      },
      terrain: { source: 'dem', exaggeration: 1 },
      sky: { 'sky-color': '#3E86F5', 'horizon-color': '#CFE3FF', 'fog-color': '#DCE8F7', 'sky-horizon-blend': .55, 'horizon-fog-blend': .75, 'fog-ground-blend': .45, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 12, 0] },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#C9D9AE' } },
        { id: 'farm', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['farmland']]], paint: { 'fill-color': '#D8DDA8' } },
        { id: 'grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'meadow', 'scrub']]], paint: { 'fill-color': '#B9D296' } },
        { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]], paint: { 'fill-color': '#86AE72' } },
        { id: 'rock', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['rock', 'sand', 'ice', 'glacier']]], paint: { 'fill-color': ['match', ['get', 'class'], 'ice', '#F4F8FF', 'glacier', '#F4F8FF', 'sand', '#EADFB8', '#C8C3B6'] } },
        { id: 'urban', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial', 'retail']]], paint: { 'fill-color': '#DCD6C8' } },
        { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#A9CB8C', 'fill-opacity': .6 } },
        { id: 'hills', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': .35, 'hillshade-shadow-color': '#4B5A3A', 'hillshade-highlight-color': '#FFFFF0', 'hillshade-accent-color': '#5E6B49' } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#5E9BE0' } },
        { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 9, paint: { 'line-color': '#5E9BE0', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, .6, 15, 4] } },
        { id: 'aerodrome', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'aerodrome']], paint: { 'fill-color': '#C3D6A2' } },
        { id: 'apron', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'class'], ['literal', ['apron', 'taxiway', 'runway', 'helipad']]]], paint: { 'fill-color': ['match', ['get', 'class'], 'runway', '#5B6069', '#9DA2A8'] } },
        { id: 'taxiway', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], paint: { 'line-color': '#9DA2A8', 'line-width': m(12) } },
        { id: 'runway', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], paint: { 'line-color': '#4F545C', 'line-width': m(28) } },
        { id: 'runway-cl', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 13, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], paint: { 'line-color': '#FFFFFF', 'line-width': m(.9), 'line-dasharray': [12, 10] } },
        { id: 'roads-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'minor', 'service']]], paint: { 'line-color': '#F7F4EC', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, .4, 16, 5] } },
        { id: 'roads-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], paint: { 'line-color': ['match', ['get', 'class'], 'motorway', '#F2C46B', '#FFF3D1'], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, .5, 16, 9] } },
        { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#8E8A84', 'line-width': 1 } },
        { id: 'buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13, paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'render_height'], 0, '#E7E1D6', 40, '#CBD3DE'], 'fill-extrusion-height': ['get', 'render_height'], 'fill-extrusion-base': ['get', 'render_min_height'], 'fill-extrusion-opacity': .92 } },
        { id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0A62FF', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 5, 18, 9], 'line-opacity': .85 } },
        { id: 'trail', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 3, 18, 5], 'line-opacity': .9 } },
        { id: 'wps', type: 'circle', source: 'wps', paint: { 'circle-radius': ['case', ['get', 'next'], 9, 5], 'circle-color': ['case', ['get', 'next'], '#FFFFFF', '#0A62FF'], 'circle-stroke-color': '#0A62FF', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' } },
        { id: 'places', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 8, filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village']]], layout: { 'text-field': nameF, 'text-font': ['Noto Sans Regular'], 'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13, 11.5] }, paint: { 'text-color': '#1F2A44', 'text-halo-color': 'rgba(255,255,255,.85)', 'text-halo-width': 1.4 } }
      ]
    };
  }
  const gj = coords => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });

  /* ---------------- sound: a little engine and a stall horn ---------------- */
  function engineSound() {
    let ctx, osc, osc2, gain, ng, nf, horn, hg, on = true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(gain);
      osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 40; osc.connect(lp); osc.start();
      osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 20; const g2 = ctx.createGain(); g2.gain.value = .35; osc2.connect(g2); g2.connect(lp); osc2.start();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), ch = buf.getChannelData(0); let last = 0; for (let i = 0; i < ch.length; i++) { last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; ch[i] = last * 3.5; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; ng = ctx.createGain(); ng.gain.value = 0; nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 600; src.connect(nf); nf.connect(ng); ng.connect(ctx.destination); src.start();
      horn = ctx.createOscillator(); horn.type = 'triangle'; horn.frequency.value = 880; hg = ctx.createGain(); hg.gain.value = 0; horn.connect(hg); hg.connect(ctx.destination); horn.start();
    } catch { ctx = null; }
    return {
      update(thr, v, stall, running) {
        if (!ctx) return; const t = ctx.currentTime, k = on && running ? 1 : 0;
        const rpm = 700 + thr * 1800 + v * 4;
        osc.frequency.setTargetAtTime(rpm / 30, t, .15); osc2.frequency.setTargetAtTime(rpm / 60, t, .15);
        gain.gain.setTargetAtTime(k * (.05 + thr * .07), t, .2);
        ng.gain.setTargetAtTime(k * Math.min(.06, v / 900), t, .3); nf.frequency.setTargetAtTime(300 + v * 12, t, .3);
        hg.gain.setTargetAtTime(k && stall ? .05 : 0, t, .05);
      },
      toggle() { on = !on; if (ctx && ctx.state === 'suspended') ctx.resume(); return on; },
      resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
      close() { try { ctx && ctx.close(); } catch { } },
      get on() { return on; }
    };
  }

  /* ---------------- styles ---------------- */
  function injectCSS() {
    if (document.getElementById('boplo-sim-css')) return;
    const s = document.createElement('style'); s.id = 'boplo-sim-css';
    s.textContent = `
.sim{position:fixed;inset:0;z-index:1000;background:#7FB2F5;overflow:hidden;font-family:var(--font,system-ui);color:#fff;touch-action:none;user-select:none;-webkit-user-select:none}
.sim-view{position:absolute;left:50%;top:50%;will-change:transform}
.sim-map{position:absolute;inset:0}
.sim-map .maplibregl-ctrl-attrib{font-size:10px}
.sim-hud{position:absolute;inset:0;pointer-events:none}
.sim-hud canvas{position:absolute;inset:0;width:100%;height:100%}
.sim-top{position:absolute;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;display:flex;justify-content:space-between;gap:10px;align-items:flex-start;pointer-events:none}
.sim-pill{pointer-events:auto;display:flex;align-items:center;gap:8px;background:rgba(2,6,17,.62);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(158,216,255,.16);border-radius:999px;padding:6px 6px 6px 14px;font-size:13.5px;min-height:42px}
.sim-pill b{font-weight:620}.sim-pill small{color:#9ED8FF;font-size:12px}
.sim-btns{display:flex;gap:6px;pointer-events:auto;flex-wrap:wrap;justify-content:flex-end}
.sim button{font:inherit;color:inherit;cursor:pointer}
.sim-b{height:42px;min-width:42px;padding:0 14px;border-radius:999px;border:1px solid rgba(158,216,255,.18);background:rgba(2,6,17,.62);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-size:13.5px;font-weight:560;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.sim-b[aria-pressed=true]{background:#0A62FF;border-color:#0A62FF}
.sim-b.x{padding:0;width:42px;font-size:20px;line-height:1}
.sim-bottom{position:absolute;left:50%;transform:translateX(-50%);bottom:max(14px,env(safe-area-inset-bottom));width:min(720px,calc(100% - 24px));display:grid;gap:8px;pointer-events:auto}
.sim-panel{background:rgba(2,6,17,.66);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(158,216,255,.16);border-radius:18px;padding:10px 14px;display:flex;align-items:center;gap:14px;font-size:13px}
.sim-panel .wp{flex:1;min-width:0;display:grid;gap:2px}.sim-panel .wp b{font-size:15px;font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sim-panel .wp span{color:#9ED8FF}
.sim-prog{position:relative;height:6px;border-radius:9px;background:rgba(158,216,255,.18);overflow:hidden}.sim-prog i{position:absolute;inset:0;transform-origin:left;background:linear-gradient(90deg,#0A62FF,#9ED8FF)}
.sim-range{width:100%;accent-color:#0A62FF}
.sim-ts{display:flex;gap:4px}.sim-ts button{height:30px;padding:0 10px;border-radius:999px;border:1px solid rgba(158,216,255,.2);background:transparent;font-size:12.5px}.sim-ts button[aria-pressed=true]{background:#fff;color:#020611;border-color:#fff}
.sim-msg{position:absolute;left:50%;top:22%;transform:translateX(-50%);padding:10px 18px;border-radius:999px;background:rgba(217,58,74,.92);font-weight:650;letter-spacing:.04em;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap}
.sim-msg.ok{background:rgba(10,98,255,.92)}.sim-msg.on{opacity:1}
.sim-load{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(120% 90% at 50% 0%,#0A1A44,#020611);z-index:3;transition:opacity .5s}
.sim-load.done{opacity:0;pointer-events:none}
.sim-load div{display:grid;gap:10px;justify-items:center;text-align:center;padding:24px}.sim-load b{font-size:clamp(26px,4vw,40px);font-style:italic;font-weight:640;letter-spacing:-.03em}.sim-load span{color:#9ED8FF;font-size:14px}
.sim-sheet{position:absolute;inset:0;display:grid;place-items:center;background:rgba(2,6,17,.55);backdrop-filter:blur(6px);z-index:4;padding:16px}
.sim-card{width:min(460px,100%);max-height:calc(100% - 20px);overflow:auto;background:rgba(6,16,42,.96);border:1px solid rgba(158,216,255,.18);border-radius:24px;padding:24px;display:grid;gap:14px;pointer-events:auto}
.sim-card h2{font-size:26px;font-style:italic;font-weight:640;letter-spacing:-.03em;line-height:1.05}
.sim-card p{color:rgba(222,233,255,.8);font-size:14.5px;line-height:1.5}
.sim-stats{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(158,216,255,.14);border-radius:14px;overflow:hidden}
.sim-stats div{background:#06102A;padding:12px 14px;display:grid;gap:2px}.sim-stats span{font-size:12px;color:#8FA0C4}.sim-stats b{font-size:20px;font-weight:620}
.sim-keys{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13.5px;color:rgba(222,233,255,.82)}.sim-keys kbd{font:600 12px/1 var(--font,system-ui);background:rgba(158,216,255,.12);border:1px solid rgba(158,216,255,.2);border-radius:6px;padding:4px 7px;color:#fff;white-space:nowrap}
.sim-row{display:flex;gap:8px;flex-wrap:wrap}
.sim-cta{height:48px;padding:0 20px;border-radius:999px;border:0;background:#0A62FF;font-weight:620;font-size:15px}
.sim-cta.l{background:transparent;border:1px solid rgba(158,216,255,.3)}
.sim-choice{display:grid;gap:8px}.sim-choice label{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:14px;border:1px solid rgba(158,216,255,.18);cursor:pointer;font-size:14.5px}.sim-choice input{accent-color:#0A62FF}
.sim-stick{position:absolute;left:max(18px,env(safe-area-inset-left));bottom:calc(max(14px,env(safe-area-inset-bottom)) + 92px);width:150px;height:150px;border-radius:50%;background:rgba(2,6,17,.35);border:1px solid rgba(158,216,255,.25);pointer-events:auto;display:none}
.sim-stick i{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;background:rgba(255,255,255,.9);box-shadow:0 6px 20px rgba(0,0,0,.3)}
.sim-thr{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:calc(max(14px,env(safe-area-inset-bottom)) + 92px);width:58px;height:170px;border-radius:18px;background:rgba(2,6,17,.35);border:1px solid rgba(158,216,255,.25);pointer-events:auto;display:none}
.sim-thr i{position:absolute;left:6px;right:6px;bottom:6px;border-radius:12px;background:linear-gradient(0deg,#0A62FF,#9ED8FF)}
.sim-thr span{position:absolute;left:0;right:0;top:-22px;text-align:center;font-size:12px;color:#fff;text-shadow:0 1px 3px #000}
.sim.touch .sim-stick,.sim.touch .sim-thr{display:block}
.sim.touch.replay .sim-stick,.sim.touch.replay .sim-thr,.sim.touch.ap .sim-stick{display:none}
@media (max-width:640px){.sim-pill .t{display:none}.sim-b{height:38px;min-width:38px;padding:0 11px;font-size:12.5px}.sim-b.x{width:38px}.sim-panel{gap:10px;padding:9px 12px}}
`;
    document.head.append(s);
  }

  /* ---------------- the simulator ---------------- */
  async function open(opts) {
    const { flight, mode: initialMode = 'replay', airfields = [], title = 'Route', onClose } = opts;
    injectCSS();
    const path = buildPath(flight.points);
    if (!path) throw new Error('This flight needs a route of at least a few hundred metres to fly.');
    const root = document.createElement('div'); root.className = 'sim'; root.setAttribute('role', 'application'); root.setAttribute('aria-label', 'Flight simulator');
    if (matchMedia('(pointer:coarse)').matches) root.classList.add('touch');
    root.innerHTML = `<div class="sim-view"><div class="sim-map"></div></div>
      <div class="sim-hud"><canvas></canvas>
        <div class="sim-top"><div class="sim-pill"><b class="t">${esc(title)}</b><small data-mode></small></div>
          <div class="sim-btns"><button class="sim-b" data-cam title="Camera (C)">View</button><button class="sim-b" data-ap title="Autopilot (Z)" aria-pressed="false" hidden>AP</button><button class="sim-b" data-snd title="Sound (M)" aria-pressed="true">Sound</button><button class="sim-b" data-pause title="Pause (P)">Pause</button><button class="sim-b" data-help title="Controls">?</button><button class="sim-b x" data-close aria-label="Close the simulator">×</button></div></div>
        <div class="sim-msg" data-msg></div>
        <div class="sim-stick" data-stick><i></i></div><div class="sim-thr" data-thr><span>Power</span><i></i></div>
        <div class="sim-bottom"><div class="sim-panel"><div class="wp"><b data-wp>—</b><span data-wpd></span></div><div class="sim-ts" data-ts></div></div><div class="sim-prog" data-progbar><i data-prog></i></div><input type="range" class="sim-range" data-scrub min="0" max="1000" value="0" aria-label="Replay position" hidden></div>
      </div>
      <div class="sim-load" data-load><div><b>Loading terrain…</b><span>${esc(title)}</span></div></div>
      <div data-sheet></div>`;
    document.body.append(root); document.documentElement.style.overflow = 'hidden';
    const $ = s => root.querySelector(s);
    const view = $('.sim-view'), hud = $('.sim-hud canvas'), hctx = hud.getContext('2d'), msgEl = $('[data-msg]');
    let closed = false, raf = 0, paused = false;
    const sound = engineSound();

    // view container is a square big enough to rotate without showing corners
    let VW = 0, VH = 0, D = 0, DPR = 1;
    const layout = () => {
      VW = root.clientWidth; VH = root.clientHeight; D = Math.ceil(Math.hypot(VW, VH)) + 4; DPR = Math.min(devicePixelRatio || 1, 2);
      view.style.width = view.style.height = D + 'px'; view.style.marginLeft = view.style.marginTop = -D / 2 + 'px';
      hud.width = VW * DPR; hud.height = VH * DPR;
      map && map.resize();
    };

    let map;
    try { await BoploMap.loadLib(); } catch (e) { root.remove(); document.documentElement.style.overflow = ''; throw e; }
    layout();
    const start = path.pts[0];
    map = new maplibregl.Map({ container: $('.sim-map'), style: style(path.pts.map(p => [p.lng, p.lat])), center: [start.lng, start.lat], zoom: 15, pitch: 70, bearing: brg(path.pts[0], path.at(200)), maxPitch: 85, maxZoom: 23.5, interactive: false, fadeDuration: 0, pixelRatio: Math.min(devicePixelRatio || 1, 1.5), attributionControl: { compact: true } });

    /* ---------- state ---------- */
    let mode = initialMode; // 'replay' | 'fly'
    let cam = 0; const CAMS = ['Chase', 'Cockpit', 'Wide'];
    const S = { lat: start.lat, lng: start.lng, alt: 0, ground: 0, hdg: brg(path.pts[0], path.at(150)), pitch: 0, bank: 0, gamma: 0, v: 0, thr: 0, onGround: true, s: 0, stall: false, crashed: false, hidePlane: false };
    let snap = { ...S };
    const elevAt = (p) => { try { const t = map.terrain; if (!t) return null; return t.getElevationForLngLatZoom(new maplibregl.LngLat(p.lng, p.lat), Math.max(10, Math.min(13, Math.floor(map.transform.tileZoom)))); } catch { return null; } };
    const startAf = airfields.find(a => dist(a, start) < 2500), endAf = airfields.find(a => dist(a, path.pts[path.pts.length - 1]) < 2500);
    let E0 = startAf?.elev != null ? startAf.elev * FT : 0, E1 = endAf?.elev != null ? endAf.elev * FT : E0;
    const cruiseAGL = (path.closed && path.len < 16000 ? 1000 : path.len < 50000 ? 2200 : 3000) * FT;
    const shortHop = path.len < 3000;
    let lastGround = E0;
    const groundAt = p => { const g = elevAt(p); if (g == null || (g === 0 && !map.areTilesLoaded())) return lastGround; return g; };

    // replay profile
    const sRot = Math.min(380, path.len * .1), sTD = path.len - Math.min(320, path.len * .1);
    let rp = { v: 0, alt: 0, floor: 0 };
    let ts = (() => { const want = path.len / 48 / 200; return [1, 2, 4, 8, 16].reduce((b, x) => Math.abs(Math.log(x / want)) < Math.abs(Math.log(b / want)) ? x : b, 1); })();
    // flying
    const inp = { pitch: 0, roll: 0, thrUp: 0, brake: false, stickP: 0, stickR: 0, padP: 0, padR: 0 };
    let ap = false, apAlt = 0, assist = true, invert = false;
    let wpi = 1, nearI = 0, stats = null, touch = null, crashT = 0;
    const wps = path.wps.map((p, i, a) => ({ ...p, name: i === 0 ? (startAf?.code || 'Start') : i === a.length - 1 ? (endAf?.code || 'Finish') : `Turn ${i}` }));
    const trail = []; let trailT = 0;

    function resetFly(where) {
      mode = 'fly'; stats = { t: 0, onTrack: 0, samples: 0, maxAlt: 0, dist: 0, landing: null, bounced: 0 };
      wpi = 1; nearI = 0; trail.length = 0; ap = false; S.crashed = false; S.stall = false;
      if (where === 'air') {
        const p = path.at(Math.min(1200, path.len * .15)), q = path.at(Math.min(1300, path.len * .15 + 100));
        Object.assign(S, { lat: p.lat, lng: p.lng, hdg: brg(p, q), v: 46, thr: .7, onGround: false, pitch: 2, bank: 0, gamma: 0 });
        S.ground = groundAt(p); S.alt = Math.max(E0, S.ground) + Math.min(cruiseAGL, 1000 * FT);
        nearI = path.nearest(p).i;
      } else {
        let h = brg(path.pts[0], path.at(Math.min(600, path.len / 3)));
        const rw = (startAf?.runways || []).flatMap(r => String(r[0] || '').split('/')).map(x => parseInt(x, 10) * 10).filter(x => x > 0 && x <= 360);
        if (rw.length) h = rw.reduce((b, x) => Math.abs(adiff(h, x)) < Math.abs(adiff(h, b)) ? x : b);
        Object.assign(S, { lat: start.lat, lng: start.lng, hdg: h, v: 0, thr: 0, onGround: true, pitch: 0, bank: 0, gamma: 0 });
        S.ground = groundAt(start); S.alt = S.ground;
      }
      apAlt = S.alt; updateModeUI(); flash(where === 'air' ? 'You have control' : 'Full power to take off', true);
    }
    function resetReplay() { mode = 'replay'; S.s = 0; rp = { v: 0, alt: E0, floor: E0 }; Object.assign(S, { lat: start.lat, lng: start.lng, alt: E0, onGround: true, v: 0, bank: 0, pitch: 0, crashed: false, stall: false }); trail.length = 0; updateModeUI(); }

    /* ---------- replay step ---------- */
    function stepReplay(dt) {
      const s0 = S.s;
      if (S.s >= path.len) { if (!S.done) { S.done = true; S.v = 0; showEnd(); } return; }
      const p = path.at(S.s), g = groundAt(p); S.ground = g;
      if (S.s > path.len - 6000) { const ge = elevAt(path.pts[path.pts.length - 1]); if (ge != null && map.areTilesLoaded()) E1 = ge; }
      if (S.s < 300) { const ge = elevAt(start); if (ge != null) E0 = ge; }
      // speed schedule
      let vt;
      if (shortHop) vt = 45;
      else if (S.s < sRot) vt = Math.max(4, Math.sqrt(2 * 1.25 * Math.max(S.s, 2)));
      else if (S.s > sTD) vt = Math.max(5, Math.sqrt(Math.max(0, 31 * 31 - 2 * 1.5 * (S.s - sTD))));
      else { const desc = E1 + (sTD - S.s) * .055 < rp.alt - 30; vt = desc ? 36 : rp.alt < Math.max(E0, E1) + cruiseAGL - 40 ? 38 : 50; }
      rp.v += clamp(vt - rp.v, -2.5 * dt, 2.5 * dt); if (S.s < sRot || S.s > sTD) rp.v = vt;
      // altitude target
      const look = groundAt(path.at(S.s + 900));
      rp.floor += (Math.max(g, look) + 160 - rp.floor) * Math.min(1, dt * .5);
      let tgt;
      if (shortHop) tgt = Math.max(E0, g) + 300;
      else {
        const cruise = Math.max(E0, E1) + cruiseAGL, climb = E0 + Math.max(0, S.s - sRot) * .095, descent = E1 + Math.max(0, sTD - S.s) * .055;
        tgt = Math.min(cruise, climb, descent);
        if (S.s > sRot + 300 && S.s < sTD - 1500) tgt = Math.max(tgt, rp.floor);
      }
      const ground = (S.s < sRot || S.s > sTD) && !shortHop;
      const prevAlt = rp.alt;
      if (ground) rp.alt = g; else { rp.alt += clamp(tgt - rp.alt, -4.5 * dt, 4.2 * dt); rp.alt = Math.max(rp.alt, g + (S.s < sRot + 200 || S.s > sTD - 200 ? 0 : 20)); }
      const vs = (rp.alt - prevAlt) / dt;
      S.s += rp.v * dt;
      const p1 = path.at(S.s), a = path.at(S.s - 35), b = path.at(S.s + 35);
      const h = brg(a, b), dh = adiff(S.hdg, h);
      const rate = dh / dt; S.hdg = wrap(S.hdg + clamp(dh, -12 * dt, 12 * dt));
      const bankT = ground ? 0 : clamp(deg(Math.atan(rp.v * rad(clamp(rate, -6, 6)) / G)), -32, 32);
      S.bank += (bankT - S.bank) * Math.min(1, dt * 2.2);
      let pitchT = ground ? (S.s > sRot - 70 && S.s < sRot ? (S.s - (sRot - 70)) / 70 * 7 : S.s > sTD && S.s < sTD + 60 ? 4 : 0) : deg(Math.atan2(vs, rp.v)) + 2.5;
      S.pitch += (pitchT - S.pitch) * Math.min(1, dt * 3);
      Object.assign(S, { lat: p1.lat, lng: p1.lng, alt: rp.alt, v: rp.v, onGround: ground, thr: ground && S.s > sTD ? .1 : vs > 1 ? 1 : vs < -1 ? .4 : .72, gamma: deg(Math.atan2(vs, rp.v || 1)), stall: false });
      S.ground = g; lastGround = g;
      if (s0 < sTD && S.s >= sTD) flash('Touchdown', true);
    }

    /* ---------- flight model ---------- */
    const K = { Tmax: 2.25, cd: .00057, k: 9.81 / (51 * 51 * 2), aStall: 15, vr: 28 };
    function stepFly(dt) {
      if (S.crashed) return;
      const g = groundAt(S); S.ground = g; lastGround = g;
      let pIn = clamp(inp.pitch + inp.stickP + inp.padP, -1, 1), rIn = clamp(inp.roll + inp.stickR + inp.padR, -1, 1);
      if (inp.thrUp) S.thr = clamp(S.thr + inp.thrUp * .5 * dt, 0, 1);
      if (ap && !S.onGround) { // follow the route and hold altitude
        const n = path.nearest(S, nearI), tgt = path.at(n.s + Math.max(700, S.v * 18)), want = brg(S, tgt);
        const bankT = clamp(adiff(S.hdg, want) * 1.4, -25, 25); rIn = clamp((bankT - S.bank) / 15, -1, 1);
        const vsT = clamp((apAlt - S.alt) * .08, -3.5, 3.5), vs = S.v * Math.sin(rad(S.gamma)); pIn = clamp((vsT - vs) * .25 + (0 - (S.pitch - S.gamma - 3)) * .02, -1, 1);
      }
      const T = K.Tmax * S.thr * clamp(1.15 - S.v / 75, .3, 1.2);
      if (S.onGround) {
        S.bank += (0 - S.bank) * Math.min(1, dt * 6);
        S.hdg = wrap(S.hdg + rIn * 22 * dt * clamp(S.v / 8, 0, 1) * (S.v > 30 ? .4 : 1));
        const fr = inp.brake ? 3.2 : .25 + (S.v > 0 ? .002 * S.v : 0);
        S.v = Math.max(0, S.v + (T - K.cd * S.v * S.v - fr * (S.v > .1 ? 1 : 0)) * dt);
        if (S.v > K.vr * .85 && pIn > 0) S.pitch = clamp(S.pitch + pIn * 6 * dt, 0, 12); else S.pitch = Math.max(0, S.pitch - 4 * dt);
        const L = K.k * S.v * S.v * clamp(S.pitch + 1, 0, K.aStall);
        S.gamma = 0;
        if (L > G * 1.02 && S.pitch > 3) { S.onGround = false; S.gamma = .5; flash('Airborne', true); }
        S.alt = g;
      } else {
        // attitude
        S.bank = clamp(S.bank + rIn * 55 * dt, -75, 75);
        if (assist && Math.abs(rIn) < .05 && !ap) { if (Math.abs(S.bank) < 4) S.bank *= Math.max(0, 1 - dt * 1.5); if (Math.abs(S.bank) > 45) S.bank -= Math.sign(S.bank) * 12 * dt; }
        S.pitch = clamp(S.pitch + pIn * 13 * dt, -30, 30);
        let alpha = S.pitch - S.gamma, stall = false;
        if (!assist && Math.abs(pIn) < .05) S.pitch += (S.gamma + 3 - S.pitch) * dt * .6;
        let CL = alpha;
        if (alpha > K.aStall) { stall = true; CL = K.aStall * .55; S.pitch -= 9 * dt; }
        else if (alpha < -8) CL = -8;
        const L = K.k * S.v * S.v * CL;
        const Di = Math.abs(L * rad(alpha)) * .5;
        S.v = Math.max(8, S.v + (T - K.cd * S.v * S.v - Di - G * Math.sin(rad(S.gamma))) * dt);
        S.gamma = clamp(S.gamma + deg((L * Math.cos(rad(S.bank)) - G * Math.cos(rad(S.gamma))) / S.v) * dt, -60, 45);
        S.hdg = wrap(S.hdg + deg(L * Math.sin(rad(S.bank)) / (S.v * Math.cos(rad(S.gamma)))) * dt);
        S.stall = stall || S.v < 24;
        // ground contact
        const climb = S.v * Math.sin(rad(S.gamma));
        if (S.alt + climb * dt <= g + .05) {
          const vsFpm = -climb / FT * 60;
          if (vsFpm > 900 || Math.abs(S.bank) > 14 || S.pitch < -4) { S.crashed = true; S.alt = g; S.v = 0; crashT = performance.now(); stats.landing = { crash: true, fpm: vsFpm }; sound.update(0, 0, false, false); flash('Crashed', false); setTimeout(showEnd, 1600); return; }
          S.onGround = true; S.gamma = 0; S.alt = g;
          if (!stats.landing || stats.landing.bounceT) { const nm = path.nearest(S, nearI); stats.landing = { fpm: vsFpm, s: nm.s, nearEnd: path.len - nm.s < 2500 }; }
          flash(vsFpm < 150 ? 'Butter landing' : vsFpm < 350 ? 'Smooth landing' : vsFpm < 600 ? 'Firm landing' : 'Hard landing', vsFpm < 600);
        }
      }
      const climb = S.onGround ? 0 : S.v * Math.sin(rad(S.gamma)), gs = S.v * Math.cos(rad(S.gamma));
      const np = move(S, S.hdg, gs * dt); S.lat = np.lat; S.lng = np.lng; if (!S.onGround) S.alt += climb * dt;
      // track keeping
      const n = path.nearest(S, nearI); nearI = n.i; S.s = n.s;
      stats.t += dt; stats.dist += gs * dt; stats.maxAlt = Math.max(stats.maxAlt, S.alt - E0);
      if (!S.onGround) { stats.samples += dt; if (n.d < 0.3 * 1852) stats.onTrack += dt; }
      while (wpi < wps.length - 1 && (dist(S, wps[wpi]) < 450 || path.nearest(wps[wpi]).s < n.s - 200)) wpi++;
      if (S.onGround && S.v < 1 && stats.landing && !stats.landing.crash && !stats.ended) { stats.ended = true; setTimeout(showEnd, 900); }
    }

    /* ---------- camera ---------- */
    let camH = S.hdg, camE = 0;
    function placeCamera() {
      const Hc = map.transform.cameraToCenterDistance || 1, ppd = D / 36.87;
      let eye, look, depress, pad = 0;
      const plane = { lat: S.lat, lng: S.lng }, pAlt = S.alt + 1.3;
      camH = wrap(camH + adiff(camH, S.hdg) * Math.min(1, frameDt * (cam === 1 ? 20 : 2.2)));
      if (cam === 1) { // cockpit
        eye = plane; const eAlt = pAlt + 1.1; look = S.hdg;
        const noseEl = S.pitch; depress = Math.max(5, -noseEl);
        const wantOff = (noseEl + depress) * ppd; pad = clamp(2 * wantOff, 0, D * .8);
        camE = -depress + pad / 2 / ppd;
        return finish(eye, eAlt, look, depress, pad);
      }
      const far = cam === 2, dd = far ? 85 : 30, el = far ? 13 : 9;
      const back = dd * Math.cos(rad(el));
      eye = move(plane, camH + 180, back);
      let eAlt = pAlt + dd * Math.sin(rad(el));
      const gEye = groundAt(eye); if (eAlt < gEye + 3) eAlt = gEye + 3;
      depress = clamp(deg(Math.atan2(eAlt - pAlt, back)), 5, 80);
      camE = -depress;
      return finish(eye, eAlt, camH, depress, 0);
    }
    function finish(eye, eAlt, look, depress, pad) {
      let gC = map.transform.elevation || 0;
      let dH = Math.max(.5, eAlt - gC) / Math.tan(rad(depress)), c = move(eye, look, dH);
      const g2 = elevAt(c); if (g2 != null) { gC = g2; dH = Math.max(.5, eAlt - gC) / Math.tan(rad(depress)); c = move(eye, look, dH); }
      const dist3 = Math.max(.5, eAlt - gC) / Math.sin(rad(depress));
      const zoom = Math.log2(40075016.686 * Math.cos(rad(c.lat)) * map.transform.cameraToCenterDistance / (512 * dist3));
      map.jumpTo({ center: [c.lng, c.lat], zoom: clamp(zoom, 2, 23.4), pitch: 90 - depress, bearing: look, padding: { top: pad, bottom: 0, left: 0, right: 0 } });
      view.style.transform = cam === 1 ? `rotate(${-S.bank}deg)` : '';
      snap = { ...S, hidePlane: cam === 1 };
    }

    /* ---------- HUD ---------- */
    function drawHUD() {
      const c = hctx, W = VW, H = VH; c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, ppd = D / 36.87;
      const ink = '#FFFFFF', ice = '#9ED8FF';
      c.lineCap = 'round'; c.font = '600 13px Archivo, system-ui, sans-serif'; c.textBaseline = 'middle';
      const shadow = on => { c.shadowColor = on ? 'rgba(0,0,0,.55)' : 'transparent'; c.shadowBlur = on ? 4 : 0; };
      shadow(true);
      if (cam === 1) {
        // pitch ladder and flight path marker, rotated with the view
        c.save(); c.translate(cx, cy); c.rotate(rad(-S.bank));
        const hy = (camE) * ppd; // horizon offset from centre (positive = below)
        c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-W, hy); c.lineTo(-90, hy); c.moveTo(90, hy); c.lineTo(W, hy); c.stroke();
        c.lineWidth = 1.5; c.textAlign = 'left';
        for (let a = -20; a <= 20; a += 5) { if (!a) continue; const y = hy - a * ppd; if (Math.abs(y) > H * .42) continue; const w = a % 10 ? 26 : 46; c.setLineDash(a < 0 ? [6, 5] : []); c.beginPath(); c.moveTo(-w - 20, y); c.lineTo(-20, y); c.moveTo(20, y); c.lineTo(w + 20, y); c.stroke(); c.setLineDash([]); if (!(a % 10)) c.fillText(String(Math.abs(a)), w + 26, y); }
        const fy = hy - S.gamma * ppd;
        c.strokeStyle = ice; c.lineWidth = 2; c.beginPath(); c.arc(0, fy, 8, 0, Math.PI * 2); c.moveTo(-24, fy); c.lineTo(-8, fy); c.moveTo(8, fy); c.lineTo(24, fy); c.moveTo(0, fy - 8); c.lineTo(0, fy - 16); c.stroke();
        c.restore();
        c.strokeStyle = '#FFD25A'; c.lineWidth = 3; c.beginPath(); c.moveTo(cx - 60, cy); c.lineTo(cx - 22, cy); c.lineTo(cx - 12, cy + 9); c.moveTo(cx + 60, cy); c.lineTo(cx + 22, cy); c.lineTo(cx + 12, cy + 9); c.stroke();
        c.fillStyle = '#FFD25A'; c.beginPath(); c.arc(cx, cy, 2.5, 0, Math.PI * 2); c.fill();
        // bank arc
        c.save(); c.translate(cx, cy); c.strokeStyle = ink; c.lineWidth = 1.5; const R = Math.min(170, H * .28);
        c.beginPath(); c.arc(0, 0, R, rad(-150), rad(-30)); c.stroke();
        for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const t = rad(a - 90); c.beginPath(); c.moveTo(Math.cos(t) * R, Math.sin(t) * R); c.lineTo(Math.cos(t) * (R + (a % 30 ? 7 : 12)), Math.sin(t) * (R + (a % 30 ? 7 : 12))); c.stroke(); }
        c.rotate(rad(-S.bank)); c.fillStyle = '#FFD25A'; c.beginPath(); c.moveTo(0, -R + 2); c.lineTo(-7, -R + 14); c.lineTo(7, -R + 14); c.closePath(); c.fill(); c.restore();
      }
      // speed and altitude tapes
      const kt = S.v / KT, ft = S.alt / FT, agl = (S.alt - S.ground) / FT, vs = S.onGround ? 0 : S.v * Math.sin(rad(S.gamma)) / FT * 60;
      const tapeH = Math.min(260, H * .4), ty = Math.min(cy, H - 170 - tapeH / 2) , lx = Math.max(16, cx - Math.min(W * .36, 330)), rx = Math.min(W - 16, cx + Math.min(W * .36, 330));
      const tape = (x, val, step, px, label, left, unit) => {
        c.save(); shadow(false); c.fillStyle = 'rgba(2,6,17,.42)'; c.strokeStyle = 'rgba(158,216,255,.25)'; c.lineWidth = 1;
        const w = 64, x0 = left ? x : x - w; c.beginPath(); c.roundRect(x0, ty - tapeH / 2, w, tapeH, 12); c.fill(); c.stroke();
        c.beginPath(); c.rect(x0, ty - tapeH / 2, w, tapeH); c.clip();
        c.fillStyle = ink; c.strokeStyle = ink; c.font = '500 12px Archivo, system-ui, sans-serif'; c.textAlign = left ? 'right' : 'left';
        const base = Math.floor(val / step) * step;
        for (let k = -6; k <= 6; k++) { const v = base + k * step; const y = ty - (v - val) * px; c.beginPath(); c.moveTo(left ? x0 + w : x0, y); c.lineTo(left ? x0 + w - 9 : x0 + 9, y); c.stroke(); if (v >= 0) c.fillText(String(v), left ? x0 + w - 14 : x0 + 14, y); }
        c.restore();
        c.save(); c.fillStyle = '#020611'; c.strokeStyle = '#FFFFFF'; c.lineWidth = 1.5; c.beginPath(); c.roundRect(x0 - 6, ty - 17, w + 12, 34, 9); c.fill(); c.stroke();
        c.fillStyle = '#fff'; c.font = '650 17px Archivo, system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(label, x0 + w / 2, ty + 1);
        c.font = '600 10.5px Archivo, system-ui, sans-serif'; c.fillStyle = ice; c.fillText(unit, x0 + w / 2, ty - tapeH / 2 - 12); c.restore();
      };
      tape(lx, kt, 10, tapeH / 70, String(Math.round(kt)), true, 'KNOTS');
      tape(rx, ft, 100, tapeH / 700, String(Math.round(ft / 10) * 10), false, 'FEET');
      c.textAlign = 'center'; c.font = '600 12px Archivo, system-ui, sans-serif';
      c.fillStyle = vs > 50 ? '#7CF0A9' : vs < -50 ? '#FFB36B' : ice; c.fillText(`${vs >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(vs / 10) * 10)} fpm`, rx - 32, ty + tapeH / 2 + 16);
      c.fillStyle = ice; c.fillText(`${Math.max(0, Math.round(agl))} ft above ground`, rx - 32, ty + tapeH / 2 + 34);
      c.fillText(`Power ${Math.round(S.thr * 100)}%`, lx + 32, ty + tapeH / 2 + 16);
      if (S.onGround && mode === 'fly' && inp.brake) c.fillText('Brakes', lx + 32, ty + tapeH / 2 + 34);
      // heading tape
      const hw = Math.min(360, W - 140), hy0 = 72, ph = hw / 60;
      c.save(); shadow(false); c.fillStyle = 'rgba(2,6,17,.42)'; c.strokeStyle = 'rgba(158,216,255,.25)'; c.beginPath(); c.roundRect(cx - hw / 2, hy0 - 16, hw, 34, 10); c.fill(); c.stroke();
      c.beginPath(); c.rect(cx - hw / 2, hy0 - 16, hw, 34); c.clip(); c.strokeStyle = ink; c.fillStyle = ink; c.textAlign = 'center'; c.font = '500 11.5px Archivo, system-ui, sans-serif';
      for (let d = Math.floor((S.hdg - 35) / 5) * 5; d <= S.hdg + 35; d += 5) { const x = cx + adiff(S.hdg, wrap(d)) * ph; c.beginPath(); c.moveTo(x, hy0 + 18); c.lineTo(x, hy0 + (d % 10 ? 13 : 9)); c.stroke(); if (!(d % 10)) { const n = wrap(d); c.fillText(({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' })[n] || String(n / 10).padStart(2, '0'), x, hy0 - 3); } }
      if (mode === 'fly' && wps[wpi]) { const b = brg(S, wps[wpi]), x = cx + clamp(adiff(S.hdg, b), -29, 29) * ph; c.fillStyle = '#0A62FF'; c.beginPath(); c.moveTo(x, hy0 + 17); c.lineTo(x - 6, hy0 + 8); c.lineTo(x + 6, hy0 + 8); c.closePath(); c.fill(); }
      c.restore();
      c.fillStyle = '#020611'; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.roundRect(cx - 26, hy0 + 20, 52, 24, 7); c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.font = '650 14px Archivo, system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(String(Math.round(S.hdg) % 360).padStart(3, '0') + '°', cx, hy0 + 33);
      if (S.stall && !S.onGround) { c.fillStyle = '#FF5A6A'; c.font = '700 15px Archivo, system-ui, sans-serif'; c.fillText('STALL', cx, cy + Math.min(160, H * .22)); }
      else if (!S.onGround && mode === 'fly' && agl < 400 && vs < -1200) { c.fillStyle = '#FFB36B'; c.font = '700 15px Archivo, system-ui, sans-serif'; c.fillText('PULL UP', cx, cy + Math.min(160, H * .22)); }
      shadow(false);
    }
    function updatePanel() {
      if (mode === 'replay') {
        const left = (path.len - S.s) / Math.max(rp.v, 30);
        $('[data-wp]').textContent = S.s < sRot ? 'Take-off roll' : S.s > sTD ? (S.done ? 'Replay complete' : 'Landing') : rp.alt < Math.max(E0, E1) + cruiseAGL - 40 && S.s < path.len / 2 ? 'Climbing out' : 'Following your logged route';
        $('[data-wpd]').textContent = `${((path.len - S.s) / 1852).toFixed(1)} NM to go · about ${mmss(left)} at real speed`;
      } else {
        const w = wps[wpi], d = w ? dist(S, w) : 0, b = w ? brg(S, w) : 0, gs = S.v * Math.cos(rad(S.gamma));
        const n = path.nearest(S, nearI), off = n.d / 1852;
        $('[data-wp]').textContent = S.crashed ? 'Crashed' : w ? `${w.name} · ${(d / 1852).toFixed(1)} NM · ${String(Math.round(b) % 360).padStart(3, '0')}°` : '—';
        $('[data-wpd]').textContent = `${off < .3 ? 'On track' : `${off.toFixed(1)} NM off track`} · ETE ${gs > 5 ? mmss(d / gs) : '—'}${ap ? ' · Autopilot on' : ''}`;
        if (S.onGround && S.v < 1 && !stats.landing) $('[data-wpd]').textContent = root.classList.contains('touch') ? 'Slide Power up, then pull the stick back gently at 55 kt' : 'Press = (or R) for power, then ↓ / S to lift off at 55 kt';
      }
      $('[data-prog]').style.transform = `scaleX(${clamp(S.s / path.len, 0, 1)})`;
      const sc = $('[data-scrub]'); if (!sc.matches(':active')) sc.value = Math.round(S.s / path.len * 1000);
    }

    /* ---------- messages and sheets ---------- */
    let msgT = 0;
    function flash(t, ok) { msgEl.textContent = t; msgEl.className = 'sim-msg on' + (ok ? ' ok' : ''); clearTimeout(msgT); msgT = setTimeout(() => msgEl.classList.remove('on'), 2200); }
    function sheet(html) { const s = $('[data-sheet]'); s.innerHTML = html ? `<div class="sim-sheet"><div class="sim-card">${html}</div></div>` : ''; return s; }
    function keysHelp() {
      const t = root.classList.contains('touch');
      return t ? `<div class="sim-keys"><span><kbd>Left pad</kbd></span><span>Stick: drag down to raise the nose, sideways to bank</span><span><kbd>Right bar</kbd></span><span>Power</span><span><kbd>View</kbd></span><span>Chase, cockpit or wide camera</span><span><kbd>AP</kbd></span><span>Autopilot follows your route</span></div>`
        : `<div class="sim-keys"><kbd>↓ / S</kbd><span>Nose up (pull back)</span><kbd>↑ / W</kbd><span>Nose down (push)</span><kbd>← → / A D</kbd><span>Bank left and right (steer on the ground)</span><kbd>= / R</kbd><span>More power</span><kbd>- / F</kbd><span>Less power</span><kbd>B</kbd><span>Brakes</span><kbd>Z</kbd><span>Autopilot follows your route</span><kbd>C</kbd><span>Change camera</span><kbd>P / Esc</kbd><span>Pause</span><kbd>M</kbd><span>Sound</span></div><p style="font-size:13px">A game controller works too: left stick to fly, triggers for power.</p>`;
    }
    function startSheet() {
      paused = true;
      const s = sheet(`<h2>${esc(title)}</h2><p>${(path.len / 1852).toFixed(1)} NM over real terrain. Watch your logged route replayed, or take the controls and fly it yourself.</p>
        <div class="sim-choice"><label><input type="radio" name="m" value="replay" ${initialMode === 'replay' ? 'checked' : ''}> <span><b>Replay</b> · sit back and watch your route</span></label><label><input type="radio" name="m" value="runway" ${initialMode === 'fly' ? 'checked' : ''}> <span><b>Fly it</b> · start on the runway</span></label><label><input type="radio" name="m" value="air"> <span><b>Fly it</b> · start in the air</span></label></div>
        <details><summary style="cursor:pointer;color:#9ED8FF;font-size:14px">Controls</summary><div style="margin-top:10px">${keysHelp()}</div></details>
        <div class="sim-row"><button class="sim-cta" data-go>Start</button><button class="sim-cta l" data-x>Close</button></div>
        <p style="font-size:12px;color:#8FA0C4">A simplified game for fun and route familiarisation. It doesn't count as training time and isn't a substitute for your instructor or a certified simulator.</p>`);
      s.querySelector('[data-go]').onclick = () => { const m = s.querySelector('input:checked').value; sound.resume(); sheet(''); if (m === 'replay') resetReplay(); else resetFly(m); paused = false; };
      s.querySelector('[data-x]').onclick = close;
    }
    function showEnd() {
      if (closed) return; paused = true;
      if (mode === 'replay') {
        const s = sheet(`<h2>Replay complete</h2><p>${esc(title)} · ${(path.len / 1852).toFixed(1)} NM.</p><div class="sim-row"><button class="sim-cta" data-fly>Now fly it yourself</button><button class="sim-cta l" data-again>Watch again</button><button class="sim-cta l" data-x>Close</button></div>`);
        s.querySelector('[data-fly]').onclick = () => { sheet(''); S.done = false; resetFly('runway'); paused = false; };
        s.querySelector('[data-again]').onclick = () => { sheet(''); S.done = false; resetReplay(); paused = false; };
        s.querySelector('[data-x]').onclick = close; return;
      }
      const L = stats.landing, acc = stats.samples ? Math.round(stats.onTrack / stats.samples * 100) : 0;
      const verdict = !L ? 'Flight ended' : L.crash ? 'Crashed' : L.fpm < 150 ? 'Butter landing' : L.fpm < 350 ? 'Smooth landing' : L.fpm < 600 ? 'Firm landing' : 'Hard landing';
      const s = sheet(`<h2>${verdict}</h2><p>${esc(title)}${L && !L.crash ? (L.nearEnd ? ' · landed at the end of your route.' : ' · landed away from the end of your route.') : ''}</p>
        <div class="sim-stats"><div><span>Touchdown</span><b>${L ? `${Math.round(L.fpm)} fpm` : '—'}</b></div><div><span>On track</span><b>${acc}%</b></div><div><span>Flight time</span><b>${mmss(stats.t)}</b></div><div><span>Distance flown</span><b>${(stats.dist / 1852).toFixed(1)} NM</b></div><div><span>Highest</span><b>${Math.round(stats.maxAlt / FT / 10) * 10} ft</b></div><div><span>Route flown</span><b>${Math.round(clamp(S.s / path.len, 0, 1) * 100)}%</b></div></div>
        <div class="sim-row"><button class="sim-cta" data-again>Fly again</button><button class="sim-cta l" data-replay>Watch the replay</button><button class="sim-cta l" data-x>Close</button></div>`);
      s.querySelector('[data-again]').onclick = () => { sheet(''); resetFly('runway'); paused = false; };
      s.querySelector('[data-replay]').onclick = () => { sheet(''); resetReplay(); paused = false; };
      s.querySelector('[data-x]').onclick = close;
    }
    function pauseSheet() {
      paused = true;
      const s = sheet(`<h2>Paused</h2>${keysHelp()}
        <label style="display:flex;gap:10px;align-items:center;font-size:14px"><input type="checkbox" data-assist ${assist ? 'checked' : ''}> Flying assists (hold bank and pitch, level the wings gently)</label>
        <div class="sim-row"><button class="sim-cta" data-res>Resume</button>${mode === 'fly' ? '<button class="sim-cta l" data-end>End flight</button><button class="sim-cta l" data-restart>Restart</button>' : '<button class="sim-cta l" data-fly>Fly it myself</button>'}<button class="sim-cta l" data-x>Close</button></div>`);
      s.querySelector('[data-assist]').onchange = e => assist = e.target.checked;
      s.querySelector('[data-res]').onclick = () => { sheet(''); paused = false; };
      s.querySelector('[data-end]')?.addEventListener('click', () => { sheet(''); showEnd(); });
      s.querySelector('[data-restart]')?.addEventListener('click', () => { sheet(''); resetFly('runway'); paused = false; });
      s.querySelector('[data-fly]')?.addEventListener('click', () => { sheet(''); resetFly('runway'); paused = false; });
      s.querySelector('[data-x]').onclick = close;
    }

    /* ---------- UI ---------- */
    function updateModeUI() {
      root.classList.toggle('replay', mode === 'replay'); root.classList.toggle('ap', ap);
      $('[data-mode]').textContent = mode === 'replay' ? 'Replay' : 'Flying';
      $('[data-ap]').hidden = mode !== 'fly'; $('[data-ap]').setAttribute('aria-pressed', ap);
      $('[data-scrub]').hidden = mode !== 'replay'; $('[data-progbar]').hidden = mode === 'replay';
      $('[data-ts]').innerHTML = mode === 'replay' ? [1, 2, 4, 8, 16].map(x => `<button aria-pressed="${ts === x}" data-x="${x}">${x}×</button>`).join('') : '';
      $$('[data-ts] button').forEach(b => b.onclick = () => { ts = +b.dataset.x; updateModeUI(); });
      $('[data-cam]').textContent = CAMS[cam];
      setWps();
    }
    const $$ = s => [...root.querySelectorAll(s)];
    let wpsSet = -1;
    function setWps() {
      const src = map.getSource && map.getSource('wps'); if (!src) return;
      const k = mode === 'fly' ? wpi : -1; if (k === wpsSet) return; wpsSet = k;
      src.setData({ type: 'FeatureCollection', features: (mode === 'fly' ? wps : [wps[0], wps[wps.length - 1]]).map((w, i) => ({ type: 'Feature', properties: { next: mode === 'fly' && i === wpi }, geometry: { type: 'Point', coordinates: [w.lng, w.lat] } })) });
    }
    $('[data-cam]').onclick = () => { cam = (cam + 1) % 3; updateModeUI(); };
    $('[data-ap]').onclick = () => { ap = !ap; apAlt = Math.max(S.alt, S.ground + 300); if (ap && S.thr < .6) S.thr = .7; updateModeUI(); flash(ap ? 'Autopilot on' : 'Autopilot off', true); };
    $('[data-snd]').onclick = e => e.currentTarget.setAttribute('aria-pressed', sound.toggle());
    $('[data-pause]').onclick = () => paused ? (sheet(''), paused = false) : pauseSheet();
    $('[data-help]').onclick = pauseSheet;
    $('[data-close]').onclick = close;
    $('[data-scrub]').oninput = e => { if (mode !== 'replay') return; const s = +e.target.value / 1000 * path.len; S.s = s; S.done = false; const p = path.at(s); rp.alt = Math.max(rp.alt, groundAt(p) + (s > sRot && s < sTD ? 150 : 0)); trail.length = 0; };

    // keyboard
    const keys = new Set();
    const onKey = (e, down) => {
      if (closed) return; const k = e.key.toLowerCase();
      const map_ = { arrowup: 1, w: 1, arrowdown: 1, s: 1, arrowleft: 1, a: 1, arrowright: 1, d: 1, '=': 1, '+': 1, r: 1, '-': 1, f: 1, b: 1 };
      if (map_[k]) { e.preventDefault(); down ? keys.add(k) : keys.delete(k); }
      if (down && !e.repeat) {
        if (k === 'c') $('[data-cam]').click();
        else if (k === 'z' && mode === 'fly') $('[data-ap]').click();
        else if (k === 'p' || k === 'escape') { e.preventDefault(); $('[data-pause]').click(); }
        else if (k === 'm') $('[data-snd]').click();
      }
      const has = (...a) => a.some(x => keys.has(x));
      inp.pitch = (has('arrowdown', 's') ? 1 : 0) - (has('arrowup', 'w') ? 1 : 0); if (invert) inp.pitch = -inp.pitch;
      inp.roll = (has('arrowright', 'd') ? 1 : 0) - (has('arrowleft', 'a') ? 1 : 0);
      inp.thrUp = (has('=', '+', 'r') ? 1 : 0) - (has('-', 'f') ? 1 : 0);
      inp.brake = has('b');
      if ((inp.pitch || inp.roll) && ap) { ap = false; updateModeUI(); flash('Autopilot off', true); }
    };
    const kd = e => onKey(e, true), ku = e => onKey(e, false);
    addEventListener('keydown', kd); addEventListener('keyup', ku);
    // touch stick and throttle
    const stick = $('[data-stick]'), knob = stick.querySelector('i'), thrEl = $('[data-thr]'), thrFill = thrEl.querySelector('i');
    stick.onpointerdown = e => { stick.setPointerCapture(e.pointerId); touch = stick.getBoundingClientRect(); stick.onpointermove(e); };
    stick.onpointermove = e => { if (!touch) return; const r = touch.width / 2, x = clamp((e.clientX - touch.left - r) / (r * .8), -1, 1), y = clamp((e.clientY - touch.top - r) / (r * .8), -1, 1); inp.stickR = x * Math.abs(x) ** .4; inp.stickP = y * Math.abs(y) ** .4; knob.style.transform = `translate(${x * r * .6}px,${y * r * .6}px)`; if (ap) { ap = false; updateModeUI(); } };
    stick.onpointerup = stick.onpointercancel = () => { touch = null; inp.stickR = inp.stickP = 0; knob.style.transform = ''; };
    const setThr = e => { const r = thrEl.getBoundingClientRect(); S.thr = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); };
    thrEl.onpointerdown = e => { thrEl.setPointerCapture(e.pointerId); thrEl.dragging = true; setThr(e); };
    thrEl.onpointermove = e => { if (thrEl.dragging) setThr(e); };
    thrEl.onpointerup = thrEl.onpointercancel = () => { thrEl.dragging = false; };
    const onResize = () => layout(); addEventListener('resize', onResize);

    function pollPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : []; const gp = [...pads].find(Boolean); if (!gp) { inp.padP = inp.padR = 0; return; }
      const dz = v => Math.abs(v) < .08 ? 0 : v;
      inp.padR = dz(gp.axes[0] || 0); inp.padP = dz(gp.axes[1] || 0);
      const up = gp.buttons[7]?.value || 0, dn = gp.buttons[6]?.value || 0; if (up || dn) S.thr = clamp(S.thr + (up - dn) * .6 * frameDt, 0, 1);
      inp.brake = inp.brake || !!gp.buttons[0]?.pressed;
    }

    /* ---------- loop ---------- */
    let last = performance.now(), frameDt = 1 / 60, ready = false;
    const planeL = planeLayer(() => snap);
    map.on('load', () => {
      try { map.addLayer(planeL); } catch (e) { console.warn(e); }
      setWps();
      const done = () => { if (ready) return; ready = true; const ge = elevAt(start); if (ge != null) { E0 = ge; lastGround = ge; } S.alt = S.ground = E0; rp.alt = rp.floor = E0; $('[data-load]').classList.add('done'); startSheet(); };
      map.once('idle', done); setTimeout(done, 7000);
    });
    map.on('error', e => console.warn('sim map', e?.error?.message || e));
    function frame(now) {
      if (closed) return;
      raf = requestAnimationFrame(frame);
      frameDt = clamp((now - last) / 1000, 0, .05); last = now;
      if (!map.loaded() && !ready) return;
      pollPad();
      if (!paused && ready) {
        if (mode === 'replay') { let t = frameDt * ts; while (t > 0) { const h = Math.min(t, .05); stepReplay(h); t -= h; } }
        else { let t = frameDt; while (t > 0) { const h = Math.min(t, 1 / 120); stepFly(h); t -= h; } }
        trailT += frameDt; if (trailT > .4 && !S.onGround) { trailT = 0; trail.push([S.lng, S.lat]); if (trail.length > 1500) trail.shift(); map.getSource('trail')?.setData(gj(trail)); }
        if (mode === 'fly') setWps();
      }
      sound.update(S.thr, S.v, S.stall && mode === 'fly' && !S.onGround, ready && !paused && !S.crashed && (S.v > .5 || S.thr > .01 || mode === 'fly'));
      placeCamera(); drawHUD(); updatePanel();
    }
    raf = requestAnimationFrame(frame);

    function close() {
      if (closed) return; closed = true; cancelAnimationFrame(raf);
      removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', onResize);
      sound.close(); try { map.remove(); } catch { }
      root.remove(); document.documentElement.style.overflow = '';
      onClose && onClose();
    }
    return { close };
  }

  return { open, buildPath };
})();
