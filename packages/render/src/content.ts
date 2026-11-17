/**
 * AST MyST risolto → HTML con le classi di Italia Tailwind UI.
 *
 * Regole:
 * - l'uscita è sempre XHTML ben formato (elementi vuoti chiusi, attributi tra
 *   virgolette), così lo stesso renderer serve per sito, PDF ed EPUB;
 * - tutto il testo che arriva dal documento passa da escapeHtml: le recipes di
 *   Italia Tailwind UI non fanno escape dei loro argomenti;
 * - l'HTML grezzo nel Markdown non viene mai emesso.
 */
import { icon } from '@italia-tailwind/recipes';
import type { GenericNode } from '@docs-italia/schema';
import { escapeAttr, escapeHtml } from './escape.ts';

export type { GenericNode };

export type RenderMode = 'site' | 'single' | 'print' | 'epub' | 'preview';

export interface RenderContext {
  mode: RenderMode;
  /** slug della pagina che si sta rendendo */
  page: string;
  /** href di una pagina (e ancora) nel contesto corrente */
  hrefFor(page: string, anchor?: string): string;
  /** id da emettere per un'ancora della pagina corrente (unico anche in pagina singola) */
  idFor(page: string, anchor: string): string;
  /** URL di una risorsa (immagine, file scaricabile) relativa alla radice della sorgente */
  assetHref(path: string): string;
  /** quanto spostare i livelli dei titoli (pagina singola: i capitoli diventano h2) */
  headingOffset?: number;
}

type AdmonitionStyle = { variant: '' | 'primary' | 'success' | 'warning' | 'danger'; icon: string };

const ADMONITIONS: Record<string, AdmonitionStyle> = {
  note: { variant: 'primary', icon: 'it-info-circle' },
  info: { variant: 'primary', icon: 'it-info-circle' },
  tip: { variant: 'success', icon: 'it-check-circle' },
  hint: { variant: 'success', icon: 'it-check-circle' },
  seealso: { variant: '', icon: 'it-link' },
  important: { variant: 'warning', icon: 'it-warning-circle' },
  attention: { variant: 'warning', icon: 'it-warning-circle' },
  caution: { variant: 'warning', icon: 'it-warning-circle' },
  warning: { variant: 'warning', icon: 'it-warning-circle' },
  danger: { variant: 'danger', icon: 'it-error' },
  error: { variant: 'danger', icon: 'it-error' },
  // classi di Docs Italia
  'testo-suggerito': { variant: 'primary', icon: 'it-pencil' },
  esempio: { variant: '', icon: 'it-note' },
};

const ADMONITION_TITLES: Record<string, string> = {
  note: 'Nota', info: 'Informazione', tip: 'Suggerimento', hint: 'Suggerimento', seealso: 'Vedi anche',
  important: 'Importante', attention: 'Attenzione', caution: 'Cautela', warning: 'Attenzione',
  danger: 'Pericolo', error: 'Errore',
};

/** Rende una sequenza di nodi. */
export function renderNodes(nodes: GenericNode[] | undefined, ctx: RenderContext): string {
  if (!nodes) return '';
  return nodes.map((n) => renderNode(n, ctx)).join('');
}

function attrs(a: Record<string, string | number | boolean | undefined | null>): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}="${k}"` : ` ${k}="${escapeAttr(String(v))}"`))
    .join('');
}

function svgIcon(name: string, cls: string): string {
  try {
    return icon(name as any, cls);
  } catch {
    return '';
  }
}

export function renderNode(node: GenericNode, ctx: RenderContext): string {
  const kids = () => renderNodes(node.children, ctx);
  switch (node.type) {
    case 'root':
    case 'block':
      return kids();
    case 'text':
      return escapeHtml(node.value ?? '');
    case 'paragraph':
      return `<p${attrs({ id: node.anchor ? ctx.idFor(ctx.page, node.anchor) : undefined })}>${kids()}</p>\n`;
    case 'heading': {
      const level = Math.min(6, (node.depth ?? 1) + (ctx.headingOffset ?? 0));
      const id = node.anchor ? ctx.idFor(ctx.page, node.anchor) : undefined;
      // in stampa il numero è testo semplice: in un <span> separato, con Paged.js, Chrome lo perde nei segnalibri del PDF
      const num = node.number ? (ctx.mode === 'print' ? `${escapeHtml(node.number)}\u00a0` : `<span class="di-number">${escapeHtml(node.number)}</span> `) : '';
      const permalink =
        id && (ctx.mode === 'site' || ctx.mode === 'single')
          ? ` <a class="di-permalink" href="#${escapeAttr(id)}" aria-label="Link a questa sezione">#</a>`
          : '';
      return `<h${level}${attrs({ id })}>${num}${kids()}${permalink}</h${level}>\n`;
    }
    case 'emphasis':
      return `<em>${kids()}</em>`;
    case 'strong':
      return `<strong>${kids()}</strong>`;
    case 'delete':
      return `<del>${kids()}</del>`;
    case 'underline':
      return `<span class="underline">${kids()}</span>`;
    case 'subscript':
      return `<sub>${kids()}</sub>`;
    case 'superscript':
      return `<sup>${kids()}</sup>`;
    case 'smallcaps':
      return `<span class="small-caps">${kids()}</span>`;
    case 'abbreviation':
      return `<abbr${attrs({ title: node.title })}>${kids()}</abbr>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value ?? '')}</code>`;
    case 'break':
      return '<br />';
    case 'thematicBreak':
      return '<hr />\n';
    case 'code': {
      const lang = node.lang ? ` class="language-${escapeAttr(node.lang)}"` : '';
      return `<pre class="di-code"><code${lang}>${escapeHtml(node.value ?? '')}</code></pre>\n`;
    }
    case 'blockquote':
      return `<blockquote>${kids()}</blockquote>\n`;
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      // elenco compatto (spread: false): i paragrafi delle voci si rendono senza <p>
      const items = (node.children ?? [])
        .map((li) => {
          const inner = (li.children ?? [])
            .map((c) => (!node.spread && c.type === 'paragraph' ? renderNodes(c.children, ctx) : renderNode(c, ctx)))
            .join('');
          return `<li>${inner}</li>\n`;
        })
        .join('');
      return `<${tag}${attrs({ start: node.ordered && node.start && node.start !== 1 ? node.start : undefined })}>${items}</${tag}>\n`;
    }
    case 'listItem':
      return `<li>${kids()}</li>\n`;
    case 'definitionList':
      return `<dl>${kids()}</dl>\n`;
    case 'definitionTerm':
      return `<dt>${kids()}</dt>`;
    case 'definitionDescription':
      return `<dd>${kids()}</dd>`;
    case 'link':
      return renderLink(node, ctx);
    case 'crossReference':
      return renderCrossReference(node, ctx);
    case 'image':
      return renderImage(node, ctx);
    case 'container':
      return renderContainer(node, ctx);
    case 'caption':
    case 'legend':
      return kids();
    case 'table':
      return renderTable(node, ctx);
    case 'admonition':
      return renderAdmonition(node, ctx);
    case 'admonitionTitle':
      return kids();
    case 'footnoteReference': {
      const n = node.enumerator ?? node.label;
      const id = ctx.idFor(ctx.page, `fn-${node.identifier}`);
      const back = ctx.idFor(ctx.page, `fnref-${node.identifier}`);
      return `<sup class="di-fnref"><a${attrs({ id: back, href: `#${id}`, role: 'doc-noteref' })}>${escapeHtml(String(n))}</a></sup>`;
    }
    case 'footnoteDefinition':
      // le note sono raccolte ed emesse da renderFootnotes
      return '';
    case 'mystComment':
    case 'comment':
    case 'mystTarget':
      return '';
    case 'html':
      // l'HTML grezzo nei documenti non viene emesso: lo segnala `docs-italia check`
      return '';
    case 'forum':
      // nel PDF e nell'EPUB il collegamento al forum non serve
      if (ctx.mode === 'print' || ctx.mode === 'epub' || !node.topicId) return '';
      return `<p class="di-forum"><a${attrs({ href: `https://forum.italia.it/t/${encodeURIComponent(String(node.topicId))}`, class: 'di-external', rel: 'noopener' })}>Partecipa alla discussione su Forum Italia<span class="sr-only"> (link esterno)</span></a></p>\n`;
    case 'unsupported':
      return `<div class="di-unsupported" role="note"><p><strong>Costrutto non supportato:</strong> ${escapeHtml(node.name ?? '')}</p>${
        node.value ? `<pre><code>${escapeHtml(node.value)}</code></pre>` : ''
      }</div>\n`;
    case 'math':
    case 'inlineMath':
      return `<code class="di-math">${escapeHtml(node.value ?? '')}</code>`;
    default:
      // nodo sconosciuto: si rendono i figli, se ci sono
      return node.children ? kids() : '';
  }
}

function renderLink(node: GenericNode, ctx: RenderContext): string {
  const body = renderNodes(node.children, ctx);
  if (node.internal) {
    return `<a${attrs({ href: ctx.hrefFor(node.internal.page, node.internal.anchor) })}>${body}</a>`;
  }
  if (node.asset) {
    return `<a${attrs({ href: ctx.assetHref(node.asset) })}>${body}</a>`;
  }
  // difesa ulteriore oltre al controllo in risoluzione: niente javascript:, data:, vbscript:…
  if (!node.url || (/^[a-z][a-z0-9+.-]*:/i.test(node.url) && !/^(https?|mailto|tel):/i.test(node.url))) {
    return `<span class="di-broken-ref">${body}</span>`;
  }
  const external = /^https?:\/\//.test(node.url ?? '');
  // link il cui testo è già l'indirizzo (es. <https://…>): in stampa non va ripetuto
  const isUrlText = node.children?.length === 1 && node.children[0].type === 'text' && node.children[0].value === node.url;
  const cls = [external ? 'di-external' : '', isUrlText ? 'di-url' : ''].filter(Boolean).join(' ') || undefined;
  if (external && ctx.mode !== 'print' && ctx.mode !== 'epub') {
    return `<a${attrs({ href: node.url, class: cls, rel: 'noopener' })}>${body}<span class="sr-only"> (link esterno)</span></a>`;
  }
  return `<a${attrs({ href: node.url, class: cls })}>${body}</a>`;
}

function renderCrossReference(node: GenericNode, ctx: RenderContext): string {
  if (!node.resolved) {
    return `<span class="di-broken-ref" title="Riferimento non risolto">${escapeHtml(node.label ?? node.identifier ?? '')}</span>`;
  }
  const body = node.children?.length ? renderNodes(node.children, ctx) : escapeHtml(node.resolved.text);
  return `<a${attrs({ href: ctx.hrefFor(node.resolved.page, node.resolved.anchor) })}>${body}</a>`;
}

const SIZE = /^(\d+(?:\.\d+)?)\s*(px|cm|mm|in|pt|pc|em|rem|ex|ch|%|vw)?$/i;

/**
 * Dimensioni di un'immagine da `:width:` e `:height:` (MyST, RST). Gli
 * attributi HTML width e height accettano solo pixel: "15cm" diventerebbe
 * 15 pixel. Un numero (o "px") va quindi nell'attributo, ogni altra unità
 * nello stile. I valori non riconosciuti si ignorano.
 */
export function imageSize(width?: unknown, height?: unknown): { width?: string; height?: string; style?: string } {
  const out: { width?: string; height?: string; style?: string } = {};
  const styles: string[] = [];
  for (const [prop, value] of [['width', width], ['height', height]] as const) {
    if (value === undefined || value === null || value === '') continue;
    const m = String(value).trim().match(SIZE);
    if (!m) continue;
    const unit = (m[2] ?? 'px').toLowerCase();
    if (unit === 'px') out[prop] = m[1];
    else styles.push(`${prop}:${m[1]}${unit}`);
  }
  if (styles.length) out.style = styles.join(';');
  return out;
}

function renderImage(node: GenericNode, ctx: RenderContext): string {
  const src = node.asset ? ctx.assetHref(node.asset) : /^https?:\/\//i.test(node.url ?? '') ? node.url : undefined;
  if (!src) return '';
  const cls = ['di-image', node.align ? `di-align-${node.align}` : ''].filter(Boolean).join(' ');
  return `<img${attrs({
    src,
    alt: node.alt ?? '',
    class: cls,
    ...imageSize(node.width, node.height),
    loading: ctx.mode === 'site' || ctx.mode === 'single' ? 'lazy' : undefined,
  })} />`;
}

function renderContainer(node: GenericNode, ctx: RenderContext): string {
  const id = node.anchor ? ctx.idFor(ctx.page, node.anchor) : undefined;
  const children = node.children ?? [];
  if (node.kind === 'figure') {
    const caption = children.find((c) => c.type === 'caption');
    const legend = children.find((c) => c.type === 'legend');
    const rest = children.filter((c) => c !== caption && c !== legend);
    const num = node.number && node.showNumber ? `<span class="di-number">Figura ${escapeHtml(node.number)}</span> ` : '';
    const cap =
      caption || legend
        ? `<figcaption>${caption ? num + stripParagraph(renderNodes(caption.children, ctx)) : ''}${
            legend ? `<div class="di-legend">${renderNodes(legend.children, ctx)}</div>` : ''
          }</figcaption>`
        : '';
    return `<figure${attrs({ id, class: ['di-figure', node.align ? `di-align-${node.align}` : ''].filter(Boolean).join(' ') })}>${renderNodes(rest, ctx)}${cap}</figure>\n`;
  }
  if (node.kind === 'table') {
    const caption = children.find((c) => c.type === 'caption');
    const table = children.find((c) => c.type === 'table');
    return renderTable(table ?? { type: 'table', children: [] }, ctx, caption, id, node.widths, node.showNumber ? node.number : undefined);
  }
  if (node.kind === 'quote') {
    const cls = node.class ? `di-quote di-${String(node.class).split(/\s+/)[0]}` : 'di-quote';
    return `<div${attrs({ id, class: cls })}>${renderNodes(children, ctx)}</div>\n`;
  }
  return `<div${attrs({ id, class: 'di-container' })}>${renderNodes(children, ctx)}</div>\n`;
}

function stripParagraph(html: string): string {
  return html.replace(/^<p>/, '').replace(/<\/p>\n?$/, '');
}

function renderTable(node: GenericNode, ctx: RenderContext, caption?: GenericNode, id?: string, widths?: number[], number?: string): string {
  const rows = node.children ?? [];
  const head = rows.filter((r) => r.children?.every((c) => c.header));
  const body = rows.filter((r) => !head.includes(r));
  const row = (r: GenericNode) =>
    `<tr>${(r.children ?? [])
      .map((c) => {
        const tag = c.header ? 'th' : 'td';
        const inner = stripParagraph(renderNodes(c.children, ctx).trim());
        return `<${tag}${attrs({ scope: c.header ? 'col' : undefined, colspan: c.colspan, rowspan: c.rowspan, class: c.align ? `text-${c.align}` : undefined })}>${inner}</${tag}>`;
      })
      .join('')}</tr>\n`;
  const total = widths?.reduce((a, b) => a + b, 0);
  const cols =
    widths && total
      ? `<colgroup>${widths.map((w) => `<col style="width:${((w / total) * 100).toFixed(1)}%" />`).join('')}</colgroup>`
      : '';
  const num = number ? `<span class="di-number">Tabella ${escapeHtml(number)}</span> ` : '';
  const cap = caption ? `<caption>${num}${stripParagraph(renderNodes(caption.children, ctx).trim())}</caption>` : '';
  return `<div class="di-table-wrap"><table${attrs({ id, class: 'di-table' })}>${cap}${cols}${
    head.length ? `<thead>${head.map(row).join('')}</thead>` : ''
  }<tbody>${body.map(row).join('')}</tbody></table></div>\n`;
}

function renderAdmonition(node: GenericNode, ctx: RenderContext): string {
  const classes: string[] = String(node.class ?? '').split(/\s+/).filter(Boolean);
  const key = classes.find((c) => ADMONITIONS[c]) ?? node.kind ?? 'admonition';
  const style = ADMONITIONS[key] ?? { variant: '', icon: 'it-note' };
  const titleNode = node.children?.find((c) => c.type === 'admonitionTitle');
  const body = node.children?.filter((c) => c !== titleNode) ?? [];
  const title = titleNode ? renderNodes(titleNode.children, ctx) : escapeHtml(ADMONITION_TITLES[node.kind] ?? 'Nota');
  const level = Math.min(6, 3 + (ctx.headingOffset ?? 0));
  const cls = ['ita-callout', style.variant ? `ita-callout-${style.variant}` : '', ...classes.map((c) => `di-${c}`)]
    .filter(Boolean)
    .join(' ');
  // niente <hN> per il titolo: non deve finire nell'indice della pagina né nel PDF
  return `<aside${attrs({ class: cls })}>
<div class="ita-callout-header">${
    // le recipes producono <svg> senza namespace: in XHTML (EPUB) non verrebbero visualizzati
    ctx.mode === 'epub' ? '' : svgIcon(style.icon, 'ita-callout-icon shrink-0 fill-current')
  }<p class="ita-callout-title"${
    // nel PDF Chrome trasforma i role="heading" in segnalibri: lì il titolo resta un paragrafo
    ctx.mode === 'print' || ctx.mode === 'epub' ? '' : ` role="heading" aria-level="${level}"`
  }>${title}</p></div>
<div class="ita-callout-body">${renderNodes(body, ctx)}</div>
</aside>\n`;
}

/** Note a piè di pagina della pagina corrente, nell'ordine di numerazione. */
export function renderFootnotes(definitions: GenericNode[], ctx: RenderContext): string {
  if (!definitions.length) return '';
  const items = [...definitions]
    .sort((a, b) => (a.enumerator ?? 0) - (b.enumerator ?? 0))
    .map((d) => {
      const id = ctx.idFor(ctx.page, `fn-${d.identifier}`);
      const back = ctx.idFor(ctx.page, `fnref-${d.identifier}`);
      // su carta il ritorno al testo non serve
      const backlink = ctx.mode === 'print' ? '' : ` <a${attrs({ href: `#${back}`, role: 'doc-backlink', 'aria-label': 'Torna al testo' })}>↩</a>`;
      return `<li${attrs({ id, role: 'doc-endnote' })}>${renderNodes(d.children, ctx).trim()}${backlink}</li>`;
    })
    .join('\n');
  return `<section class="di-footnotes" role="doc-endnotes" aria-label="Note"><ol>\n${items}\n</ol></section>\n`;
}
