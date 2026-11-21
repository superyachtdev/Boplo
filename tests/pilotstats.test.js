import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, tierOf } from '../functions/lib/pilotstats.js';

test('pilot stats stay in range and reward real training', () => {
  const today = 20400, iso = new Date(today * 864e5).toISOString().slice(0, 10);
  const empty = computeStats({}, [], [], today);
  assert.equal(empty.rating, 0);
  assert.equal(empty.tier.name, 'Ground School');
  const busy = computeStats({ sorties: JSON.stringify([{ d: iso, b: 1, p: 1 }]) }, [{ date: iso, minutes: 600 }], [{ score: 80 }], today);
  for (const k of ['knowledge', 'handling', 'airmanship', 'rating']) assert.ok(busy[k] >= 0 && busy[k] <= 99, k);
  assert.ok(busy.handling > empty.handling);
  assert.equal(busy.current.sortieToday, true);
  assert.equal(busy.current.days, 3);
  assert.equal(tierOf(76).name, 'Checkride Ready');
});

test('recorded landing scores lift Handling', () => {
  const today = 20400, iso = new Date(today * 864e5).toISOString().slice(0, 10);
  const plain = computeStats({}, [{ date: iso, minutes: 600 }], [], today);
  const scored = computeStats({}, [{ date: iso, minutes: 600, landingScores: [{ s: 90 }, { s: 85 }, { s: 88 }] }], [], today);
  assert.ok(scored.handling > plain.handling);
  assert.equal(scored.parts.realLandings, 3);
});
