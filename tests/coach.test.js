import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/flight/[[path]].js';
import { buildDigest, runDigest } from '../functions/lib/coach.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0002_darts_product.sql', '0009_boplo_flight.sql', '0010_boplo_billing.sql', '0011_flight_schools.sql']) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const D1 = { prepare(sql) { let a = []; return { bind(...v) { a = v; return this; }, async first() { return db.prepare(sql).get(...a) || null; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: r.changes } }; } }; }, async batch(l) { for (const s of l) await s.run(); } };
  return { db, env: { DB: D1, CRON_SECRET: 'c', RESEND_API_KEY: 're_test', EMAIL_FROM: 'Boplo <hi@boplo.app>' } };
}
async function user(db, id, name) {
  db.prepare('INSERT INTO darts_users(id,email,display_name,created_at,updated_at) VALUES(?,?,?,0,0)').run(id, id + '@example.com', name);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))].map(n => n.toString(16).padStart(2, '0')).join('');
  db.prepare('INSERT INTO darts_sessions VALUES(?,?,?,?,?)').run(id, id, hash, Date.now() + 6e5, Date.now());
  db.prepare('INSERT INTO flight_profiles VALUES(?,?,?)').run(id, JSON.stringify({ name, complete: true, checklist: '[ ] My own item\n[x] Done item' }), 0);
}
const call = async (env, who, path, method = 'GET', body) => {
  const r = await onRequest({ request: new Request('https://boplo.app/flight/' + path, { method, headers: { Cookie: 'boplo_session=' + who, Origin: 'https://boplo.app', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, waitUntil: () => { } });
  return { status: r.status, data: await r.json().catch(() => null) };
};

test('instructors coach students and students reply', async () => {
  const { db, env } = setup(); const mails = [];
  globalThis.fetch = async (url, init) => { if (String(url).includes('resend')) { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); } throw new Error('unexpected ' + url); };
  for (const [id, n] of [['ins', 'Rosa Diaz'], ['stu', 'Alex Morgan'], ['out', 'Other Person']]) await user(db, id, n);
  db.prepare("INSERT INTO flight_schools(id,name,owner_id,status,student_code,staff_code,created_at,updated_at) VALUES('s1','Popham','ins','active','AAAAAAAA','BBBBBBBB',0,0)").run();
  db.prepare("INSERT INTO flight_school_members VALUES('ins','s1','admin',0)").run();
  db.prepare("INSERT INTO flight_school_members VALUES('stu','s1','student',0)").run();
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO flight_records VALUES(?,?,?,?,?)').run('f1', 'stu', JSON.stringify({ date: today, role: 'dual', minutes: 60, landings: 3, departure: 'EGHP', arrival: 'EGHP' }), 1, 1);

  let ro = await call(env, 'ins', 'school/roster');
  assert.equal(ro.data.members.find(m => m.id === 'stu').toDebrief, 1);

  let r = await call(env, 'ins', 'school/coach', 'POST', { studentId: 'stu', kind: 'debrief', flightId: 'f1', rating: 'great', wentWell: 'Stable approach', workOn: 'Flare earlier' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.item.rating, 'great');
  // editing the same debrief replaces it
  r = await call(env, 'ins', 'school/coach', 'POST', { studentId: 'stu', kind: 'debrief', flightId: 'f1', rating: 'on-track', note: 'Updated' });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM flight_coach WHERE kind='debrief'").get().n, 1);
  ro = await call(env, 'ins', 'school/roster'); assert.equal(ro.data.members.find(m => m.id === 'stu').toDebrief, 0);

  r = await call(env, 'ins', 'school/coach', 'POST', { studentId: 'stu', kind: 'plan', lesson: 'Lesson 12 · Navigation', date: today, prep: ['Plot the route', 'My own item'], note: 'Bring the chart' });
  assert.equal(r.status, 200);
  let prof = JSON.parse(db.prepare("SELECT data FROM flight_profiles WHERE user_id='stu'").get().data);
  assert.equal(prof.nextLesson, 'Lesson 12 · Navigation'); assert.equal(prof.checklist, '[ ] Plot the route\n[ ] My own item');

  r = await call(env, 'ins', 'school/coach', 'POST', { studentId: 'stu', kind: 'signoff', sylId: 'faa-ppl', itemId: 'a3', itemName: 'Stalls', status: 'd' });
  prof = JSON.parse(db.prepare("SELECT data FROM flight_profiles WHERE user_id='stu'").get().data);
  assert.equal(JSON.parse(prof.syllabus)['faa-ppl'].a3, 'd'); assert.equal(JSON.parse(prof.signoffs)['faa-ppl:a3'].by, 'Rosa Diaz');

  // the student sees it all, unread, and can reply
  let c = await call(env, 'stu', 'coach/count'); assert.equal(c.data.unread, 3); assert.equal(c.data.debriefs[0].flightId, 'f1');
  const th = await call(env, 'stu', 'coach'); assert.equal(th.data.items.length, 3);
  c = await call(env, 'stu', 'coach/count'); assert.equal(c.data.unread, 0);
  r = await call(env, 'stu', 'coach/msg', 'POST', { text: 'Should I bring my own headset?' }); assert.equal(r.status, 200);
  ro = await call(env, 'ins', 'school/roster'); assert.equal(ro.data.members.find(m => m.id === 'stu').unread, 1);
  const det = await call(env, 'ins', 'school/students/stu'); assert.equal(det.data.thread.length, 4); assert.equal(det.data.recent[0].id, 'f1');
  ro = await call(env, 'ins', 'school/roster'); assert.equal(ro.data.members.find(m => m.id === 'stu').unread, 0);

  // students can't debrief, outsiders can't post, staff can't coach someone outside the school
  assert.equal((await call(env, 'stu', 'school/coach', 'POST', { studentId: 'stu', kind: 'msg', text: 'x' })).status, 403);
  assert.equal((await call(env, 'out', 'coach/msg', 'POST', { text: 'hi' })).status, 403);
  assert.equal((await call(env, 'ins', 'school/coach', 'POST', { studentId: 'out', kind: 'msg', text: 'hi' })).status, 404);
  assert.ok(mails.length >= 2);
});

test('weekly digest lists who needs attention, once a week', async () => {
  const now = Date.parse('2026-11-02T09:00:00Z');
  assert.equal(buildDigest({ school: 'X', students: [{ name: 'A', setup: true, last: '2026-11-01', joinedAt: 0, unread: 0, toDebrief: 0 }], now }), null);
  const d = buildDigest({ school: 'Popham', students: [{ name: 'Ben', setup: true, last: '2026-10-10', joinedAt: 0, unread: 0, toDebrief: 0 }, { name: 'Alex', setup: true, last: '2026-11-01', joinedAt: 0, unread: 2, toDebrief: 1, nextLesson: 'Nav', lessonDate: '2026-11-04' }], now });
  assert.match(d.subject, /3 students need you|2 students need you/);
  assert.equal(d.sections[0][0], 'Messages waiting for a reply');
  const { db, env } = setup(); const mails = [];
  const fetcher = async (u, init) => { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  for (const [id, n] of [['ins', 'Rosa'], ['stu', 'Ben']]) await user(db, id, n);
  db.prepare("INSERT INTO flight_schools(id,name,owner_id,status,student_code,staff_code,created_at,updated_at) VALUES('s1','Popham','ins','active','AAAAAAAA','BBBBBBBB',0,0)").run();
  db.prepare("INSERT INTO flight_school_members VALUES('ins','s1','instructor',0)").run();
  db.prepare("INSERT INTO flight_school_members VALUES('stu','s1','student',0)").run();
  db.prepare('INSERT INTO flight_records VALUES(?,?,?,?,?)').run('f1', 'stu', JSON.stringify({ date: '2026-10-01', role: 'solo', minutes: 60 }), 1, 1);
  assert.equal((await runDigest(env, { now, fetcher })).digests, 1);
  assert.match(mails[0].html, /Ben: last flew 32 days ago/);
  assert.equal((await runDigest(env, { now: now + DAY(), fetcher })).digests, 0);
  assert.equal((await runDigest(env, { now: now + 7 * DAY(), fetcher })).digests, 1);
});
const DAY = () => 864e5;
