import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate } from '../scripts/italia-css.ts';

test('src/italia.css corrisponde alla versione installata di Italia Tailwind UI', () => {
  const current = readFileSync(new URL('../src/italia.css', import.meta.url), 'utf8');
  assert.equal(current, generate(), 'rigenera con: bun run italia-css in packages/render');
});

test('italia.css dichiara un solo tema e nessun tema daisyUI', () => {
  const css = generate();
  assert.equal(css.match(/@plugin "daisyui\/theme"/g)?.length, 1);
  assert.match(css, /name: "italia-original";/);
  assert.match(css, /themes: false;/);
});
