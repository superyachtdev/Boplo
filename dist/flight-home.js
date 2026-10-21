/* Boplo Flight landing — scroll-flown example lesson over a contour-chart terrain.
   Dependency-free WebGL2. Lenis (optional) for smooth scrolling. */
(() => {
  'use strict';
  const doc = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = t => 1 - Math.pow(1 - t, 3);

  const yearEl = $('[data-year]'); if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------------- terrain field (shared by WebGL, minimap and final card) ---------------- */
  const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
  const fbm = (x, z) => { let s = 0, a = .5, f = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= .5; } return s; };
  const ridged = (x, z) => { let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++) { s += a * (1 - Math.abs(vnoise(x * f, z * f) * 2 - 1)); f *= 2.1; a *= .5; } return s; };

  const RUNWAY = { x0: -22, x1: -13, z: 14 };
  const LAKE = { x: 15, z: 3, r: 4.6 };
  const TOWN = { x: -4, z: -16, r: 3.4 };
  const distSeg = (x, z) => { const cx = clamp(x, RUNWAY.x0, RUNWAY.x1); return Math.hypot(x - cx, z - RUNWAY.z); };

  function height(x, z) {
    const n = fbm(x * .045 + 3.1, z * .045 - 1.7);
    const r = ridged(x * .032 + 8, z * .032 + 2);
    let h = Math.pow(n, 1.7) * 13 + r * r * 5.5;
    h += 8.5 * Math.exp(-((x - 22) ** 2 + (z + 21) ** 2) / 150);
    h += 6 * Math.exp(-((x + 34) ** 2 + (z + 26) ** 2) / 200);
    h -= 2.2;
    const dR = distSeg(x, z);
    h = lerp(1.0, h, smooth(5, 15, dR));
    const dL = Math.hypot(x - LAKE.x, z - LAKE.z);
    h = lerp(0.35, h, smooth(LAKE.r + .6, LAKE.r + 6, dL));
    const dT = Math.hypot(x - TOWN.x, z - TOWN.z);
    h = lerp(h * .35 + 1.1, h, smooth(TOWN.r, TOWN.r + 6, dT));
    return Math.max(h, .2);
  }

  /* ---------------- the example route ---------------- */
  const KNOTS = [
    [-22, 14], [-13, 14], [-3, 11.5], [8, 8], [15, 3], [20, -7], [18, -18], [6, -22], [-4, -16],
    [-15, -15.5], [-26, -9], [-34, -1], [-37, 9], [-31, 14], [-22, 14], [-15, 14]
  ];
  const STOP_KNOTS = [0, 4, 6, 8, 10, 13, 15];
  const STOP_NAMES = ['Depart runway 09', 'Reservoir turn', 'Ridge crossing', 'Town overhead', 'Diversion check', 'Final approach', 'Full stop'];

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1].map(i => .5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
  }
  function buildRoute(count) {
    const dense = [], knotIdx = [];
    const P = [KNOTS[0], ...KNOTS, KNOTS[KNOTS.length - 1]];
    for (let k = 0; k < KNOTS.length - 1; k++) {
      knotIdx.push(dense.length);
      for (let s = 0; s < 40; s++) dense.push(catmull(P[k], P[k + 1], P[k + 2], P[k + 3], s / 40));
    }
    knotIdx.push(dense.length); dense.push(KNOTS[KNOTS.length - 1]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const L = cum[cum.length - 1];
    const knotS = knotIdx.map(i => cum[i]);
    const pts = []; let j = 0;
    for (let i = 0; i < count; i++) {
      const s = L * i / (count - 1);
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const f = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      pts.push({ x: lerp(dense[j][0], dense[j + 1][0], f), z: lerp(dense[j][1], dense[j + 1][1], f), s });
    }
    // altitude: clear the terrain by a margin, smoothed, blended to the runway at both ends
    const ground = pts.map(p => height(p.x, p.z));
    const W = Math.round(count * .05);
    const clear = ground.map((_, i) => { let m = 0; for (let k = Math.max(0, i - W); k <= Math.min(count - 1, i + W); k++) m = Math.max(m, ground[k]); return m + 3.2; });
    const sm = clear.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - W); k <= Math.min(count - 1, i + W); k++) { s += clear[k]; n++; } return s / n; });
    pts.forEach((p, i) => {
      const a = smooth(knotS[1], knotS[3], p.s) * (1 - smooth(knotS[12], knotS[14] - .5, p.s));
      p.g = ground[i] + .12;
      p.y = lerp(p.g + .05, Math.max(sm[i], p.g + .5), a);
      p.air = a;
    });
    return { pts, L, knotS };
  }
  const ROUTE = buildRoute(900);
  const sampleRoute = t => {
    const f = clamp(t) * (ROUTE.pts.length - 1), i = Math.min(ROUTE.pts.length - 2, Math.floor(f)), r = f - i;
    const a = ROUTE.pts[i], b = ROUTE.pts[i + 1];
    return { x: lerp(a.x, b.x, r), y: lerp(a.y, b.y, r), z: lerp(a.z, b.z, r), g: lerp(a.g, b.g, r), air: lerp(a.air, b.air, r), s: lerp(a.s, b.s, r) };
  };

  /* ---------------- minimap (desk) + final card contours ---------------- */
  (function paintMaps() {
    const mm = $('[data-minimap]');
    if (mm) {
      const minX = -40, maxX = 26, minZ = -26, maxZ = 18;
      const sx = x => 20 + (x - minX) / (maxX - minX) * 360, sz = z => 18 + (z - minZ) / (maxZ - minZ) * 224;
      $('[data-minimap-route]', mm).setAttribute('d', ROUTE.pts.filter((_, i) => i % 3 === 0).map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sz(p.z).toFixed(1)}`).join(''));
      $('[data-minimap-contours]', mm).innerHTML = contourPaths(minX, maxX, minZ, maxZ, 400, 260, [2, 4, 6, 8, 10, 12], x => sx(x), z => sz(z));
    }
    const fc = $('[data-final-contours]');
    if (fc) fc.innerHTML = contourPaths(-44, 30, -28, 6, 1200, 520, [1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12], x => (x + 44) / 74 * 1200, z => (z + 28) / 34 * 520);
  })();
  // marching squares, emitted as short segments (cheap and good enough for decoration)
  function contourPaths(x0, x1, z0, z1, w, h, levels, mx, mz) {
    const N = 90, M = Math.round(N * h / w), H = [];
    for (let j = 0; j <= M; j++) { H[j] = []; for (let i = 0; i <= N; i++) H[j][i] = height(lerp(x0, x1, i / N), lerp(z0, z1, j / M)); }
    let d = '';
    for (const L of levels) {
      for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
        const v = [H[j][i], H[j][i + 1], H[j + 1][i + 1], H[j + 1][i]];
        const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const e = [];
        for (let k = 0; k < 4; k++) {
          const a = v[k], b = v[(k + 1) % 4];
          if ((a < L) !== (b < L)) { const t = (L - a) / (b - a), p = c[k], q = c[(k + 1) % 4]; e.push([lerp(p[0], q[0], t), lerp(p[1], q[1], t)]); }
        }
        for (let k = 0; k + 1 < e.length; k += 2) {
          const A = e[k], B = e[k + 1];
          d += `M${mx(lerp(x0, x1, A[0] / N)).toFixed(1)} ${mz(lerp(z0, z1, A[1] / M)).toFixed(1)}L${mx(lerp(x0, x1, B[0] / N)).toFixed(1)} ${mz(lerp(z0, z1, B[1] / M)).toFixed(1)}`;
        }
      }
    }
    return `<path d="${d}"/>`;
  }

  /* ---------------- nav tone + desk reveal ---------------- */
  const nav = $('[data-nav]');
  const lightSections = $$('.desk, .pricing');
  function navTone() {
    const y = nav.getBoundingClientRect().bottom - 30;
    nav.classList.toggle('on-light', lightSections.some(s => { const r = s.getBoundingClientRect(); return r.top < y && r.bottom > y; }));
  }
  const hours = $('.ui-hours');
  if (hours) {
    if (reduce || !('IntersectionObserver' in window)) hours.classList.add('seen');
    else new IntersectionObserver((es, io) => es.forEach(e => { if (e.isIntersecting) { hours.classList.add('seen'); io.disconnect(); } }), { threshold: .5 }).observe(hours);
  }

  /* ---------------- hero scene ---------------- */
  const section = $('[data-flight]');
  const frame = $('.frame', section);
  const canvas = $('[data-canvas]');
  const gl = !reduce && canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });

  if (!gl) {
    doc.classList.add('static');
    $$('.caption').forEach(c => c.classList.add('on'));
    addEventListener('scroll', navTone, { passive: true }); navTone();
    return;
  }

  doc.classList.add('intro');

  const mobile = matchMedia('(max-width: 820px)').matches;
  const GRID = mobile ? 150 : 230;
  const SIZE = 52;

  function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function program(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
  const uni = (p, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)]));

  /* terrain */
  const TERRAIN_VS = `#version 300 es
  in vec3 aPos; in vec3 aNor;
  uniform mat4 uVP; uniform vec3 uCam;
  out vec3 vW; out vec3 vN; out float vD;
  void main(){ vW=aPos; vN=aNor; vD=distance(aPos,uCam); gl_Position=uVP*vec4(aPos,1.); }`;
  const TERRAIN_FS = `#version 300 es
  precision highp float;
  in vec3 vW; in vec3 vN; in float vD;
  uniform float uReveal; uniform float uTime; uniform vec3 uLake; uniform vec4 uRunway; uniform vec3 uBg; uniform vec2 uFog;
  out vec4 o;
  float iso(float f, float w){ w=max(w,1e-3); float d=abs(fract(f-.5)-.5); return 1.-smoothstep(0.,w*1.5,d); }
  void main(){
    vec3 n=normalize(vN);
    float light=clamp(dot(n,normalize(vec3(-.4,.8,.35))),0.,1.);
    vec3 night=vec3(.008,.024,.07), deep=vec3(.03,.075,.2);
    vec3 col=mix(night,deep,light*.85+clamp(vW.y/14.,0.,1.)*.25);
    float f=vW.y*1.15; float w=fwidth(f);
    float minor=iso(f,w), major=iso(f/5.,fwidth(f/5.));
    vec2 g=vW.xz/6.5; vec2 gw=fwidth(g);
    float grid=max(iso(g.x,gw.x),iso(g.y,gw.y));
    vec3 electric=vec3(.04,.38,1.), ice=vec3(.62,.85,1.);
    float slope=1.-n.y;
    col+=electric*minor*(.38+slope*.6);
    col+=ice*major*.55;
    col+=ice*grid*.045;
    // reservoir
    float dl=distance(vW.xz,uLake.xy);
    if(dl<uLake.z){
      float sheen=iso(vW.z*2.2+sin(vW.x*.7+uTime*.4)*.35,fwidth(vW.z*2.2));
      col=mix(vec3(.01,.05,.16),vec3(.03,.12,.32),smoothstep(uLake.z,0.,dl))+ice*sheen*.06;
    }
    col+=ice*(1.-smoothstep(0.,.09,abs(dl-uLake.z)))*.5;
    // runway
    vec2 rp=vW.xz-uRunway.xy;
    if(abs(rp.x)<uRunway.z && abs(rp.y)<uRunway.w){
      col=vec3(.06,.1,.2);
      float dash=step(.5,fract(rp.x*.9))*(1.-smoothstep(.03,.06,abs(rp.y)));
      col+=vec3(.75,.85,1.)*dash*.7;
      col+=ice*(1.-smoothstep(uRunway.w-.06,uRunway.w,abs(rp.y)))*.0;
    }
    // reveal from the airfield outward
    float rd=distance(vW.xz,uRunway.xy);
    float rv=1.-smoothstep(uReveal*95.-14.,uReveal*95.,rd);
    float edge=1.-smoothstep(${(SIZE - 12).toFixed(1)},${SIZE.toFixed(1)},max(abs(vW.x),abs(vW.z)));
    float fog=1.-smoothstep(uFog.x,uFog.y,vD);
    col=mix(uBg,col,rv*edge*fog);
    col+=electric*.6*(1.-smoothstep(0.,7.,abs(rd-(uReveal*95.-7.))))*(1.-uReveal)*edge;
    o=vec4(col,1.);
  }`;
  const tProg = program(TERRAIN_VS, TERRAIN_FS);
  const tU = uni(tProg, ['uVP', 'uCam', 'uReveal', 'uTime', 'uLake', 'uRunway', 'uBg', 'uFog']);
  const tVao = gl.createVertexArray(); gl.bindVertexArray(tVao);
  {
    const N = GRID, pos = new Float32Array((N + 1) * (N + 1) * 3), nor = new Float32Array(pos.length), e = .25;
    let k = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = -SIZE + 2 * SIZE * i / N, z = -SIZE + 2 * SIZE * j / N, y = height(x, z);
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const nx = height(x - e, z) - height(x + e, z), nz = height(x, z - e) - height(x, z + e), ny = 2 * e, l = Math.hypot(nx, ny, nz);
      nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l; k += 3;
    }
    const idx = new Uint32Array(N * N * 6); k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.set([a, c, b, b, c, d], k); k += 6; }
    const buf = (data, loc, size) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
    buf(pos, gl.getAttribLocation(tProg, 'aPos'), 3);
    buf(nor, gl.getAttribLocation(tProg, 'aNor'), 3);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    tVao.count = idx.length;
  }

  /* route ribbons (screen-space width) */
  const RIBBON_VS = `#version 300 es
  in vec3 aPos; in vec3 aNext; in float aSide; in float aT;
  uniform mat4 uVP; uniform vec2 uRes; uniform float uWidth;
  out float vT; out float vSide;
  void main(){
    vec4 a=uVP*vec4(aPos,1.), b=uVP*vec4(aNext,1.);
    vec2 sa=a.xy/a.w*uRes, sb=b.xy/b.w*uRes;
    vec2 dir=normalize(sb-sa+vec2(1e-5)); vec2 nrm=vec2(-dir.y,dir.x);
    a.xy+=nrm*aSide*uWidth/uRes*a.w;
    vT=aT; vSide=aSide; gl_Position=a;
  }`;
  const RIBBON_FS = `#version 300 es
  precision highp float;
  in float vT; in float vSide;
  uniform float uProg; uniform vec3 uColor; uniform float uAlpha; uniform float uFuture; uniform float uSoft;
  out vec4 o;
  void main(){
    float drawn=step(vT,uProg);
    float dash=step(.45,fract(vT*260.));
    float a=mix(uFuture*dash,1.,drawn);
    float prof=uSoft>0.?pow(1.-abs(vSide),2.):1.-smoothstep(.6,1.,abs(vSide));
    float head=smoothstep(uProg-.04,uProg,vT)*drawn;
    vec3 c=uColor+head*vec3(.4,.4,.2);
    o=vec4(c, a*prof*uAlpha);
  }`;
  const rProg = program(RIBBON_VS, RIBBON_FS);
  const rU = uni(rProg, ['uVP', 'uRes', 'uWidth', 'uProg', 'uColor', 'uAlpha', 'uFuture', 'uSoft']);
  function ribbon(getY) {
    const P = ROUTE.pts, n = P.length, data = new Float32Array(n * 2 * 8);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[Math.min(n - 1, i + 1)], back = i === n - 1;
      const nx = back ? a.x + (a.x - P[i - 1].x) : b.x, nz = back ? a.z + (a.z - P[i - 1].z) : b.z, ny = back ? getY(a) : getY(b);
      for (const side of [-1, 1]) { data.set([a.x, getY(a), a.z, nx, ny, nz, side, i / (n - 1)], k); k += 8; }
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const at = (name, size, off) => { const l = gl.getAttribLocation(rProg, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 32, off * 4); };
    at('aPos', 3, 0); at('aNext', 3, 3); at('aSide', 1, 6); at('aT', 1, 7);
    vao.count = n * 2; return vao;
  }
  const airRibbon = ribbon(p => p.y);
  const groundRibbon = ribbon(p => p.g + .04);

  /* lights: runway edges + town */
  const PTS_VS = `#version 300 es
  in vec3 aPos; in float aSeed;
  uniform mat4 uVP; uniform float uScale; uniform float uTime; uniform float uReveal;
  out float vA;
  void main(){ vec4 p=uVP*vec4(aPos,1.); gl_Position=p; gl_PointSize=uScale*(.6+aSeed*.6)/p.w;
    vA=(.55+.45*sin(uTime*(1.+aSeed*2.)+aSeed*40.))*smoothstep(0.,1.,uReveal*1.4-aSeed*.3); }`;
  const PTS_FS = `#version 300 es
  precision highp float; in float vA; out vec4 o;
  void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); o=vec4(vec3(.68,.88,1.)*(a*a+.2*a),a*vA); }`;
  const pProg = program(PTS_VS, PTS_FS);
  const pU = uni(pProg, ['uVP', 'uScale', 'uTime', 'uReveal']);
  const pVao = gl.createVertexArray(); gl.bindVertexArray(pVao);
  {
    const L = [];
    for (let x = RUNWAY.x0; x <= RUNWAY.x1 + .01; x += .9) for (const dz of [-.55, .55]) L.push(x, height(x, RUNWAY.z) + .08, RUNWAY.z + dz, hash(x, dz) * .4);
    for (let i = 0; i < 70; i++) {
      const a = hash(i, 3.3) * Math.PI * 2, r = Math.sqrt(hash(i, 7.1)) * TOWN.r * 1.3;
      const x = TOWN.x + Math.cos(a) * r, z = TOWN.z + Math.sin(a) * r * .8;
      L.push(x, height(x, z) + .1, z, hash(i, 9.9));
    }
    const d = new Float32Array(L), b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    const l1 = gl.getAttribLocation(pProg, 'aPos'), l2 = gl.getAttribLocation(pProg, 'aSeed');
    gl.enableVertexAttribArray(l1); gl.vertexAttribPointer(l1, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 1, gl.FLOAT, false, 16, 12);
    pVao.count = d.length / 4;
  }

  /* the aircraft: a small low-wing trainer, flat-shaded, built from a few lofted parts */
  const PLANE_VS = `#version 300 es
  in vec3 aPos; in vec3 aNor;
  uniform mat4 uVP; uniform mat4 uM;
  out vec3 vW; out vec3 vN;
  void main(){ vec4 w=uM*vec4(aPos,1.); vW=w.xyz; vN=mat3(uM)*aNor; gl_Position=uVP*w; }`;
  const PLANE_FS = `#version 300 es
  precision highp float;
  in vec3 vW; in vec3 vN;
  uniform vec3 uCam; uniform float uVis;
  out vec4 o;
  void main(){
    vec3 n=normalize(vN), v=normalize(uCam-vW);
    if(dot(n,v)<0.) n=-n;
    float diff=max(dot(n,normalize(vec3(-.35,.85,.4))),0.);
    float rim=pow(1.-max(dot(n,v),0.),2.2);
    vec3 col=mix(vec3(.10,.17,.36),vec3(.9,.95,1.),.18+.82*diff);
    col+=vec3(.18,.5,1.)*rim*1.1;
    o=vec4(col*uVis,1.);
  }`;
  const aProg = program(PLANE_VS, PLANE_FS);
  const aU = uni(aProg, ['uVP', 'uM', 'uCam', 'uVis']);
  const aVao = gl.createVertexArray(); gl.bindVertexArray(aVao);
  {
    const out = [];
    const tri = (a, b, c) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
      for (const p of [a, b, c]) out.push(...p, ...n);
    };
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    // hexahedron from a bottom ring and a top ring of four points
    const hexa = (b, t) => {
      quad(b[0], b[1], b[2], b[3]); quad(t[3], t[2], t[1], t[0]);
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b[i], b[j], t[j], t[i]); }
    };
    // fuselage sections: [z, centreY, width, height]; x right, y up, z forward
    const S = [[1.05, .02, .12, .12], [.86, .03, .26, .26], [.45, .07, .34, .38], [.0, .08, .32, .36], [-.55, .07, .22, .24], [-1.25, .1, .1, .12], [-1.5, .12, .05, .08]];
    const ring = ([z, y, w, h]) => [[-w / 2, y - h / 2, z], [w / 2, y - h / 2, z], [w / 2, y + h / 2, z], [-w / 2, y + h / 2, z]];
    for (let i = 0; i < S.length - 1; i++) {
      const A = ring(S[i]), B = ring(S[i + 1]);
      for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; quad(A[k], A[j], B[j], B[k]); }
    }
    { const A = ring(S[0]), B = ring(S[S.length - 1]); quad(A[0], A[1], A[2], A[3]); quad(B[3], B[2], B[1], B[0]); }
    // canopy: a raised glasshouse over the cabin
    hexa([[-.15, .25, .62], [.15, .25, .62], [.15, .25, -.1], [-.15, .25, -.1]], [[-.1, .3, .4], [.1, .3, .4], [.1, .32, .02], [-.1, .32, .02]]);
    // low wing with dihedral, both halves
    for (const s of [-1, 1]) {
      const r = .14, tip = 1.62;
      hexa(
        [[s * r, -.13, .5], [s * tip, -.04, .4], [s * tip, -.04, .1], [s * r, -.13, .02]],
        [[s * r, -.08, .48], [s * tip, -.015, .39], [s * tip, -.015, .11], [s * r, -.08, .04]]
      );
    }
    // tailplane
    for (const s of [-1, 1]) hexa(
      [[s * .04, .09, -1.18], [s * .6, .11, -1.3], [s * .6, .11, -1.46], [s * .04, .09, -1.5]],
      [[s * .04, .12, -1.18], [s * .6, .13, -1.3], [s * .6, .13, -1.46], [s * .04, .12, -1.5]]
    );
    // fin, swept
    hexa([[-.02, .14, -1.0], [.02, .14, -1.0], [.02, .14, -1.52], [-.02, .14, -1.52]], [[-.015, .62, -1.42], [.015, .62, -1.42], [.015, .62, -1.6], [-.015, .62, -1.6]]);
    // spinner + two blades
    tri([0, .02, 1.22], [-.06, -.04, 1.05], [.06, -.04, 1.05]); tri([0, .02, 1.22], [.06, -.04, 1.05], [.06, .08, 1.05]);
    tri([0, .02, 1.22], [.06, .08, 1.05], [-.06, .08, 1.05]); tri([0, .02, 1.22], [-.06, .08, 1.05], [-.06, -.04, 1.05]);
    hexa([[-.02, -.36, 1.07], [.02, -.36, 1.07], [.02, .4, 1.07], [-.02, .4, 1.07]], [[-.02, -.36, 1.1], [.02, -.36, 1.1], [.02, .4, 1.1], [-.02, .4, 1.1]]);
    const d = new Float32Array(out);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    const l1 = gl.getAttribLocation(aProg, 'aPos'), l2 = gl.getAttribLocation(aProg, 'aNor');
    gl.enableVertexAttribArray(l1); gl.vertexAttribPointer(l1, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 3, gl.FLOAT, false, 24, 12);
    aVao.count = d.length / 6;
  }
  // nav lights: red port tip, green starboard tip, white strobe on the tail
  const NAV_VS = `#version 300 es
  in vec3 aPos; uniform mat4 uVP; uniform float uSize;
  void main(){ vec4 p=uVP*vec4(aPos,1.); gl_Position=p; gl_PointSize=uSize/p.w; }`;
  const NAV_FS = `#version 300 es
  precision highp float; uniform vec3 uColor; uniform float uA; out vec4 o;
  void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); o=vec4(uColor*(a*a*1.4+.15),a*uA); }`;
  const nProg = program(NAV_VS, NAV_FS);
  const nU = uni(nProg, ['uVP', 'uSize', 'uColor', 'uA']);
  const nVao = gl.createVertexArray(); gl.bindVertexArray(nVao);
  const nBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nBuf); gl.bufferData(gl.ARRAY_BUFFER, 9 * 4, gl.DYNAMIC_DRAW);
  { const l = gl.getAttribLocation(nProg, 'aPos'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0); }
  let roll = 0;

  /* ---------------- tiny matrix kit ---------------- */
  const persp = (fy, as, n, f) => { const t = 1 / Math.tan(fy / 2), nf = 1 / (n - f); return new Float32Array([t / as, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]); };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lookAt = (e, t, up) => { const z = norm(sub(e, t)), x = norm(cross(up, z)), y = cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]); };
  const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };

  /* ---------------- HTML overlay ---------------- */
  const heroCopy = $('[data-hero-copy]');
  const hud = $('[data-hud]');
  const altEl = $('[data-alt]', hud), hdgEl = $('[data-hdg]', hud), gsEl = $('[data-gs]', hud), nextEl = $('[data-next]', hud);
  const captions = $$('[data-stage]');
  const stops = $$('[data-stops] li');
  const stopsFill = $('[data-stops-fill]');
  const craft = $('[data-craft]');
  const drop = $('[data-drop]');
  const labelLayer = $('[data-labels]');
  const STOP_T = STOP_KNOTS.map(k => ROUTE.knotS[k] / ROUTE.L);
  const labels = STOP_KNOTS.map((k, i) => {
    const el = document.createElement('div'); el.className = 'wp';
    el.innerHTML = `<i></i><b>${STOP_NAMES[i]}</b>`; labelLayer.appendChild(el);
    const [x, z] = KNOTS[k]; return { el, x, z, y: height(x, z) + .1 };
  });

  /* ---------------- sizing ---------------- */
  let W = 1, H = 1, DPR = 1;
  function resize() {
    const r = frame.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    DPR = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  addEventListener('resize', resize); resize();

  /* ---------------- scroll ---------------- */
  let target = 0, prog = 0;
  const readScroll = () => {
    const r = section.getBoundingClientRect();
    target = clamp(-r.top / Math.max(1, r.height - innerHeight));
    navTone();
  };
  let lenis = null;
  if (window.Lenis && !mobile) {
    lenis = new window.Lenis({ lerp: .09, smoothWheel: true });
    lenis.on('scroll', readScroll);
    $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => { const id = a.getAttribute('href'); const t = id.length > 1 && $(id); if (t || id === '#top') { e.preventDefault(); lenis.scrollTo(t || 0, { offset: 0 }); } }));
  }
  addEventListener('scroll', readScroll, { passive: true }); readScroll();

  let mx = 0, my = 0, pmx = 0, pmy = 0;
  addEventListener('pointermove', e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; }, { passive: true });

  /* ---------------- camera ---------------- */
  const portrait = () => W / H < .8;
  const OVERVIEW = { eye: [-4, 46, 58], at: [-6, 0, -2] };
  const OVERVIEW_TALL = { eye: [-8, 74, 60], at: [-8, 0, -4] };
  let camE = OVERVIEW.eye.slice(), camA = OVERVIEW.at.slice(); let firstFrame = true;
  function chase(t) {
    const p = sampleRoute(t), q = sampleRoute(Math.min(1, t + .012));
    let d = norm([q.x - p.x, 0, q.z - p.z]);
    if (!isFinite(d[0]) || (d[0] === 0 && d[2] === 0)) d = [1, 0, 0];
    const side = [-d[2], 0, d[0]];
    const back = mobile ? 15 : 12, up = mobile ? 7.5 : 5.6, lat = mobile ? 2 : 4;
    return {
      eye: [p.x - d[0] * back + side[0] * lat, p.y + up, p.z - d[2] * back + side[2] * lat],
      at: [p.x + d[0] * 7, p.y - 1.2, p.z + d[2] * 7]
    };
  }

  /* ---------------- frame loop ---------------- */
  let reveal = 0, t0 = performance.now(), last = t0, visible = true, started = false;
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(section);
  const BG = [.008, .02, .06];
  let lastStage = -1, lastStop = -1, logged = false, settle = false;
  window.__boploSettle = () => { settle = true; reveal = 1; };

  function frameLoop(now) {
    requestAnimationFrame(frameLoop);
    lenis && lenis.raf(now);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!visible && started) return;
    started = true;
    const time = (now - t0) / 1000;
    reveal = Math.min(1, reveal + dt / 2.6);
    const rv = ease(reveal);

    if (settle) { prog = target; }
    prog += (target - prog) * (1 - Math.exp(-dt * 5.5));
    if (Math.abs(target - prog) < 1e-4) prog = target;
    pmx += (mx - pmx) * (1 - Math.exp(-dt * 3)); pmy += (my - pmy) * (1 - Math.exp(-dt * 3));

    // story timing
    const flyT = smooth(.07, .9, prog) ;
    const planeT = clamp((prog - .07) / .83);
    const chaseW = smooth(.02, .13, prog) * (1 - smooth(.88, .985, prog));

    const c = chase(planeT);
    const breathe = [Math.sin(time * .15) * 2, 0, Math.cos(time * .12) * 1.5];
    const OV = portrait() ? OVERVIEW_TALL : OVERVIEW;
    const oe = [OV.eye[0] + breathe[0] + pmx * 6, OV.eye[1] - pmy * 4, OV.eye[2] + breathe[2]];
    const wantE = [0, 1, 2].map(i => lerp(oe[i], c.eye[i] + (i === 0 ? pmx * 2 : 0), chaseW));
    const wantA = [0, 1, 2].map(i => lerp(OV.at[i], c.at[i], chaseW));
    const k = settle || firstFrame ? 1 : 1 - Math.exp(-dt * 3.2); firstFrame = false;
    settle = false;
    for (let i = 0; i < 3; i++) { camE[i] += (wantE[i] - camE[i]) * k; camA[i] += (wantA[i] - camA[i]) * k; }
    if (camE[1] < height(camE[0], camE[2]) + 2) camE[1] = height(camE[0], camE[2]) + 2;

    const aspect = W / H;
    const fov = (aspect < .8 ? 52 : 38) * Math.PI / 180;
    const P = persp(fov, aspect, .5, 260), V = lookAt(camE, camA, [0, 1, 0]), VP = mul(P, V);

    gl.clearColor(BG[0], BG[1], BG[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.useProgram(tProg); gl.bindVertexArray(tVao);
    gl.uniformMatrix4fv(tU.uVP, false, VP); gl.uniform3fv(tU.uCam, camE);
    gl.uniform1f(tU.uReveal, rv); gl.uniform1f(tU.uTime, time);
    gl.uniform3f(tU.uLake, LAKE.x, LAKE.z, LAKE.r);
    gl.uniform4f(tU.uRunway, (RUNWAY.x0 + RUNWAY.x1) / 2, RUNWAY.z, (RUNWAY.x1 - RUNWAY.x0) / 2 + .4, .42);
    gl.uniform3fv(tU.uBg, BG); gl.uniform2f(tU.uFog, lerp(70, 30, chaseW), lerp(150, 85, chaseW));
    gl.drawElements(gl.TRIANGLES, tVao.count, gl.UNSIGNED_INT, 0);

    // ---- aircraft pose: along the track, pitched with the climb, banked into turns
    const ac = sampleRoute(planeT);
    const fa = sampleRoute(Math.min(1, planeT + .006)), fb = sampleRoute(Math.max(0, planeT - .006));
    let fwd = norm([fa.x - fb.x, (fa.y - fb.y) * .8, fa.z - fb.z]);
    if (!isFinite(fwd[0])) fwd = [1, 0, 0];
    const h1 = sampleRoute(Math.max(0, planeT - .02)), h2 = sampleRoute(planeT), h3 = sampleRoute(Math.min(1, planeT + .02));
    const turn = (h2.x - h1.x) * (h3.z - h2.z) - (h2.z - h1.z) * (h3.x - h2.x);
    const wantRoll = clamp(turn * .9, -.62, .62) * ac.air;
    roll += (wantRoll - roll) * (settle ? 1 : 1 - Math.exp(-dt * 4));
    let right = norm(cross([0, 1, 0], fwd)), up = cross(fwd, right);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const r2 = [0, 1, 2].map(i => right[i] * cr + up[i] * sr), u2 = [0, 1, 2].map(i => up[i] * cr - right[i] * sr);
    const sc = lerp(mobile ? 2.3 : 1.7, mobile ? .75 : .62, chaseW);
    const lift = .14 * sc;
    const pos = [ac.x + u2[0] * lift, ac.y + u2[1] * lift, ac.z + u2[2] * lift];
    const M = new Float32Array([r2[0] * sc, r2[1] * sc, r2[2] * sc, 0, u2[0] * sc, u2[1] * sc, u2[2] * sc, 0, fwd[0] * sc, fwd[1] * sc, fwd[2] * sc, 0, pos[0], pos[1], pos[2], 1]);
    const toW = p => [0, 1, 2].map(i => pos[i] + (r2[i] * p[0] + u2[i] * p[1] + fwd[i] * p[2]) * sc);
    const planeVis = smooth(.55, .9, rv);
    if (planeVis > 0) {
      gl.useProgram(aProg); gl.bindVertexArray(aVao);
      gl.uniformMatrix4fv(aU.uVP, false, VP); gl.uniformMatrix4fv(aU.uM, false, M);
      gl.uniform3fv(aU.uCam, camE); gl.uniform1f(aU.uVis, planeVis);
      gl.drawArrays(gl.TRIANGLES, 0, aVao.count);
    }

    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
    gl.useProgram(rProg); gl.uniformMatrix4fv(rU.uVP, false, VP); gl.uniform2f(rU.uRes, canvas.width / 2, canvas.height / 2);
    const routeIn = smooth(.25, .9, rv);
    const pr = planeT;
    // ground shadow of the track
    gl.bindVertexArray(groundRibbon);
    gl.uniform1f(rU.uProg, pr); gl.uniform1f(rU.uFuture, .0); gl.uniform1f(rU.uSoft, 0);
    gl.uniform1f(rU.uWidth, 1.6 * DPR); gl.uniform3f(rU.uColor, .05, .35, 1); gl.uniform1f(rU.uAlpha, .55 * routeIn);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, groundRibbon.count);
    // planned route (dashed) + flown track (glow + core)
    gl.bindVertexArray(airRibbon);
    gl.uniform1f(rU.uFuture, .45); gl.uniform1f(rU.uSoft, 1);
    gl.uniform1f(rU.uWidth, 14 * DPR); gl.uniform3f(rU.uColor, .05, .38, 1); gl.uniform1f(rU.uAlpha, .32 * routeIn);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, airRibbon.count);
    gl.uniform1f(rU.uSoft, 0); gl.uniform1f(rU.uFuture, .5);
    gl.uniform1f(rU.uWidth, 1.7 * DPR); gl.uniform3f(rU.uColor, .62, .85, 1); gl.uniform1f(rU.uAlpha, routeIn);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, airRibbon.count);

    gl.useProgram(pProg); gl.bindVertexArray(pVao);
    gl.uniformMatrix4fv(pU.uVP, false, VP); gl.uniform1f(pU.uScale, 60 * DPR); gl.uniform1f(pU.uTime, time); gl.uniform1f(pU.uReveal, rv);
    gl.drawArrays(gl.POINTS, 0, pVao.count);

    if (planeVis > 0) {
      gl.useProgram(nProg); gl.bindVertexArray(nVao); gl.uniformMatrix4fv(nU.uVP, false, VP);
      gl.bindBuffer(gl.ARRAY_BUFFER, nBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([...toW([-1.64, -.03, .26]), ...toW([1.64, -.03, .26]), ...toW([0, .64, -1.58])]));
      gl.uniform1f(nU.uSize, 26 * DPR * sc);
      gl.uniform3f(nU.uColor, 1, .25, .3); gl.uniform1f(nU.uA, planeVis); gl.drawArrays(gl.POINTS, 0, 1);
      gl.uniform3f(nU.uColor, .3, 1, .55); gl.drawArrays(gl.POINTS, 1, 1);
      const strobe = (time % 1.4) < .08 ? 1 : 0;
      gl.uniform3f(nU.uColor, 1, 1, 1); gl.uniform1f(nU.uA, planeVis * strobe); gl.uniform1f(nU.uSize, 60 * DPR * sc); gl.drawArrays(gl.POINTS, 2, 1);
    }

    // ---- overlay projection
    const proj = (x, y, z) => {
      const cx = VP[0] * x + VP[4] * y + VP[8] * z + VP[12], cy = VP[1] * x + VP[5] * y + VP[9] * z + VP[13], cw = VP[3] * x + VP[7] * y + VP[11] * z + VP[15];
      if (cw <= .1) return null;
      return [(cx / cw * .5 + .5) * W, (1 - (cy / cw * .5 + .5)) * H];
    };
    const sp = proj(ac.x, ac.y, ac.z), gp = proj(ac.x, ac.g, ac.z);
    if (sp) { craft.style.transform = `translate3d(${sp[0]}px,${sp[1]}px,0)`; craft.classList.toggle('show', rv > .6); }
    if (sp && gp && ac.air > .05) { drop.setAttribute('x1', sp[0]); drop.setAttribute('y1', sp[1]); drop.setAttribute('x2', gp[0]); drop.setAttribute('y2', gp[1]); drop.style.opacity = ac.air; }
    else drop.style.opacity = 0;
    const showLabels = rv > .8 && prog > .045;
    labels.forEach((l, i) => {
      const s = proj(l.x, l.y, l.z);
      const on = showLabels && s && s[0] > 70 && s[0] < W - 70 && s[1] > 110 && s[1] < H - 110;
      if (s) l.el.style.transform = `translate3d(${s[0]}px,${s[1]}px,0)`;
      l.el.classList.toggle('show', !!on);
      l.el.classList.toggle('passed', planeT >= STOP_T[i] - .002);
    });

    // ---- copy + HUD
    heroCopy.classList.toggle('away', prog > .045);
    frame.classList.toggle('flying', prog > .045);
    const stage = prog < .06 ? -1 : prog < .3 ? 0 : prog < .6 ? 1 : prog < .85 ? 2 : 3;
    if (stage !== lastStage) { captions.forEach((cEl, i) => cEl.classList.toggle('on', i === stage)); lastStage = stage; }
    let cur = 0; STOP_T.forEach((t, i) => { if (planeT >= t - .002) cur = i; });
    if (cur !== lastStop) {
      stops.forEach((s, i) => { s.classList.toggle('passed', i <= cur); s.classList.toggle('current', i === cur); });
      nextEl.textContent = STOP_NAMES[Math.min(STOP_NAMES.length - 1, cur + 1)];
      lastStop = cur;
    }
    stopsFill.style.transform = `scaleX(${planeT})`;
    const ahead = sampleRoute(Math.min(1, planeT + .004)), behind = sampleRoute(Math.max(0, planeT - .004));
    const hdg = (Math.atan2(ahead.x - behind.x, -(ahead.z - behind.z)) * 180 / Math.PI + 360) % 360;
    const field = height(-17, RUNWAY.z);
    altEl.textContent = ac.air < .02 ? 0 : Math.round(Math.max(0, (ac.y - field) * 190 + 250 * ac.air) / 10) * 10;
    hdgEl.textContent = String(Math.round(hdg / 1) % 360).padStart(3, '0');
    const groundRoll = planeT < STOP_T[1] - .01 ? smooth(0, STOP_T[1] * .6, planeT) : 1 - smooth(.985, 1, planeT);
    gsEl.textContent = Math.round(lerp(groundRoll * 55, 95, ac.air));
    const isLogged = prog > .93;
    if (isLogged !== logged) { hud.classList.toggle('logged', isLogged); $('[data-hud-title]', hud).textContent = isLogged ? 'Lesson 12 · Logged' : 'Lesson 12 · Navigation'; logged = isLogged; }
  }

  requestAnimationFrame(() => {
    doc.classList.remove('intro'); doc.classList.add('ready');
    requestAnimationFrame(t => { last = t; frameLoop(t); });
  });
})();
