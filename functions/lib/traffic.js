// Live traffic around a point, from FlyItalyADSB (CC BY-SA 4.0). The key stays on the server.
// Each area is fetched at most every 15 s per Cloudflare location and shared by everyone looking
// at it, and a daily ceiling (ADSB_DAILY) keeps the free plan's 300,000 requests a month safe.
const API = 'https://api.flyitalyadsb.com/v2';
const TTL = 15;
const BUCKETS = [25, 50, 100, 200, 300, 500];
let tableReady = null;

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const today = () => new Date().toISOString().slice(0, 10);

export function area(url) {
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, 'Give a map position.');
  const wantKm = Math.max(10, Number(url.searchParams.get('km')) || 100);
  const km = BUCKETS.find(b => b >= wantKm) || 500;
  // snap to a grid that scales with the radius, so nearby viewers share one upstream call
  const step = km <= 50 ? 0.1 : km <= 100 ? 0.2 : km <= 200 ? 0.5 : 1;
  const q = v => Math.round(v / step) * step;
  return { lat: +q(lat).toFixed(3), lng: +q(lng).toFixed(3), km };
}

// readsb aircraft.json → the compact shape the apps draw
export function tidy(list, now = Date.now() / 1000) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (typeof a?.lat !== 'number' || typeof a?.lon !== 'number') continue;
    if ((a.seen_pos ?? 0) > 60) continue;              // stale position
    const flags = Number(a.dbFlags) || 0;
    if (flags & 8) continue;                              // LADD: owner asked not to be shown
    const pia = !!(flags & 4);
    const ground = a.alt_baro === 'ground';
    out.push({
      id: String(a.hex || '').replace(/^~/, ''),
      cs: pia ? '' : String(a.flight || '').trim(),
      reg: pia ? '' : String(a.r || '').trim(),
      type: String(a.t || '').trim(),
      lat: +a.lat.toFixed(5), lng: +a.lon.toFixed(5),
      alt: ground ? 0 : (Number.isFinite(a.alt_baro) ? Math.round(a.alt_baro) : Number.isFinite(a.alt_geom) ? Math.round(a.alt_geom) : null),
      ground,
      gs: Number.isFinite(a.gs) ? Math.round(a.gs) : null,
      trk: Number.isFinite(a.track) ? Math.round(a.track) : Number.isFinite(a.true_heading) ? Math.round(a.true_heading) : null,
      vs: Number.isFinite(a.baro_rate) ? Math.round(a.baro_rate) : null,
      mil: !!(flags & 1),
      cat: String(a.category || '')
    });
  }
  return out.slice(0, 600);
}

async function countCall(env) {
  if (!tableReady) tableReady = env.DB.prepare('CREATE TABLE IF NOT EXISTS flight_traffic_usage (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)').run().catch(e => { tableReady = null; throw e; });
  await tableReady;
  const row = await env.DB.prepare('SELECT n FROM flight_traffic_usage WHERE day=?').bind(today()).first();
  if ((row?.n || 0) >= Number(env.ADSB_DAILY ?? 9500)) fail(503, 'Live traffic is resting for today. It’s back at midnight UTC.');
  await env.DB.prepare('INSERT INTO flight_traffic_usage(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1').bind(today()).run();
}

export async function traffic(env, url, fetcher = fetch, cache = globalThis.caches?.default) {
  if (!env.ADSB_API_KEY) fail(503, 'Live traffic isn’t switched on yet.');
  const a = area(url);
  const key = new Request(`https://traffic.boplo.internal/v1/${a.lat}/${a.lng}/${a.km}`);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=10' };
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return new Response(hit.body, { headers });
  }
  await countCall(env);
  const res = await fetcher(`${API}/lat/${a.lat}/lon/${a.lng}/dist/${a.km}`, { headers: { 'X-Api-Key': env.ADSB_API_KEY, Accept: 'application/json', 'User-Agent': 'BoploFlight/1.0 (+https://boplo.app)' } });
  if (res.status === 429) fail(503, 'Live traffic is busy. Trying again shortly.');
  if (!res.ok) { console.error('ADS-B error', res.status, (await res.text().catch(() => '')).slice(0, 200)); fail(502, 'Live traffic isn’t available right now.'); }
  const data = await res.json().catch(() => ({}));
  const body = JSON.stringify({
    at: Number(data.now) || Math.floor(Date.now() / 1000),
    center: { lat: a.lat, lng: a.lng }, km: a.km,
    aircraft: tidy(data.ac),
    attribution: 'Traffic data: FlyItalyADSB (CC BY-SA 4.0)'
  });
  if (cache) await cache.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, s-maxage=${TTL}, max-age=${TTL}` } })).catch(() => { });
  return new Response(body, { headers });
}
