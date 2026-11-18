/**
 * Banco di prova esteso (todo.md, 13.3): tutte le versioni pubblicate oggi su
 * docs.italia.it, dall'inventario dell'API (inventario/docs-italia-api-snapshot.json).
 *
 * Per ogni versione: clone superficiale del tag o del branch, conversione in
 * MyST se il documento è RST, controllo, build HTML e pacchetto. I clone
 * restano nella cartella --cache e si riusano alle esecuzioni successive.
 *
 * Uso:
 *   bun scripts/banco-esteso.ts --cache <clone> --out <lavoro> --report <file.md>
 *     [--snapshot <file.json>] [--jobs 4] [--only <slug documento>]
 * I repository di origine non vengono mai modificati.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { check } from '@docs-italia/myst';
import { parseDocumentSettings } from '@docs-italia/schema';
import { build } from '../src/build.ts';
import { convert, findRstSource } from '../src/convert.ts';

const run = promisify(execFile);
const { values } = parseArgs({
  options: {
    snapshot: { type: 'string', default: new URL('../../../inventario/docs-italia-api-snapshot.json', import.meta.url).pathname },
    cache: { type: 'string' },
    out: { type: 'string' },
    report: { type: 'string' },
    jobs: { type: 'string', default: '4' },
    only: { type: 'string' },
  },
});
if (!values.cache || !values.out) throw new Error('--cache e --out sono obbligatori');
const cache = resolve(values.cache);
const out = resolve(values.out);

interface SnapshotDoc {
  slug: string;
  repo: string;
  default_version: string;
  publisher: { name: string };
  active_versions: Array<{ slug: string; identifier: string; type: 'tag' | 'branch' }>;
}

interface Row {
  document: string;
  repo: string;
  version: string;
  ref: string;
  type: string;
  isDefault: boolean;
  stage: 'clone' | 'sorgente' | 'conversione' | 'controllo' | 'fatto';
  format?: string;
  source?: string;
  pages?: number;
  unsupported?: Record<string, number>;
  dropped?: Record<string, number>;
  errors?: Record<string, number>;
  warnings?: Record<string, number>;
  buildOk?: boolean;
  ms: number;
  failure?: string;
}

const docs = (JSON.parse(readFileSync(values.snapshot!, 'utf8')) as SnapshotDoc[]).filter((d) => !values.only || d.slug === values.only);
const tasks = docs.flatMap((d) => d.active_versions.map((v) => ({ d, v })));
console.log(`${docs.length} documenti, ${tasks.length} versioni`);

const count = (problems: Array<{ level: string; code: string }>, level: string) =>
  problems.filter((p) => p.level === level).reduce<Record<string, number>>((a, p) => ((a[p.code] = (a[p.code] ?? 0) + 1), a), {});
const firstLine = (e: unknown) => String((e as Error).message ?? e).split('\n').find((l) => l.trim())?.slice(0, 200) ?? 'errore';

/** owner/repo dall'URL del repository (lo slug del documento può essere diverso dal nome). */
function repoOf(url: string): { owner: string; name: string } {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) throw new Error(`repository non su GitHub: ${url}`);
  return { owner: m[1]!, name: m[2]! };
}

/**
 * Il commit pubblicato: per i tag l'inventario dà lo SHA, per i branch il nome
 * (a volte "origin/<branch>"). GitHub permette di scaricare un commit per SHA.
 */
async function clone(url: string, ref: string, dir: string) {
  if (existsSync(join(dir, '.git', 'docs-italia-ok'))) return;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // niente credenziali del terminale: i repository sono pubblici
  const git = (...args: string[]) =>
    run('git', ['-c', 'credential.helper=', '-c', 'advice.detachedHead=false', ...args], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_TERMINAL_PROMPT: '0' },
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  await git('init', '--quiet');
  await git('remote', 'add', 'origin', url);
  await git('fetch', '--quiet', '--depth', '1', 'origin', ref.replace(/^origin\//, ''));
  await git('checkout', '--quiet', 'FETCH_HEAD');
  writeFileSync(join(dir, '.git', 'docs-italia-ok'), ref);
}

async function one({ d, v }: (typeof tasks)[number]): Promise<Row> {
  const t0 = performance.now();
  const row: Row = { document: d.slug, repo: d.repo, version: v.slug, ref: v.identifier, type: v.type, isDefault: v.slug === d.default_version, stage: 'clone', ms: 0 };
  const done = (patch: Partial<Row>) => Object.assign(row, patch, { ms: Math.round(performance.now() - t0) });
  try {
    const { owner, name } = repoOf(d.repo);
    const src = join(cache, owner, name, v.slug);
    await clone(d.repo, v.identifier, src);

    row.stage = 'sorgente';
    const settingsFile = join(src, 'document_settings.yml');
    const settings = existsSync(settingsFile) ? parseDocumentSettings(readFileSync(settingsFile, 'utf8')) : null;
    row.format = settings?.ok ? settings.value.document.format : 'rst';
    let docDir = src;
    if (row.format !== 'myst') {
      const rst = findRstSource(src);
      if (!rst) return done({ failure: 'nessun index.rst (né alla radice né in docs/it, docs, rst, src, doc)' });
      row.source = relative(src, rst) || '.';
      row.stage = 'conversione';
      docDir = join(out, owner, name, v.slug);
      rmSync(docDir, { recursive: true, force: true });
      const r = await convert(rst, docDir);
      Object.assign(row, { pages: r.pages, unsupported: r.unsupported, dropped: r.dropped });
    }

    row.stage = 'controllo';
    const problems = check(docDir);
    row.errors = count(problems, 'errore');
    row.warnings = count(problems, 'avviso');
    try {
      const b = await build(docDir, { html: true, pdf: false, epub: false, zip: false, bundle: true, css: false, outDir: join(out, '_dist', owner, name, v.slug) });
      row.pages ??= b.doc.pages.length;
      row.buildOk = true;
    } catch (e) {
      row.buildOk = false;
      row.failure = `build: ${firstLine(e)}`;
    }
    return done({ stage: 'fatto' });
  } catch (e) {
    return done({ failure: firstLine(e) });
  }
}

// esecuzione con al massimo --jobs versioni in parallelo (Sphinx è un processo a parte)
const rows: Row[] = [];
let next = 0;
const worker = async () => {
  while (next < tasks.length) {
    const task = tasks[next++]!;
    const r = await one(task);
    rows.push(r);
    const errs = Object.values(r.errors ?? {}).reduce((a, b) => a + b, 0);
    console.log(`${r.stage === 'fatto' && r.buildOk ? '✓' : '✖'} [${rows.length}/${tasks.length}] ${r.document}@${r.version} ${r.stage === 'fatto' ? `${r.pages ?? '?'} pagine, ${errs} errori` : `${r.stage}: ${r.failure}`} (${r.ms} ms)`);
  }
};
await Promise.all(Array.from({ length: Math.max(1, Number(values.jobs)) }, worker));
rows.sort((a, b) => a.document.localeCompare(b.document) || a.version.localeCompare(b.version, 'it', { numeric: true }));

// ---------------------------------------------------------------------------- rapporto

const total = (o?: Record<string, number>) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const sum = (rs: Row[], k: 'unsupported' | 'dropped' | 'errors' | 'warnings') =>
  rs.reduce<Record<string, number>>((acc, r) => {
    for (const [c, n] of Object.entries(r[k] ?? {})) acc[c] = (acc[c] ?? 0) + n;
    return acc;
  }, {});
const fmt = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(', ') || '—';
const finished = rows.filter((r) => r.stage === 'fatto');
const clean = finished.filter((r) => !total(r.errors));
const built = finished.filter((r) => r.buildOk);
const defaults = rows.filter((r) => r.isDefault);
const failures = rows.filter((r) => r.stage !== 'fatto');
const byStage = failures.reduce<Record<string, number>>((a, r) => ((a[r.stage] = (a[r.stage] ?? 0) + 1), a), {});
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

const md = `# Banco di prova esteso: tutte le versioni pubblicate

Generato da \`packages/toolkit/scripts/banco-esteso.ts\` il ${new Date().toLocaleDateString('it-IT')}, sulle versioni attive dell'inventario dell'API di docs.italia.it (\`inventario/docs-italia-api-snapshot.json\`): per ognuna un clone del tag o del branch, conversione in MyST, controllo, build HTML e pacchetto.

| | Versioni | di cui predefinite |
|---|---|---|
| Nell'inventario | ${rows.length} | ${defaults.length} |
| Convertite e controllate | ${finished.length} (${pct(finished.length, rows.length)}) | ${defaults.filter((r) => r.stage === 'fatto').length} |
| Build HTML e pacchetto riusciti | ${built.length} (${pct(built.length, rows.length)}) | ${defaults.filter((r) => r.buildOk).length} |
| Senza errori al controllo | ${clean.length} (${pct(clean.length, rows.length)}) | ${defaults.filter((r) => r.stage === 'fatto' && !total(r.errors)).length} |
| Non arrivate al controllo | ${failures.length}${failures.length ? ` (${fmt(byStage)})` : ''} | ${defaults.filter((r) => r.stage !== 'fatto').length} |

Documenti: ${new Set(rows.map((r) => r.document)).size}; pagine convertite: ${finished.reduce((a, r) => a + (r.pages ?? 0), 0)}.

**Costrutti non convertiti**: ${fmt(sum(rows, 'unsupported'))}

**Contenuto scartato**: ${fmt(sum(rows, 'dropped'))}

**Errori del controllo**: ${fmt(sum(rows, 'errors'))}

**Avvisi del controllo**: ${fmt(sum(rows, 'warnings'))}
${
  failures.length
    ? `
## Versioni non arrivate al controllo

| Documento | Versione | Ref | Fase | Motivo |
|---|---|---|---|---|
${failures.map((r) => `| ${r.document} | ${r.version} | \`${r.ref}\` (${r.type}) | ${r.stage} | ${(r.failure ?? '').replace(/\|/g, '\\|')} |`).join('\n')}
`
    : ''
}
## Per versione

La versione predefinita è in **grassetto**.

| Documento | Versione | Ref | Sorgente | Pagine | Errori | Avvisi | Build | Errori per tipo |
|---|---|---|---|---|---|---|---|---|
${rows
  .map((r) => {
    const v = r.isDefault ? `**${r.version}**` : r.version;
    const ref = `\`${r.ref}\` (${r.type})`;
    if (r.stage !== 'fatto') return `| ${r.document} | ${v} | ${ref} | ${r.source ? `\`${r.source}\`` : '—'} | — | — | — | — | ${r.stage}: ${(r.failure ?? '').replace(/\|/g, '\\|')} |`;
    return `| ${r.document} | ${v} | ${ref} | ${r.format === 'myst' ? 'MyST' : `\`${r.source}\``} | ${r.pages ?? '—'} | ${total(r.errors)} | ${total(r.warnings)} | ${r.buildOk ? 'sì' : 'no'} | ${fmt(r.errors ?? {})} |`;
  })
  .join('\n')}
`;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'banco-esteso.json'), JSON.stringify(rows, null, 2));
if (values.report) writeFileSync(values.report, md);
console.log(`\n${finished.length}/${rows.length} controllate, ${built.length} build riuscite, ${clean.length} senza errori. Rapporto: ${values.report ?? join(out, 'banco-esteso.json')}`);
