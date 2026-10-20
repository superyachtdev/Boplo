const encoder = new TextEncoder();
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const fail = (status, error) => { const e = new Error(error); e.status = status; throw e; };
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
const cookie = (name, value, maxAge = 0, secure = true) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; ${maxAge ? `Max-Age=${maxAge}; ` : 'Max-Age=0; '}${secure ? 'Secure;' : ''}`;
const token = () => crypto.randomUUID() + crypto.randomUUID();
async function fetchWithTimeout(url, options, timeout = 25000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (error) { if (error?.name === 'AbortError') fail(504, 'The AI reader took too long. Try again, or paste the chat instead.'); throw error; }
  finally { clearTimeout(timer); }
}
function chatModel(env, image = false) {
  const requested = String(env.GEMINI_CHAT_MODEL || '').trim();
  if (requested === 'gemini-2.5-flash' || requested === 'gemini-2.5-flash-lite') return requested;
  return image ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash';
}

function body(request, limit = 8000) { return request.text().then(raw => { if (raw.length > limit) fail(413, 'Request is too large.'); try { return JSON.parse(raw); } catch { fail(400, 'Invalid request.'); } }); }
function cleanEmail(value) { const email = String(value || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, 'Enter a valid email address.'); return email; }
function cleanNumber(value, label) { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 180) fail(400, `Enter a valid ${label}.`); return n; }
const mean = (rows, key) => rows.length ? rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length : 0;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const day = timestamp => new Date(timestamp).toISOString().slice(0, 10);
const percent = value => Math.round(value * 10) / 10;
const DRILLS = {
  'd16': { key: 'd16', tag: 'DOUBLES', name: 'Own D16', summary: 'Make a match-winning double feel familiar.', task: 'Throw 3 darts at D16 for 10 visits. Reset your feet after every visit.', goal: 'Land 12 doubles before changing target.', target: 12, unit: 'doubles', duration: '12 min', level: 'Foundation' },
  'doubles-around': { key: 'doubles-around', tag: 'DOUBLES', name: 'Around the board', summary: 'Build confidence across every double.', task: 'Hit D1 through D20 in order. Three darts at each target, then move on.', goal: 'Finish all 20 doubles with fewer than 40 misses.', target: 20, unit: 'doubles', duration: '20 min', level: 'Foundation' },
  't20-grouping': { key: 't20-grouping', tag: 'SCORING', name: 'T20 grouping', summary: 'Give your scoring visits a repeatable centre.', task: 'Throw 10 visits at T20. Only judge your group after all three darts land.', goal: 'Score 150 points across any three visits.', target: 150, unit: 'points', duration: '15 min', level: 'Foundation' },
  'checkout-ladder': { key: 'checkout-ladder', tag: 'CHECKOUTS', name: 'Checkout ladder', summary: 'Close the finishes you already reach.', task: 'Start on 40: hit D20, then D10, then D5. Step back one rung after a miss.', goal: 'Complete the ladder twice.', target: 2, unit: 'ladders', duration: '15 min', level: 'Intermediate' },
  'pressure-41': { key: 'pressure-41', tag: 'PRESSURE', name: 'Pressure 41', summary: 'Practise the reset before a deciding dart.', task: 'Play five 41 finishes. Three darts each. Reset after two missed visits.', goal: 'Close three of five legs.', target: 3, unit: 'finishes', duration: '10 min', level: 'Intermediate' }
};
const TARGETS = new Set(['T20', 'D20', 'D16', 'D8', 'BULL', 'OTHER']);
function recommendation(rows, targetStats = []) {
  const doubles = mean(rows, 'doubles_rate'), checkouts = mean(rows, 'checkout_rate'), scoring = mean(rows, 'three_dart_average');
  const focused = targetStats.filter(row => Number(row.attempts) >= 6 && row.target !== 'OTHER').sort((a, b) => (Number(a.hits) / Number(a.attempts)) - (Number(b.hits) / Number(b.attempts)))[0];
  if (rows.length < 3) return { ...DRILLS['t20-grouping'], tag: 'FOUNDATION', why: `You have ${rows.length} honest ${rows.length === 1 ? 'log' : 'logs'}. Two more give Boplo enough signal to make a fair call.`, goal: 'Log three sessions before chasing a weakness.', target: 3, unit: 'sessions', confidence: 'early' };
  if (focused?.target === 'D16') return { ...DRILLS['d16'], tag: 'TARGET SIGNAL', why: `D16 is landing at ${percent(Number(focused.hits) / Number(focused.attempts) * 100)}% across ${focused.attempts} tracked attempts. Make that double familiar before adding more targets.`, confidence: 'high' };
  if (focused?.target === 'T20' && scoring < 55) return { ...DRILLS['t20-grouping'], tag: 'TARGET SIGNAL', why: `T20 is landing at ${percent(Number(focused.hits) / Number(focused.attempts) * 100)}% across your tracked attempts. Tightening that group is the clearest scoring gain.`, confidence: 'high' };
  if (doubles < 35) return { ...DRILLS['d16'], tag: 'DOUBLES FIRST', why: `Your double rate is ${percent(doubles)}%, which is the clearest place to win more legs right now.`, confidence: 'high' };
  if (checkouts < 30) return { ...DRILLS['checkout-ladder'], tag: 'FINISH BETTER', why: `Your checkout rate is ${percent(checkouts)}%. You are reaching finishes more often than you are closing them.`, confidence: 'high' };
  if (scoring < 48) return { ...DRILLS['t20-grouping'], tag: 'SCORING BASE', why: `Your doubles are holding. A ${percent(scoring)} three-dart average is now the best lever to pull.`, confidence: 'high' };
  return { ...DRILLS['pressure-41'], tag: 'MATCH READY', why: 'Your core numbers are balanced. The next gain is making your normal standard show up under pressure.', confidence: 'medium' };
}

function intelligence(rows, runs, targetStats = []) {
  const chronological = [...rows].reverse();
  const recent = chronological.slice(-3), previous = chronological.slice(Math.max(0, chronological.length - 6), Math.max(0, chronological.length - 3));
  const trend = key => previous.length && recent.length ? percent(mean(recent, key) - mean(previous, key)) : null;
  const dates = [...new Set(rows.map(row => day(row.created_at)))].sort().reverse();
  let streak = 0, cursor = new Date();
  while (dates.includes(day(cursor))) { streak += 1; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  const recommendationNow = recommendation(rows, targetStats);
  const completed = runs.filter(run => run.drill_key === recommendationNow.key && run.completed_at);
  const latest = completed[0] || null;
  const best = rows.length ? {
    average: percent(Math.max(...rows.map(row => Number(row.three_dart_average)))),
    doubles: percent(Math.max(...rows.map(row => Number(row.doubles_rate)))),
    checkout: percent(Math.max(...rows.map(row => Number(row.checkout_rate))))
  } : { average: null, doubles: null, checkout: null };
  return {
    confidence: rows.length < 3 ? 'early' : rows.length < 6 ? 'forming' : 'useful',
    stats: { sessions: rows.length, average: percent(mean(rows, 'three_dart_average')), doubles: percent(mean(rows, 'doubles_rate')), checkout: percent(mean(rows, 'checkout_rate')), streak, personalBests: best },
    trends: { average: trend('three_dart_average'), doubles: trend('doubles_rate'), checkout: trend('checkout_rate') },
    recommendation: recommendationNow,
    drill: { completedCount: completed.length, latestResult: latest ? { achieved: latest.achieved, target: latest.target, confidence: latest.confidence, completedAt: latest.completed_at } : null },
    heatmap: targetStats.map(row => ({ target: row.target, hits: Number(row.hits), attempts: Number(row.attempts), rate: Number(row.attempts) ? percent(Number(row.hits) / Number(row.attempts) * 100) : 0 }))
  };
}

async function userFromRequest(request, env) {
  const raw = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)boplo_session=([^;]+)/)?.[1] || (request.headers.get('Cookie') || '').match(/(?:^|;\s*)boplo_darts=([^;]+)/)?.[1];
  if (!raw) return null;
  const row = await env.DB.prepare(`SELECT u.id,u.email,u.display_name FROM darts_sessions s JOIN darts_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await hash(raw), Date.now()).first();
  return row || null;
}
async function createSession(env, userId, secure) {
  const raw = token(), expires = Date.now() + 30 * 86400000;
  await env.DB.prepare('INSERT INTO darts_sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), userId, await hash(raw), expires, Date.now()).run();
  return cookie('boplo_session', raw, 30 * 86400000, secure);
}
async function upsertUser(env, { email, name = null, googleSubject = null }) {
  const existing = await env.DB.prepare('SELECT id FROM darts_users WHERE email=? OR google_subject=?').bind(email, googleSubject).first();
  const now = Date.now();
  if (existing) { await env.DB.prepare('UPDATE darts_users SET email=?,display_name=COALESCE(?,display_name),google_subject=COALESCE(?,google_subject),updated_at=? WHERE id=?').bind(email, name, googleSubject, now, existing.id).run(); return existing.id; }
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO darts_users(id,email,display_name,google_subject,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, email, name, googleSubject, now, now).run(); return id;
}
async function dashboard(env, user) {
  const sessions = await env.DB.prepare('SELECT id,session_type AS type,three_dart_average AS average,doubles_rate AS doubles,checkout_rate AS checkout,three_dart_average,doubles_rate,checkout_rate,note,created_at FROM darts_practice_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all();
  const drills = await env.DB.prepare('SELECT drill_key,completed_at FROM darts_drill_completions WHERE user_id=? ORDER BY completed_at DESC LIMIT 100').bind(user.id).all();
  const rows = sessions.results || [];
  let targetStats = [];
  try { targetStats = (await env.DB.prepare('SELECT target,SUM(hits) AS hits,SUM(attempts) AS attempts FROM darts_target_results WHERE user_id=? GROUP BY target').bind(user.id).all()).results || []; } catch { /* Migration 0004 has not been applied yet. */ }
  let runs = [];
  try { runs = (await env.DB.prepare('SELECT id,drill_key,target,achieved,confidence,note,started_at,completed_at FROM darts_drill_runs WHERE user_id=? ORDER BY completed_at DESC LIMIT 100').bind(user.id).all()).results || []; } catch { /* Migration 0003 has not been applied yet: retain core access rather than fail the whole dashboard. */ }
  const insight = intelligence(rows, runs, targetStats);
  let videos = [];
  try { videos = (await env.DB.prepare('SELECT id,original_name,content_type,size_bytes,status,analysis_json,error_message,created_at,analysed_at FROM darts_video_reviews WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(user.id).all()).results || []; } catch { /* Migration 0005 has not been applied yet. */ }
  return { user, sessions: rows, drills: drills.results || [], drillRuns: runs, intelligence: insight, recommendation: insight.recommendation, drillLibrary: Object.values(DRILLS), videos: videos.map(video => {
    let analysis = null;
    try { analysis = video.analysis_json ? JSON.parse(video.analysis_json) : null; } catch { /* Keep one malformed historical result from breaking the dashboard. */ }
    return { ...video, analysis };
  }) };
}

function cleanVideoName(value) { return String(value || 'throw-review.mp4').replace(/[^a-zA-Z0-9._ -]/g, '').slice(0, 120) || 'throw-review.mp4'; }
function cleanChatImage(value) {
  const match = String(value || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) fail(400, 'Upload a PNG, JPG, or WebP chat screenshot.');
  const estimatedBytes = Math.floor(match[2].length * 0.75);
  if (estimatedBytes > 4 * 1024 * 1024) fail(413, 'Keep chat screenshots under 4 MB.');
  return { mimeType: match[1], data: match[2] };
}
function transcriptFromMessages(messages) { return messages.map(message => `${message.speaker === 'me' ? 'Me' : message.speaker === 'them' ? 'Them' : 'Unknown'}: ${message.text}`).join('\n'); }
async function extractChat(env, image) {
  if (!env.GEMINI_API_KEY) fail(503, 'Chat extraction is not connected yet. Add GEMINI_API_KEY in Cloudflare first.');
  const prompt = 'Extract only the visible dating-app or messaging conversation from this screenshot. Return JSON only with this exact schema: {"messages":[{"speaker":"me|them|unknown","text":"exact visible message text"}]}. Keep messages in chronological reading order. Do not add a greeting, analysis, guess, name, date, emoji description, or any content that is not visible. If the image is not a readable chat, return {"messages":[]}.';
  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chatModel(env, true))}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }) }, 18000);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) fail(503, 'The chat reader needs a valid Gemini API key. Check the GEMINI_API_KEY value in Cloudflare.');
    if (response.status === 404) fail(503, 'The screenshot reader model is unavailable. Set GEMINI_CHAT_MODEL to gemini-2.5-flash-lite in Cloudflare.');
    if (response.status === 429) fail(503, 'The chat reader has reached its temporary Gemini limit. Try again shortly.');
    fail(502, 'Chat extraction is unavailable right now. You can paste the chat instead.');
  }
  const data = await response.json(), text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim() || '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail(502, 'We could not read that screenshot. You can paste the chat instead.'); }
  const messages = Array.isArray(parsed.messages) ? parsed.messages.slice(0, 80).map(message => ({ speaker: ['me', 'them', 'unknown'].includes(message?.speaker) ? message.speaker : 'unknown', text: String(message?.text || '').trim().slice(0, 1000) })).filter(message => message.text) : [];
  if (!messages.length) fail(422, 'No readable chat was found. Try a clearer screenshot or paste the messages.');
  return { messages, transcript: transcriptFromMessages(messages) };
}
function cleanTranscript(value) {
  const transcript = String(value || '').trim().replace(/\r\n/g, '\n').slice(0, 12000);
  if (transcript.length < 8) fail(400, 'Add a little more of the conversation first.');
  return transcript;
}
function cleanVibe(value) {
  const vibe = String(value || 'playful').toLowerCase();
  if (!['playful', 'smooth', 'bold', 'genuine'].includes(vibe)) fail(400, 'Choose a reply vibe.');
  return vibe;
}
function cleanReplyMode(value) {
  const mode = String(value || 'base').toLowerCase();
  if (!['base', 'shorter', 'bolder', 'softer'].includes(mode)) fail(400, 'Choose a valid reply adjustment.');
  return mode;
}
async function generateChatReply(env, transcript, vibe, mode = 'base') {
  if (!env.GEMINI_API_KEY) fail(503, 'The reply engine is not connected yet. Add GEMINI_API_KEY in Cloudflare first.');
  const adjustment = { base: 'Give three distinct but natural options.', shorter: 'Make every reply notably shorter: one sentence, no filler.', bolder: 'Make the replies more direct and confident while staying respectful and easy to decline.', softer: 'Make the replies warmer, lighter, and lower-pressure.' }[mode];
  const prompt = `You are Boplo, a respectful AI dating-chat wingman. Read the confirmed conversation below and help the user write their next message. Return JSON only with this exact schema: {"read":{"tone":"2-6 word read","momentum":"one concise sentence","next_move":"one concise sentence","avoid":"one concise sentence"},"replies":[{"label":"short 1-3 word label","text":"one natural, sendable reply","why":"one concise sentence"},{"label":"short 1-3 word label","text":"one natural, sendable reply","why":"one concise sentence"},{"label":"short 1-3 word label","text":"one natural, sendable reply","why":"one concise sentence"}]}. The requested vibe is ${vibe}. ${adjustment} Keep it warm, specific to the chat, non-manipulative, and easy to reply to. Do not use pickup-artist tactics, pressure, deception, hate, sexual content, or claims about the other person's feelings. Do not mention that you are AI. Never invent facts beyond the transcript.\n\nCONFIRMED CHAT:\n${transcript}`;
  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chatModel(env))}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: .7 } }) });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) fail(503, 'The reply engine needs a valid Gemini API key. Check GEMINI_API_KEY in Cloudflare.');
    if (response.status === 404) fail(503, 'The reply model is unavailable. Set GEMINI_CHAT_MODEL to gemini-2.5-flash in Cloudflare.');
    if (response.status === 429) fail(503, 'The reply engine has reached its temporary Gemini limit. Try again shortly.');
    fail(502, 'The reply engine is unavailable right now. Try again shortly.');
  }
  const data = await response.json(), text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim() || '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail(502, 'Boplo could not format those reply options. Try again.'); }
  const read = parsed?.read || {}, replies = Array.isArray(parsed?.replies) ? parsed.replies.slice(0, 3) : [];
  if (replies.length !== 3 || replies.some(reply => !String(reply?.text || '').trim())) fail(502, 'Boplo could not make three useful reply options. Try again.');
  return { read: { tone: String(read.tone || 'Warm and open').slice(0, 80), momentum: String(read.momentum || '').slice(0, 280), next_move: String(read.next_move || '').slice(0, 280), avoid: String(read.avoid || '').slice(0, 280) }, replies: replies.map(reply => ({ label: String(reply.label || 'Option').slice(0, 40), text: String(reply.text || '').trim().slice(0, 700), why: String(reply.why || '').slice(0, 240) })) };
}

function conversationMessagesFromTranscript(transcript) {
  const messages = String(transcript || '').split('\n').map(line => {
    const match = line.trim().match(/^(me|them)\s*:\s*(.+)$/i);
    return match ? { role: match[1].toLowerCase(), body: match[2].trim().slice(0, 1200) } : null;
  }).filter(Boolean);
  if (!messages.length) fail(400, 'Use “Me:” and “Them:” lines so Boplo can start the thread.');
  return messages.slice(-80);
}
function conversationTranscript(messages) {
  return messages.filter(message => message.role === 'me' || message.role === 'them').map(message => `${message.role === 'me' ? 'Me' : 'Them'}: ${message.body}`).join('\n');
}
function conversationTitle(messages) {
  const last = [...messages].reverse().find(message => message.role === 'them') || messages[messages.length - 1];
  return String(last?.body || 'New chat').replace(/\s+/g, ' ').slice(0, 44) || 'New chat';
}
function cleanIncomingMessage(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 1200);
  if (text.length < 1) fail(400, 'Add what they said first.');
  return text;
}
async function threadPlan(env, userId) {
  const row = await env.DB.prepare("SELECT plan FROM boplo_entitlements WHERE user_id=?").bind(userId).first();
  return row?.plan === 'pro' ? 'pro' : 'free';
}
async function loadConversation(env, userId, id) {
  const conversation = await env.DB.prepare('SELECT id,title,vibe,status,created_at,updated_at FROM boplo_conversations WHERE id=? AND user_id=?').bind(id, userId).first();
  if (!conversation) fail(404, 'That conversation was not found.');
  const rows = await env.DB.prepare('SELECT id,role,body,option_group,label,why,created_at FROM boplo_conversation_messages WHERE conversation_id=? ORDER BY created_at ASC').bind(id).all();
  return { ...conversation, messages: rows.results || [], plan: await threadPlan(env, userId) };
}
async function saveReplyOptions(env, conversationId, replies) {
  const group = crypto.randomUUID(), now = Date.now();
  await env.DB.batch(replies.map(reply => env.DB.prepare('INSERT INTO boplo_conversation_messages(id,conversation_id,role,body,option_group,label,why,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), conversationId, 'suggestion', reply.text, group, reply.label, reply.why, now)));
}
async function createConversation(env, user, transcript, vibe, analysis) {
  const plan = await threadPlan(env, user.id);
  const active = await env.DB.prepare("SELECT COUNT(*) AS count FROM boplo_conversations WHERE user_id=? AND status='active'").bind(user.id).first();
  if (plan !== 'pro' && Number(active?.count || 0) >= 2) fail(402, 'Free includes two active conversations. Archive one or upgrade to Boplo Pro for unlimited threads.');
  const messages = conversationMessagesFromTranscript(transcript), id = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO boplo_conversations(id,user_id,title,vibe,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id, user.id, conversationTitle(messages), vibe, 'active', now, now).run();
  await env.DB.batch(messages.map((message, index) => env.DB.prepare('INSERT INTO boplo_conversation_messages(id,conversation_id,role,body,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), id, message.role, message.body, now + index)));
  await saveReplyOptions(env, id, analysis.replies);
  return loadConversation(env, user.id, id);
}
async function selectThreadReply(env, user, conversationId, messageId) {
  const row = await env.DB.prepare(`SELECT m.id,m.option_group FROM boplo_conversation_messages m JOIN boplo_conversations c ON c.id=m.conversation_id WHERE m.id=? AND m.conversation_id=? AND c.user_id=? AND c.status='active' AND m.role='suggestion'`).bind(messageId, conversationId, user.id).first();
  if (!row) fail(404, 'That reply option is no longer available.');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE boplo_conversation_messages SET role='me',option_group=NULL,label=NULL,why=NULL WHERE id=?").bind(messageId),
    env.DB.prepare("DELETE FROM boplo_conversation_messages WHERE conversation_id=? AND role='suggestion' AND option_group=? AND id<>?").bind(conversationId, row.option_group, messageId),
    env.DB.prepare('UPDATE boplo_conversations SET updated_at=? WHERE id=?').bind(now, conversationId)
  ]);
  return loadConversation(env, user.id, conversationId);
}
async function addIncomingThreadMessage(env, user, conversationId, text) {
  const conversation = await loadConversation(env, user.id, conversationId);
  if (conversation.status !== 'active') fail(400, 'Archive is read-only. Start a new chat to continue.');
  const waiting = conversation.messages.filter(message => message.role === 'suggestion');
  if (waiting.length) fail(400, 'Choose one reply before adding their next message.');
  const now = Date.now(), incoming = cleanIncomingMessage(text);
  await env.DB.prepare('INSERT INTO boplo_conversation_messages(id,conversation_id,role,body,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), conversationId, 'them', incoming, now).run();
  const current = await loadConversation(env, user.id, conversationId);
  const analysis = await generateChatReply(env, conversationTranscript(current.messages), conversation.vibe);
  await saveReplyOptions(env, conversationId, analysis.replies);
  await env.DB.prepare('UPDATE boplo_conversations SET title=?,updated_at=? WHERE id=?').bind(conversationTitle([...current.messages, { role: 'them', body: incoming }]), Date.now(), conversationId).run();
  return { conversation: await loadConversation(env, user.id, conversationId), analysis };
}
async function listConversations(env, user) {
  const plan = await threadPlan(env, user.id);
  const rows = await env.DB.prepare("SELECT id,title,vibe,status,created_at,updated_at FROM boplo_conversations WHERE user_id=? AND status='active' ORDER BY updated_at DESC LIMIT 20").bind(user.id).all();
  return { plan, limit: plan === 'pro' ? null : 2, conversations: rows.results || [] };
}
function reviewPrompt() { return `You are Boplo, an encouraging darts practice assistant. Review this short side-on darts throw video as a complete motion, paying attention only to patterns that are clearly visible across the sequence. Do not claim to diagnose injury, identify a precise technical fault, or guarantee improvement. Do not invent a view you cannot see. Return only JSON with this exact shape: {"headline":"short encouraging headline","summary":"2 sentence plain-English review","observations":[{"label":"Setup|Balance|Release|Follow-through","note":"specific visible observation","confidence":"low|medium|high"}],"next_drill":"one Boplo drill name","safety_note":"short reminder that this is practice guidance, not coaching or medical advice"}. Keep it constructive, cautious and concise.`; }
function readOutput(response) { const text = response.output_text || ''; try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')); } catch { fail(502, 'The video review could not be read. Please try again.'); } }
function base64(buffer) { const bytes = new Uint8Array(buffer), chunks = []; for (let start = 0; start < bytes.length; start += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(start, start + 0x8000))); return btoa(chunks.join('')); }
async function analyseVideo(env, video) {
  if (!env.GEMINI_API_KEY) fail(503, 'Video review is not connected yet. Add GEMINI_API_KEY in Cloudflare first.');
  if (!env.VIDEOS) fail(503, 'Video storage is not connected yet. Add an R2 bucket binding called VIDEOS in Cloudflare.');
  const object = await env.VIDEOS.get(video.object_key);
  if (!object) fail(404, 'Video file not found.');
  if (object.size > 18 * 1024 * 1024) fail(413, 'Keep review clips under 18 MB while Video Review is in beta.');
  const request = { model: env.GEMINI_VISION_MODEL || 'gemini-3.8-flash', input: [{ type: 'text', text: reviewPrompt() }, { type: 'video', data: base64(await object.arrayBuffer()), mime_type: video.content_type, processing: { type: 'static', fps: 4 } }] };
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok) fail(502, 'The video review service is unavailable. Try again shortly.');
  return readOutput(await response.json());
}

export async function onRequest(context) {
  const { request, env } = context, url = new URL(request.url), canonicalAuth = url.pathname.startsWith('/auth/'), routePrefix = canonicalAuth ? '' : '/darts', path = canonicalAuth ? url.pathname.replace(/^\/auth\/?/, '') : url.pathname.replace(/^\/darts\/?/, '');
  try {
    if (!env.DB) fail(503, 'Boplo is still connecting its player database.');
    const secure = url.protocol === 'https:';
    if ((path === 'auth/email' || path === 'email') && request.method === 'POST') {
      if (!env.RESEND_API_KEY || !env.EMAIL_FROM) fail(503, 'Email sign-in is not configured yet.');
      const email = cleanEmail((await body(request)).email), raw = token(), expires = Date.now() + 15 * 60000;
      await env.DB.prepare('DELETE FROM darts_magic_links WHERE email=? OR expires_at<?').bind(email, Date.now()).run();
      await env.DB.prepare('INSERT INTO darts_magic_links(token_hash,email,expires_at,created_at) VALUES(?,?,?,?)').bind(await hash(raw), email, expires, Date.now()).run();
      const link = `${env.APP_ORIGIN || url.origin}${routePrefix}/auth/verify?token=${encodeURIComponent(raw)}`;
      const send = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: 'Your Boplo sign-in link', html: `<main style="font-family:Arial,sans-serif;color:#102b45"><p style="font-size:20px;font-weight:700">Your Boplo sign-in link is ready.</p><p>Use the secure link below to open your workspace. It expires in 15 minutes.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#123a61;color:#fff;border-radius:10px;text-decoration:none;font-weight:700">Open Boplo</a></p><p>If you did not request this, you can safely ignore this email.</p></main>` }) });
      if (!send.ok) fail(502, 'We could not send that email. Try again shortly.');
      return json({ ok: true });
    }
    if ((path === 'auth/verify' || path === 'verify') && request.method === 'GET') {
      const raw = url.searchParams.get('token') || '', row = await env.DB.prepare('SELECT email,expires_at,used_at FROM darts_magic_links WHERE token_hash=?').bind(await hash(raw)).first();
      if (!row || row.used_at || row.expires_at < Date.now()) return new Response('This sign-in link has expired. Return to Boplo and request another.', { status: 400 });
      await env.DB.prepare('UPDATE darts_magic_links SET used_at=? WHERE token_hash=?').bind(Date.now(), await hash(raw)).run();
      const userId = await upsertUser(env, { email: row.email, name: row.email.split('@')[0] });
      return new Response(null, { status: 302, headers: { Location: `${env.APP_ORIGIN || url.origin}/#workspace`, 'Set-Cookie': await createSession(env, userId, secure) } });
    }
    if ((path === 'auth/google' || path === 'google') && request.method === 'GET') {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) fail(503, 'Google sign-in is not configured yet.');
      const state = token(); await env.DB.prepare('INSERT INTO darts_oauth_states(state_hash,expires_at,created_at) VALUES(?,?,?)').bind(await hash(state), Date.now() + 10 * 60000, Date.now()).run();
      const redirect = `${env.APP_ORIGIN || url.origin}${routePrefix}/auth/google/callback`, q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, 302);
    }
    if ((path === 'auth/google/callback' || path === 'google/callback') && request.method === 'GET') {
      const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '', stateRow = await env.DB.prepare('SELECT expires_at FROM darts_oauth_states WHERE state_hash=?').bind(await hash(state)).first();
      if (!stateRow || stateRow.expires_at < Date.now() || !code) fail(400, 'Google sign-in expired. Please try again.');
      await env.DB.prepare('DELETE FROM darts_oauth_states WHERE state_hash=?').bind(await hash(state)).run();
      const redirect = `${env.APP_ORIGIN || url.origin}${routePrefix}/auth/google/callback`;
      const exchange = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }) });
      if (!exchange.ok) fail(502, 'Google sign-in could not be completed.');
      const access = (await exchange.json()).access_token, profile = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access}` } })).json();
      if (!profile.email_verified || !profile.sub) fail(400, 'Google did not return a verified email address.');
      const userId = await upsertUser(env, { email: cleanEmail(profile.email), name: profile.name || null, googleSubject: profile.sub });
      return new Response(null, { status: 302, headers: { Location: `${env.APP_ORIGIN || url.origin}/#workspace`, 'Set-Cookie': await createSession(env, userId, secure) } });
    }
    if ((path === 'auth/logout' || path === 'logout') && request.method === 'POST') {
      const response = json({ ok: true }, 200, { 'Set-Cookie': cookie('boplo_session', '', 0, secure) });
      response.headers.append('Set-Cookie', cookie('boplo_darts', '', 0, secure));
      return response;
    }
    const user = await userFromRequest(request, env);
    if (path === 'me' && request.method === 'GET') return json({ user });
    if (!user) fail(401, 'Sign in to save your Boplo workspace.');
    if (path === 'profile' && request.method === 'PATCH') {
      const input = await body(request), displayName = String(input.displayName || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!displayName) fail(400, 'Enter a name for your Boplo profile.');
      await env.DB.prepare('UPDATE darts_users SET display_name=?,updated_at=? WHERE id=?').bind(displayName, Date.now(), user.id).run();
      return json({ user: { ...user, display_name: displayName } });
    }
    if (path === 'chat/extract' && request.method === 'POST') {
      const input = await body(request, 6 * 1024 * 1024);
      return json(await extractChat(env, cleanChatImage(input.image)));
    }
    if (path === 'chat/reply' && request.method === 'POST') {
      const input = await body(request, 20000), transcript = cleanTranscript(input.transcript), vibe = cleanVibe(input.vibe), mode = cleanReplyMode(input.mode), analysis = await generateChatReply(env, transcript, vibe, mode), id = crypto.randomUUID(), now = Date.now();
      try { await env.DB.prepare('INSERT INTO boplo_chat_reads(id,user_id,transcript,vibe,analysis_json,created_at) VALUES(?,?,?,?,?,?)').bind(id, user.id, transcript, vibe, JSON.stringify(analysis), now).run(); } catch { /* The reply remains useful while migration 0006 is being applied. */ }
      let conversation = null;
      if (input.createConversation) {
        try { conversation = await createConversation(env, user, transcript, vibe, analysis); }
        catch (error) { if (/no such table/i.test(error.message || '')) fail(503, 'Apply migration 0007 before starting conversation threads.'); throw error; }
      }
      return json({ id, vibe, mode, ...analysis, conversation }, 201);
    }
    if (path === 'chat/conversation' && request.method === 'GET') {
      try {
        const id = url.searchParams.get('id');
        return json(id ? { conversation: await loadConversation(env, user.id, id) } : await listConversations(env, user));
      }
      catch (error) { if (/no such table/i.test(error.message || '')) fail(503, 'Apply migration 0007 before opening conversation threads.'); throw error; }
    }
    if (path === 'chat/conversation' && request.method === 'POST') {
      const input = await body(request, 20000), action = String(input.action || ''), conversationId = String(input.conversationId || '');
      if (!/^[a-f0-9-]{36}$/i.test(conversationId)) fail(400, 'Choose a valid conversation.');
      try {
        if (action === 'select') return json({ conversation: await selectThreadReply(env, user, conversationId, String(input.messageId || '')) });
        if (action === 'incoming') return json(await addIncomingThreadMessage(env, user, conversationId, input.text));
        if (action === 'archive') {
          const existing = await loadConversation(env, user.id, conversationId);
          await env.DB.prepare("UPDATE boplo_conversations SET status='archived',updated_at=? WHERE id=? AND user_id=?").bind(Date.now(), existing.id, user.id).run();
          return json({ ok: true });
        }
        fail(400, 'Choose a valid conversation action.');
      } catch (error) { if (/no such table/i.test(error.message || '')) fail(503, 'Apply migration 0007 before using conversation threads.'); throw error; }
    }
    if (path === 'videos' && request.method === 'GET') return json((await dashboard(env, user)).videos);
    if (path === 'videos/upload' && request.method === 'POST') {
      if (!env.VIDEOS) fail(503, 'Video storage is not connected yet. Add an R2 bucket binding called VIDEOS in Cloudflare.');
      const contentType = request.headers.get('Content-Type') || '';
      const size = Number(request.headers.get('X-Boplo-Video-Size') || request.headers.get('Content-Length') || 0);
      if (!contentType.startsWith('video/')) fail(400, 'Upload a video file.');
      if (size && size > 18 * 1024 * 1024) fail(413, 'Keep Video Review clips under 18 MB.');
      const id = crypto.randomUUID(), name = cleanVideoName(request.headers.get('X-Boplo-Video-Name')), key = `private/${user.id}/${id}/${name}`, now = Date.now();
      await env.VIDEOS.put(key, request.body, { httpMetadata: { contentType }, customMetadata: { userId: user.id, videoId: id } });
      await env.DB.prepare('INSERT INTO darts_video_reviews(id,user_id,object_key,original_name,content_type,size_bytes,status,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, user.id, key, name, contentType, size || 0, 'uploaded', now).run();
      return json({ id, status: 'uploaded' }, 201);
    }
    const videoFile = path.match(/^videos\/([a-f0-9-]{36})\/file$/);
    if (videoFile && request.method === 'GET') {
      if (!env.VIDEOS) fail(503, 'Video storage is not connected yet.');
      const video = await env.DB.prepare('SELECT object_key,content_type FROM darts_video_reviews WHERE id=? AND user_id=?').bind(videoFile[1], user.id).first();
      if (!video) fail(404, 'Video not found.');
      const object = await env.VIDEOS.get(video.object_key);
      if (!object) fail(404, 'Video file not found.');
      return new Response(object.body, { headers: { 'Content-Type': video.content_type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    }
    const videoAnalysis = path.match(/^videos\/([a-f0-9-]{36})\/analyse$/);
    if (videoAnalysis && request.method === 'POST') {
      const video = await env.DB.prepare('SELECT id,object_key,content_type FROM darts_video_reviews WHERE id=? AND user_id=?').bind(videoAnalysis[1], user.id).first();
      if (!video) fail(404, 'Video not found.');
      await env.DB.prepare("UPDATE darts_video_reviews SET status='analysing',error_message=NULL WHERE id=? AND user_id=?").bind(video.id, user.id).run();
      try {
        const analysis = await analyseVideo(env, video), now = Date.now();
        await env.DB.prepare("UPDATE darts_video_reviews SET status='ready',analysis_json=?,analysed_at=? WHERE id=? AND user_id=?").bind(JSON.stringify(analysis), now, video.id, user.id).run();
        return json({ id: video.id, status: 'ready', analysis });
      } catch (error) {
        await env.DB.prepare("UPDATE darts_video_reviews SET status='failed',error_message=? WHERE id=? AND user_id=?").bind(error.message || 'Review failed.', video.id, user.id).run();
        throw error;
      }
    }
    if (path === 'dashboard' && request.method === 'GET') return json(await dashboard(env, user));
    if (path === 'drills' && request.method === 'GET') return json({ drills: Object.values(DRILLS) });
    if (path === 'sessions' && request.method === 'GET') return json((await dashboard(env, user)).sessions);
    if (path === 'sessions' && request.method === 'POST') {
      const input = await body(request), type = String(input.type || '').slice(0, 60), average = cleanNumber(input.average, 'three-dart average'), doubles = cleanNumber(input.doubles, 'double rate'), checkout = cleanNumber(input.checkout, 'checkout rate'), note = String(input.note || '').slice(0, 160);
      if (!type) fail(400, 'Choose a session type.'); if (doubles > 100 || checkout > 100) fail(400, 'Rates must be between 0 and 100.');
      const targetRows = Array.isArray(input.targets) ? input.targets.slice(0, 6).map(row => ({ target: String(row?.target || '').toUpperCase(), hits: Math.round(Number(row?.hits)), attempts: Math.round(Number(row?.attempts)) })).filter(row => row.attempts > 0 || row.hits > 0) : [];
      if (targetRows.some(row => !TARGETS.has(row.target) || !Number.isInteger(row.hits) || !Number.isInteger(row.attempts) || row.hits < 0 || row.attempts < 0 || row.hits > row.attempts || row.attempts > 180)) fail(400, 'Check each target hit and attempt count.');
      if (targetRows.length) try { await env.DB.prepare('SELECT 1 FROM darts_target_results LIMIT 1').first(); } catch { fail(503, 'Apply migration 0004 before saving board targets.'); }
      const sessionId = crypto.randomUUID(), now = Date.now();
      await env.DB.prepare('INSERT INTO darts_practice_sessions(id,user_id,session_type,three_dart_average,doubles_rate,checkout_rate,note,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(sessionId, user.id, type, average, doubles, checkout, note || null, now).run();
      if (targetRows.length) await env.DB.batch(targetRows.map(row => env.DB.prepare('INSERT INTO darts_target_results(id,session_id,user_id,target,hits,attempts,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), sessionId, user.id, row.target, row.hits, row.attempts, now)));
      return json(await dashboard(env, user), 201);
    }
    if (path === 'drills/start' && request.method === 'POST') {
      const input = await body(request), currentDashboard = await dashboard(env, user), current = recommendation(currentDashboard.sessions, currentDashboard.intelligence.heatmap), key = String(input.key || current.key).slice(0, 60), selected = DRILLS[key];
      if (!selected) fail(400, 'Choose a drill from the Boplo library.');
      try {
        const id = crypto.randomUUID(), now = Date.now();
        await env.DB.prepare('INSERT INTO darts_drill_runs(id,user_id,drill_key,target,achieved,started_at) VALUES(?,?,?,?,?,?)').bind(id, user.id, key, selected.target, 0, now).run();
        return json({ ok: true, runId: id, drill: selected, recommendation: current }, 201);
      } catch { fail(503, 'Apply migration 0003 before recording drill results.'); }
    }
    if (path === 'drills/complete' && request.method === 'POST') {
      const currentDashboard = await dashboard(env, user), current = recommendation(currentDashboard.sessions, currentDashboard.intelligence.heatmap), input = await body(request), key = String(input.key || current.key).slice(0, 60), selected = DRILLS[key], achieved = Math.round(cleanNumber(input.achieved, 'drill result')), confidence = Math.round(cleanNumber(input.confidence, 'confidence'));
      if (!selected) fail(400, 'Choose a drill from the Boplo library.');
      if (achieved > Math.max(999, selected.target * 5) || confidence < 1 || confidence > 5) fail(400, 'Enter a valid drill result.');
      const note = String(input.note || '').slice(0, 160), now = Date.now();
      try {
        await env.DB.prepare('INSERT INTO darts_drill_runs(id,user_id,drill_key,target,achieved,confidence,note,started_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), user.id, key, selected.target, achieved, confidence, note || null, now, now).run();
      } catch { fail(503, 'Apply migration 0003 before recording drill results.'); }
      await env.DB.prepare('INSERT INTO darts_drill_completions(id,user_id,drill_key,completed_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(), user.id, key, now).run();
      return json(await dashboard(env, user), 201);
    }
    fail(404, 'Not found.');
  } catch (error) { return json({ error: error.status ? error.message : 'Boplo is temporarily unavailable. Please try again.' }, error.status || 500); }
}
