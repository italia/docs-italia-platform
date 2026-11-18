/**
 * Editor visuale: un blocco aperto e chiuso senza modifiche deve tornare
 * identico (AST → ProseMirror → AST → MyST).
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { blockToPm, docToBlocks, isRichBlock, pmToBlock } from '../../../apps/editor/src/visual/ast.ts';
import { serializeBlocks, sourceBlocks } from '../src/serialize.ts';

const through = (nodes: any[]) => docToBlocks({ type: 'doc', content: nodes.map(blockToPm) });

test('testo con ruoli, riferimenti, note, link e formattazione annidata: identico', () => {
  const src = [
    'Testo con **grassetto e *corsivo* dentro**, `codice`, [un link](https://example.org "titolo") e [pagina](altra.md#sezione).',
    'Riferimenti: {ref}`etichetta`, {numref}`fig-a`, {term}`erogatore`, {rfc}`7519`, una nota[^1] e un a capo\\\nforzato.',
    '- primo\n- secondo con **forza**\n  - annidato\n- terzo',
    '1. uno\n2. due',
    '- distanziato\n\n- elenco',
    '> Citazione con *enfasi*.',
    '## Titolo con `codice`',
    '[^1]: La nota.',
  ].join('\n\n');
  for (const b of sourceBlocks(src).filter((x) => x.nodes[0]?.type !== 'footnoteDefinition')) {
    assert.ok(b.nodes.every(isRichBlock), b.text);
    assert.equal(serializeBlocks(through(b.nodes)), b.text);
  }
});

test('ProseMirror → AST: marchi adiacenti fusi, codice con grassetto', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Uno ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'due', marks: [{ type: 'bold' }, { type: 'italic' }] },
          { type: 'text', text: ' x', marks: [{ type: 'bold' }, { type: 'code' }] },
        ],
      },
    ],
  };
  assert.equal(serializeBlocks(docToBlocks(doc as any)), '**Uno *due*` x`**');
  assert.deepEqual(pmToBlock({ type: 'paragraph' }), { type: 'paragraph', children: [] });
});

test('documenti MyST del repository: tutti i blocchi di testo tornano identici', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (n === 'dist' || n.startsWith('.') || n === 'node_modules') continue;
      if (statSync(f).isDirectory()) walk(f);
      else if (n.endsWith('.md')) files.push(f);
    }
  };
  for (const d of ['examples/esempio-myst', 'spec']) walk(join(import.meta.dir, '../../..', d));
  let rich = 0;
  const diffs: string[] = [];
  for (const f of files) {
    for (const b of sourceBlocks(readFileSync(f, 'utf8'), f)) {
      if (!b.editable || !b.nodes.every(isRichBlock)) continue;
      rich++;
      const out = serializeBlocks(through(b.nodes));
      if (out !== b.text) diffs.push(`${f}:${b.start}\n${b.text}\n→\n${out}`);
    }
  }
  assert.ok(rich > 50, `pochi blocchi di testo: ${rich}`);
  assert.deepEqual(diffs, []);
});
