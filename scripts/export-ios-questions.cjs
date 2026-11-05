// Writes the theory question bank for the native iPhone app (ios-native/BoploFlight/Resources/questions.json).
// Run after editing dist/flight-questions.js: node scripts/export-ios-questions.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../dist/flight-questions.js'), 'utf8');
const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(src, ctx);
const QB = ctx.window.BOPLO_QUESTIONS;
const pack = r => { const x = QB.forRegime(r); return { subjects: x.subjects, questions: x.questions }; };
const out = { status: QB.status, reviewed: QB.reviewed, passMark: { faa: QB.passMark('faa'), other: QB.passMark('uk') }, icao: pack('icao'), faa: pack('faa') };
const dest = path.join(__dirname, '../ios-native/BoploFlight/Resources/questions.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log('questions:', out.icao.questions.length, 'icao,', out.faa.questions.length, 'faa');
