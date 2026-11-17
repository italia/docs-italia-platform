/**
 * Stato dei collegamenti dell'istanza (dashboard, todo.md 6.6): database,
 * archivio dei file, coda e worker, GitHub, webhook, italia-conf, conversione
 * RST. Ogni gruppo ha un tempo massimo: un servizio lento non blocca gli altri.
 * Nessun controllo restituisce segreti.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { Check } from '@docs-italia/forge';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { FsStorage, S3Storage } from './storage.ts';

const run = promisify(execFile);
const TIMEOUT_MS = 15_000;

export interface ChecksResult {
  at: string;
  checks: Check[];
}

function within<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`nessuna risposta in ${ms / 1000} secondi`)), ms))]);
}

const ago = (d: Date | string | null) => {
  if (!d) return 'mai';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return `${s} secondi fa`;
  if (s < 5400) return `${Math.round(s / 60)} minuti fa`;
  if (s < 129_600) return `${Math.round(s / 3600)} ore fa`;
  return `${Math.round(s / 86_400)} giorni fa`;
};

async function database(sql: Db): Promise<Check[]> {
  const group = 'Database';
  const [{ version, db }] = await sql`select current_setting('server_version') as version, current_database() as db`;
  const ext = await sql`
    select a.name, e.extversion as installed from pg_available_extensions a left join pg_extension e on e.extname = a.name
    where a.name in ('pg_trgm', 'vector')`;
  const find = (n: string) => ext.find((e: any) => e.name === n);
  const trgm = find('pg_trgm');
  const vector = find('vector');
  return [
    { group, name: 'PostgreSQL', status: 'ok', detail: `versione ${version}, database ${db}` },
    { group, name: 'Estensione pg_trgm', status: trgm?.installed ? 'ok' : 'errore', detail: trgm?.installed ? `attiva (${trgm.installed})` : 'non attiva: serve alla ricerca' },
    {
      group,
      name: 'Estensione pgvector',
      status: vector?.installed ? 'ok' : 'avviso',
      detail: vector?.installed ? `attiva (${vector.installed})` : vector ? 'disponibile, non ancora attivata: servirà alla ricerca semantica (fase 6)' : 'non installata sul server: servirà alla ricerca semantica (fase 6)',
    },
  ];
}

async function queue(sql: Db, config: Config): Promise<Check[]> {
  const group = 'Coda e worker';
  const [q] = await sql`
    select
      count(*) filter (where status = 'queued') as queued,
      min(created_at) filter (where status = 'queued') as oldest,
      count(*) filter (where status = 'running') as running,
      count(*) filter (where status = 'running' and locked_at < now() - interval '30 minutes') as stuck,
      count(*) filter (where status = 'failed') as failed,
      max(finished_at) as last
    from job`;
  const waiting = q.oldest ? (Date.now() - new Date(q.oldest).getTime()) / 60_000 : 0;
  const checks: Check[] = [
    {
      group,
      name: 'Coda dei lavori',
      status: Number(q.stuck) ? 'errore' : waiting > 10 ? 'avviso' : 'ok',
      detail: `${q.queued} in attesa${q.oldest ? ` (il più vecchio ${ago(q.oldest)})` : ''}, ${q.running} in corso${Number(q.stuck) ? `, ${q.stuck} bloccati da più di 30 minuti` : ''}`,
    },
    { group, name: 'Lavori falliti', status: Number(q.failed) ? 'avviso' : 'ok', detail: Number(q.failed) ? `${q.failed} falliti dopo tutti i tentativi: si possono rilanciare dalla coda` : 'nessuno' },
    {
      group,
      name: 'Worker',
      status: config.worker ? 'ok' : 'non configurato',
      detail: config.worker ? `attivo in questo processo; ultimo lavoro concluso ${ago(q.last)}` : 'WORKER=0: i lavori restano in coda per un altro processo',
    },
  ];
  if (config.buildPdf) {
    const chrome = process.env.DOCS_ITALIA_CHROME;
    checks.push({
      group,
      name: 'Chromium per i PDF',
      status: !chrome || existsSync(chrome) ? 'ok' : 'errore',
      detail: chrome ? (existsSync(chrome) ? chrome : `${chrome} non esiste`) : 'Chrome installato nel sistema (DOCS_ITALIA_CHROME non impostato)',
    });
  } else checks.push({ group, name: 'PDF', status: 'non configurato', detail: 'BUILD_PDF=0: le build producono solo il pacchetto e l\'EPUB' });
  const python = process.env.DOCS_ITALIA_PYTHON ?? 'python3';
  try {
    const { stdout } = await run(python, ['-c', 'import sphinx, docs_italia_sphinx; print(sphinx.__version__)'], { timeout: 10_000 });
    checks.push({ group, name: 'Conversione RST', status: 'ok', detail: `Sphinx ${stdout.trim()} con docs_italia_sphinx` });
  } catch {
    checks.push({ group, name: 'Conversione RST', status: 'errore', detail: `${python}: Sphinx o docs_italia_sphinx non disponibili; i documenti RST non si costruiscono (DOCS_ITALIA_PYTHON)` });
  }
  return checks;
}

async function storage(config: Config): Promise<Check[]> {
  const group = 'Archivio dei file';
  const s = config.storage;
  const kind = s instanceof S3Storage ? 'object storage S3' : s instanceof FsStorage ? 'file system' : 'archivio';
  const key = `controlli/${randomUUID()}.txt`;
  const text = `controllo ${new Date().toISOString()}`;
  await s.put(key, text, 'text/plain');
  const back = await s.get(key);
  await s.remove(key);
  const ok = back !== null && new TextDecoder().decode(back) === text;
  return [{ group, name: 'Lettura e scrittura', status: ok ? 'ok' : 'errore', detail: ok ? `${kind}: file di prova scritto, riletto e cancellato` : `${kind}: il file di prova riletto non corrisponde` }];
}

async function repositories(sql: Db, config: Config, owners: string[]): Promise<Check[]> {
  const checks = await config.forge.status(owners);
  const group = 'italia-conf';
  const pubs = await sql`select slug, conf_repo, synced_at, sync_error from publisher where active order by slug`;
  for (const p of pubs) {
    if (p.sync_error) {
      checks.push({ group, name: `${p.slug}/${p.conf_repo}`, status: 'errore', detail: `ultima sincronizzazione fallita: ${p.sync_error}` });
      continue;
    }
    const text = await config.forge.readFile(p.slug, p.conf_repo, 'projects_settings.yml').catch((e) => e as Error);
    checks.push({
      group,
      name: `${p.slug}/${p.conf_repo}`,
      status: typeof text === 'string' ? 'ok' : 'errore',
      detail: typeof text === 'string' ? `leggibile; ultima sincronizzazione ${ago(p.synced_at)}` : text instanceof Error ? text.message : 'projects_settings.yml non trovato',
    });
  }
  return checks;
}

async function webhooks(sql: Db, config: Config, owners: string[]): Promise<Check[]> {
  const group = 'Webhook';
  if (!config.webhookSecret) {
    return [{ group, name: 'Segreto dei webhook', status: 'non configurato', detail: 'GITHUB_WEBHOOK_SECRET non impostato: gli aggiornamenti arrivano solo con la sincronizzazione' }];
  }
  const rows = await sql`select owner, max(at) as last from webhook_delivery where owner = any(${owners}::text[]) group by owner`;
  return [
    { group, name: 'Segreto dei webhook', status: 'ok', detail: 'impostato' },
    ...owners.map((o): Check => {
      const last = rows.find((r: any) => r.owner === o)?.last ?? null;
      return { group, name: `Consegne da ${o}`, status: last ? 'ok' : 'avviso', detail: last ? `ultima ${ago(last)}` : 'nessuna consegna ricevuta' };
    }),
  ];
}

function later(group: string, name: string, detail: string): Check {
  return { group, name, status: 'non configurato', detail };
}

export async function runChecks(sql: Db, config: Config): Promise<ChecksResult> {
  const pubs = await sql`select slug from publisher where active`;
  const owners = [...new Set([...pubs.map((p: any) => p.slug as string), ...config.organizations])].sort();
  const groups: Array<[string, () => Promise<Check[]>]> = [
    ['Database', () => database(sql)],
    ['Archivio dei file', () => storage(config)],
    ['Coda e worker', () => queue(sql, config)],
    ['Repository', () => repositories(sql, config, owners)],
    ['Webhook', () => webhooks(sql, config, owners)],
  ];
  const results = await Promise.all(
    groups.map(([group, f]) => within(f()).catch((e): Check[] => [{ group, name: 'Controllo', status: 'errore', detail: (e as Error).message }])),
  );
  const checks = results.flat();
  checks.push(
    later('Email', 'SMTP', 'non ancora usato: arriverà con l\'accesso tramite magic link'),
    later('Ricerca semantica', 'Servizio di embedding', 'fase 6'),
    later('Server MCP', 'Ricerca di prova', 'fase 6'),
  );
  return { at: new Date().toISOString(), checks };
}
