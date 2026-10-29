// Boplo for flight schools: one yearly Stripe subscription covers Advanced for every student and instructor who joins with the school's code.
// The school admin is the paying customer. Students choose to join (and can leave); while they're members, the school's instructors see their training progress.
// No free trial: the school pays for the year at checkout.
import { stripe } from './billing.js';
import { rosterCoach, threadFor } from './coach.js';

export const SCHOOL_PLANS = {
  school: { lookup: 'boplo_flight_school_yearly', amount: 99900, currency: 'usd', interval: 'year', seats: 25, staff: 10, label: 'School' },
  school_plus: { lookup: 'boplo_flight_school_plus_yearly', amount: 199900, currency: 'usd', interval: 'year', seats: 75, staff: 25, label: 'School Plus' }
};
const ACTIVE = new Set(['active', 'trialing', 'past_due']);
const RANK = { active: 5, trialing: 5, past_due: 4, unpaid: 3, incomplete: 2, canceled: 1, incomplete_expired: 0 };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const clean = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
export const schoolActive = s => !!s && ACTIVE.has(s.status);
// codes avoid look-alike characters so they can be read out in a briefing room
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = (n = 8) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => ALPHA[b % ALPHA.length]).join('');
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

const ready = new WeakMap(); // per database binding
export function ensureSchoolSchema(env) {
  if (!ready.has(env.DB)) ready.set(env.DB, (async () => {
    for (const q of [
      "CREATE TABLE IF NOT EXISTS flight_schools (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'school', seats INTEGER NOT NULL DEFAULT 25, staff_seats INTEGER NOT NULL DEFAULT 10, customer_id TEXT UNIQUE, subscription_id TEXT, status TEXT NOT NULL DEFAULT 'none', current_period_end INTEGER, cancel_at_period_end INTEGER NOT NULL DEFAULT 0, trial_end INTEGER, trial_used INTEGER NOT NULL DEFAULT 0, student_code TEXT UNIQUE NOT NULL, staff_code TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      'CREATE INDEX IF NOT EXISTS flight_schools_customer ON flight_schools(customer_id)',
      "CREATE TABLE IF NOT EXISTS flight_school_members (user_id TEXT PRIMARY KEY, school_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', joined_at INTEGER NOT NULL)",
      'CREATE INDEX IF NOT EXISTS flight_school_members_school ON flight_school_members(school_id, role)',
      'CREATE TABLE IF NOT EXISTS flight_school_leads (id TEXT PRIMARY KEY, name TEXT, email TEXT, school TEXT, country TEXT, students TEXT, message TEXT, ip TEXT, created_at INTEGER NOT NULL)'
    ]) await env.DB.prepare(q).run();
  })().catch(e => { ready.delete(env.DB); throw e; }));
  return ready.get(env.DB);
}

// the signed-in user's school, if any (one school per account)
export async function membership(env, userId) {
  await ensureSchoolSchema(env);
  const m = await env.DB.prepare('SELECT m.role, m.joined_at, s.* FROM flight_school_members m JOIN flight_schools s ON s.id=m.school_id WHERE m.user_id=?').bind(userId).first();
  return m ? { role: m.role, joinedAt: m.joined_at, school: m } : null;
}
const counts = async (env, id) => {
  const r = await env.DB.prepare("SELECT SUM(role='student') students, SUM(role!='student') staff FROM flight_school_members WHERE school_id=?").bind(id).first();
  return { students: Number(r?.students || 0), staff: Number(r?.staff || 0) };
};
const isStaff = m => m && (m.role === 'admin' || m.role === 'instructor');

// what the app sees; codes only for staff, billing details only for the admin
export async function publicSchool(env, m, origin = 'https://boplo.app') {
  if (!m) return null;
  const s = m.school, c = await counts(env, s.id), staff = isStaff(m), plan = SCHOOL_PLANS[s.plan] || SCHOOL_PLANS.school;
  return {
    role: m.role, id: s.id, name: s.name, plan: s.plan, planLabel: plan.label, seats: s.seats, staffSeats: s.staff_seats, students: c.students, staff: c.staff,
    active: schoolActive(s), status: s.status,
    ...(staff ? { studentCode: s.student_code, staffCode: s.staff_code, studentLink: `${origin}/flight-app.html#join=${s.student_code}`, staffLink: `${origin}/flight-app.html#join=${s.staff_code}` } : {}),
    ...(m.role === 'admin' ? { periodEnd: s.current_period_end, cancelAtPeriodEnd: !!s.cancel_at_period_end, trialEnd: s.trial_end, amount: plan.amount, currency: plan.currency } : {})
  };
}
export const schoolPlans = env => ({ trialDays: 0, plans: Object.fromEntries(Object.entries(SCHOOL_PLANS).map(([k, p]) => [k, { label: p.label, amount: p.amount, currency: p.currency, seats: p.seats, staff: p.staff }])) });

async function ensureSchoolPrice(env, key, fetcher) {
  const plan = SCHOOL_PLANS[key]; if (!plan) fail(400, 'Choose a school plan.');
  const found = await stripe(env, 'GET', 'prices', { lookup_keys: [plan.lookup], active: true, limit: 1 }, fetcher);
  if (found.data?.[0]) return found.data[0];
  const products = await stripe(env, 'GET', 'products/search', { query: "metadata['boplo']:'flight_school'" }, fetcher).catch(() => ({ data: [] }));
  const product = products.data?.[0] || await stripe(env, 'POST', 'products', { name: 'Boplo Flight for schools', description: 'Boplo Flight Advanced for every student and instructor at your flight school, with an instructor dashboard.', metadata: { boplo: 'flight_school' } }, fetcher);
  return stripe(env, 'POST', 'prices', { product: product.id, unit_amount: plan.amount, currency: plan.currency, recurring: { interval: plan.interval }, lookup_key: plan.lookup, transfer_lookup_key: true, tax_behavior: 'exclusive', nickname: plan.label }, fetcher);
}

async function checkoutFor(env, user, school, key, origin, fetcher) {
  const price = await ensureSchoolPrice(env, key, fetcher), days = 0, trial = false;
  const session = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'subscription', customer: school.customer_id, client_reference_id: school.id,
    line_items: [{ price: price.id, quantity: 1 }],
    subscription_data: { metadata: { boplo_school: school.id, boplo_user: user.id }, ...(trial ? { trial_period_days: days } : {}) },
    allow_promotion_codes: true, billing_address_collection: 'required', tax_id_collection: { enabled: true }, customer_update: { name: 'auto', address: 'auto' },
    automatic_tax: env.STRIPE_TAX === 'on' ? { enabled: true } : undefined,
    success_url: `${origin}/flight-app.html?school_checkout=done#school`, cancel_url: `${origin}/flight-app.html#school`
  }, fetcher);
  return { url: session.url, trial, trialDays: trial ? days : 0 };
}

// set up a school (or finish paying for one that was set up but not paid) and send the admin to Stripe Checkout
export async function createSchool(env, user, input, origin, fetcher = fetch) {
  await ensureSchoolSchema(env);
  const key = SCHOOL_PLANS[input?.plan] ? input.plan : 'school', name = clean(input?.name, 80);
  if (name.length < 2) fail(400, 'Enter your school’s name.');
  const m = await membership(env, user.id);
  if (m && m.role !== 'admin') fail(400, `You’re a member of ${m.school.name}. Leave it first to set up your own school.`);
  if (m && schoolActive(m.school)) fail(400, 'Your school already has an active plan.');
  let s = m?.school;
  if (!s) {
    const id = crypto.randomUUID(), now = Date.now();
    await env.DB.prepare('INSERT INTO flight_schools(id,name,owner_id,plan,seats,staff_seats,student_code,staff_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id, name, user.id, key, SCHOOL_PLANS[key].seats, SCHOOL_PLANS[key].staff, newCode(), newCode(), now, now).run();
    await env.DB.prepare("INSERT INTO flight_school_members(user_id,school_id,role,joined_at) VALUES(?,?,'admin',?)").bind(user.id, id, now).run();
    s = await env.DB.prepare('SELECT * FROM flight_schools WHERE id=?').bind(id).first();
  } else await env.DB.prepare('UPDATE flight_schools SET name=?,plan=?,updated_at=? WHERE id=?').bind(name, key, Date.now(), s.id).run();
  if (!s.customer_id) {
    const c = await stripe(env, 'POST', 'customers', { email: user.email || undefined, name, metadata: { boplo_school: s.id, boplo_user: user.id } }, fetcher);
    await env.DB.prepare('UPDATE flight_schools SET customer_id=? WHERE id=?').bind(c.id, s.id).run(); s = { ...s, customer_id: c.id };
  }
  return checkoutFor(env, user, s, key, origin, fetcher);
}

// copy the school's best subscription from Stripe into D1; returns null if the customer isn't a school
export async function syncSchool(env, customerId, fetcher = fetch) {
  await ensureSchoolSchema(env);
  const s = await env.DB.prepare('SELECT * FROM flight_schools WHERE customer_id=?').bind(customerId).first();
  if (!s) return null;
  const subs = await stripe(env, 'GET', 'subscriptions', { customer: customerId, status: 'all', limit: 10 }, fetcher);
  const best = (subs.data || []).sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || b.created - a.created)[0];
  const item = best?.items?.data?.[0], key = Object.keys(SCHOOL_PLANS).find(k => SCHOOL_PLANS[k].lookup === item?.price?.lookup_key) || s.plan;
  const end = best ? (best.current_period_end ?? item?.current_period_end ?? null) : null;
  const next = best ? { subscription_id: best.id, status: best.status, plan: key, seats: SCHOOL_PLANS[key].seats, staff_seats: SCHOOL_PLANS[key].staff, current_period_end: end ? end * 1000 : null, cancel_at_period_end: best.cancel_at_period_end ? 1 : 0, trial_end: best.trial_end ? best.trial_end * 1000 : null, trial_used: s.trial_used || (best.trial_end ? 1 : 0) }
    : { subscription_id: null, status: 'none', plan: s.plan, seats: s.seats, staff_seats: s.staff_seats, current_period_end: null, cancel_at_period_end: 0, trial_end: null, trial_used: s.trial_used };
  await env.DB.prepare('UPDATE flight_schools SET subscription_id=?,status=?,plan=?,seats=?,staff_seats=?,current_period_end=?,cancel_at_period_end=?,trial_end=?,trial_used=?,updated_at=? WHERE id=?')
    .bind(next.subscription_id, next.status, next.plan, next.seats, next.staff_seats, next.current_period_end, next.cancel_at_period_end, next.trial_end, next.trial_used ? 1 : 0, Date.now(), s.id).run();
  return { ...s, ...next };
}

async function joinSchool(env, user, input) {
  const code = normCode(input?.code); if (code.length < 6) fail(400, 'Enter the code your school gave you.');
  const s = await env.DB.prepare('SELECT * FROM flight_schools WHERE student_code=? OR staff_code=?').bind(code, code).first();
  if (!s) fail(404, 'That code doesn’t match a school. Check it with your school.');
  const role = s.staff_code === code ? 'instructor' : 'student';
  const m = await membership(env, user.id);
  if (m?.school.id === s.id) return m;
  if (m) fail(400, `You’re already a member of ${m.school.name}. Leave it first to join another school.`);
  if (!schoolActive(s)) fail(400, `${s.name}’s Boplo plan isn’t active right now. Ask your school to renew it.`);
  const c = await counts(env, s.id);
  if (role === 'student' && c.students >= s.seats) fail(400, `${s.name} has used all ${s.seats} student places. Ask your school to upgrade its plan.`);
  if (role !== 'student' && c.staff >= s.staff_seats) fail(400, `${s.name} has used all ${s.staff_seats} instructor places.`);
  await env.DB.prepare('INSERT INTO flight_school_members(user_id,school_id,role,joined_at) VALUES(?,?,?,?)').bind(user.id, s.id, role, Date.now()).run();
  return membership(env, user.id);
}

const num = v => Number(v || 0);
const parse = (s, d) => { try { const v = JSON.parse(s || ''); return v ?? d; } catch { return d; } };
// the roster: each member's training at a glance, for the school's staff only
async function roster(env, schoolId) {
  const people = await env.DB.prepare('SELECT m.user_id id, m.role, m.joined_at, u.email, u.display_name, p.data pdata FROM flight_school_members m JOIN darts_users u ON u.id=m.user_id LEFT JOIN flight_profiles p ON p.user_id=m.user_id WHERE m.school_id=? ORDER BY m.joined_at').bind(schoolId).all();
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const agg = await env.DB.prepare(`SELECT user_id, COUNT(*) n, SUM(json_extract(data,'$.minutes')) mins, SUM(CASE WHEN json_extract(data,'$.role')!='dual' THEN json_extract(data,'$.minutes') ELSE 0 END) solo, SUM(json_extract(data,'$.landings')) landings, MAX(json_extract(data,'$.date')) last, SUM(CASE WHEN json_extract(data,'$.date')>=? THEN json_extract(data,'$.minutes') ELSE 0 END) recent FROM flight_records WHERE user_id IN (SELECT user_id FROM flight_school_members WHERE school_id=?) GROUP BY user_id`).bind(since, schoolId).all();
  const by = Object.fromEntries((agg.results || []).map(r => [r.user_id, r]));
  const co = await rosterCoach(env, schoolId).catch(() => ({}));
  return (people.results || []).map(r => {
    const p = parse(r.pdata, {}) || {}, f = by[r.id] || {}, study = parse(p.study, {}) || {}, mocks = Array.isArray(study._mocks) ? study._mocks : [];
    return {
      id: r.id, role: r.role, joinedAt: r.joined_at, email: r.email || '', name: clean(p.name || r.display_name || (r.email || '').split('@')[0], 80),
      licence: p.licence || '', authority: p.authority || '', regime: p.regime || '', countryCode: p.countryCode || '', goalHours: num(p.goalHours), openingMinutes: num(p.openingMinutes),
      syllabus: p.syllabus || '', exams: p.exams || '', nextLesson: p.nextLesson || '', lessonDate: p.lessonDate || '', setup: !!p.complete,
      flights: num(f.n), minutes: num(f.mins) + num(p.openingMinutes), soloMinutes: num(f.solo), landings: num(f.landings), lastFlight: f.last || '', recentMinutes: num(f.recent),
      lastMock: mocks.length ? mocks[mocks.length - 1] : null,
      unread: co[r.id]?.unread || 0, toDebrief: co[r.id]?.toDebrief || 0, lastCoached: co[r.id]?.lastCoached || null
    };
  });
}
// one student's record, as on the instructor share page but for the school's staff
async function studentDetail(env, schoolId, studentId, viewer = true) {
  const m = await env.DB.prepare("SELECT role FROM flight_school_members WHERE user_id=? AND school_id=?").bind(studentId, schoolId).first();
  if (!m) fail(404, 'That student isn’t in your school.');
  const row = await env.DB.prepare('SELECT data FROM flight_profiles WHERE user_id=?').bind(studentId).first();
  const p = parse(row?.data, {}) || {};
  const recs = await env.DB.prepare('SELECT id, data FROM flight_records WHERE user_id=? ORDER BY created_at DESC LIMIT 300').bind(studentId).all();
  const flights = (recs.results || []).map(r => { const f = parse(r.data, null); return f && { ...f, id: r.id }; }).filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const pick = f => ({ id: f.id, date: f.date, departure: f.departure, arrival: f.arrival, aircraft: f.aircraft, registration: f.registration, role: f.role, minutes: f.minutes, landings: f.landings, lesson: f.lesson, instructor: f.instructor, notes: f.notes, win: f.win });
  return {
    student: { id: studentId, name: clean(p.name, 80), licence: p.licence || '', authority: p.authority || '', regime: p.regime || '', countryCode: p.countryCode || '', airport: p.airport || '', aircraft: p.aircraft || '', goalHours: num(p.goalHours), openingMinutes: num(p.openingMinutes), target: p.target || '' },
    next: { lesson: p.nextLesson || '', date: p.lessonDate || '', questions: p.questions || '', checklist: p.checklist || '' },
    syllabus: p.syllabus || '', exams: p.exams || '', study: (() => { const s = parse(p.study, {}) || {}; return { mocks: Array.isArray(s._mocks) ? s._mocks.slice(-6) : [] }; })(),
    totals: { flights: flights.length, minutes: flights.reduce((n, f) => n + num(f.minutes), 0) + num(p.openingMinutes), solo: flights.filter(f => f.role !== 'dual').reduce((n, f) => n + num(f.minutes), 0), landings: flights.reduce((n, f) => n + num(f.landings), 0) },
    recent: flights.slice(0, 15).map(pick),
    signoffs: p.signoffs || '',
    thread: viewer ? await threadFor(env, schoolId, studentId, true).catch(() => []) : []
  };
}

// school-plan enquiries from the public Schools page (no sign-in), lightly rate-limited per address
export async function schoolLead(env, request, input) {
  await ensureSchoolSchema(env);
  const email = clean(input?.email, 160), name = clean(input?.name, 80), school = clean(input?.school, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter an email address we can reply to.');
  if (!name || !school) fail(400, 'Enter your name and your school’s name.');
  if (input?.website) return { ok: true }; // honeypot
  const ipRaw = request.headers.get('CF-Connecting-IP') || '';
  const ip = ipRaw ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lead:' + ipRaw)))].slice(0, 12).map(n => n.toString(16).padStart(2, '0')).join('') : '';
  if (ip) { const n = await env.DB.prepare('SELECT COUNT(*) n FROM flight_school_leads WHERE ip=? AND created_at>?').bind(ip, Date.now() - 864e5).first(); if ((n?.n || 0) >= 5) fail(429, 'Thanks, we already have your details. We’ll be in touch.'); }
  await env.DB.prepare('INSERT INTO flight_school_leads(id,name,email,school,country,students,message,ip,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), name, email, school, clean(input?.country, 60), clean(input?.students, 20), clean(input?.message, 2000), ip, Date.now()).run();
  return { ok: true };
}

// routes under /flight/school… for a signed-in user. `owner` = a Boplo owner account (sees enquiries).
export async function schoolRoutes(env, path, method, user, body, origin, owner, fetcher = fetch) {
  await ensureSchoolSchema(env);
  const m = await membership(env, user.id);
  const out = async mm => ({ school: await publicSchool(env, mm, origin), ...schoolPlans(env) });
  const needStaff = () => { if (!isStaff(m)) fail(403, 'Only your school’s instructors can see this.'); if (!schoolActive(m.school)) fail(402, `${m.school.name}’s Boplo plan isn’t active. ${m.role === 'admin' ? 'Renew it from the School page.' : 'Ask your school to renew it.'}`); };
  const needAdmin = () => { if (m?.role !== 'admin') fail(403, 'Only the person who manages your school’s plan can do this.'); };
  if (path === 'school' && method === 'GET') return out(m);
  if (path === 'school/lookup' && method === 'POST') {
    const code = normCode((await body())?.code); const s = code.length >= 6 ? await env.DB.prepare('SELECT name,student_code,staff_code,status FROM flight_schools WHERE student_code=? OR staff_code=?').bind(code, code).first() : null;
    if (!s) fail(404, 'That code doesn’t match a school. Check it with your school.');
    return { name: s.name, role: s.staff_code === code ? 'instructor' : 'student', active: schoolActive(s) };
  }
  if (path === 'school/create' && method === 'POST') return createSchool(env, user, await body(), origin, fetcher);
  if (path === 'school/join' && method === 'POST') return out(await joinSchool(env, user, await body()));
  if (path === 'school/leave' && method === 'POST') {
    if (!m) return out(null);
    if (m.role === 'admin') fail(400, 'You manage this school’s plan, so you can’t leave it. Cancel the plan from billing instead.');
    await env.DB.prepare('DELETE FROM flight_school_members WHERE user_id=?').bind(user.id).run(); return out(null);
  }
  if (path === 'school/sync' && method === 'POST') { needAdmin(); if (m.school.customer_id) await syncSchool(env, m.school.customer_id, fetcher); return out(await membership(env, user.id)); }
  if (path === 'school/portal' && method === 'POST') { needAdmin(); if (!m.school.customer_id) fail(400, 'There’s no billing account yet.'); const s = await stripe(env, 'POST', 'billing_portal/sessions', { customer: m.school.customer_id, return_url: `${origin}/flight-app.html#school` }, fetcher); return { url: s.url }; }
  if (path === 'school/rename' && method === 'POST') { needAdmin(); const name = clean((await body())?.name, 80); if (name.length < 2) fail(400, 'Enter your school’s name.'); await env.DB.prepare('UPDATE flight_schools SET name=?,updated_at=? WHERE id=?').bind(name, Date.now(), m.school.id).run(); if (m.school.customer_id) await stripe(env, 'POST', `customers/${m.school.customer_id}`, { name }, fetcher).catch(() => { }); return out(await membership(env, user.id)); }
  if (path === 'school/codes' && method === 'POST') { needAdmin(); const which = (await body())?.which === 'staff' ? 'staff_code' : 'student_code'; await env.DB.prepare(`UPDATE flight_schools SET ${which}=?,updated_at=? WHERE id=?`).bind(newCode(), Date.now(), m.school.id).run(); return out(await membership(env, user.id)); }
  if (path === 'school/roster' && method === 'GET') { needStaff(); return { members: await roster(env, m.school.id) }; }
  const sm = path.match(/^school\/students\/([A-Za-z0-9_-]{1,80})$/);
  if (sm && method === 'GET') { needStaff(); return studentDetail(env, m.school.id, sm[1]); }
  if (path === 'school/remove' && method === 'POST') {
    needAdmin(); const id = clean((await body())?.userId, 80);
    if (id === user.id) fail(400, 'You can’t remove yourself.');
    const r = await env.DB.prepare('DELETE FROM flight_school_members WHERE user_id=? AND school_id=?').bind(id, m.school.id).run();
    return { ok: true, removed: Number(r?.meta?.changes ?? r?.changes ?? 0) };
  }
  if (path === 'school/leads' && method === 'GET') { if (!owner) fail(403, 'Not allowed.'); const r = await env.DB.prepare('SELECT name,email,school,country,students,message,created_at FROM flight_school_leads ORDER BY created_at DESC LIMIT 100').all(); return { leads: r.results || [] }; }
  return null;
}
