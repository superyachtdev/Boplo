// Pilot stats: three 0–99 ratings worked out from everything a student does in Boplo, an overall
// Pilot Rating, a tier, and a rank against everyone who has trained in the last 30 days.
//
//  Knowledge   theory: spaced-repetition readiness across the question bank, plus recent mock exams
//  Handling    flying: real logged hours and how recent they are, plus simulator landing scores
//  Airmanship  judgement: daily sortie weather and preflight calls, radio practice, documents in date
//
// Every part looks at recent work (30 days, or decaying spaced-repetition strength), so a stat goes
// rusty when it isn't trained. The numbers measure quality, not volume: answering easy questions again
// and again doesn't move them much.

// Questions per bank, matching dist/flight-questions.js (FAA students get the FAA bank).
export const BANK = { faa: 455, uk: 138, easa: 138 };
const BOX_STRENGTH = [0, .25, .5, .72, .88, 1], BOX_DAYS = [0, 1, 3, 7, 16, 35];
export const TIERS = [[0, 'Ground School'], [20, 'Pre-Solo'], [40, 'Solo'], [60, 'Cross-Country'], [75, 'Checkride Ready'], [90, 'Ace']];
const clamp = (v, lo = 0, hi = 99) => Math.max(lo, Math.min(hi, v));
const parse = (s, d) => { try { const v = JSON.parse(s || ''); return v ?? d; } catch { return d; } };
const dayOf = iso => Math.floor(Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') / 864e5);

export function regimeOf(p) {
  if (['faa', 'uk', 'easa'].includes(p.regime)) return p.regime;
  const a = String(p.authority || '').toLowerCase();
  if (a.includes('faa') || p.countryCode === 'US') return 'faa';
  return a.includes('easa') ? 'easa' : 'uk';
}

export function tierOf(rating) {
  let i = 0; TIERS.forEach(([at], j) => { if (rating >= at) i = j; });
  return { name: TIERS[i][1], next: TIERS[i + 1] ? { name: TIERS[i + 1][1], at: TIERS[i + 1][0] } : null };
}

/** The pure calculation, so it can be tested without a database. `sims` are recent sim_scores rows. */
export function computeStats(profile, flights, sims, today = Math.floor(Date.now() / 864e5)) {
  const p = profile || {};
  // ---- Knowledge ----
  const study = parse(p.study, {});
  let strength = 0;
  for (const [k, r] of Object.entries(study)) {
    if (k.startsWith('_') || !Array.isArray(r) || r.length < 2) continue;
    const box = r.length >= 3 ? Math.min(5, r[2]) : (r[1] > 0 && r[0] / r[1] >= .75 ? 3 : r[0] > 0 ? 2 : 1);
    const late = today - (r.length >= 4 ? r[3] : 0);
    strength += BOX_STRENGTH[box] * (late > BOX_DAYS[box] * 2 + 7 ? .75 : 1);
  }
  const bank = BANK[regimeOf(p)] || 138, readiness = Math.min(100, strength / bank * 100);
  const mocks = (Array.isArray(study._mocks) ? study._mocks : []).filter(m => m && today - dayOf(m.d) <= 60).slice(-3);
  const mockAvg = mocks.length ? mocks.reduce((a, m) => a + (+m.s || 0), 0) / mocks.length : null;
  const K = clamp(Math.round(mockAvg == null ? readiness : readiness * .7 + mockAvg * .3));

  // ---- Handling ----
  const fl = Array.isArray(flights) ? flights : [];
  const totalH = fl.reduce((a, f) => a + (+f.minutes || 0), 0) / 60 + (+p.openingMinutes || 0) / 60;
  const h30 = fl.filter(f => today - dayOf(f.date) <= 30).reduce((a, f) => a + (+f.minutes || 0), 0) / 60;
  // landing scores from flights recorded on the phone in the last 30 days: how well the student actually flies
  const real = fl.filter(f => today - dayOf(f.date) <= 30).flatMap(f => Array.isArray(f.landingScores) ? f.landingScores.map(l => +l.s).filter(Number.isFinite) : []).slice(-12);
  const realLdg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
  const realH = realLdg == null ? 100 * (.6 * Math.min(1, totalH / 45) + .4 * Math.min(1, h30 / 5))
    : 100 * (.45 * Math.min(1, totalH / 45) + .25 * Math.min(1, h30 / 5)) + .3 * realLdg * Math.min(1, .5 + real.length * .1);
  const best = (Array.isArray(sims) ? sims : []).map(s => +s.score || 0).sort((a, b) => b - a).slice(0, 5);
  const simH = best.length ? best.reduce((a, b) => a + b, 0) / best.length * Math.min(1, .6 + best.length * .08) : 0;
  const H = clamp(Math.round(realH * .55 + simH * .45));

  // ---- Airmanship ----
  const sorties = (Array.isArray(parse(p.sorties, [])) ? parse(p.sorties, []) : []).filter(s => s && s.d && today - dayOf(s.d) <= 30);
  let calls = 0, good = 0;
  for (const s of sorties) for (const k of ['b', 'p']) if (s[k] === 0 || s[k] === 1) { calls++; good += s[k]; }
  const sortieA = calls ? 100 * (good / calls) * (.5 + .5 * Math.min(1, sorties.length / 12)) : 0;
  const radio = Object.values(parse(p.radio, {})).map(Number).filter(Number.isFinite);
  const radioA = radio.length ? radio.reduce((a, b) => a + b, 0) / radio.length * (.5 + .5 * Math.min(1, radio.length / 8)) : 0;
  const docs = parse(p.docs, {}), todayISO = new Date(today * 864e5).toISOString().slice(0, 10);
  const docsA = docs.medical && String(docs.medical) >= todayISO ? 100 : 0;
  const A = clamp(Math.round(sortieA * .6 + radioA * .25 + docsA * .15));

  const rating = clamp(Math.round(K * .35 + H * .35 + A * .3));
  // "current": a daily sortie in the last 3 days
  const lastSortie = sorties.map(s => dayOf(s.d)).sort((a, b) => b - a)[0];
  const currentDays = lastSortie == null ? 0 : Math.max(0, 3 - (today - lastSortie));
  return {
    knowledge: K, handling: H, airmanship: A, rating, tier: tierOf(rating),
    current: { days: currentDays, sortieToday: lastSortie === today, sorties30: sorties.length },
    parts: { readiness: Math.round(readiness), mockAvg: mockAvg == null ? null : Math.round(mockAvg), totalHours: +totalH.toFixed(1), hours30: +h30.toFixed(1), simBest: best.length ? Math.round(best[0]) : null, realLandings: real.length, realLandingAvg: realLdg == null ? null : Math.round(realLdg), sortieCalls: calls ? Math.round(good / calls * 100) : null, radio: radio.length ? Math.round(radio.reduce((a, b) => a + b, 0) / radio.length) : null, medicalCurrent: !!docsA }
  };
}

async function ensure(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS pilot_stats (user_id TEXT PRIMARY KEY, rating INTEGER NOT NULL, k INTEGER NOT NULL, h INTEGER NOT NULL, a INTEGER NOT NULL, airport TEXT, updated_at INTEGER NOT NULL)').run();
}

/** Works out the student's stats, stores them for ranking, and returns them with their rank. */
export async function pilotStats(env, userId, now = Date.now()) {
  await ensure(env);
  const today = Math.floor(now / 864e5), since = now - 30 * 864e5;
  const row = await env.DB.prepare('SELECT data FROM flight_profiles WHERE user_id=?').bind(userId).first();
  const profile = row ? parse(row.data, {}) : {};
  const recs = await env.DB.prepare('SELECT data FROM flight_records WHERE user_id=?').bind(userId).all();
  const flights = (recs.results || []).map(r => parse(r.data, {}));
  let sims = [];
  try { sims = (await env.DB.prepare('SELECT score FROM sim_scores WHERE user_id=? AND created_at>? ORDER BY score DESC LIMIT 20').bind(userId, since).all()).results || []; } catch { }
  const s = computeStats(profile, flights, sims, today);
  const airport = String(profile.airport || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  await env.DB.prepare('INSERT INTO pilot_stats(user_id,rating,k,h,a,airport,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET rating=excluded.rating,k=excluded.k,h=excluded.h,a=excluded.a,airport=excluded.airport,updated_at=excluded.updated_at')
    .bind(userId, s.rating, s.knowledge, s.handling, s.airmanship, airport, now).run();
  const above = await env.DB.prepare('SELECT COUNT(*) n FROM pilot_stats WHERE updated_at>? AND rating>?').bind(since, s.rating).first();
  const total = await env.DB.prepare('SELECT COUNT(*) n FROM pilot_stats WHERE updated_at>?').bind(since).first();
  let ap = null;
  if (airport) {
    const a1 = await env.DB.prepare('SELECT COUNT(*) n FROM pilot_stats WHERE updated_at>? AND airport=? AND rating>?').bind(since, airport, s.rating).first();
    const a2 = await env.DB.prepare('SELECT COUNT(*) n FROM pilot_stats WHERE updated_at>? AND airport=?').bind(since, airport).first();
    ap = { code: airport, rank: (a1?.n || 0) + 1, total: a2?.n || 1 };
  }
  const n = total?.n || 1, rank = (above?.n || 0) + 1;
  return { ...s, rank, total: n, top: Math.max(1, Math.round(rank / n * 100)), airport: ap };
}
