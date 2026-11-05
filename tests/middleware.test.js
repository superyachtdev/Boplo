import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, parseDsn, envelope } from '../functions/_middleware.js';

test('error reports carry the path, never the query string or body', () => {
  const req = new Request('https://boplo.app/flight/ask?token=secret123', { method: 'POST', body: '{"email":"a@b.c"}' });
  const { body } = envelope(new Error('boom'), req, { CF_PAGES_BRANCH: 'main' }, 500);
  assert.doesNotMatch(body, /secret123|a@b\.c/);
  const event = JSON.parse(body.split('\n')[2]);
  assert.equal(event.request.url, 'https://boplo.app/flight/ask');
  assert.equal(event.environment, 'production');
  assert.deepEqual(parseDsn('https://abc@o1.ingest.sentry.io/42'), { key: 'abc', endpoint: 'https://o1.ingest.sentry.io/api/42/envelope/' });
  assert.equal(parseDsn(''), null);
});

test('a crash becomes a clean 500 and is reported when a DSN is set', async () => {
  const sent = [], waits = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response('{}'); };
  try {
    const res = await onRequest({ request: new Request('https://boplo.app/flight/x'), env: { SENTRY_DSN: 'https://k@o1.ingest.sentry.io/7' }, next: async () => { throw new Error('kaput'); }, waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    assert.equal(res.status, 500);
    assert.equal(sent.length, 1);
    assert.match(sent[0].init.body, /kaput/);
  } finally { globalThis.fetch = realFetch; }
});

test('without a DSN nothing is sent and responses pass through', async () => {
  const res = await onRequest({ request: new Request('https://boplo.app/flight/x'), env: {}, next: async () => new Response('ok', { status: 200 }), waitUntil: () => { } });
  assert.equal(await res.text(), 'ok');
});
