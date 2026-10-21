// Build per-country airfield files for the flight desk map from OurAirports data (public domain).
// Usage: git clone --depth 1 https://github.com/davidmegginson/ourairports-data /tmp/oa
//        node scripts/build-airfields.mjs /tmp/oa dist/airfields
// Output: <out>/<ISO2>.json  — {v, country, built, source, fields, rows:[...]}
//         <out>/index.json   — {built, counts:{ISO2:n}}
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , src = '/tmp/oa', out = 'dist/airfields'] = process.argv;

// Small RFC 4180 CSV parser (quoted fields, commas and newlines inside quotes)
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const KEEP = { large_airport: 'L', medium_airport: 'M', small_airport: 'S', seaplane_base: 'W' };
const SURF = s => { s = (s || '').toUpperCase(); if (/ASP|ASPH|BIT|TAR|PEM/.test(s)) return 'asphalt'; if (/CON|PCC/.test(s)) return 'concrete'; if (/GRS|GRASS|TURF/.test(s)) return 'grass'; if (/GRV|GRAVEL/.test(s)) return 'gravel'; if (/DIRT|SAND|SOIL|CLAY|EARTH/.test(s)) return 'dirt'; if (/WATER/.test(s)) return 'water'; return s ? 'other' : ''; };
const FREQ_KEEP = ['TWR', 'AFIS', 'A/G', 'CTAF', 'UNIC', 'INFO', 'RDO', 'APP', 'GND', 'ATIS'];

const airports = parseCSV(readFileSync(join(src, 'airports.csv'), 'utf8'));
const runways = parseCSV(readFileSync(join(src, 'runways.csv'), 'utf8'));
const freqs = parseCSV(readFileSync(join(src, 'airport-frequencies.csv'), 'utf8'));

const rwBy = new Map();
for (const r of runways) {
  if (r.closed === '1') continue;
  const list = rwBy.get(r.airport_ref) || []; list.push(r); rwBy.set(r.airport_ref, list);
}
const fqBy = new Map();
for (const f of freqs) {
  const t = (f.type || '').toUpperCase(); if (!FREQ_KEEP.some(k => t.startsWith(k))) continue;
  const list = fqBy.get(f.airport_ref) || []; list.push(f); fqBy.set(f.airport_ref, list);
}

const byCountry = {};
for (const a of airports) {
  const t = KEEP[a.type]; if (!t) continue;
  const lat = +a.latitude_deg, lng = +a.longitude_deg; if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const code = a.icao_code || a.gps_code || a.ident;
  const rws = (rwBy.get(a.id) || [])
    .sort((x, y) => (+y.length_ft || 0) - (+x.length_ft || 0)).slice(0, 4)
    .map(r => [[r.le_ident, r.he_ident].filter(Boolean).join('/'), Math.round((+r.length_ft || 0) * 0.3048), SURF(r.surface)]);
  const fqs = (fqBy.get(a.id) || []).slice(0, 4).map(f => [f.type, f.description || '', +(+f.frequency_mhz).toFixed(3)]);
  (byCountry[a.iso_country] ||= []).push([code, a.name, +lat.toFixed(5), +lng.toFixed(5), t, a.elevation_ft ? +a.elevation_ft : null, a.municipality || '', a.iata_code || '', rws, fqs]);
}

mkdirSync(out, { recursive: true });
const built = new Date().toISOString().slice(0, 10), counts = {};
for (const [cc, rows] of Object.entries(byCountry)) {
  if (!/^[A-Z]{2}$/.test(cc)) continue;
  rows.sort((a, b) => 'LMSW'.indexOf(a[4]) - 'LMSW'.indexOf(b[4]) || a[0].localeCompare(b[0]));
  counts[cc] = rows.length;
  writeFileSync(join(out, cc + '.json'), JSON.stringify({ v: 1, country: cc, built, source: 'OurAirports (public domain), ourairports.com', fields: ['code', 'name', 'lat', 'lng', 'type', 'elevationFt', 'city', 'iata', 'runways[ident,lengthM,surface]', 'freqs[type,desc,mhz]'], rows }));
}
writeFileSync(join(out, 'index.json'), JSON.stringify({ built, source: 'OurAirports (public domain)', counts }));
console.log(`Wrote ${Object.keys(counts).length} countries, ${Object.values(counts).reduce((a, b) => a + b, 0)} airfields to ${out}`);
