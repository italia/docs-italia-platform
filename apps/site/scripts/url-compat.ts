/**
 * Compatibilità degli URL con il sito attuale (todo.md, 6.4): per ogni documento
 * dell'inventario prova l'URL canonico e l'URL di ogni versione attiva.
 *
 * Uso: bun scripts/url-compat.ts [--site URL] [--api URL] [inventario.json]
 * Distingue: risponde · non importato (documento o versione non pubblicati) · errore.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { site: { type: 'string' }, api: { type: 'string' } } });
const SITE = values.site ?? 'http://127.0.0.1:4400';
const API = values.api ?? 'http://127.0.0.1:8080';
const inventory = JSON.parse(readFileSync(positionals[0] ?? '../../inventario/docs-italia-api-snapshot.json', 'utf8'));

let ok = 0;
let missing = 0;
const errors: string[] = [];
for (const d of inventory) {
  const path = new URL(d.canonical_url).pathname;
  const [, pub, proj, doc] = path.split('/');
  const info = await fetch(`${API}/api/documents/${pub}/${proj}/${doc}`).then((r) => (r.ok ? r.json() : null));
  const published = new Set<string>((info?.versions ?? []).map((v: any) => v.slug));
  const urls = [{ url: path, version: d.default_version }, ...d.active_versions.map((v: any) => ({ url: `/${pub}/${proj}/${doc}/${d.language}/${v.slug}/`, version: v.slug }))];
  for (const u of urls) {
    const alias = ['stabile', 'stable', 'bozza', 'draft'].includes(u.version);
    const expected = info && (alias ? published.size > 0 : published.has(u.version));
    const res = await fetch(SITE + u.url, { redirect: 'follow' });
    if (res.ok) ok++;
    else if (!expected) missing++;
    else errors.push(`${res.status} ${u.url}`);
  }
}
console.log(`URL che rispondono: ${ok} · non importati: ${missing} · errori: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);
process.exitCode = errors.length ? 1 : 0;
