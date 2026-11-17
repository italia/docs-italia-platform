import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diskReader, loadProject, resolveProject } from '@docs-italia/myst';
import { chunks, normalizeText } from '../src/index.ts';

function project(files: Record<string, string>, chapters: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-italia-test-'));
  writeFileSync(join(dir, 'document_settings.yml'), 'document:\n  name: Prova\n  description: Documento di prova\n  tags: [prova]\n  format: myst\n');
  writeFileSync(join(dir, 'toc.json'), JSON.stringify({ root: 'index.md', chapters: chapters.map((file) => ({ file })) }));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  return dir;
}

const resolveDir = (dir: string) => {
  const p = loadProject(dir);
  return resolveProject(p, diskReader(p));
};

test('frammenti per il RAG: percorso dei titoli in testa e hash stabile', () => {
  const dir = project({ 'index.md': '# Doc\n', 'a.md': '# A\n\nIntro.\n\n## Sezione\n\nTesto della sezione.\n' }, ['a.md']);
  const doc = resolveDir(dir);
  const cs = chunks(doc, (p, a) => `${p}.html#${a}`);
  const sez = cs.find((c) => c.anchor === 'sezione')!;
  assert.match(sez.text, /^Prova › 1\. A › 1\.1 Sezione\n\nTesto della sezione\.$/);
  assert.equal(sez.hash, chunks(resolveDir(dir), (p, a) => `${p}.html#${a}`).find((c) => c.anchor === 'sezione')!.hash);
});

test('normalizzazione: apostrofi e virgolette tipografici diventano dritti', () => {
  assert.equal(normalizeText('Ministero dell’Interno: “dato”'), "Ministero dell'Interno: \"dato\"");
});
