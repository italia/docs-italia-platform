import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { renderNodes, type RenderContext } from '../src/index.ts';

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
