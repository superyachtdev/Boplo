// Instructor ↔ student coaching for Boplo schools: flight debriefs, next-lesson plans with prep tasks,
// syllabus sign-offs and a message thread, plus notifications and a weekly instructor digest.
// Everything is scoped to one school: staff see and write for their own school's students only.
import { pushTo } from './push.js';

const DAY = 864e5;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const clean = (v, max = 400) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, max);
const parse = (s, d) => { try { const v = JSON.parse(s || ''); return v ?? d; } catch { return d; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isStaff = m => m && (m.role === 'admin' || m.role === 'instructor');
const ACTIVE = new Set(['active', 'trialing', 'past_due']);
const KINDS = new Set(['debrief', 'plan', 'signoff', 'msg']);
const RATINGS = { 'needs-work': 'Needs more work', 'on-track': 'On track', great: 'Really good' };

let ready = new WeakMap();
export function ensureCoach(env) {
  if (!ready.has(env.DB)) ready.set(env.DB, (async () => {
    for (const q of [
      'CREATE TABLE IF NOT EXISTS flight_coach (id TEXT PRIMARY KEY, school_id TEXT NOT NULL, student_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT, from_staff INTEGER NOT NULL, kind TEXT NOT NULL, flight_id TEXT, body TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER)',
      'CREATE INDEX IF NOT EXISTS flight_coach_student ON flight_coach(student_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS flight_coach_school ON flight_coach(school_id, created_at DESC)',
      'CREATE TABLE IF NOT EXISTS flight_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)'
    ]) await env.DB.prepare(q).run();
  })().catch(e => { ready.delete(env.DB); throw e; }));
  return ready.get(env.DB);
}

const nameOf = async (env, userId) => {
  const r = await env.DB.prepare('SELECT u.display_name, u.email, p.data FROM darts_users u LEFT JOIN flight_profiles p ON p.user_id=u.id WHERE u.id=?').bind(userId).first();
  const p = parse(r?.data, {}) || {};
  return clean(p.name || r?.display_name || String(r?.email || '').split('@')[0] || 'Your instructor', 80);
};
const shape = r => ({ id: r.id, kind: r.kind, fromStaff: !!r.from_staff, author: r.author_name || '', flightId: r.flight_id || null, at: r.created_at, read: !!r.read_at, ...parse(r.body, {}) });

// what each kind carries, validated
function bodyFor(kind, b) {
  if (kind === 'debrief') {
    const rating = RATINGS[b.rating] ? b.rating : 'on-track';
    const out = { rating, wentWell: clean(b.wentWell, 600), workOn: clean(b.workOn, 600), note: clean(b.note, 1200) };
    if (!out.wentWell && !out.workOn && !out.note) fail(400, 'Write at least one line of feedback.');
    return out;
  }
  if (kind === 'plan') {
    const lesson = clean(b.lesson, 120); if (!lesson) fail(400, 'Name the next lesson.');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : '';
    const prep = (Array.isArray(b.prep) ? b.prep : []).map(x => clean(x, 140)).filter(Boolean).slice(0, 10);
    return { lesson, date, prep, note: clean(b.note, 800) };
  }
  if (kind === 'signoff') {
    const itemId = clean(b.itemId, 40), sylId = clean(b.sylId, 40); if (!itemId || !sylId) fail(400, 'Choose a lesson to sign off.');
    return { sylId, itemId, itemName: clean(b.itemName, 120), status: ['d', 'p', ''].includes(b.status) ? b.status : 'd', note: clean(b.note, 400) };
  }
  const text = clean(b.text, 2000); if (!text) fail(400, 'Write a message first.');
  return { text };
}

// a few changes go into the student's own desk so they show up where the student already looks
async function applyToStudent(env, studentId, kind, body, author) {
  if (kind !== 'plan' && kind !== 'signoff') return;
  const row = await env.DB.prepare('SELECT data FROM flight_profiles WHERE user_id=?').bind(studentId).first();
  if (!row) return;
  const p = parse(row.data, {}) || {};
  if (kind === 'plan') {
    p.nextLesson = body.lesson; if (body.date) p.lessonDate = body.date;
    if (body.prep.length) {
      const keep = String(p.checklist || '').split('\n').map(l => l.trim()).filter(l => l && !/^\[x\]/i.test(l));
      const have = new Set(keep.map(l => l.replace(/^\[.\]\s?/, '').toLowerCase()));
      p.checklist = [...body.prep.filter(x => !have.has(x.toLowerCase())).map(x => `[ ] ${x}`), ...keep].join('\n').slice(0, 3000);
    }
  } else {
    const syl = parse(p.syllabus, {}) || {}; const cur = syl[body.sylId] || {};
    if (body.status) cur[body.itemId] = body.status; else delete cur[body.itemId];
    syl[body.sylId] = cur; p.syllabus = JSON.stringify(syl);
    const so = parse(p.signoffs, {}) || {}; const key = body.sylId + ':' + body.itemId;
    if (body.status === 'd') so[key] = { by: author, at: Date.now() }; else delete so[key];
    p.signoffs = JSON.stringify(so);
  }
  await env.DB.prepare('UPDATE flight_profiles SET data=?,updated_at=? WHERE user_id=?').bind(JSON.stringify(p), Date.now(), studentId).run();
}

// email at most once every 30 minutes per person per student thread, so a burst of edits doesn't flood anyone
async function mailOnce(env, to, key, subject, lines, cta, origin, fetcher) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !to) return false;
  const k = 'coachmail:' + key, last = +(await env.DB.prepare('SELECT v FROM flight_kv WHERE k=?').bind(k).first())?.v || 0;
  if (Date.now() - last < 30 * 60000) return false;
  await env.DB.prepare('INSERT INTO flight_kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(Date.now())).run();
  const html = `<main style="font-family:Arial,Helvetica,sans-serif;color:#0b1430;max-width:520px;line-height:1.5"><p style="font-size:20px;font-weight:700;margin:0 0 14px">${esc(subject)}</p>${lines.map(l => `<p style="margin:0 0 12px;white-space:pre-line">${esc(l)}</p>`).join('')}<p style="margin:20px 0"><a href="${origin}/flight-app.html${cta[1]}" style="display:inline-block;padding:12px 18px;background:#0a62ff;color:#fff;border-radius:12px;text-decoration:none;font-weight:700">${esc(cta[0])}</a></p><p style="font-size:12px;color:#5b6787;margin-top:28px">You’re getting this because you’re a member of a flight school on Boplo Flight.</p></main>`;
  const res = await fetcher('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }) }).catch(() => null);
  return !!res?.ok;
}
const emailOf = async (env, id) => (await env.DB.prepare('SELECT email FROM darts_users WHERE id=?').bind(id).first())?.email || '';

async function notify(env, item, schoolId, origin, fetcher) {
  const b = item.body, who = item.author_name;
  if (item.from_staff) {
    const what = item.kind === 'debrief' ? `${who} debriefed your flight` : item.kind === 'plan' ? `${who} set your next lesson: ${b.lesson}` : item.kind === 'signoff' ? (b.status === 'd' ? `${who} signed off ${b.itemName || 'a lesson'}` : `${who} updated ${b.itemName || 'your syllabus'}`) : `New message from ${who}`;
    const detail = item.kind === 'debrief' ? [RATINGS[b.rating], b.wentWell && 'Went well: ' + b.wentWell, b.workOn && 'Work on: ' + b.workOn, b.note].filter(Boolean).join('\n') : item.kind === 'plan' ? [b.date && 'Date: ' + b.date, b.prep.length && 'Prep:\n' + b.prep.map(x => '• ' + x).join('\n'), b.note].filter(Boolean).join('\n') : item.kind === 'msg' ? b.text : b.note || '';
    await pushTo(env, item.student_id, { title: what, body: detail.slice(0, 160), url: `${origin}/flight-app.html#school`, tag: 'coach-' + item.kind }).catch(() => 0);
    await mailOnce(env, await emailOf(env, item.student_id), item.student_id + ':' + item.kind, what, [detail], ['Open it in Boplo', '#school'], origin, fetcher).catch(() => { });
  } else {
    // a student's message goes to the instructors who coach them, or the whole staff if nobody has yet
    let staff = ((await env.DB.prepare('SELECT DISTINCT author_id id FROM flight_coach WHERE student_id=? AND from_staff=1').bind(item.student_id).all()).results || []).map(r => r.id);
    if (!staff.length) staff = ((await env.DB.prepare("SELECT user_id id FROM flight_school_members WHERE school_id=? AND role!='student'").bind(schoolId).all()).results || []).map(r => r.id);
    for (const id of staff.slice(0, 10)) {
      await pushTo(env, id, { title: `${who} sent you a message`, body: b.text.slice(0, 160), url: `${origin}/flight-app.html#school`, tag: 'coach-msg-' + item.student_id }).catch(() => 0);
      await mailOnce(env, await emailOf(env, id), id + ':' + item.student_id, `${who} sent you a message on Boplo`, [b.text], ['Reply in Boplo', '#school'], origin, fetcher).catch(() => { });
    }
  }
}

async function post(env, m, user, studentId, kind, input, origin, fetcher) {
  if (!KINDS.has(kind)) fail(400, 'Unknown kind of note.');
  const staff = isStaff(m);
  if (!staff && kind !== 'msg') fail(403, 'Only your instructors can do this.');
  const sm = await env.DB.prepare("SELECT role FROM flight_school_members WHERE user_id=? AND school_id=?").bind(studentId, m.school.id).first();
  if (!sm || sm.role !== 'student') fail(404, 'That student isn’t in your school.');
  const body = bodyFor(kind, input || {});
  let flightId = null;
  if (kind === 'debrief') {
    flightId = clean(input.flightId, 40);
    const f = await env.DB.prepare('SELECT id FROM flight_records WHERE id=? AND user_id=?').bind(flightId, studentId).first();
    if (!f) fail(404, 'That flight isn’t in this student’s logbook.');
  }
  const author = await nameOf(env, user.id), now = Date.now();
  // one debrief per flight per instructor: editing replaces it
  const prev = kind === 'debrief' ? await env.DB.prepare("SELECT id FROM flight_coach WHERE kind='debrief' AND flight_id=? AND author_id=?").bind(flightId, user.id).first() : null;
  const id = prev?.id || crypto.randomUUID();
  if (prev) await env.DB.prepare('UPDATE flight_coach SET body=?,created_at=?,read_at=NULL,author_name=? WHERE id=?').bind(JSON.stringify(body), now, author, id).run();
  else await env.DB.prepare('INSERT INTO flight_coach(id,school_id,student_id,author_id,author_name,from_staff,kind,flight_id,body,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id, m.school.id, studentId, user.id, author, staff ? 1 : 0, kind, flightId, JSON.stringify(body), now).run();
  await applyToStudent(env, studentId, kind, body, author);
  const item = { id, school_id: m.school.id, student_id: studentId, author_id: user.id, author_name: author, from_staff: staff ? 1 : 0, kind, flight_id: flightId, body, created_at: now };
  await notify(env, item, m.school.id, origin, fetcher).catch(e => console.error('coach notify', e?.message));
  return { item: shape({ ...item, body: JSON.stringify(body) }) };
}

// the thread for one student, oldest first; reading it marks the other side's notes read
export async function threadFor(env, schoolId, studentId, viewerIsStaff) {
  await ensureCoach(env);
  const rows = (await env.DB.prepare('SELECT * FROM flight_coach WHERE school_id=? AND student_id=? ORDER BY created_at DESC LIMIT 120').bind(schoolId, studentId).all()).results || [];
  await env.DB.prepare('UPDATE flight_coach SET read_at=? WHERE school_id=? AND student_id=? AND from_staff=? AND read_at IS NULL').bind(Date.now(), schoolId, studentId, viewerIsStaff ? 0 : 1).run();
  return rows.map(shape);
}
// per-student counts for the roster: unread messages from the student, recent flights with no debrief yet
export async function rosterCoach(env, schoolId) {
  await ensureCoach(env);
  const since = new Date(Date.now() - 21 * DAY).toISOString().slice(0, 10);
  const unread = (await env.DB.prepare('SELECT student_id, COUNT(*) n FROM flight_coach WHERE school_id=? AND from_staff=0 AND read_at IS NULL GROUP BY student_id').bind(schoolId).all()).results || [];
  const waiting = (await env.DB.prepare(`SELECT r.user_id student_id, COUNT(*) n FROM flight_records r JOIN flight_school_members m ON m.user_id=r.user_id AND m.school_id=? AND m.role='student' WHERE json_extract(r.data,'$.date')>=? AND json_extract(r.data,'$.role')='dual' AND NOT EXISTS (SELECT 1 FROM flight_coach c WHERE c.kind='debrief' AND c.flight_id=r.id) GROUP BY r.user_id`).bind(schoolId, since).all()).results || [];
  const last = (await env.DB.prepare('SELECT student_id, MAX(created_at) t FROM flight_coach WHERE school_id=? AND from_staff=1 GROUP BY student_id').bind(schoolId).all()).results || [];
  const out = {};
  for (const r of unread) (out[r.student_id] ||= {}).unread = r.n;
  for (const r of waiting) (out[r.student_id] ||= {}).toDebrief = r.n;
  for (const r of last) (out[r.student_id] ||= {}).lastCoached = r.t;
  return out;
}

// routes: staff post under school/coach, students read and reply under coach
export async function coachRoutes(env, path, method, user, m, body, origin, fetcher = fetch) {
  if (!path.startsWith('coach') && path !== 'school/coach') return null;
  await ensureCoach(env);
  if (!m || !ACTIVE.has(m.school.status)) fail(403, 'Coaching needs an active school plan.');
  if (path === 'school/coach' && method === 'POST') { if (!isStaff(m)) fail(403, 'Only your school’s instructors can do this.'); const b = await body(); return post(env, m, user, clean(b?.studentId, 80), b?.kind, b, origin, fetcher); }
  if (m.role !== 'student') return null;
  if (path === 'coach' && method === 'GET') {
    const items = await threadFor(env, m.school.id, user.id, false);
    return { items, school: m.school.name };
  }
  if (path === 'coach/count' && method === 'GET') {
    const r = await env.DB.prepare('SELECT COUNT(*) n FROM flight_coach WHERE school_id=? AND student_id=? AND from_staff=1 AND read_at IS NULL').bind(m.school.id, user.id).first();
    const dbf = ((await env.DB.prepare("SELECT flight_id, body, author_name FROM flight_coach WHERE student_id=? AND kind='debrief' ORDER BY created_at DESC LIMIT 200").bind(user.id).all()).results || []).map(x => ({ flightId: x.flight_id, author: x.author_name, ...parse(x.body, {}) }));
    const lt = await env.DB.prepare('SELECT * FROM flight_coach WHERE school_id=? AND student_id=? AND from_staff=1 ORDER BY created_at DESC LIMIT 1').bind(m.school.id, user.id).first();
    return { unread: r?.n || 0, debriefs: dbf, latest: lt ? shape(lt) : null, school: m.school.name };
  }
  if (path === 'coach/msg' && method === 'POST') return post(env, m, user, user.id, 'msg', await body(), origin, fetcher);
  return null;
}

// ---------- weekly digest for instructors (called from the daily cron; sends at most once a week each) ----------
const hex = buf => [...new Uint8Array(buf)].map(n => n.toString(16).padStart(2, '0')).join('');
export async function digestToken(env, userId) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.CRON_SECRET || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('digest-off:' + userId))).slice(0, 32);
}
export async function digestOff(env, url) {
  const u = url.searchParams.get('u') || '', t = url.searchParams.get('t') || '';
  if (!env.CRON_SECRET || !u || t !== await digestToken(env, u)) return new Response('This link isn’t valid any more.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  await ensureCoach(env);
  await env.DB.prepare('INSERT INTO flight_kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('digestoff:' + u, '1').run();
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Weekly summary off</title><body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#0b1430"><h1 style="font-size:22px">Your weekly summary is off.</h1><p>You won’t get the weekly student summary from Boplo any more. Your school dashboard still shows everything.</p></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
// pure: what one instructor's digest says, or null when there's nothing worth sending
export function buildDigest({ school, students, now = Date.now() }) {
  const today = new Date(now).toISOString().slice(0, 10), week = new Date(now + 7 * DAY).toISOString().slice(0, 10);
  const gap = d => d ? Math.round((Date.parse(today) - Date.parse(d)) / DAY) : null;
  const quiet = students.filter(s => s.setup && (s.last ? gap(s.last) >= 14 : (now - s.joinedAt) > 10 * DAY)).sort((a, b) => (gap(b.last) ?? 999) - (gap(a.last) ?? 999));
  const waiting = students.filter(s => s.toDebrief > 0), unread = students.filter(s => s.unread > 0);
  const soon = students.filter(s => s.lessonDate && s.lessonDate >= today && s.lessonDate <= week).sort((a, b) => a.lessonDate.localeCompare(b.lessonDate));
  const notStarted = students.filter(s => !s.setup);
  if (!quiet.length && !waiting.length && !unread.length && !soon.length) return null;
  const sec = [];
  if (unread.length) sec.push(['Messages waiting for a reply', unread.map(s => `${s.name}: ${s.unread} message${s.unread === 1 ? '' : 's'}`)]);
  if (waiting.length) sec.push(['Flights to debrief', waiting.map(s => `${s.name}: ${s.toDebrief} dual flight${s.toDebrief === 1 ? '' : 's'} with no debrief`)]);
  if (quiet.length) sec.push(['Students who’ve gone quiet', quiet.slice(0, 12).map(s => s.last ? `${s.name}: last flew ${gap(s.last)} days ago` : `${s.name}: no flights logged since joining`)]);
  if (soon.length) sec.push(['Lessons this week', soon.map(s => `${s.name}: ${s.nextLesson || 'lesson'} on ${new Date(s.lessonDate + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`)]);
  if (notStarted.length) sec.push(['Joined but not set up', [`${notStarted.length} student${notStarted.length === 1 ? '' : 's'} joined ${school} but haven’t set up their desk yet.`]]);
  const n = unread.length + waiting.length + quiet.length;
  return { subject: n ? `${school}: ${n} student${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you this week` : `${school}: your week on Boplo`, sections: sec };
}
export async function runDigest(env, { origin = 'https://boplo.app', now = Date.now(), fetcher = fetch } = {}) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { digests: 0 };
  if (new Date(now).getUTCDay() !== 1) return { digests: 0 }; // Mondays only
  await ensureCoach(env);
  const schools = ((await env.DB.prepare('SELECT id,name,status FROM flight_schools').all()).results || []).filter(s => ACTIVE.has(s.status));
  let sent = 0;
  for (const s of schools) {
    const members = (await env.DB.prepare('SELECT m.user_id id, m.role, m.joined_at, u.email, u.display_name, p.data FROM flight_school_members m JOIN darts_users u ON u.id=m.user_id LEFT JOIN flight_profiles p ON p.user_id=m.user_id WHERE m.school_id=?').bind(s.id).all()).results || [];
    const last = Object.fromEntries(((await env.DB.prepare("SELECT r.user_id, MAX(json_extract(r.data,'$.date')) d FROM flight_records r JOIN flight_school_members m ON m.user_id=r.user_id WHERE m.school_id=? GROUP BY r.user_id").bind(s.id).all()).results || []).map(r => [r.user_id, r.d]));
    const co = await rosterCoach(env, s.id);
    const students = members.filter(x => x.role === 'student').map(x => { const p = parse(x.data, {}) || {}; return { id: x.id, name: clean(p.name || x.display_name || String(x.email).split('@')[0], 60), setup: !!p.complete, last: last[x.id] || '', joinedAt: x.joined_at, nextLesson: p.nextLesson || '', lessonDate: p.lessonDate || '', unread: co[x.id]?.unread || 0, toDebrief: co[x.id]?.toDebrief || 0 }; });
    const d = buildDigest({ school: s.name, students, now }); if (!d) continue;
    for (const st of members.filter(x => x.role !== 'student' && x.email)) {
      const key = 'digest:' + st.id;
      const prev = +(await env.DB.prepare('SELECT v FROM flight_kv WHERE k=?').bind(key).first())?.v || 0;
      if (now - prev < 6.5 * DAY) continue;
      if ((await env.DB.prepare('SELECT v FROM flight_kv WHERE k=?').bind('digestoff:' + st.id).first())) continue;
      const off = `${origin}/flight/digest/off?u=${encodeURIComponent(st.id)}&t=${await digestToken(env, st.id)}`;
      const html = `<main style="font-family:Arial,Helvetica,sans-serif;color:#0b1430;max-width:560px;line-height:1.5"><p style="font-size:20px;font-weight:700;margin:0 0 6px">${esc(d.subject)}</p><p style="margin:0 0 18px;color:#5b6787">Your weekly summary from Boplo.</p>${d.sections.map(([h, items]) => `<p style="font-weight:700;margin:18px 0 6px">${esc(h)}</p><ul style="margin:0;padding-left:18px">${items.map(i => `<li style="margin:0 0 4px">${esc(i)}</li>`).join('')}</ul>`).join('')}<p style="margin:24px 0"><a href="${origin}/flight-app.html#school" style="display:inline-block;padding:12px 18px;background:#0a62ff;color:#fff;border-radius:12px;text-decoration:none;font-weight:700">Open your school dashboard</a></p><p style="font-size:12px;color:#5b6787;margin-top:28px">You’re getting this because you’re an instructor at ${esc(s.name)} on Boplo Flight. <a href="${off}" style="color:#5b6787">Stop the weekly summary</a>.</p></main>`;
      const res = await fetcher('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [st.email], subject: d.subject, html, headers: { 'List-Unsubscribe': `<${off}>` } }) }).catch(() => null);
      if (!res?.ok) continue;
      await env.DB.prepare('INSERT INTO flight_kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(key, String(now)).run();
      sent++;
    }
  }
  return { digests: sent };
}
