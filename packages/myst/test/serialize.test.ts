import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { replaceBlocks, serializeBlocks, sourceBlocks } from '../src/serialize.ts';

const roundtrip = (src: string) => sourceBlocks(src).map((b) => serializeBlocks(b.nodes)).join('\n\n');

test('le opzioni delle direttive non si perdono (myst-to-md perdeva alt, align, class)', () => {
  const src = [
    ':::{figure} images/a.png',
    ':alt: Testo alternativo',
    ':align: center',
    ':name: fig-a',
    '',
    'Didascalia.',
    ':::',
    '',
    ':::{admonition} Testo suggerito',
    ':class: testo-suggerito',
    '',
    'Corpo con {Nome servizio}.',
    ':::',
  ].join('\n');
  assert.equal(roundtrip(src), src);
});

test('ruoli, riferimenti e caratteri da proteggere', () => {
  const src = "Vedi {rfc}`7519`, {ref}`etichetta`, `codice` e dell'Interno \\*non enfasi\\*.";
  assert.equal(roundtrip(src), src);
});

test('una modifica riscrive solo le righe del suo blocco', () => {
  const src = '# Titolo\n\nPrimo paragrafo\nsu due righe.\n\n:::{note}\nNota.\n:::\n\nUltimo   paragrafo con  spazi  originali.\n';
  const blocks = sourceBlocks(src);
  const note = blocks.findIndex((b) => b.nodes[0]?.type === 'admonition');
  const edited = structuredClone(blocks[note].nodes);
  edited[0]!.children![0]!.children![0]!.value = 'Nota modificata.';
  const out = replaceBlocks(src, blocks, new Map([[note, edited]]));
  assert.equal(out, src.replace('Nota.', 'Nota modificata.'));
});

test('note a piè di pagina: posizione ricavata dal sorgente, con le righe di continuazione', () => {
  const src = '# T\n\nTesto[^a].\n\n[^a]: Nota\n    continua\n\nDopo.\n';
  const blocks = sourceBlocks(src);
  const fn = blocks.find((b) => b.nodes[0]?.type === 'footnoteDefinition')!;
  assert.deepEqual([fn.start, fn.end, fn.editable], [5, 6, true]);
  assert.equal(blocks.find((b) => b.text.startsWith('Testo'))!.end, 3);
});

test('elenchi con caselle di controllo ed elenchi annidati', () => {
  const src = '1. **Uno**\n2. Due:\n   - [ ] da fare\n   - [x] fatto';
  assert.equal(roundtrip(src), src);
});

test('un blocco senza posizioni affidabili non si riscrive', () => {
  const src = 'Testo.\n';
  const blocks = sourceBlocks(src);
  blocks[0].editable = false;
  assert.throws(() => replaceBlocks(src, blocks, new Map([[0, blocks[0].nodes]])), /posizioni affidabili/);
});

test('testo con a capo: inizio di ogni riga protetto (testo convertito dall’RST)', async () => {
  const { serializeBlock } = await import('../src/serialize.ts');
  const { parseMyst } = await import('../src/myst.ts');
  const para = { type: 'paragraph', children: [{ type: 'text', value: 'Decisione UE\n2018. Anno\n- non elenco\n# non titolo\n1. non numerato' }] };
  const out = serializeBlock(para);
  const back = parseMyst(out, 'x.md').tree.children!;
  assert.equal(back.length, 1, out);
  assert.equal(back[0]!.type, 'paragraph');
  assert.match(out, /\n1\\\. non numerato/);
});

test('liste di definizioni', () => {
  const src = 'Termine\n: Definizione.\n\nAltro termine\n: Prima definizione.\n: Seconda definizione.';
  assert.equal(roundtrip(src), src);
});

test('argomenti e opzioni su più righe (RST) tornano su una riga: MyST non accetta altro', () => {
  const md = serializeBlocks([
    { type: 'image', url: 'a.png', alt: 'Una descrizione\nsu due righe', origin: { kind: 'directive', name: 'image', args: 'a.png', options: {} } },
  ]);
  assert.match(md, /^:alt: Una descrizione su due righe$/m);
  const reparsed = sourceBlocks(md);
  assert.equal(reparsed.length, 1);
});
