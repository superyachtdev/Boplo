// Native push for the iOS app. Web push (VAPID) is unchanged.
// Cloudflare env, all optional until Gianni creates the key. Nothing here is a secret in git.
//   APPLE_TEAM_ID
//   APPLE_BUNDLE_ID          (defaults to app.boplo.flight)
//   APPLE_APNS_KEY_ID
//   APPLE_APNS_PRIVATE_KEY   (contents of the .p8 file, including the BEGIN line)
//   APPLE_APNS_ENV           sandbox (default) or production

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const BUNDLE = 'app.boplo.flight';

let tables = null;
export const ensureApns = env => tables || (tables = env.DB.prepare(`CREATE TABLE IF NOT EXISTS flight_apns (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  updated_at INTEGER NOT NULL
)`).run().then(() => env.DB.prepare('CREATE INDEX IF NOT EXISTS flight_apns_user ON flight_apns(user_id)').run()).catch(e => { tables = null; throw e; }));

export function apnsConfigured(env) {
  return !!(env.APPLE_TEAM_ID && env.APPLE_APNS_KEY_ID && env.APPLE_APNS_PRIVATE_KEY);
}

function pkcs8Body(pem) {
  return String(pem).replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
}

let cached = null;
export async function apnsJwt(env, now = Math.floor(Date.now() / 1000)) {
  if (cached && cached.exp > now + 60 && cached.kid === env.APPLE_APNS_KEY_ID) return cached.token;
  const crypto = await import('node:crypto').catch(() => null);
  if (!crypto?.createSign) fail(503, 'Native notifications need the nodejs_compat flag on Cloudflare Pages.');
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: env.APPLE_APNS_KEY_ID })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now })).toString('base64url');
  const key = crypto.createPrivateKey({ key: Buffer.from(pkcs8Body(env.APPLE_APNS_PRIVATE_KEY), 'base64'), format: 'der', type: 'pkcs8' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const token = `${header}.${payload}.${sig}`;
  cached = { token, exp: now + 3000, kid: env.APPLE_APNS_KEY_ID };
  return token;
}

export async function registerApns(env, userId, input) {
  await ensureApns(env);
  const token = String(input?.token || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (token.length < 32 || token.length > 200) fail(400, 'That notification token isn’t valid.');
  const environment = input?.environment === 'production' ? 'production' : 'sandbox';
  await env.DB.prepare('INSERT INTO flight_apns(token,user_id,environment,updated_at) VALUES(?,?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, environment=excluded.environment, updated_at=excluded.updated_at')
    .bind(token, userId, environment, Date.now()).run();
  return { ok: true, configured: apnsConfigured(env) };
}

export async function unregisterApns(env, userId, input) {
  await ensureApns(env);
  const token = String(input?.token || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (token) await env.DB.prepare('DELETE FROM flight_apns WHERE token=? AND user_id=?').bind(token, userId).run();
  else await env.DB.prepare('DELETE FROM flight_apns WHERE user_id=?').bind(userId).run();
  return { ok: true };
}

export async function sendApns(env, userId, payload, fetcher = fetch) {
  await ensureApns(env);
  if (!apnsConfigured(env)) return 0;
  const rows = ((await env.DB.prepare('SELECT token,environment FROM flight_apns WHERE user_id=?').bind(userId).all()).results || []);
  const jwt = await apnsJwt(env);
  const bundle = env.APPLE_BUNDLE_ID || BUNDLE;
  let sent = 0;
  for (const row of rows) {
    const host = row.environment === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
    const res = await fetcher(`${host}/3/device/${row.token}`, {
      method: 'POST',
      headers: { authorization: `bearer ${jwt}`, 'apns-topic': bundle, 'apns-push-type': 'alert', 'apns-priority': payload.urgent ? '10' : '5' },
      body: JSON.stringify({ aps: { alert: { title: payload.title || 'Boplo Flight', body: payload.body || '' }, sound: 'default' }, url: payload.url || '/flight-app.html#overview' })
    });
    if (res.status === 410 || res.status === 400) await env.DB.prepare('DELETE FROM flight_apns WHERE token=?').bind(row.token).run();
    else if (res.ok) sent++;
  }
  return sent;
}

export async function hasApns(env, userId) {
  await ensureApns(env);
  return !!(await env.DB.prepare('SELECT 1 FROM flight_apns WHERE user_id=? LIMIT 1').bind(userId).first());
}
