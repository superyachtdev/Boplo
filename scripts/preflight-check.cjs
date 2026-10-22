// node scripts/preflight-check.cjs : sanity checks for dist/flight-preflight.js
global.window = {}; require('../dist/flight-preflight.js'); const P = window.BoploPreflight;
const A = P.aircraft('c172');
// POH sample loading problem (C172S): 2 x 170 lb front, 0 rear, 53 gal fuel
const r = P.wb(A, { front: 340, rear: 0, bagA: 20 }, { start: 53, burn: 20 });
console.log('C172 TOW', r.W.toFixed(0), 'CG', r.cg.toFixed(2), 'in env', r.toIn, '| LW', r.lw.toFixed(0), 'LCG', r.lcg.toFixed(2), r.ldIn, '| ok', r.ok, r.issues.map(i => i.t));
const over = P.wb(A, { front: 400, rear: 340, bagA: 120 }, { start: 53 });
console.log('C172 overweight', over.W.toFixed(0), over.ok, over.issues.map(i => i.t));
const aft = P.wb(P.aircraft('c152'), { front: 180, bag1: 100, bag2: 40 }, { start: 24.5 });
console.log('C152 baggage', aft.W.toFixed(0), aft.cg.toFixed(2), aft.ok, aft.issues.map(i => i.t));
const da = P.wb(P.aircraft('da40'), { front: 160, rear: 80, bag: 20 }, { start: 100, burn: 40 });
console.log('DA40', da.W.toFixed(0), 'kg', da.cg.toFixed(3), 'm', da.ok, da.issues.map(i => i.t));
console.log('DA20 needs arms', P.wb(P.aircraft('da20'), { front: 150 }, { start: 60 }).issues.map(i => i.t));
// performance: Madrid-ish 2000 ft, 30 C, QNH 1013, grass, 5 kt headwind, MTOW
const pf = P.performance(A, { elevFt: 2000, qnh: 1013, oat: 30, surface: 'grass', head: 5, slope: 0, weight: 2550 });
console.log('PA', Math.round(pf.pa), 'DA', Math.round(pf.da), 'TO50', Math.round(pf.to.d50), 'req', Math.round(pf.to.req), 'LD50', Math.round(pf.ld.d50), 'req', Math.round(pf.ld.req));
console.log('components 120/080/15', P.components(120, 80, 15));
const s = P.sun(39.49, -0.48, '2026-10-22'); console.log('Valencia sun', s.rise.toISOString(), s.set.toISOString(), s.dusk.toISOString());
const f = P.metarFacts({ raw: 'LEVC 221430Z 09012G24KT 9999 SCT030 BKN045 22/14 Q1016', wdir: 90, wspd: 12, wgst: 24, visib: '6+', clouds: [{ cover: 'SCT', base: 3000 }, { cover: 'BKN', base: 4500 }], temp: 22, altim: 1016 });
console.log(f, P.minimums({ wind: 15, gust: 20, cross: 10, visKm: 8, ceil: 2000 }, f, P.components(120, 90, 12).cross));
