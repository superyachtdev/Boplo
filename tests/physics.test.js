import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// load the browser flight model, aircraft and jet data into a sandbox
const ctx = { console, Math, JSON, Object, Array, Number, String, Set, Map, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int16Array, DataView, ArrayBuffer, TextEncoder, document: { createElement: () => ({ getContext: () => null }) } };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['flight-physics.js', 'flight-aircraft.js', 'flight-jets.js']) vm.runInContext(readFileSync(new URL('../dist/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
const P = ctx.BoploPhysics, A = ctx.BoploAircraft, KT = .514444, dt = 1 / 60;
const make = (id, o = {}) => { const fm = P.create(id, A.model(id), { groundAt: () => 0, ...o }); return fm; };

test('airspeed comes from the air, ground speed from the ground', () => {
  const fm = make('c172', { groundAt: () => -1e5 }); fm.reset({ alt: 300, airborne: true, speed: 50 }); fm.s.power = fm.c.throttle = .7;
  fm.step(dt, [0, 0, -10]); // 10 m/s wind blowing from the north, into a north-bound aircraft
  assert.ok(Math.abs(fm.s.tas - fm.s.gs - 10) < .5, `tas ${fm.s.tas} gs ${fm.s.gs}`);
});

test('ground effect cuts drag near the runway', () => {
  // energy (speed and height together) lost in half a second of idle-power gliding, at 1 m and at 200 m
  const loss = alt => { const fm = make('narrow', { groundAt: () => 0 }); fm.reset({ alt, airborne: true, speed: 70 }); fm.c.throttle = 0; fm.s.power = 0; fm.c.flaps = fm.notches - 1; fm.c.trim = fm.trimFor(70);
    const E = () => .5 * Math.hypot(...fm.s.v) ** 2 + 9.81 * fm.s.alt, e0 = E(); for (let i = 0; i < 15; i++) fm.step(dt); return e0 - E(); };
  assert.ok(loss(1.5) < loss(200) * .97, `loses ${loss(1.5).toFixed(1)} J/kg near the ground vs ${loss(200).toFixed(1)} up high`);
});

test('jets spool up slowly from idle and reversers shorten the landing roll', () => {
  const fm = make('narrow'); fm.reset({}); fm.c.parking = true; fm.c.throttle = 1;
  for (let i = 0; i < 60 * 2; i++) fm.step(dt);
  assert.ok(fm.s.power < .6, `two seconds after the levers go up, power is ${fm.s.power.toFixed(2)}`);
  for (let i = 0; i < 60 * 10; i++) fm.step(dt);
  assert.ok(fm.s.power > .95);
  const roll = rev => { const f = make('narrow'); f.reset({}); f.c.parking = false; f.c.flaps = f.notches - 1; f.s.v = [0, 0, 65]; f.c.brake = .6; f.c.reverse = rev;
    let t = 0; while (Math.hypot(f.s.v[0], f.s.v[2]) > 1 && t < 120) { f.c.throttle = rev && f.s.ias / KT > 70 ? .8 : 0; f.step(dt); t += dt; } return f.s.z; };
  const r1 = roll(true), r0 = roll(false); assert.ok(r1 < r0 - 20, `reverse thrust stops it sooner: ${Math.round(r1)} m vs ${Math.round(r0)} m`);
});

test('a trainer still matches its book numbers', () => {
  const fm = make('c172'); fm.reset({}); fm.c.parking = false; fm.c.throttle = 1;
  let t = 0; while (fm.s.ias / KT < 55 && t < 60) { fm.step(dt); t += dt; }
  const d = Math.hypot(fm.s.x, fm.s.z); assert.ok(d > 150 && d < 320, `take-off roll ${d} m`);
});
