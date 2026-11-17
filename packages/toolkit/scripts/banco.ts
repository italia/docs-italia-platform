/**
 * Banco di prova della conversione (fase 1): converte in MyST ogni documento
 * RST trovato nelle cartelle indicate, poi esegue controllo e build HTML, e
 * scrive un rapporto di compatibilità.
 *
 * Uso: bun scripts/banco.ts --out <cartella di lavoro> --report <file.md> <cartella>…
 * Le cartelle di origine non vengono modificate.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { check } from '@docs-italia/myst';
import { build } from '../src/build.ts';
import { convert, findRstSource } from '../src/convert.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, report: { type: 'string' } } });
if (!values.out) throw new Error('--out obbligatorio');
const out = resolve(values.out);

interface Row {
  repo: string;
  source?: string;
  ok: boolean;
  pages?: number;
  unsupported?: Record<string, number>;
  dropped?: Record<string, number>;
  sphinxWarnings?: number;
  errors?: Record<string, number>;
  warnings?: Record<string, number>;
  buildOk?: boolean;
  ms: number;
  failure?: string;
}

const repos: string[] = [];
for (const dir of positionals) {
  for (const n of readdirSync(dir).sort()) {
    const r = join(dir, n);
    if (statSync(r).isDirectory() && existsSync(join(r, 'document_settings.yml'))) repos.push(r);
  }
}

const rows: Row[] = [];
for (const repo of repos) {
  const name = relative(resolve(positionals[0], '..'), repo);
  const t0 = performance.now();
  const src = findRstSource(repo);
  if (!src) {
    rows.push({ repo: name, ok: false, ms: 0, failure: 'nessun index.rst (sorgente in MyST o in una cartella non prevista)' });
    continue;
  }
  const dest = join(out, name);
  try {
    const r = await convert(src, dest);
    const problems = check(dest);
    const count = (level: string) =>
      problems.filter((p) => p.level === level).reduce<Record<string, number>>((a, p) => ((a[p.code] = (a[p.code] ?? 0) + 1), a), {});
    let buildOk = false;
    try {
      await build(dest, { html: true, pdf: false, epub: false, zip: false, bundle: true, css: false });
      buildOk = true;
    } catch {}
    rows.push({
      repo: name,
      source: relative(repo, src) || '.',
      ok: true,
      pages: r.pages,
      unsupported: r.unsupported,
      dropped: r.dropped,
      sphinxWarnings: r.sphinxWarnings.length,
      errors: count('errore'),
      warnings: count('avviso'),
      buildOk,
      ms: Math.round(performance.now() - t0),
    });
  } catch (e) {
    rows.push({ repo: name, source: relative(repo, src) || '.', ok: false, ms: Math.round(performance.now() - t0), failure: String((e as Error).message).split('\n')[0].slice(0, 200) });
  }
  const last = rows[rows.length - 1];
  console.log(`${last.ok ? '✓' : '✖'} ${name} ${last.ok ? `${last.pages} pagine, ${Object.values(last.errors ?? {}).reduce((a, b) => a + b, 0)} errori` : last.failure} (${last.ms} ms)`);
}

const sum = (rs: Row[], k: 'unsupported' | 'dropped' | 'errors' | 'warnings') =>
  rs.reduce<Record<string, number>>((acc, r) => {
    for (const [c, v] of Object.entries(r[k] ?? {})) acc[c] = (acc[c] ?? 0) + v;
    return acc;
  }, {});
const fmt = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ') || '—';
const converted = rows.filter((r) => r.ok);
const clean = converted.filter((r) => !Object.keys(r.errors ?? {}).length);

const md = `# Banco di prova della conversione RST → MyST

Generato da \`packages/toolkit/scripts/banco.ts\` il ${new Date().toLocaleDateString('it-IT')}, sui repository presenti in locale (branch attuale di ciascuno).

| | |
|---|---|
| Repository | ${rows.length} |
| Convertiti | ${converted.length} |
| Senza errori al controllo | ${clean.length} |
| Build HTML riuscita | ${converted.filter((r) => r.buildOk).length} |
| Pagine convertite | ${converted.reduce((a, r) => a + (r.pages ?? 0), 0)} |

**Costrutti non convertiti**: ${fmt(sum(rows, 'unsupported'))}

**Contenuto scartato**: ${fmt(sum(rows, 'dropped'))}

**Errori del controllo**: ${fmt(sum(rows, 'errors'))}

**Avvisi del controllo**: ${fmt(sum(rows, 'warnings'))}

## Per repository

| Repository | Sorgente | Pagine | Errori | Avvisi | Build | Non convertito | Note |
|---|---|---|---|---|---|---|---|
${rows
  .map((r) =>
    r.ok
      ? `| ${r.repo} | \`${r.source}\` | ${r.pages} | ${Object.values(r.errors ?? {}).reduce((a, b) => a + b, 0)} | ${Object.values(r.warnings ?? {}).reduce((a, b) => a + b, 0)} | ${r.buildOk ? 'sì' : 'no'} | ${fmt(r.unsupported ?? {})} | ${fmt(r.errors ?? {})} |`
      : `| ${r.repo} | ${r.source ? `\`${r.source}\`` : '—'} | — | — | — | — | — | ${r.failure} |`,
  )
  .join('\n')}
`;
if (values.report) writeFileSync(values.report, md);
writeFileSync(join(out, 'banco.json'), JSON.stringify(rows, null, 2));
console.log(`\n${converted.length}/${rows.length} convertiti, ${clean.length} senza errori. Rapporto: ${values.report ?? join(out, 'banco.json')}`);
