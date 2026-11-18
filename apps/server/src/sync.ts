/**
 * Sincronizzazione di un publisher dal suo repository di configurazione
 * (italia-conf) e dai repository dei documenti (todo.md, 2.2 e 4.6).
 *
 * Regole riprese da readthedocs/docsitalia (create_projects_from_metadata):
 * - i progetti tolti da projects_settings.yml si disattivano;
 * - un documento elencato in un progetto si collega a quel progetto;
 * - i documenti non più elencati si disattivano.
 * Differenza voluta: i file si leggono dal branch predefinito, non da "master".
 */
import { parseDocumentSettings, parseProjectsSettings, parsePublisherSettings } from '@docs-italia/schema';
import type { Forge } from '@docs-italia/forge';
import type { Db } from './db.ts';
import { enqueue } from './jobs.ts';

export interface SyncResult {
  publisher: string;
  projects: number;
  documents: number;
  missing: string[];
  invalid: Array<{ repo: string; error: string }>;
  versionsQueued: number;
}

const DRAFT = 'bozza';

export async function syncPublisher(sql: Db, forge: Forge, owner: string, opts: { confRepo?: string; queueBuilds?: boolean } = {}): Promise<SyncResult> {
  const confRepo = opts.confRepo ?? 'italia-conf';
  const read = (f: string) => forge.readFile(owner, confRepo, f);
  const [pubText, projText] = await Promise.all([read('publisher_settings.yml'), read('projects_settings.yml')]);
  if (pubText === null || projText === null) throw new Error(`${owner}/${confRepo}: publisher_settings.yml o projects_settings.yml mancanti`);
  const pub = parsePublisherSettings(pubText);
  const proj = parseProjectsSettings(projText);
  if (!pub.ok || !proj.ok) {
    const msg = [...pub.problems, ...proj.problems].map((p) => `${p.file}: ${p.message}`).join('; ');
    await sql`update publisher set sync_error = ${msg} where slug = ${owner}`;
    throw new Error(msg);
  }
  const p = pub.value.publisher;
  const logo = p.logo ? `https://raw.githubusercontent.com/${owner}/${confRepo}/HEAD/${p.logo.replace(/^\//, '')}` : null;
  const [publisher] = await sql`
    insert into publisher (slug, name, short_name, description, website, logo_url, conf_repo, metadata, active, synced_at, sync_error)
    values (${owner}, ${p.name}, ${p.short_name ?? null}, ${p.description}, ${p.website ?? null}, ${logo}, ${confRepo}, ${pub.value as object}, true, now(), null)
    on conflict (slug) do update set name = excluded.name, short_name = excluded.short_name, description = excluded.description,
      website = excluded.website, logo_url = excluded.logo_url, conf_repo = excluded.conf_repo, metadata = excluded.metadata,
      active = true, synced_at = now(), sync_error = null
    returning id`;

  const result: SyncResult = { publisher: owner, projects: 0, documents: 0, missing: [], invalid: [], versionsQueued: 0 };
  const listed = new Set<string>();
  const projectSlugs: string[] = [];

  for (const [i, pr] of proj.value.projects.entries()) {
    projectSlugs.push(pr.slug);
    const [project] = await sql`
      insert into project (publisher_id, slug, name, description, metadata, active, sort)
      values (${publisher.id}, ${pr.slug}, ${pr.name}, ${pr.description}, ${pr as object}, true, ${i})
      on conflict (publisher_id, slug) do update set name = excluded.name, description = excluded.description,
        metadata = excluded.metadata, active = true, sort = excluded.sort
      returning id`;
    result.projects++;

    for (const repoName of pr.documents) {
      listed.add(repoName.toLowerCase());
      const info = await forge.repo(owner, repoName);
      if (!info) {
        result.missing.push(repoName);
        await upsertDocument(sql, { projectId: project.id, owner, repoName, active: false, error: 'repository non trovato' });
        continue;
      }
      const text = await forge.readFile(owner, repoName, 'document_settings.yml', info.defaultBranch);
      const ds = text === null ? null : parseDocumentSettings(text);
      if (!ds || !ds.ok) {
        const error = ds ? ds.problems.map((x) => x.message).join('; ') : 'document_settings.yml mancante';
        result.invalid.push({ repo: repoName, error });
        await upsertDocument(sql, { projectId: project.id, owner, repoName, active: false, error });
        continue;
      }
      const d = ds.value.document;
      const draftBranch = d.versions?.draft ?? info.defaultBranch;
      const doc = await upsertDocument(sql, {
        projectId: project.id,
        owner,
        repoName,
        active: true,
        name: d.name,
        description: d.description.trim(),
        tags: d.tags.map((t) => t.trim().toLowerCase()),
        // solo se dichiarata: altrimenti resta quella che c'è (per i documenti importati,
        // quella dell'inventario, che la piattaforma attuale teneva fuori dal repository)
        language: d.language ?? (/^\s+languages\s*:/m.test(text ?? "") ? d.languages[0] : undefined),
        format: d.format,
        settings: d as object,
        draftBranch,
      });
      result.documents++;
      // la bozza esiste sempre: segue il branch indicato o quello predefinito
      const [v] = await sql`
        insert into version (document_id, slug, kind, ref) values (${doc.id}, ${DRAFT}, 'draft', ${draftBranch})
        on conflict (document_id, slug) do update set ref = excluded.ref
        returning id, published_build_id`;
      if (opts.queueBuilds && !v.published_build_id) {
        await enqueue(sql, 'build', { versionId: v.id });
        result.versionsQueued++;
      }
    }
  }

  // progetti tolti dalla configurazione: disattivati
  await sql`update project set active = false where publisher_id = ${publisher.id} and not (slug = any(${projectSlugs}::text[]))`;
  // documenti di questo publisher non più elencati: disattivati e scollegati
  await sql`
    update document set active = false, project_id = null
    where repo_owner = ${owner} and not (lower(repo_name) = any(${[...listed]}::text[]))`;
  return result;
}

interface DocInput {
  projectId: number;
  owner: string;
  repoName: string;
  active: boolean;
  error?: string;
  name?: string;
  description?: string;
  tags?: string[];
  language?: string;
  format?: string;
  settings?: object;
  draftBranch?: string;
}

async function upsertDocument(sql: Db, d: DocInput): Promise<{ id: number }> {
  const [row] = await sql`
    insert into document (project_id, slug, repo_owner, repo_name, name, description, tags, language, format, settings, draft_branch, active, sync_error)
    values (${d.projectId}, ${d.repoName.toLowerCase()}, ${d.owner}, ${d.repoName}, ${d.name ?? d.repoName}, ${d.description ?? ''},
      ${d.tags ?? []}::text[], ${d.language ?? 'it'}, ${d.format ?? 'rst'}, ${d.settings ?? {}}, ${d.draftBranch ?? null}, ${d.active}, ${d.error ?? null})
    on conflict (repo_owner, repo_name) do update set project_id = excluded.project_id, active = excluded.active, sync_error = excluded.sync_error,
      name = case when excluded.sync_error is null then excluded.name else document.name end,
      description = case when excluded.sync_error is null then excluded.description else document.description end,
      tags = case when excluded.sync_error is null then excluded.tags else document.tags end,
      language = case when excluded.sync_error is null and ${d.language ?? null}::text is not null then excluded.language else document.language end,
      format = case when excluded.sync_error is null then excluded.format else document.format end,
      settings = case when excluded.sync_error is null then excluded.settings else document.settings end,
      draft_branch = coalesce(excluded.draft_branch, document.draft_branch)
    returning id`;
  return row;
}
