const encoder = new TextEncoder();
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const fail = (status, error) => { const e = new Error(error); e.status = status; throw e; };
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
const cookie = (name, value, maxAge = 0, secure = true) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; ${maxAge ? `Max-Age=${maxAge}; ` : 'Max-Age=0; '}${secure ? 'Secure;' : ''}`;
const token = () => crypto.randomUUID() + crypto.randomUUID();

function body(request) { return request.text().then(raw => { if (raw.length > 8000) fail(413, 'Request is too large.'); try { return JSON.parse(raw); } catch { fail(400, 'Invalid request.'); } }); }
function cleanEmail(value) { const email = String(value || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, 'Enter a valid email address.'); return email; }
function cleanNumber(value, label) { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 180) fail(400, `Enter a valid ${label}.`); return n; }
function recommendation(rows) {
  const avg = key => rows.length ? rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length : 0;
  const doubles = avg('doubles_rate'), checkouts = avg('checkout_rate'), scoring = avg('three_dart_average');
  if (rows.length < 2) return { key: 'baseline', tag: 'FOUNDATION', name: 'Build a baseline', why: 'Log two more honest sessions and Boplo can compare the parts of your game properly.', task: 'Play 3 sets of 10 visits at T20 and record the average.', goal: 'Create a useful starting point.' };
  if (doubles < 35) return { key: 'd16', tag: 'DOUBLES FIRST', name: 'Own D16', why: `Your doubles are at ${doubles.toFixed(0)}%. That is the clearest place to win more legs.`, task: 'Throw 3 darts at D16 × 10. Restart after three misses.', goal: 'Land 12+ doubles before moving on.' };
  if (checkouts < 30) return { key: 'checkout-ladder', tag: 'FINISH BETTER', name: 'Checkout ladder', why: `Your checkout rate is ${checkouts.toFixed(0)}%. You are reaching finishes more often than you are closing them.`, task: 'Start on 40: hit D20, then D10, then D5. Step back after a miss.', goal: 'Complete the ladder twice.' };
  if (scoring < 48) return { key: 't20-grouping', tag: 'SCORING BASE', name: 'T20 grouping', why: `Your doubles are moving. Your ${scoring.toFixed(1)} average is the most useful next lever.`, task: 'Throw 10 visits at T20. Judge the group only after all three darts.', goal: 'Reach 150 across three visits.' };
  return { key: 'pressure-41', tag: 'MATCH READY', name: 'Pressure finish', why: 'Your core numbers are balanced. The next gain is making your normal standard show up under pressure.', task: 'Play five 41 finishes. Three darts each. Restart after two misses.', goal: 'Close three of five legs.' };
}

async function userFromRequest(request, env) {
  const raw = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)boplo_darts=([^;]+)/)?.[1];
  if (!raw) return null;
  const row = await env.DB.prepare(`SELECT u.id,u.email,u.display_name FROM darts_sessions s JOIN darts_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await hash(raw), Date.now()).first();
  return row || null;
}
async function createSession(env, userId, secure) {
  const raw = token(), expires = Date.now() + 30 * 86400000;
  await env.DB.prepare('INSERT INTO darts_sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), userId, await hash(raw), expires, Date.now()).run();
  return cookie('boplo_darts', raw, 30 * 86400000, secure);
}
async function upsertUser(env, { email, name = null, googleSubject = null }) {
  const existing = await env.DB.prepare('SELECT id FROM darts_users WHERE email=? OR google_subject=?').bind(email, googleSubject).first();
  const now = Date.now();
  if (existing) { await env.DB.prepare('UPDATE darts_users SET email=?,display_name=COALESCE(?,display_name),google_subject=COALESCE(?,google_subject),updated_at=? WHERE id=?').bind(email, name, googleSubject, now, existing.id).run(); return existing.id; }
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO darts_users(id,email,display_name,google_subject,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, email, name, googleSubject, now, now).run(); return id;
}
async function dashboard(env, user) {
  const sessions = await env.DB.prepare('SELECT id,session_type AS type,three_dart_average AS average,doubles_rate AS doubles,checkout_rate AS checkout,note,created_at FROM darts_practice_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all();
  const drills = await env.DB.prepare('SELECT drill_key,completed_at FROM darts_drill_completions WHERE user_id=? ORDER BY completed_at DESC LIMIT 100').bind(user.id).all();
  const rows = sessions.results || [];
  return { user, sessions: rows, drills: drills.results || [], recommendation: recommendation(rows) };
}

export async function onRequest(context) {
  const { request, env } = context, url = new URL(request.url), path = url.pathname.replace(/^\/darts\/?/, '');
  try {
    if (!env.DB) fail(503, 'Boplo is still connecting its player database.');
    const secure = url.protocol === 'https:';
    if (path === 'auth/email' && request.method === 'POST') {
      if (!env.RESEND_API_KEY || !env.EMAIL_FROM) fail(503, 'Email sign-in is not configured yet.');
      const email = cleanEmail((await body(request)).email), raw = token(), expires = Date.now() + 15 * 60000;
      await env.DB.prepare('DELETE FROM darts_magic_links WHERE email=? OR expires_at<?').bind(email, Date.now()).run();
      await env.DB.prepare('INSERT INTO darts_magic_links(token_hash,email,expires_at,created_at) VALUES(?,?,?,?)').bind(await hash(raw), email, expires, Date.now()).run();
      const link = `${env.APP_ORIGIN || url.origin}/darts/auth/verify?token=${encodeURIComponent(raw)}`;
      const send = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: 'Sign in to Boplo', html: `<p>Your Boplo sign-in link is ready.</p><p><a href="${link}">Open Boplo</a></p><p>This link expires in 15 minutes.</p>` }) });
      if (!send.ok) fail(502, 'We could not send that email. Try again shortly.');
      return json({ ok: true });
    }
    if (path === 'auth/verify' && request.method === 'GET') {
      const raw = url.searchParams.get('token') || '', row = await env.DB.prepare('SELECT email,expires_at,used_at FROM darts_magic_links WHERE token_hash=?').bind(await hash(raw)).first();
      if (!row || row.used_at || row.expires_at < Date.now()) return new Response('This sign-in link has expired. Return to Boplo and request another.', { status: 400 });
      await env.DB.prepare('UPDATE darts_magic_links SET used_at=? WHERE token_hash=?').bind(Date.now(), await hash(raw)).run();
      const userId = await upsertUser(env, { email: row.email, name: row.email.split('@')[0] });
      return new Response(null, { status: 302, headers: { Location: `${env.APP_ORIGIN || url.origin}/#dashboard`, 'Set-Cookie': await createSession(env, userId, secure) } });
    }
    if (path === 'auth/google' && request.method === 'GET') {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) fail(503, 'Google sign-in is not configured yet.');
      const state = token(); await env.DB.prepare('INSERT INTO darts_oauth_states(state_hash,expires_at,created_at) VALUES(?,?,?)').bind(await hash(state), Date.now() + 10 * 60000, Date.now()).run();
      const redirect = `${env.APP_ORIGIN || url.origin}/darts/auth/google/callback`, q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, 302);
    }
    if (path === 'auth/google/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '', stateRow = await env.DB.prepare('SELECT expires_at FROM darts_oauth_states WHERE state_hash=?').bind(await hash(state)).first();
      if (!stateRow || stateRow.expires_at < Date.now() || !code) fail(400, 'Google sign-in expired. Please try again.');
      await env.DB.prepare('DELETE FROM darts_oauth_states WHERE state_hash=?').bind(await hash(state)).run();
      const redirect = `${env.APP_ORIGIN || url.origin}/darts/auth/google/callback`;
      const exchange = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }) });
      if (!exchange.ok) fail(502, 'Google sign-in could not be completed.');
      const access = (await exchange.json()).access_token, profile = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access}` } })).json();
      if (!profile.email_verified || !profile.sub) fail(400, 'Google did not return a verified email address.');
      const userId = await upsertUser(env, { email: cleanEmail(profile.email), name: profile.name || null, googleSubject: profile.sub });
      return new Response(null, { status: 302, headers: { Location: `${env.APP_ORIGIN || url.origin}/#dashboard`, 'Set-Cookie': await createSession(env, userId, secure) } });
    }
    if (path === 'auth/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('boplo_darts', '', 0, secure) });
    const user = await userFromRequest(request, env);
    if (path === 'me' && request.method === 'GET') return json({ user });
    if (!user) fail(401, 'Sign in to save your practice across devices.');
    if (path === 'dashboard' && request.method === 'GET') return json(await dashboard(env, user));
    if (path === 'sessions' && request.method === 'GET') return json((await dashboard(env, user)).sessions);
    if (path === 'sessions' && request.method === 'POST') {
      const input = await body(request), type = String(input.type || '').slice(0, 60), average = cleanNumber(input.average, 'three-dart average'), doubles = cleanNumber(input.doubles, 'double rate'), checkout = cleanNumber(input.checkout, 'checkout rate'), note = String(input.note || '').slice(0, 160);
      if (!type) fail(400, 'Choose a session type.'); if (doubles > 100 || checkout > 100) fail(400, 'Rates must be between 0 and 100.');
      await env.DB.prepare('INSERT INTO darts_practice_sessions(id,user_id,session_type,three_dart_average,doubles_rate,checkout_rate,note,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), user.id, type, average, doubles, checkout, note || null, Date.now()).run();
      return json(await dashboard(env, user), 201);
    }
    if (path === 'drills/complete' && request.method === 'POST') { const key = String((await body(request)).key || '').slice(0, 60); if (!key) fail(400, 'Invalid drill.'); await env.DB.prepare('INSERT INTO darts_drill_completions(id,user_id,drill_key,completed_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(), user.id, key, Date.now()).run(); return json(await dashboard(env, user), 201); }
    fail(404, 'Not found.');
  } catch (error) { return json({ error: error.status ? error.message : 'Boplo is temporarily unavailable. Please try again.' }, error.status || 500); }
}
