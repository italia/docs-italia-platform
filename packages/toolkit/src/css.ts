/**
 * Compilazione del foglio di stile con la CLI di Tailwind CSS 4.
 * Sorgenti scansionate: il pacchetto render e l'HTML generato.
 */
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { italiaFontsDir, siteCssEntry } from '@docs-italia/render';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

/**
 * Compila il CSS in `<htmlDir>/assets/site.css` e copia i font in `<htmlDir>/fonts`
 * (gli url dei font sono relativi: "../fonts/...").
 */
export async function buildCss(htmlDir: string, cacheDir: string, opts: { minify?: boolean } = {}): Promise<string> {
  mkdirSync(cacheDir, { recursive: true });
  const entry = join(cacheDir, 'site.entry.css');
  writeFileSync(entry, `@import "${siteCssEntry}";\n@source "${htmlDir}";\n`);
  const out = join(htmlDir, 'assets', 'site.css');
  const cli = join(dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist', 'index.mjs');
  await run(process.execPath, [cli, '-i', entry, '-o', out, ...(opts.minify === false ? [] : ['--minify'])], { maxBuffer: 20 * 1024 * 1024 });
  cpSync(italiaFontsDir, join(htmlDir, 'fonts'), { recursive: true });
  return out;
}
