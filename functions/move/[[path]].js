const encoder = new TextEncoder();
const MOVE_PRICE = 899;
const MOVE_CURRENCY = 'gbp';
const MOVE_ACCESS_MS = 90 * 86400000;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers } });
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const id = () => crypto.randomUUID();
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && ![...a].reduce((sum, char, index) => sum | (char.charCodeAt(0) ^ b.charCodeAt(index)), 0);

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function cleanText(value, label, max, required = true) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (required && !text) fail(400, `Enter ${label}.`);
  if (text.length > max) fail(400, `${label} is too long.`);
  return text;
}
function cleanCurrency(value) {
  const currency = String(value || 'GBP').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail(400, 'Choose a three-letter currency code.');
  return currency;
}
function cleanMoney(value, label, max = 10000000) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount < 0 || amount > max) fail(400, `Enter a valid ${label}.`);
  return amount;
}
function cleanDeposit(value) {
  const months = Number(value);
  if (!Number.isFinite(months) || months < 0 || months > 12) fail(400, 'Enter a deposit between 0 and 12 months.');
  return Math.round(months * 100) / 100;
}
function cleanPriorities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanText(item, 'a priority', 40, false)).filter(Boolean))].slice(0, 8);
}
function parseBody(request, max = 12000) {
  return request.text().then(raw => {
    if (raw.length > max) fail(413, 'Request is too large.');
    try { return JSON.parse(raw); } catch { fail(400, 'Expected JSON.'); }
  });
}
async function userFromRequest(request, env) {
  const token = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)boplo_session=([^;]+)/)?.[1] || '';
  if (!token) return null;
  return env.DB.prepare('SELECT u.id,u.email,u.display_name FROM darts_sessions s JOIN darts_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token), Date.now()).first();
}
async function rateLimit(env, key, max, period = 3600000) {
  const bucket = Math.floor(Date.now() / period);
  const result = await env.DB.prepare('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(`${key}:${bucket}`, (bucket + 1) * period).first();
  if (Number(result.count) > max) fail(429, 'Too many requests. Please try again shortly.');
}
async function entitlement(env, userId) {
  const row = await env.DB.prepare('SELECT plan,status,active_until FROM boplo_move_entitlements WHERE user_id=?').bind(userId).first();
  const active = row?.plan === 'move_plan' && row.status === 'active' && Number(row.active_until || 0) > Date.now();
  return { plan: active ? 'move_plan' : 'free', activeUntil: active ? Number(row.active_until) : null };
}
async function requireMovePlan(env, userId) {
  const access = await entitlement(env, userId);
  if (access.plan !== 'move_plan') fail(402, 'The Move Calculator is included with a Boplo Move Plan. Unlock your plan to save and use calculations.');
  return access;
}

export function calculateMoveBudget(input) {
  const destination = cleanText(input.destination, 'your destination', 100);
  const currency = cleanCurrency(input.currency);
  const monthlyRent = cleanMoney(input.monthlyRent, 'monthly rent');
  const depositMonths = cleanDeposit(input.depositMonths);
  const monthlyLiving = cleanMoney(input.monthlyLiving, 'monthly living costs');
  const travelAndSetup = cleanMoney(input.travelAndSetup, 'travel and setup costs');
  const emergencyBuffer = cleanMoney(input.emergencyBuffer, 'emergency buffer');
  const savings = cleanMoney(input.savings, 'current savings');
  const deposit = Math.round(monthlyRent * depositMonths);
  const firstMonthTotal = monthlyRent + deposit + monthlyLiving + travelAndSetup + emergencyBuffer;
  const threeMonthTotal = firstMonthTotal + (monthlyRent + monthlyLiving) * 2;
  return { destination, currency, monthlyRent, depositMonths, monthlyLiving, travelAndSetup, emergencyBuffer, savings, deposit, firstMonthTotal, threeMonthTotal, remainingAfterFirstMonth: savings - firstMonthTotal, gapToFirstMonth: Math.max(0, firstMonthTotal - savings) };
}
function formatCalculation(row) { return { ...row, deposit_months: Number(row.deposit_months), monthly_rent: Number(row.monthly_rent), monthly_living: Number(row.monthly_living), travel_and_setup: Number(row.travel_and_setup), emergency_buffer: Number(row.emergency_buffer), savings: Number(row.savings), first_month_total: Number(row.first_month_total), three_month_total: Number(row.three_month_total), remaining_after_first_month: Number(row.remaining_after_first_month) }; }

async function stripe(env, path, params, idempotencyKey) {
  if (!env.STRIPE_SECRET_KEY) fail(503, 'Checkout is not connected yet.');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: params ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: params ? new URLSearchParams(params) : undefined, signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail(502, 'Payment service is unavailable. Please try again.');
  return response.json();
}
function paidSession(session, order) { return session?.status === 'complete' && session.payment_status === 'paid' && session.amount_total === MOVE_PRICE && session.currency === MOVE_CURRENCY && session.metadata?.boplo_product === 'move_plan' && session.metadata?.order_id === order.id && session.metadata?.user_id === order.user_id && (!order.stripe_session_id || order.stripe_session_id === session.id); }
async function grantMovePlan(env, session) {
  const order = await env.DB.prepare('SELECT * FROM boplo_move_orders WHERE id=?').bind(session.metadata?.order_id || '').first();
  if (!order || !paidSession(session, order)) fail(400, 'Payment does not match this Boplo Move Plan.');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE boplo_move_orders SET status='paid',stripe_session_id=?,stripe_payment_intent=?,paid_at=? WHERE id=? AND status IN ('pending','paid')").bind(session.id, typeof session.payment_intent === 'string' ? session.payment_intent : null, now, order.id),
    env.DB.prepare("INSERT INTO boplo_move_entitlements(user_id,plan,status,order_id,active_until,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET plan='move_plan',status='active',order_id=excluded.order_id,active_until=excluded.active_until,updated_at=excluded.updated_at").bind(order.user_id, 'move_plan', 'active', order.id, now + MOVE_ACCESS_MS, now)
  ]);
  return { plan: 'move_plan', activeUntil: now + MOVE_ACCESS_MS };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/move\/?/, '');
  const respond = (data, status = 200) => json(data, status);
  try {
    if (!env.DB) fail(503, 'Boplo is still connecting its move database.');
    if (path === 'webhook' && request.method === 'POST') {
      if (!env.STRIPE_WEBHOOK_SECRET) fail(503, 'Payment verification is not connected yet.');
      const raw = await request.text();
      if (raw.length > 250000) fail(413, 'Request too large.');
      const parts = (request.headers.get('stripe-signature') || '').split(',').map(part => part.split('='));
      const timestamp = parts.find(part => part[0] === 't')?.[1];
      const signature = parts.find(part => part[0] === 'v1')?.[1];
      if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !equal(signature, await hmac(`${timestamp}.${raw}`, env.STRIPE_WEBHOOK_SECRET))) fail(400, 'Invalid payment signature.');
      const event = JSON.parse(raw), session = event.data?.object;
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && session?.payment_status === 'paid') await grantMovePlan(env, await stripe(env, `checkout/sessions/${encodeURIComponent(session.id)}`));
      if (event.type === 'charge.refunded' && session?.payment_intent) await env.DB.prepare("UPDATE boplo_move_entitlements SET status='refunded',updated_at=? WHERE order_id IN (SELECT id FROM boplo_move_orders WHERE stripe_payment_intent=?)").bind(Date.now(), session.payment_intent).run();
      return respond({ received: true });
    }
    if (!['GET', 'POST', 'PUT'].includes(request.method)) fail(405, 'Method not allowed.');
    if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) fail(403, 'Please use the Boplo website to make this request.');
    const user = await userFromRequest(request, env);
    if (!user) fail(401, 'Sign in to use Boplo Move Plans.');
    if (path === 'status' && request.method === 'GET') return respond({ user: { id: user.id, email: user.email, displayName: user.display_name }, entitlement: await entitlement(env, user.id), calculator: { price: MOVE_PRICE, currency: MOVE_CURRENCY, includedWith: 'move_plan' } });
    if (path === 'profile' && request.method === 'GET') {
      const profile = await env.DB.prepare('SELECT destination,move_date,move_reason,priorities_json,currency,updated_at FROM boplo_move_profiles WHERE user_id=?').bind(user.id).first();
      return respond({ profile: profile ? { ...profile, priorities: JSON.parse(profile.priorities_json || '[]') } : null });
    }
    if (path === 'profile' && request.method === 'PUT') {
      const input = await parseBody(request), now = Date.now();
      const profile = { destination: cleanText(input.destination, 'your destination', 100, false) || null, moveDate: cleanText(input.moveDate, 'your move date', 20, false) || null, moveReason: cleanText(input.moveReason, 'your move reason', 40, false) || null, priorities: cleanPriorities(input.priorities), currency: cleanCurrency(input.currency) };
      await env.DB.prepare('INSERT INTO boplo_move_profiles(user_id,destination,move_date,move_reason,priorities_json,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET destination=excluded.destination,move_date=excluded.move_date,move_reason=excluded.move_reason,priorities_json=excluded.priorities_json,currency=excluded.currency,updated_at=excluded.updated_at').bind(user.id, profile.destination, profile.moveDate, profile.moveReason, JSON.stringify(profile.priorities), profile.currency, now, now).run();
      return respond({ profile });
    }
    if (path === 'calculator' && request.method === 'GET') {
      await requireMovePlan(env, user.id);
      const calculations = await env.DB.prepare('SELECT * FROM boplo_move_calculations WHERE user_id=? ORDER BY updated_at DESC LIMIT 20').bind(user.id).all();
      return respond({ calculations: calculations.results.map(formatCalculation) });
    }
    if (path === 'calculator' && request.method === 'POST') {
      await requireMovePlan(env, user.id); await rateLimit(env, `move-calc:${user.id}`, 40);
      const calculation = calculateMoveBudget(await parseBody(request)), now = Date.now(), calculationId = id();
      await env.DB.prepare('INSERT INTO boplo_move_calculations(id,user_id,destination,currency,monthly_rent,deposit_months,monthly_living,travel_and_setup,emergency_buffer,savings,first_month_total,three_month_total,remaining_after_first_month,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(calculationId, user.id, calculation.destination, calculation.currency, calculation.monthlyRent, calculation.depositMonths, calculation.monthlyLiving, calculation.travelAndSetup, calculation.emergencyBuffer, calculation.savings, calculation.firstMonthTotal, calculation.threeMonthTotal, calculation.remainingAfterFirstMonth, now, now).run();
      return respond({ calculation: { id: calculationId, ...calculation, createdAt: now }, note: 'This estimate uses the amounts you entered. Check contracts, local rules and final quotes before committing.' }, 201);
    }
    if (path === 'checkout' && request.method === 'POST') {
      const access = await entitlement(env, user.id);
      if (access.plan === 'move_plan') return respond({ paid: true, entitlement: access });
      if (!env.STRIPE_SECRET_KEY || !env.APP_ORIGIN) fail(503, 'Checkout is not connected yet.');
      const now = Date.now(), orderId = id();
      await env.DB.prepare('INSERT INTO boplo_move_orders(id,user_id,amount,currency,status,created_at) VALUES(?,?,?,?,?,?)').bind(orderId, user.id, MOVE_PRICE, MOVE_CURRENCY, 'pending', now).run();
      const session = await stripe(env, 'checkout/sessions', { mode: 'payment', 'payment_method_types[0]': 'card', 'line_items[0][price_data][currency]': MOVE_CURRENCY, 'line_items[0][price_data][unit_amount]': String(MOVE_PRICE), 'line_items[0][price_data][product_data][name]': 'Boplo Move Plan', 'line_items[0][price_data][product_data][description]': '90 days of Move Calculator, plan tools and local-help requests.', 'line_items[0][quantity]': '1', 'metadata[boplo_product]': 'move_plan', 'metadata[order_id]': orderId, 'metadata[user_id]': user.id, success_url: `${env.APP_ORIGIN}/#move?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${env.APP_ORIGIN}/#move?checkout=cancelled` }, `boplo-move-${orderId}`);
      await env.DB.prepare('UPDATE boplo_move_orders SET stripe_session_id=? WHERE id=?').bind(session.id, orderId).run();
      return respond({ url: session.url });
    }
    if (path === 'checkout/verify' && request.method === 'POST') {
      const input = await parseBody(request), sessionId = String(input.sessionId || '');
      if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) fail(400, 'Invalid checkout reference.');
      const session = await stripe(env, `checkout/sessions/${encodeURIComponent(sessionId)}`), order = await env.DB.prepare('SELECT * FROM boplo_move_orders WHERE stripe_session_id=? AND user_id=?').bind(sessionId, user.id).first();
      if (!order || !paidSession(session, order)) return respond({ paid: false }, 202);
      return respond({ paid: true, entitlement: await grantMovePlan(env, session) });
    }
    if (path === 'advisors' && request.method === 'GET') {
      const city = cleanText(url.searchParams.get('city'), 'a city', 100);
      const advisors = await env.DB.prepare("SELECT a.id,a.display_name,a.bio,a.languages_json,a.rating,a.completed_sessions,a.async_question_price,a.call_15_price,c.city,c.country,c.local_since FROM boplo_local_advisors a JOIN boplo_local_advisor_cities c ON c.advisor_id=a.id WHERE a.verification_status='approved' AND lower(c.city)=lower(?) ORDER BY a.rating DESC,a.completed_sessions DESC LIMIT 30").bind(city).all();
      return respond({ advisors: advisors.results.map(row => ({ ...row, languages: JSON.parse(row.languages_json || '[]') })) });
    }
    if (path === 'local-requests' && request.method === 'GET') {
      await requireMovePlan(env, user.id);
      const requests = await env.DB.prepare('SELECT r.id,r.city,r.request_type,r.question,r.status,r.created_at,r.updated_at,a.display_name AS advisor_name FROM boplo_local_requests r JOIN boplo_local_advisors a ON a.id=r.advisor_id WHERE r.requester_id=? ORDER BY r.updated_at DESC LIMIT 50').bind(user.id).all();
      return respond({ requests: requests.results || [] });
    }
    if (path === 'local-requests' && request.method === 'POST') {
      await requireMovePlan(env, user.id); await rateLimit(env, `move-local-request:${user.id}`, 10, 86400000);
      const input = await parseBody(request), advisorId = cleanText(input.advisorId, 'an adviser', 60), city = cleanText(input.city, 'the city', 100), requestType = String(input.requestType || 'question');
      if (!['question', 'call'].includes(requestType)) fail(400, 'Choose a question or call request.');
      const question = cleanText(input.question, 'your question', 1200);
      const advisor = await env.DB.prepare("SELECT a.id FROM boplo_local_advisors a JOIN boplo_local_advisor_cities c ON c.advisor_id=a.id WHERE a.id=? AND a.verification_status='approved' AND lower(c.city)=lower(?)").bind(advisorId, city).first();
      if (!advisor) fail(404, 'That local adviser is not available for this city.');
      const requestId = id(), now = Date.now();
      await env.DB.prepare('INSERT INTO boplo_local_requests(id,requester_id,advisor_id,city,request_type,question,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(requestId, user.id, advisorId, city, requestType, question, 'submitted', now, now).run();
      return respond({ request: { id: requestId, status: 'submitted', city, requestType, question, createdAt: now }, message: 'Your request is saved. Booking and adviser payouts will be enabled only after the adviser accepts.' }, 201);
    }
    fail(404, 'Not found.');
  } catch (error) {
    return respond({ error: error.status ? error.message : 'Boplo Move Plans are temporarily unavailable. Please try again.' }, error.status || 503);
  }
}
