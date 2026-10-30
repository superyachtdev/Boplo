// Builds dist/airfields/world.json from the per-country files: every airport with scheduled-size runways (types L and M)
// for the worldwide route map, plus a 5° grid saying which countries have airfields in each cell, so the map can load
// a country's small airfields and runways only when you look at it. Run after build-airfields.mjs.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = new URL('../dist/airfields/', import.meta.url).pathname;
const rows = [], cells = {};
for (const f of readdirSync(dir).filter(f => /^[A-Z]{2}\.json$/.test(f)).sort()) {
  const cc = f.slice(0, 2), d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const r of d.rows) {
    const [code, name, lat, lng, type, elev, , iata] = r;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${Math.floor(lat / 5)},${Math.floor(lng / 5)}`;
    (cells[key] = cells[key] || new Set()).add(cc);
    if (type === 'L' || type === 'M') rows.push([code, name, +lat.toFixed(4), +lng.toFixed(4), type, cc, iata || '', elev ?? null]);
  }
}
const grid = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, [...v].join(' ')]));
writeFileSync(join(dir, 'world.json'), JSON.stringify({ v: 1, source: 'OurAirports (public domain), ourairports.com', fields: ['code', 'name', 'lat', 'lng', 'type', 'cc', 'iata', 'elevationFt'], grid, rows }));
console.log(`world.json: ${rows.length} airports, ${Object.keys(grid).length} grid cells`);
