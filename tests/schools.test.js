import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/flight/[[path]].js';
import { createSchool, syncSchool, schoolRoutes, ensureSchoolSchema } from '../functions/lib/schools.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0002_darts_product.sql', '0009_boplo_flight.sql', '0010_boplo_billing.sql']) db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  const D1 = { prepare(sql) { let args = []; return { bind(...a) { args = a; return this; }, async first() { return db.prepare(sql).get(...args) || null; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; } }; } };
  return { db, D1 };
}
async function addUser(db, id) {
  db.prepare('INSERT INTO darts_users(id,email,display_name,created_at,updated_at) VALUES(?,?,?,0,0)').run(id, id + '@example.com', id);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))].map(n => n.toString(16).padStart(2, '0')).join('');
  db.prepare('INSERT INTO darts_sessions VALUES(?,?,?,?,?)').run(id, id, hash, Date.now() + 60000, Date.now());
}
// a tiny fake Stripe: records calls, returns a school subscription whose status we control
function fakeStripe() {
  const calls = []; const st = { status: 'trialing', lookup: 'boplo_flight_school_yearly' };
  const fetcher = async (url, init = {}) => {
    const u = new URL(url), path = u.pathname.replace('/v1/', ''), body = new URLSearchParams(init.body || '');
    calls.push({ method: init.method, path, body: Object.fromEntries(body), query: Object.fromEntries(u.searchParams) });
    const ok = d => new Response(JSON.stringify(d), { status: 200 });
    if (path === 'prices' && init.method === 'GET') return ok({ data: [] });
    if (path === 'products/search') return ok({ data: [] });
    if (path === 'products') return ok({ id: 'prod_s' });
    if (path === 'prices') return ok({ id: 'price_' + body.get('lookup_key'), lookup_key: body.get('lookup_key') });
    if (path === 'customers') return ok({ id: calls.filter(c => c.path === 'customers').length > 1 ? 'cus_school' + calls.filter(c => c.path === 'customers').length : 'cus_school' });
    if (path === 'checkout/sessions') return ok({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
    if (path === 'subscriptions') return ok({ data: st.status === 'none' ? [] : [{ id: 'sub_s', status: st.status, created: 1, current_period_end: 1900000000, trial_end: 1800000000, cancel_at_period_end: false, items: { data: [{ price: { lookup_key: st.lookup } }] } }] });
    if (path.startsWith('billing_portal')) return ok({ url: 'https://billing.stripe.com/p/1' });
    return ok({});
  };
  return { calls, st, fetcher };
}

test('a school admin pays through Checkout, and the school turns active only once Stripe says so', async () => {
  const { db, D1 } = setup(); await addUser(db, 'owner');
  const env = { DB: D1, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }, s = fakeStripe();
  const r = await createSchool(env, { id: 'owner', email: 'owner@example.com' }, { name: 'Popham Flying School', plan: 'school' }, 'https://boplo.app', s.fetcher);
  assert.match(r.url, /checkout\.stripe\.com/); assert.equal(r.trial, false); assert.equal(r.trialDays, 0);
  const cs = s.calls.find(c => c.path === 'checkout/sessions').body;
  assert.equal(cs.mode, 'subscription'); assert.equal(cs['line_items[0][price]'], 'price_boplo_flight_school_yearly'); assert.equal(cs['subscription_data[trial_period_days]'], undefined);
  assert.equal(cs['tax_id_collection[enabled]'], 'true'); assert.match(cs.success_url, /school_checkout=done#school$/);
  const price = s.calls.find(c => c.path === 'prices' && c.method === 'POST').body; assert.equal(price.unit_amount, '99900'); assert.equal(price['recurring[interval]'], 'year');
  let row = db.prepare('SELECT * FROM flight_schools').get(); assert.equal(row.status, 'none'); assert.equal(row.customer_id, 'cus_school'); assert.equal(row.seats, 25);
  assert.match(row.student_code, /^[A-HJ-NP-Z2-9]{8}$/); assert.notEqual(row.student_code, row.staff_code);
  assert.equal(db.prepare('SELECT role FROM flight_school_members WHERE user_id=?').get('owner').role, 'admin');
  // trying again before paying reuses the same school and customer
  await createSchool(env, { id: 'owner' }, { name: 'Popham Flying School', plan: 'school_plus' }, 'https://boplo.app', s.fetcher);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM flight_schools').get().n, 1); assert.equal(s.calls.filter(c => c.path === 'customers').length, 1);
  s.st.lookup = 'boplo_flight_school_plus_yearly';
  row = await syncSchool(env, 'cus_school', s.fetcher); assert.equal(row.status, 'trialing'); assert.equal(row.plan, 'school_plus'); assert.equal(row.seats, 75); assert.equal(row.trial_used, 1);
  assert.equal(await syncSchool(env, 'cus_someone_else', s.fetcher), null);
  await assert.rejects(() => createSchool(env, { id: 'owner' }, { name: 'Again', plan: 'school' }, 'https://boplo.app', s.fetcher), /already has an active plan/);
  db.close();
});

test('students join with the code, get Advanced, and only their own school’s staff see their training', async () => {
  const { db, D1 } = setup();
  for (const u of ['owner', 'cfi', 'sam', 'jo', 'outsider', 'owner2']) await addUser(db, u);
  const s = fakeStripe(), env = { DB: D1, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' };
  await createSchool(env, { id: 'owner' }, { name: 'Popham Flying School', plan: 'school' }, 'https://boplo.app', s.fetcher);
  const call = async (who, path, method = 'GET', body) => { const r = await onRequest({ env, request: new Request('https://boplo.app/flight/' + path, { method, headers: { Cookie: 'boplo_session=' + who, Origin: 'https://boplo.app', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }) }); return { status: r.status, data: await r.json() }; };
  const { student_code: sc, staff_code: tc } = db.prepare('SELECT * FROM flight_schools').get();
  // not paid yet: nobody can join
  assert.equal((await call('sam', 'school/join', 'POST', { code: sc })).status, 400);
  db.prepare("UPDATE flight_schools SET status='active'").run();
  assert.equal((await call('sam', 'school/lookup', 'POST', { code: sc.toLowerCase() })).data.name, 'Popham Flying School');
  assert.equal((await call('sam', 'school/join', 'POST', { code: 'NOPE1234' })).status, 404);
  let j = await call('sam', 'school/join', 'POST', { code: sc.slice(0, 4) + '-' + sc.slice(4) });
  assert.equal(j.status, 200); assert.equal(j.data.school.role, 'student'); assert.equal(j.data.school.studentCode, undefined);
  assert.equal((await call('cfi', 'school/join', 'POST', { code: tc })).data.school.role, 'instructor');
  // a member is Advanced through the school, and the workspace says so
  const ws = (await call('sam', 'workspace')).data; assert.equal(ws.billing.plan, 'advanced'); assert.equal(ws.billing.school.name, 'Popham Flying School'); assert.equal(ws.school.role, 'student');
  assert.equal((await call('outsider', 'workspace')).data.billing.plan, 'free');
  // sam's training shows up on the roster for staff
  await call('sam', 'profile', 'PUT', { name: 'Sam Patel', country: 'United Kingdom', authority: 'UK CAA', licence: 'PPL(A)', complete: true, goalHours: 45, nextLesson: 'Circuits', study: JSON.stringify({ _mocks: [{ d: '2026-10-01', s: 80 }] }) });
  for (const [date, role, minutes] of [['2026-09-01', 'dual', 60], ['2026-10-10', 'solo', 30]]) assert.equal((await call('sam', 'flights', 'POST', { date, departure: 'EGHP', arrival: 'EGHP', minutes, role, landings: 3, points: [] })).status, 201);
  const ro = await call('cfi', 'school/roster'); assert.equal(ro.status, 200);
  const samRow = ro.data.members.find(m => m.id === 'sam'); assert.equal(samRow.name, 'Sam Patel'); assert.equal(samRow.minutes, 90); assert.equal(samRow.soloMinutes, 30); assert.equal(samRow.lastFlight, '2026-10-10'); assert.equal(samRow.lastMock.s, 80); assert.equal(samRow.flights, 2);
  assert.equal((await call('cfi', 'school/students/sam')).data.totals.minutes, 90);
  assert.equal((await call('sam', 'school/roster')).status, 403);
  assert.equal((await call('outsider', 'school/students/sam')).status, 403);
  // a second school's staff can't read sam
  await createSchool(env, { id: 'owner2' }, { name: 'Other School', plan: 'school' }, 'https://boplo.app', s.fetcher);
  db.prepare("UPDATE flight_schools SET status='active' WHERE name='Other School'").run();
  assert.equal((await call('owner2', 'school/students/sam')).status, 404);
  // one school per account
  assert.equal((await call('sam', 'school/join', 'POST', { code: db.prepare("SELECT student_code c FROM flight_schools WHERE name='Other School'").get().c })).status, 400);
  // admin-only actions
  assert.equal((await call('cfi', 'school/codes', 'POST', { which: 'student' })).status, 403);
  const before = sc, after = (await call('owner', 'school/codes', 'POST', { which: 'student' })).data.school.studentCode; assert.notEqual(after, before);
  assert.equal((await call('jo', 'school/join', 'POST', { code: before })).status, 404);
  assert.equal((await call('owner', 'school/leave', 'POST', {})).status, 400);
  assert.equal((await call('owner', 'school/remove', 'POST', { userId: 'sam' })).data.removed, 1);
  assert.equal((await call('sam', 'workspace')).data.billing.plan, 'free');
  // seat limit
  db.prepare("UPDATE flight_schools SET seats=1 WHERE name='Popham Flying School'").run();
  assert.equal((await call('jo', 'school/join', 'POST', { code: after })).status, 200);
  assert.equal((await call('sam', 'school/join', 'POST', { code: after })).status, 400);
  // students can leave; an admin with an active plan can't delete their account
  assert.equal((await call('jo', 'school/leave', 'POST', {})).data.school, null);
  assert.equal((await call('owner', 'account/delete', 'POST', { confirm: 'DELETE' })).status, 400);
  // when the plan lapses, members drop back to Free and the roster closes
  db.prepare("UPDATE flight_schools SET status='canceled' WHERE name='Popham Flying School'").run();
  assert.equal((await call('cfi', 'workspace')).data.billing.plan, 'free');
  assert.equal((await call('cfi', 'school/roster')).status, 402);
  db.close();
});

test('school enquiries are validated, rate-limited and only visible to the owner', async () => {
  const { db, D1 } = setup(); await addUser(db, 'boss'); await addUser(db, 'nobody');
  const env = { DB: D1, OWNER_EMAILS: 'boss@example.com' };
  const lead = (body, ip = '1.2.3.4') => onRequest({ env, request: new Request('https://boplo.app/flight/school/lead', { method: 'POST', headers: { Origin: 'https://boplo.app', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) }) });
  assert.equal((await lead({ name: 'Kim', email: 'bad', school: 'X' })).status, 400);
  assert.equal((await lead({ name: 'Kim', email: 'kim@school.com', school: 'Big Aviation Academy', students: '120', message: 'We have 120 students.' })).status, 200);
  for (let i = 0; i < 4; i++) await lead({ name: 'Kim', email: 'kim@school.com', school: 'Big Aviation Academy' });
  assert.equal((await lead({ name: 'Kim', email: 'kim@school.com', school: 'Big Aviation Academy' })).status, 429);
  const get = who => onRequest({ env, request: new Request('https://boplo.app/flight/school/leads', { headers: { Cookie: 'boplo_session=' + who } }) });
  assert.equal((await get('nobody')).status, 403);
  const r = await (await get('boss')).json(); assert.equal(r.leads.length, 5); assert.equal(r.leads[0].school, 'Big Aviation Academy');
  db.close();
});
