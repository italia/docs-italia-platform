/**
 * `docs-italia convert`: documento RST → documento MyST (todo.md, 3.6).
 *
 * 1. Sphinx legge l'RST con l'estensione docs_italia_sphinx, senza eseguire il
 *    conf.py del repository, e scrive l'AST MyST di ogni pagina e toc.json.
 * 2. Ogni pagina si riscrive in MyST con il serializzatore a blocchi.
 * 3. Si copiano immagini e file scaricabili; document_settings.yml riceve
 *    `format: myst` conservando commenti e campi esistenti.
 * 4. conversione.json riporta cosa non è stato convertito e dove.
 *
 * La cartella di origine non viene mai modificata.
 */
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseDocument } from 'yaml';
import { serializeBlocks } from '@docs-italia/myst';
import type { GenericNode } from '@docs-italia/schema';

const run = promisify(execFile);

export interface ConvertReport {
  source: string;
  pages: number;
  unsupported: Record<string, number>;
  dropped: Record<string, number>;
  where: string[];
  assets: string[];
  missingAssets: string[];
  sphinxWarnings: string[];
}

/** Python con l'estensione: DOCS_ITALIA_PYTHON, poi l'ambiente del monorepo, poi python3. */
function python(): string {
  if (process.env.DOCS_ITALIA_PYTHON) return process.env.DOCS_ITALIA_PYTHON;
  const local = fileURLToPath(new URL('../../sphinx/.venv/bin/python', import.meta.url));
  return existsSync(local) ? local : 'python3';
}

function files(dir: string, ext: string, base = dir, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) files(f, ext, base, out);
    else if (n.endsWith(ext)) out.push(relative(base, f));
  }
  return out;
}

/**
 * Cartella della sorgente RST in un repository (todo.md, 2.2): index.rst alla
 * radice, poi docs/it, docs, rst, src.
 */
export function findRstSource(repo: string): string | undefined {
  for (const d of ['.', 'docs/it', 'docs', 'rst', 'src', 'doc']) {
    if (existsSync(join(repo, d, 'index.rst'))) return resolve(repo, d);
  }
  return undefined;
}

/** document_settings.yml nella sorgente o in una cartella superiore (sorgenti in docs/it). */
function findSettings(src: string): string | undefined {
  let dir = src;
  for (let i = 0; i < 4; i++) {
    const f = join(dir, 'document_settings.yml');
    if (existsSync(f)) return f;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

export async function convert(src: string, out: string, opts: { log?: (m: string) => void } = {}): Promise<ConvertReport> {
  const log = opts.log ?? (() => {});
  src = resolve(src);
  out = resolve(out);
  if (out === src || out.startsWith(src + '/')) throw new Error('la cartella di uscita non può stare dentro quella di origine');
  if (!existsSync(join(src, 'index.rst'))) throw new Error(`${src}: manca index.rst (documenti con sorgente in una sottocartella: indicare quella)`);

  const ast = mkdtempSync(join(tmpdir(), 'docs-italia-ast-'));
  // il conf.py non si esegue: se ne leggono solo le impostazioni che servono alla conversione
  const confPy = existsSync(join(src, 'conf.py')) ? readFileSync(join(src, 'conf.py'), 'utf8') : '';
  const extensions = ['docs_italia_sphinx'];
  const defines: string[] = [];
  if (/['"]sphinx\.ext\.autosectionlabel['"]/.test(confPy)) {
    extensions.push('sphinx.ext.autosectionlabel');
    if (/^\s*autosectionlabel_prefix_document\s*=\s*True/m.test(confPy)) defines.push('-D', 'autosectionlabel_prefix_document=1');
  }
  log('Sphinx: lettura dell’RST…');
  const { stderr } = await run(
    python(),
    ['-m', 'sphinx', '-q', '-C', '-b', 'docsitalia-ast', '-D', `extensions=${extensions.join(',')}`, ...defines, '-D', 'master_doc=index', '-D', 'language=it', src, ast],
    { maxBuffer: 50 * 1024 * 1024 },
  ).catch((e) => {
    throw new Error(`Sphinx non riuscito: ${e.stderr || e.message}`);
  });
  const sphinxWarnings = stderr.split('\n').filter((l) => l.trim());
  const report = JSON.parse(readFileSync(join(ast, 'report.json'), 'utf8'));
  const toc = JSON.parse(readFileSync(join(ast, 'toc.json'), 'utf8'));

  mkdirSync(out, { recursive: true });
  const pages = files(join(ast, 'pages'), '.json');
  for (const rel of pages) {
    const { tree } = JSON.parse(readFileSync(join(ast, 'pages', rel), 'utf8')) as { tree: GenericNode };
    const md = join(out, rel.replace(/\.json$/, '.md'));
    mkdirSync(dirname(md), { recursive: true });
    writeFileSync(md, `${serializeBlocks(tree.children)}\n`);
  }
  log(`${pages.length} pagine riscritte in MyST`);

  // percorso nel progetto MyST → percorso nella sorgente. Può risalire con "../"
  // (sorgente in docs/it, immagini in media/), ma non oltre la radice del
  // repository: il documento non è fidato e non deve pubblicare file del server.
  const settingsFile = findSettings(src);
  const repoRoot = realpathSync(settingsFile ? dirname(settingsFile) : src);
  const real = (f: string) => (existsSync(f) ? realpathSync(f) : f); // anche i link simbolici restano nel repository
  const assets = Object.entries(report.assets as Record<string, string>);
  const missingAssets: string[] = [];
  for (const [dest, from] of assets) {
    const to = resolve(out, dest);
    const source = real(resolve(src, from));
    if (!to.startsWith(out + '/') || !source.startsWith(repoRoot + '/') || !existsSync(source) || !statSync(source).isFile()) {
      missingAssets.push(from);
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    cpSync(source, to);
  }

  writeFileSync(join(out, 'toc.json'), `${JSON.stringify({ $schema: 'https://docs.italia.it/schema/toc/1.json', ...toc }, null, 2)}\n`);

  if (settingsFile) {
    const doc = parseDocument(readFileSync(settingsFile, 'utf8'));
    doc.setIn(['document', 'format'], 'myst');
    writeFileSync(join(out, 'document_settings.yml'), doc.toString());
  }

  const result: ConvertReport = {
    source: src,
    pages: pages.length,
    unsupported: report.unsupported,
    dropped: report.dropped,
    where: report.where,
    assets: assets.map(([dest]) => dest),
    missingAssets,
    sphinxWarnings,
  };
  writeFileSync(join(out, 'conversione.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
