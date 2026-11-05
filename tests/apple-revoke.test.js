import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientSecret, revokeApple } from '../functions/lib/apple-revoke.js';

const keyEnv = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
  return { env: { APPLE_SIWA_KEY_ID: 'KEY123', APPLE_SIWA_PRIVATE_KEY: pem, APPLE_TEAM_ID: 'TEAM45', APPLE_BUNDLE_ID: 'app.boplo.flight' }, pub: pair.publicKey };
};
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

test('the client secret is a valid ES256 JWT Apple will accept', async () => {
  const { env, pub } = await keyEnv();
  const jwt = await clientSecret(env, 1000);
  const [h, b, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64url(h))), { alg: 'ES256', kid: 'KEY123' });
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(b)));
  assert.equal(claims.iss, 'TEAM45'); assert.equal(claims.sub, 'app.boplo.flight'); assert.equal(claims.aud, 'https://appleid.apple.com'); assert.equal(claims.exp, 1300);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(sig), new TextEncoder().encode(`${h}.${b}`)), true);
});

test('deleting exchanges the code and revokes the refresh token', async () => {
  const { env } = await keyEnv();
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body) });
    if (url.endsWith('/auth/token')) return new Response(JSON.stringify({ refresh_token: 'r-tok', access_token: 'a-tok' }));
    return new Response('', { status: 200 });
  };
  assert.equal(await revokeApple(env, 'code-1', fake), true);
  assert.equal(calls[0].body.get('code'), 'code-1');
  assert.equal(calls[1].url, 'https://appleid.apple.com/auth/revoke');
  assert.equal(calls[1].body.get('token'), 'r-tok');
  assert.equal(calls[1].body.get('token_type_hint'), 'refresh_token');
});

test('without the key it does nothing rather than failing the deletion', async () => {
  assert.equal(await revokeApple({}, 'code', async () => { throw new Error('should not call'); }), false);
});
