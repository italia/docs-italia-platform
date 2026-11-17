import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { imageSize, renderNodes, type RenderContext } from '../src/index.ts';

const ctx: RenderContext = {
  mode: 'site',
  page: 'p',
  hrefFor: (p, a) => `${p}.html${a ? `#${a}` : ''}`,
  idFor: (_p, a) => a,
  assetHref: (x) => x,
};
const t = (value: string) => ({ type: 'text', value });

test('il testo dei documenti viene sempre messo in escape', () => {
  const html = renderNodes([{ type: 'paragraph', children: [t('<script>alert(1)</script> & "x"')] }], ctx);
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</p>\n');
});

test("l'HTML grezzo nel Markdown non viene emesso", () => {
  assert.equal(renderNodes([{ type: 'html', value: '<img src=x onerror=alert(1)>' }], ctx), '');
});

test('link con schemi pericolosi non diventano link', () => {
  const html = renderNodes([{ type: 'link', url: 'javascript:alert(1)', children: [t('clic')] }], ctx);
  assert.doesNotMatch(html, /href/);
  assert.doesNotMatch(html, /javascript/);
});

test('titoli dell’avviso con caratteri speciali in escape (le recipes non lo fanno)', () => {
  const html = renderNodes(
    [{ type: 'admonition', kind: 'note', children: [{ type: 'admonitionTitle', children: [t('<b>Titolo</b>')] }, { type: 'paragraph', children: [t('x')] }] }],
    ctx,
  );
  assert.match(html, /&lt;b&gt;Titolo&lt;\/b&gt;/);
  assert.match(html, /ita-callout ita-callout-primary/);
});

test('uscita XHTML: elementi vuoti chiusi', () => {
  const html = renderNodes([{ type: 'paragraph', children: [{ type: 'image', url: 'https://example.org/a.png', alt: 'a' }, { type: 'break' }] }], ctx);
  assert.match(html, /<img [^>]*\/>/);
  assert.match(html, /<br \/>/);
});

test('link interni risolti con hrefFor', () => {
  const html = renderNodes([{ type: 'link', internal: { page: 'cap', anchor: 'sez' }, children: [t('vai')] }], ctx);
  assert.equal(html, '<a href="cap.html#sez">vai</a>');
});

test('elenco compatto: niente <p> nelle voci; elenco distanziato: <p> conservati', () => {
  const item = (s: string) => ({ type: 'listItem', children: [{ type: 'paragraph', children: [t(s)] }] });
  assert.equal(renderNodes([{ type: 'list', spread: false, children: [item('a'), item('b')] }], ctx), '<ul><li>a</li>\n<li>b</li>\n</ul>\n');
  assert.match(renderNodes([{ type: 'list', spread: true, children: [item('a')] }], ctx), /<li><p>a<\/p>/);
});

test('pagina singola e stampa: id validi come selettori CSS (Paged.js usa querySelector)', async () => {
  const { renderPrint } = await import('../src/index.ts');
  const page = (slug: string, title: string) => ({ slug, title, depth: 1, tree: { type: 'root', children: [{ type: 'heading', depth: 1, anchor: '1-intro', children: [t(title)] }] }, sections: [], footnotes: [] });
  const html = renderPrint(
    { name: 'D', description: 'd', tags: [], language: 'it', version: { name: 'x' }, pages: [page('index', 'D'), page('00_premessa', 'Premessa'), page('capitoli/a', 'A')], downloads: {} },
    { css: 'x.css', date: 'oggi' },
  );
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
  const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
  for (const id of [...ids, ...hrefs]) assert.match(id, /^[A-Za-z][A-Za-z0-9_-]*$/, id);
  for (const h of hrefs) assert.ok(ids.includes(h), `link senza destinazione: #${h}`);
});

test('dimensioni delle immagini: pixel nell\'attributo, altre unità nello stile', () => {
  // ":width: 15 cm" del documento CIE: come attributo diventava un'immagine di 15 pixel
  assert.deepEqual(imageSize('15cm'), { style: 'width:15cm' });
  assert.deepEqual(imageSize('15 cm', '50%'), { style: 'width:15cm;height:50%' });
  assert.deepEqual(imageSize('400'), { width: '400' });
  assert.deepEqual(imageSize('400px', 300), { width: '400', height: '300' });
  assert.deepEqual(imageSize('80%'), { style: 'width:80%' });
  // valori non riconosciuti (anche tentativi di iniettare CSS) si ignorano
  assert.deepEqual(imageSize('15cm;background:url(x)'), {});
  assert.deepEqual(imageSize('auto'), {});
  const html = renderNodes([{ type: 'image', url: 'a.png', asset: 'a.png', alt: 'A', width: '15 cm' }], ctx);
  assert.match(html, /style="width:15cm"/);
  assert.doesNotMatch(html, /width="/);
});
