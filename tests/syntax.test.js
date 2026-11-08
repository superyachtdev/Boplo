// Every browser script in dist/ must parse: a syntax error there doesn't fail any other test, but stops the page loading it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const files = readdirSync(new URL('../dist/', import.meta.url)).filter(f => f.endsWith('.js'));
for (const f of files) {
  test(`dist/${f} parses`, () => {
    const src = readFileSync(new URL(`../dist/${f}`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: f }));
  });
}
