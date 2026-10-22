// Web push for Boplo Flight: VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291) with WebCrypto.
// The VAPID key pair is generated on first use and kept in D1, so no secret has to be set by hand.
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), o = new Uint8Array(n); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };

let tables = null;
const ensure = env => tables || (tables = env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS flight_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS flight_push (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS flight_push_user ON flight_push(user_id)')
]).catch(e => { tables = null; throw e; }));

let vapidCache = null;
export async function vapid(env) {
  if (vapidCache) return vapidCache;
  await ensure(env);
  let row = await env.DB.prepare("SELECT v FROM flight_kv WHERE k='vapid'").first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey), pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    await env.DB.prepare("INSERT OR IGNORE INTO flight_kv(k,v) VALUES('vapid',?)").bind(JSON.stringify({ jwk, pub })).run();
    row = await env.DB.prepare("SELECT v FROM flight_kv WHERE k='vapid'").first();
  }
  const { jwk, pub } = JSON.parse(row.v);
  vapidCache = { pub, key: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  return vapidCache;
}
async function jwt(env, aud) {
  const v = await vapid(env), sub = /@/.test(env.EMAIL_FROM || '') ? 'mailto:' + String(env.EMAIL_FROM).match(/[^<\s]+@[^>\s]+/)[0] : 'mailto:hello@boplo.app';
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(`${h}.${p}`));
  return { t: `${h}.${p}.${b64u(sig)}`, k: v.pub };
}
const hkdf = async (salt, ikm, info, bits) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bits));
// RFC 8291: one aes128gcm record containing the JSON payload
export async function encryptPayload(p256dh, authSecret, payload) {
  const ua = unb64u(p256dh), auth = unb64u(authSecret), salt = crypto.getRandomValues(new Uint8Array(16));
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), ua, asPub), 256);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128), nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function sendOne(env, sub, payload, fetcher = fetch) {
  const url = new URL(sub.endpoint), { t, k } = await jwt(env, url.origin);
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(payload));
  return fetcher(sub.endpoint, { method: 'POST', headers: { Authorization: `vapid t=${t}, k=${k}`, TTL: '86400', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Urgency: payload.urgent ? 'high' : 'normal' }, body });
}
// send to every device the user has switched notifications on for; stale subscriptions are removed
export async function pushTo(env, userId, payload, fetcher = fetch) {
  await ensure(env);
  const subs = (await env.DB.prepare('SELECT endpoint,p256dh,auth FROM flight_push WHERE user_id=?').bind(userId).all()).results || [];
  let sent = 0;
  for (const s of subs) {
    try {
      const r = await sendOne(env, s, payload, fetcher);
      if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM flight_push WHERE endpoint=?').bind(s.endpoint).run();
      else if (r.ok) sent++;
      else console.error('push failed', r.status);
    } catch (e) { console.error('push error', e.message); }
  }
  return sent;
}
export const hasPush = async (env, userId) => { await ensure(env); return !!(await env.DB.prepare('SELECT 1 FROM flight_push WHERE user_id=? LIMIT 1').bind(userId).first()); };
export async function pushRoutes(env, path, method, user, readBody) {
  await ensure(env);
  if (path === 'push/key' && method === 'GET') return { key: (await vapid(env)).pub, on: !!(await env.DB.prepare('SELECT 1 FROM flight_push WHERE user_id=? LIMIT 1').bind(user.id).first()) };
  if (path === 'push/subscribe' && method === 'POST') {
    const b = await readBody(), s = b?.subscription || {};
    if (!/^https:\/\//.test(String(s.endpoint || '')) || !s.keys?.p256dh || !s.keys?.auth) throw Object.assign(new Error('That notification subscription isn’t valid.'), { status: 400 });
    await env.DB.prepare('INSERT INTO flight_push(endpoint,user_id,p256dh,auth,created_at) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth').bind(String(s.endpoint).slice(0, 800), user.id, String(s.keys.p256dh).slice(0, 200), String(s.keys.auth).slice(0, 100), Date.now()).run();
    return { ok: true };
  }
  if (path === 'push/subscribe' && method === 'DELETE') { const b = await readBody().catch(() => ({})); if (b?.endpoint) await env.DB.prepare('DELETE FROM flight_push WHERE endpoint=? AND user_id=?').bind(String(b.endpoint), user.id).run(); else await env.DB.prepare('DELETE FROM flight_push WHERE user_id=?').bind(user.id).run(); return { ok: true }; }
  if (path === 'push/test' && method === 'POST') return { sent: await pushTo(env, user.id, { title: 'Boplo Flight', body: 'Notifications are working. You’ll hear about lessons, forecasts and messages here.', url: '/flight-app.html#overview' }) };
  return null;
}
