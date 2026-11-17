/**
 * Worker: esegue i lavori della coda.
 * - sync: rilegge italia-conf di un publisher;
 * - build: estrae la sorgente al ref, converte l'RST se serve, costruisce il
 *   pacchetto con il toolkit e lo pubblica.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { build, convert, findRstSource } from '@docs-italia/toolkit';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { claim, complete, fail } from './jobs.ts';
import { publishBundle, type BundleFiles } from './publish.ts';
import { syncPublisher } from './sync.ts';

export interface Ctx {
  sql: Db;
  config: Config;
}

function readDir(dir: string): BundleFiles {
  const files: BundleFiles = new Map();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else files.set(relative(dir, f).split(sep).join('/'), new Uint8Array(readFileSync(f)));
    }
  };
  walk(dir);
  return files;
}

export async function runBuild(ctx: Ctx, versionId: number): Promise<number> {
  const { sql, config } = ctx;
  const [v] = await sql`
    select v.id, v.ref, v.slug, d.id as document_id, d.repo_owner, d.repo_name, d.format
    from version v join document d on d.id = v.document_id where v.id = ${versionId}`;
  if (!v) throw new Error(`versione ${versionId} inesistente`);
  const [b] = await sql`insert into build (document_id, version_id, ref, status, started_at) values (${v.document_id}, ${v.id}, ${v.ref}, 'running', now()) returning id`;
  const log: string[] = [];
  const tmp = mkdtempSync(join(tmpdir(), 'docs-italia-build-'));
  try {
    const src = join(tmp, 'sorgente');
    mkdirSync(src);
    const { commit } = await config.forge.checkout(v.repo_owner, v.repo_name, v.ref, src);
    await sql`update build set commit = ${commit} where id = ${b.id}`;
    log.push(`sorgente: ${v.repo_owner}/${v.repo_name}@${v.ref} (${commit.slice(0, 12)})`);

    let docDir = src;
    if (v.format !== 'myst') {
      const rst = findRstSource(src);
      if (!rst) throw new Error('nessun index.rst nella sorgente');
      docDir = join(tmp, 'myst');
      const r = await convert(rst, docDir, { log: (m) => log.push(m) });
      log.push(`conversione RST → MyST: ${r.pages} pagine; non convertito: ${JSON.stringify(r.unsupported)}; scartato: ${JSON.stringify(r.dropped)}`);
    }
    const out = join(tmp, 'dist');
    const result = await build(docDir, {
      outDir: out,
      html: config.buildPdf,
      pdf: config.buildPdf,
      epub: true,
      zip: false,
      bundle: true,
      log: (m) => log.push(m),
    });
    const errors = result.problems.filter((p) => p.level === 'errore');
    log.push(`build: ${JSON.stringify(result.timings)}; ${errors.length} errori, ${result.problems.length - errors.length} avvisi`);
    await sql`update build set problems = ${result.problems as object[]}, log = ${log.join('\n')} where id = ${b.id}`;
    await publishBundle(sql, config.storage, { buildId: b.id, documentId: v.document_id, versionId: v.id, commit, files: readDir(join(out, 'bundle')) });
    return b.id;
  } catch (e) {
    log.push(`errore: ${(e as Error).message}`);
    await sql`update build set status = 'failed', error = ${(e as Error).message.slice(0, 4000)}, log = ${log.join('\n')}, finished_at = now() where id = ${b.id}`;
    throw e;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Esegue un lavoro della coda; restituisce false se non ce n'erano. */
export async function workOnce(ctx: Ctx): Promise<boolean> {
  const job = await claim(ctx.sql);
  if (!job) return false;
  try {
    if (job.kind === 'sync') await syncPublisher(ctx.sql, ctx.config.forge, job.payload.owner, { queueBuilds: job.payload.queueBuilds ?? true });
    else if (job.kind === 'build') await runBuild(ctx, job.payload.versionId);
    await complete(ctx.sql, job.id);
  } catch (e) {
    // una build che fallisce per il contenuto non si riprova: resta registrata come fallita
    if (job.kind === 'build') await complete(ctx.sql, job.id);
    else await fail(ctx.sql, job, (e as Error).message);
  }
  return true;
}

export function startWorker(ctx: Ctx, intervalMs = 2000): () => void {
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      const worked = await workOnce(ctx).catch((e) => {
        console.error('worker:', e);
        return false;
      });
      if (!worked) await Bun.sleep(intervalMs);
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
