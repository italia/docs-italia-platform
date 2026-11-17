/**
 * Caricamento di un documento: document_settings.yml, toc.json, file sorgente.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseDocumentSettings, parseToc, type DocumentSettings, type PageInfo, type Problem, type Toc, type TocEntry } from '@docs-italia/schema';

export interface Project {
  /** cartella del repository del documento */
  root: string;
  /** cartella della sorgente (root + document.source) */
  sourceDir: string;
  settings: DocumentSettings['document'];
  toc: Toc;
  /** pagine in ordine di lettura: la radice, poi i capitoli in ordine di toc */
  pages: PageInfo[];
  /** tutti i file .md della sorgente, relativi a sourceDir */
  markdownFiles: string[];
  problems: Problem[];
}

/** File tipici di un repository che non fanno parte del documento. */
const REPO_FILES = new Set(['readme.md', 'changelog.md', 'contributing.md', 'license.md', 'authors.md', 'code_of_conduct.md', 'security.md', 'pull_request_template.md']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.docs-italia', '.github']);

export class ProjectError extends Error {
  problems: Problem[];
  constructor(problems: Problem[]) {
    super(problems.map((p) => `${p.file}: ${p.message}`).join('\n'));
    this.problems = problems;
  }
}

export function slugOf(file: string): string {
  return file.replace(/\.md$/, '').split(sep).join('/');
}

function walk(dir: string, base: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else if (name.endsWith('.md') && !REPO_FILES.has(name.toLowerCase())) out.push(relative(base, full).split(sep).join('/'));
  }
}

export function loadProject(root: string): Project {
  const problems: Problem[] = [];
  const settingsPath = join(root, 'document_settings.yml');
  if (!existsSync(settingsPath)) throw new ProjectError([{ level: 'errore', file: 'document_settings.yml', code: 'missing', message: 'file mancante: non è un documento Docs Italia' }]);
  const s = parseDocumentSettings(readFileSync(settingsPath, 'utf8'));
  if (!s.ok) throw new ProjectError(s.problems);
  const settings = s.value.document;
  if (settings.format !== 'myst') {
    throw new ProjectError([{ level: 'errore', file: 'document_settings.yml', code: 'format', message: `formato "${settings.format}" non supportato dal PoC: serve "format: myst" (l'RST passa da Sphinx, fase 1)` }]);
  }

  const sourceDir = join(root, settings.source);
  const tocPath = join(sourceDir, 'toc.json');
  const tocRel = relative(root, tocPath);
  if (!existsSync(tocPath)) throw new ProjectError([{ level: 'errore', file: tocRel, code: 'missing', message: 'toc.json mancante' }]);
  const t = parseToc(readFileSync(tocPath, 'utf8'), tocRel);
  if (!t.ok) throw new ProjectError(t.problems);
  const toc = t.value;

  const markdownFiles: string[] = [];
  walk(sourceDir, sourceDir, markdownFiles);

  const pages: PageInfo[] = [{ file: toc.root, slug: slugOf(toc.root), title: '', depth: 0 }];
  const seen = new Set([toc.root]);
  const visit = (entries: TocEntry[], depth: number, prefix: string, parent?: string, numbered = toc.numbered) => {
    let n = 0;
    entries.forEach((e) => {
      const on = numbered && e.numbered !== false;
      const number = on ? `${prefix}${++n}` : undefined;
      let slug = parent;
      if (e.file) {
        if (seen.has(e.file)) problems.push({ level: 'errore', file: tocRel, code: 'toc-duplicate', message: `"${e.file}" compare più volte nell'indice` });
        seen.add(e.file);
        slug = slugOf(e.file);
        pages.push({ file: e.file, slug, title: e.title ?? '', number, depth, parent });
      }
      if (e.children?.length) visit(e.children, depth + 1, number ? `${number}.` : '', slug, on);
    });
  };
  visit(toc.chapters, 1, '');

  for (const p of pages) {
    if (!existsSync(join(sourceDir, p.file))) problems.push({ level: 'errore', file: tocRel, code: 'toc-missing-file', message: `il file "${p.file}" elencato nell'indice non esiste` });
  }
  for (const f of markdownFiles) {
    if (!seen.has(f)) problems.push({ level: 'avviso', file: f, code: 'not-in-toc', message: 'file .md non elencato in toc.json: non verrà pubblicato' });
  }
  return { root, sourceDir, settings, toc, pages, markdownFiles, problems };
}
