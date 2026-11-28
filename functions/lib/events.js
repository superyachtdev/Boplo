// Boplo's own usage events, for the owner's retention dashboard (/retention.html).
// The iPhone app and the web app send which screen people open and a few named moments (onboarding done,
// purchase started, and so on) to POST /flight/events. The server adds subscription changes it hears
// from Apple and Stripe. Nothing goes to a third party. Events older than 400 days are deleted.

import { isOwner } from './billing.js';

const DAY = 864e5;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const NAME = /^[a-z0-9_.:-]{1,60}$/;
const PLATFORMS = ['ios', 'web'];

const ready = new WeakMap();
export function ensureEvents(env) {
  let p = ready.get(env.DB);
  if (!p) ready.set(env.DB, p = env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS flight_events (id INTEGER PRIMARY KEY AUTOINCREMENT, device TEXT, user_id TEXT, sid TEXT, ts INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, props TEXT, platform TEXT, app_version TEXT)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS flight_events_ts ON flight_events(ts)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS flight_events_device ON flight_events(device, ts)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS flight_events_user ON flight_events(user_id, ts)')
  ]).catch(e => { ready.delete(env.DB); throw e; }));
  return p;
}

function cleanProps(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {};
  for (const [k, v] of Object.entries(p).slice(0, 8)) {
    if (!/^[a-z0-9_]{1,24}$/i.test(k)) continue;
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 80);
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

// POST /flight/events { device, platform, v, events: [{ t, k: 'screen'|'event', n, s, p }] }
// Works signed in or out; userId is the signed-in account, if any.
export async function ingestEvents(env, input, userId = null, now = Date.now()) {
  const device = String(input?.device || '');
  if (!/^[a-z0-9-]{8,64}$/i.test(device)) fail(400, 'Bad device.');
  const platform = PLATFORMS.includes(input?.platform) ? input.platform : fail(400, 'Bad platform.');
  const version = String(input?.v || '').slice(0, 24) || null;
  const list = Array.isArray(input?.events) ? input.events.slice(0, 100) : fail(400, 'Send a list of events.');
  await ensureEvents(env);
  // a runaway client can't fill the table: 4,000 events a day per install
  const today = (await env.DB.prepare('SELECT COUNT(*) n FROM flight_events WHERE device=? AND ts>?').bind(device, now - DAY).first())?.n || 0;
  if (today > 4000) return { ok: true, stored: 0, capped: true };
  const rows = [];
  for (const e of list) {
    const ts = Math.round(Number(e?.t));
    if (!Number.isFinite(ts) || ts < now - 14 * DAY || ts > now + 3600e3) continue;
    const kind = e?.k === 'screen' ? 'screen' : e?.k === 'event' ? 'event' : null;
    const name = String(e?.n || '');
    if (!kind || !NAME.test(name)) continue;
    const sid = String(e?.s || '').slice(0, 40) || null;
    rows.push(env.DB.prepare('INSERT INTO flight_events(device,user_id,sid,ts,kind,name,props,platform,app_version) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(device, userId, sid, ts, kind, name, cleanProps(e?.p), platform, version));
  }
  if (rows.length) await env.DB.batch(rows);
  if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM flight_events WHERE ts<?').bind(now - 400 * DAY).run().catch(() => { });
  return { ok: true, stored: rows.length };
}

// A subscription change Apple or Stripe told the server about. Never throws: billing must not fail over analytics.
export async function serverEvent(env, userId, name, props = null, now = Date.now()) {
  if (!userId || !env?.DB) return;
  try {
    await ensureEvents(env);
    await env.DB.prepare('INSERT INTO flight_events(device,user_id,sid,ts,kind,name,props,platform,app_version) VALUES(NULL,?,NULL,?,?,?,?,?,NULL)')
      .bind(userId, now, 'server', String(name).toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 60), cleanProps(props), 'server').run();
  } catch { }
}

// ---------- the report ----------

// The iPhone app's first-run screens, in order.
export const IOS_PATH = [
  ['welcome', 'Welcome'], ['q_country', 'Country'], ['q_goal', 'Licence goal'], ['q_stage', 'Where they are'], ['q_struggles', 'What’s hardest'],
  ['q_pace', 'How often'], ['q_lesson', 'Next lesson'], ['q_heard', 'Heard about Boplo'], ['plan', 'Their plan'], ['commit', 'Commitment'],
  ['reminders', 'Reminders'], ['save_plan', 'Save your plan (sign in)'], ['building_desk', 'Building the desk'], ['trial_gate', 'Trial offer'], ['desk', 'Desk']
];
export const WEB_PATH = [
  ['welcome', 'Welcome'], ['q_where', 'Country'], ['q_goal', 'Licence goal'], ['q_stage', 'Where they are'], ['q_struggles', 'What’s hardest'],
  ['q_pace', 'How often'], ['q_lesson', 'Next lesson'], ['q_heard', 'Heard about Boplo'], ['q_plan', 'Their plan'], ['q_commit', 'Commitment'],
  ['save_plan', 'Save your plan (sign in)'], ['trial_gate', 'Trial offer'], ['checkout', 'Card details'], ['overview', 'Desk']
];
export const LABELS = {
  welcome: 'Welcome', q_country: 'Q: country', q_where: 'Q: country', q_goal: 'Q: licence goal', q_stage: 'Q: where they are', q_struggles: 'Q: what’s hardest', q_pace: 'Q: how often',
  q_lesson: 'Q: next lesson', q_heard: 'Q: heard about Boplo', plan: 'Their plan', q_plan: 'Their plan', commit: 'Commitment', q_commit: 'Commitment', reminders: 'Reminders', save_plan: 'Save your plan', q_name: 'Q: name',
  intro_1: 'Intro 1', intro_2: 'Intro 2', intro_3: 'Intro 3', sign_in: 'Sign in', onb_name: 'Onboarding: name', onb_country: 'Onboarding: country',
  onb_goal: 'Onboarding: licence goal', onb_pace: 'Onboarding: how often', onb_hours: 'Onboarding: hours so far', building_desk: 'Building your desk',
  trial_gate: 'Trial offer', checkout: 'Card details', desk: 'Desk', overview: 'Desk', logbook: 'Logbook', log_flight: 'Log a flight', flight_detail: 'A flight',
  study: 'Study', quiz: 'Quiz', ask_boplo: 'Ask Boplo', ask: 'Ask Boplo', mock_checkride: 'Mock checkride', fly: 'Fly tab', simulator: 'Simulator', sim: 'Simulator',
  sortie: 'Daily sortie', radio: 'Radio practice', weather: 'Weather', preflight: 'Preflight', nav_log: 'Nav log', navlog: 'Nav log', progress: 'Progress',
  budget: 'Costs', currency: 'Currency', prepare: 'Lesson prep', community: 'Community', community_question: 'Community question', community_ask: 'Ask the community',
  leaderboards: 'Leaderboards', school: 'School', live_traffic: 'Live traffic', you: 'You tab', more: 'You tab', profile: 'Profile', plans: 'Paywall',
  plan: 'Plan & billing', plan_billing: 'Plan & billing', app_icon: 'App icon', ai_features: 'AI features', ai_consent: 'AI consent', milestone: 'Milestone', map: 'Flight map', analytics: 'Flight analytics',
  setup_name: 'Setup: name', setup_where: 'Setup: country', setup_goal: 'Setup: goal', setup_pace: 'Setup: how often', setup_fly: 'Setup: aircraft', setup_cost: 'Setup: hourly cost',
  setup_hours: 'Setup: hours', setup_review: 'Setup: review', trial_gate_skip: 'Skipped trial offer', yearly_upgrade: 'Yearly upgrade card', other: 'Other'
};
const nameOf = s => LABELS[s] || String(s || '').replace(/_/g, ' ');

// Screens grouped into the features people would recognise.
export const FEATURES = {
  'Logbook': ['logbook', 'log_flight', 'flight_detail', 'flights', 'map', 'analytics'],
  'Study and quizzes': ['study', 'quiz'],
  'Ask Boplo': ['ask_boplo', 'ask'],
  'Mock checkride': ['mock_checkride', 'checkride'],
  'Simulator': ['simulator', 'fly', 'sim'],
  'Daily sortie': ['sortie'],
  'Radio practice': ['radio'],
  'Weather and planning': ['weather', 'preflight', 'nav_log', 'navlog', 'plan'],
  'Progress and costs': ['progress', 'budget', 'currency'],
  'Lesson prep': ['prepare', 'lesson'],
  'Community': ['community', 'community_question', 'community_ask', 'leaderboards', 'school'],
  'Live traffic': ['live_traffic', 'traffic']
};
const featureOf = s => Object.keys(FEATURES).find(k => FEATURES[k].includes(s)) || null;

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : null;
const dayOf = ts => Math.floor(ts / DAY);
const parse = s => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

// Apple sends e.g. SUBSCRIBED/INITIAL_BUY, DID_CHANGE_RENEWAL_STATUS/AUTO_RENEW_DISABLED, DID_RENEW, EXPIRED/VOLUNTARY
const isTrialStart = (n, p) => (n.startsWith('apple_subscribed') && p.trial !== false) || n === 'stripe_trialing';
const isPaidStart = (n, p) => (n.startsWith('apple_subscribed') && p.trial === false) || n.startsWith('apple_did_renew') || n === 'stripe_active';
const isCancel = n => n === 'apple_did_change_renewal_status_auto_renew_disabled' || n === 'stripe_cancel_on';
const isUncancel = n => n === 'apple_did_change_renewal_status_auto_renew_enabled' || n === 'stripe_cancel_off';
const isLapse = n => n.startsWith('apple_expired') || n.startsWith('apple_did_fail_to_renew') || n === 'stripe_canceled' || n === 'stripe_past_due';

// GET /flight/owner/retention?days=30&platform=all|ios|web
export async function retention(env, user, url, now = Date.now()) {
  if (!isOwner(env, user)) fail(403, 'Not allowed.');
  await ensureEvents(env);
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days')) || 30));
  const want = ['ios', 'web'].includes(url.searchParams.get('platform')) ? url.searchParams.get('platform') : 'all';
  const since = now - days * DAY;

  // who each install belongs to, and when each person was first seen (all time)
  const links = (await env.DB.prepare('SELECT device, MAX(user_id) u FROM flight_events WHERE device IS NOT NULL AND user_id IS NOT NULL GROUP BY device').all()).results || [];
  const owner = new Map(links.map(r => [r.device, r.u]));
  const keyOf = r => r.user_id || (r.device && owner.get(r.device)) || 'd:' + r.device;
  const firsts = new Map();
  for (const r of (await env.DB.prepare('SELECT device, MIN(ts) f, MAX(platform) p FROM flight_events WHERE device IS NOT NULL GROUP BY device').all()).results || []) {
    const k = owner.get(r.device) || 'd:' + r.device; if (!firsts.has(k) || firsts.get(k) > r.f) firsts.set(k, r.f);
  }
  for (const r of (await env.DB.prepare("SELECT user_id, MIN(ts) f FROM flight_events WHERE user_id IS NOT NULL AND platform!='server' GROUP BY user_id").all()).results || [])
    if (!firsts.has(r.user_id) || firsts.get(r.user_id) > r.f) firsts.set(r.user_id, r.f);

  const rows = (await env.DB.prepare('SELECT device,user_id,sid,ts,kind,name,props,platform FROM flight_events WHERE ts>=? ORDER BY ts LIMIT 250000').bind(since).all()).results || [];
  const people = new Map();
  const person = k => {
    let p = people.get(k);
    if (!p) people.set(k, p = { key: k, first: firsts.get(k) ?? null, platform: null, days: new Set(), screens: new Map(), events: new Map(), sessions: new Map(), last: 0, lastScreen: null, signedIn: !k.startsWith('d:'), trialAt: null, cancelAt: null, paidAt: null, lapseAt: null, plan: null });
    return p;
  };
  for (const r of rows) {
    const server = r.platform === 'server';
    if (!server && want !== 'all' && r.platform !== want) continue;
    const p = person(keyOf(r));
    if (server) {
      const sp = parse(r.props);
      if (isTrialStart(r.name, sp) && !p.trialAt) p.trialAt = r.ts;
      if (isPaidStart(r.name, sp) && !p.paidAt) p.paidAt = r.ts;
      if (isCancel(r.name) && !p.cancelAt) p.cancelAt = r.ts;
      if (isUncancel(r.name)) p.cancelAt = null;
      if (isLapse(r.name)) p.lapseAt = r.ts;
      if (sp.plan) p.plan = sp.plan;
      p.events.set(r.name, (p.events.get(r.name) || 0) + 1);
      continue;
    }
    p.platform = p.platform || r.platform;
    if (p.first == null || r.ts < p.first) p.first = r.ts;
    p.days.add(dayOf(r.ts)); p.last = Math.max(p.last, r.ts);
    const props = parse(r.props);
    if (r.kind === 'screen') { p.screens.set(r.name, (p.screens.get(r.name) || 0) + 1); p.lastScreen = r.name; }
    else {
      p.events.set(r.name, (p.events.get(r.name) || 0) + 1);
      if (r.name === 'purchase_success' || r.name === 'checkout_done') { p.plan = props.plan || p.plan; if (props.trial !== false && !p.trialAt) p.trialAt = r.ts; if (props.trial === false && !p.paidAt) p.paidAt = r.ts; }
    }
    const sid = r.sid || 'none';
    let s = p.sessions.get(sid);
    if (!s) p.sessions.set(sid, s = { start: r.ts, end: r.ts, list: [] });
    s.end = r.ts; s.list.push(r);
  }
  const all = [...people.values()].filter(p => p.platform);
  const fresh = all.filter(p => p.first != null && p.first >= since);

  // ---- funnels: new people in the period, step by step ----
  const has = (p, s) => p.screens.has(s);
  const ev = (p, e) => p.events.has(e);
  const funnelOf = steps => {
    const list = fresh.filter(p => steps.platform === 'any' || p.platform === steps.platform);
    let prev = list.length;
    return steps.list.map(([label, test], i) => {
      const n = list.filter(test).length; const out = { label, n, ofStart: pct(n, list.length), ofPrev: i ? pct(n, prev) : 100 }; prev = n; return out;
    });
  };
  const started = p => !!p.trialAt || ev(p, 'purchase_success') || ev(p, 'checkout_done');
  const funnels = {};
  if (want !== 'web') funnels.ios = funnelOf({ platform: 'ios', list: [
    ['Opened the app', () => true], ['Answered the questions', p => ev(p, 'questions_done')], ['Committed to the plan', p => ev(p, 'committed')], ['Reached sign-in', p => has(p, 'save_plan') || has(p, 'sign_in')], ['Signed in', p => p.signedIn],
    ['Finished onboarding', p => ev(p, 'onboarding_done')], ['Saw the trial offer', p => has(p, 'trial_gate')], ['Started a trial or plan', started],
    ['Paid after the trial', p => !!p.paidAt]] });
  if (want !== 'ios') funnels.web = funnelOf({ platform: 'web', list: [
    ['Opened the web app', () => true], ['Answered the questions', p => ev(p, 'questions_done')], ['Reached sign-in', p => has(p, 'save_plan') || has(p, 'sign_in')], ['Signed in', p => p.signedIn], ['Finished setup', p => ev(p, 'onboarding_done') || has(p, 'overview')],
    ['Saw the trial offer', p => has(p, 'trial_gate')], ['Started checkout', p => ev(p, 'checkout_start')], ['Started a trial or plan', started],
    ['Paid after the trial', p => !!p.paidAt]] });

  // ---- first-run path: how many reached each screen ----
  const pathOf = (path, platform) => {
    const list = fresh.filter(p => p.platform === platform);
    // a screen nobody saw while later ones were seen isn't part of the path (skipped, or not in that version)
    const seen = path.map(([s, label]) => ({ screen: s, label, n: list.filter(p => has(p, s)).length }));
    const kept = seen.filter((x, i) => x.n || !seen.slice(i + 1).some(y => y.n));
    return kept.map((x, i) => ({ ...x, ofStart: pct(x.n, list.length), drop: i ? Math.max(0, kept[i - 1].n - x.n) : null }));
  };
  const paths = {};
  if (want !== 'web') paths.ios = pathOf(IOS_PATH, 'ios');
  if (want !== 'ios') paths.web = pathOf(WEB_PATH, 'web');

  // ---- screens: views, time on screen, and how often the visit ended there ----
  const screenStats = new Map();
  const stat = s => { let x = screenStats.get(s); if (!x) screenStats.set(s, x = { screen: s, views: 0, people: new Set(), exits: 0, dwell: [] }); return x; };
  const closedOn = new Map();
  let sessionCount = 0; const sessionLengths = [];
  for (const p of all) for (const s of p.sessions.values()) {
    const scr = s.list.filter(r => r.kind === 'screen');
    for (let i = 0; i < s.list.length; i++) {
      const r = s.list[i]; if (r.kind !== 'screen') continue;
      const x = stat(r.name); x.views++; x.people.add(p.key);
      const next = s.list.slice(i + 1).find(n => n.ts > r.ts);
      if (next) x.dwell.push(Math.min(600, (next.ts - r.ts) / 1000));
    }
    if (!scr.length) continue;
    sessionCount++; sessionLengths.push(Math.min(3600, (s.end - s.start) / 1000));
    if (s.end < now - 30 * 60e3) { const last = scr[scr.length - 1].name; stat(last).exits++; closedOn.set(last, (closedOn.get(last) || 0) + 1); }
  }
  const screens = [...screenStats.values()].map(x => ({ screen: x.screen, views: x.views, people: x.people.size, exits: x.exits, exitRate: pct(x.exits, x.views), secs: x.dwell.length ? Math.round(median(x.dwell)) : null }))
    .sort((a, b) => b.views - a.views);
  const ended = [...closedOn.values()].reduce((a, b) => a + b, 0);
  const closed = [...closedOn.entries()].map(([screen, n]) => ({ screen, n, share: pct(n, ended) })).sort((a, b) => b.n - a.n).slice(0, 15);

  // ---- left for good: no visit in 7 days ----
  const goneList = all.filter(p => p.last && p.last < now - 7 * DAY);
  const goneMap = new Map(); for (const p of goneList) if (p.lastScreen) goneMap.set(p.lastScreen, (goneMap.get(p.lastScreen) || 0) + 1);
  const gone = { people: goneList.length, of: all.length, screens: [...goneMap.entries()].map(([screen, n]) => ({ screen, n, share: pct(n, goneList.length) })).sort((a, b) => b.n - a.n).slice(0, 12),
    afterDays: (() => { const b = { 'Same day': 0, '1–2 days': 0, '3–6 days': 0, '1–2 weeks': 0, '2+ weeks': 0 }; for (const p of goneList) { const d = (p.last - p.first) / DAY; b[d < 1 ? 'Same day' : d < 3 ? '1–2 days' : d < 7 ? '3–6 days' : d < 14 ? '1–2 weeks' : '2+ weeks']++; } return Object.entries(b).map(([label, n]) => ({ label, n })); })() };

  // ---- retention: of new people, who came back on day N or later ----
  const back = n => { const elig = fresh.filter(p => p.first + n * DAY <= now); const k = elig.filter(p => [...p.days].some(d => d >= dayOf(p.first) + n)).length; return { day: n, n: elig.length, back: k, rate: pct(k, elig.length) }; };
  const returning = [1, 3, 7, 14, 30].map(back);
  const weekStart = ts => { const d = new Date(dayOf(ts) * DAY); const w = (d.getUTCDay() + 6) % 7; return new Date((dayOf(ts) - w) * DAY).toISOString().slice(0, 10); };
  const cohortMap = new Map();
  for (const p of fresh) { const w = weekStart(p.first); if (!cohortMap.has(w)) cohortMap.set(w, []); cohortMap.get(w).push(p); }
  const cohorts = [...cohortMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([week, list]) => ({
    week, n: list.length,
    weeks: [1, 2, 3, 4].map(w => { const elig = list.filter(p => p.first + w * 7 * DAY <= now); if (!elig.length) return null; return pct(elig.filter(p => [...p.days].some(d => d - dayOf(p.first) >= (w - 1) * 7 + 1 && d - dayOf(p.first) <= w * 7)).length, elig.length); })
  }));

  // ---- daily active people ----
  const dailyMap = new Map();
  for (const p of all) for (const d of p.days) { if (d < dayOf(since)) continue; const x = dailyMap.get(d) || { n: 0, fresh: 0 }; x.n++; if (d === dayOf(p.first)) x.fresh++; dailyMap.set(d, x); }
  const daily = []; for (let d = dayOf(since) + 1; d <= dayOf(now); d++) { const x = dailyMap.get(d) || { n: 0, fresh: 0 }; daily.push({ day: new Date(d * DAY).toISOString().slice(0, 10), active: x.n, new: x.fresh }); }

  // ---- what kept people: features used in the first 3 days, by who came back a week later ----
  const settled = fresh.filter(p => p.first + 8 * DAY <= now && p.signedIn);
  const kept = settled.filter(p => [...p.days].some(d => d >= dayOf(p.first) + 7)), lost = settled.filter(p => !kept.includes(p));
  const early = p => { const f = new Set(); for (const s of p.sessions.values()) for (const r of s.list) if (r.kind === 'screen' && r.ts < p.first + 3 * DAY) { const k = featureOf(r.name); if (k) f.add(k); } return f; };
  const earlyKept = kept.map(early), earlyLost = lost.map(early);
  const features = Object.keys(FEATURES).map(name => {
    const a = earlyKept.filter(f => f.has(name)).length, b = earlyLost.filter(f => f.has(name)).length;
    const rk = pct(a, kept.length), rl = pct(b, lost.length);
    return { name, kept: rk, lost: rl, lift: rk != null && rl ? Math.round(rk / rl * 10) / 10 : null, keptN: a, lostN: b };
  }).filter(f => f.keptN || f.lostN).sort((x, y) => (y.kept ?? 0) - (x.kept ?? 0));

  // ---- trials ----
  const trialists = all.filter(p => p.trialAt && p.trialAt >= since);
  const cancelled = trialists.filter(p => p.cancelAt && p.cancelAt >= p.trialAt);
  const buckets = [['Under 1 hour', 1], ['1–6 hours', 6], ['6–24 hours', 24], ['Day 2', 48], ['Day 3', 72], ['After the trial', Infinity]];
  const cancelWhen = buckets.map(([label]) => ({ label, n: 0 }));
  for (const p of cancelled) { const h = (p.cancelAt - p.trialAt) / 3600e3; cancelWhen[buckets.findIndex(([, max]) => h < max)].n++; }
  const beforeCancel = new Map();
  for (const p of cancelled) {
    let last = null; for (const s of p.sessions.values()) for (const r of s.list) if (r.kind === 'screen' && r.ts <= p.cancelAt) last = r.name;
    if (last) beforeCancel.set(last, (beforeCancel.get(last) || 0) + 1);
  }
  const inTrial = p => { const end = p.trialAt + 3 * DAY; let sessions = 0; const f = new Set(); for (const s of p.sessions.values()) { if (s.end >= p.trialAt && s.start < end) sessions++; for (const r of s.list) if (r.kind === 'screen' && r.ts >= p.trialAt && r.ts < end) { const k = featureOf(r.name); if (k) f.add(k); } } return { sessions, features: f.size, days: [...p.days].filter(d => d >= dayOf(p.trialAt) && d < dayOf(end) + 1).length }; };
  const keepers = trialists.filter(p => !p.cancelAt && p.trialAt < now - 3 * DAY);
  const cmp = list => { const x = list.map(inTrial); return { people: list.length, sessions: median(x.map(v => v.sessions)), features: median(x.map(v => v.features)), days: median(x.map(v => v.days)) }; };
  const trials = {
    started: trialists.length, cancelled: cancelled.length, cancelRate: pct(cancelled.length, trialists.length),
    paid: trialists.filter(p => p.paidAt).length, medianHoursToCancel: cancelled.length ? Math.round(median(cancelled.map(p => (p.cancelAt - p.trialAt) / 3600e3)) * 10) / 10 : null,
    when: cancelWhen, lastScreen: [...beforeCancel.entries()].map(([screen, n]) => ({ screen, n })).sort((a, b) => b.n - a.n).slice(0, 8),
    cancellers: cmp(cancelled), keepers: cmp(keepers),
    plans: (() => { const m = { yearly: 0, monthly: 0 }; for (const p of trialists) if (p.plan && m[p.plan] != null) m[p.plan]++; return m; })()
  };

  // ---- paywall: where purchases start and finish ----
  const pw = new Map();
  const bump = (from, k) => { from = from || 'other'; const x = pw.get(from) || { from, start: 0, success: 0, cancel: 0 }; x[k]++; pw.set(from, x); };
  for (const p of all) for (const s of p.sessions.values()) for (const r of s.list) {
    if (r.kind !== 'event') continue; const from = parse(r.props).from;
    if (r.name === 'purchase_start' || r.name === 'checkout_start') bump(from, 'start');
    if (r.name === 'purchase_success' || r.name === 'checkout_done') bump(from, 'success');
    if (r.name === 'purchase_cancel' || r.name === 'checkout_cancel') bump(from, 'cancel');
  }
  const gateViews = all.filter(p => has(p, 'trial_gate')).length, paywallViews = all.reduce((a, p) => a + (p.events.get('paywall') || 0), 0);
  const paywall = { gateViews, paywallViews, sources: [...pw.values()].sort((a, b) => b.start - a.start) };

  const totals = {
    people: all.length, fresh: fresh.length, signedIn: all.filter(p => p.signedIn).length, sessions: sessionCount,
    medianSession: sessionLengths.length ? Math.round(median(sessionLengths)) : null,
    sessionsPerPerson: all.length ? Math.round(sessionCount / all.length * 10) / 10 : null,
    active7: all.filter(p => p.last >= now - 7 * DAY).length, events: rows.length
  };

  return { days, platform: want, generatedAt: now, labels: LABELS, totals, funnels, paths, screens: screens.slice(0, 40), closed, gone, returning, cohorts, daily, features, featureBase: { kept: kept.length, lost: lost.length }, trials, paywall, insights: insights({ totals, paths, screens, returning, features, kept, lost, trials, gone, funnels }) };
}

// Plain-language findings, worst first. Each needs enough people behind it to mean anything.
export function insights({ totals, paths, screens, returning, features, kept, lost, trials, gone, funnels }) {
  const out = [];
  if (totals.people < 5) return [{ tone: 'info', title: 'Not enough people yet', text: 'Findings appear once at least 5 people have used a version that sends screen data (iPhone app 1.7 or the website).' }];
  for (const [platform, path] of Object.entries(paths)) {
    const worst = path.filter(s => s.drop != null && s.n + s.drop >= 5).sort((a, b) => b.drop / (b.n + b.drop) - a.drop / (a.n + a.drop))[0];
    if (worst && worst.drop) {
      const i = path.indexOf(worst), from = path[i - 1];
      const rate = Math.round(worst.drop / (worst.n + worst.drop) * 100);
      if (rate >= 15) out.push({ tone: 'bad', score: rate, title: `${rate}% leave between ${from.label} and ${worst.label}`, text: `On ${platform === 'ios' ? 'the iPhone app' : 'the website'}, ${worst.drop} of ${worst.n + worst.drop} people who saw “${from.label}” never reached “${worst.label}”. This is the biggest leak in the first run.`, action: actionFor(from.screen) });
    }
  }
  const leaky = screens.filter(s => s.views >= 15 && s.exitRate != null && !['app_background'].includes(s.screen)).sort((a, b) => b.exitRate - a.exitRate)[0];
  if (leaky && leaky.exitRate >= 25) out.push({ tone: 'bad', score: leaky.exitRate, title: `${leaky.exitRate}% of visits to “${nameOf(leaky.screen)}” end the session`, text: `People close the app on this screen more than any other screen with real traffic (${leaky.views} views, about ${leaky.secs ?? '?'} s spent there).`, action: actionFor(leaky.screen) });
  const d1 = returning.find(r => r.day === 1), d7 = returning.find(r => r.day === 7);
  if (d1 && d1.n >= 5) out.push({ tone: d1.rate >= 40 ? 'good' : 'bad', score: 100 - d1.rate, title: `${d1.rate}% come back after day 1`, text: `${d1.back} of ${d1.n} new people opened Boplo again on a later day.${d7 && d7.n >= 5 ? ` ${d7.rate}% are still around after a week.` : ''} Utility apps that keep people tend to be above 35–40% here.`, action: d1.rate >= 40 ? null : 'Give a reason to open it tomorrow before they leave today: today’s sortie, a reminder at their lesson time, or a question streak.' });
  const best = features.filter(f => f.keptN >= 3 && (f.lostN >= 1 || lost.length >= 5) && f.kept != null).map(f => ({ ...f, ratio: f.lost ? f.kept / f.lost : f.kept / 5 })).sort((a, b) => b.ratio - a.ratio)[0];
  if (best && best.ratio >= 1.5 && kept.length >= 3) out.push({ tone: 'good', score: 60 + best.ratio, title: `${best.name} early is the strongest sign someone stays`, text: `${best.kept}% of people still here after a week used ${best.name} in their first 3 days, against ${best.lost ?? 0}% of people who left.`, action: `Put ${best.name} in front of new people on day one: on the desk, in the first reminder, or as the last onboarding step.` });
  if (trials.started >= 3) {
    const early = trials.when.slice(0, 3).reduce((a, b) => a + b.n, 0);
    if (trials.cancelled) out.push({ tone: trials.cancelRate > 50 ? 'bad' : 'info', score: trials.cancelRate, title: `${trials.cancelRate}% of trials are cancelled${trials.medianHoursToCancel != null ? `, typically ${trials.medianHoursToCancel < 24 ? Math.round(trials.medianHoursToCancel) + ' hours' : Math.round(trials.medianHoursToCancel / 24 * 10) / 10 + ' days'} in` : ''}`, text: early ? `${early} of ${trials.cancelled} cancelled within the first day, which usually means they turned off auto-renew straight after starting rather than after trying Boplo.` : 'Most cancellations come later in the trial, after people have tried things.', action: early ? 'Show the value before the card: a first win (a logged flight, a sim approach, 5 questions) right after onboarding, and a day-2 reminder saying what they get if they stay.' : 'Look at what cancellers did during the trial below, and push the features keepers used.' });
    if (trials.cancellers.people >= 2 && trials.keepers.people >= 2 && trials.keepers.sessions > (trials.cancellers.sessions ?? 0)) out.push({ tone: 'info', score: 40, title: 'People who keep Boplo open it more during the trial', text: `Keepers had ${trials.keepers.sessions} visits and used ${trials.keepers.features} features in their trial; people who cancelled had ${trials.cancellers.sessions} visits and ${trials.cancellers.features} features.`, action: 'Each trial day should end with a reason to come back the next day.' });
  }
  for (const [platform, f] of Object.entries(funnels)) {
    const s = f.find(x => x.label === 'Reached sign-in'), si = f.find(x => x.label === 'Signed in');
    if (s && si && s.n >= 5 && si.n / s.n < 0.7) out.push({ tone: 'bad', score: 70, title: `${Math.round((1 - si.n / s.n) * 100)}% stop at sign-in`, text: `${s.n - si.n} of ${s.n} people reached sign-in on ${platform === 'ios' ? 'the iPhone app' : 'the website'} and didn’t create an account.`, action: 'Make sign-in a single tap (Sign in with Apple first) and say what they get straight after it.' });
  }
  if (gone.people >= 5) { const top = gone.screens[0]; if (top) out.push({ tone: 'info', score: 30, title: `People who left for good were last on “${nameOf(top.screen)}”`, text: `${top.n} of ${gone.people} people with no visit in the last week last saw this screen (${top.share}%).`, action: actionFor(top.screen) }); }
  return out.sort((a, b) => (b.tone === 'bad') - (a.tone === 'bad') || b.score - a.score).map(({ score, ...x }) => x);
}

function actionFor(screen) {
  const map = {
    sign_in: 'Make sign-in one tap and tell people what they’ll get right after it.',
    trial_gate: 'Test the trial offer: lead with what they set up in onboarding, show the price per month for yearly, and keep the “cancel any time” line close to the button.',
    checkout: 'Card entry is a big ask: say “£0 today” on the button and show the reminder before the trial ends.',
    building_desk: 'The build animation may feel slow: try shortening it.',
    onb_name: 'Asking for a name first is friction. Try starting with the country or the licence instead.',
    onb_country: 'Pre-pick the country from the phone’s region and let them continue with one tap.',
    onb_goal: 'Too many licence choices? Pre-select the most likely one for their country.',
    onb_pace: 'Make this question optional or remove it.',
    onb_hours: 'Make “I’m just starting” the main button.',
    desk: 'The desk is where people land: make the first thing on it a single obvious action for today.',
    logbook: 'An empty logbook is a dead end: offer to log the last lesson or import from a photo.',
    simulator: 'If people leave from the sim, check load time and the first 10 seconds of the experience.',
    study: 'Start a 5-question round automatically instead of showing a menu.',
    plans: 'The paywall sheet is a common exit: make sure it says what they lose and offers the trial.',
    welcome: 'The first screen loses people: test a different headline, or a picture of the plan they’ll get.',
    q_struggles: 'Fewer, bigger choices on “What’s hardest”, or let people skip it.',
    q_lesson: 'Make “I don’t have one booked” more obvious.',
    q_heard: 'Move “Where did you hear about Boplo” after sign-in, or drop it.',
    plan: 'The plan screen should feel exciting: lead with their finish date and keep the text short.',
    q_plan: 'The plan screen should feel exciting: lead with their finish date and keep the text short.',
    commit: 'If people stall on hold-to-commit, make the hold shorter or add a plain “I’m in” button.',
    q_commit: 'If people stall on hold-to-commit, make the hold shorter or add a plain “I’m in” button.',
    save_plan: 'Saving the plan is the account step: make Sign in with Apple or Google the first, biggest button.'
  };
  return map[screen] || (screen?.startsWith('intro_') ? 'Shorten the intro or let people skip straight to sign-in.' : null);
}
