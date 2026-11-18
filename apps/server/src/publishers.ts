/**
 * Aggiunta di un'organizzazione (publisher) dalla dashboard (todo.md, 6.6).
 *
 * Prima di aggiungerla si verifica che l'istanza la raggiunga: accesso a
 * GitHub (installazione della GitHub App, o token), repository italia-conf con
 * publisher_settings.yml e projects_settings.yml validi, repository dei
 * documenti elencati. Solo un italia-conf valido blocca l'aggiunta: i documenti
 * mancanti si segnalano, come fa la sincronizzazione.
 *
 * L'aggiunta vera e propria è una sincronizzazione accodata, come quella del
 * pulsante "Sincronizza": dopo, i webhook tengono l'organizzazione aggiornata.
 */
import type { Check, Forge } from '@docs-italia/forge';
import { parseProjectsSettings, parsePublisherSettings } from '@docs-italia/schema';
import type { Db } from './db.ts';

/** Nome di un account GitHub: lettere, cifre e trattini, al massimo 39 caratteri. */
export const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export interface PublisherCheck {
  owner: string;
  /** si può aggiungere: italia-conf trovato e valido */
  ok: boolean;
  /** publisher già presente (stesso nome, anche con maiuscole diverse) */
  existing: { slug: string; active: boolean } | null;
  access: Check[];
  conf: { repo: string; found: boolean; url?: string; problems: string[] };
  publisher?: { name: string; description: string; website?: string };
  projects: Array<{ name: string; slug: string; documents: Array<{ repo: string; found: boolean; archived?: boolean; settings?: boolean }> }>;
  summary: { projects: number; documents: number; found: number; missing: number };
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function checkPublisher(sql: Db, forge: Forge, owner: string, confRepo = 'italia-conf'): Promise<PublisherCheck> {
  const [existing] = await sql`select slug, active from publisher where lower(slug) = lower(${owner})`;
  const result: PublisherCheck = {
    owner,
    ok: false,
    existing: existing ? { slug: existing.slug, active: existing.active } : null,
    access: [],
    conf: { repo: confRepo, found: false, problems: [] },
    projects: [],
    summary: { projects: 0, documents: 0, found: 0, missing: 0 },
  };

  try {
    result.access = await forge.status([owner]);
  } catch (e) {
    result.access = [{ group: 'Repository', name: 'Accesso', status: 'errore', detail: (e as Error).message }];
  }

  let conf;
  try {
    conf = await forge.repo(owner, confRepo);
  } catch (e) {
    result.conf.problems.push(`${owner}/${confRepo} non leggibile: ${(e as Error).message}`);
    return result;
  }
  if (!conf) {
    result.conf.problems.push(
      forge.kind === 'github'
        ? `${owner}/${confRepo} non trovato: non esiste, oppure l'istanza non lo vede (GitHub App non installata sull'organizzazione, o token senza accesso)`
        : `${owner}/${confRepo} non trovato tra i repository locali`,
    );
    return result;
  }
  result.conf.found = true;
  result.conf.url = conf.url;

  const [pubText, projText] = await Promise.all([
    forge.readFile(owner, confRepo, 'publisher_settings.yml'),
    forge.readFile(owner, confRepo, 'projects_settings.yml'),
  ]);
  if (pubText === null) result.conf.problems.push('publisher_settings.yml mancante');
  if (projText === null) result.conf.problems.push('projects_settings.yml mancante');
  if (pubText === null || projText === null) return result;
  const pub = parsePublisherSettings(pubText);
  const proj = parseProjectsSettings(projText);
  for (const p of [...pub.problems, ...proj.problems]) result.conf.problems.push(`${p.file}: ${p.message}`);
  if (!pub.ok || !proj.ok) return result;

  const p = pub.value.publisher;
  result.publisher = { name: p.name, description: p.description.trim(), website: p.website };
  result.projects = await inBatches(proj.value.projects, 2, async (pr) => ({
    name: pr.name,
    slug: pr.slug,
    documents: await inBatches(pr.documents, 8, async (repo) => {
      const info = await forge.repo(owner, repo).catch(() => null);
      if (!info) return { repo, found: false };
      const settings = await forge.readFile(owner, repo, 'document_settings.yml', info.defaultBranch).catch(() => null);
      return { repo, found: true, archived: info.archived, settings: settings !== null };
    }),
  }));
  const docs = result.projects.flatMap((x) => x.documents);
  result.summary = { projects: result.projects.length, documents: docs.length, found: docs.filter((d) => d.found).length, missing: docs.filter((d) => !d.found).length };
  result.ok = true;
  return result;
}
