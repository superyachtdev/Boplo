// Error alerts for every API route. When SENTRY_DSN is set in Cloudflare, uncaught exceptions and
// 5xx responses are sent to Sentry. No SDK (so no Node compatibility flags are needed) and no
// personal data: the request path and method, never the query string, body, cookies or email.
const id = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

export function parseDsn(dsn) {
  try {
    const u = new URL(dsn), project = u.pathname.replace(/^\/+/, '').split('/').pop();
    if (!u.username || !project) return null;
    return { key: u.username, endpoint: `${u.protocol}//${u.host}/api/${project}/envelope/` };
  } catch { return null; }
}

export function envelope(error, request, env, status) {
  const url = new URL(request.url), now = Date.now() / 1000, eventId = id();
  const event = {
    event_id: eventId, timestamp: now, platform: 'javascript', level: 'error', logger: 'pages-functions',
    environment: env.CF_PAGES_BRANCH && env.CF_PAGES_BRANCH !== 'main' ? `preview-${env.CF_PAGES_BRANCH}` : 'production',
    release: env.CF_PAGES_COMMIT_SHA ? env.CF_PAGES_COMMIT_SHA.slice(0, 12) : undefined,
    request: { url: url.origin + url.pathname, method: request.method },
    tags: { route: url.pathname.split('/').slice(0, 3).join('/') || '/', status: String(status || 500) },
    exception: { values: [{ type: error?.name || 'Error', value: String(error?.message || error).slice(0, 500) }] },
    extra: error?.stack ? { stack: String(error.stack).slice(0, 4000) } : undefined
  };
  return { eventId, body: `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}` };
}

async function report(context, error, status) {
  const dsn = parseDsn(context.env.SENTRY_DSN || '');
  if (!dsn) return;
  const { body } = envelope(error, context.request, context.env, status);
  await fetch(dsn.endpoint, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=boplo-pages/1.0` }
  }).catch(() => { });
}

export async function onRequest(context) {
  try {
    const response = await context.next();
    if (response.status >= 500 && response.status !== 503) {
      context.waitUntil(report(context, new Error(`${context.request.method} ${new URL(context.request.url).pathname} returned ${response.status}`), response.status));
    }
    return response;
  } catch (error) {
    context.waitUntil(report(context, error, 500));
    return new Response(JSON.stringify({ error: 'Something went wrong on our side. Try again in a moment.' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}
