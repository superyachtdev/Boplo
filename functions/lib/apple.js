// App Store purchases for Boplo Flight Advanced.
// The account on our server is what unlocks Advanced, on the website and in the app.
// A Stripe subscription and an App Store subscription both count. Secrets stay in Cloudflare:
//   APPLE_ROOT is embedded below (public). Receipt checks need the Pages compatibility flag nodejs_compat.
//   APPLE_IAP_ALLOW_TEST_ROOT=1 and APPLE_ROOT_PEM are for tests only. Do not set them in production.

export const BUNDLE_ID = 'app.boplo.flight';
export const PRODUCTS = {
  'app.boplo.flight.advanced.yearly': { interval: 'yearly', amount: 9999, currency: 'usd' },
  'app.boplo.flight.advanced.monthly': { interval: 'monthly', amount: 1199, currency: 'usd' }
};
// Apple Root CA - G3. Public certificate. Fingerprint checked before it is trusted.
const APPLE_ROOT_FINGERPRINT = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';
export const APPLE_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const ACTIVE = new Set(['active', 'grace']);

export function appleGrants(row, now = Date.now()) {
  if (!row || !ACTIVE.has(row.status)) return false;
  const exp = Number(row.expires_at);
  if (Number.isFinite(exp) && exp > 0 && exp <= now) return false;
  return true;
}

// Stripe, a school seat, an owner, or an App Store subscription. Any one of them is Advanced.
export function accountPlan(env, row, apple, now = Date.now(), effectivePlan) {
  if (effectivePlan(env, row) === 'advanced') return 'advanced';
  return appleGrants(apple, now) ? 'advanced' : 'free';
}

export function storeOf(row, apple, now = Date.now()) {
  if (row?.owner) return 'owner';
  const stripeOn = !!row && ['active', 'trialing', 'past_due'].includes(row.status);
  const appleOn = appleGrants(apple, now);
  if (row?.school && !stripeOn && !appleOn) return 'school';
  if (appleOn && !stripeOn) return 'apple';
  if (stripeOn) return 'stripe';
  return null;
}

export function publicApple(row) {
  if (!row) return null;
  return {
    status: row.status || 'none',
    interval: row.interval || row.interval_key || null,
    expiresAt: row.expires_at || null,
    productId: row.product_id || null,
    willRenew: row.will_renew !== 0 && row.will_renew !== false
  };
}

// Which Boplo account may hold this App Store subscription.
export function claimDecision(existingUserId, currentUserId) {
  if (!currentUserId) return { ok: false, error: 'Sign in before restoring purchases.' };
  if (existingUserId && existingUserId !== currentUserId) return { ok: false, error: 'This App Store subscription is already on another Boplo account.' };
  return { ok: true };
}

export function readTransaction(payload, now = Date.now()) {
  const productId = String(payload?.productId || '');
  const product = PRODUCTS[productId] || null;
  const expires = Number(payload?.expiresDate || 0);
  const revoked = !!payload?.revocationDate;
  const bundleId = String(payload?.bundleId || '');
  if (bundleId && bundleId !== BUNDLE_ID) return { ok: false, error: 'That receipt is for a different app.' };
  if (!payload?.originalTransactionId) return { ok: false, error: 'That receipt has no subscription.' };
  if (!product) return { ok: false, error: 'That App Store product isn’t Boplo Flight Advanced.' };
  let status = 'expired';
  if (revoked) status = 'revoked';
  else if (expires > now) status = 'active';
  return {
    ok: true,
    originalTransactionId: String(payload.originalTransactionId),
    transactionId: String(payload.transactionId || ''),
    productId,
    interval: product.interval,
    expires,
    status,
    environment: String(payload.environment || ''),
    bundleId: bundleId || BUNDLE_ID
  };
}

// Server Notifications V2. Access follows the expiry, not the notification name alone.
export function statusFromNotification(type, subtype, transaction, renewal, now = Date.now()) {
  const base = readTransaction({ ...transaction, revocationDate: transaction.revocationDate || (type === 'REVOKE' || type === 'REFUND' ? now : 0) }, now);
  if (!base.ok) return base;
  let status = base.status;
  if (type === 'REVOKE' || type === 'REFUND') status = 'revoked';
  else if (type === 'EXPIRED' || type === 'GRACE_PERIOD_EXPIRED') status = 'expired';
  else if (type === 'DID_FAIL_TO_RENEW' && subtype === 'GRACE_PERIOD') status = 'grace';
  else if (['SUBSCRIBED', 'DID_RENEW', 'DID_RECOVER', 'OFFER_REDEEMED', 'RENEWAL_EXTENDED', 'DID_CHANGE_RENEWAL_PREF'].includes(type)) status = base.expires > now ? 'active' : 'expired';
  const willRenew = renewal && renewal.autoRenewStatus != null ? Number(renewal.autoRenewStatus) === 1 : subtype !== 'AUTO_RENEW_DISABLED';
  return { ...base, status, willRenew: status === 'revoked' || status === 'expired' ? false : willRenew };
}

let schemaReady = null;
export function ensureAppleSchema(env) {
  if (!schemaReady) schemaReady = (async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS flight_apple (
      original_transaction_id TEXT PRIMARY KEY,
      user_id TEXT,
      product_id TEXT,
      status TEXT NOT NULL DEFAULT 'none',
      interval_key TEXT,
      expires_at INTEGER,
      environment TEXT,
      will_renew INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    )`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS flight_apple_user ON flight_apple(user_id)').run();
  })().catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

const mapRow = row => row ? { ...row, interval: row.interval_key } : null;

export async function appleForUser(env, userId, now = Date.now()) {
  await ensureAppleSchema(env);
  const rows = ((await env.DB.prepare('SELECT * FROM flight_apple WHERE user_id=?').bind(userId).all()).results || []).map(mapRow);
  return rows.find(r => appleGrants(r, now)) || rows.sort((a, b) => (b.expires_at || 0) - (a.expires_at || 0))[0] || null;
}

async function saveApple(env, row) {
  await ensureAppleSchema(env);
  await env.DB.prepare(`INSERT INTO flight_apple(original_transaction_id,user_id,product_id,status,interval_key,expires_at,environment,will_renew,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(original_transaction_id) DO UPDATE SET
      user_id=excluded.user_id, product_id=excluded.product_id, status=excluded.status, interval_key=excluded.interval_key,
      expires_at=excluded.expires_at, environment=excluded.environment, will_renew=excluded.will_renew, updated_at=excluded.updated_at`)
    .bind(row.originalTransactionId, row.userId, row.productId, row.status, row.interval, row.expires || null, row.environment || null, row.willRenew === false ? 0 : 1, Date.now()).run();
}

export async function claimTransactions(env, userId, signedList, now = Date.now()) {
  await ensureAppleSchema(env);
  const list = (Array.isArray(signedList) ? signedList : [signedList]).map(s => String(s || '')).filter(Boolean).slice(0, 20);
  if (!list.length) fail(400, 'There is no App Store receipt to restore.');
  let last = null;
  for (const signed of list) {
    const payload = await verifyAppleJws(env, signed);
    const tx = readTransaction(payload, now);
    if (!tx.ok) fail(400, tx.error);
    const existing = mapRow(await env.DB.prepare('SELECT * FROM flight_apple WHERE original_transaction_id=?').bind(tx.originalTransactionId).first());
    const claim = claimDecision(existing?.user_id || null, userId);
    if (!claim.ok) fail(409, claim.error);
    await saveApple(env, { ...tx, userId, willRenew: existing ? existing.will_renew !== 0 : true });
    last = tx;
  }
  return last;
}

export async function applyNotification(env, body, now = Date.now()) {
  const outer = await verifyAppleJws(env, body?.signedPayload || body);
  const data = outer.data || {};
  if (data.bundleId && data.bundleId !== BUNDLE_ID) fail(400, 'Notification is for a different app.');
  await ensureAppleSchema(env);
  if (!data.signedTransactionInfo) return { ok: true, ignored: true };
  const transaction = await verifyAppleJws(env, data.signedTransactionInfo);
  const renewal = data.signedRenewalInfo ? await verifyAppleJws(env, data.signedRenewalInfo) : null;
  const next = statusFromNotification(outer.notificationType, outer.subtype, transaction, renewal, now);
  if (!next.ok) return { ok: true, ignored: true };
  await ensureAppleSchema(env);
  const existing = mapRow(await env.DB.prepare('SELECT * FROM flight_apple WHERE original_transaction_id=?').bind(next.originalTransactionId).first());
  await saveApple(env, { ...next, userId: existing?.user_id || null, willRenew: next.willRenew });
  return { ok: true, originalTransactionId: next.originalTransactionId, status: next.status, userId: existing?.user_id || null };
}

export function rootPem(env) {
  if (env?.APPLE_IAP_ALLOW_TEST_ROOT === '1' && env.APPLE_ROOT_PEM) return env.APPLE_ROOT_PEM;
  return APPLE_ROOT_PEM;
}

export async function verifyAppleJws(env, jws) {
  const crypto = await import('node:crypto').catch(() => null);
  if (!crypto?.X509Certificate) fail(503, 'App Store receipt checks need the nodejs_compat flag on Cloudflare Pages.');
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) fail(400, 'That App Store receipt isn’t valid.');
  let header;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { fail(400, 'That App Store receipt isn’t valid.'); }
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length < 2) fail(400, 'That App Store receipt isn’t valid.');
  const certs = header.x5c.map(c => new crypto.X509Certificate(Buffer.from(c, 'base64')));
  const root = new crypto.X509Certificate(rootPem(env));
  const pinned = root.fingerprint256.replace(/:/g, '').toLowerCase();
  if (env?.APPLE_IAP_ALLOW_TEST_ROOT !== '1' && pinned !== APPLE_ROOT_FINGERPRINT) fail(500, 'The App Store root certificate doesn’t match.');
  const now = new Date();
  let signer = root;
  for (let i = certs.length - 1; i >= 0; i--) {
    const cert = certs[i];
    if (cert.fingerprint256 === signer.fingerprint256) continue;
    if (!cert.verify(signer.publicKey)) fail(400, 'That App Store receipt isn’t signed by Apple.');
    if (new Date(cert.validFrom) > now || new Date(cert.validTo) < now) fail(400, 'That App Store receipt uses an expired certificate.');
    signer = cert;
  }
  const leaf = certs[0];
  const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
  if (!ok) fail(400, 'That App Store receipt isn’t valid.');
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { fail(400, 'That App Store receipt isn’t valid.'); }
}
