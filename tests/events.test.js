import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ingestEvents, serverEvent, retention } from '../functions/lib/events.js';

const DAY = 864e5;
function setup() {
  const db = new DatabaseSync(':memory:');
  const stmt = sql => { let args = []; return { bind(...a) { args = a; return this; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async first() { return db.prepare(sql).get(...args) || null; }, async run() { return db.prepare(sql).run(...args); } }; };
  const env = { DB: { prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } }, OWNER_EMAILS: 'boss@boplo.app' };
  return { db, env };
}
const boss = { id: 'boss', email: 'boss@boplo.app' };
const url = q => new URL('https://boplo.app/flight/owner/retention?' + q);

test('events are stored for signed-in and signed-out installs, bad ones are skipped', async () => {
  const { db, env } = setup(); const now = Date.now();
  const r = await ingestEvents(env, { device: 'dev-aaaa-1111', platform: 'ios', v: '1.7 (14)', events: [
    { t: now, k: 'screen', n: 'intro_1', s: 's1' },
    { t: now, k: 'event', n: 'purchase_start', s: 's1', p: { plan: 'yearly', trial: true, junk: { a: 1 }, 'bad key': 1 } },
    { t: now, k: 'screen', n: 'Bad Name!', s: 's1' },
    { t: now - 30 * DAY, k: 'screen', n: 'desk', s: 's1' },
    { t: now, k: 'weird', n: 'desk' }
  ] }, null, now);
  assert.equal(r.stored, 2);
  const rows = db.prepare('SELECT * FROM flight_events ORDER BY id').all();
  assert.equal(rows[0].user_id, null); assert.equal(rows[0].platform, 'ios');
  assert.deepEqual(JSON.parse(rows[1].props), { plan: 'yearly', trial: true });
  await assert.rejects(ingestEvents(env, { device: 'x', platform: 'ios', events: [] }), /device/);
  await assert.rejects(ingestEvents(env, { device: 'dev-aaaa-1111', platform: 'tv', events: [] }), /platform/);
});

test('only the owner can read the report', async () => {
  const { env } = setup();
  await assert.rejects(retention(env, { id: 'u', email: 'x@example.com' }, url('days=30')), /Not allowed/);
});

test('report joins an install to its account, builds the funnel, exit screens, retention and trial timing', async () => {
  const { env } = setup(); const now = Date.now(), t0 = now - 20 * DAY;
  const send = (device, user, ts, list) => ingestEvents(env, { device, platform: 'ios', events: list.map(([k, n, p], i) => ({ t: ts + i * 60e3, k, n, s: device + Math.floor(ts / DAY), p })) }, user, ts + 60 * 60e3);
  // A: goes through everything, starts a trial, keeps it, comes back on day 1 and day 8 and uses the logbook early
  await send('dev-a-000001', null, t0, [['screen', 'welcome'], ['screen', 'q_country'], ['screen', 'q_goal'], ['event', 'questions_done'], ['event', 'committed'], ['screen', 'save_plan']]);
  await send('dev-a-000001', 'A', t0 + 5 * 60e3, [['screen', 'building_desk'], ['event', 'onboarding_done'], ['screen', 'trial_gate'], ['event', 'purchase_start', { from: 'trial_gate' }], ['event', 'purchase_success', { from: 'trial_gate', plan: 'yearly', trial: true }], ['screen', 'desk'], ['screen', 'logbook']]);
  await send('dev-a-000001', 'A', t0 + DAY, [['screen', 'desk'], ['screen', 'logbook']]);
  await send('dev-a-000001', 'A', t0 + 18 * DAY, [['screen', 'desk']]);
  await serverEvent(env, 'A', 'apple_DID_RENEW', { plan: 'yearly' }, t0 + 3.2 * DAY);
  // B: signs in, sees the trial offer, starts a trial, cancels 2 hours later, never returns
  await send('dev-b-000002', null, t0, [['screen', 'welcome'], ['screen', 'q_country'], ['event', 'questions_done'], ['screen', 'save_plan']]);
  await send('dev-b-000002', 'B', t0 + 2 * 60e3, [['screen', 'building_desk'], ['event', 'onboarding_done'], ['screen', 'trial_gate'], ['event', 'purchase_success', { from: 'trial_gate', plan: 'monthly', trial: true }], ['screen', 'desk'], ['screen', 'study']]);
  await serverEvent(env, 'B', 'apple_DID_CHANGE_RENEWAL_STATUS_AUTO_RENEW_DISABLED', null, t0 + 2.5 * 3600e3);
  // C: never gets past sign-in
  await send('dev-c-000003', null, t0, [['screen', 'welcome'], ['screen', 'q_country'], ['screen', 'save_plan']]);

  const r = await retention(env, boss, url('days=30&platform=ios'), now);
  const f = Object.fromEntries(r.funnels.ios.map(s => [s.label, s.n]));
  assert.equal(f['Opened the app'], 3); assert.equal(f['Signed in'], 2); assert.equal(f['Started a trial or plan'], 2); assert.equal(f['Paid after the trial'], 1);
  assert.equal(r.paths.ios.find(s => s.screen === 'save_plan').n, 3);
  assert.equal(r.paths.ios.find(s => s.screen === 'building_desk').drop, 1);
  assert.equal(Object.fromEntries(r.funnels.ios.map(s => [s.label, s.n]))['Answered the questions'], 2);
  assert.equal(r.closed.find(c => c.screen === 'save_plan').n, 1);
  assert.equal(r.gone.people, 2);
  assert.equal(r.returning.find(x => x.day === 1).back, 1);
  assert.equal(r.returning.find(x => x.day === 7).rate, 33.3);
  assert.equal(r.trials.started, 2); assert.equal(r.trials.cancelled, 1); assert.equal(r.trials.paid, 1);
  assert.equal(r.trials.when.find(w => w.label === '1–6 hours').n, 1);
  assert.equal(r.trials.lastScreen[0].screen, 'study');
  const log = r.features.find(x => x.name === 'Logbook'); assert.equal(log.kept, 100); assert.equal(log.lost, 0);
  assert.equal(r.paywall.sources.find(s => s.from === 'trial_gate').success, 2);
  assert.ok(Array.isArray(r.insights) && r.insights.length);
  // web filter leaves the iPhone funnel out
  const w = await retention(env, boss, url('days=30&platform=web'), now);
  assert.equal(w.funnels.ios, undefined); assert.equal(w.totals.people, 0);
});
