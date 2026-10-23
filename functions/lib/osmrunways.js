// Runway geometry from OpenStreetMap (ODbL), for the simulator. OurAirports runway ends are often tens of metres out,
// which puts the drawn runway beside the real one in the photo scenery; OSM runway ways are traced from imagery.
// Results are cached in D1 (flight_kv) so each airfield costs Overpass one query a month.
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const DAY = 864e5;
let ready = null;
const ensure = env => ready || (ready = env.DB.prepare('CREATE TABLE IF NOT EXISTS flight_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)').run().catch(e => { ready = null; throw e; }));
const num = v => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
export function shapeOSM(elements) {
  return (elements || []).filter(e => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2).map(e => {
    const g = e.geometry.map(p => [+p.lat.toFixed(7), +p.lon.toFixed(7)]), t = e.tags || {};
    const closed = g.length > 3 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1];
    let w = num(t.width); if (w != null && /ft|'/.test(String(t.width))) w *= .3048;
    return { ref: String(t.ref || '').slice(0, 12), width: w != null && w > 5 && w < 120 ? Math.round(w * 10) / 10 : null, surface: String(t.surface || '').slice(0, 20), area: closed || t.area === 'yes', pts: g };
  }).slice(0, 24);
}
export async function osmRunways(env, code, lat, lng, fetcher = fetch) {
  code = String(code || '').toUpperCase(); lat = +lat; lng = +lng;
  if (!/^[A-Z0-9-]{3,8}$/.test(code) || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) throw Object.assign(new Error('Unknown airfield.'), { status: 400 });
  await ensure(env);
  const key = 'osmrw:' + code, row = await env.DB.prepare('SELECT v FROM flight_kv WHERE k=?').bind(key).first();
  if (row) { try { const c = JSON.parse(row.v); if (Date.now() - c.t < (c.runways.length ? 30 : 2) * DAY) return { runways: c.runways, cached: true }; } catch { } }
  const q = `[out:json][timeout:12];way["aeroway"="runway"](around:4000,${lat.toFixed(5)},${lng.toFixed(5)});out geom tags;`;
  let runways = null; const errs = [];
  for (const url of MIRRORS) {
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 3500);
      const r = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'BoploFlight/1.0 (boplo.app)' }, body: 'data=' + encodeURIComponent(q), signal: ctl.signal });
      clearTimeout(timer);
      if (!r.ok) { errs.push(r.status); continue; }
      runways = shapeOSM((await r.json()).elements); break;
    } catch (e) { errs.push(String(e?.name || e).slice(0, 40)); }
  }
  if (!runways) { if (row) { try { return { runways: JSON.parse(row.v).runways, cached: true, stale: true }; } catch { } } return { runways: [], unavailable: true, errs }; }
  await env.DB.prepare('INSERT INTO flight_kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(key, JSON.stringify({ t: Date.now(), runways })).run();
  return { runways };
}

// A signed-in browser that fetched OSM runways itself (Overpass often refuses Cloudflare) can share them, so the next
// pilot at that airfield doesn't wait. Only runways that sit within 250 m of a published runway's ends are kept, and an
// existing fresh entry is never overwritten, so a bad submission can't move a runway far or replace good data.
const mDist = (a, b) => { const k = Math.PI / 180, x = (b[1] - a[1]) * k * Math.cos((a[0] + b[0]) / 2 * k), y = (b[0] - a[0]) * k; return Math.hypot(x, y) * 6371000; };
export async function contributeOSM(env, input, loadRows) {
  const code = String(input?.code || '').toUpperCase(), cc = String(input?.cc || '').toUpperCase();
  if (!/^[A-Z0-9-]{3,8}$/.test(code) || !/^[A-Z]{2}$/.test(cc) || !Array.isArray(input?.runways)) throw Object.assign(new Error('Invalid runways.'), { status: 400 });
  await ensure(env);
  const key = 'osmrw:' + code, row = await env.DB.prepare('SELECT v FROM flight_kv WHERE k=?').bind(key).first();
  if (row) { try { const c = JSON.parse(row.v); if (c.runways.length && Date.now() - c.t < 30 * DAY) return { ok: true, kept: c.runways.length }; } catch { } }
  const rows = (await loadRows(cc))?.[code] || [];
  if (!rows.length) return { ok: false };
  const clean = input.runways.slice(0, 24).map(o => ({
    ref: String(o?.ref || '').slice(0, 12), width: Number.isFinite(+o?.width) && o.width > 5 && o.width < 120 ? Math.round(o.width * 10) / 10 : null,
    surface: String(o?.surface || '').slice(0, 20), area: !!o?.area,
    pts: (Array.isArray(o?.pts) ? o.pts : []).slice(0, 400).map(p => [+(+p?.[0]).toFixed(7), +(+p?.[1]).toFixed(7)]).filter(p => Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)
  })).filter(o => o.pts.length >= 2 && !o.area);
  const kept = clean.filter(o => { const a = o.pts[0], b = o.pts[o.pts.length - 1]; return rows.some(r => { const le = [r[2], r[3]], he = [r[4], r[5]]; return (mDist(a, le) < 250 && mDist(b, he) < 250) || (mDist(a, he) < 250 && mDist(b, le) < 250); }); });
  if (!kept.length) return { ok: false };
  await env.DB.prepare('INSERT INTO flight_kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(key, JSON.stringify({ t: Date.now(), runways: kept, from: 'client' })).run();
  return { ok: true, kept: kept.length };
}
