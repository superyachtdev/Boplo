import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { announce, audience, announcementsOff } from '../functions/lib/announce.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE darts_users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT);
    CREATE TABLE flight_profiles (user_id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE flight_billing (user_id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE flight_school_members (user_id TEXT, school_id TEXT);
    CREATE TABLE flight_apple (user_id TEXT, status TEXT, expires_at INTEGER);`);
  const u = (id, email, profile = {}) => { db.prepare('INSERT INTO darts_users VALUES (?,?,?)').run(id, email, id); db.prepare('INSERT INTO flight_profiles VALUES (?,?)').run(id, JSON.stringify({ name: id + ' Pilot', ...profile })); };
  u('free', 'free@example.com'); u('paid', 'paid@example.com'); u('apple', 'apple@example.com'); u('lapsed', 'lapsed@example.com');
  u('school', 'school@example.com'); u('relay', 'x1y2@privaterelay.appleid.com'); u('optout', 'optout@example.com', { announcements: false }); u('boss', 'boss@boplo.app'); u('noemail', '');
  db.prepare("INSERT INTO flight_billing VALUES ('paid','active'),('lapsed','canceled')").run();
  db.prepare("INSERT INTO flight_apple VALUES ('apple','active',?)").run(Date.now() + 864e5);
  db.prepare("INSERT INTO flight_school_members VALUES ('school','s1')").run();
  const wrap = sql => { let args = []; return { bind(...a) { args = a; return this; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async first() { return db.prepare(sql).get(...args) || null; }, async run() { return db.prepare(sql).run(...args); } }; };
  const env = { DB: { prepare: wrap }, OWNER_EMAILS: 'boss@boplo.app', RESEND_API_KEY: 're_x', EMAIL_FROM: 'Boplo <hi@boplo.app>', CRON_SECRET: 'sek' };
  return { db, env };
}

test('announcement goes to free and lapsed accounts only, never to payers, App Store or school members, opt-outs or the owner', async () => {
  const { env } = setup();
  const list = await audience(env, 'free-ending-2026-11');
  assert.deepEqual(list.map(p => p.id).sort(), ['free', 'lapsed']);
  assert.equal(list.find(p => p.id === 'free').first, 'free');
});

test('owner previews, tests and sends once; each person is emailed once with an opt-out link that works', async () => {
  const { db, env } = setup(); const boss = { id: 'boss', email: 'boss@boplo.app', display_name: 'Gianni Wood' };
  await assert.rejects(announce(env, { id: 'x', email: 'x@example.com' }, { id: 'free-ending-2026-11' }), /Not allowed/);
  const pv = await announce(env, boss, { id: 'free-ending-2026-11', action: 'preview' });
  assert.equal(pv.count, 2); assert.equal(pv.skippedRelay, 1); assert.match(pv.html, /EARLYPILOT/); assert.match(pv.html, /3-day free trial/);
  const calls = []; const fake = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{"data":[]}', { status: 200 }); };
  await announce(env, boss, { id: 'free-ending-2026-11', action: 'test' }, 'https://boplo.app', fake);
  assert.deepEqual(calls[0].body.map(m => m.to[0]), ['boss@boplo.app']); assert.match(calls[0].body[0].subject, /^\[Test\]/);
  await assert.rejects(announce(env, boss, { id: 'free-ending-2026-11', action: 'send', expect: 5 }, 'https://boplo.app', fake), /changed/);
  const out = await announce(env, boss, { id: 'free-ending-2026-11', action: 'send', expect: 2 }, 'https://boplo.app', fake);
  assert.equal(out.sent, 2);
  const mail = calls[1].body; assert.deepEqual(mail.map(m => m.to[0]).sort(), ['free@example.com', 'lapsed@example.com']);
  assert.match(mail[0].headers['List-Unsubscribe'], /announcements\/off\?u=/); assert.match(mail[0].text, /EARLYPILOT/);
  assert.equal((await audience(env, 'free-ending-2026-11')).length, 0, 'nobody gets it twice');
  // the opt-out link from the email stops future announcements
  const off = mail.find(m => m.to[0] === 'free@example.com').headers['List-Unsubscribe'].slice(1, -1);
  const res = await announcementsOff(env, new URL(off)); assert.equal(res.status, 200);
  assert.equal(JSON.parse(db.prepare("SELECT data FROM flight_profiles WHERE user_id='free'").get().data).announcements, false);
  const bad = await announcementsOff(env, new URL('https://boplo.app/flight/announcements/off?u=free&t=nope')); assert.equal(bad.status, 400);
});
