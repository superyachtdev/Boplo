// Owner analytics: cookie-free visit counting, sign-up source attribution and the business stats behind /owner.html.
// Visits store no IP or cookie. A visitor is a hash of (daily random salt + IP + browser), so the same person counts
// once a day, and once a day's salt is deleted the hashes can't be linked to anyone.
import { isOwner, PLANS } from './billing.js';
import { SCHOOL_PLANS } from './schools.js';

const DAY = 864e5;
const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|go-http|node-fetch|axios|vercel|cloudflare/i;
const clean = (v, max) => String(v ?? '').trim().slice(0, max).replace(/[^\w\-./:@ ]/g, '');
let ready;
const ensure = env => ready || (ready = env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS site_hits (day TEXT NOT NULL, ts INTEGER NOT NULL, path TEXT, ref TEXT, src TEXT, country TEXT, device TEXT, vh TEXT)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS site_hits_day ON site_hits(day)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS flight_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS flight_attrib (user_id TEXT PRIMARY KEY, src TEXT, ref TEXT, landing TEXT, created_at INTEGER NOT NULL)')
]).catch(e => { ready = null; throw e; }));
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 12).map(n => n.toString(16).padStart(2, '0')).join('');
// a referrer becomes a short source name, so TikTok's many domains count as one
export function sourceOf(ref, utm) {
  const u = clean(utm, 40).toLowerCase(); if (u) return u.replace(/^(tt|tik)$/, 'tiktok');
  const h = clean(ref, 120).toLowerCase().replace(/^www\./, ''); if (!h) return 'direct';
  for (const [k, re] of [['tiktok', /tiktok/], ['instagram', /instagram|ig\.me/], ['facebook', /facebook|fb\.com|fb\.me/], ['youtube', /youtube|youtu\.be/], ['google', /^google\.|\.google\./], ['bing', /bing\.com/], ['duckduckgo', /duckduckgo/], ['reddit', /reddit/], ['x', /^(t\.co|x\.com|twitter\.com)$/], ['linkedin', /linkedin|lnkd\.in/], ['chatgpt', /chatgpt|openai/]]) if (re.test(h)) return k;
  return h;
}

export async function recordHit(env, request) {
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BOTS.test(ua)) return new Response(null, { status: 204 });
  const raw = await request.text(); if (raw.length > 2000) return new Response(null, { status: 204 });
  let b; try { b = JSON.parse(raw); } catch { return new Response(null, { status: 204 }); }
  await ensure(env);
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  let salt = (await env.DB.prepare('SELECT v FROM flight_kv WHERE k=?').bind('hitsalt:' + day).first())?.v;
  if (!salt) {
    salt = crypto.randomUUID();
    await env.DB.prepare('INSERT OR IGNORE INTO flight_kv(k,v) VALUES(?,?)').bind('hitsalt:' + day, salt).run();
    salt = (await env.DB.prepare('SELECT v FROM flight_kv WHERE k=?').bind('hitsalt:' + day).first())?.v || salt;
    // yesterday's salt is no longer needed; old visit rows are trimmed after 400 days
    const old = new Date(now - 2 * DAY).toISOString().slice(0, 10);
    await env.DB.prepare("DELETE FROM flight_kv WHERE k LIKE 'hitsalt:%' AND k < ?").bind('hitsalt:' + old).run().catch(() => { });
    await env.DB.prepare('DELETE FROM site_hits WHERE ts < ?').bind(now - 400 * DAY).run().catch(() => { });
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const vh = await sha(salt + '|' + ip + '|' + ua);
  const path = clean(b.p, 80).split('?')[0] || '/';
  const ref = clean(b.r, 120).toLowerCase().replace(/^www\./, '');
  const src = sourceOf(ref, b.s);
  const country = clean(request.cf?.country || request.headers.get('CF-IPCountry') || '', 2).toUpperCase();
  const device = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';
  await env.DB.prepare('INSERT INTO site_hits(day,ts,path,ref,src,country,device,vh) VALUES(?,?,?,?,?,?,?,?)').bind(day, now, path, ref, src, country, device, vh).run();
  return new Response(null, { status: 204 });
}

// the first source a signed-in person arrived from, sent once by the app
export async function saveAttrib(env, user, b) {
  await ensure(env);
  const ref = clean(b?.r, 120).toLowerCase().replace(/^www\./, '');
  await env.DB.prepare('INSERT OR IGNORE INTO flight_attrib(user_id,src,ref,landing,created_at) VALUES(?,?,?,?,?)').bind(user.id, sourceOf(ref, b?.s), ref, clean(b?.l, 80), Date.now()).run();
  return { ok: true };
}

const safe = async (p, d) => { try { return await p; } catch { return d; } };
const all = (env, q, ...a) => safe(env.DB.prepare(q).bind(...a).all().then(r => r.results || []), []);
const one = (env, q, ...a) => safe(env.DB.prepare(q).bind(...a).first(), null);

export async function ownerStats(env, user, url) {
  if (!isOwner(env, user)) throw Object.assign(new Error('Not allowed.'), { status: 403 });
  await ensure(env);
  const days = [7, 30, 90, 365].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 30;
  const now = Date.now(), since = now - days * DAY, sinceDay = new Date(since + DAY).toISOString().slice(0, 10);
  const prevSince = since - days * DAY, prevDay = new Date(prevSince + DAY).toISOString().slice(0, 10);
  const owners = String(env.OWNER_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const ownerIds = owners.length ? (await all(env, `SELECT id FROM darts_users WHERE lower(email) IN (${owners.map(() => '?').join(',')})`, ...owners)).map(r => r.id) : [];
  const notOwner = (col) => ownerIds.length ? ` AND ${col} NOT IN (${ownerIds.map(() => '?').join(',')})` : '';
  const O = ownerIds;
  // Flight users = anyone with a Flight desk; sign-up time is when their Boplo account was made
  const U = `FROM flight_profiles p JOIN darts_users u ON u.id=p.user_id WHERE 1=1${notOwner('p.user_id')}`;

  const [visitDaily, visitTot, visitPrev, pages, sources, countries, devices,
    signDaily, users, signPrev, onboarded, logged, billing, schools, members, attrib, attribAll, recent,
    profiles, active7, active30, flightsN, askN, simN, scoresN, postsN, leadsN, leads] = await Promise.all([
    all(env, 'SELECT day, COUNT(*) views, COUNT(DISTINCT vh) visitors FROM site_hits WHERE day>=? GROUP BY day ORDER BY day', sinceDay),
    one(env, 'SELECT COUNT(*) views, COUNT(DISTINCT vh||day) visitors FROM site_hits WHERE day>=?', sinceDay),
    one(env, 'SELECT COUNT(*) views, COUNT(DISTINCT vh||day) visitors FROM site_hits WHERE day>=? AND day<?', prevDay, sinceDay),
    all(env, 'SELECT path k, COUNT(*) n FROM site_hits WHERE day>=? GROUP BY path ORDER BY n DESC LIMIT 8', sinceDay),
    all(env, 'SELECT src k, COUNT(DISTINCT vh||day) n FROM site_hits WHERE day>=? GROUP BY src ORDER BY n DESC LIMIT 10', sinceDay),
    all(env, "SELECT country k, COUNT(DISTINCT vh||day) n FROM site_hits WHERE day>=? AND country<>'' GROUP BY country ORDER BY n DESC LIMIT 10", sinceDay),
    all(env, 'SELECT device k, COUNT(DISTINCT vh||day) n FROM site_hits WHERE day>=? GROUP BY device ORDER BY n DESC', sinceDay),
    all(env, `SELECT strftime('%Y-%m-%d', u.created_at/1000, 'unixepoch') day, COUNT(*) n ${U} AND u.created_at>=? GROUP BY day ORDER BY day`, ...O, since),
    one(env, `SELECT COUNT(*) total, SUM(CASE WHEN u.created_at>=? THEN 1 ELSE 0 END) recent ${U}`, since, ...O),
    one(env, `SELECT COUNT(*) n ${U} AND u.created_at>=? AND u.created_at<?`, ...O, prevSince, since),
    one(env, `SELECT COUNT(*) n ${U} AND json_extract(p.data,'$.complete')=1`, ...O),
    one(env, `SELECT COUNT(DISTINCT r.user_id) n FROM flight_records r WHERE 1=1${notOwner('r.user_id')}`, ...O),
    all(env, `SELECT status, price_key, cancel_at_period_end c, updated_at FROM flight_billing WHERE 1=1${notOwner('user_id')}`, ...O),
    all(env, 'SELECT id, name, plan, status, cancel_at_period_end c, current_period_end, created_at FROM flight_schools ORDER BY created_at DESC'),
    all(env, 'SELECT school_id, role, COUNT(*) n FROM flight_school_members GROUP BY school_id, role'),
    all(env, `SELECT a.src k, COUNT(*) n FROM flight_attrib a JOIN darts_users u ON u.id=a.user_id WHERE u.created_at>=?${notOwner('a.user_id')} GROUP BY a.src ORDER BY n DESC LIMIT 10`, since, ...O),
    all(env, `SELECT a.src k, COUNT(*) n, SUM(CASE WHEN b.status IN ('active','trialing','past_due') THEN 1 ELSE 0 END) paid FROM flight_attrib a LEFT JOIN flight_billing b ON b.user_id=a.user_id WHERE 1=1${notOwner('a.user_id')} GROUP BY a.src ORDER BY n DESC LIMIT 10`, ...O),
    all(env, `SELECT u.email, u.display_name name, u.created_at, json_extract(p.data,'$.country') country, json_extract(p.data,'$.licence') licence, json_extract(p.data,'$.complete') complete, b.status, b.price_key, a.src, (SELECT COUNT(*) FROM flight_records r WHERE r.user_id=p.user_id) flights ${U.replace('WHERE 1=1', 'LEFT JOIN flight_billing b ON b.user_id=p.user_id LEFT JOIN flight_attrib a ON a.user_id=p.user_id WHERE 1=1')} ORDER BY u.created_at DESC LIMIT 25`, ...O),
    all(env, `SELECT json_extract(p.data,'$.country') country, json_extract(p.data,'$.authority') authority, json_extract(p.data,'$.licence') licence ${U}`, ...O),
    one(env, `SELECT COUNT(DISTINCT user_id) n FROM (SELECT user_id FROM flight_profiles WHERE updated_at>=?1 UNION SELECT user_id FROM flight_records WHERE updated_at>=?1 UNION SELECT user_id FROM darts_sessions WHERE created_at>=?1)${ownerIds.length ? ` WHERE user_id NOT IN (${O.map((_, i) => '?' + (i + 2)).join(',')})` : ''}`, now - 7 * DAY, ...O),
    one(env, `SELECT COUNT(DISTINCT user_id) n FROM (SELECT user_id FROM flight_profiles WHERE updated_at>=?1 UNION SELECT user_id FROM flight_records WHERE updated_at>=?1 UNION SELECT user_id FROM darts_sessions WHERE created_at>=?1)${ownerIds.length ? ` WHERE user_id NOT IN (${O.map((_, i) => '?' + (i + 2)).join(',')})` : ''}`, now - 30 * DAY, ...O),
    one(env, `SELECT COUNT(*) n FROM flight_records WHERE created_at>=?${notOwner('user_id')}`, since, ...O),
    one(env, `SELECT SUM(n) n FROM flight_ai_usage WHERE day>=?${notOwner('user_id')}`, sinceDay, ...O),
    one(env, `SELECT SUM(n) n FROM flight_sim_free WHERE day>=?${notOwner('user_id')}`, sinceDay, ...O),
    one(env, `SELECT COUNT(*) n FROM sim_scores WHERE created_at>=?${notOwner('user_id')}`, since, ...O),
    one(env, `SELECT COUNT(*) n FROM community_posts WHERE created_at>=?${notOwner('user_id')}`, since, ...O),
    one(env, 'SELECT COUNT(*) n FROM flight_school_leads WHERE created_at>=?', since),
    all(env, 'SELECT name, email, school, country, students, created_at FROM flight_school_leads ORDER BY created_at DESC LIMIT 5')
  ]);

  // plans: who pays, how, and what it's worth
  const live = s => ['active', 'trialing', 'past_due'].includes(s);
  const subs = { monthly: 0, yearly: 0, pastDue: 0, cancelling: 0, cancelled: 0 };
  for (const b of billing) {
    if (live(b.status)) { subs[b.price_key === 'yearly' ? 'yearly' : 'monthly']++; if (b.status === 'past_due') subs.pastDue++; if (b.c) subs.cancelling++; }
    else if (b.status === 'canceled' && b.updated_at >= since) subs.cancelled++;
  }
  const mem = {}; for (const m of members) { (mem[m.school_id] ||= { student: 0, instructor: 0, admin: 0 })[m.role] = m.n; }
  const schoolRows = schools.map(s => ({ name: s.name, plan: SCHOOL_PLANS[s.plan]?.label || s.plan, status: s.status, cancelling: !!s.c, renews: s.current_period_end, created: s.created_at, students: mem[s.id]?.student || 0, instructors: (mem[s.id]?.instructor || 0) + (mem[s.id]?.admin || 0) }));
  const liveSchools = schools.filter(s => live(s.status));
  const schoolMembers = liveSchools.reduce((t, s) => t + (mem[s.id]?.student || 0) + (mem[s.id]?.instructor || 0) + (mem[s.id]?.admin || 0), 0);
  const mrr = Math.round(subs.monthly * PLANS.monthly.amount + subs.yearly * PLANS.yearly.amount / 12 + liveSchools.reduce((t, s) => t + (SCHOOL_PLANS[s.plan]?.amount || 0) / 12, 0)) / 100;
  const totalUsers = users?.total || 0, paid = subs.monthly + subs.yearly;
  const free = Math.max(0, totalUsers - paid - schoolMembers);

  const tally = (rows, key) => { const m = {}; for (const r of rows) { const k = String(r[key] || '').trim() || 'Not set'; m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ k, n })); };

  // fill in empty days so the charts have a continuous time axis
  const series = [];
  const vMap = Object.fromEntries(visitDaily.map(r => [r.day, r])), sMap = Object.fromEntries(signDaily.map(r => [r.day, r.n]));
  for (let t = since + DAY; t <= now + 1; t += DAY) { const d = new Date(t).toISOString().slice(0, 10); series.push({ day: d, views: vMap[d]?.views || 0, visitors: vMap[d]?.visitors || 0, signups: sMap[d] || 0 }); }

  return {
    days, generated: now, trackingSince: (await one(env, 'SELECT MIN(day) d FROM site_hits'))?.d || null,
    visits: { views: visitTot?.views || 0, visitors: visitTot?.visitors || 0, prevVisitors: visitPrev?.visitors || 0, pages, sources, countries, devices },
    signups: { recent: users?.recent || 0, prev: signPrev?.n || 0, total: totalUsers, onboarded: onboarded?.n || 0, logged: logged?.n || 0, bySource: attrib, sourceTotals: attribAll },
    series,
    plans: { free, monthly: subs.monthly, yearly: subs.yearly, schoolMembers, pastDue: subs.pastDue, cancelling: subs.cancelling, cancelled: subs.cancelled, mrr, arr: Math.round(mrr * 12) },
    schools: schoolRows,
    usage: { active7: active7?.n || 0, active30: active30?.n || 0, flights: flightsN?.n || 0, ask: askN?.n || 0, simFree: simN?.n || 0, simScores: scoresN?.n || 0, posts: postsN?.n || 0 },
    users: { countries: tally(profiles, 'country'), authorities: tally(profiles, 'authority'), licences: tally(profiles, 'licence'), recent },
    leads: { recent: leadsN?.n || 0, latest: leads }
  };
}
