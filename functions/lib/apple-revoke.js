// Sign in with Apple: revoke the user's Apple tokens when they delete their account (required by
// App Store guideline 5.1.1(v)). The app hands over a fresh authorization code; we exchange it for a
// token and revoke it. Needs APPLE_SIWA_KEY_ID and APPLE_SIWA_PRIVATE_KEY (the .p8 from a "Sign in
// with Apple" key) plus APPLE_TEAM_ID and APPLE_BUNDLE_ID.
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = text => b64url(new TextEncoder().encode(text));

export async function clientSecret(env, now = Math.floor(Date.now() / 1000)) {
  const pem = String(env.APPLE_SIWA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64urlText(JSON.stringify({ alg: 'ES256', kid: env.APPLE_SIWA_KEY_ID }));
  const body = b64urlText(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: env.APPLE_BUNDLE_ID || 'app.boplo.flight' }));
  // WebCrypto's ECDSA signature is already the raw r||s form that JWS ES256 uses
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

export const revokeConfigured = env => !!(env.APPLE_SIWA_KEY_ID && env.APPLE_SIWA_PRIVATE_KEY && env.APPLE_TEAM_ID);

/** Exchanges the authorization code and revokes the result. Returns true when Apple confirmed. */
export async function revokeApple(env, code, fetcher = fetch) {
  if (!code || !revokeConfigured(env)) return false;
  const client_id = env.APPLE_BUNDLE_ID || 'app.boplo.flight', client_secret = await clientSecret(env);
  const form = o => new URLSearchParams(o).toString();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const t = await fetcher('https://appleid.apple.com/auth/token', { method: 'POST', headers, body: form({ client_id, client_secret, code, grant_type: 'authorization_code' }) });
  const tokens = await t.json().catch(() => ({}));
  if (!t.ok || !(tokens.refresh_token || tokens.access_token)) { console.error('Apple token exchange failed', t.status, tokens.error || ''); return false; }
  const [token, hint] = tokens.refresh_token ? [tokens.refresh_token, 'refresh_token'] : [tokens.access_token, 'access_token'];
  const r = await fetcher('https://appleid.apple.com/auth/revoke', { method: 'POST', headers, body: form({ client_id, client_secret, token, token_type_hint: hint }) });
  if (!r.ok) console.error('Apple revoke failed', r.status);
  return r.ok;
}
