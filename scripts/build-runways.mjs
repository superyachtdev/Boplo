// Build per-country runway geometry for the simulator from OurAirports data (public domain).
// Usage: git clone --depth 1 https://github.com/davidmegginson/ourairports-data /tmp/oa
//        node scripts/build-runways.mjs /tmp/oa dist/runways
// Output: <out>/<ISO2>.json — {v, built, source, fields, rows:{CODE:[[leIdent, heIdent, leLat, leLng, heLat, heLng, lengthM, widthM, surface, lit, leDispM, heDispM, approx], …]}}
// Codes match dist/airfields (icao_code || gps_code || ident). Runways without published end coordinates are placed
// through the airport reference point on their true heading (from the data, or the designator corrected by an approximate
// magnetic declination), and flagged approx = 1.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , src = '/tmp/oa', out = 'dist/runways'] = process.argv;
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const SURF = s => { s = (s || '').toUpperCase(); if (/ASP|ASPH|BIT|TAR|PEM|PAVED|MAC/.test(s)) return 'asphalt'; if (/CON|PCC/.test(s)) return 'concrete'; if (/GRS|GRASS|TURF|GRE/.test(s)) return 'grass'; if (/GRV|GRAVEL|GVL/.test(s)) return 'gravel'; if (/DIRT|SAND|SOIL|CLAY|EARTH|LAT|GND/.test(s)) return 'dirt'; if (/WATER/.test(s)) return 'water'; return s ? 'other' : ''; };
const D2R = Math.PI / 180;
// approximate magnetic declination from a tilted dipole (good to a few degrees away from the poles)
const POLE = [80.8 * D2R, -72.7 * D2R];
function declination(lat, lng) {
  const p = lat * D2R, l = lng * D2R, [pp, pl] = POLE;
  const y = Math.sin(pl - l) * Math.cos(pp), x = Math.cos(p) * Math.sin(pp) - Math.sin(p) * Math.cos(pp) * Math.cos(pl - l);
  return Math.atan2(y, x) / D2R; // bearing to the magnetic pole = declination (east positive)
}
const NAMED = { N: 360, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315, NNE: 22.5, ENE: 67.5, ESE: 112.5, SSE: 157.5, SSW: 202.5, WSW: 247.5, WNW: 292.5, NNW: 337.5 };
const identHdg = id => { const m = String(id || '').toUpperCase().match(/^(\d{1,2})[LRCGW]?$/); if (m) return (+m[1] % 36 || 36) * 10; const n = NAMED[String(id || '').toUpperCase().replace(/[^A-Z]/g, '')]; return n ?? null; };
const dest = (lat, lng, brg, m) => { const R = 6371008.8, d = m / R, b = brg * D2R, p1 = lat * D2R, l1 = lng * D2R; const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b)); const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)); return [p2 / D2R, ((l2 / D2R + 540) % 360) - 180]; };
const r5 = v => Math.round(v * 1e5) / 1e5;

const airports = parseCSV(readFileSync(join(src, 'airports.csv'), 'utf8'));
const runways = parseCSV(readFileSync(join(src, 'runways.csv'), 'utf8'));
const byId = new Map(airports.map(a => [a.id, a]));
const KEEP = new Set(['large_airport', 'medium_airport', 'small_airport', 'seaplane_base']);
const byCountry = {}; let exact = 0, approx = 0, skipped = 0;
for (const r of runways) {
  if (r.closed === '1') continue;
  const a = byId.get(r.airport_ref); if (!a || !KEEP.has(a.type)) continue;
  const le = (r.le_ident || '').trim(), he = (r.he_ident || '').trim();
  if (/^H/i.test(le)) { skipped++; continue; } // helipads
  const lenM = Math.round((+r.length_ft || 0) * .3048) || null, widM = Math.round((+r.width_ft || 0) * .3048) || null;
  const surf = SURF(r.surface), lit = r.lighted === '1' ? 1 : 0;
  const leD = Math.round((+r.le_displaced_threshold_ft || 0) * .3048), heD = Math.round((+r.he_displaced_threshold_ft || 0) * .3048);
  let row;
  const lla = +r.le_latitude_deg, llo = +r.le_longitude_deg, hla = +r.he_latitude_deg, hlo = +r.he_longitude_deg;
  if (r.le_latitude_deg && r.he_latitude_deg && Number.isFinite(lla + llo + hla + hlo)) {
    row = [le, he, r5(lla), r5(llo), r5(hla), r5(hlo), lenM, widM, surf, lit, leD, heD, 0]; exact++;
  } else {
    const alat = +a.latitude_deg, alng = +a.longitude_deg; if (!Number.isFinite(alat + alng)) { skipped++; continue; }
    let hdg = Number.isFinite(parseFloat(r.le_heading_degT)) ? parseFloat(r.le_heading_degT) : null;
    if (hdg == null) { const m = identHdg(le) ?? (identHdg(he) != null ? (identHdg(he) + 180) % 360 : null); if (m == null) { skipped++; continue; } hdg = (m + declination(alat, alng) + 360) % 360; }
    const L = lenM && lenM > 80 ? lenM : 600;
    const A = dest(alat, alng, (hdg + 180) % 360, L / 2), B = dest(alat, alng, hdg, L / 2);
    row = [le, he, r5(A[0]), r5(A[1]), r5(B[0]), r5(B[1]), L, widM, surf, lit, leD, heD, 1]; approx++;
  }
  const code = a.icao_code || a.gps_code || a.ident;
  ((byCountry[a.iso_country] ||= {})[code] ||= []).push(row);
}
mkdirSync(out, { recursive: true });
const built = new Date().toISOString().slice(0, 10);
for (const [cc, rows] of Object.entries(byCountry)) writeFileSync(join(out, `${cc}.json`), JSON.stringify({ v: 1, built, source: 'OurAirports (public domain), ourairports.com', fields: ['leIdent', 'heIdent', 'leLat', 'leLng', 'heLat', 'heLng', 'lengthM', 'widthM', 'surface', 'lit', 'leDisplacedM', 'heDisplacedM', 'approx'], rows }));
console.log({ exact, approx, skipped, countries: Object.keys(byCountry).length });
