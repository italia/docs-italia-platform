/**
 * API dell'istanza (Hono).
 *
 * Pubbliche: publisher, documenti, versioni, file dei pacchetti pubblicati, ricerca.
 * Amministrazione (token ADMIN_TOKEN, finché non c'è la dashboard): sync, build, coda.
 * Webhook GitHub (firma HMAC) e ricezione dei pacchetti dalle Actions (token OIDC).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { unzipSync } from 'fflate';
import { Hono, type Context } from 'hono';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { enqueue } from './jobs.ts';
import type { OidcVerifier } from './oidc.ts';
import { contentType, publishBundle, type BundleFiles } from './publish.ts';
import { search } from './search.ts';
import { seedFromSnapshot } from './seed.ts';

export interface AppDeps {
  sql: Db;
  config: Config;
  oidc: OidcVerifier;
}

const ALIASES: Record<string, 'default' | 'draft'> = { stabile: 'default', stable: 'default', bozza: 'draft', draft: 'draft' };

/** Versione predefinita: quella indicata, altrimenti l'ultima release pubblicata, altrimenti la bozza. */
async function defaultVersion(sql: Db, documentId: number, declared: string | null) {
  const rows = await sql`
    select id, slug, kind, published_build_id from version
    where document_id = ${documentId} and active and published_build_id is not null`;
  const pick =
    rows.find((v: any) => v.slug === declared) ??
    rows.filter((v: any) => v.kind === 'release').sort((a: any, b: any) => b.slug.localeCompare(a.slug, 'it', { numeric: true }))[0] ??
    rows.find((v: any) => v.kind !== 'release');
  return pick ?? null;
}

async function findDocument(sql: Db, pub: string, proj: string, doc: string) {
  const [d] = await sql`
    select d.*, pr.slug as project_slug, pr.name as project_name, p.slug as publisher_slug, p.name as publisher_name
    from document d join project pr on pr.id = d.project_id join publisher p on p.id = pr.publisher_id
    where p.slug = ${pub} and pr.slug = ${proj} and d.slug = ${doc} and d.active`;
  return d ?? null;
}

export function createApp({ sql, config, oidc }: AppDeps) {
  const app = new Hono();

  app.onError((err, c) => c.json({ error: err.message }, 500));

  // ------------------------------------------------------------------ pubbliche
  app.get('/api/health', async (c) => {
    await sql`select 1`;
    return c.json({ ok: true });
  });

  app.get('/api/publishers', async (c) =>
    c.json(
      await sql`
        select p.slug, p.name, p.short_name, p.description, p.logo_url, p.website,
          (select count(*)::int from document d join project pr on pr.id = d.project_id where pr.publisher_id = p.id and d.active) as documents
        from publisher p where p.active order by p.name`,
    ),
  );

  app.get('/api/publishers/:pub', async (c) => {
    const [p] = await sql`select id, slug, name, short_name, description, logo_url, website from publisher where slug = ${c.req.param('pub')} and active`;
    if (!p) return c.json({ error: 'publisher non trovato' }, 404);
    const projects = await sql`
      select pr.slug, pr.name, pr.description, pr.featured,
        coalesce(json_agg(json_build_object('slug', d.slug, 'name', d.name, 'description', d.description, 'tags', d.tags, 'repository', 'https://github.com/' || d.repo_owner || '/' || d.repo_name) order by d.name)
          filter (where d.id is not null and exists (select 1 from version v where v.document_id = d.id and v.active and v.published_build_id is not null)), '[]') as documents
      from project pr left join document d on d.project_id = pr.id and d.active
      where pr.publisher_id = ${p.id} and pr.active group by pr.id order by pr.sort`;
    const { id: _id, ...publisher } = p;
    return c.json({ ...publisher, projects });
  });

  app.get('/api/documents/:pub/:proj/:doc', async (c) => {
    const d = await findDocument(sql, c.req.param('pub'), c.req.param('proj'), c.req.param('doc'));
    if (!d) return c.json({ error: 'documento non trovato' }, 404);
    const versions = await sql`
      select v.slug, v.kind, v.ref, v.commit, b.id as build, b.finished_at as published_at
      from version v join build b on b.id = v.published_build_id
      where v.document_id = ${d.id} and v.active order by v.kind, v.slug`;
    const def = await defaultVersion(sql, d.id, d.default_version);
    return c.json({
      slug: d.slug,
      name: d.name,
      description: d.description,
      tags: d.tags,
      language: d.language,
      repository: `https://github.com/${d.repo_owner}/${d.repo_name}`,
      publisher: { slug: d.publisher_slug, name: d.publisher_name },
      project: { slug: d.project_slug, name: d.project_name },
      defaultVersion: def?.slug ?? null,
      // la predefinita scritta in document_settings o nell'inventario; null = ultima release
      declaredDefault: d.default_version ?? null,
      aliases: { stabile: def?.slug ?? null, bozza: versions.some((v: any) => v.slug === 'bozza') ? 'bozza' : null },
      versions,
    });
  });

  // file di un pacchetto pubblicato: toc.json, pages/<pagina>.json, assets/…, downloads/…
  app.get('/api/documents/:pub/:proj/:doc/:lang/:version/*', async (c) => {
    const d = await findDocument(sql, c.req.param('pub'), c.req.param('proj'), c.req.param('doc'));
    if (!d) return c.json({ error: 'documento non trovato' }, 404);
    const slug = c.req.param('version');
    const alias = ALIASES[slug];
    let v: any;
    if (alias === 'default') v = await defaultVersion(sql, d.id, d.default_version);
    else [v] = await sql`select id, slug, published_build_id from version where document_id = ${d.id} and slug = ${alias === 'draft' ? 'bozza' : slug} and active`;
    if (!v?.published_build_id) return c.json({ error: 'versione non pubblicata' }, 404);
    const [b] = await sql`select bundle_prefix from build where id = ${v.published_build_id}`;
    const path = c.req.path.split(`/${c.req.param('lang')}/${slug}/`)[1] ?? '';
    if (!path || path.includes('..')) return c.json({ error: 'percorso non valido' }, 400);
    const data = await config.storage.get(`${b.bundle_prefix}/${decodeURIComponent(path)}`);
    if (!data) return c.json({ error: 'file non trovato' }, 404);
    return new Response(data, { headers: { 'content-type': contentType(path), 'cache-control': 'public, max-age=300' } });
  });

  // dal nome del documento a publisher e progetto: serve ai vecchi URL dei download
  // (/projects/<documento>/downloads/<formato>/<versione>/)
  app.get('/api/lookup/:doc', async (c) => {
    const [d] = await sql`
      select p.slug as publisher, pr.slug as project, d.slug as document from document d
      join project pr on pr.id = d.project_id join publisher p on p.id = pr.publisher_id
      where d.slug = ${c.req.param('doc').toLowerCase()} and d.active`;
    return d ? c.json(d) : c.json({ error: 'documento non trovato' }, 404);
  });

  app.get('/api/search', async (c) =>
    c.json(await search(sql, c.req.query('q') ?? '', { publisher: c.req.query('publisher'), document: c.req.query('document'), limit: Number(c.req.query('limit') ?? 20) })),
  );

  // ------------------------------------------------------------------ amministrazione
  const admin = async (c: Context, next: () => Promise<void>) => {
    const token = c.req.header('authorization')?.replace(/^Bearer /, '');
    if (!config.adminToken || !token || token.length !== config.adminToken.length || !timingSafeEqual(Buffer.from(token), Buffer.from(config.adminToken))) {
      return c.json({ error: 'non autorizzato' }, 401);
    }
    await next();
  };

  app.post('/api/admin/sync/:owner', admin, async (c) => {
    const id = await enqueue(sql, 'sync', { owner: c.req.param('owner'), queueBuilds: c.req.query('build') !== '0' });
    await sql`insert into audit_log (actor, action, target) values ('admin-token', 'sync', ${c.req.param('owner')})`;
    return c.json({ job: id }, 202);
  });

  app.post('/api/admin/seed', admin, async (c) => {
    const r = await seedFromSnapshot(sql, await c.req.json(), { queueBuilds: c.req.query('build') !== '0' });
    await sql`insert into audit_log (actor, action, detail) values ('admin-token', 'seed', ${r as object})`;
    return c.json(r);
  });

  app.post('/api/admin/builds', admin, async (c) => {
    const { repository, version } = await c.req.json<{ repository: string; version?: string }>();
    const [owner, name] = repository.split('/');
    const [v] = await sql`select v.id from version v join document d on d.id = v.document_id
      where d.repo_owner = ${owner} and d.repo_name = ${name} and v.slug = ${version ?? 'bozza'}`;
    if (!v) return c.json({ error: 'versione non trovata' }, 404);
    return c.json({ job: await enqueue(sql, 'build', { versionId: v.id }) }, 202);
  });

  app.get('/api/admin/builds', admin, async (c) =>
    c.json(
      await sql`select b.id, d.repo_owner || '/' || d.repo_name as repository, v.slug as version, b.origin, b.status, b.commit, b.error,
          jsonb_array_length(b.problems) as problems, b.created_at, b.finished_at
        from build b join document d on d.id = b.document_id left join version v on v.id = b.version_id
        order by b.id desc limit ${Number(c.req.query('limit') ?? 50)}`,
    ),
  );

  app.get('/api/admin/jobs', admin, async (c) =>
    c.json(await sql`select id, kind, payload, status, attempts, last_error, created_at, finished_at from job order by id desc limit 50`),
  );

  // ------------------------------------------------------------------ webhook GitHub
  app.post('/api/webhooks/github', async (c) => {
    const body = await c.req.text();
    const sig = c.req.header('x-hub-signature-256') ?? '';
    const event = c.req.header('x-github-event') ?? '';
    const delivery = c.req.header('x-github-delivery') ?? null;
    if (!config.webhookSecret) return c.json({ error: 'webhook non configurati' }, 503);
    const expected = `sha256=${createHmac('sha256', config.webhookSecret).update(body).digest('hex')}`;
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return c.json({ error: 'firma non valida' }, 401);
    const payload = JSON.parse(body);
    const owner: string = payload.repository?.owner?.login ?? payload.organization?.login ?? '';
    const repo: string = payload.repository?.name ?? '';
    const record = (outcome: string, detail: object = {}) =>
      sql`insert into webhook_delivery (delivery_id, event, owner, repo, outcome, detail) values (${delivery}, ${event}, ${owner}, ${repo}, ${outcome}, ${detail})`;

    if (event === 'ping') return (await record('ping'), c.json({ ok: true }));
    const [pub] = await sql`select conf_repo from publisher where slug = ${owner} and active`;
    if (!pub) return (await record('publisher sconosciuto'), c.json({ ignored: 'publisher sconosciuto' }, 202));

    if (event === 'push' && repo === pub.conf_repo) {
      const job = await enqueue(sql, 'sync', { owner, queueBuilds: true });
      return (await record('sync', { job }), c.json({ job }, 202));
    }
    const [doc] = await sql`select id, draft_branch, settings from document where repo_owner = ${owner} and repo_name = ${repo} and active`;
    if (!doc) return (await record('documento sconosciuto'), c.json({ ignored: 'documento sconosciuto' }, 202));

    if (event === 'push' && typeof payload.ref === 'string') {
      const ref: string = payload.ref;
      if (payload.deleted) {
        if (ref.startsWith('refs/tags/')) await sql`update version set active = false where document_id = ${doc.id} and ref = ${ref.slice(10)} and kind = 'release'`;
        return (await record('ref cancellato', { ref }), c.json({ ok: true }));
      }
      let slug: string | null = null;
      let kind = 'draft';
      if (ref === `refs/heads/${doc.draft_branch}`) slug = 'bozza';
      else if (ref.startsWith('refs/tags/') && (doc.settings?.versions?.releases ?? 'tags') === 'tags') {
        slug = ref.slice(10);
        kind = 'release';
      }
      if (!slug) return (await record('ref non pubblicato', { ref }), c.json({ ignored: 'ref non pubblicato' }, 202));
      const [v] = await sql`
        insert into version (document_id, slug, kind, ref) values (${doc.id}, ${slug}, ${kind}, ${kind === 'draft' ? doc.draft_branch : slug})
        on conflict (document_id, slug) do update set active = case when exists (
          select 1 from version_override o where o.version_id = version.id and o.action = 'withdraw' and o.revoked_at is null) then false else true end
        returning id, active`;
      if (!v.active) return (await record('versione ritirata dalla dashboard', { slug }), c.json({ ignored: 'versione ritirata' }, 202));
      const job = await enqueue(sql, 'build', { versionId: v.id });
      return (await record('build', { slug, job }), c.json({ job }, 202));
    }
    if (event === 'pull_request') return (await record('anteprime non ancora disponibili'), c.json({ ignored: 'anteprime non ancora disponibili' }, 202));
    return (await record('evento ignorato'), c.json({ ignored: event }, 202));
  });

  // ------------------------------------------------------------------ pacchetti dalle Actions
  app.post('/api/bundles', async (c) => {
    const token = c.req.header('authorization')?.replace(/^Bearer /, '');
    if (!token) return c.json({ error: 'token OIDC mancante' }, 401);
    let claims;
    try {
      claims = await oidc(token);
    } catch (e) {
      return c.json({ error: `token OIDC non valido: ${(e as Error).message}` }, 401);
    }
    const [owner, repo] = claims.repository.split('/');
    // il repository deve essere elencato in italia-conf di un publisher attivo
    const [doc] = await sql`select d.id, d.draft_branch, d.settings from document d join project pr on pr.id = d.project_id
      join publisher p on p.id = pr.publisher_id and p.active where d.repo_owner = ${owner} and d.repo_name = ${repo} and d.active`;
    if (!doc) return c.json({ error: `${claims.repository} non è elencato in italia-conf` }, 403);
    let slug: string;
    let kind: string;
    if (claims.ref === `refs/heads/${doc.draft_branch}`) [slug, kind] = ['bozza', 'draft'];
    else if (claims.ref.startsWith('refs/tags/')) [slug, kind] = [claims.ref.slice(10), 'release'];
    else return c.json({ error: `il ref ${claims.ref} non si pubblica` }, 422);

    const zip = new Uint8Array(await c.req.arrayBuffer());
    let files: BundleFiles;
    try {
      files = new Map(Object.entries(unzipSync(zip)).filter(([p]) => !p.endsWith('/')));
    } catch {
      return c.json({ error: 'il corpo deve essere uno zip del pacchetto' }, 400);
    }
    const [v] = await sql`insert into version (document_id, slug, kind, ref) values (${doc.id}, ${slug}, ${kind}, ${kind === 'draft' ? doc.draft_branch : slug})
      on conflict (document_id, slug) do update set ref = excluded.ref returning id, active`;
    if (!v.active) return c.json({ error: 'versione ritirata dalla dashboard' }, 409);
    const [b] = await sql`insert into build (document_id, version_id, ref, commit, origin, status, started_at)
      values (${doc.id}, ${v.id}, ${claims.ref}, ${claims.sha}, 'action', 'running', now()) returning id`;
    try {
      await publishBundle(sql, config.storage, { buildId: b.id, documentId: doc.id, versionId: v.id, commit: claims.sha, files });
    } catch (e) {
      await sql`update build set status = 'failed', error = ${(e as Error).message}, finished_at = now() where id = ${b.id}`;
      return c.json({ error: (e as Error).message, build: b.id }, 422);
    }
    return c.json({ build: b.id, version: slug }, 201);
  });

  return app;
}
