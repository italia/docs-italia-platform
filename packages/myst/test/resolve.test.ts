import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../src/check.ts';
import { loadProject } from '../src/project.ts';
import { diskReader, resolveProject } from '../src/resolve.ts';

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

test('numerazione dei capitoli e delle sezioni, come toctree :numbered:', () => {
  const dir = project({ 'index.md': '# Doc\n', 'a.md': '# A\n## Uno\n### Uno uno\n## Due\n', 'b.md': '# B\n## Tre\n' }, ['a.md', 'b.md']);
  const doc = resolveDir(dir);
  assert.deepEqual(doc.pages[1].sections.map((s) => s.number), ['1', '1.1', '1.1.1', '1.2']);
  assert.deepEqual(doc.pages[2].sections.map((s) => s.number), ['2', '2.1']);
  assert.equal(doc.pages[0].sections[0].number, undefined, 'la radice non è numerata');
  assert.equal(doc.problems.length, 0);
});

test('link tra pagine, ancore ed etichette', () => {
  const dir = project(
    {
      'index.md': '# Doc\n\nVedi [A](a.md), [sezione](a.md#seconda-parte), {ref}`etichetta` e [etichetta](#etichetta).\n',
      'a.md': '# A\n\n(etichetta)=\n## Seconda parte\n',
    },
    ['a.md'],
  );
  const doc = resolveDir(dir);
  assert.deepEqual(doc.problems, []);
  const links: any[] = [];
  const walk = (n: any) => (n.type === 'link' || n.type === 'crossReference' ? links.push(n) : n.children?.forEach(walk));
  walk(doc.pages[0].tree);
  assert.deepEqual(links[0].internal, { page: 'a', anchor: undefined });
  assert.deepEqual(links[1].internal, { page: 'a', anchor: 'seconda-parte' });
  assert.equal(links[2].resolved.anchor, 'seconda-parte');
  assert.equal(links[2].resolved.text, '1.1 Seconda parte');
  assert.deepEqual(links[3].internal, { page: 'a', anchor: 'seconda-parte' });
});

test('check segnala link e ancore rotti, immagini mancanti, alt vuoto, file fuori indice, titoli saltati', () => {
  const dir = project(
    {
      'index.md': '# Doc\n\n[x](manca.md) [y](a.md#nessuna) {ref}`ignota` ![](img/manca.png)\n\n### Salto\n',
      'a.md': '# A\n',
      'orfano.md': '# Orfano\n',
      'README.md': '# Ignorato\n',
    },
    ['a.md'],
  );
  const codes = check(dir).map((p) => p.code).sort();
  assert.deepEqual(codes, ['alt', 'broken-anchor', 'broken-link', 'broken-ref', 'heading-skip', 'missing-image', 'not-in-toc'].sort());
});

test('link javascript: il parser non crea nemmeno il nodo link', () => {
  const dir = project({ 'index.md': '# Doc\n\n[clic](javascript:alert(1))\n' }, []);
  const doc = resolveDir(dir);
  assert.doesNotMatch(JSON.stringify(doc.pages[0].tree), /"type":"link"/);
});

test('schemi non ammessi che il parser lascia passare: errore unsafe-link', () => {
  const dir = project({ 'index.md': '# Doc\n\n[file](ftp://example.org/x)\n' }, []);
  assert.ok(check(dir).some((p) => p.code === 'unsafe-link'));
});

test('direttiva sconosciuta: errore con numero di riga, il resto si costruisce', () => {
  const dir = project({ 'index.md': '# Doc\n\n:::{direttiva_inesistente}\n:::\n\nTesto.\n' }, []);
  const p = check(dir).find((x) => x.code === 'unsupported');
  assert.ok(p);
  assert.equal(p.line, 3);
});

test('note a piè di pagina numerate per ordine di citazione', () => {
  const dir = project({ 'index.md': '# Doc\n\nB[^b] e A[^a].\n\n[^a]: Nota A\n[^b]: Nota B\n' }, []);
  const doc = resolveDir(dir);
  assert.deepEqual(doc.pages[0].footnotes.map((f) => [f.identifier, f.enumerator]).sort(), [['a', 2], ['b', 1]]);
});

test('figure e tabelle numerate per capitolo; {numref} usa il numero', () => {
  const dir = project(
    {
      'index.md': '# Doc\n',
      'a.md': '# A\n\n:::{figure} https://example.org/x.png\n:alt: x\n:name: fig-x\n\nDidascalia\n:::\n\nVedi {numref}`fig-x`.\n',
    },
    ['a.md'],
  );
  const doc = resolveDir(dir);
  const refs: any[] = [];
  const walk = (n: any) => (n.type === 'crossReference' ? refs.push(n) : n.children?.forEach(walk));
  walk(doc.pages[1].tree);
  assert.equal(refs[0].resolved.text, 'Figura 1.1');
  // numfig spento (predefinito): avviso, perché il numero non compare nella didascalia
  assert.ok(doc.problems.some((p) => p.code === 'numref-numfig'));
});

test('elenchi compatti e distanziati ricavati dal sorgente', () => {
  const dir = project({ 'index.md': '# Doc\n\n- a\n- b\n\nTesto\n\n- c\n\n- d\n\n1. lungo\n   seguito\n2. due\n' }, []);
  const lists = resolveDir(dir).pages[0].tree.children!.filter((n: any) => n.type === 'list');
  assert.deepEqual(lists.map((l: any) => l.spread), [false, true, false]);
});

test('file fuori dal progetto (../ o link simbolico): errore, non finiscono tra i file del documento', () => {
  const outside = mkdtempSync(join(tmpdir(), 'docs-italia-fuori-'));
  writeFileSync(join(outside, 'segreto.png'), 'segreto');
  const dir = project(
    {
      'index.md': `# Doc\n\n![su](../${outside.split('/').pop()}/segreto.png)\n\n![link](link.png)\n\n[allegato](allegato.pdf)\n`,
      'allegato.pdf': '%PDF',
    },
    [],
  );
  symlinkSync(join(outside, 'segreto.png'), join(dir, 'link.png'));
  const doc = resolveDir(dir);
  assert.deepEqual([...doc.assets], ['allegato.pdf']);
  assert.equal(doc.problems.filter((p) => p.code === 'missing-image').length, 2);
});
