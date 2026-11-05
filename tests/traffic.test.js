import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { traffic, tidy, area } from '../functions/lib/traffic.js';

const db = new DatabaseSync(':memory:');
const env = extra => ({ ADSB_API_KEY: 'k', ...extra, DB: { prepare(sql) { let args = []; return { bind(...a) { args = a; return this; }, async first() { return db.prepare(sql).get(...args) || null; }, async run() { return db.prepare(sql).run(...args); } }; } } });
const memCache = () => { const m = new Map(); return { async match(r) { const v = m.get(r.url); return v ? new Response(v) : undefined; }, async put(r, res) { m.set(r.url, await res.text()); } }; };

test('nearby viewers share one upstream call, and the key never reaches the app', async () => {
  const calls = [];
  const fake = async (u, init) => { calls.push({ u, key: init.headers['X-Api-Key'] }); return new Response(JSON.stringify({ now: 1, ac: [{ hex: 'abc123', flight: 'BAW12  ', r: 'G-ABCD', t: 'A320', lat: 51.5, lon: -0.4, alt_baro: 3500, gs: 210, track: 270, seen_pos: 1 }] })); };
  const cache = memCache();
  const r1 = await traffic(env(), new URL('https://boplo.app/flight/traffic?lat=51.47&lng=-0.45&km=80'), fake, cache);
  const r2 = await traffic(env(), new URL('https://boplo.app/flight/traffic?lat=51.49&lng=-0.41&km=90'), fake, cache);
  const body = await r1.text(); await r2.text();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'k');
  assert.match(calls[0].u, /\/lat\/51\.4\/lon\/-0\.4\/dist\/100$/);
  assert.doesNotMatch(body, /"k"|X-Api-Key/);
  const j = JSON.parse(body);
  assert.equal(j.aircraft[0].cs, 'BAW12');
  assert.match(j.attribution, /FlyItalyADSB/);
});

test('stale, LADD and position-less aircraft are left out; PIA hides identity', () => {
  const list = tidy([
    { hex: 'a1', lat: 1, lon: 1, seen_pos: 120 },
    { hex: 'a2', lat: 1, lon: 1, dbFlags: 8 },
    { hex: 'a3' },
    { hex: 'a4', lat: 1, lon: 1, dbFlags: 4, flight: 'SECRET', r: 'N1' , alt_baro: 'ground' }
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].cs, ''); assert.equal(list[0].reg, ''); assert.equal(list[0].ground, true);
});

test('radius is capped at the free plan’s 500 km and bad positions are refused', () => {
  assert.equal(area(new URL('https://x/?lat=10&lng=10&km=5000')).km, 500);
  assert.throws(() => area(new URL('https://x/?lat=99&lng=0')), /map position/);
});

test('without a key, or past the daily ceiling, it says so instead of calling out', async () => {
  await assert.rejects(traffic({ DB: env().DB }, new URL('https://x/?lat=1&lng=1')), e => e.status === 503);
  let called = false;
  await assert.rejects(traffic(env({ ADSB_DAILY: '0' }), new URL('https://x/?lat=2&lng=2'), async () => { called = true; }, null), e => e.status === 503);
  assert.equal(called, false);
});
