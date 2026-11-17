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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

export async function convert(src: string, out: string, opts: { log?: (m: string) => void } = {}): Promise<ConvertReport> {
  const log = opts.log ?? (() => {});
  src = resolve(src);
  out = resolve(out);
  if (out === src || out.startsWith(src + '/')) throw new Error('la cartella di uscita non può stare dentro quella di origine');
  if (!existsSync(join(src, 'index.rst'))) throw new Error(`${src}: manca index.rst (documenti con sorgente in una sottocartella: indicare quella)`);

  const ast = mkdtempSync(join(tmpdir(), 'docs-italia-ast-'));
  log('Sphinx: lettura dell’RST…');
  const { stderr } = await run(
    python(),
    ['-m', 'sphinx', '-q', '-C', '-b', 'docsitalia-ast', '-D', 'extensions=docs_italia_sphinx', '-D', 'master_doc=index', '-D', 'language=it', src, ast],
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

  const missingAssets: string[] = [];
  for (const a of report.assets as string[]) {
    const from = join(src, a);
    if (!existsSync(from)) {
      missingAssets.push(a);
      continue;
    }
    mkdirSync(dirname(join(out, a)), { recursive: true });
    cpSync(from, join(out, a));
  }

  writeFileSync(join(out, 'toc.json'), `${JSON.stringify({ $schema: 'https://docs.italia.it/schema/toc/1.json', ...toc }, null, 2)}\n`);

  const settingsFile = join(src, 'document_settings.yml');
  if (existsSync(settingsFile)) {
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
    assets: report.assets,
    missingAssets,
    sphinxWarnings,
  };
  writeFileSync(join(out, 'conversione.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
