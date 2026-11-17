/**
 * Percorre il sito dalla home seguendo i link interni e le immagini, e riporta
 * ogni risposta di errore con la pagina da cui arriva.
 *
 * Uso: bun scripts/crawl.ts [--site URL] [--max N]
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { site: { type: 'string' }, max: { type: 'string' } } });
const SITE = (values.site ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
const MAX = Number(values.max ?? 5000);

const seen = new Map<string, string>(); // url → pagina che lo cita
const queue: string[] = ['/'];
seen.set('/', '(inizio)');
const errors: Array<{ status: number; url: string; from: string }> = [];
let pages = 0;
let assets = 0;

const SKIP = /^\/(projects\/.*\/downloads\/|ricerca\/)/; // download (pesanti) e ricerca: provati a parte

while (queue.length && pages + assets < MAX) {
  const url = queue.shift()!;
  const res = await fetch(SITE + url, { redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    errors.push({ status: res.status, url, from: seen.get(url)! });
    await res.arrayBuffer();
    continue;
  }
  if (!type.startsWith('text/html')) {
    assets++;
    await res.arrayBuffer();
    continue;
  }
  pages++;
  const html = await res.text();
  const base = new URL(res.url);
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
    let u: URL;
    try {
      u = new URL(m[1]!.replace(/&amp;/g, '&'), base);
    } catch {
      continue;
    }
    if (u.origin !== base.origin) continue;
    const path = u.pathname + u.search;
    if (seen.has(path) || SKIP.test(u.pathname) || /\.(css|js|woff2|svg)$/.test(u.pathname) && u.pathname.startsWith('/_astro/')) continue;
    seen.set(path, url);
    queue.push(path);
  }
}
console.log(`pagine: ${pages} · file: ${assets} · errori: ${errors.length}${queue.length ? ` · non visitati (limite): ${queue.length}` : ''}`);
const byStatus = new Map<number, number>();
for (const e of errors) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
for (const [s, n] of byStatus) console.log(`  ${s}: ${n}`);
for (const e of errors.slice(0, Number(process.env.CRAWL_SHOW ?? 40))) console.log(`  ${e.status} ${e.url}\n      da ${e.from}`);
process.exitCode = errors.length ? 1 : 0;
