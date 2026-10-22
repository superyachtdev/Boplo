// Community: a Q&A board, simulator landing leaderboards with a daily challenge, and a directory of students
// near your home airfield with private messages. People appear as first name + home airfield + licence.
// Everything is created lazily in D1. Rate limits are per user per UTC day.

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => Date.now();
const day = () => new Date().toISOString().slice(0, 10);
const weekOf = (t = new Date()) => { const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const LIMITS = { questions: 8, answers: 40, messages: 60, reports: 30 };
export const TOPICS = [['general', 'General'], ['training', 'Training and lessons'], ['exams', 'Theory exams'], ['checkride', 'Skill test and checkride'], ['radio', 'Radio'], ['navigation', 'Navigation'], ['weather', 'Weather'], ['aircraft', 'Aircraft'], ['costs', 'Costs and schools'], ['medical', 'Medicals']];
const TOPIC_IDS = TOPICS.map(t => t[0]);

// mild language filter: mask the worst words rather than reject the post
const BAD = ['fuck', 'shit', 'cunt', 'bitch', 'bastard', 'dick', 'wanker', 'twat', 'slut', 'whore', 'nigger', 'faggot', 'retard'];
const mask = t => t.replace(new RegExp(`\\b(${BAD.join('|')})\\w*`, 'gi'), m => m[0] + '*'.repeat(m.length - 1));
const noLinksSpam = t => (t.match(/https?:\/\//g) || []).length > 3;

let ready = null;
export function ensure(env) {
  if (!ready) ready = env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS community_ids (user_id TEXT PRIMARY KEY, pid TEXT UNIQUE NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS community_posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, parent_id TEXT, title TEXT, body TEXT NOT NULL, topic TEXT, score INTEGER NOT NULL DEFAULT 0, answers INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS community_posts_parent ON community_posts(parent_id, created_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS community_votes (user_id TEXT NOT NULL, post_id TEXT NOT NULL, v INTEGER NOT NULL, PRIMARY KEY (user_id, post_id))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS community_reports (user_id TEXT NOT NULL, post_id TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, post_id))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS community_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (user_id, day, kind))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sim_scores (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ap TEXT NOT NULL, rw TEXT, kind TEXT NOT NULL, week TEXT NOT NULL, day TEXT NOT NULL, challenge INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL, fpm INTEGER, td INTEGER, cl REAL, kt INTEGER, aircraft TEXT, created_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS sim_scores_board ON sim_scores(ap, kind, week)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS sim_scores_day ON sim_scores(challenge, day)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS community_msgs (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS community_msgs_to ON community_msgs(to_id, created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS community_msgs_from ON community_msgs(from_id, created_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS community_blocks (user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, PRIMARY KEY (user_id, blocked_id))')
  ]).catch(e => { ready = null; throw e; });
  return ready;
}

async function pidOf(env, userId) {
  const row = await env.DB.prepare('SELECT pid FROM community_ids WHERE user_id=?').bind(userId).first();
  if (row) return row.pid;
  const pid = [...crypto.getRandomValues(new Uint8Array(8))].map(n => n.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT OR IGNORE INTO community_ids(user_id,pid) VALUES(?,?)').bind(userId, pid).run();
  return (await env.DB.prepare('SELECT pid FROM community_ids WHERE user_id=?').bind(userId).first()).pid;
}
async function userOfPid(env, pid) {
  if (!/^[a-f0-9]{16}$/.test(String(pid || ''))) fail(404, 'That pilot wasn’t found.');
  const row = await env.DB.prepare('SELECT user_id FROM community_ids WHERE pid=?').bind(pid).first();
  if (!row) fail(404, 'That pilot wasn’t found.'); return row.user_id;
}
async function use(env, userId, kind) {
  const r = await env.DB.prepare('SELECT n FROM community_usage WHERE user_id=? AND day=? AND kind=?').bind(userId, day(), kind).first();
  if ((r?.n || 0) >= LIMITS[kind]) fail(429, `You’ve reached today’s limit for ${kind}. Try again tomorrow.`);
  await env.DB.prepare('INSERT INTO community_usage(user_id,day,kind,n) VALUES(?,?,?,1) ON CONFLICT(user_id,day,kind) DO UPDATE SET n=n+1').bind(userId, day(), kind).run();
}
// public identity: first name, home airfield code, licence
const who = (data, pid) => { let p = {}; try { p = JSON.parse(data || '{}'); } catch { } return { pid, name: String(p.name || 'Pilot').trim().split(/\s+/)[0].slice(0, 24) || 'Pilot', airfield: String(p.airport || '').split(/[\s·]/)[0].toUpperCase().slice(0, 8), licence: String(p.licence || '').slice(0, 40) }; };
async function people(env, ids) {
  const u = [...new Set(ids)].filter(Boolean); if (!u.length) return {};
  const out = {};
  for (let i = 0; i < u.length; i += 50) {
    const chunk = u.slice(i, i + 50), q = chunk.map(() => '?').join(',');
    const rows = (await env.DB.prepare(`SELECT p.user_id, p.data, c.pid FROM flight_profiles p LEFT JOIN community_ids c ON c.user_id=p.user_id WHERE p.user_id IN (${q})`).bind(...chunk).all()).results || [];
    for (const r of rows) out[r.user_id] = who(r.data, r.pid || null);
  }
  return out;
}
const blockedSet = async (env, userId) => new Set(((await env.DB.prepare('SELECT blocked_id FROM community_blocks WHERE user_id=? UNION SELECT user_id FROM community_blocks WHERE blocked_id=?').bind(userId, userId).all()).results || []).map(r => r.blocked_id || r.user_id));

/* ---------------- Q&A ---------------- */
async function listQuestions(env, user, url) {
  const topic = url.searchParams.get('topic'), sort = url.searchParams.get('sort') === 'top' ? 'top' : url.searchParams.get('sort') === 'open' ? 'open' : 'new';
  const q = clean(url.searchParams.get('q'), 80).toLowerCase();
  let sql = 'SELECT id,user_id,title,body,topic,score,answers,created_at,last_at FROM community_posts WHERE parent_id IS NULL AND hidden=0', args = [];
  if (topic && TOPIC_IDS.includes(topic)) { sql += ' AND topic=?'; args.push(topic); }
  if (q) { sql += ' AND (lower(title) LIKE ? OR lower(body) LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  if (sort === 'open') sql += ' AND answers=0';
  sql += sort === 'top' ? ' ORDER BY score DESC, created_at DESC' : ' ORDER BY last_at DESC';
  sql += ' LIMIT 60';
  const rows = (await env.DB.prepare(sql).bind(...args).all()).results || [];
  const blocked = await blockedSet(env, user.id), ppl = await people(env, rows.map(r => r.user_id));
  const votes = rows.length ? Object.fromEntries(((await env.DB.prepare(`SELECT post_id,v FROM community_votes WHERE user_id=? AND post_id IN (${rows.map(() => '?').join(',')})`).bind(user.id, ...rows.map(r => r.id)).all()).results || []).map(r => [r.post_id, r.v])) : {};
  return { topics: TOPICS, questions: rows.filter(r => !blocked.has(r.user_id)).map(r => ({ id: r.id, title: r.title, excerpt: r.body.slice(0, 220), topic: r.topic, score: r.score, answers: r.answers, at: r.created_at, last: r.last_at, mine: r.user_id === user.id, my: votes[r.id] || 0, by: ppl[r.user_id] || who('{}', null) })) };
}
async function getQuestion(env, user, id, owner) {
  const qn = await env.DB.prepare('SELECT * FROM community_posts WHERE id=? AND parent_id IS NULL').bind(id).first();
  if (!qn || (qn.hidden && !owner && qn.user_id !== user.id)) fail(404, 'That question was removed or doesn’t exist.');
  const ans = (await env.DB.prepare('SELECT * FROM community_posts WHERE parent_id=? AND (hidden=0 OR user_id=?) ORDER BY score DESC, created_at ASC LIMIT 200').bind(id, user.id).all()).results || [];
  const all = [qn, ...ans], blocked = await blockedSet(env, user.id), ppl = await people(env, all.map(r => r.user_id));
  const votes = Object.fromEntries(((await env.DB.prepare(`SELECT post_id,v FROM community_votes WHERE user_id=? AND post_id IN (${all.map(() => '?').join(',')})`).bind(user.id, ...all.map(r => r.id)).all()).results || []).map(r => [r.post_id, r.v]));
  const view = r => ({ id: r.id, title: r.title, body: r.body, topic: r.topic, score: r.score, answers: r.answers, at: r.created_at, mine: r.user_id === user.id, my: votes[r.id] || 0, hidden: !!r.hidden, reports: owner ? r.reports : undefined, by: ppl[r.user_id] || who('{}', null) });
  return { question: view(qn), answers: ans.filter(r => !blocked.has(r.user_id)).map(view) };
}
async function ask(env, user, input) {
  const title = mask(clean(input.title, 140)), body = mask(clean(input.body, 3000)), topic = TOPIC_IDS.includes(input.topic) ? input.topic : 'general';
  if (title.length < 8) fail(400, 'Give your question a title of at least a few words.');
  if (noLinksSpam(body)) fail(400, 'Too many links in one post.');
  await use(env, user.id, 'questions'); await pidOf(env, user.id);
  const id = crypto.randomUUID(), t = now();
  await env.DB.prepare('INSERT INTO community_posts(id,user_id,parent_id,title,body,topic,created_at,last_at) VALUES(?,?,NULL,?,?,?,?,?)').bind(id, user.id, title, body, topic, t, t).run();
  return { id };
}
async function answer(env, user, qid, input) {
  const body = mask(clean(input.body, 3000)); if (body.length < 2) fail(400, 'Write an answer first.');
  if (noLinksSpam(body)) fail(400, 'Too many links in one post.');
  const qn = await env.DB.prepare('SELECT id,hidden FROM community_posts WHERE id=? AND parent_id IS NULL').bind(qid).first(); if (!qn || qn.hidden) fail(404, 'That question was removed.');
  await use(env, user.id, 'answers'); await pidOf(env, user.id);
  const id = crypto.randomUUID(), t = now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO community_posts(id,user_id,parent_id,title,body,topic,created_at,last_at) VALUES(?,?,?,NULL,?,NULL,?,?)').bind(id, user.id, qid, body, t, t),
    env.DB.prepare('UPDATE community_posts SET answers=answers+1,last_at=? WHERE id=?').bind(t, qid)
  ]);
  return { id };
}
async function vote(env, user, input) {
  const v = [1, 0, -1].includes(+input.v) ? +input.v : 0, id = String(input.id || '');
  const post = await env.DB.prepare('SELECT id,user_id FROM community_posts WHERE id=?').bind(id).first(); if (!post) fail(404, 'Post not found.');
  if (post.user_id === user.id) fail(400, 'You can’t vote on your own post.');
  const prev = (await env.DB.prepare('SELECT v FROM community_votes WHERE user_id=? AND post_id=?').bind(user.id, id).first())?.v || 0;
  if (prev === v) return { score: (await env.DB.prepare('SELECT score FROM community_posts WHERE id=?').bind(id).first()).score, my: v };
  await env.DB.batch([
    v ? env.DB.prepare('INSERT INTO community_votes(user_id,post_id,v) VALUES(?,?,?) ON CONFLICT(user_id,post_id) DO UPDATE SET v=excluded.v').bind(user.id, id, v) : env.DB.prepare('DELETE FROM community_votes WHERE user_id=? AND post_id=?').bind(user.id, id),
    env.DB.prepare('UPDATE community_posts SET score=score+? WHERE id=?').bind(v - prev, id)
  ]);
  return { score: (await env.DB.prepare('SELECT score FROM community_posts WHERE id=?').bind(id).first()).score, my: v };
}
async function report(env, user, input) {
  const id = String(input.id || ''), reason = clean(input.reason, 200);
  const post = await env.DB.prepare('SELECT id FROM community_posts WHERE id=?').bind(id).first(); if (!post) fail(404, 'Post not found.');
  await use(env, user.id, 'reports');
  const r = await env.DB.prepare('INSERT OR IGNORE INTO community_reports(user_id,post_id,reason,created_at) VALUES(?,?,?,?)').bind(user.id, id, reason, now()).run();
  // three separate reports hide a post until the owner reviews it
  if (r.meta?.changes) await env.DB.prepare('UPDATE community_posts SET reports=reports+1, hidden=CASE WHEN reports+1>=3 THEN 1 ELSE hidden END WHERE id=?').bind(id).run();
  return { ok: true };
}
async function removePost(env, user, id, owner) {
  const post = await env.DB.prepare('SELECT id,user_id,parent_id FROM community_posts WHERE id=?').bind(id).first(); if (!post) fail(404, 'Post not found.');
  if (post.user_id !== user.id && !owner) fail(403, 'You can only delete your own posts.');
  const ops = [env.DB.prepare('DELETE FROM community_posts WHERE id=? OR parent_id=?').bind(id, id), env.DB.prepare('DELETE FROM community_votes WHERE post_id=?').bind(id)];
  if (post.parent_id) ops.push(env.DB.prepare('UPDATE community_posts SET answers=MAX(0,answers-1) WHERE id=?').bind(post.parent_id));
  await env.DB.batch(ops); return { ok: true };
}
async function moderation(env, owner) {
  if (!owner) fail(403, 'Only the owner can see reports.');
  const rows = (await env.DB.prepare('SELECT id,user_id,parent_id,title,body,reports,hidden,created_at FROM community_posts WHERE reports>0 ORDER BY hidden DESC, reports DESC LIMIT 100').all()).results || [];
  const ppl = await people(env, rows.map(r => r.user_id));
  return { posts: rows.map(r => ({ id: r.id, parent: r.parent_id, title: r.title, body: r.body.slice(0, 400), reports: r.reports, hidden: !!r.hidden, at: r.created_at, by: ppl[r.user_id] })) };
}
async function restore(env, id, owner) { if (!owner) fail(403, 'Only the owner can restore posts.'); await env.DB.prepare('UPDATE community_posts SET hidden=0, reports=0 WHERE id=?').bind(id).run(); await env.DB.prepare('DELETE FROM community_reports WHERE post_id=?').bind(id).run(); return { ok: true }; }

/* ---------------- landing leaderboards and the daily challenge ---------------- */
// a rotating list of airfields with a runway and a condition; everyone gets the same one each UTC day
const CHALLENGES = [
  ['LPMA', 'Madeira', 32.6979, -16.7745, 'PT', '05', 'gusty'], ['LEVC', 'Valencia', 39.4893, -0.4816, 'ES', '12', 'fair'], ['EGHP', 'Popham', 51.1939, -1.2347, 'GB', '26', 'scattered'],
  ['LXGB', 'Gibraltar', 36.1512, -5.3497, 'GI', '27', 'gusty'], ['KSEZ', 'Sedona', 34.8486, -111.7884, 'US', '03', 'clear'], ['LEMD', 'Madrid-Barajas', 40.4719, -3.5626, 'ES', '32L', 'hazy'],
  ['EGLC', 'London City', 51.5053, 0.0553, 'GB', '27', 'broken'], ['LOWI', 'Innsbruck', 47.2602, 11.3439, 'AT', '26', 'scattered'], ['KPAO', 'Palo Alto', 37.4611, -122.1150, 'US', '31', 'fair'],
  ['EIDW', 'Dublin', 53.4213, -6.2701, 'IE', '28L', 'overcast'], ['LFMN', 'Nice', 43.6584, 7.2159, 'FR', '04L', 'clear'], ['NZQN', 'Queenstown', -45.0211, 168.7392, 'NZ', '23', 'gusty'],
  ['EGJB', 'Guernsey', 49.4350, -2.6020, 'GG', '27', 'broken'], ['LEIB', 'Ibiza', 38.8729, 1.3731, 'ES', '06', 'fair'], ['KOSH', 'Oshkosh', 43.9844, -88.5570, 'US', '27', 'clear'],
  ['EDDF', 'Frankfurt', 50.0333, 8.5706, 'DE', '25C', 'overcast'], ['LSZA', 'Lugano', 46.0040, 8.9106, 'CH', '01', 'scattered'], ['YSSY', 'Sydney', -33.9461, 151.1772, 'AU', '34L', 'fair'],
  ['EGPE', 'Inverness', 57.5425, -4.0475, 'GB', '23', 'gusty'], ['LEBL', 'Barcelona', 41.2971, 2.0785, 'ES', '24R', 'hazy'], ['CYVR', 'Vancouver', 49.1939, -123.1844, 'CA', '26R', 'broken']
];
export function challengeFor(dateISO = day()) {
  const n = Math.floor(Date.parse(dateISO + 'T00:00:00Z') / 864e5), c = CHALLENGES[((n * 7) % CHALLENGES.length + CHALLENGES.length) % CHALLENGES.length];
  return { date: dateISO, code: c[0], name: c[1], lat: c[2], lng: c[3], cc: c[4], runway: c[5], weather: c[6], kind: 'short' };
}
async function submitScore(env, user, input) {
  const kind = ['short', 'long', 'circuit'].includes(input.kind) ? input.kind : fail(400, 'Only landings are scored.');
  const ap = clean(input.ap, 8).toUpperCase(); if (!/^[A-Z0-9-]{3,8}$/.test(ap)) fail(400, 'Unknown airfield.');
  const score = Math.round(+input.score); if (!(score >= 0 && score <= 100)) fail(400, 'Invalid score.');
  const t = now(), dd = day(), wk = weekOf(), ch = !!input.challenge && challengeFor(dd).code === ap ? 1 : 0;
  // keep it fair: at most 60 scored landings a day per pilot
  const cnt = (await env.DB.prepare('SELECT COUNT(*) n FROM sim_scores WHERE user_id=? AND day=?').bind(user.id, dd).first())?.n || 0; if (cnt >= 60) fail(429, 'That’s enough landings for today.');
  await pidOf(env, user.id);
  const num = (v, a, b) => Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : null;
  await env.DB.prepare('INSERT INTO sim_scores(id,user_id,ap,rw,kind,week,day,challenge,score,fpm,td,cl,kt,aircraft,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), user.id, ap, clean(input.rw, 4).toUpperCase(), kind, wk, dd, ch, score, num(input.fpm, -3000, 500), num(input.td, -2000, 5000), num(input.cl, 0, 500), num(input.kt, 0, 300), clean(input.aircraft, 40), t).run();
  const board = await leaderboard(env, user, { ap, kind, period: 'week' });
  const daily = ch ? await leaderboard(env, user, { challenge: true }) : null;
  return { me: board.me, total: board.rows.length, daily: daily?.me || null };
}
async function leaderboard(env, user, o) {
  let sql, args;
  if (o.challenge) { sql = 'SELECT user_id, MAX(score) best, MIN(created_at) at, aircraft FROM sim_scores WHERE challenge=1 AND day=? GROUP BY user_id ORDER BY best DESC, at ASC LIMIT 100'; args = [o.day || day()]; }
  else {
    const ap = clean(o.ap, 8).toUpperCase(), kind = ['short', 'long', 'circuit'].includes(o.kind) ? o.kind : 'short';
    sql = `SELECT user_id, MAX(score) best, MIN(created_at) at, aircraft FROM sim_scores WHERE ap=? AND kind=?${o.period === 'all' ? '' : ' AND week=?'} GROUP BY user_id ORDER BY best DESC, at ASC LIMIT 100`;
    args = o.period === 'all' ? [ap, kind] : [ap, kind, weekOf()];
  }
  const rows = (await env.DB.prepare(sql).bind(...args).all()).results || [];
  const ppl = await people(env, rows.map(r => r.user_id));
  const list = rows.map((r, i) => ({ rank: i + 1, score: r.best, aircraft: r.aircraft, by: ppl[r.user_id] || who('{}', null), me: r.user_id === user.id }));
  return { rows: list.slice(0, 50), me: list.find(r => r.me) || null };
}
async function boards(env, user, url) {
  const ap = clean(url.searchParams.get('ap'), 8).toUpperCase(), kind = url.searchParams.get('kind') || 'short', period = url.searchParams.get('period') === 'all' ? 'all' : 'week';
  const ch = challengeFor();
  const [daily, local, mine, busy] = await Promise.all([
    leaderboard(env, user, { challenge: true }),
    ap ? leaderboard(env, user, { ap, kind, period }) : null,
    env.DB.prepare('SELECT ap, kind, MAX(score) best, COUNT(*) n FROM sim_scores WHERE user_id=? GROUP BY ap, kind ORDER BY best DESC LIMIT 12').bind(user.id).all(),
    env.DB.prepare('SELECT ap, COUNT(DISTINCT user_id) pilots, MAX(score) best FROM sim_scores WHERE week=? GROUP BY ap ORDER BY pilots DESC, best DESC LIMIT 10').bind(weekOf()).all()
  ]);
  return { challenge: ch, daily, local, week: weekOf(), mine: mine.results || [], busy: busy.results || [] };
}

/* ---------------- students nearby and messages ---------------- */
const km = (a, b, c, d) => { const R = Math.PI / 180, h = Math.sin((c - a) * R / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin((d - b) * R / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
async function nearby(env, user) {
  const me = await env.DB.prepare('SELECT data FROM flight_profiles WHERE user_id=?').bind(user.id).first(); let mp = {}; try { mp = JSON.parse(me?.data || '{}'); } catch { }
  const lat = +mp.homeLat, lng = +mp.homeLng;
  const rows = (await env.DB.prepare("SELECT p.user_id, p.data, c.pid FROM flight_profiles p LEFT JOIN community_ids c ON c.user_id=p.user_id WHERE json_extract(p.data,'$.dirOn')=1 AND p.user_id<>? LIMIT 3000").bind(user.id).all()).results || [];
  const blocked = await blockedSet(env, user.id);
  const out = [];
  for (const r of rows) {
    if (blocked.has(r.user_id)) continue; let p = {}; try { p = JSON.parse(r.data); } catch { continue; }
    const d = Number.isFinite(lat) && Number.isFinite(+p.homeLat) ? km(lat, lng, +p.homeLat, +p.homeLng) : null;
    if (d != null && d > 250) continue;
    const pid = r.pid || await pidOf(env, r.user_id);
    out.push({ ...who(r.data, pid), school: String(p.school || '').slice(0, 60), bio: String(p.dirBio || '').slice(0, 160), km: d == null ? null : Math.round(d), sameField: !!(p.airport && mp.airport && String(p.airport).split(/[\s·]/)[0].toUpperCase() === String(mp.airport).split(/[\s·]/)[0].toUpperCase()) });
  }
  out.sort((a, b) => (b.sameField - a.sameField) || ((a.km ?? 1e9) - (b.km ?? 1e9)));
  return { listed: mp.dirOn === true, located: Number.isFinite(lat), people: out.slice(0, 80), pid: await pidOf(env, user.id) };
}
async function threads(env, user) {
  const rows = (await env.DB.prepare('SELECT from_id,to_id,body,created_at,read FROM community_msgs WHERE from_id=? OR to_id=? ORDER BY created_at DESC LIMIT 500').bind(user.id, user.id).all()).results || [];
  const blocked = await blockedSet(env, user.id), by = new Map();
  for (const m of rows) { const other = m.from_id === user.id ? m.to_id : m.from_id; if (blocked.has(other)) continue; const t = by.get(other) || { last: m, unread: 0 }; if (m.to_id === user.id && !m.read) t.unread++; by.set(other, t); }
  const ppl = await people(env, [...by.keys()]);
  const list = []; for (const [other, t] of by) list.push({ with: ppl[other] || who('{}', await pidOf(env, other)), last: t.last.body.slice(0, 120), at: t.last.created_at, mine: t.last.from_id === user.id, unread: t.unread });
  for (const t of list) if (!t.with.pid) t.with.pid = null;
  return { threads: list, unread: list.reduce((a, t) => a + t.unread, 0) };
}
async function thread(env, user, pid) {
  const other = await userOfPid(env, pid);
  const rows = (await env.DB.prepare('SELECT id,from_id,body,created_at FROM community_msgs WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at ASC LIMIT 300').bind(user.id, other, other, user.id).all()).results || [];
  await env.DB.prepare('UPDATE community_msgs SET read=1 WHERE to_id=? AND from_id=? AND read=0').bind(user.id, other).run();
  const ppl = await people(env, [other]), blocked = (await env.DB.prepare('SELECT 1 FROM community_blocks WHERE user_id=? AND blocked_id=?').bind(user.id, other).first()) != null;
  return { with: ppl[other] || who('{}', pid), blocked, messages: rows.map(m => ({ id: m.id, mine: m.from_id === user.id, body: m.body, at: m.created_at })) };
}
async function send(env, user, pid, input) {
  const other = await userOfPid(env, pid); if (other === user.id) fail(400, 'That’s you.');
  const body = mask(clean(input.body, 1500)); if (!body) fail(400, 'Write a message first.');
  const blocked = await env.DB.prepare('SELECT 1 FROM community_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)').bind(user.id, other, other, user.id).first(); if (blocked) fail(403, 'You can’t message this pilot.');
  // you can start a conversation with someone in the directory, or reply to someone who wrote to you
  const listed = await env.DB.prepare("SELECT 1 FROM flight_profiles WHERE user_id=? AND json_extract(data,'$.dirOn')=1").bind(other).first();
  const wrote = await env.DB.prepare('SELECT 1 FROM community_msgs WHERE from_id=? AND to_id=? LIMIT 1').bind(other, user.id).first();
  if (!listed && !wrote) fail(403, 'This pilot isn’t taking new messages.');
  await use(env, user.id, 'messages'); await pidOf(env, user.id);
  await env.DB.prepare('INSERT INTO community_msgs(id,from_id,to_id,body,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), user.id, other, body, now()).run();
  return { ok: true };
}
async function block(env, user, pid, on) {
  const other = await userOfPid(env, pid);
  if (on) await env.DB.prepare('INSERT OR IGNORE INTO community_blocks(user_id,blocked_id) VALUES(?,?)').bind(user.id, other).run();
  else await env.DB.prepare('DELETE FROM community_blocks WHERE user_id=? AND blocked_id=?').bind(user.id, other).run();
  return { ok: true };
}

// router: path is everything after "community/"
export async function community(env, request, url, user, owner, readBody) {
  await ensure(env);
  const p = url.pathname.replace(/^\/flight\/community\/?/, ''), m = request.method;
  if (p === 'posts' && m === 'GET') return listQuestions(env, user, url);
  if (p === 'posts' && m === 'POST') return ask(env, user, await readBody());
  let x;
  if ((x = p.match(/^posts\/([a-f0-9-]{36})$/))) { if (m === 'GET') return getQuestion(env, user, x[1], owner); if (m === 'DELETE') return removePost(env, user, x[1], owner); }
  if ((x = p.match(/^posts\/([a-f0-9-]{36})\/answers$/)) && m === 'POST') return answer(env, user, x[1], await readBody());
  if ((x = p.match(/^posts\/([a-f0-9-]{36})\/restore$/)) && m === 'POST') return restore(env, x[1], owner);
  if (p === 'vote' && m === 'POST') return vote(env, user, await readBody());
  if (p === 'report' && m === 'POST') return report(env, user, await readBody());
  if (p === 'moderation' && m === 'GET') return moderation(env, owner);
  if (p === 'boards' && m === 'GET') return boards(env, user, url);
  if (p === 'scores' && m === 'POST') return submitScore(env, user, await readBody());
  if (p === 'people' && m === 'GET') return nearby(env, user);
  if (p === 'msgs' && m === 'GET') return threads(env, user);
  if ((x = p.match(/^msgs\/([a-f0-9]{16})$/))) { if (m === 'GET') return thread(env, user, x[1]); if (m === 'POST') return send(env, user, x[1], await readBody()); }
  if ((x = p.match(/^block\/([a-f0-9]{16})$/))) { if (m === 'POST') return block(env, user, x[1], true); if (m === 'DELETE') return block(env, user, x[1], false); }
  fail(404, 'Not found.');
}
