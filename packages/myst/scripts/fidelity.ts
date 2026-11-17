/**
 * Fedeltà del serializzatore a blocchi (todo.md, 5.3).
 *
 * Per ogni blocco di primo livello di ogni file .md:
 *   AST(testo originale)  ==  AST(serializzazione del blocco)  ?
 * e quanti blocchi tornano identici carattere per carattere.
 *
 * Uso: bun scripts/fidelity.ts <cartella> [<cartella>…]   (VERBOSE=1 per i dettagli)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseMyst } from '../src/myst.ts';
import { liftDirectives } from '../src/resolve.ts';
import { serializeBlocks, sourceBlocks } from '../src/serialize.ts';

const SKIP = new Set(['node_modules', 'dist', '.git', '.docs-italia']);
const REPO = /^(readme|changelog|contributing|license|authors|code_of_conduct|security|pull_request_template)\.md$/i;

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const f = join(dir, n);
    let st;
    try {
      st = statSync(f);
    } catch {
      continue; // collegamento rotto (es. submodule non scaricato)
    }
    if (st.isDirectory()) files(f, out);
    else if (n.endsWith('.md') && !REPO.test(n)) out.push(f);
  }
  return out;
}

const strip = (n: any): any => {
  if (Array.isArray(n)) return n.map(strip);
  if (n && typeof n === 'object') {
    const o: any = {};
    for (const [k, v] of Object.entries(n)) if (!['position', 'key', 'origin', 'directive'].includes(k)) o[k] = strip(v);
    return o;
  }
  return n;
};
const ast = (text: string) => JSON.stringify(strip(liftDirectives(parseMyst(text, 'x.md').tree.children ?? [])));

let total = 0;
let sameAst = 0;
let sameText = 0;
let failed = 0;
const byType = new Map<string, { total: number; ok: number }>();
for (const dir of process.argv.slice(2)) {
  for (const f of files(dir)) {
    const blocks = sourceBlocks(readFileSync(f, 'utf8'), f);
    for (const b of blocks) {
      total++;
      const type = b.nodes[0]?.origin?.name ? `{${b.nodes[0].origin.name}}` : (b.nodes[0]?.type ?? '?');
      const stat = byType.get(type) ?? { total: 0, ok: 0 };
      stat.total++;
      let out = '';
      try {
        out = serializeBlocks(b.nodes);
      } catch (e) {
        failed++;
        if (process.env.VERBOSE) console.log(`✖ ${relative(process.cwd(), f)}:${b.start} ${(e as Error).message}`);
        byType.set(type, stat);
        continue;
      }
      if (out === b.text) sameText++;
      if (ast(out) === ast(b.text)) {
        sameAst++;
        stat.ok++;
      } else if (process.env.VERBOSE) {
        console.log(`≠ ${relative(process.cwd(), f)}:${b.start} [${type}]\n--- originale\n${b.text}\n--- riscritto\n${out}\n`);
      }
      byType.set(type, stat);
    }
  }
}
const pct = (a: number) => `${total ? ((a / total) * 100).toFixed(1) : '0'}%`;
console.log(`blocchi: ${total} · AST identico: ${sameAst} (${pct(sameAst)}) · testo identico: ${sameText} (${pct(sameText)}) · non serializzabili: ${failed}`);
for (const [t, s] of [...byType.entries()].sort((a, b) => b[1].total - a[1].total)) {
  if (s.ok < s.total) console.log(`  ${t}: ${s.ok}/${s.total}`);
}
