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

test('editor visuale: modifiche, inserimenti, spostamenti ed eliminazioni toccano solo le loro righe', async () => {
  const { applyEdits } = await import('../src/serialize.ts');
  const src = '# Titolo\n\nPrimo   paragrafo,\nscritto a mano.\n\n:::{note}\nNota.\n:::\n\nUltimo.\n';
  const blocks = sourceBlocks(src);
  const [, primo, nota, ultimo] = [0, 1, 2, 3];
  const para = (t: string) => [{ type: 'paragraph', children: [{ type: 'text', value: t }] }];

  // inserimento dopo il titolo: il resto identico, con le sue spaziature
  assert.equal(applyEdits(src, blocks, [{ op: 'insert', after: 0, nodes: para('Nuovo.') }]), src.replace('# Titolo\n', '# Titolo\n\nNuovo.\n'));
  // in testa
  assert.equal(applyEdits(src, blocks, [{ op: 'insert', after: -1, text: '(inizio)=' }]), `(inizio)=\n\n${src}`);
  // eliminazione: sparisce anche la riga vuota che lo separava
  assert.equal(applyEdits(src, blocks, [{ op: 'delete', index: nota }]), '# Titolo\n\nPrimo   paragrafo,\nscritto a mano.\n\nUltimo.\n');
  // l'ultimo blocco: il file conserva l'a capo finale
  assert.equal(applyEdits(src, blocks, [{ op: 'delete', index: ultimo }]), '# Titolo\n\nPrimo   paragrafo,\nscritto a mano.\n\n:::{note}\nNota.\n:::\n');
  // spostamento: il testo del blocco resta quello originale, spazi compresi
  assert.equal(applyEdits(src, blocks, [{ op: 'move', index: primo, after: ultimo }]), '# Titolo\n\n:::{note}\nNota.\n:::\n\nUltimo.\n\nPrimo   paragrafo,\nscritto a mano.\n');
  // sostituzione con sorgente scritto a mano e inserimento dopo lo stesso blocco
  assert.equal(
    applyEdits(src, blocks, [{ op: 'replace', index: nota, text: ':::{warning}\nAttenzione.\n:::' }, { op: 'insert', after: nota, nodes: para('Dopo.') }]),
    src.replace(':::{note}\nNota.\n:::', ':::{warning}\nAttenzione.\n:::\n\nDopo.'),
  );
  // eliminato e sostituito dal blocco inserito dopo: una sola riga vuota
  assert.equal(applyEdits(src, blocks, [{ op: 'delete', index: nota }, { op: 'insert', after: nota, nodes: para('Al suo posto.') }]), src.replace(':::{note}\nNota.\n:::', 'Al suo posto.'));
  // file vuoto
  assert.equal(applyEdits('', sourceBlocks(''), [{ op: 'insert', after: -1, nodes: para('Primo.') }]), 'Primo.\n');
  assert.throws(() => applyEdits(src, blocks, [{ op: 'delete', index: 9 }]), /inesistente/);
});

test('serie di trattini bassi, grassetti adiacenti, URL con lettere accentate', async () => {
  const { parseMyst } = await import('../src/myst.ts');
  const t = (value: string) => ({ type: 'text', value });
  // "______" (campo da compilare) resta testo, non diventa corsivo
  const blank = serializeBlocks([{ type: 'paragraph', children: [t('E-service ______ (di seguito)')] }]);
  const back = parseMyst(blank, 'x.md').tree.children![0]!;
  assert.deepEqual(back.children!.map((c: any) => c.type), ['text']);
  assert.equal(back.children![0]!.value, 'E-service ______ (di seguito)');
  // due grassetti di fila: uno solo
  assert.equal(serializeBlocks([{ type: 'paragraph', children: [{ type: 'strong', children: [t('[')] }, { type: 'strong', children: [t('CAD]')] }] }]), '**\\[CAD\\]**');
  assert.equal(serializeBlocks([{ type: 'paragraph', children: [{ type: 'strong', children: [t('[')] }, t(''), { type: 'strong', children: [t('CAD]')] }] }]), '**\\[CAD\\]**');
  // URL: le lettere accentate si scrivono come sono; gli spazi codificati restano codificati
  const link = (url: string) => serializeBlocks([{ type: 'paragraph', children: [{ type: 'link', url, children: [t('vai')] }] }]);
  assert.equal(link('../attivit%C3%A0.md'), '[vai](../attività.md)');
  assert.equal(link('a%20b.md'), '[vai](a%20b.md)');
});
