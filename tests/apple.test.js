import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate, createSign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { accountPlan, appleGrants, claimDecision, readTransaction, statusFromNotification, verifyAppleJws, claimTransactions, PRODUCTS } from '../functions/lib/apple.js';
import { effectivePlan, publicBilling } from '../functions/lib/billing.js';
import { decideAppleLink, emailVerified, verifyIdentityToken } from '../functions/lib/apple-auth.js';
import { onRequest } from '../functions/flight/[[path]].js';

const envOn = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' };
const plan = (row, apple, now) => accountPlan(envOn, row, apple, now, effectivePlan);

test('entitlement is advanced from Stripe or Apple, and either one is enough', () => {
  const now = 1_000_000;
  assert.equal(plan(null, null, now), 'free');
  assert.equal(plan({ status: 'active', price_key: 'yearly' }, null, now), 'advanced');
  assert.equal(plan({ status: 'none' }, { status: 'active', expires_at: now + 1000 }, now), 'advanced');
  assert.equal(plan({ status: 'canceled' }, { status: 'active', expires_at: now + 1000 }, now), 'advanced');
  assert.equal(plan({ status: 'active' }, { status: 'expired', expires_at: now - 1 }, now), 'advanced');
  assert.equal(plan({ status: 'none' }, { status: 'expired', expires_at: now - 1 }, now), 'free');
  assert.equal(plan({ status: 'none' }, { status: 'grace', expires_at: now + 1000 }, now), 'advanced');
  assert.equal(plan({ status: 'none' }, { status: 'revoked', expires_at: now + 1000 }, now), 'free');
  assert.equal(appleGrants({ status: 'active', expires_at: now }, now), false);
  assert.equal(plan({ owner: true }, null, now), 'advanced');
  assert.equal(plan({ school: { name: 'Sky' } }, null, now), 'advanced');
  const shown = publicBilling(envOn, { status: 'none' }, { status: 'active', expires_at: now + 5000, interval: 'yearly', product_id: 'app.boplo.flight.advanced.yearly', will_renew: 1 }, now);
  assert.equal(shown.plan, 'advanced');
  assert.equal(shown.store, 'apple');
  assert.equal(shown.interval, 'yearly');
  assert.equal(publicBilling(envOn, { status: 'active', price_key: 'monthly' }, { status: 'active', expires_at: now + 1, interval: 'yearly' }, now).store, 'stripe');
  assert.equal(publicBilling({}, null).plan, 'advanced');
});

test('an App Store subscription cannot move onto a second Boplo account', () => {
  assert.deepEqual(claimDecision(null, 'u1'), { ok: true });
  assert.deepEqual(claimDecision('u1', 'u1'), { ok: true });
  assert.equal(claimDecision('u1', 'u2').ok, false);
  const tx = readTransaction({ bundleId: 'app.boplo.flight', productId: 'app.boplo.flight.advanced.yearly', originalTransactionId: '9', expiresDate: Date.now() + 1000 });
  assert.equal(tx.ok, true);
  assert.equal(tx.interval, 'yearly');
  assert.equal(tx.status, 'active');
  assert.equal(readTransaction({ bundleId: 'other.app', productId: 'app.boplo.flight.advanced.monthly', originalTransactionId: '9', expiresDate: 1 }).ok, false);
  assert.equal(readTransaction({ bundleId: 'app.boplo.flight', productId: 'unknown', originalTransactionId: '9', expiresDate: 1 }).ok, false);
  assert.equal(PRODUCTS['app.boplo.flight.advanced.monthly'].amount, 1199);
  assert.equal(PRODUCTS['app.boplo.flight.advanced.yearly'].amount, 9999);
});

test('renewals, grace and refunds change access the way the notification says', () => {
  const now = 5_000;
  const live = { bundleId: 'app.boplo.flight', productId: 'app.boplo.flight.advanced.monthly', originalTransactionId: '1', expiresDate: now + 1000 };
  assert.equal(statusFromNotification('DID_RENEW', '', live, { autoRenewStatus: 1 }, now).status, 'active');
  assert.equal(statusFromNotification('DID_FAIL_TO_RENEW', 'GRACE_PERIOD', live, null, now).status, 'grace');
  assert.equal(statusFromNotification('EXPIRED', '', live, null, now).status, 'expired');
  assert.equal(statusFromNotification('REFUND', '', live, null, now).status, 'revoked');
  const stopped = statusFromNotification('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_DISABLED', live, { autoRenewStatus: 0 }, now);
  assert.equal(stopped.status, 'active');
  assert.equal(stopped.willRenew, false);
});

test('Sign in with Apple links a verified email and refuses a different Apple ID', () => {
  const sub = { id: 'u1', apple_subject: 'apple-1' };
  const emailUser = { id: 'u2', apple_subject: null };
  assert.equal(decideAppleLink({ bySub: sub, sub: 'apple-1' }).action, 'login');
  assert.equal(decideAppleLink({ byEmail: emailUser, sub: 'apple-9', email: 'a@b.c', verified: true }).action, 'link');
  assert.equal(decideAppleLink({ byEmail: { id: 'u2', apple_subject: 'other' }, sub: 'apple-9', email: 'a@b.c', verified: true }).action, 'reject');
  assert.equal(decideAppleLink({ byEmail: emailUser, sub: 'apple-9', email: 'a@b.c', verified: false }).action, 'reject');
  assert.equal(decideAppleLink({ sub: 'apple-9', email: 'relay@privaterelay.appleid.com', verified: true }).action, 'create');
  assert.equal(decideAppleLink({ sub: 'apple-9' }).action, 'reject');
  assert.equal(emailVerified('true'), true);
  assert.equal(emailVerified(false), false);
});

function testChain() {
  const dir = mkdtempSync(join(tmpdir(), 'boplo-ca-'));
  const run = (args, input) => execFileSync('openssl', args, { cwd: dir, input, stdio: ['pipe', 'pipe', 'pipe'] });
  run(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key']);
  run(['req', '-new', '-x509', '-key', 'root.key', '-out', 'root.pem', '-days', '365', '-subj', '/CN=Boplo Test Root']);
  run(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'mid.key']);
  run(['req', '-new', '-key', 'mid.key', '-out', 'mid.csr', '-subj', '/CN=Boplo Test Intermediate']);
  run(['x509', '-req', '-in', 'mid.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'mid.pem', '-days', '365']);
  run(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key']);
  run(['req', '-new', '-key', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=Boplo Test Leaf']);
  run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'mid.pem', '-CAkey', 'mid.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '365']);
  return {
    root: readFileSync(join(dir, 'root.pem'), 'utf8'),
    mid: new X509Certificate(readFileSync(join(dir, 'mid.pem'))),
    leaf: new X509Certificate(readFileSync(join(dir, 'leaf.pem'))),
    leafKey: readFileSync(join(dir, 'leaf.key'))
  };
}

function signJws(chain, payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', x5c: [chain.leaf.raw.toString('base64'), chain.mid.raw.toString('base64')] })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createSign('SHA256').update(`${header}.${body}`).sign({ key: chain.leafKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${header}.${body}.${sig}`;
}

test('a signed App Store receipt unlocks the account, and a second account cannot take it', async () => {
  const chain = testChain();
  const now = Date.now();
  const env = { ...envOn, APPLE_IAP_ALLOW_TEST_ROOT: '1', APPLE_ROOT_PEM: chain.root };
  const payload = await verifyAppleJws(env, signJws(chain, { bundleId: 'app.boplo.flight', productId: 'app.boplo.flight.advanced.yearly', originalTransactionId: 'orig-1', transactionId: 't-1', expiresDate: now + 86_400_000 }));
  assert.equal(payload.originalTransactionId, 'orig-1');
  await assert.rejects(() => verifyAppleJws(env, signJws(chain, { bundleId: 'app.boplo.flight' }) + 'x'), /isn’t valid|isn’t signed/);

  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE darts_users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE darts_sessions (id TEXT, user_id TEXT, token_hash TEXT, expires_at INTEGER, created_at INTEGER);
    INSERT INTO darts_users VALUES ('u1','a@b.c','A',0,0),('u2','c@d.e','C',0,0);`);
  const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
  db.prepare('INSERT INTO darts_sessions VALUES (?,?,?,?,?)').run('s', 'u1', await hash('tok'), now + 60_000, now);
  const DB = { prepare(sql) { let args = []; return { bind(...a) { args = a; return this; }, async first() { return db.prepare(sql).get(...args) || null; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async run() { return db.prepare(sql).run(...args); } }; } };
  const flightEnv = { ...env, DB };
  const call = (user, body) => onRequest({ env: flightEnv, request: new Request('https://boplo.app/flight/billing/apple', { method: 'POST', headers: { Cookie: `boplo_session=${user}`, Origin: 'https://boplo.app', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  db.prepare('INSERT INTO darts_sessions VALUES (?,?,?,?,?)').run('s2', 'u2', await hash('tok2'), now + 60_000, now);
  const signed = signJws(chain, { bundleId: 'app.boplo.flight', productId: 'app.boplo.flight.advanced.yearly', originalTransactionId: 'orig-1', transactionId: 't-1', expiresDate: now + 86_400_000 });
  const first = await call('tok', { signedTransaction: signed });
  const bought = await first.json();
  assert.equal(first.status, 200);
  assert.equal(bought.plan, 'advanced');
  assert.equal(bought.store, 'apple');
  const second = await call('tok2', { signedTransaction: signed });
  assert.equal(second.status, 409);
  const again = await onRequest({ env: flightEnv, request: new Request('https://boplo.app/flight/billing', { headers: { Cookie: 'boplo_session=tok', Origin: 'https://boplo.app' } }) });
  assert.equal((await again.json()).plan, 'advanced');
  assert.equal(await claimTransactions(flightEnv, 'u1', [signed], now).then(r => r.originalTransactionId), 'orig-1');
});

test('an Apple identity token is accepted only for this app and this key', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  jwk.kid = 'test-key'; jwk.alg = 'RS256';
  const exp = Math.floor(Date.now() / 1000) + 600;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'https://appleid.apple.com', aud: 'app.boplo.flight', sub: 'apple-1', email: 'pilot@boplo.app', email_verified: 'true', exp })).toString('base64url');
  const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${body}`))).toString('base64url');
  const claims = await verifyIdentityToken(`${header}.${body}.${sig}`, { keys: [jwk], audience: 'app.boplo.flight' });
  assert.equal(claims.sub, 'apple-1');
  await assert.rejects(() => verifyIdentityToken(`${header}.${body}.${sig}`, { keys: [jwk], audience: 'other.app' }), /different app/);
});
