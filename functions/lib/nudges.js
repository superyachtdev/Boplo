// Momentum reminders by email, for pilots who switched them on (profile.reminders === true).
// Run once a day: POST /flight/cron/nudges with "Authorization: Bearer <CRON_SECRET>" (the GitHub Action in .github/workflows/nudges.yml does this).
// Needs RESEND_API_KEY and EMAIL_FROM (already used for sign-in links) and CRON_SECRET.

const DAY = 86400000;
let ready = null;
function ensure(env) {
  if (!ready) ready = env.DB.prepare('CREATE TABLE IF NOT EXISTS flight_nudges (user_id TEXT NOT NULL, kind TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (user_id, kind))').run().catch(e => { ready = null; throw e; });
  return ready;
}
const hex = buf => [...new Uint8Array(buf)].map(n => n.toString(16).padStart(2, '0')).join('');
export async function unsubToken(env, userId) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.CRON_SECRET || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('nudge-off:' + userId))).slice(0, 32);
}
const isoDay = t => new Date(t).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// what to send today, if anything. Pure, so it can be tested.
export function pickNudge({ profile = {}, lastFlight = null, flights = 0, sent = {}, now = Date.now() }) {
  const today = isoDay(now), tomorrow = isoDay(now + DAY);
  const name = String(profile.name || '').trim().split(/\s+/)[0] || 'there';
  if (profile.lessonDate === tomorrow && !sent['lesson:' + tomorrow]) {
    return { kind: 'lesson:' + tomorrow, subject: `Your lesson is tomorrow${profile.nextLesson ? `: ${profile.nextLesson}` : ''}`, lines: [`Hi ${name}, you have a lesson tomorrow${profile.nextLesson ? ` (${profile.nextLesson})` : ''}.`, 'Ten minutes tonight makes a difference: run through your preparation checklist, the circuit or route, and the questions you want to ask your instructor.'], cta: ['Prepare for it', '#prepare'] };
  }
  if (!flights || !lastFlight) return null;
  const gap = daysBetween(lastFlight, today);
  const last = sent.gap || 0;
  if (gap < 10) return null;
  const every = gap >= 90 ? 30 : 7; // weekly while momentum matters, monthly once it's a long break
  if (now - last < every * DAY) return null;
  const lines = gap >= 90
    ? [`Hi ${name}, it’s been ${gap} days since your last flight.`, 'After a break this long most students restart with a dual lesson to brush up. That’s normal and it gets you back on track quickly. Book one with your school and log it in Boplo.']
    : gap >= 60
      ? [`Hi ${name}, it’s been ${gap} days since your last flight. You’re getting close to 90 days, when passenger currency lapses and skills need real rebuilding.`, 'Booking even one lesson in the next few weeks saves hours later.']
      : gap >= 21
        ? [`Hi ${name}, it’s been ${gap} days since your last flight.`, 'Skills fade fastest in the first few weeks off. Students who fly twice a week tend to need far fewer hours overall. Worth booking your next lesson now?']
        : [`Hi ${name}, it’s been ${gap} days since you last flew.`, 'Keeping lessons close together is the biggest thing you can do to finish sooner and spend less. Is your next one booked?'];
  return { kind: 'gap', subject: gap >= 90 ? `${gap} days since your last flight. Time for a refresher?` : `It’s been ${gap} days since your last flight`, lines, cta: ['Open your flight desk', '#overview'] };
}

function emailHtml(n, origin, offUrl) {
  return `<main style="font-family:Arial,Helvetica,sans-serif;color:#0b1430;max-width:520px;line-height:1.5">
<p style="font-size:20px;font-weight:700;margin:0 0 14px">${esc(n.subject)}</p>
${n.lines.map(l => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('')}
<p style="margin:20px 0"><a href="${origin}/flight-app.html${n.cta[1]}" style="display:inline-block;padding:12px 18px;background:#0a62ff;color:#fff;border-radius:12px;text-decoration:none;font-weight:700">${esc(n.cta[0])}</a></p>
<p style="font-size:12px;color:#5b6787;margin-top:28px">You’re getting this because you turned on training reminders in Boplo Flight. <a href="${offUrl}" style="color:#5b6787">Turn reminders off</a>.</p>
</main>`;
}

export async function runNudges(env, { origin = 'https://boplo.app', now = Date.now(), fetcher = fetch } = {}) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { ok: false, error: 'Email is not configured.' };
  await ensure(env);
  const profiles = (await env.DB.prepare('SELECT p.user_id, p.data, u.email FROM flight_profiles p JOIN darts_users u ON u.id=p.user_id').all()).results || [];
  const lastRows = (await env.DB.prepare("SELECT user_id, MAX(json_extract(data,'$.date')) last, COUNT(*) n FROM flight_records GROUP BY user_id").all()).results || [];
  const lastBy = Object.fromEntries(lastRows.map(r => [r.user_id, r]));
  let sent = 0, checked = 0;
  for (const row of profiles) {
    let profile; try { profile = JSON.parse(row.data || '{}'); } catch { continue; }
    if (profile.reminders !== true || !row.email) continue;
    checked++;
    const done = Object.fromEntries(((await env.DB.prepare('SELECT kind, sent_at FROM flight_nudges WHERE user_id=?').bind(row.user_id).all()).results || []).map(r => [r.kind, r.sent_at]));
    const n = pickNudge({ profile, lastFlight: lastBy[row.user_id]?.last || null, flights: lastBy[row.user_id]?.n || 0, sent: done, now });
    if (!n) continue;
    const off = `${origin}/flight/nudges/off?u=${encodeURIComponent(row.user_id)}&t=${await unsubToken(env, row.user_id)}`;
    const res = await fetcher('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [row.email], subject: n.subject, html: emailHtml(n, origin, off), headers: { 'List-Unsubscribe': `<${off}>` } }) });
    if (!res.ok) { console.error('nudge email failed', res.status); continue; }
    await env.DB.prepare('INSERT INTO flight_nudges(user_id,kind,sent_at) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET sent_at=excluded.sent_at').bind(row.user_id, n.kind, now).run();
    sent++;
  }
  return { ok: true, checked, sent };
}

export async function nudgesOff(env, url) {
  const u = url.searchParams.get('u') || '', t = url.searchParams.get('t') || '';
  if (!env.CRON_SECRET || !u || t !== await unsubToken(env, u)) return new Response('This link isn’t valid any more.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const row = await env.DB.prepare('SELECT data FROM flight_profiles WHERE user_id=?').bind(u).first();
  if (row) { const p = JSON.parse(row.data || '{}'); p.reminders = false; await env.DB.prepare('UPDATE flight_profiles SET data=? WHERE user_id=?').bind(JSON.stringify(p), u).run(); }
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reminders off</title><body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#0b1430"><h1 style="font-size:22px">Reminders are off.</h1><p>You won’t get training reminder emails from Boplo Flight. You can turn them back on from your Overview.</p><p><a href="/flight-app.html#overview">Open your flight desk</a></p></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
