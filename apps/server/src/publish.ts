/**
 * Pubblicazione di un pacchetto (todo.md, 4.6), comune al worker e alla
 * ricezione dalle GitHub Actions:
 * 1. verifica del manifest (schema, hash di ogni file);
 * 2. file nello storage sotto un prefisso immutabile;
 * 3. indice di ricerca della versione;
 * 4. il puntatore della versione passa alla nuova build.
 */
import { createHash } from 'node:crypto';
import { BUNDLE_SCHEMA_VERSION, type Manifest, type SearchRecord } from '@docs-italia/schema';
import type { Db } from './db.ts';
import type { Storage } from './storage.ts';

export type BundleFiles = Map<string, Uint8Array>;

const TYPES: Record<string, string> = {
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};
export const contentType = (path: string) => TYPES[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

/** Verifica il pacchetto: errori in italiano, lista vuota se va bene. */
export function verifyBundle(files: BundleFiles): { manifest?: Manifest; errors: string[] } {
  const raw = files.get('manifest.json');
  if (!raw) return { errors: ['manifest.json mancante'] };
  let manifest: Manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { errors: ['manifest.json non è JSON valido'] };
  }
  const errors: string[] = [];
  if (manifest.schema !== BUNDLE_SCHEMA_VERSION) errors.push(`schema del pacchetto non supportato: ${manifest.schema}`);
  const listed = new Set<string>();
  for (const f of manifest.files ?? []) {
    listed.add(f.path);
    const data = files.get(f.path);
    if (!data) errors.push(`file mancante: ${f.path}`);
    else if (createHash('sha256').update(data).digest('hex') !== f.sha256) errors.push(`hash non corrispondente: ${f.path}`);
  }
  for (const p of files.keys()) if (p !== 'manifest.json' && !listed.has(p)) errors.push(`file non elencato nel manifest: ${p}`);
  for (const p of files.keys()) if (p.includes('..') || p.startsWith('/')) errors.push(`percorso non valido: ${p}`);
  return { manifest, errors };
}

export async function publishBundle(
  sql: Db,
  storage: Storage,
  opts: { buildId: number; documentId: number; versionId: number; commit?: string; files: BundleFiles },
): Promise<void> {
  const { manifest, errors } = verifyBundle(opts.files);
  if (errors.length || !manifest) throw new Error(`pacchetto non valido: ${errors.join('; ')}`);
  const prefix = `bundles/${opts.documentId}/${opts.buildId}`;
  for (const [path, data] of opts.files) await storage.put(`${prefix}/${path}`, data, contentType(path));

  const search = opts.files.get('search.jsonl');
  const records: SearchRecord[] = search
    ? new TextDecoder()
        .decode(search)
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  await sql.begin(async (tx) => {
    await tx`delete from search_section where version_id = ${opts.versionId}`;
    for (const r of records) {
      await tx`insert into search_section (build_id, document_id, version_id, page, anchor, title, path, body)
        values (${opts.buildId}, ${opts.documentId}, ${opts.versionId}, ${r.page}, ${r.anchor}, ${r.title}, ${r.path}::text[], ${r.text})`;
    }
    await tx`update build set status = 'ok', bundle_prefix = ${prefix}, manifest = ${manifest as object}, finished_at = now() where id = ${opts.buildId}`;
    await tx`update version set published_build_id = ${opts.buildId}, commit = coalesce(${opts.commit ?? null}, commit) where id = ${opts.versionId}`;
  });
}
