/**
 * Prova di andata e ritorno: MyST → AST → MyST (myst-to-md) → AST.
 * Serve a valutare l'editor visuale: se l'AST riletto è uguale, salvare
 * dall'editor non cambia il contenuto; il diff testuale mostra quanto cambia
 * la forma del file (e quindi quanto sarebbe rumoroso un salvataggio dell'intero file).
 *
 * Uso: node packages/toolkit/scripts/roundtrip.ts <cartella con file .md>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unified } from 'unified';
import mystToMd from 'myst-to-md';
import { parseMyst } from '../src/myst.ts';

const dir = process.argv[2];
if (!dir) throw new Error('indica la cartella del documento');

const strip = (n: any): any => {
  if (Array.isArray(n)) return n.map(strip);
  if (n && typeof n === 'object') {
    const o: any = {};
    for (const [k, v] of Object.entries(n)) if (k !== 'position' && k !== 'key') o[k] = strip(v);
    return o;
  }
  return n;
};

let same = 0;
const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
for (const f of files) {
  const src = readFileSync(join(dir, f), 'utf8');
  const a = parseMyst(src, f).tree;
  const out = String((unified().use(mystToMd as any).stringify(a as any) as any).result ?? '');
  const b = parseMyst(out, f).tree;
  const equalAst = JSON.stringify(strip(a)) === JSON.stringify(strip(b));
  const srcLines = src.trimEnd().split('\n');
  const outLines = out.trimEnd().split('\n');
  const changed = srcLines.filter((l, i) => l !== outLines[i]).length + Math.max(0, outLines.length - srcLines.length);
  if (equalAst) same++;
  console.log(`${equalAst ? '✓' : '✖'} ${f}: AST ${equalAst ? 'identico' : 'DIVERSO'}, righe diverse nel testo ${changed}/${srcLines.length}`);
  if (process.env.SHOW) console.log(out);
}
console.log(`\n${same}/${files.length} file con AST identico dopo andata e ritorno.`);
