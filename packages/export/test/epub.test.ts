import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { epubPages } from '../src/epub.ts';

const page = (slug: string, links: string[] = [], hidden = false) => ({
  slug, title: slug, depth: 1, hidden, sections: [], footnotes: [],
  tree: { type: 'root', children: [{ type: 'paragraph', children: links.map((p) => ({ type: 'link', internal: { page: p }, children: [] })) }] },
});

test('EPUB: le pagine nascoste entrano solo se un link le raggiunge, anche passando da altre nascoste', () => {
  const doc = {
    name: 'D', description: 'd', tags: [], language: 'it', version: { name: 'x' }, downloads: {},
    pages: [page('index', ['istruzioni']), page('a'), page('istruzioni', ['dettagli'], true), page('dettagli', [], true), page('residuo', [], true)],
  };
  assert.deepEqual(epubPages(doc).map((p) => p.slug), ['index', 'a', 'istruzioni', 'dettagli']);
});
