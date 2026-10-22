import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { writeFileSync } from 'fs';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 700 } });
const ids = ['c152','c172','pa28','da40','da20','p2008','dr400','sr20','cub'], meta = {};
for (const id of ids) { await pg.goto(`http://localhost:8790/render.html?id=${id}`); await pg.waitForFunction(() => window.done); meta[id] = await pg.evaluate(() => window.shadow); await pg.locator('canvas').screenshot({ path: `r/${id}.png`, omitBackground: true }); }
writeFileSync('r/meta.json', JSON.stringify(meta)); await b.close();
