// Public, read-only METAR/TAF lookup for the free decoder at /tools/metar-decoder.
// Data: aviationweather.gov (NOAA). Cached at the edge for 10 minutes so the page can't hammer the source.
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const out = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  if (!/^[A-Z0-9]{3,4}$/.test(id)) return out({ error: 'Enter a 4-letter airport code, like KJFK or EGLL.' }, 400);
  const headers = { 'User-Agent': 'BoploFlight/1.0 (metar decoder; boplo.app)' };
  const base = 'https://aviationweather.gov/api/data';
  try {
    const [m, t] = await Promise.all([
      fetch(`${base}/metar?ids=${id}&format=json`, { headers, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 600, cacheEverything: true } }),
      fetch(`${base}/taf?ids=${id}&format=json`, { headers, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 900, cacheEverything: true } })
    ]);
    const read = async r => { if (!r.ok) return []; const x = await r.text(); try { return x.trim() ? JSON.parse(x) : []; } catch { return []; } };
    const [ml, tl] = await Promise.all([read(m), read(t)]);
    const s = ml[0];
    if (!s) return out({ error: `No current METAR for ${id}. Check the code, or the station may not report.` }, 404);
    return out({ id: s.icaoId, name: s.name || '', raw: s.rawOb || '', obsTime: s.obsTime || null, taf: (tl[0] || {}).rawTAF || '', source: 'aviationweather.gov (NOAA)' });
  } catch {
    return out({ error: 'Weather is unavailable right now. Paste a METAR below instead.' }, 503);
  }
}
