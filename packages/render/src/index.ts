import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export { escapeHtml, escapeAttr } from './escape.ts';
export { imageSize, renderNode, renderNodes, renderFootnotes } from './content.ts';
export type { GenericNode, RenderContext, RenderMode } from './content.ts';
export { renderSitePage, renderSinglePage, renderAllChapters, renderPrint, renderEpubChapter, renderPreview, relative, pageId } from './layout.ts';
export type { DocView, PageView, SectionView, SiteOptions } from './layout.ts';

/** Percorso assoluto del foglio di stile Tailwind del sito (da compilare). */
export const siteCssEntry = fileURLToPath(new URL('./site.css', import.meta.url));
/** Percorso assoluto del foglio di stile dell'EPUB (CSS semplice, senza Tailwind). */
export const epubCss = fileURLToPath(new URL('./epub.css', import.meta.url));
/** Regole di stampa per Paged.js (numeri di pagina, margini con contenuto). */
export const pagedCss = fileURLToPath(new URL('./paged.css', import.meta.url));
/**
 * Cartella dei font di Italia Tailwind UI: il CSS compilato li cerca in
 * "../fonts/" rispetto al foglio di stile, quindi la build li copia lì.
 */
export const italiaFontsDir = join(dirname(createRequire(import.meta.url).resolve('@italia-tailwind/css/package.json')), 'fonts');
