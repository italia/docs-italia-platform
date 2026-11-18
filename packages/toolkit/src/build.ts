/**
 * Build di un documento: sito HTML (capitoli + pagina singola), PDF, EPUB,
 * HTML compresso e pacchetto (bundle) per la piattaforma.
 *
 * dist/
 *   html/        sito statico, con i file scaricabili in html/downloads/
 *   downloads/   <slug>.pdf, <slug>.epub, <slug>-html.zip
 *   bundle/      manifest.json, metadata.json, toc.json, inventory.json,
 *                pages/*.json (AST), search.jsonl, chunks.jsonl, assets/, downloads/
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { zipSync, type Zippable } from 'fflate';
import { pagedCss, renderPrint, renderSinglePage, renderSitePage, type DocView } from '@docs-italia/render';
import { BUNDLE_SCHEMA_VERSION, type Manifest, type Problem } from '@docs-italia/schema';
import { buildCss } from './css.ts';
import { buildEpub, epubcheck, htmlToPdf, type PdfEngine } from '@docs-italia/export';
import { gitInfo, type GitInfo } from '@docs-italia/forge';
import { diskReader, loadProject, resolveProject, type ResolvedDoc, type SourceReader } from '@docs-italia/myst';
import { chunks, searchRecords } from '@docs-italia/retrieval';

export const TOOLKIT_VERSION = '0.0.1-poc';

export interface BuildOptions {
  html?: boolean;
  pdf?: boolean;
  epub?: boolean;
  zip?: boolean;
  bundle?: boolean;
  /** cartella di uscita; predefinita <root>/dist */
  outDir?: string;
  /** testo del banner sopra il contenuto */
  banner?: string;
  /** indirizzo pubblico dei file del documento, con la "/" finale: dal PDF e dall'EPUB gli allegati si linkano qui */
  filesUrl?: string;
  /** HTML aggiunto in fondo a ogni pagina (anteprima: ricaricamento automatico) */
  bodyEnd?: string;
  minifyCss?: boolean;
  /** nome del documento nei file scaricabili; predefinito: dal repository o dalla cartella */
  slug?: string;
  /** motore del PDF: pagedjs (predefinito) o chrome */
  pdfEngine?: PdfEngine;
  /** se false, il CSS non viene ricompilato quando esiste già */
  css?: boolean;
  read?: SourceReader;
  log?: (msg: string) => void;
}

export interface BuildResult {
  outDir: string;
  doc: ResolvedDoc;
  git: GitInfo;
  outputs: Record<string, string>;
  problems: Problem[];
  timings: Record<string, number>;
}

export function documentSlug(root: string, repository?: string): string {
  return (repository ? basename(repository).replace(/\.git$/, '') : basename(root)).toLowerCase();
}

export function versionName(git: GitInfo): string {
  return git.tag ?? (git.branch && git.branch !== 'HEAD' ? git.branch : 'locale');
}

export function toDocView(doc: ResolvedDoc, git: GitInfo, downloads: DocView['downloads'], banner?: string): DocView {
  const s = doc.project.settings;
  return {
    name: s.name,
    description: s.description.trim(),
    tags: s.tags,
    publisher: s.publisher,
    project: s.project,
    repository: s.repository,
    language: s.languages[0] ?? 'it',
    version: { name: versionName(git), commit: git.commit, dirty: git.dirty },
    caption: doc.project.toc.caption,
    pages: doc.pages,
    downloads,
    banner,
  };
}

function listFiles(dir: string, base = dir, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function zipDir(dir: string, exclude: (rel: string) => boolean, prefix: string): Uint8Array {
  const files: Zippable = {};
  for (const rel of listFiles(dir)) if (!exclude(rel)) files[`${prefix}/${rel}`] = readFileSync(join(dir, rel));
  return zipSync(files, { level: 6 });
}

/** Percorso da mostrare nei messaggi: relativo se sotto la cartella corrente. */
const show = (p: string) => {
  const r = relative(process.cwd(), p);
  return r.startsWith('..') ? p : r;
};

const pageHref = (doc: ResolvedDoc, slug: string, anchor?: string) =>
  `${slug === doc.pages[0].slug ? 'index' : slug}.html${anchor ? `#${anchor}` : ''}`;

export async function build(root: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const log = opts.log ?? (() => {});
  const timings: Record<string, number> = {};
  const t = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
    const s = performance.now();
    const r = await fn();
    timings[name] = Math.round(performance.now() - s);
    return r;
  };
  const want = { html: opts.html ?? true, pdf: opts.pdf ?? true, epub: opts.epub ?? true, zip: opts.zip ?? true, bundle: opts.bundle ?? true };
  if (want.pdf || want.zip) want.html = true; // il PDF usa il CSS del sito; lo zip è il sito

  const project = await t('caricamento', () => loadProject(root));
  const git = await t('git', () => gitInfo(root));
  const doc = await t('parsing e risoluzione', () => resolveProject(project, opts.read ?? diskReader(project)));
  const slug = opts.slug ?? documentSlug(root, project.settings.repository);
  const outDir = opts.outDir ?? join(root, 'dist');
  const htmlDir = join(outDir, 'html');
  const dlDir = join(outDir, 'downloads');
  const cacheDir = join(root, '.docs-italia', 'cache');
  const outputs: Record<string, string> = {};

  const downloads: DocView['downloads'] = {};
  const settingsDownloads = new Set(project.settings.downloads);
  if (want.pdf && settingsDownloads.has('pdf')) downloads.pdf = `downloads/${slug}.pdf`;
  if (want.epub && settingsDownloads.has('epub')) downloads.epub = `downloads/${slug}.epub`;
  if (want.zip && settingsDownloads.has('html')) downloads.html = `downloads/${slug}-html.zip`;
  const view = { ...toDocView(doc, git, downloads, opts.banner), filesUrl: opts.filesUrl };

  if (want.html) {
    await t('html', () => {
      const keepCss = opts.css === false && existsSync(join(htmlDir, 'assets', 'site.css'));
      for (const name of existsSync(htmlDir) ? readdirSync(htmlDir) : []) {
        if (keepCss && (name === 'assets' || name === 'fonts')) continue;
        rmSync(join(htmlDir, name), { recursive: true, force: true });
      }
      mkdirSync(htmlDir, { recursive: true });
      const siteOpts = { css: 'assets/site.css', bodyEnd: opts.bodyEnd };
      for (const p of doc.pages) {
        const { file, html } = renderSitePage(view, p, siteOpts);
        mkdirSync(dirname(join(htmlDir, file)), { recursive: true });
        writeFileSync(join(htmlDir, file), html);
      }
      const single = renderSinglePage(view, siteOpts);
      writeFileSync(join(htmlDir, single.file), single.html);
      for (const a of doc.assets) {
        mkdirSync(dirname(join(htmlDir, a)), { recursive: true });
        cpSync(join(project.sourceDir, a), join(htmlDir, a));
      }
    });
    if (opts.css !== false || !existsSync(join(htmlDir, 'assets', 'site.css'))) {
      await t('css', () => buildCss(htmlDir, cacheDir, { minify: opts.minifyCss }));
    }
    outputs.html = htmlDir;
    log(`sito HTML: ${show(htmlDir)}/index.html`);
  }

  if (want.pdf || want.epub || want.zip) mkdirSync(dlDir, { recursive: true });

  if (want.pdf) {
    await t('pdf', async () => {
      const printFile = join(htmlDir, '_stampa.html');
      const paged = (opts.pdfEngine ?? 'pagedjs') === 'pagedjs';
      if (paged) cpSync(pagedCss, join(htmlDir, 'assets', 'paged.css'));
      writeFileSync(
        printFile,
        renderPrint(view, {
          css: 'assets/site.css',
          extraCss: paged ? ['assets/paged.css'] : [],
          paged,
          date: new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }),
        }),
      );
      const pdf = join(dlDir, `${slug}.pdf`);
      try {
        await htmlToPdf(printFile, pdf, view.name, { engine: opts.pdfEngine });
      } finally {
        // DOCS_ITALIA_KEEP_PRINT=1 conserva la pagina di stampa per controllarla nel browser
        if (!process.env.DOCS_ITALIA_KEEP_PRINT) {
          rmSync(printFile, { force: true });
          if (paged) rmSync(join(htmlDir, 'assets', 'paged.css'), { force: true });
        }
      }
      outputs.pdf = pdf;
    });
    log(`PDF: ${show(outputs.pdf)}`);
  }

  if (want.epub) {
    await t('epub', () => {
      const data = buildEpub(view, {
        sourceDir: project.sourceDir,
        assets: [...doc.assets],
        identifier: `urn:docs-italia:${slug}:${view.version.name}:${(git.commit ?? 'locale').slice(0, 12)}`,
        modified: new Date(),
      });
      outputs.epub = join(dlDir, `${slug}.epub`);
      writeFileSync(outputs.epub, data);
    });
    const check = await t('epubcheck', () => epubcheck(outputs.epub!));
    if (!check.available) log('EPUB: epubcheck non installato, validazione saltata (è nell’immagine del toolkit)');
    for (const m of check.messages) doc.problems.push({ level: m.startsWith('WARNING') ? 'avviso' : 'errore', file: 'EPUB', code: 'epubcheck', message: m });
    log(`EPUB: ${show(outputs.epub)}${check.available ? (check.ok ? ' (epubcheck: valido)' : ` (epubcheck: ${check.messages.length} problemi)`) : ''}`);
  }

  if (want.zip) {
    await t('zip html', () => {
      outputs.zip = join(dlDir, `${slug}-html.zip`);
      writeFileSync(outputs.zip, zipDir(htmlDir, (r) => r.startsWith('downloads/'), slug));
    });
    log(`HTML compresso: ${show(outputs.zip)}`);
  }

  if (want.html && Object.keys(downloads).length) cpSync(dlDir, join(htmlDir, 'downloads'), { recursive: true });

  if (want.bundle) {
    await t('pacchetto', () => {
      const b = join(outDir, 'bundle');
      rmSync(b, { recursive: true, force: true });
      mkdirSync(join(b, 'pages'), { recursive: true });
      const json = (rel: string, data: unknown) => {
        mkdirSync(dirname(join(b, rel)), { recursive: true });
        writeFileSync(join(b, rel), JSON.stringify(data, null, 1) + '\n');
      };
      json('metadata.json', project.settings);
      json('toc.json', { caption: project.toc.caption, numbered: project.toc.numbered, pages: doc.pages.map(({ file, slug, title, number, depth, parent, hidden }) => ({ file, slug, title, number, depth, parent, hidden })) });
      json('inventory.json', doc.inventory);
      for (const p of doc.pages) json(`pages/${p.slug}.json`, { slug: p.slug, file: p.file, title: p.title, number: p.number, hidden: p.hidden, sections: p.sections, footnotes: p.footnotes, tree: p.tree });
      writeFileSync(join(b, 'search.jsonl'), searchRecords(doc).map((r) => JSON.stringify(r)).join('\n') + '\n');
      writeFileSync(join(b, 'chunks.jsonl'), chunks(doc, (p, a) => pageHref(doc, p, a)).map((r) => JSON.stringify(r)).join('\n') + '\n');
      for (const a of doc.assets) {
        mkdirSync(dirname(join(b, 'assets', a)), { recursive: true });
        cpSync(join(project.sourceDir, a), join(b, 'assets', a));
      }
      if (existsSync(dlDir)) cpSync(dlDir, join(b, 'downloads'), { recursive: true });
      const files = listFiles(b).map((rel) => {
        const data = readFileSync(join(b, rel));
        return { path: rel, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
      });
      const manifest: Manifest = {
        schema: BUNDLE_SCHEMA_VERSION,
        document: { slug, name: project.settings.name, description: project.settings.description.trim(), tags: project.settings.tags, publisher: project.settings.publisher, project: project.settings.project, repository: project.settings.repository },
        version: { name: view.version.name, ref: git.branch, commit: git.commit, dirty: git.dirty },
        language: view.language,
        format: 'myst',
        toolkit: TOOLKIT_VERSION,
        generatedAt: new Date().toISOString(),
        pages: doc.pages.map(({ file, slug: s, title, number, depth, parent, hidden }) => ({ file, slug: s, title, number, depth, parent, hidden })),
        downloads: Object.fromEntries(Object.entries(downloads).map(([k, v]) => [k, v!])),
        files,
      };
      json('manifest.json', manifest);
      outputs.bundle = b;
    });
    log(`pacchetto: ${show(outputs.bundle)}/manifest.json`);
  }

  return { outDir, doc, git, outputs, problems: doc.problems, timings };
}
