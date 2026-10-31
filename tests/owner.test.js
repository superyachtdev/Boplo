import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ownerUsers, ownerUser } from '../functions/lib/owner.js';

// a D1-shaped wrapper over in-memory SQLite, with the tables owner analytics reads
function env() {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0002_darts_product.sql', '0009_boplo_flight.sql']) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE flight_billing (user_id TEXT PRIMARY KEY, customer_id TEXT, subscription_id TEXT, status TEXT NOT NULL DEFAULT 'none', price_key TEXT, current_period_end INTEGER, cancel_at_period_end INTEGER NOT NULL DEFAULT 0, trial_end INTEGER, trial_used INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    CREATE TABLE flight_school_members (user_id TEXT PRIMARY KEY, school_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student');
    CREATE TABLE flight_schools (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'school', status TEXT NOT NULL DEFAULT 'none');
    CREATE TABLE flight_ai_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
    CREATE TABLE sim_scores (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ap TEXT NOT NULL, rw TEXT, kind TEXT NOT NULL, week TEXT NOT NULL, day TEXT NOT NULL, challenge INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL, fpm INTEGER, td INTEGER, cl REAL, kt INTEGER, aircraft TEXT, created_at INTEGER NOT NULL);`);
  const prep = sql => { let a = []; return { bind(...v) { a = v; return this; }, async first() { return db.prepare(sql).get(...a) || null; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { return db.prepare(sql).run(...a); } }; };
  return { db, OWNER_EMAILS: 'boss@boplo.app', DB: { prepare: prep, async batch(list) { for (const s of list) await s.run(); } } };
}
const owner = { id: 'o1', email: 'boss@boplo.app' };
const url = q => new URL('https://boplo.app/flight/owner/x?' + new URLSearchParams(q));

test('owners can find a user and open their page; others cannot', async () => {
  const e = env(), now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  e.db.exec(`INSERT INTO darts_users(id,email,display_name,created_at,updated_at) VALUES ('u1','amy.pilot@example.com','Amy Lane',${now - 864e5 * 10},${now}),('u2','bob_x@example.com',NULL,${now},${now})`);
  e.db.exec(`INSERT INTO flight_profiles(user_id,data,updated_at) VALUES ('u1','{"name":"Amy","licence":"PPL","country":"UK","calHash":"secret","notes":"private"}',${now})`);
  e.db.exec(`INSERT INTO flight_records(id,user_id,data,created_at,updated_at) VALUES ('f1','u1','{"date":"${day}","departure":"EGKA","arrival":"EGHI","minutes":72,"role":"solo","landings":3}',${now},${now})`);
  e.db.exec(`INSERT INTO flight_billing(user_id,customer_id,status,price_key,updated_at) VALUES ('u1','cus_1','active','yearly',${now})`);
  e.db.exec(`INSERT INTO flight_schools(id,name,owner_id) VALUES ('sc1','Sky School','o9'); INSERT INTO flight_school_members VALUES ('u1','sc1','student')`);
  e.db.exec(`INSERT INTO flight_ai_usage VALUES ('u1','${day}',4)`);
  e.db.exec(`INSERT INTO sim_scores(id,user_id,ap,kind,week,day,score,fpm,created_at) VALUES ('s1','u1','EGHP','short','w','${day}',88,-140,${now})`);

  const r = await ownerUsers(e, owner, url({ q: 'amy' }));
  assert.equal(r.users.length, 1); assert.equal(r.users[0].id, 'u1'); assert.equal(r.users[0].flights, 1); assert.equal(r.users[0].school_role, 'student');
  assert.equal((await ownerUsers(e, owner, url({ q: '_x' }))).users[0]?.id, 'u2', 'underscore is literal, not a wildcard');
  assert.equal((await ownerUsers(e, owner, url({ q: 'a' }))).users.length, 0, 'needs two characters');

  const d = await ownerUser(e, owner, url({ id: 'u1' }));
  assert.equal(d.account.email, 'amy.pilot@example.com');
  assert.equal(d.usage.flights, 1); assert.equal(d.usage.minutes, 72); assert.equal(d.usage.soloMinutes, 72); assert.equal(d.usage.ask, 4); assert.equal(d.usage.best, 88);
  assert.equal(d.plan.status, 'active'); assert.equal(d.school.name, 'Sky School'); assert.equal(d.profile.licence, 'PPL');
  assert.equal(d.profile.calHash, undefined); assert.equal(d.profile.notes, undefined, 'private notes stay private');
  assert.equal(d.activity.length, 90); assert.equal(d.activity.at(-1).flights + d.activity.at(-1).ask + d.activity.at(-1).sim, 6);

  await assert.rejects(ownerUser(e, owner, url({ id: 'nope' })), /No account/);
  await assert.rejects(ownerUsers(e, { id: 'u1', email: 'amy.pilot@example.com' }, url({ q: 'amy' })), /Not allowed/);
  await assert.rejects(ownerUser(e, { id: 'u1', email: 'amy.pilot@example.com' }, url({ id: 'u1' })), /Not allowed/);
});
