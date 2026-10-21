/* Boplo Flight — chart map.
   MapLibre GL (open source) + OpenFreeMap vector tiles (free, no key), styled as a Boplo night chart,
   with real airfields from OurAirports (public domain), pre-split per country in /airfields/<ISO2>.json. */
window.BoploMap = (() => {
  'use strict';
  const LIB = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
  let libReady = null;
  const cache = {};

  function loadLib() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (libReady) return libReady;
    libReady = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LIB + '.css'; document.head.append(css);
      const s = document.createElement('script'); s.src = LIB + '.js'; s.async = true;
      s.onload = () => window.maplibregl ? res(window.maplibregl) : rej(new Error('Map library unavailable.'));
      s.onerror = () => { libReady = null; rej(new Error('Map library unavailable.')); };
      setTimeout(() => rej(new Error('Map library timed out.')), 15000);
      document.head.append(s);
    });
    return libReady;
  }

  async function airfields(cc) {
    if (!cc || !/^[A-Z]{2}$/.test(cc)) return [];
    if (cache[cc]) return cache[cc];
    cache[cc] = fetch(`/airfields/${cc}.json`).then(r => r.ok ? r.json() : { rows: [] }).then(d => (d.rows || []).map(r => ({
      code: r[0], name: r[1], lat: r[2], lng: r[3], type: r[4], elev: r[5], city: r[6], iata: r[7], runways: r[8] || [], freqs: r[9] || []
    }))).catch(() => []);
    return cache[cc];
  }
  const findAirfield = (list, code) => { const c = String(code || '').trim().toUpperCase().split(/[\s·]/)[0]; return c ? list.find(a => a.code.toUpperCase() === c) : null; };

  const C = { night: '#040B22', deep: '#06102A', water: '#08204F', land: '#050D26', electric: '#0A62FF', ice: '#9ED8FF', mist: '#8FA0C4' };
  function style() {
    const nameF = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
    return {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': C.land } },
        { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]], paint: { 'fill-color': 'rgba(47,123,255,0.05)' } },
        { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]], minzoom: 8, paint: { 'fill-color': 'rgba(158,216,255,0.045)' } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.water } },
        { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 8, paint: { 'line-color': '#0B2A66', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2] } },
        { id: 'aeroway-area', type: 'fill', source: 'omt', 'source-layer': 'aeroway', minzoom: 11, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': 'rgba(158,216,255,0.07)' } },
        { id: 'roads-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'minor']]], paint: { 'line-color': 'rgba(158,216,255,0.09)', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 15, 2] } },
        { id: 'roads-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], paint: { 'line-color': 'rgba(47,123,255,0.30)', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 3] } },
        { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': 'rgba(158,216,255,0.12)', 'line-width': 0.8, 'line-dasharray': [3, 3] } },
        { id: 'runways', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 10, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']], paint: { 'line-color': 'rgba(158,216,255,0.55)', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, 1.5, 16, 24] } },
        { id: 'boundary-country', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['<=', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': 'rgba(158,216,255,0.35)', 'line-width': 1.1 } },
        { id: 'boundary-region', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 5, filter: ['all', ['in', ['get', 'admin_level'], ['literal', [3, 4]]], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': 'rgba(158,216,255,0.14)', 'line-width': 0.8, 'line-dasharray': [4, 3] } },
        { id: 'places-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 8, filter: ['in', ['get', 'class'], ['literal', ['town', 'village']]], layout: { 'text-field': nameF, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 13, 13] }, paint: { 'text-color': 'rgba(222,233,255,0.55)', 'text-halo-color': C.land, 'text-halo-width': 1.4 } },
        { id: 'places-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 4, filter: ['==', ['get', 'class'], 'city'], layout: { 'text-field': nameF, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 15] }, paint: { 'text-color': 'rgba(230,240,255,0.78)', 'text-halo-color': C.land, 'text-halo-width': 1.6 } },
        { id: 'places-country', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 6, filter: ['==', ['get', 'class'], 'country'], layout: { 'text-field': nameF, 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-transform': 'none', 'text-letter-spacing': 0.08 }, paint: { 'text-color': 'rgba(158,216,255,0.6)', 'text-halo-color': C.land, 'text-halo-width': 1.5 } }
      ]
    };
  }

  const fc = features => ({ type: 'FeatureCollection', features });
  const airfieldGeo = (list, home) => fc(list.map(a => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lng, a.lat] }, properties: { code: a.code, name: a.name, t: a.type, rank: a.type === 'L' ? 3 : a.type === 'M' ? 2 : 1, home: home && a.code === home ? 1 : 0 } })));
  const trackGeo = (flights, sel) => fc(flights.filter(f => f.points?.length > 1).map(f => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: f.points.map(p => [p.lng, p.lat]) }, properties: { id: f.id, kind: f.routeKind || 'endpoints', on: !sel || sel === f.id ? 1 : 0 } })));

  function addAirfieldLayers(map, prefix = '') {
    map.addLayer({ id: prefix + 'af-dot', type: 'circle', source: prefix + 'airfields',
      filter: ['any', ['>=', ['get', 'rank'], 2], ['>=', ['zoom'], 6.5], ['==', ['get', 'home'], 1]],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 't'], 'L', 3.5, 'M', 2.6, 1.6], 10, ['match', ['get', 't'], 'L', 7, 'M', 6, 4.5]],
        'circle-color': ['case', ['==', ['get', 'home'], 1], C.ice, C.night],
        'circle-stroke-color': ['case', ['==', ['get', 'home'], 1], '#ffffff', ['match', ['get', 't'], 'L', C.ice, 'M', C.ice, 'rgba(158,216,255,0.75)']],
        'circle-stroke-width': ['case', ['==', ['get', 'home'], 1], 2.5, 1.4]
      } });
    map.addLayer({ id: prefix + 'af-label', type: 'symbol', source: prefix + 'airfields',
      filter: ['any', ['all', ['>=', ['get', 'rank'], 2], ['>=', ['zoom'], 6.5]], ['>=', ['zoom'], 8.5], ['==', ['get', 'home'], 1]],
      layout: { 'text-field': ['get', 'code'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.15], 'text-anchor': 'top', 'text-letter-spacing': 0.06, 'text-optional': true },
      paint: { 'text-color': ['case', ['==', ['get', 'home'], 1], '#ffffff', 'rgba(222,233,255,0.82)'], 'text-halo-color': C.land, 'text-halo-width': 1.5 } });
  }
  function addTrackLayers(map) {
    map.addSource('tracks', { type: 'geojson', data: fc([]) });
    map.addLayer({ id: 'tr-glow', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.electric, 'line-opacity': ['case', ['==', ['get', 'on'], 1], 0.55, 0.15], 'line-width': ['case', ['==', ['get', 'on'], 1], 9, 5], 'line-blur': 3 } }, 'af-dot');
    map.addLayer({ id: 'tr-solid', type: 'line', source: 'tracks', filter: ['==', ['get', 'kind'], 'track'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'on'], 1], C.ice, 'rgba(158,216,255,0.35)'], 'line-width': ['case', ['==', ['get', 'on'], 1], 2.4, 1.4] } }, 'af-dot');
    map.addLayer({ id: 'tr-dash', type: 'line', source: 'tracks', filter: ['!=', ['get', 'kind'], 'track'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'on'], 1], C.ice, 'rgba(158,216,255,0.35)'], 'line-width': ['case', ['==', ['get', 'on'], 1], 2.2, 1.3], 'line-dasharray': [2, 2] } }, 'af-dot');
  }

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPE = { L: 'Large airport', M: 'Airport', S: 'Airfield', W: 'Seaplane base' };
  function airfieldCard(a, extra = '') {
    const rw = a.runways.filter(r => r[0] || r[1]).map(r => `<li><b>${esc(r[0] || 'Runway')}</b>${r[1] ? ` · ${r[1].toLocaleString('en-GB')} m` : ''}${r[2] ? ` ${esc(r[2])}` : ''}</li>`).join('');
    const fq = a.freqs.map(f => `<li><b>${esc(f[0])}</b> ${esc(Number(f[2]).toFixed(3))}${f[1] && f[1] !== f[0] ? ` <span>${esc(f[1])}</span>` : ''}</li>`).join('');
    return `<div class="af-card"><div class="af-top"><b>${esc(a.code)}</b><span>${esc(TYPE[a.type] || 'Airfield')}</span></div><h4>${esc(a.name)}</h4><p>${esc([a.city, a.elev != null ? `${a.elev.toLocaleString('en-GB')} ft` : ''].filter(Boolean).join(' · '))}</p>${rw ? `<ul class="af-list">${rw}</ul>` : ''}${fq ? `<ul class="af-list af-fq">${fq}</ul>` : ''}${extra}<small>Community data from OurAirports. Check the official AIP before flying.</small></div>`;
  }

  async function create(el, { country, home, center, zoom = 6, interactive = true } = {}) {
    const ml = await loadLib();
    if (!ml.supported || (ml.supported && !ml.supported())) { /* v4 removed supported(); WebGL check below */ }
    const test = document.createElement('canvas'); if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('This browser can’t draw the map.');
    const list = await airfields(country);
    const homeAf = findAirfield(list, home);
    const start = center || (homeAf ? [homeAf.lng, homeAf.lat] : list.length ? [list[0].lng, list[0].lat] : [0, 30]);
    const map = new ml.Map({ container: el, style: style(), center: start, zoom: center || homeAf ? zoom : list.length ? 5 : 1.5, attributionControl: false, interactive, dragRotate: false, pitchWithRotate: false, cooperativeGestures: false });
    map.addControl(new ml.AttributionControl({ compact: true, customAttribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://ourairports.com" target="_blank" rel="noopener">OurAirports</a>' }), 'bottom-right');
    if (interactive) map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate?.disableRotation?.();
    await new Promise((res, rej) => { map.once('load', res); map.once('error', e => { if (!map.loaded()) rej(new Error('Map tiles unavailable.')); }); setTimeout(res, 12000); });
    map.addSource('airfields', { type: 'geojson', data: airfieldGeo(list, homeAf?.code) });
    addAirfieldLayers(map);
    addTrackLayers(map);
    map.on('mouseenter', 'af-dot', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'af-dot', () => map.getCanvas().style.cursor = '');
    return { map, ml, list, homeAf };
  }

  function fit(ctx, coords, pad = 60) {
    if (!coords.length) return;
    const b = new ctx.ml.LngLatBounds(coords[0], coords[0]); coords.forEach(c => b.extend(c));
    ctx.map.fitBounds(b, { padding: pad, maxZoom: 11, duration: 0 });
  }

  // ---------- Map page ----------
  async function mountOverview(el, { country, home, flights, selected, onCount }) {
    const ctx = await create(el, { country, home, zoom: 8 });
    const { map, ml, list } = ctx;
    const set = sel => {
      map.getSource('tracks').setData(trackGeo(flights, sel));
      const chosen = flights.filter(f => (!sel || f.id === sel) && f.points?.length);
      const coords = chosen.flatMap(f => f.points.map(p => [p.lng, p.lat]));
      if (coords.length) fit(ctx, coords, 70);
    };
    set(selected);
    const popup = new ml.Popup({ closeButton: true, maxWidth: '300px', className: 'bp-pop', offset: 12 });
    map.on('click', 'af-dot', e => {
      const a = list.find(x => x.code === e.features[0].properties.code); if (!a) return;
      const n = flights.filter(f => [f.departure, f.arrival].some(c => findAirfield([a], c))).length;
      popup.setLngLat([a.lng, a.lat]).setHTML(airfieldCard(a, n ? `<p class="af-mine">${n} of your flight${n === 1 ? '' : 's'} used this airfield</p>` : '')).addTo(map);
    });
    onCount && onCount(list.length);
    return { select: set, destroy: () => map.remove() };
  }

  // ---------- Route plotter ----------
  const R = 3440.065; // NM
  const nm = (a, b) => { const t = x => x * Math.PI / 180, dφ = t(b.lat - a.lat), dλ = t(b.lng - a.lng); const h = Math.sin(dφ / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dλ / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const brg = (a, b) => { const t = x => x * Math.PI / 180, y = Math.sin(t(b.lng - a.lng)) * Math.cos(t(b.lat)), x = Math.cos(t(a.lat)) * Math.sin(t(b.lat)) - Math.sin(t(a.lat)) * Math.cos(t(b.lat)) * Math.cos(t(b.lng - a.lng)); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };

  async function mountPlotter(host, { country, home, points = [], from, to, onDone, onCancel }) {
    host.innerHTML = `<div class="plotter">
      <div class="plot-map" data-pmap><div class="plot-loading">Loading the chart…</div></div>
      <aside class="plot-panel">
        <header><h3 class="display">Plot your route</h3><button type="button" class="icon-btn" data-pcancel aria-label="Close map"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button></header>
        <p class="plot-help">Tap an airfield to start or end there. Tap anywhere else to add a turn point. Drag points to adjust.</p>
        <label class="plot-search"><svg class="ico" aria-hidden="true"><use href="#i-search"/></svg><span class="sr">Find an airfield</span><input data-psearch list="plot-af" placeholder="Find an airfield (ICAO or name)" autocomplete="off"><datalist id="plot-af"></datalist></label>
        <ol class="plot-points" data-plist></ol>
        <div class="plot-total" data-ptotal></div>
        <div class="plot-actions"><button type="button" class="btn btn-line btn-sm" data-pundo>Undo</button><button type="button" class="btn btn-line btn-sm" data-pclear>Clear</button><button type="button" class="btn btn-blue" data-pdone>Use this route</button></div>
        <small class="plot-note">For your records only. Not for navigation.</small>
      </aside></div>`;
    const q = s => host.querySelector(s);
    let pts = points.map(p => ({ lat: p.lat, lng: p.lng, code: '' }));
    let ctx;
    const markers = [];
    try { ctx = await create(q('[data-pmap]'), { country, home, zoom: 8.5 }); }
    catch (e) { q('[data-pmap]').innerHTML = `<div class="plot-loading">${esc(e.message)} You can still paste coordinates in the form.</div>`; }
    if (ctx) {
      const { map, ml, list } = ctx;
      // snap stored points to airfields where they match
      pts = pts.map(p => { const a = list.find(x => Math.abs(x.lat - p.lat) < 0.003 && Math.abs(x.lng - p.lng) < 0.003); return a ? { ...p, code: a.code } : p; });
      if (!pts.length) { const f = findAirfield(list, from); if (f) pts.push({ lat: f.lat, lng: f.lng, code: f.code }); const t = findAirfield(list, to); if (t && (!f || t.code !== f.code)) pts.push({ lat: t.lat, lng: t.lng, code: t.code }); }
      q('#plot-af').innerHTML = list.slice(0, 4000).map(a => `<option value="${esc(a.code)}">${esc(a.name)}</option>`).join('');
      map.addSource('plot', { type: 'geojson', data: fc([]) });
      map.addLayer({ id: 'plot-glow', type: 'line', source: 'plot', paint: { 'line-color': C.electric, 'line-width': 9, 'line-opacity': 0.5, 'line-blur': 3 } });
      map.addLayer({ id: 'plot-line', type: 'line', source: 'plot', paint: { 'line-color': C.ice, 'line-width': 2.4 } });
      const popup = new ml.Popup({ closeButton: true, maxWidth: '300px', className: 'bp-pop', offset: 12 });
      const draw = () => {
        map.getSource('plot').setData(fc(pts.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) }, properties: {} }] : []));
        markers.splice(0).forEach(m => m.remove());
        pts.forEach((p, i) => {
          const el = document.createElement('div'); el.className = 'plot-pin' + (p.code ? ' af' : ''); el.textContent = p.code ? '' : String(i + 1);
          el.setAttribute('aria-label', p.code ? `${p.code}` : `Turn point ${i + 1}`);
          const m = new ml.Marker({ element: el, draggable: !p.code }).setLngLat([p.lng, p.lat]).addTo(map);
          m.on('dragend', () => { const ll = m.getLngLat(); pts[i] = { lat: +ll.lat.toFixed(5), lng: +ll.lng.toFixed(5), code: '' }; draw(); });
          markers.push(m);
        });
        let total = 0;
        q('[data-plist]').innerHTML = pts.map((p, i) => {
          const leg = i ? nm(pts[i - 1], p) : 0; total += leg;
          const a = p.code ? list.find(x => x.code === p.code) : null;
          return `<li><span class="pp-i">${p.code ? '✈' : i + 1}</span><span class="pp-t"><b>${esc(p.code || `Turn point ${i + 1}`)}</b><small>${a ? esc(a.name) : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}</small></span>${i ? `<span class="pp-leg">${leg.toFixed(1)} NM · ${String(Math.round(brg(pts[i - 1], p))).padStart(3, '0')}°</span>` : '<span class="pp-leg">Start</span>'}<button type="button" data-pdel="${i}" aria-label="Remove point"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button></li>`;
        }).join('') || '<li class="pp-empty">No points yet.</li>';
        q('[data-ptotal]').innerHTML = pts.length > 1 ? `<span>${pts.length} points</span><b>${total.toFixed(1)} NM</b>` : '';
        host.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => { pts.splice(Number(b.dataset.pdel), 1); draw(); });
      };
      const addAf = a => { pts.push({ lat: a.lat, lng: a.lng, code: a.code }); draw(); };
      map.on('click', e => {
        const hit = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['af-dot'] })[0];
        if (hit) {
          const a = list.find(x => x.code === hit.properties.code); if (!a) return;
          const btn = `<button type="button" class="btn btn-blue btn-sm af-add">Add ${esc(a.code)} to route</button>`;
          popup.setLngLat([a.lng, a.lat]).setHTML(airfieldCard(a, btn)).addTo(map);
          popup.getElement().querySelector('.af-add').onclick = () => { popup.remove(); addAf(a); };
          return;
        }
        pts.push({ lat: +e.lngLat.lat.toFixed(5), lng: +e.lngLat.lng.toFixed(5), code: '' }); draw();
      });
      const search = q('[data-psearch]');
      search.onchange = () => { const a = findAirfield(list, search.value) || list.find(x => x.name.toLowerCase().includes(search.value.trim().toLowerCase())); if (a) { map.flyTo({ center: [a.lng, a.lat], zoom: 11, duration: 600 }); addAf(a); search.value = ''; } };
      q('[data-pundo]').onclick = () => { pts.pop(); draw(); };
      q('[data-pclear]').onclick = () => { pts = []; draw(); };
      draw();
      if (pts.length) fit(ctx, pts.map(p => [p.lng, p.lat]), 80);
    }
    q('[data-pcancel]').onclick = () => { ctx?.map.remove(); onCancel && onCancel(); };
    q('[data-pdone]').onclick = () => { const first = pts[0], last = pts[pts.length - 1]; ctx?.map.remove(); onDone && onDone({ points: pts.map(p => ({ lat: p.lat, lng: p.lng })), from: first?.code || '', to: last?.code || '' }); };
  }

  return { airfields, findAirfield, mountOverview, mountPlotter, loadLib, nm };
})();
