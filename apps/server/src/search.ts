/**
 * Ricerca del sito: full-text di PostgreSQL in italiano sulle sezioni delle
 * build pubblicate (todo.md, 6.4). Per impostazione predefinita solo la
 * versione predefinita di ogni documento.
 */
import type { Db } from './db.ts';

export interface SearchHit {
  publisher: string;
  project: string | null;
  document: string;
  version: string;
  page: string;
  anchor: string;
  title: string;
  path: string[];
  snippet: string;
  rank: number;
}

export async function search(sql: Db, q: string, opts: { publisher?: string; document?: string; limit?: number } = {}): Promise<SearchHit[]> {
  // apostrofi e virgolette tipografici come quelli dritti: chi cerca scrive "dell'Interno"
  const query = q.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
  if (!query) return [];
  return sql`
    select p.slug as publisher, pr.slug as project, d.slug as document, v.slug as version,
      s.page, s.anchor, s.title, s.path,
      ts_headline('italian', s.body, websearch_to_tsquery('italian', ${query}), 'MaxFragments=2, MinWords=8, MaxWords=24, StartSel=<mark>, StopSel=</mark>') as snippet,
      ts_rank(s.tsv, websearch_to_tsquery('italian', ${query})) as rank
    from search_section s
    join version v on v.id = s.version_id and v.active and v.published_build_id = s.build_id
    join document d on d.id = s.document_id and d.active
    left join project pr on pr.id = d.project_id
    join publisher p on p.slug = d.repo_owner
    where s.tsv @@ websearch_to_tsquery('italian', ${query})
      and (${opts.publisher ?? null}::text is null or p.slug = ${opts.publisher ?? null})
      and (${opts.document ?? null}::text is null or d.slug = ${opts.document ?? null})
      and v.slug = coalesce(d.default_version, (
        select v2.slug from version v2 where v2.document_id = d.id and v2.active and v2.published_build_id is not null
        order by (v2.kind = 'release') desc, v2.created_at desc limit 1))
    order by rank desc
    limit ${Math.min(opts.limit ?? 20, 100)}`;
}
