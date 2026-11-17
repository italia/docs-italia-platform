/**
 * Prima importazione delle versioni dall'inventario del sito attuale
 * (inventario/docs-italia-api-snapshot.json, todo.md 2.2).
 *
 * Gli slug restano quelli di oggi (bozza, versione-corrente, 1.2.0…) perché
 * gli URL non cambino. "stabile" non è una versione a sé: è un alias della
 * versione predefinita, risolto dall'API.
 */
import { parseRepoUrl } from '@docs-italia/forge';
import type { Db } from './db.ts';
import { enqueue } from './jobs.ts';

interface SnapshotDoc {
  slug: string;
  repo: string;
  default_version: string;
  active_versions: Array<{ slug: string; identifier: string; type: 'branch' | 'tag' }>;
}

export interface SeedResult {
  documents: number;
  versions: number;
  notFound: string[];
  queued: number;
}

export async function seedFromSnapshot(sql: Db, snapshot: SnapshotDoc[], opts: { queueBuilds?: boolean } = {}): Promise<SeedResult> {
  const r: SeedResult = { documents: 0, versions: 0, notFound: [], queued: 0 };
  for (const s of snapshot) {
    const repo = parseRepoUrl(s.repo);
    if (!repo) continue;
    const [doc] = await sql`select id from document where lower(repo_owner) = lower(${repo.owner}) and lower(repo_name) = lower(${repo.name})`;
    if (!doc) {
      r.notFound.push(`${repo.owner}/${repo.name}`);
      continue;
    }
    r.documents++;
    for (const v of s.active_versions) {
      if (v.slug === 'stabile' || v.slug === 'stable') continue;
      const kind = v.slug === 'bozza' || v.slug === 'draft' ? 'draft' : v.type === 'tag' ? 'release' : 'branch';
      // per i tag l'API dà il commit: il ref è il nome del tag (lo slug)
      const ref = v.type === 'branch' ? v.identifier.replace(/^origin\//, '') : v.slug;
      const [row] = await sql`
        insert into version (document_id, slug, kind, ref, commit, active)
        values (${doc.id}, ${v.slug}, ${kind}, ${ref}, ${v.type === 'tag' ? v.identifier : null}, true)
        on conflict (document_id, slug) do update set kind = excluded.kind, ref = excluded.ref, active = true
        returning id, published_build_id`;
      r.versions++;
      if (opts.queueBuilds && !row.published_build_id) {
        await enqueue(sql, 'build', { versionId: row.id });
        r.queued++;
      }
    }
    // "stabile" come predefinita: vale la regola del repository (ultima release)
    const def = s.default_version === 'stabile' || s.default_version === 'stable' ? null : s.default_version;
    await sql`update document set default_version = ${def} where id = ${doc.id}`;
  }
  return r;
}
