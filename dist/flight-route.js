/* Boplo Flight — worldwide route planner for the simulator.
   Every airport on Earth from OurAirports (public domain): the bigger ones from /airfields/world.json, and a country's
   small airfields and surveyed runway ends from /airfields/<CC>.json and /runways/<CC>.json once you look at it.
   Pick a departure, add waypoints, pick an arrival and the runways, then fly it or watch it flown. */
window.BoploRoute = (() => {
  'use strict';
  const C = { night: '#040B22', electric: '#0A62FF', ice: '#9ED8FF', gold: '#FFD166', land: '#050D26' };
  const KEY = 'boplo-route', MAX_NM = 900;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fc = features => ({ type: 'FeatureCollection', features });
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const pad3 = n => String(Math.round(((n % 360) + 360) % 360) || 360).padStart(3, '0');
  const fmtM = m => Math.round(m).toLocaleString('en-GB');
  const TYPE = { L: 'Large airport', M: 'Airport', S: 'Airfield', W: 'Seaplane base' };
  const store = { get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }, set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { } } };

  // ---------- data ----------
  const aps = new Map();            // code -> airport
  const rwyRows = new Map();        // code -> surveyed runway rows
  const loaded = new Map();         // cc -> promise
  let world = null;
  function loadWorld() {
    if (world) return world;
    world = fetch('/airfields/world.json').then(r => r.ok ? r.json() : Promise.reject(new Error('Airports didn’t load.'))).then(d => {
      for (const r of d.rows) if (!aps.has(r[0])) aps.set(r[0], { code: r[0], name: r[1], lat: r[2], lng: r[3], type: r[4], cc: r[5], iata: r[6], elev: r[7], runways: [], freqs: [], full: false });
      return d.grid;
    }).catch(e => { world = null; throw e; });
    return world;
  }
  function loadCountry(cc) {
    if (!cc || !/^[A-Z]{2}$/.test(cc)) return Promise.resolve();
    if (loaded.has(cc)) return loaded.get(cc);
    const p = Promise.all([
      window.BoploMap.airfields(cc),
      fetch(`/runways/${cc}.json`).then(r => r.ok ? r.json() : { rows: {} }).catch(() => ({ rows: {} }))
    ]).then(([list, rw]) => {
      for (const a of list) { const o = aps.get(a.code); aps.set(a.code, { ...(o || {}), ...a, cc, iata: a.iata || o?.iata || '', full: true }); }
      for (const [code, rows] of Object.entries(rw.rows || {})) rwyRows.set(code, rows);
    });
    loaded.set(cc, p);
    return p;
  }

  // ---------- geometry ----------
  const R = 3440.065;
  const nm = (a, b) => { const dφ = (b.lat - a.lat) * D2R, dλ = (b.lng - a.lng) * D2R; const h = Math.sin(dφ / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dλ / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
  const brg = (a, b) => { const y = Math.sin((b.lng - a.lng) * D2R) * Math.cos(b.lat * D2R), x = Math.cos(a.lat * D2R) * Math.sin(b.lat * D2R) - Math.sin(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.cos((b.lng - a.lng) * D2R); return (Math.atan2(y, x) * R2D + 360) % 360; };
  const dest = (p, hdg, m) => { const k = m / 111320; return { lat: p.lat + Math.cos(hdg * D2R) * k, lng: p.lng + Math.sin(hdg * D2R) * k / Math.max(.05, Math.cos(p.lat * D2R)) }; };
  // runway ends of an airport: surveyed thresholds where we have them, otherwise just the idents
  function endsOf(a) {
    const rows = rwyRows.get(a.code) || [], out = [];
    for (const r of rows) {
      const A = { lat: r[2], lng: r[3] }, B = { lat: r[4], lng: r[5] };
      if (![A.lat, A.lng, B.lat, B.lng].every(Number.isFinite)) continue;
      const len = r[6] || nm(A, B) * 1852;
      if (r[0]) out.push({ id: r[0], hdg: brg(A, B), len, wid: r[7], surf: r[8], lit: r[9], T: A, far: B, pair: `${r[0]}/${r[1]}` });
      if (r[1]) out.push({ id: r[1], hdg: brg(B, A), len, wid: r[7], surf: r[8], lit: r[9], T: B, far: A, pair: `${r[0]}/${r[1]}` });
    }
    if (out.length) return out;
    for (const r of a.runways || []) for (const id of String(r[0] || '').split('/').filter(Boolean)) out.push({ id, hdg: null, len: r[1], surf: r[2], pair: r[0] });
    return out;
  }

  // ---------- planner ----------
  async function open(opts = {}) {
    const ML = await window.BoploMap.loadLib();
    const test = document.createElement('canvas'); if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('This browser can’t draw the map.');
    document.getElementById('rp')?.remove();
    const dlg = document.createElement('dialog'); dlg.id = 'rp'; dlg.className = 'rp'; dlg.setAttribute('aria-label', 'Route planner');
    dlg.innerHTML = `<div class="rp-map" data-rmap></div>
      <div class="rp-search"><svg class="ico" aria-hidden="true"><use href="#i-search"/></svg><input data-rq placeholder="Search airports: code, city or name" autocomplete="off" spellcheck="false" aria-label="Search airports"><ul class="rp-res" data-rres hidden></ul></div>
      <aside class="rp-panel" data-rpanel>
        <button type="button" class="rp-grab" data-rgrab aria-label="Show or hide the flight plan"><span></span></button>
        <header class="rp-head"><h2 class="display">Plan a flight</h2><button type="button" class="icon-btn" data-rx aria-label="Close the route planner"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button></header>
        <div class="rp-scroll">
          <div data-rcard></div>
          <div data-rplan></div>
        </div>
        <footer class="rp-foot" data-rfoot></footer>
      </aside>`;
    document.body.append(dlg);
    dlg.showModal();
    const $ = s => dlg.querySelector(s), $$ = s => [...dlg.querySelectorAll(s)];
    const close = () => { try { map?.remove(); } catch { } dlg.close(); dlg.remove(); opts.onClose && opts.onClose(); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    $('[data-rx]').onclick = close;
    $('[data-rgrab]').onclick = () => $('[data-rpanel]').classList.toggle('min');

    // plan state
    const saved = opts.route || store.get();
    const plan = { dep: null, arr: null, wps: [], depEnd: '', arrEnd: '', alt: 0, altSet: false };
    let sel = null, map = null, grid = null;
    const markers = [];

    try { grid = await loadWorld(); }
    catch (e) { $('[data-rmap]').innerHTML = `<p class="rp-err">${esc(e.message)} Check your connection and try again.</p>`; return; }
    const homeCode = String(opts.home || '').toUpperCase().split(/[\s·]/)[0];
    const homeCc = opts.country;
    await Promise.all([loadCountry(homeCc), ...(saved?.points || []).map(p => p.code && p.cc ? loadCountry(p.cc) : null)]).catch(() => { });
    if (saved?.points?.length) {
      const pts = saved.points;
      const first = pts[0].code && aps.get(pts[0].code), last = pts.length > 1 && pts[pts.length - 1].code && aps.get(pts[pts.length - 1].code);
      plan.dep = first || null; plan.arr = last || null;
      plan.wps = pts.slice(first ? 1 : 0, last ? -1 : undefined).filter(p => Number.isFinite(p.lat)).map(p => ({ lat: p.lat, lng: p.lng }));
      plan.depEnd = saved.depEnd || ''; plan.arrEnd = saved.arrEnd || ''; if (saved.alt) { plan.alt = saved.alt; plan.altSet = true; }
    }
    const home = aps.get(homeCode);
    const startAt = plan.dep || home;

    map = new ML.Map({ container: $('[data-rmap]'), style: window.BoploMap.style(), center: startAt ? [startAt.lng, startAt.lat] : [0, 30], zoom: startAt ? 8.5 : 1.6, attributionControl: false, dragRotate: false, pitchWithRotate: false, renderWorldCopies: true });
    map.addControl(new ML.AttributionControl({ compact: true, customAttribution: 'Airports: <a href="https://ourairports.com" target="_blank" rel="noopener">OurAirports</a>' }), 'bottom-left');
    map.addControl(new ML.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate?.disableRotation?.();
    // wait for the chart style (slow connections can take a while); adding layers before it's ready throws
    // (isStyleLoaded() also waits for every tile, so check the style itself)
    let evReady = false; map.once('style.load', () => { evReady = true; }); map.once('load', () => { evReady = true; });
    const styleReady = () => evReady || !!(map.style && map.style._loaded) || map.isStyleLoaded();
    $('[data-rplan]').innerHTML = '<p class="rp-dim">Loading the map…</p>';
    for (let i = 0; i < 480 && dlg.isConnected && !styleReady(); i++) await new Promise(r => setTimeout(r, 250));
    if (!dlg.isConnected) return;
    if (!styleReady()) { $('[data-rmap]').insertAdjacentHTML('beforeend', '<p class="rp-err">The map didn’t load. Check your connection and open it again.</p>'); return; }

    // sources and layers
    map.addSource('rp-aps', { type: 'geojson', data: fc([]) });
    map.addSource('rp-rwy', { type: 'geojson', data: fc([]) });
    map.addSource('rp-rid', { type: 'geojson', data: fc([]) });
    map.addSource('rp-sel', { type: 'geojson', data: fc([]) });
    map.addSource('rp-route', { type: 'geojson', data: fc([]) });
    const rank = ['match', ['get', 't'], 'L', 3, 'M', 2, 1];
    map.addLayer({ id: 'rp-rwy', type: 'line', source: 'rp-rwy', minzoom: 7, layout: { 'line-cap': 'butt' }, paint: {
      'line-color': ['case', ['==', ['get', 'p'], 1], '#DDEBFF', 'rgba(221,235,255,0.62)'],
      'line-width': ['interpolate', ['exponential', 2], ['zoom'], 7, 1.4, 11, ['max', 2.6, ['/', ['get', 'w'], 40]], 18, ['/', ['get', 'w'], 0.45]]
    } });
    map.addLayer({ id: 'rp-route-glow', type: 'line', source: 'rp-route', filter: ['==', ['get', 'k'], 'leg'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.electric, 'line-width': 9, 'line-opacity': 0.5, 'line-blur': 3 } });
    map.addLayer({ id: 'rp-route', type: 'line', source: 'rp-route', filter: ['==', ['get', 'k'], 'leg'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.ice, 'line-width': 2.6 } });
    map.addLayer({ id: 'rp-final', type: 'line', source: 'rp-route', filter: ['==', ['get', 'k'], 'final'], paint: { 'line-color': C.gold, 'line-width': 2, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'rp-sel', type: 'line', source: 'rp-sel', layout: { 'line-cap': 'butt' }, paint: {
      'line-color': C.gold,
      'line-width': ['interpolate', ['exponential', 2], ['zoom'], 7, 3, 11, ['max', 4, ['/', ['get', 'w'], 36]], 18, ['/', ['get', 'w'], 0.42]]
    } });
    map.addLayer({ id: 'rp-ap', type: 'circle', source: 'rp-aps',
      filter: ['any', ['==', ['get', 't'], 'L'], ['all', ['==', ['get', 't'], 'M'], ['>=', ['zoom'], 4.5]], ['>=', ['zoom'], 7.5], ['==', ['get', 'on'], 1]],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, ['match', ['get', 't'], 'L', 2.6, 1.6], 8, ['match', ['get', 't'], 'L', 6, 'M', 5, 3.6], 12, ['match', ['get', 't'], 'L', 8, 6]],
        'circle-color': ['case', ['==', ['get', 'on'], 1], C.gold, C.night],
        'circle-stroke-color': ['case', ['==', ['get', 'on'], 1], '#ffffff', ['match', ['get', 't'], 'L', C.ice, 'M', C.ice, 'rgba(158,216,255,0.7)']],
        'circle-stroke-width': ['case', ['==', ['get', 'on'], 1], 2.4, 1.3],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 1, 12.5, ['case', ['==', ['get', 'rw'], 1], 0, 1]],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 1, 12.5, ['case', ['==', ['get', 'rw'], 1], 0, 1]]
      } });
    map.addLayer({ id: 'rp-aplab', type: 'symbol', source: 'rp-aps',
      filter: ['any', ['all', ['==', ['get', 't'], 'L'], ['>=', ['zoom'], 4.2]], ['all', ['==', ['get', 't'], 'M'], ['>=', ['zoom'], 6.5]], ['>=', ['zoom'], 9.5], ['==', ['get', 'on'], 1]],
      layout: { 'text-field': ['get', 'code'], 'text-font': ['Noto Sans Regular'], 'text-size': ['match', ['get', 't'], 'L', 12, 11], 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-letter-spacing': 0.06, 'symbol-sort-key': ['-', 4, rank], 'text-optional': true },
      paint: { 'text-color': ['case', ['==', ['get', 'on'], 1], '#ffffff', 'rgba(222,233,255,0.85)'], 'text-halo-color': C.land, 'text-halo-width': 1.6 } });
    map.addLayer({ id: 'rp-rid', type: 'symbol', source: 'rp-rid', minzoom: 12, layout: { 'text-field': ['get', 'id'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': false }, paint: { 'text-color': '#ffffff', 'text-halo-color': C.land, 'text-halo-width': 1.8 } });

    // airports and runways for what's loaded
    let drawnRwyN = -1;
    function paintData() {
      const on = new Set([plan.dep?.code, plan.arr?.code, sel?.code].filter(Boolean));
      map.getSource('rp-aps').setData(fc([...aps.values()].filter(a => a.type !== 'H').map(a => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lng, a.lat] }, properties: { code: a.code, t: a.type, on: on.has(a.code) ? 1 : 0, rw: rwyRows.has(a.code) ? 1 : 0 } }))));
      if (drawnRwyN === rwyRows.size) return; drawnRwyN = rwyRows.size;
      const lines = [], ids = [];
      for (const [code, rows] of rwyRows) for (const r of rows) {
        if (![r[2], r[3], r[4], r[5]].every(Number.isFinite)) continue;
        const paved = /asph|conc|bitu|pav|tarmac|asp|con/i.test(r[8] || '');
        lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[r[3], r[2]], [r[5], r[4]]] }, properties: { code, w: r[7] || (paved ? 30 : 18), p: paved ? 1 : 0 } });
        const A = { lat: r[2], lng: r[3] }, B = { lat: r[4], lng: r[5] }, h = brg(A, B);
        if (r[0]) { const q = dest(A, h + 180, 110); ids.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [q.lng, q.lat] }, properties: { id: r[0] } }); }
        if (r[1]) { const q = dest(B, h, 110); ids.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [q.lng, q.lat] }, properties: { id: r[1] } }); }
      }
      map.getSource('rp-rwy').setData(fc(lines));
      map.getSource('rp-rid').setData(fc(ids));
    }
    // load each country's small airfields and runways as you look at it
    let busy = 0;
    function loadView() {
      if (map.getZoom() < 6.3) return;
      const b = map.getBounds(), s = Math.max(-90, b.getSouth()), n = Math.min(90, b.getNorth()); let w = b.getWest(), e = b.getEast();
      if (e - w > 60) return;
      const ccs = new Set();
      for (let la = Math.floor(s / 5); la <= Math.floor(n / 5); la++) for (let lo = Math.floor(w / 5); lo <= Math.floor(e / 5); lo++) {
        const L = ((lo + 36) % 72 + 72) % 72 - 36; (grid[`${la},${L}`] || '').split(' ').filter(Boolean).forEach(c => ccs.add(c));
      }
      const todo = [...ccs].filter(c => !loaded.has(c)).slice(0, 8); if (!todo.length) return;
      busy++; dlg.classList.add('loading');
      Promise.all(todo.map(loadCountry)).catch(() => { }).finally(() => { busy--; if (!busy) dlg.classList.remove('loading'); if (dlg.isConnected) { paintData(); if (sel) showCard(sel); paintPlan(); } });
    }
    map.on('moveend', loadView);

    // ---------- route drawing ----------
    function routePts() { return [plan.dep, ...plan.wps, plan.arr].filter(Boolean); }
    function endFor(a, id) { return a && id ? endsOf(a).find(e => e.id === id) : null; }
    function paintRoute() {
      const pts = routePts(), feats = [];
      if (pts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) }, properties: { k: 'leg' } });
      const ae = endFor(plan.arr, plan.arrEnd);
      if (ae?.T && ae.hdg != null) { const fa = dest(ae.T, ae.hdg + 180, 5.5 * 1852); feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[fa.lng, fa.lat], [ae.T.lng, ae.T.lat]] }, properties: { k: 'final' } }); }
      map.getSource('rp-route').setData(fc(feats));
      const selR = [];
      for (const [a, id] of [[plan.dep, plan.depEnd], [plan.arr, plan.arrEnd]]) { const e = endFor(a, id); if (e?.T) selR.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[e.T.lng, e.T.lat], [e.far.lng, e.far.lat]] }, properties: { w: e.wid || 30 } }); }
      map.getSource('rp-sel').setData(fc(selR));
      markers.splice(0).forEach(m => m.remove());
      plan.wps.forEach((p, i) => {
        const el = document.createElement('button'); el.type = 'button'; el.className = 'rp-pin'; el.textContent = String(i + 1); el.setAttribute('aria-label', `Waypoint ${i + 1}. Drag to move, or remove it in the plan.`);
        const m = new ML.Marker({ element: el, draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);
        m.on('dragend', () => { const ll = m.getLngLat(); plan.wps[i] = { lat: +ll.lat.toFixed(5), lng: +((ll.lng + 540) % 360 - 180).toFixed(5) }; changed(); });
        el.addEventListener('click', e => e.stopPropagation());
        markers.push(m);
      });
    }

    // ---------- the airport card ----------
    function showCard(a) {
      sel = a;
      if (!a) { $('[data-rcard]').innerHTML = ''; return; }
      const ends = endsOf(a), pairs = [...new Map(ends.map(e => [e.pair, e])).values()];
      const loadingRw = !a.full && !rwyRows.has(a.code);
      const rw = pairs.map(e => { const o = ends.filter(x => x.pair === e.pair); return `<li><b>${esc(e.pair)}</b><span>${o.map(x => x.hdg != null ? `${esc(x.id)} ${pad3(x.hdg)}°` : '').filter(Boolean).join(' · ') || ''}</span><small>${[e.len ? fmtM(e.len) + ' m' : '', e.wid ? fmtM(e.wid) + ' m wide' : '', e.surf || '', e.lit ? 'lit' : ''].filter(Boolean).map(esc).join(' · ')}</small></li>`; }).join('');
      const fq = (a.freqs || []).slice(0, 6).map(f => `<li><b>${esc(f[0])}</b> ${esc(Number(f[2]).toFixed(3))}</li>`).join('');
      const isDep = plan.dep?.code === a.code, isArr = plan.arr?.code === a.code;
      $('[data-rcard]').innerHTML = `<section class="rp-card">
        <div class="rp-card-top"><b>${esc(a.code)}</b>${a.iata ? `<span>${esc(a.iata)}</span>` : ''}<em>${esc(TYPE[a.type] || 'Airfield')}</em><button type="button" class="rp-mini-x" data-rcx aria-label="Close airport details">×</button></div>
        <h3>${esc(a.name)}</h3>
        <p>${esc([a.city, Number.isFinite(a.elev) ? `${fmtM(a.elev)} ft` : ''].filter(Boolean).join(' · '))}</p>
        ${rw ? `<ul class="rp-rwys">${rw}</ul>` : `<p class="rp-dim">${loadingRw ? 'Loading runways…' : 'No published runways. The simulator lays a grass strip along your route.'}</p>`}
        ${fq ? `<ul class="rp-fq">${fq}</ul>` : ''}
        <div class="rp-card-act">
          <button type="button" class="btn ${isDep ? 'btn-line' : 'btn-blue'} btn-sm" data-ras="dep">${isDep ? 'Departure ✓' : 'Depart from here'}</button>
          <button type="button" class="btn ${isArr ? 'btn-line' : 'btn-blue'} btn-sm" data-ras="arr">${isArr ? 'Arrival ✓' : 'Arrive here'}</button>
          ${plan.dep && plan.arr && !isDep && !isArr ? '<button type="button" class="btn btn-line btn-sm" data-ras="wp">Add as waypoint</button>' : ''}
        </div></section>`;
      $('[data-rcx]').onclick = () => { showCard(null); paintData(); };
      $$('[data-ras]').forEach(b => b.onclick = () => {
        const k = b.dataset.ras;
        if (k === 'dep') { if (plan.arr?.code === a.code && plan.dep) plan.arr = plan.dep; plan.dep = a; plan.depEnd = ''; }
        else if (k === 'arr') { plan.arr = a; plan.arrEnd = ''; }
        else plan.wps.push({ lat: a.lat, lng: a.lng });
        showCard(null); changed(true);
      });
      if (loadingRw) loadCountry(a.cc).then(() => { if (sel === a || sel?.code === a.code) { sel = aps.get(a.code); paintData(); showCard(sel); paintPlan(); } });
    }

    // ---------- the plan ----------
    const speed = () => +opts.speedKt || 110;
    function defaultAlt(d) { return opts.jet ? (d < 50 ? 5000 : d < 150 ? 11000 : d < 300 ? 21000 : 31000) : (d < 60 ? 3000 : d < 150 ? 4500 : 6500); }
    function endSelect(a, cur, k) {
      const ends = endsOf(a);
      if (!ends.length) return '';
      return `<label class="rp-rsel"><span>Runway</span><select data-rend="${k}"><option value="">Best for the wind</option>${ends.map(e => `<option value="${esc(e.id)}" ${cur === e.id ? 'selected' : ''}>${esc(e.id)}${e.hdg != null ? ` · ${pad3(e.hdg)}°` : ''}${e.len ? ` · ${fmtM(e.len)} m` : ''}</option>`).join('')}</select></label>`;
    }
    function paintPlan() {
      const pts = routePts(); let total = 0;
      const legs = pts.slice(1).map((p, i) => { const d = nm(pts[i], p); total += d; return { d, h: brg(pts[i], p) }; });
      if (!plan.altSet) plan.alt = defaultAlt(total);
      const apRow = (a, k, label) => a ? `<div class="rp-ap ${k}">
          <span class="rp-dot" aria-hidden="true"></span>
          <div class="rp-ap-t"><small>${label}</small><b>${esc(a.code)}</b><span>${esc(a.name)}</span></div>
          <button type="button" class="rp-mini-x" data-rdel="${k}" aria-label="Remove ${label.toLowerCase()}">×</button>
          ${endSelect(a, k === 'dep' ? plan.depEnd : plan.arrEnd, k)}
        </div>` : `<div class="rp-ap ${k} empty"><span class="rp-dot" aria-hidden="true"></span><div class="rp-ap-t"><small>${label}</small><span>${k === 'dep' ? 'Tap an airport on the map, or search for one' : plan.dep ? 'Now tap where you’re flying to' : ''}</span></div></div>`;
      const legTxt = i => legs[i] ? `<span class="rp-leg">${pad3(legs[i].h)}° · ${legs[i].d.toFixed(1)} NM</span>` : '';
      const mins = total / speed() * 60 + (pts.length > 1 ? 10 : 0);
      const tooFar = total > MAX_NM;
      $('[data-rplan]').innerHTML = `<section class="rp-plan">
        ${apRow(plan.dep, 'dep', 'Departure')}
        ${plan.wps.map((w, i) => `${legTxt(i)}<div class="rp-wp"><span class="rp-num">${i + 1}</span><div class="rp-ap-t"><small>Waypoint</small><span>${w.lat.toFixed(3)}, ${w.lng.toFixed(3)}</span></div><button type="button" class="rp-mini-x" data-rwdel="${i}" aria-label="Remove waypoint ${i + 1}">×</button></div>`).join('')}
        ${plan.arr ? legTxt(plan.wps.length) : ''}
        ${apRow(plan.arr, 'arr', 'Arrival')}
        ${plan.dep && plan.arr ? '<p class="rp-hint">Tap the map to add a waypoint. Drag a waypoint to move it.</p>' : ''}
      </section>`;
      $$('[data-rdel]').forEach(b => b.onclick = () => { if (b.dataset.rdel === 'dep') { plan.dep = null; plan.depEnd = ''; } else { plan.arr = null; plan.arrEnd = ''; } changed(); });
      $$('[data-rwdel]').forEach(b => b.onclick = () => { plan.wps.splice(+b.dataset.rwdel, 1); changed(); });
      $$('[data-rend]').forEach(s => s.onchange = () => { if (s.dataset.rend === 'dep') plan.depEnd = s.value; else plan.arrEnd = s.value; changed(); });
      const ready = plan.dep && plan.arr && !tooFar;
      $('[data-rfoot]').innerHTML = `${pts.length > 1 ? `<div class="rp-tot"><div><b>${total.toFixed(0)} NM</b><small>Distance</small></div><div><b>${Math.floor(mins / 60) ? Math.floor(mins / 60) + ' h ' : ''}${Math.round(mins % 60)} min</b><small>At ${speed()} kt</small></div><label><input type="number" inputmode="numeric" min="1000" max="${opts.jet ? 41000 : 12500}" step="500" value="${plan.alt}" data-ralt aria-label="Cruise altitude in feet"><small>Cruise, ft</small></label></div>` : ''}
        ${tooFar ? `<p class="rp-warn">Keep routes under ${MAX_NM} NM for now. Longer flights stretch the simulator’s map.</p>` : ''}
        <div class="rp-btns">
          <button type="button" class="btn btn-line btn-sm" data-rrev ${plan.dep && plan.arr ? '' : 'disabled'}>Reverse</button>
          <button type="button" class="btn btn-line btn-sm" data-rclr ${pts.length ? '' : 'disabled'}>Clear</button>
          <span class="rp-sp"></span>
          <button type="button" class="btn btn-line" data-rgo="replay" ${ready ? '' : 'disabled'}>Watch it flown</button>
          <button type="button" class="btn btn-blue" data-rgo="fly" ${ready ? '' : 'disabled'}>Fly it</button>
        </div>`;
      const al = $('[data-ralt]'); if (al) al.onchange = () => { const v = Math.round(+al.value / 100) * 100; if (v >= 1000) { plan.alt = Math.min(v, opts.jet ? 41000 : 12500); plan.altSet = true; save(); } };
      $('[data-rrev]').onclick = () => { [plan.dep, plan.arr] = [plan.arr, plan.dep]; [plan.depEnd, plan.arrEnd] = [plan.arrEnd, plan.depEnd]; plan.wps.reverse(); changed(); };
      $('[data-rclr]').onclick = () => { plan.dep = plan.arr = null; plan.wps = []; plan.depEnd = plan.arrEnd = ''; plan.altSet = false; changed(); };
      $$('[data-rgo]').forEach(b => b.onclick = () => {
        const r = toRoute(); if (!r) return;
        close(); opts.onFly && opts.onFly(r, b.dataset.rgo);
      });
    }
    function toRoute() {
      if (!plan.dep || !plan.arr) return null;
      const P = a => ({ code: a.code, lat: a.lat, lng: a.lng, cc: a.cc });
      return { name: `${plan.dep.code} → ${plan.arr.code}`, points: [P(plan.dep), ...plan.wps.map(w => ({ lat: w.lat, lng: w.lng })), P(plan.arr)], depEnd: plan.depEnd, arrEnd: plan.arrEnd, alt: plan.alt, dep: plan.dep, arr: plan.arr };
    }
    function save() { const r = toRoute() || { points: routePts().map(p => p.code ? { code: p.code, lat: p.lat, lng: p.lng, cc: p.cc } : { lat: p.lat, lng: p.lng }) }; store.set({ points: r.points, depEnd: plan.depEnd, arrEnd: plan.arrEnd, alt: plan.altSet ? plan.alt : 0 }); }
    function changed(fit) {
      paintData(); paintRoute(); paintPlan(); save();
      if (fit) { const pts = routePts(); if (pts.length > 1) { const b = new ML.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat]); pts.forEach(p => b.extend([p.lng, p.lat])); map.fitBounds(b, { padding: padFor(), maxZoom: 10, duration: 500 }); } else if (pts[0]) map.easeTo({ center: [pts[0].lng, pts[0].lat], zoom: Math.max(map.getZoom(), 10), duration: 500 }); }
    }
    const padFor = () => innerWidth > 820 ? { top: 80, bottom: 60, left: 60, right: 440 } : { top: 80, bottom: Math.round(innerHeight * .62), left: 40, right: 40 };

    // ---------- map clicks ----------
    map.on('mouseenter', 'rp-ap', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'rp-ap', () => map.getCanvas().style.cursor = '');
    let clickT = 0;
    map.on('click', e => {
      const pad = 10, box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
      const hit = map.queryRenderedFeatures(box, { layers: ['rp-ap', 'rp-aplab', 'rp-rwy'] })[0];
      if (hit) { const a = aps.get(hit.properties.code); if (a) { showCard(a); paintData(); if (innerWidth <= 820) $('[data-rpanel]').classList.remove('min'); } return; }
      if (sel) { showCard(null); paintData(); }
      // wait a moment so a double-click (zoom) doesn't drop two waypoints
      if (plan.dep && plan.arr) { const ll = e.lngLat.wrap(); clearTimeout(clickT); clickT = setTimeout(() => { plan.wps.push({ lat: +ll.lat.toFixed(5), lng: +ll.lng.toFixed(5) }); changed(); }, 260); }
    });
    map.on('dblclick', () => clearTimeout(clickT));

    // ---------- search ----------
    const q = $('[data-rq]'), res = $('[data-rres]');
    let found = [];
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    q.oninput = () => {
      const t = norm(q.value.trim()); if (t.length < 2) { res.hidden = true; return; }
      const T = t.toUpperCase(), sc = a => a.code === T || a.iata === T ? 0 : a.code.startsWith(T) ? 1 : norm(a.city || '').startsWith(t) ? 2 : norm(a.name).includes(t) || norm(a.city || '').includes(t) ? 3 : 9;
      found = [...aps.values()].filter(a => a.type !== 'H').map(a => [sc(a), a]).filter(x => x[0] < 9).sort((x, y) => x[0] - y[0] || 'LMSW'.indexOf(x[1].type) - 'LMSW'.indexOf(y[1].type)).slice(0, 8).map(x => x[1]);
      res.innerHTML = found.length ? found.map((a, i) => `<li><button type="button" data-rfi="${i}"><b>${esc(a.code)}</b><span>${esc(a.name)}</span><small>${esc([a.city, a.cc].filter(Boolean).join(', '))}</small></button></li>`).join('') : '<li class="rp-none">No airport found. Small airfields appear when you zoom into their country.</li>';
      res.hidden = false;
      $$('[data-rfi]').forEach(b => b.onclick = () => pick(found[+b.dataset.rfi]));
    };
    q.onkeydown = e => { if (e.key === 'Enter' && found[0]) { e.preventDefault(); pick(found[0]); } if (e.key === 'Escape') { res.hidden = true; } };
    function pick(a) { res.hidden = true; q.value = ''; q.blur(); map.flyTo({ center: [a.lng, a.lat], zoom: 12, duration: 900 }); loadCountry(a.cc).then(() => { const f = aps.get(a.code) || a; showCard(f); paintData(); }); showCard(a); paintData(); $('[data-rpanel]').classList.remove('min'); }

    paintData(); paintRoute(); paintPlan();
    if (routePts().length > 1) changed(true);
    loadView();
    return { close };
  }

  return { open, endsOf, nm, brg };
})();
