// One-off announcements by email to Boplo Flight accounts, sent by the owner from the owner page.
// First one: the website's free plan ending (3-day trial with a card from 27 Nov 2026), with a thank-you code.
// The owner previews who gets it, sends a test to themselves, then sends. Each person gets each announcement once
// (recorded in flight_nudges as 'ann:<id>'), and anyone who opted out of announcements is skipped.
// Needs RESEND_API_KEY and EMAIL_FROM (the same as sign-in links) and CRON_SECRET (to sign opt-out links).

import { isOwner } from './billing.js';
import { appleGrants } from './apple.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = buf => [...new Uint8Array(buf)].map(n => n.toString(16).padStart(2, '0')).join('');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export const ANNOUNCEMENTS = {
  'free-ending-2026-11': {
    subject: 'Your Boplo logbook is safe, and a thank-you for being early',
    // who it's for: accounts without Advanced from any source (website, App Store, school)
    audience: 'free',
    code: 'EARLYPILOT',
    body: first => [
      `Hi ${first || 'there'},`,
      'Thanks for being one of the first pilots on Boplo Flight.',
      'From today, Boplo works a little differently. Instead of a free plan, every account starts with a 3-day free trial of everything: the unlimited logbook, the simulator at your own airfield, radio practice, mock exams and Ask Boplo. You add a card to start, and you can cancel any time in the first 3 days without paying.',
      'Your account and everything you’ve logged are exactly where you left them.',
      'As a thank-you for joining early, use the code EARLYPILOT at checkout for 30% off your first year. It’s valid until 31 December.'
    ],
    cta: ['Start my free trial', '/flight-app.html'],
    after: 'Not for you? You can download everything you’ve added at any time: sign in at boplo.app and use “Download everything”.',
    sign: 'Blue skies,\nGianni, Boplo Flight'
  }
};

async function optOutToken(env, userId) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.CRON_SECRET || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('ann-off:' + userId))).slice(0, 32);
}

export function announcementHtml(a, first, origin, offUrl) {
  return `<main style="font-family:Arial,Helvetica,sans-serif;color:#0b1430;max-width:540px;line-height:1.55;font-size:15px">
${a.body(first).map(l => `<p style="margin:0 0 14px">${esc(l).replace(esc(a.code), `<b style="letter-spacing:.04em">${esc(a.code)}</b>`)}</p>`).join('')}
<p style="margin:22px 0"><a href="${origin}${a.cta[1]}" style="display:inline-block;padding:13px 20px;background:#0a62ff;color:#fff;border-radius:12px;text-decoration:none;font-weight:700">${esc(a.cta[0])}</a></p>
<p style="margin:0 0 14px;color:#3d4866">${esc(a.after)}</p>
<p style="margin:18px 0 0">${esc(a.sign).replace(/\n/g, '<br>')}</p>
<p style="font-size:12px;color:#6a7591;margin-top:30px">You’re getting this because you have a Boplo Flight account. BOPLO STUDIOS LLC. <a href="${offUrl}" style="color:#6a7591">Don’t email me about changes and offers</a>.</p>
</main>`;
}
export function announcementText(a, first, origin, offUrl) {
  return [...a.body(first), `${a.cta[0]}: ${origin}${a.cta[1]}`, a.after, a.sign, `Don’t email me about changes and offers: ${offUrl}`].join('\n\n');
}

async function ensure(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS flight_nudges (user_id TEXT NOT NULL, kind TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (user_id, kind))').run();
}

// Everyone the announcement would go to now: free accounts with an email, not opted out, not already sent this one.
export async function audience(env, id, now = Date.now()) {
  await ensure(env);
  const rows = (await env.DB.prepare(`SELECT u.id, u.email, u.display_name name, json_extract(p.data,'$.name') pname, json_extract(p.data,'$.announcements') ann,
      b.status, (SELECT COUNT(*) FROM flight_school_members m WHERE m.user_id=u.id) school,
      (SELECT COUNT(*) FROM flight_nudges n WHERE n.user_id=u.id AND n.kind=?) sent
    FROM darts_users u JOIN flight_profiles p ON p.user_id=u.id LEFT JOIN flight_billing b ON b.user_id=u.id`).bind('ann:' + id).all().catch(async () =>
    // schools table missing (old databases): same query without it
    env.DB.prepare(`SELECT u.id, u.email, u.display_name name, json_extract(p.data,'$.name') pname, json_extract(p.data,'$.announcements') ann, b.status, 0 school,
      (SELECT COUNT(*) FROM flight_nudges n WHERE n.user_id=u.id AND n.kind=?) sent FROM darts_users u JOIN flight_profiles p ON p.user_id=u.id LEFT JOIN flight_billing b ON b.user_id=u.id`).bind('ann:' + id).all())).results || [];
  let apple = []; try { apple = (await env.DB.prepare('SELECT user_id, status, expires_at FROM flight_apple').all()).results || []; } catch { }
  const appleOn = new Set(apple.filter(a => appleGrants(a, now)).map(a => a.user_id));
  return rows.filter(r => r.email && /@/.test(r.email) && !r.sent && r.ann !== false && r.ann !== 0 && String(r.ann) !== 'false'
    && !['active', 'trialing', 'past_due'].includes(r.status) && !r.school && !appleOn.has(r.id) && !isOwner(env, { email: r.email }))
    .map(r => ({ id: r.id, email: r.email, first: String(r.pname || r.name || '').trim().split(/\s+/)[0] || '' }));
}

async function sendBatch(env, list, a, origin, fetcher) {
  const payload = await Promise.all(list.map(async p => {
    const off = `${origin}/flight/announcements/off?u=${encodeURIComponent(p.id)}&t=${await optOutToken(env, p.id)}`;
    return { from: env.EMAIL_FROM, to: [p.email], subject: a.subject, html: announcementHtml(a, p.first, origin, off), text: announcementText(a, p.first, origin, off), headers: { 'List-Unsubscribe': `<${off}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
  }));
  const res = await fetcher('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) fail(502, `The email service refused the batch (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

// POST /flight/owner/announce { id, action: 'preview' | 'test' | 'send' }
export async function announce(env, user, input, origin = 'https://boplo.app', fetcher = fetch) {
  if (!isOwner(env, user)) fail(403, 'Not allowed.');
  const id = String(input?.id || ''), a = ANNOUNCEMENTS[id];
  if (!a) fail(400, 'Unknown announcement.');
  const ready = !!(env.RESEND_API_KEY && env.EMAIL_FROM && env.CRON_SECRET);
  const list = await audience(env, id);
  const sample = { first: String(user.display_name || '').split(/\s+/)[0] || 'Gianni' };
  if (input.action === 'preview' || !input.action) {
    return { id, ready, subject: a.subject, count: list.length, appleRelay: list.filter(p => /privaterelay\.appleid\.com$/i.test(p.email)).length,
      html: announcementHtml(a, sample.first, origin, '#'), recipients: list.slice(0, 500).map(p => p.email) };
  }
  if (!ready) fail(400, 'Email isn’t set up: RESEND_API_KEY, EMAIL_FROM and CRON_SECRET are needed.');
  if (input.action === 'test') {
    await sendBatch(env, [{ id: user.id, email: user.email, first: sample.first }], { ...a, subject: '[Test] ' + a.subject }, origin, fetcher);
    return { ok: true, sentTo: user.email };
  }
  if (input.action === 'send') {
    if (Number(input.expect) !== list.length) fail(409, 'The list changed since you previewed it. Preview again, then send.');
    let sent = 0;
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      await sendBatch(env, chunk, a, origin, fetcher);
      const now = Date.now();
      for (const p of chunk) await env.DB.prepare('INSERT OR IGNORE INTO flight_nudges(user_id,kind,sent_at) VALUES(?,?,?)').bind(p.id, 'ann:' + id, now).run();
      sent += chunk.length;
    }
    return { ok: true, sent };
  }
  fail(400, 'Unknown action.');
}

// GET /flight/announcements/off?u=&t= : stop announcement emails (no sign-in needed)
export async function announcementsOff(env, url) {
  const u = url.searchParams.get('u'), t = url.searchParams.get('t');
  if (!env.CRON_SECRET || !u || t !== await optOutToken(env, u)) return new Response('This link isn’t valid any more.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  await env.DB.prepare("UPDATE flight_profiles SET data=json_set(COALESCE(data,'{}'),'$.announcements',json('false')) WHERE user_id=?").bind(u).run();
  return new Response('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Unsubscribed · Boplo</title><body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#0b1430"><h1 style="font-size:22px">Done</h1><p>You won’t get emails from Boplo about changes and offers. Sign-in links and anything you turned on yourself, like training reminders, still arrive.</p><p><a href="https://boplo.app">Back to Boplo</a></p></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
