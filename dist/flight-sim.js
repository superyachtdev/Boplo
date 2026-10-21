/* Boplo Flight — mini simulator.
   Replays a logged route over real 3D terrain, or lets the student fly it themselves.
   Map: MapLibre GL + OpenFreeMap vector tiles, terrain from the AWS Terrain Tiles open dataset (Terrarium).
   Aircraft, route gates and shadow are drawn in a WebGL2 overlay that shares the map camera's geometry.
   It is a game-like practice toy, not a training device: the flight model is deliberately simple. */
window.BoploSim = (() => {
  'use strict';
  const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
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

  let libReady = null;
  function loadLib() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (window.BoploMap?.loadLib) return window.BoploMap.loadLib();
    if (libReady) return libReady;
    libReady = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LIB + '.css'; document.head.append(css);
      const s = document.createElement('script'); s.src = LIB + '.js'; s.async = true;
      s.onload = () => window.maplibregl ? res(window.maplibregl) : rej(new Error('Map library unavailable.'));
      s.onerror = () => { libReady = null; rej(new Error('The map library could not load.')); };
      document.head.append(s);
    });
    return libReady;
  }
  function loadCSS() { if (document.querySelector('link[data-simcss]')) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/flight-sim.css?v=2'; l.dataset.simcss = '1'; document.head.append(l); }

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

  /* ---------------- matrices (column-major) ---------------- */
  const M4 = {
    persp(fy, as, n, f) { const t = 1 / Math.tan(fy / 2), nf = 1 / (n - f); return new Float32Array([t / as, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]); },
    look(e, t, up) {
      const n = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const z = n(sub(e, t)), x = n(cr(up, z)), y = cr(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dt(x, e), -dt(y, e), -dt(z, e), 1]);
    },
    mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    ry(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rx(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    rz(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    sc(k, ty = 0) { return new Float32Array([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, ty, 0, 1]); }
  };

  /* ---------------- WebGL overlay: aircraft, shadow, gates ---------------- */
  const SUN = (() => { const v = [-.45, .78, -.42], l = Math.hypot(...v); return v.map(x => x / l); })();
  function overlay(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false, stencil: true });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs, attrs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
    const uni = (p, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)]));

    // painted aircraft: per-vertex colour, w = material (1 paint, 2 glass, 0 matte)
    const aProg = prog(`#version 300 es
      in vec3 aPos; in vec3 aNor; in vec4 aCol; uniform mat4 uVP; uniform mat4 uM; out vec3 vW; out vec3 vN; out vec4 vC;
      void main(){ vec4 w=uM*vec4(aPos,1.); vW=w.xyz; vN=mat3(uM)*aNor; vC=aCol; gl_Position=uVP*w; }`, `#version 300 es
      precision highp float; in vec3 vW; in vec3 vN; in vec4 vC; uniform vec3 uCam; uniform vec3 uSun; out vec4 o;
      void main(){
        vec3 n=normalize(vN), v=normalize(uCam-vW); if(dot(n,v)<0.) n=-n;
        vec3 sky=vec3(.62,.76,.95), gnd=vec3(.36,.38,.30);
        float nl=max(dot(n,uSun),0.), hemi=n.y*.5+.5;
        vec3 amb=mix(gnd,sky,hemi)*.42;
        vec3 h=normalize(uSun+v); float fres=pow(1.-max(dot(n,v),0.),5.);
        vec3 col;
        if(vC.w>1.5){ // glass: dark tint, sky reflection
          vec3 r=reflect(-v,n); float up=clamp(r.y*.5+.5,0.,1.);
          col=vC.rgb*(amb+nl*.4)+mix(gnd*.5,sky*1.05,up)*(.35+.65*fres)+vec3(1.,.97,.9)*pow(max(dot(n,h),0.),180.)*2.5*nl;
        } else {
          float spec=vC.w>.5?pow(max(dot(n,h),0.),70.)*.9:pow(max(dot(n,h),0.),12.)*.05;
          col=vC.rgb*(amb+vec3(1.,.97,.9)*nl*1.05)+vec3(1.,.97,.9)*spec*nl+sky*fres*(vC.w>.5?.22:.03);
        }
        col=col/(col+vec3(.85))*1.75; // gentle tone map
        o=vec4(pow(col,vec3(.95)),1.);
      }`, ['aPos', 'aNor', 'aCol']);
    const aU = uni(aProg, ['uVP', 'uM', 'uCam', 'uSun']);
    // shadow: the same mesh flattened onto the ground along the sun direction
    const sProg = prog(`#version 300 es
      in vec3 aPos; uniform mat4 uVP; uniform mat4 uM; uniform vec3 uSun; uniform float uG;
      void main(){ vec4 w=uM*vec4(aPos,1.); float h=w.y-uG; w.xyz-=uSun*(h/uSun.y); w.y=uG; gl_Position=uVP*w; }`, `#version 300 es
      precision highp float; uniform float uA; out vec4 o; void main(){ o=vec4(0.02,0.03,0.05,uA); }`, ['aPos']);
    const sU = uni(sProg, ['uVP', 'uM', 'uSun', 'uG', 'uA']);

    const aVao = gl.createVertexArray(); gl.bindVertexArray(aVao);
    {
      const out = []; let C = [1, 1, 1, 1];
      const WHITE = [.93, .94, .96, 1], BLUE = [.04, .30, .95, 1], ICE = [.62, .85, 1, 1], GLASS = [.06, .09, .14, 2], DARK = [.10, .11, .13, 0], GREY = [.55, .58, .62, 0], RUBBER = [.05, .05, .06, 0];
      const tri = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n) || 1; n = n.map(x => x / l); for (const p of [a, b, c]) out.push(...p, ...n, ...C); };
      const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
      const hexa = (b, t) => { quad(b[0], b[1], b[2], b[3]); quad(t[3], t[2], t[1], t[0]); for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b[i], b[j], t[j], t[i]); } };
      // fuselage with rounded (octagonal) sections: [z, centreY, width, height]
      const S = [[1.06, .02, .13, .13], [.9, .03, .27, .27], [.6, .06, .33, .36], [.3, .08, .34, .38], [.0, .08, .32, .36], [-.4, .07, .25, .27], [-.85, .08, .16, .18], [-1.3, .1, .09, .11], [-1.55, .12, .045, .07]];
      const ring = ([z, y, w, h], k = 1) => { const a = w / 2 * k, b = h / 2 * k, c = .62; return [[-a * c, y - b, z], [a * c, y - b, z], [a, y - b * c, z], [a, y + b * c, z], [a * c, y + b, z], [-a * c, y + b, z], [-a, y + b * c, z], [-a, y - b * c, z]]; };
      C = WHITE;
      for (let i = 0; i < S.length - 1; i++) { const A = ring(S[i]), B = ring(S[i + 1]); for (let k = 0; k < 8; k++) { const j = (k + 1) % 8; quad(A[k], A[j], B[j], B[k]); } }
      { const A = ring(S[S.length - 1]); for (let k = 1; k < 7; k++) tri(A[0], A[k + 1], A[k]); }
      // blue cheatline along both sides
      C = BLUE;
      for (let i = 1; i < S.length - 2; i++) for (const s of [-1, 1]) {
        const [z0, y0, w0] = S[i], [z1, y1, w1] = S[i + 1], o0 = w0 / 2 + .006, o1 = w1 / 2 + .006, t = .035;
        quad([s * o0, y0 - t, z0], [s * o1, y1 - t, z1], [s * o1, y1 + t, z1], [s * o0, y0 + t, z0]);
      }
      // canopy glasshouse and windscreen
      C = GLASS;
      hexa([[-.155, .2, .66], [.155, .2, .66], [.165, .22, -.18], [-.165, .22, -.18]], [[-.11, .315, .38], [.11, .315, .38], [.12, .33, -.05], [-.12, .33, -.05]]);
      C = WHITE; hexa([[-.12, .33, .38], [.12, .33, .38], [.12, .33, -.05], [-.12, .33, -.05]], [[-.1, .345, .34], [.1, .345, .34], [.1, .35, -.02], [-.1, .35, -.02]]);
      // low wing with dihedral and a little taper, blue tips
      for (const s of [-1, 1]) {
        C = WHITE; hexa([[s * .14, -.13, .52], [s * 1.5, -.045, .44], [s * 1.5, -.045, .07], [s * .14, -.13, .0]], [[s * .14, -.075, .5], [s * 1.5, -.02, .43], [s * 1.5, -.02, .08], [s * .14, -.075, .02]]);
        C = BLUE; hexa([[s * 1.5, -.045, .44], [s * 1.64, -.035, .4], [s * 1.64, -.035, .12], [s * 1.5, -.045, .07]], [[s * 1.5, -.02, .43], [s * 1.64, -.012, .39], [s * 1.64, -.012, .13], [s * 1.5, -.02, .08]]);
        C = GREY; hexa([[s * .9, -.07, .08], [s * 1.45, -.045, .08], [s * 1.45, -.045, .03], [s * .9, -.07, .03]], [[s * .9, -.055, .08], [s * 1.45, -.03, .08], [s * 1.45, -.03, .03], [s * .9, -.055, .03]]);
      }
      // stabilator and swept fin with a blue top
      C = WHITE; for (const s of [-1, 1]) hexa([[s * .04, .09, -1.2], [s * .62, .11, -1.3], [s * .62, .11, -1.48], [s * .04, .09, -1.52]], [[s * .04, .125, -1.2], [s * .62, .13, -1.3], [s * .62, .13, -1.48], [s * .04, .125, -1.52]]);
      hexa([[-.022, .14, -.95], [.022, .14, -.95], [.022, .14, -1.55], [-.022, .14, -1.55]], [[-.016, .5, -1.33], [.016, .5, -1.33], [.016, .5, -1.6], [-.016, .5, -1.6]]);
      C = BLUE; hexa([[-.016, .5, -1.33], [.016, .5, -1.33], [.016, .5, -1.6], [-.016, .5, -1.6]], [[-.014, .64, -1.43], [.014, .64, -1.43], [.014, .64, -1.63], [-.014, .64, -1.63]]);
      // gear legs, wheel fairings
      for (const [x, z] of [[-.44, .06], [.44, .06], [0, .84]]) {
        C = GREY; hexa([[x - .014, -.44, z - .014], [x + .014, -.44, z - .014], [x + .014, -.44, z + .014], [x - .014, -.44, z + .014]], [[x - .014, -.12, z - .014], [x + .014, -.12, z - .014], [x + .014, -.12, z + .014], [x - .014, -.12, z + .014]]);
        C = RUBBER; hexa([[x - .028, -.545, z - .075], [x + .028, -.545, z - .075], [x + .028, -.545, z + .075], [x - .028, -.545, z + .075]], [[x - .028, -.4, z - .075], [x + .028, -.4, z - .075], [x + .028, -.4, z + .075], [x - .028, -.4, z + .075]]);
        C = WHITE; hexa([[x - .05, -.5, z - .14], [x + .05, -.5, z - .14], [x + .05, -.5, z + .14], [x - .05, -.5, z + .14]], [[x - .04, -.4, z - .12], [x + .04, -.4, z - .12], [x + .04, -.4, z + .1], [x - .04, -.4, z + .1]]);
      }
      // spinner
      C = BLUE; tri([0, .02, 1.24], [-.065, -.045, 1.06], [.065, -.045, 1.06]); tri([0, .02, 1.24], [.065, -.045, 1.06], [.065, .085, 1.06]); tri([0, .02, 1.24], [.065, .085, 1.06], [-.065, .085, 1.06]); tri([0, .02, 1.24], [-.065, .085, 1.06], [-.065, -.045, 1.06]);
      // cowling intake
      C = DARK; hexa([[-.05, -.06, 1.055], [.05, -.06, 1.055], [.05, -.02, 1.055], [-.05, -.02, 1.055]], [[-.05, -.06, 1.06], [.05, -.06, 1.06], [.05, -.02, 1.06], [-.05, -.02, 1.06]]);
      const d = new Float32Array(out), b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
      aVao.count = d.length / 10;
    }
    // flat coloured triangles: gates, propeller disc
    const cProg = prog(`#version 300 es
      in vec3 aPos; in vec4 aCol; uniform mat4 uVP; out vec4 vC; void main(){ vC=aCol; gl_Position=uVP*vec4(aPos,1.); }`, `#version 300 es
      precision highp float; in vec4 vC; out vec4 o; void main(){ o=vC; }`, ['aPos', 'aCol']);
    const cU = uni(cProg, ['uVP']);
    const cVao = gl.createVertexArray(); gl.bindVertexArray(cVao);
    const cBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    // nav lights
    const nProg = prog(`#version 300 es
      in vec3 aPos; uniform mat4 uVP; uniform float uSize; void main(){ vec4 p=uVP*vec4(aPos,1.); gl_Position=p; gl_PointSize=clamp(uSize/p.w,2.,64.); }`, `#version 300 es
      precision highp float; uniform vec3 uColor; uniform float uA; out vec4 o; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); o=vec4(uColor*(a*a*1.4+.3),a*uA); }`, ['aPos']);
    const nU = uni(nProg, ['uVP', 'uSize', 'uColor', 'uA']);
    const nVao = gl.createVertexArray(); gl.bindVertexArray(nVao);
    const nBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nBuf); gl.bufferData(gl.ARRAY_BUFFER, 9 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const xf = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
    function draw({ VP, eye, M, groundY, shadowA, tris, showPlane, prop, t }) {
      const w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clearStencil(0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE);
      if (showPlane && shadowA > .01) {
        // each pixel darkened once, so overlapping parts don't stack
        gl.disable(gl.DEPTH_TEST); gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
        gl.useProgram(sProg); gl.bindVertexArray(aVao);
        gl.uniformMatrix4fv(sU.uVP, false, VP); gl.uniformMatrix4fv(sU.uM, false, M); gl.uniform3f(sU.uSun, ...SUN); gl.uniform1f(sU.uG, groundY); gl.uniform1f(sU.uA, shadowA);
        gl.drawArrays(gl.TRIANGLES, 0, aVao.count);
        gl.disable(gl.STENCIL_TEST);
      }
      if (showPlane) {
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
        gl.useProgram(aProg); gl.bindVertexArray(aVao);
        gl.uniformMatrix4fv(aU.uVP, false, VP); gl.uniformMatrix4fv(aU.uM, false, M); gl.uniform3f(aU.uCam, ...eye); gl.uniform3f(aU.uSun, ...SUN);
        gl.drawArrays(gl.TRIANGLES, 0, aVao.count);
      }
      const all = tris.slice();
      if (showPlane && prop) {
        const seg = 28, r = .4, c = xf(M, [0, .02, 1.13]);
        for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2; const p0 = xf(M, [Math.cos(a0) * r, .02 + Math.sin(a0) * r, 1.13]), p1 = xf(M, [Math.cos(a1) * r, .02 + Math.sin(a1) * r, 1.13]); const al = prop * (.08 + .07 * Math.max(0, Math.cos(a0 * 2 - t * 9))); all.push(...c, .12, .13, .16, al * 1.4, ...p0, .12, .13, .16, al, ...p1, .12, .13, .16, al); }
      }
      if (all.length) {
        gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.useProgram(cProg); gl.bindVertexArray(cVao); gl.uniformMatrix4fv(cU.uVP, false, VP);
        gl.bindBuffer(gl.ARRAY_BUFFER, cBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(all), gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, all.length / 7);
      }
      if (showPlane) {
        gl.disable(gl.DEPTH_TEST);
        const pts = [xf(M, [-1.65, -.025, .26]), xf(M, [1.65, -.025, .26]), xf(M, [0, .65, -1.62])].flat();
        gl.useProgram(nProg); gl.bindVertexArray(nVao); gl.bindBuffer(gl.ARRAY_BUFFER, nBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(pts));
        gl.uniformMatrix4fv(nU.uVP, false, VP);
        const k = h / 900 * 60;
        gl.uniform1f(nU.uSize, k); gl.uniform1f(nU.uA, .9);
        gl.uniform3f(nU.uColor, 1, .2, .25); gl.drawArrays(gl.POINTS, 0, 1);
        gl.uniform3f(nU.uColor, .25, 1, .5); gl.drawArrays(gl.POINTS, 1, 1);
        if ((t % 1.3) < .06) { gl.uniform1f(nU.uSize, k * 2.4); gl.uniform3f(nU.uColor, 1, 1, 1); gl.drawArrays(gl.POINTS, 2, 1); }
      }
      gl.depthMask(true); gl.bindVertexArray(null);
    }
    return { draw, gl };
  }

  /* ---------------- map style ---------------- */
  function simStyle() {
    const nameF = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
    return {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        sat: { type: 'raster', tiles: [IMG], tileSize: 256, maxzoom: 14, attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2017, CC BY 4.0)' },
        omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
        dem: { type: 'raster-dem', tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>' }
      },
      sky: { 'sky-color': '#5E93D8', 'horizon-color': '#DCE8F4', 'fog-color': '#C7D6E6', 'fog-ground-blend': .62, 'horizon-fog-blend': .82, 'sky-horizon-blend': .72, 'atmosphere-blend': .9 },
      terrain: { source: 'dem', exaggeration: 1 },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#5D6B4E' } },
        { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -.08, 'raster-contrast': .08, 'raster-brightness-min': .03, 'raster-fade-duration': 0 } },
        { id: 'hills', type: 'hillshade', source: 'dem', paint: { 'hillshade-shadow-color': 'rgba(20,24,40,0.55)', 'hillshade-highlight-color': 'rgba(255,248,230,0.18)', 'hillshade-accent-color': 'rgba(20,24,40,0.15)', 'hillshade-exaggeration': .42, 'hillshade-illumination-direction': 300, 'hillshade-illumination-anchor': 'map' } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': 'rgba(20,48,78,0.35)' } },
        { id: 'roads-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], paint: { 'line-color': 'rgba(235,228,214,0.45)', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 16, 6] } },
        { id: 'roads-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]], paint: { 'line-color': 'rgba(225,220,205,0.28)', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 4] } },
        { id: 'aeroway-area', type: 'fill', source: 'omt', 'source-layer': 'aeroway', minzoom: 11, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': 'rgba(120,150,95,0.25)' } },
        { id: 'runways', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 10, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], paint: { 'line-color': 'rgba(70,72,76,0.92)', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, 1.5, 18, 120] } },
        { id: 'runway-cl', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 14, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], paint: { 'line-color': 'rgba(255,255,255,0.85)', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, .5, 18, 3], 'line-dasharray': [6, 6] } },
        { id: 'taxiways', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 13, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']], paint: { 'line-color': 'rgba(80,82,86,0.85)', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 1, 18, 40] } },
        { id: 'buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-extrusion-color': '#B9B2A6', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 7], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': .9, 'fill-extrusion-vertical-gradient': true } },
        { id: 'places-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 9.5, filter: ['in', ['get', 'class'], ['literal', ['town', 'village']]], layout: { 'text-field': nameF, 'text-font': ['Noto Sans Regular'], 'text-size': 12.5 }, paint: { 'text-color': 'rgba(255,255,255,0.9)', 'text-halo-color': 'rgba(10,20,40,0.7)', 'text-halo-width': 1.4 } },
        { id: 'places-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 5, filter: ['==', ['get', 'class'], 'city'], layout: { 'text-field': nameF, 'text-font': ['Noto Sans Regular'], 'text-size': 15 }, paint: { 'text-color': '#FFFFFF', 'text-halo-color': 'rgba(10,20,40,0.75)', 'text-halo-width': 1.6 } }
      ]
    };
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
    return `<div class="sim-map" data-map></div><canvas class="sim-gl" data-gl></canvas><div class="sim-vig" aria-hidden="true"></div>
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
    let alive = true, raf = 0, map = null, ov = null;
    const audio = engineAudio();
    const cleanups = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };
    function destroy() {
      if (!alive) return; alive = false; cancelAnimationFrame(raf); cleanups.forEach(f => f()); audio.stop();
      try { map?.remove(); } catch { } if (dlg.open) dlg.close(); dlg.remove(); O.onClose && O.onClose();
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

    /* ---- map ---- */
    let ml;
    try { ml = await loadLib(); } catch (e) { fail(e.message); wireX(); return { close: destroy }; }
    if (!alive) return { close: destroy };
    const startLL = F.ll(P[0][0], P[0][1]);
    try {
      map = new ml.Map({ container: $('[data-map]'), style: simStyle(), center: startLL, zoom: 14, pitch: 70, bearing: path.at(60)[2] * R2D, interactive: false, attributionControl: { compact: true }, maxPitch: 85, fadeDuration: 0, pixelRatio: Math.min(devicePixelRatio || 1, 1.75) });
    } catch (e) { fail('Your browser couldn’t start 3D graphics (WebGL). Try Chrome, Edge or Safari.'); wireX(); return { close: destroy }; }
    try { map.transform.fov = 52; } catch { }
    const plannedLine = { type: 'Feature', geometry: { type: 'LineString', coordinates: P.map(p => F.ll(p[0], p[1])) } };
    const flown = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } };
    await new Promise(res => { if (map.loaded()) res(); map.once('load', res); setTimeout(res, 9000); });
    const attrib = root.querySelector('.maplibregl-ctrl-attrib'); if (attrib) { attrib.classList.add('maplibregl-compact'); attrib.classList.remove('maplibregl-compact-show'); attrib.removeAttribute('open'); }
    if (!alive) return { close: destroy };
    try {
      map.addSource('plan', { type: 'geojson', data: plannedLine });
      map.addLayer({ id: 'plan-glow', type: 'line', source: 'plan', paint: { 'line-color': '#0A62FF', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 16], 'line-blur': 5, 'line-opacity': .22 } });
      map.addLayer({ id: 'plan', type: 'line', source: 'plan', paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 16, 2.4], 'line-dasharray': [3, 3], 'line-opacity': .55 } });
      map.addSource('flown', { type: 'geojson', data: flown });
      map.addLayer({ id: 'flown', type: 'line', source: 'flown', paint: { 'line-color': '#FFD24A', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 16, 3.5], 'line-opacity': .55 } });
      const wps = (O.waypoints || []).filter(w => w.code);
      if (O.country && window.BoploMap?.airfields) BoploMap.airfields(O.country).then(list => {
        if (!alive || !map.getStyle()) return;
        const near = list.filter(a => a.type !== 'S' && a.type !== 'H').map(a => ({ a, d: Math.hypot(...F.to(a.lat, a.lng)) })).filter(x => x.d < Math.max(60000, L + 40000)).map(x => x.a);
        map.addSource('afs', { type: 'geojson', data: { type: 'FeatureCollection', features: near.map(a => ({ type: 'Feature', properties: { code: a.code, name: a.name, big: a.type === 'L' || a.type === 'M' ? 1 : 0 }, geometry: { type: 'Point', coordinates: [a.lng, a.lat] } })) } });
        map.addLayer({ id: 'afs', type: 'symbol', source: 'afs', minzoom: 8, layout: { 'text-field': ['get', 'code'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, -1.2], 'icon-allow-overlap': true }, paint: { 'text-color': '#9ED8FF', 'text-halo-color': '#020611', 'text-halo-width': 1.8 } });
        map.addLayer({ id: 'afs-dot', type: 'circle', source: 'afs', minzoom: 8, paint: { 'circle-radius': 4, 'circle-color': '#020611', 'circle-stroke-color': '#9ED8FF', 'circle-stroke-width': 1.6 } });
      });
      if (wps.length) {
        map.addSource('wps', { type: 'geojson', data: { type: 'FeatureCollection', features: wps.map(w => ({ type: 'Feature', properties: { code: w.code }, geometry: { type: 'Point', coordinates: [w.lng, w.lat] } })) } });
        map.addLayer({ id: 'wps', type: 'symbol', source: 'wps', layout: { 'text-field': ['get', 'code'], 'text-font': ['Noto Sans Regular'], 'text-size': 15, 'text-offset': [0, -1.4], 'text-allow-overlap': true }, paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#0A62FF', 'text-halo-width': 2.2 } });
      }
    } catch { }
    // let terrain at the start load, then read the ground height there
    await new Promise(res => { let done = false; const fin = () => { if (!done) { done = true; res(); } }; map.once('idle', fin); setTimeout(fin, 7000); });
    if (!alive) return { close: destroy };
    // a terrain tile that hasn't loaded yet reads as 0 m: treat that as unknown once we know the real ground is higher
    let goodGround = null;
    // MapLibre 4's queryTerrainElevation is relative to the camera centre, so read the terrain model directly (metres above sea level)
    const absElev = ll => { const t = map.terrain; if (!t) return null; try { return t.getElevationForLngLatZoom(ml.LngLat.convert(ll), map.transform.tileZoom); } catch { const e = map.queryTerrainElevation(ll); return Number.isFinite(e) ? e + (map.transform.elevation || 0) : null; } };
    const elevAt = (x, z) => { try { const e = absElev(F.ll(x, z)); if (!Number.isFinite(e)) return null; if (Math.abs(e) < .01 && goodGround != null && Math.abs(goodGround) > 12) return null; return e; } catch { return null; } };
    // wait (briefly) for real terrain under the start point
    for (let i = 0; i < 30 && alive; i++) { const e = absElev(F.ll(P[0][0], P[0][1])); if (Number.isFinite(e) && Math.abs(e) > .01) break; if (O.fromElevFt != null && O.fromElevFt < 15) break; await new Promise(r => setTimeout(r, 200)); }
    const g0 = elevAt(P[0][0], P[0][1]) ?? (O.fromElevFt != null ? O.fromElevFt * FT : 0); goodGround = g0;
    const last = P[P.length - 1];
    const g1 = Math.hypot(last[0] - P[0][0], last[1] - P[0][1]) < 1500 ? g0 : (elevAt(last[0], last[1]) ?? (O.toElevFt != null ? O.toElevFt * FT : g0));
    const cruise = O.cruiseFt ? O.cruiseFt * FT : (circuit ? g0 + 1000 * FT : Math.max(g0, g1) + 2200 * FT);
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
    const coarse = matchMedia('(pointer: coarse)').matches;
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
      const ge = elevAt(st.x, st.z); if (ge != null) { st.gnd = ge; goodGround = ge; }
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

    /* ---- overlay ---- */
    const glc = $('[data-gl]');
    try { ov = overlay(glc); } catch { ov = null; }
    const resize = () => { const r = root.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2); glc.width = Math.round(r.width * d); glc.height = Math.round(r.height * d); map?.resize(); };
    resize(); on(window, 'resize', resize);
    let camH = st.hdg, camD = 8.5, camPitchLag = 0;

    function gateTris(eye, fwd) {
      const out = [], W = circuit ? 70 : 110, H = circuit ? 40 : 60, T = circuit ? 1.6 : 2.4;
      const pr = path.project(st.x, st.z), near = gates.filter(g => g.s > pr.s + 15).slice(0, 5);
      near.forEach((g, i) => {
        const cx = g.x - st.x, cz = g.z - st.z, cy = g.y - st.alt, d = Math.hypot(cx, cz);
        const fade = clamp(1 - d / (circuit ? 2400 : 6000), 0, 1) * clamp(d / 60, 0, 1), passed = false;
        const a = (i === 0 ? .7 : .38) * fade; if (a < .02) return;
        const r = [Math.cos(g.h), 0, -Math.sin(g.h)], up = [0, 1, 0];
        const P = (u, v) => [cx + r[0] * u, cy + v, cz + r[2] * u];
        const col = i === 0 ? [1, .84, .3] : [1, 1, 1];
        const bar = (u0, v0, u1, v1) => { const p = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]; for (const ix of [0, 1, 2, 0, 2, 3]) out.push(...p[ix], ...col, a); };
        // corner glow
        // corner brackets only, so the view stays open
        const c = W * .22, k = H * .3;
        bar(-W / 2, -H / 2, -W / 2 + c, -H / 2 + T * 1.6); bar(W / 2 - c, -H / 2, W / 2, -H / 2 + T * 1.6); bar(-W / 2, H / 2 - T * 1.6, -W / 2 + c, H / 2); bar(W / 2 - c, H / 2 - T * 1.6, W / 2, H / 2);
        bar(-W / 2, -H / 2, -W / 2 + T * 1.6, -H / 2 + k); bar(-W / 2, H / 2 - k, -W / 2 + T * 1.6, H / 2); bar(W / 2 - T * 1.6, -H / 2, W / 2, -H / 2 + k); bar(W / 2 - T * 1.6, H / 2 - k, W / 2, H / 2);
      });
      return out;
    }
    function frameDraw(dt) {
      const w = root.clientWidth, h = root.clientHeight, as = w / Math.max(h, 1);
      const fov = map.transform?._fov || FOV, hfov = 2 * Math.atan(Math.tan(fov / 2) * as);
      const [, kB, kH, depBase] = CAMS[camI];
      const B0 = clamp(5.6 / Math.tan((as < 1 ? .34 : .24) * hfov), 18, 70), B = B0 * kB, Hc = (B0 * .22 + 2) * kH;
      camH += wrap180(st.hdg - camH) * Math.min(1, dt * (camI === 2 ? 1.2 : 2.6));
      camPitchLag += (st.pitch - camPitchLag) * Math.min(1, dt * 3);
      camD += (depBase - camD) * Math.min(1, dt * 3);
      const dep = clamp(camD - camPitchLag * .55 + (st.ground ? 2 : 0), 3, 60) * D2R;
      const ch = camH * D2R, f = [Math.sin(ch), Math.cos(ch)];
      const ex = -f[0] * B, ez = -f[1] * B; // eye relative to the aircraft
      let ey = Hc;
      const gEye = elevAt(st.x + ex, st.z + ez); if (gEye != null) ey = Math.max(ey, gEye - st.alt + 4);
      // map camera
      const camAlt = st.alt + ey, tgtGround = gEye ?? st.gnd, t = Math.max(12, (camAlt - tgtGround)) / Math.tan(dep);
      const cx = st.x + ex + f[0] * t, cz = st.z + ez + f[1] * t;
      try {
        const opt = map.calculateCameraOptionsFromTo(ml.LngLat.convert(F.ll(st.x + ex, st.z + ez)), camAlt, ml.LngLat.convert(F.ll(cx, cz)), tgtGround);
        map.jumpTo({ center: opt.center, zoom: clamp(opt.zoom, 2, 21.5), pitch: clamp(opt.pitch, 0, 85), bearing: opt.bearing });
      } catch { }
      // overlay camera (same geometry, aircraft at the origin)
      if (ov) {
        const eye = [ex, ey, ez], tgt = [ex + f[0] * Math.cos(dep) * 100, ey - Math.sin(dep) * 100, ez + f[1] * Math.cos(dep) * 100];
        const V = M4.look(eye, tgt, [0, 1, 0]), Pm = M4.persp(fov, as, .5, 20000), VP = M4.mul(Pm, V);
        const S = 3.4, M = M4.mul(M4.mul(M4.mul(M4.ry(st.hdg * D2R), M4.rx(-(st.att ?? st.pitch) * D2R)), M4.rz(-st.bank * D2R)), M4.sc(S)); M[13] += .54 * S;
        const agl = st.alt - st.gnd, tris = showGates && camI !== 2 ? gateTris(eye, f) : [];
        ov.draw({ VP, eye, M, groundY: st.gnd - st.alt + .05, shadowA: clamp(.5 * (1 - agl / 220), 0, .5), tris, showPlane: !st.crashed, prop: st.thr > .02 || st.v > 3 ? 1 : 0, t: st.t });
      }
    }

    /* ---- HUD ---- */
    const H = { ias: $('[data-ias]'), alt: $('[data-alt]'), vs: $('[data-vs]'), hdg: $('[data-hdg]'), tape: $('[data-tape]'), hor: $('[data-hor]'), bp: $('[data-bankptr]'), thr: $('[data-thr]'), flaps: $('[data-flaps]'), wp: $('[data-wp]'), wpd: $('[data-wpd]'), warn: $('[data-warn]'), needle: $('[data-needle]'), xte: $('[data-xte]'), bug: $('[data-bugi]'), time: $('[data-time]'), scrub: $('[data-scrub]') };
    const wpts = (O.waypoints || []).map(w => ({ ...w, s: path.project(...F.to(w.lat, w.lng), true).s })); path.seed(0);
    let warnText = '', tipText = '', tipNow = '', tipUntil = 0;
    const tipEl = document.createElement('div'); tipEl.className = 'sim-tip'; tipEl.setAttribute('role', 'status'); $('[data-warn]').after(tipEl);
    function hud() {
      const vk = st.v / KT, pr = path.project(st.x, st.z);
      H.ias.textContent = Math.round(st.ground && vk < 5 ? 0 : vk);
      H.alt.textContent = Math.max(0, Math.round(st.alt / FT / 10) * 10).toLocaleString('en-GB');
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
    H.scrub.oninput = () => { const s = H.scrub.value / 1000 * L; const air = prof(s) - (elevAt(...path.at(s).slice(0, 2)) ?? g0) > 30; place(s, air); flown.geometry.coordinates = []; };
    $('[data-sub]').textContent = [O.subtitle, replay ? 'Replay' : 'Fly it', wind.spd ? `Wind ${pad3(wind.dir)}°/${wind.spd} kt` : 'Calm'].filter(Boolean).join(' · ');

    /* ---- ready card ---- */
    const ctrlHelp = coarse
      ? `<li><b>Stick</b> bottom left: pull back to climb, push to descend, sideways to bank.</li><li><b>Power</b> slider on the right. Or turn on <b>Tilt to steer</b>.</li>`
      : `<li><b>↑ ↓</b> or <b>W S</b>: nose down / nose up (pull back to climb)</li><li><b>← →</b> or <b>A D</b>: bank left / right</li><li><b>R F</b> or <b>+ −</b>: more or less power · <b>1–0</b> set power</li><li><b>V</b> flaps (use them to slow down for landing) · <b>G</b> route gates</li><li><b>P</b> autopilot · <b>C</b> camera · <b>Space</b> pause · <b>M</b> sound</li><li>A gamepad works too.</li>`;
    card(`<span class="sim-kicker">${replay ? 'Replay' : 'Fly it'} · ${esc(O.aircraft || 'Trainer')}</span><h2>${esc(O.title)}</h2>
      <p>${replay ? 'Sit back while the autopilot flies your logged route over real terrain. Change the speed, scrub along the route, or switch camera.' : `Fly the route yourself. Follow the gates and the dashed line, ${groundStart ? 'take off from the runway' : 'starting in the air'}${landEnd ? ', and land at the end' : ''}.`}</p>
      <div class="sim-facts"><div><span>Distance</span><b>${(L / NM).toFixed(1)} NM</b></div><div><span>Planned height</span><b>${Math.round(cruise / FT / 100) * 100} ft</b></div><div><span>Wind</span><b>${wind.spd ? `${pad3(wind.dir)}° / ${wind.spd} kt` : 'Calm'}</b></div></div>
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
        <div class="sim-facts"><div><span>Time</span><b>${mmss(t)}</b></div><div><span>Flown</span><b>${(score.dist / NM).toFixed(1)} NM</b></div><div><span>Highest</span><b>${Math.round(score.maxAlt / FT / 10) * 10} ft</b></div>
        ${replay ? '' : `<div><span>On the route</span><b>${tube}%</b></div><div><span>Average off track</span><b>${xte < .1 ? Math.round(xte * NM) + ' m' : xte.toFixed(2) + ' NM'}</b></div><div><span>Your best</span><b>${best != null ? Math.max(best, kind === 'crash' ? 0 : tube) + '%' : (kind === 'crash' ? '—' : tube + '%')}</b></div>`}</div>
        ${replay ? '' : '<p class="sim-note">“On the route” is the share of time within the gates’ width and 250 ft of the planned height.</p>'}
        <div class="sim-actions"><button type="button" class="sim-btn ghost" data-x>Done</button><button type="button" class="sim-btn" data-again>${replay ? 'Watch again' : 'Fly again'}</button></div>`);
      wireX();
      $('[data-again]').onclick = () => { ended = false; Object.assign(score, { t: 0, tube: 0, xteSum: 0, altSum: 0, maxAlt: 0, dist: 0, n: 0 }); st.t = 0; st.touch = null; st.landedOnce = false; flown.geometry.coordinates = []; place(0, !groundStart); camH = st.hdg; card(''); togglePause(false); };
    }

    /* ---- loop ---- */
    let prev = performance.now(), hudT = 0;
    function loop(now) {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
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
        if (now - lastFlown > 700) { lastFlown = now; flown.geometry.coordinates.push(F.ll(st.x, st.z)); if (flown.geometry.coordinates.length > 4000) flown.geometry.coordinates.shift(); try { map.getSource('flown')?.setData(flown); } catch { } }
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
