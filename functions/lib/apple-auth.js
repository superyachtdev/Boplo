// Sign in with Apple. Linking an existing Boplo account happens only when Apple
// sends a verified email that already belongs to that account, and that account
// is not already linked to a different Apple ID. A private-relay address that
// matches nobody creates a new account. It is never guessed from a name.

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function emailVerified(value) {
  return value === true || value === 'true';
}

export function decideAppleLink({ bySub, byEmail, sub, email, verified }) {
  if (!sub) return { action: 'reject', error: 'Apple didn’t send an account id.' };
  if (bySub) return { action: 'login', userId: bySub.id };
  if (email && verified && byEmail) {
    if (byEmail.apple_subject && byEmail.apple_subject !== sub) return { action: 'reject', error: 'That email is already linked to a different Apple ID.' };
    return { action: 'link', userId: byEmail.id };
  }
  if (email && !verified && byEmail) return { action: 'reject', error: 'Apple didn’t confirm that email, so it wasn’t linked to an existing account.' };
  if (!email) return { action: 'reject', error: 'Apple didn’t send an email. In Settings → Apple ID → Sign in with Apple → Boplo, stop using Apple ID, then try again so the email is shared once more.' };
  return { action: 'create', email };
}

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export async function verifyIdentityToken(token, { keys, audience, now = Date.now() }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) fail(400, 'That Apple sign-in isn’t valid.');
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { fail(400, 'That Apple sign-in isn’t valid.'); }
  if (header.alg !== 'RS256') fail(400, 'That Apple sign-in isn’t valid.');
  const jwk = (keys || []).find(k => k.kid === header.kid && (k.alg === 'RS256' || !k.alg));
  if (!jwk) fail(400, 'That Apple sign-in couldn’t be checked.');
  const key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256' }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) fail(400, 'That Apple sign-in isn’t valid.');
  if (payload.iss !== 'https://appleid.apple.com') fail(400, 'That Apple sign-in isn’t valid.');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) fail(400, 'That Apple sign-in is for a different app.');
  if (!payload.exp || payload.exp * 1000 < now) fail(400, 'That Apple sign-in has expired. Try again.');
  if (!payload.sub) fail(400, 'Apple didn’t send an account id.');
  return payload;
}

export async function fetchAppleKeys(fetcher = fetch) {
  const res = await fetcher('https://appleid.apple.com/auth/keys');
  if (!res.ok) fail(502, 'Apple sign-in couldn’t be checked. Try again shortly.');
  const body = await res.json();
  return body.keys || [];
}

export async function appleSignIn(env, request, { secure, createSession, upsertUser }) {
  await ensureAppleSubject(env);
  const raw = await request.text();
  if (raw.length > 20000) fail(413, 'Request is too large.');
  let input; try { input = JSON.parse(raw); } catch { fail(400, 'Invalid request.'); }
  const keys = await fetchAppleKeys(env.APPLE_KEYS_FETCH || fetch);
  const claims = await verifyIdentityToken(input.identityToken, { keys, audience: env.APPLE_BUNDLE_ID || 'app.boplo.flight' });
  const sub = String(claims.sub);
  const email = claims.email ? String(claims.email).trim().toLowerCase() : '';
  const verified = emailVerified(claims.email_verified);
  const bySub = await env.DB.prepare('SELECT id, email, apple_subject FROM darts_users WHERE apple_subject=?').bind(sub).first();
  const byEmail = email ? await env.DB.prepare('SELECT id, email, apple_subject FROM darts_users WHERE email=?').bind(email).first() : null;
  const decision = decideAppleLink({ bySub, byEmail, sub, email, verified });
  if (decision.action === 'reject') fail(400, decision.error);
  let userId = decision.userId;
  if (decision.action === 'link') {
    const updated = await env.DB.prepare('UPDATE darts_users SET apple_subject=?, updated_at=? WHERE id=? AND (apple_subject IS NULL OR apple_subject=?)').bind(sub, Date.now(), userId, sub).run();
    if (!updated?.meta?.changes && !(await env.DB.prepare('SELECT apple_subject FROM darts_users WHERE id=? AND apple_subject=?').bind(userId, sub).first())) fail(409, 'That email is already linked to a different Apple ID.');
  }
  if (decision.action === 'create') {
    const name = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 80) || email.split('@')[0];
    userId = await upsertUser(env, { email, name });
    const row = await env.DB.prepare('SELECT apple_subject FROM darts_users WHERE id=?').bind(userId).first();
    if (row?.apple_subject && row.apple_subject !== sub) fail(409, 'That email is already linked to a different Apple ID.');
    if (!row?.apple_subject) await env.DB.prepare('UPDATE darts_users SET apple_subject=?, updated_at=? WHERE id=?').bind(sub, Date.now(), userId).run();
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': await createSession(env, userId, secure) } });
}

let columnReady = null;
export function ensureAppleSubject(env) {
  if (!columnReady) columnReady = (async () => {
    const cols = ((await env.DB.prepare('PRAGMA table_info(darts_users)').all()).results || []).map(c => c.name);
    if (!cols.includes('apple_subject')) await env.DB.prepare('ALTER TABLE darts_users ADD COLUMN apple_subject TEXT').run();
    await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS darts_users_apple ON darts_users(apple_subject) WHERE apple_subject IS NOT NULL').run();
  })().catch(e => { columnReady = null; throw e; });
  return columnReady;
}
