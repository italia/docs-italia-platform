/**
 * Layout delle pagine: sito a capitoli, pagina singola, stampa (PDF), capitoli
 * EPUB e frammento per l'anteprima dell'editor.
 *
 * Intestazione e piè di pagina sono scritti a mano con le classi ita-*: le
 * recipes header() e footer() inseriscono contenuti dimostrativi quando un
 * argomento manca e non producono XHTML valido.
 */
import { breadcrumbs, chip, icon, navscroll, skiplinks, backToTop } from '@italia-tailwind/recipes';
import { escapeAttr, escapeHtml } from './escape.ts';
import type { PageView, SectionView } from '@docs-italia/schema';
import { renderFootnotes, renderNodes, type GenericNode, type RenderContext, type RenderMode } from './content.ts';

export type { PageView, SectionView };

export interface DocView {
  name: string;
  description: string;
  tags: string[];
  publisher?: string;
  project?: string;
  repository?: string;
  language: string;
  version: { name: string; commit?: string; dirty?: boolean };
  caption?: string;
  /** pagine in ordine di lettura: la prima è la radice */
  pages: PageView[];
  /** nomi dei file scaricabili, relativi alla radice del sito */
  downloads: { pdf?: string; epub?: string; html?: string };
  /** testo del banner sopra il contenuto (es. "anteprima locale") */
  banner?: string;
  theme?: string;
}

const THEME = 'italia-original';

// ---------------------------------------------------------------------------
// Percorsi
// ---------------------------------------------------------------------------

function pageFile(doc: DocView, slug: string): string {
  return slug === doc.pages[0].slug ? 'index.html' : `${slug}.html`;
}

/** Percorso relativo da un file HTML del sito a un altro file del sito. */
export function relative(fromFile: string, toFile: string): string {
  const from = fromFile.split('/').slice(0, -1);
  const to = toFile.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/') || toFile;
}

function siteContext(doc: DocView, page: PageView, mode: RenderMode = 'site'): RenderContext {
  const here = pageFile(doc, page.slug);
  return {
    mode,
    page: page.slug,
    hrefFor: (p, a) => {
      const file = pageFile(doc, p);
      const base = file === here ? '' : relative(here, file);
      return a ? `${base}#${a}` : base || '#';
    },
    idFor: (_p, a) => a,
    assetHref: (path) => relative(here, path),
  };
}

/**
 * Id della pagina singola e della stampa: tutte le pagine stanno nello stesso
 * documento, quindi gli id portano il nome della pagina. Devono essere validi
 * anche come selettori CSS (Paged.js li usa con querySelector): "00_premessa"
 * o "capitoli/introduzione" non lo sono.
 */
const cssSafe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-');
export const pageId = (slug: string) => `p-${cssSafe(slug)}`;
const anchorId = (slug: string, anchor: string) => `${pageId(slug)}--${cssSafe(anchor)}`;

function singleContext(doc: DocView, page: PageView, mode: 'single' | 'print'): RenderContext {
  return {
    mode,
    page: page.slug,
    hrefFor: (p, a) => `#${a ? anchorId(p, a) : pageId(p)}`,
    idFor: (p, a) => anchorId(p, a),
    assetHref: (path) => path,
    headingOffset: page === doc.pages[0] ? 0 : 1,
  };
}

// ---------------------------------------------------------------------------
// Parti comuni
// ---------------------------------------------------------------------------

const ic = (name: string, cls = 'size-5') => icon(name as any, `${cls} shrink-0 fill-current`);

function head(doc: DocView, title: string, css: string, extra = '', cssAttrs = ''): string {
  return `<!DOCTYPE html>
<html lang="${escapeAttr(doc.language)}" data-theme="${escapeAttr(doc.theme ?? THEME)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeAttr(doc.description)}" />
<meta name="generator" content="docs-italia toolkit (PoC)" />
<link rel="stylesheet" href="${escapeAttr(css)}"${cssAttrs} />
${extra}</head>
`;
}

function siteHeader(doc: DocView, homeHref: string): string {
  const tagline = [doc.publisher, doc.project].filter(Boolean).map((s) => escapeHtml(s!)).join(' · ');
  return `<header class="ita-header">
<div class="ita-header-slim"><div class="ita-header-container">
<a href="${escapeAttr(homeHref)}" class="ita-header-owner">Docs Italia</a>
<div class="ita-header-tools"><span class="ita-badge ita-badge-inverse">${escapeHtml(doc.version.name)}</span></div>
</div></div>
<div class="ita-header-center"><div class="ita-header-container"><div class="ita-header-brand">
<a href="${escapeAttr(homeHref)}">${ic('it-pa', 'size-12')}<span><span class="ita-header-name">${escapeHtml(doc.name)}</span>${
    tagline ? `<span class="ita-header-tagline">${tagline}</span>` : ''
  }</span></a>
</div></div></div>
</header>
`;
}

function siteFooter(doc: DocView, homeHref: string): string {
  const commit = doc.version.commit ? `commit ${escapeHtml(doc.version.commit.slice(0, 7))}${doc.version.dirty ? ' (con modifiche non salvate in Git)' : ''}` : '';
  const items = [
    doc.repository ? `<li><a href="${escapeAttr(doc.repository)}">Sorgente su GitHub</a></li>` : '',
    `<li><span>Versione ${escapeHtml(doc.version.name)}${commit ? ` · ${commit}` : ''}</span></li>`,
    `<li><span>Generato con il toolkit Docs Italia (PoC)</span></li>`,
  ].join('');
  return `<footer class="ita-footer">
<div class="ita-footer-main"><div class="ita-footer-container"><section class="ita-footer-brand">
<a href="${escapeAttr(homeHref)}">${ic('it-pa', 'size-12')}<span><span class="ita-footer-name">Docs Italia</span><span class="ita-footer-tagline">${escapeHtml(doc.name)}</span></span></a>
</section></div></div>
<div class="ita-footer-legal"><ul class="ita-footer-container">${items}</ul></div>
</footer>
`;
}

function docToc(doc: DocView, current: PageView | null, hrefFor: (slug: string) => string): string {
  const items = doc.pages
    .slice(1)
    .map((p) => {
      const cur = current && p.slug === current.slug;
      return `<li class="di-toc-depth-${p.depth}"><a href="${escapeAttr(hrefFor(p.slug))}"${cur ? ' aria-current="page"' : ''}>${
        p.number ? `<span class="di-number">${escapeHtml(p.number)}</span> ` : ''
      }${escapeHtml(p.title)}</a></li>`;
    })
    .join('\n');
  const caption = escapeHtml(doc.caption ?? 'Indice dei contenuti');
  return `<p class="di-toc-caption">${caption}</p>\n<ol class="di-toc">\n${items}\n</ol>`;
}

function downloadsBox(doc: DocView, prefix: string): string {
  const d = doc.downloads;
  const links = [
    d.pdf && `<li><a href="${escapeAttr(prefix + d.pdf)}">${ic('it-file-pdf')}<span>PDF</span></a></li>`,
    d.epub && `<li><a href="${escapeAttr(prefix + d.epub)}">${ic('it-file')}<span>EPUB</span></a></li>`,
    d.html && `<li><a href="${escapeAttr(prefix + d.html)}">${ic('it-file-compressed')}<span>HTML compresso</span></a></li>`,
  ].filter(Boolean);
  if (!links.length) return '';
  return `<div class="di-downloads"><p class="di-toc-caption">Scarica</p><ul>${links.join('')}</ul></div>`;
}

function pager(doc: DocView, page: PageView, hrefFor: (slug: string) => string): string {
  const i = doc.pages.findIndex((p) => p.slug === page.slug);
  const prev = doc.pages[i - 1];
  const next = doc.pages[i + 1];
  const label = (p: PageView) => `${p.number ? p.number + '. ' : ''}${p.title}`;
  return `<nav class="di-pager" aria-label="Pagine precedente e successiva">${
    prev ? `<a class="di-pager-prev" href="${escapeAttr(hrefFor(prev.slug))}" rel="prev">${ic('it-arrow-left')}<span><small>Precedente</small>${escapeHtml(label(prev))}</span></a>` : '<span></span>'
  }${
    next ? `<a class="di-pager-next" href="${escapeAttr(hrefFor(next.slug))}" rel="next"><span><small>Successivo</small>${escapeHtml(label(next))}</span>${ic('it-arrow-right')}</a>` : ''
  }</nav>`;
}

function banner(doc: DocView): string {
  return doc.banner
    ? `<div class="di-banner" role="status">${ic('it-info-circle')}<p>${escapeHtml(doc.banner)}</p></div>`
    : '';
}

// ---------------------------------------------------------------------------
// Sito a capitoli
// ---------------------------------------------------------------------------

export interface SiteOptions {
  /** percorso del foglio di stile, relativo alla radice del sito */
  css: string;
  /** HTML aggiunto prima di </body> (es. ricaricamento automatico in anteprima) */
  bodyEnd?: string;
}

export function renderSitePage(doc: DocView, page: PageView, opts: SiteOptions): { file: string; html: string } {
  const file = pageFile(doc, page.slug);
  const ctx = siteContext(doc, page);
  const isRoot = page === doc.pages[0];
  const hrefPage = (slug: string) => relative(file, pageFile(doc, slug));
  const home = relative(file, 'index.html');
  const prefix = relative(file, 'x').slice(0, -1);

  const crumbs = breadcrumbs({
    items: [
      { label: 'Docs Italia' },
      ...(doc.publisher ? [{ label: escapeHtml(doc.publisher) }] : []),
      ...(doc.project ? [{ label: escapeHtml(doc.project) }] : []),
      isRoot ? { label: escapeHtml(doc.name) } : { label: escapeHtml(doc.name), href: home },
      ...(isRoot ? [] : [{ label: escapeHtml(`${page.number ? page.number + '. ' : ''}${page.title}`) }]),
    ],
  });

  const sub = page.sections.filter((s) => s.depth === 2);
  const onThisPage = sub.length
    ? navscroll({
        title: 'In questa pagina',
        links: sub.map((s) => ({
          label: escapeHtml(`${s.number ? s.number + ' ' : ''}${s.title}`),
          href: `#${s.anchor}`,
          children: page.sections
            .filter((c) => c.depth === 3 && c.number?.startsWith(`${s.number}.`))
            .map((c) => ({ label: escapeHtml(`${c.number ? c.number + ' ' : ''}${c.title}`), href: `#${c.anchor}` })),
        })),
      })
    : '';

  const meta = isRoot
    ? `<section class="di-meta" aria-label="Informazioni sul documento">
<p class="di-lead">${escapeHtml(doc.description)}</p>
<ul class="di-tags" aria-label="Argomenti">${doc.tags.map((t) => `<li>${chip({ label: escapeHtml(t), size: 'sm' })}</li>`).join('')}</ul>
</section>
<nav class="di-home-toc" aria-label="Indice dei contenuti">${docToc(doc, null, hrefPage)}</nav>
<p><a class="ita-btn ita-btn-primary ita-btn-outline" href="${escapeAttr(relative(file, 'pagina-singola.html'))}">${ic('it-list')}<span>Leggi in una sola pagina</span></a></p>`
    : '';

  const html = `${head(doc, isRoot ? doc.name : `${page.title} — ${doc.name}`, relative(file, opts.css))}<body>
${skiplinks({ links: [{ label: 'Vai al contenuto', href: '#main' }, { label: "Vai all'indice del documento", href: '#indice' }] })}
${siteHeader(doc, home)}
${banner(doc)}
<div class="di-shell">
${crumbs}
<div class="di-layout">
<nav id="indice" class="di-sidebar" aria-label="Indice del documento">
${docToc(doc, page, hrefPage)}
<p class="di-single-link"><a href="${escapeAttr(relative(file, 'pagina-singola.html'))}">Pagina singola</a></p>
${downloadsBox(doc, prefix)}
</nav>
<main id="main" class="di-main">
<article class="di-prose">
${renderNodes(page.tree.children, ctx)}
${meta}
${renderFootnotes(page.footnotes, ctx)}
</article>
${pager(doc, page, hrefPage)}
</main>
<aside class="di-aside">${onThisPage}</aside>
</div>
</div>
${siteFooter(doc, home)}
${backToTop({} as any)}
${opts.bodyEnd ?? ''}
</body>
</html>
`;
  return { file, html };
}

// ---------------------------------------------------------------------------
// Pagina singola e stampa
// ---------------------------------------------------------------------------

/** Tutti i capitoli in un solo documento (pagina singola e stampa). */
export function renderAllChapters(doc: DocView, mode: 'single' | 'print'): string {
  return doc.pages
    .map((p, i) => {
      const ctx = singleContext(doc, p, mode);
      const nodes = i === 0 ? p.tree.children?.filter((n) => !(n.type === 'heading' && n.depth === 1)) : p.tree.children;
      // data-title: titolo del capitolo per l'intestazione delle pagine stampate (string-set in paged.css)
      const title = `${p.number ? p.number + ' ' : ''}${p.title}`;
      return `<section id="${escapeAttr(pageId(p.slug))}" class="${i === 0 ? 'di-intro' : 'di-chapter'}" data-title="${escapeAttr(title)}">
${renderNodes(nodes, ctx)}
${renderFootnotes(p.footnotes, ctx)}
</section>`;
    })
    .join('\n');
}

export function renderSinglePage(doc: DocView, opts: SiteOptions): { file: string; html: string } {
  const file = 'pagina-singola.html';
  const toc = docToc(doc, null, (slug) => `#${pageId(slug)}`);
  const html = `${head(doc, `${doc.name} — pagina singola`, opts.css)}<body>
${skiplinks({ links: [{ label: 'Vai al contenuto', href: '#main' }] })}
${siteHeader(doc, 'index.html')}
${banner(doc)}
<div class="di-shell">
<div class="di-layout di-layout-single">
<nav class="di-sidebar" aria-label="Indice del documento">
${toc}
<p class="di-single-link"><a href="index.html">Versione a capitoli</a></p>
${downloadsBox(doc, '')}
</nav>
<main id="main" class="di-main">
<article class="di-prose">
<h1>${escapeHtml(doc.name)}</h1>
${renderAllChapters(doc, 'single')}
</article>
</main>
</div>
</div>
${siteFooter(doc, 'index.html')}
${backToTop({} as any)}
${opts.bodyEnd ?? ''}
</body>
</html>
`;
  return { file, html };
}

/** Documento per la stampa in PDF: copertina, indice, capitoli su pagine nuove. */
export function renderPrint(doc: DocView, opts: { css: string; date: string; extraCss?: string[]; paged?: boolean }): string {
  const meta = [doc.publisher, doc.project].filter(Boolean).map((s) => escapeHtml(s!)).join(' · ');
  const extra = (opts.extraCss ?? []).map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}" />\n`).join('');
  // con Paged.js il CSS del sito resta applicato dal browser ma non passa dal suo
  // analizzatore, che non regge i selettori moderni di Tailwind (:is, :where)
  return `${head(doc, doc.name, opts.css, extra, opts.paged ? ' data-pagedjs-ignore=""' : '')}<body class="di-print">
<section class="di-cover">
<p class="di-cover-owner">Docs Italia${meta ? ` · ${meta}` : ''}</p>
<h1>${escapeHtml(doc.name)}</h1>
<p class="di-lead">${escapeHtml(doc.description)}</p>
<p class="di-cover-version">Versione ${escapeHtml(doc.version.name)}${doc.version.commit ? ` · commit ${escapeHtml(doc.version.commit.slice(0, 7))}` : ''} · ${escapeHtml(opts.date)}</p>
</section>
<nav class="di-print-toc" aria-label="Indice">
<h2>${escapeHtml(doc.caption ?? 'Indice dei contenuti')}</h2>
<ol>${doc.pages
    .slice(1)
    .map((p) => `<li><a href="#${escapeAttr(pageId(p.slug))}">${p.number ? `<span class="di-number">${escapeHtml(p.number)}</span> ` : ''}${escapeHtml(p.title)}</a></li>`)
    .join('')}</ol>
</nav>
<main class="di-prose">
${renderAllChapters(doc, 'print')}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------

export function renderEpubChapter(doc: DocView, page: PageView): string {
  const ctx: RenderContext = {
    mode: 'epub',
    page: page.slug,
    hrefFor: (p, a) => `${p}.xhtml${a ? `#${a}` : ''}`,
    idFor: (_p, a) => a,
    assetHref: (path) => path,
  };
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeAttr(doc.language)}" xml:lang="${escapeAttr(doc.language)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(page.title)}</title>
<link rel="stylesheet" type="text/css" href="epub.css" />
</head>
<body>
<section epub:type="chapter" class="di-prose">
${renderNodes(page.tree.children, ctx)}
${renderFootnotes(page.footnotes, ctx)}
</section>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Anteprima nell'editor
// ---------------------------------------------------------------------------

/**
 * Frammento HTML di una pagina per l'anteprima dell'editor. I link interni
 * hanno la forma "#di:<pagina>[:<ancora>]" e li intercetta l'editor.
 */
export function renderPreview(page: PageView, assetBase: string): string {
  const ctx: RenderContext = {
    mode: 'preview',
    page: page.slug,
    hrefFor: (p, a) => `#di:${p}${a ? `:${a}` : ''}`,
    idFor: (_p, a) => a,
    assetHref: (path) => `${assetBase}${path}`,
  };
  return `<article class="di-prose">${renderNodes(page.tree.children, ctx)}${renderFootnotes(page.footnotes, ctx)}</article>`;
}
