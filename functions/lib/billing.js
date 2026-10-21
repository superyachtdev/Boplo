// Boplo Flight billing: Stripe subscriptions through the REST API (no SDK needed on Cloudflare).
// Secrets (Cloudflare env): STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_FLIGHT_WEBHOOK_SECRET (this endpoint's own signing secret).
// Options (Cloudflare env, optional): STRIPE_TAX=on to calculate VAT/sales tax with Stripe Tax; BILLING_TRIAL_DAYS (default 7).

export const PLANS = {
  monthly: { lookup: 'boplo_flight_advanced_monthly', amount: 1199, currency: 'usd', interval: 'month', label: 'Advanced monthly' },
  yearly: { lookup: 'boplo_flight_advanced_yearly', amount: 9999, currency: 'usd', interval: 'year', label: 'Advanced yearly' }
};
export const FREE_LIMITS = { flights: 15, navPlans: 1 };
const ACTIVE = new Set(['active', 'trialing', 'past_due']);
const STRIPE_VERSION = '2024-06-20'; // pinned so response shapes stay stable

export const planOf = row => (row && ACTIVE.has(row.status) ? 'advanced' : 'free');
// limits only apply once checkout is configured, so nobody is locked out before they can upgrade
export const billingOn = env => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY);
export const effectivePlan = (env, row) => (billingOn(env) ? planOf(row) : 'advanced');

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? form(item, `${key}[${i}]`, out) : out.append(`${key}[]`, String(item))));
    else if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
export async function stripe(env, method, path, params, fetcher = fetch) {
  if (!env.STRIPE_SECRET_KEY) throw Object.assign(new Error('Payments aren’t set up yet.'), { status: 503 });
  const qs = method === 'GET' && params ? '?' + form(params).toString() : '';
  const res = await fetcher(`https://api.stripe.com/v1/${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': STRIPE_VERSION, ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: method !== 'GET' && params ? form(params).toString() : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data?.error?.message || 'The payment service didn’t respond.'); e.status = res.status >= 500 ? 502 : 400; e.stripe = data?.error; throw e; }
  return data;
}

// prices are created on first use, found again by lookup key
export async function ensurePrice(env, key, fetcher = fetch) {
  const plan = PLANS[key]; if (!plan) throw Object.assign(new Error('Choose monthly or yearly.'), { status: 400 });
  const found = await stripe(env, 'GET', 'prices', { lookup_keys: [plan.lookup], active: true, limit: 1 }, fetcher);
  if (found.data?.[0]) return found.data[0];
  const products = await stripe(env, 'GET', 'products/search', { query: "metadata['boplo']:'flight_advanced'" }, fetcher).catch(() => ({ data: [] }));
  const product = products.data?.[0] || await stripe(env, 'POST', 'products', { name: 'Boplo Flight Advanced', description: 'The full Boplo Flight desk for student pilots.', metadata: { boplo: 'flight_advanced' } }, fetcher);
  return stripe(env, 'POST', 'prices', { product: product.id, unit_amount: plan.amount, currency: plan.currency, recurring: { interval: plan.interval }, lookup_key: plan.lookup, transfer_lookup_key: true, tax_behavior: 'exclusive', nickname: plan.label }, fetcher);
}

export async function billingRow(env, userId) {
  return env.DB.prepare('SELECT * FROM flight_billing WHERE user_id=?').bind(userId).first();
}
async function saveRow(env, userId, patch) {
  const prev = (await billingRow(env, userId)) || {};
  const r = { customer_id: null, subscription_id: null, status: 'none', price_key: null, current_period_end: null, cancel_at_period_end: 0, trial_end: null, trial_used: 0, ...prev, ...patch };
  await env.DB.prepare('INSERT INTO flight_billing(user_id,customer_id,subscription_id,status,price_key,current_period_end,cancel_at_period_end,trial_end,trial_used,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,status=excluded.status,price_key=excluded.price_key,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,trial_end=excluded.trial_end,trial_used=excluded.trial_used,updated_at=excluded.updated_at')
    .bind(userId, r.customer_id, r.subscription_id, r.status, r.price_key, r.current_period_end, r.cancel_at_period_end ? 1 : 0, r.trial_end, r.trial_used ? 1 : 0, Date.now()).run();
  return { ...r, user_id: userId };
}
async function ensureCustomer(env, user, fetcher) {
  const row = await billingRow(env, user.id);
  if (row?.customer_id) return row;
  const c = await stripe(env, 'POST', 'customers', { email: user.email || undefined, name: user.display_name || undefined, metadata: { boplo_user: user.id } }, fetcher);
  return saveRow(env, user.id, { customer_id: c.id });
}

async function hasCard(env, customerId, fetcher) {
  const c = await stripe(env, 'GET', `customers/${customerId}`, null, fetcher).catch(() => null);
  return !!c?.invoice_settings?.default_payment_method;
}
// copy the customer's best subscription from Stripe into D1
const RANK = { active: 5, trialing: 5, past_due: 4, unpaid: 3, incomplete: 2, canceled: 1, incomplete_expired: 0 };
export async function syncCustomer(env, customerId, fetcher = fetch) {
  const row = await env.DB.prepare('SELECT * FROM flight_billing WHERE customer_id=?').bind(customerId).first();
  if (!row) return null;
  const subs = await stripe(env, 'GET', 'subscriptions', { customer: customerId, status: 'all', limit: 10 }, fetcher);
  const best = (subs.data || []).sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || b.created - a.created)[0];
  if (!best) return saveRow(env, row.user_id, { subscription_id: null, status: 'none', price_key: null, current_period_end: null, cancel_at_period_end: 0, trial_end: null });
  const item = best.items?.data?.[0], lk = item?.price?.lookup_key;
  // a trial only counts once Stripe has a card for it; an abandoned checkout stays free
  const status = best.status === 'trialing' && !best.default_payment_method && !(await hasCard(env, customerId, fetcher)) ? 'incomplete' : best.status;
  const key = Object.keys(PLANS).find(k => PLANS[k].lookup === lk) || null;
  return saveRow(env, row.user_id, {
    subscription_id: best.id, status, price_key: key,
    current_period_end: (best.current_period_end ?? item?.current_period_end ?? null) && (best.current_period_end ?? item.current_period_end) * 1000,
    cancel_at_period_end: !!best.cancel_at_period_end, trial_end: best.trial_end ? best.trial_end * 1000 : null,
    trial_used: row.trial_used || (!!best.trial_end && status !== 'incomplete')
  });
}

export function publicBilling(env, row) {
  return {
    plan: effectivePlan(env, row), enforced: billingOn(env), status: row?.status || 'none', interval: row?.price_key || null, periodEnd: row?.current_period_end || null,
    cancelAtPeriodEnd: !!row?.cancel_at_period_end, trialEnd: row?.trial_end || null, trialAvailable: !row?.trial_used,
    trialDays: Number(env.BILLING_TRIAL_DAYS ?? 7), publishableKey: env.STRIPE_PUBLISHABLE_KEY || '', ready: !!(env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY),
    tax: env.STRIPE_TAX === 'on', prices: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, { amount: p.amount, currency: p.currency, interval: p.interval }])), limits: FREE_LIMITS
  };
}

// start a subscription that the browser confirms with Stripe's Payment Element
export async function subscribe(env, user, input, origin, fetcher = fetch) {
  const key = input?.interval === 'monthly' ? 'monthly' : 'yearly';
  let row = await ensureCustomer(env, user, fetcher);
  if (planOf(row) === 'advanced') throw Object.assign(new Error('You’re already on Advanced.'), { status: 400 });
  const price = await ensurePrice(env, key, fetcher);
  // tidy up any unfinished checkout so we never create two subscriptions
  const open = await stripe(env, 'GET', 'subscriptions', { customer: row.customer_id, status: 'incomplete', limit: 5 }, fetcher);
  for (const s of open.data || []) await stripe(env, 'DELETE', `subscriptions/${s.id}`, null, fetcher).catch(() => { });
  const trialing = await stripe(env, 'GET', 'subscriptions', { customer: row.customer_id, status: 'trialing', limit: 5 }, fetcher);
  for (const s of trialing.data || []) if (!s.default_payment_method) await stripe(env, 'DELETE', `subscriptions/${s.id}`, null, fetcher).catch(() => { });
  const tax = env.STRIPE_TAX === 'on';
  if (tax) {
    const a = input?.address || {};
    if (!/^[A-Z]{2}$/.test(String(a.country || ''))) throw Object.assign(new Error('Enter your billing country.'), { status: 400 });
    await stripe(env, 'POST', `customers/${row.customer_id}`, { address: { country: a.country, postal_code: a.postal_code || undefined, line1: a.line1 || undefined, city: a.city || undefined, state: a.state || undefined }, expand: ['tax'] }, fetcher);
  }
  const days = Number(env.BILLING_TRIAL_DAYS ?? 7), useTrial = days > 0 && !row.trial_used;
  const sub = await stripe(env, 'POST', 'subscriptions', {
    customer: row.customer_id, items: [{ price: price.id }], payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    trial_period_days: useTrial ? days : undefined, trial_settings: useTrial ? { end_behavior: { missing_payment_method: 'cancel' } } : undefined,
    automatic_tax: tax ? { enabled: true } : undefined, metadata: { boplo_user: user.id },
    expand: ['latest_invoice.payment_intent', 'pending_setup_intent']
  }, fetcher);
  const secret = sub.pending_setup_intent?.client_secret || sub.latest_invoice?.payment_intent?.client_secret;
  if (!secret) throw Object.assign(new Error('Checkout couldn’t start. Please try again.'), { status: 502 });
  // stays free until the browser confirms the card or payment and we sync
  row = await saveRow(env, user.id, { subscription_id: sub.id, status: 'incomplete', price_key: key });
  const inv = sub.latest_invoice;
  return { clientSecret: secret, mode: sub.pending_setup_intent ? 'setup' : 'payment', subscriptionId: sub.id, trial: useTrial, trialDays: useTrial ? days : 0, amountDue: inv?.amount_due ?? null, tax: inv?.tax ?? null, total: inv?.total ?? null, currency: inv?.currency || price.currency };
}

export async function setCancel(env, user, cancel, fetcher = fetch) {
  const row = await billingRow(env, user.id);
  if (!row?.subscription_id || planOf(row) !== 'advanced') throw Object.assign(new Error('There’s no active subscription.'), { status: 400 });
  await stripe(env, 'POST', `subscriptions/${row.subscription_id}`, { cancel_at_period_end: !!cancel }, fetcher);
  return syncCustomer(env, row.customer_id, fetcher);
}
export async function portal(env, user, origin, fetcher = fetch) {
  const row = await billingRow(env, user.id);
  if (!row?.customer_id) throw Object.assign(new Error('There’s no billing account yet.'), { status: 400 });
  const s = await stripe(env, 'POST', 'billing_portal/sessions', { customer: row.customer_id, return_url: `${origin}/flight-app.html#plan` }, fetcher);
  return { url: s.url };
}
export async function cancelNow(env, userId, fetcher = fetch) {
  const row = await billingRow(env, userId);
  if (row?.subscription_id && ['active', 'trialing', 'past_due', 'incomplete', 'unpaid'].includes(row.status)) await stripe(env, 'DELETE', `subscriptions/${row.subscription_id}`, null, fetcher).catch(() => { });
}

// webhook: verify Stripe's signature, then re-read the customer's subscriptions
export async function verifySignature(payload, header, secret, now = Date.now(), tolerance = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const t = Number(parts.t); if (!t || Math.abs(now / 1000 - t) > tolerance) return false;
  const sigs = String(header).split(',').filter(p => p.trim().startsWith('v1=')).map(p => p.trim().slice(3));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}
export async function webhook(env, request, fetcher = fetch) {
  const payload = await request.text();
  if (!(await verifySignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_FLIGHT_WEBHOOK_SECRET))) return new Response('Bad signature', { status: 400 });
  let event; try { event = JSON.parse(payload); } catch { return new Response('Bad payload', { status: 400 }); }
  const obj = event?.data?.object || {};
  const customer = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
  if (customer && /^(customer\.subscription\.|invoice\.|checkout\.session\.|setup_intent\.|payment_intent\.)/.test(event.type || '')) await syncCustomer(env, customer, fetcher);
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
