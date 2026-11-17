/**
 * API di amministrazione: dashboard (todo.md, 6.6) e script.
 *
 * Accesso: con DASHBOARD_OPEN=1 (solo su indirizzo locale, finché non c'è il
 * magic link) è aperta; altrimenti serve "Authorization: Bearer <ADMIN_TOKEN>".
 *
 * Gli interventi sulle versioni sono operazioni sul database, mai scritture nei
 * repository: si registrano in version_override, prevalgono sugli eventi del
 * repository finché non vengono revocati e finiscono in audit_log con la
 * motivazione.
 */
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { runChecks, type ChecksResult } from './checks.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { enqueue } from './jobs.ts';
import { seedFromSnapshot } from './seed.ts';

type Env = { Variables: { actor: string } };

export const OPEN_ACTOR = 'dashboard (accesso aperto)';
const ACTIONS = ['withdraw', 'restore', 'promote', 'unpromote'] as const;
type Action = (typeof ACTIONS)[number];

/** Numero di problemi di livello "errore" in una colonna problems (jsonb). */
const errorsOf = (col: string) => `coalesce((select count(*) from jsonb_array_elements(${col}) e where e->>'level' = 'errore'), 0)::int`;

export function adminApi({ sql, config }: { sql: Db; config: Config }) {
  const app = new Hono<Env>();
  let lastChecks: ChecksResult | null = null;

  app.use('*', async (c, next) => {
    if (config.dashboardOpen) {
      c.set('actor', OPEN_ACTOR);
      return next();
    }
    const token = c.req.header('authorization')?.replace(/^Bearer /, '');
    if (!config.adminToken || !token || token.length !== config.adminToken.length || !timingSafeEqual(Buffer.from(token), Buffer.from(config.adminToken))) {
      return c.json({ error: 'non autorizzato' }, 401);
    }
    c.set('actor', 'admin-token');
    return next();
  });

  const audit = (actor: string, action: string, target: string | null, detail: object = {}) =>
    sql`insert into audit_log (actor, action, target, detail) values (${actor}, ${action}, ${target}, ${detail})`;

  app.get('/whoami', (c) => c.json({ actor: c.get('actor'), open: !!config.dashboardOpen, siteUrl: config.siteUrl, forge: config.forge.kind }));

  // ------------------------------------------------------------------ visione d'insieme
  app.get('/overview', async (c) => {
    const [counts] = await sql`
      select
        (select count(*) from publisher where active)::int as publishers,
        (select count(*) from project where active)::int as projects,
        (select count(*) from document where active)::int as documents,
        (select count(*) from version where active and published_build_id is not null)::int as versions,
        (select count(*) from job where status = 'queued')::int as queued,
        (select count(*) from job where status = 'running')::int as running,
        (select count(*) from job where status = 'failed')::int as failed_jobs,
        -- solo documenti e versioni attivi: le build dei repository non importati non contano
        (select count(*) from build b join version v on v.id = b.version_id and v.active join document d on d.id = b.document_id and d.active
          where b.status = 'failed' and b.created_at > now() - interval '7 days')::int as failed_builds_week`;
    // versioni la cui ultima build è fallita
    const failing = await sql`
      select * from (
        select distinct on (b.version_id) b.id as build, b.status, b.error, b.created_at, d.id as document_id, d.repo_owner, d.repo_name, d.name,
          v.slug as version, v.published_build_id is not null as published
        from build b join version v on v.id = b.version_id and v.active join document d on d.id = b.document_id and d.active
        order by b.version_id, b.id desc
      ) last where status = 'failed' order by created_at desc limit 50`;
    const publishers = await sql`select slug, name, sync_error, synced_at from publisher where active and sync_error is not null order by slug`;
    const documents = await sql`
      select d.id, d.repo_owner, d.repo_name, d.name, d.sync_error, d.active from document d
      where d.sync_error is not null and d.project_id is not null order by d.repo_owner, d.repo_name`;
    const withErrors = await sql.unsafe(`
      select d.id, d.repo_owner, d.repo_name, d.name, v.slug as version, ${errorsOf('b.problems')} as errors
      from document d join version v on v.id = default_version_id(d.id) join build b on b.id = v.published_build_id
      where d.active and ${errorsOf('b.problems')} > 0 order by errors desc limit 50`);
    const overrides = await sql`
      select o.id, o.action, o.reason, o.actor, o.created_at, v.id as version_id, v.slug as version, d.id as document_id, d.repo_owner, d.repo_name
      from version_override o join version v on v.id = o.version_id join document d on d.id = v.document_id
      where o.revoked_at is null order by o.created_at desc`;
    return c.json({ counts, attention: { failing, publishers, documents, withErrors }, overrides, checks: lastChecks });
  });

  app.get('/publishers', async (c) =>
    c.json(
      await sql`
        select p.slug, p.name, p.conf_repo, p.active, p.synced_at, p.sync_error,
          (select count(*) from project pr where pr.publisher_id = p.id and pr.active)::int as projects,
          (select count(*) from document d where d.repo_owner = p.slug and d.active)::int as documents,
          (select count(*) from document d where d.repo_owner = p.slug and d.sync_error is not null and d.project_id is not null)::int as document_errors,
          (select max(at) from webhook_delivery w where w.owner = p.slug) as last_webhook
        from publisher p order by p.active desc, p.slug`,
    ),
  );

  app.post('/sync/:owner', async (c) => {
    const owner = c.req.param('owner');
    const id = await enqueue(sql, 'sync', { owner, queueBuilds: c.req.query('build') !== '0' });
    await audit(c.get('actor'), 'sync', owner, { job: id });
    return c.json({ job: id }, 202);
  });

  app.post('/seed', async (c) => {
    const r = await seedFromSnapshot(sql, await c.req.json(), { queueBuilds: c.req.query('build') !== '0' });
    await audit(c.get('actor'), 'seed', null, r as object);
    return c.json(r);
  });

  // ------------------------------------------------------------------ documenti
  app.get('/documents', async (c) =>
    c.json(
      await sql.unsafe(`
        select d.id, d.slug, d.name, d.repo_owner, d.repo_name, d.format, d.language, d.active, d.sync_error,
          pr.slug as project, pr.name as project_name, dv.slug as default_version,
          (select count(*) from version v where v.document_id = d.id and v.active and v.published_build_id is not null)::int as versions,
          lb.id as last_build, lb.status as last_status, lb.created_at as last_at,
          ${errorsOf('db.problems')} as errors,
          exists (select 1 from version_override o join version v on v.id = o.version_id where v.document_id = d.id and o.revoked_at is null) as overridden
        from document d
        left join project pr on pr.id = d.project_id
        left join version dv on dv.id = default_version_id(d.id)
        left join build db on db.id = dv.published_build_id
        left join lateral (select id, status, created_at from build where document_id = d.id order by id desc limit 1) lb on true
        where d.project_id is not null or d.active
        order by d.repo_owner, pr.sort, d.name`),
    ),
  );

  app.get('/documents/:id{[0-9]+}', async (c) => {
    const id = Number(c.req.param('id'));
    const [d] = await sql`
      select d.*, pr.slug as project, pr.name as project_name, p.name as publisher_name,
        (select v.id from version v where v.id = default_version_id(d.id)) as default_version_id
      from document d left join project pr on pr.id = d.project_id left join publisher p on p.slug = d.repo_owner
      where d.id = ${id}`;
    if (!d) return c.json({ error: 'documento non trovato' }, 404);
    const versions = await sql.unsafe(
      `select v.id, v.slug, v.kind, v.ref, v.commit, v.active, v.created_at, v.published_build_id,
        pb.finished_at as published_at, ${errorsOf('pb.problems')} as errors, jsonb_array_length(coalesce(pb.problems, '[]')) as problems,
        lb.id as last_build, lb.status as last_status, lb.created_at as last_at,
        coalesce((select json_agg(json_build_object('id', o.id, 'action', o.action, 'reason', o.reason, 'actor', o.actor, 'created_at', o.created_at) order by o.id)
          from version_override o where o.version_id = v.id and o.revoked_at is null), '[]') as overrides
      from version v
      left join build pb on pb.id = v.published_build_id
      left join lateral (select id, status, created_at from build where version_id = v.id order by id desc limit 1) lb on true
      where v.document_id = $1
      order by v.active desc, (v.kind = 'draft') desc, v.kind, v.slug collate numerico desc`,
      [id],
    );
    const builds = await sql`
      select b.id, v.slug as version, b.origin, b.status, b.commit, b.error, b.created_at, b.finished_at,
        jsonb_array_length(b.problems)::int as problems
      from build b left join version v on v.id = b.version_id where b.document_id = ${id} order by b.id desc limit 30`;
    const { settings, ...doc } = d;
    return c.json({ ...doc, settings, versions, builds });
  });

  // ------------------------------------------------------------------ versioni: build e interventi
  app.post('/versions/:id{[0-9]+}/build', async (c) => {
    const [v] = await sql`select v.id, v.slug, d.repo_owner, d.repo_name from version v join document d on d.id = v.document_id where v.id = ${Number(c.req.param('id'))}`;
    if (!v) return c.json({ error: 'versione non trovata' }, 404);
    const job = await enqueue(sql, 'build', { versionId: v.id });
    await audit(c.get('actor'), 'build', `${v.repo_owner}/${v.repo_name}@${v.slug}`, { job });
    return c.json({ job }, 202);
  });

  app.post('/versions/:id{[0-9]+}/:action', async (c) => {
    const action = c.req.param('action') as Action;
    if (!ACTIONS.includes(action)) return c.json({ error: `azione sconosciuta: ${action}` }, 404);
    const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
    const reason = body.reason?.trim();
    if (!reason) return c.json({ error: 'la motivazione è obbligatoria' }, 400);
    const actor = c.get('actor');
    const [v] = await sql`
      select v.id, v.slug, v.active, v.published_build_id, v.document_id, d.repo_owner, d.repo_name
      from version v join document d on d.id = v.document_id where v.id = ${Number(c.req.param('id'))}`;
    if (!v) return c.json({ error: 'versione non trovata' }, 404);
    const target = `${v.repo_owner}/${v.repo_name}@${v.slug}`;
    const active = async (kind: string) =>
      (await sql`select 1 from version_override where version_id = ${v.id} and action = ${kind} and revoked_at is null`).length > 0;

    let revoked: number[] = [];
    if (action === 'withdraw') {
      if (await active('withdraw')) return c.json({ error: 'la versione è già ritirata' }, 409);
      await sql.begin(async (tx) => {
        await tx`insert into version_override (version_id, action, reason, actor) values (${v.id}, 'withdraw', ${reason}, ${actor})`;
        await tx`update version set active = false where id = ${v.id}`;
      });
    } else if (action === 'restore') {
      if (!(await active('withdraw'))) return c.json({ error: 'la versione non è ritirata dalla dashboard' }, 409);
      await sql.begin(async (tx) => {
        await tx`update version_override set revoked_at = now() where version_id = ${v.id} and action = 'withdraw' and revoked_at is null`;
        await tx`update version set active = true where id = ${v.id}`;
      });
    } else if (action === 'promote') {
      if (!v.active || !v.published_build_id) return c.json({ error: 'si può promuovere solo una versione attiva e pubblicata' }, 409);
      if (await active('promote')) return c.json({ error: 'la versione è già promossa' }, 409);
      await sql.begin(async (tx) => {
        // una sola versione promossa per documento
        revoked = (
          await tx`update version_override o set revoked_at = now() from version x
            where x.id = o.version_id and x.document_id = ${v.document_id} and o.action = 'promote' and o.revoked_at is null returning o.id`
        ).map((r: { id: number }) => r.id);
        await tx`insert into version_override (version_id, action, reason, actor) values (${v.id}, 'promote', ${reason}, ${actor})`;
      });
    } else {
      if (!(await active('promote'))) return c.json({ error: 'la versione non è promossa' }, 409);
      await sql`update version_override set revoked_at = now() where version_id = ${v.id} and action = 'promote' and revoked_at is null`;
    }
    await audit(actor, `version.${action}`, target, { reason, versionId: v.id, ...(revoked.length ? { revokedPromotions: revoked } : {}) });
    const [{ id: def }] = await sql`select default_version_id(${v.document_id}) as id`;
    return c.json({ ok: true, defaultVersionId: def });
  });

  // ------------------------------------------------------------------ build, coda, webhook, registro
  app.post('/builds', async (c) => {
    const { repository, version } = await c.req.json<{ repository: string; version?: string }>();
    const [owner, name] = repository.split('/');
    const [v] = await sql`select v.id from version v join document d on d.id = v.document_id
      where d.repo_owner = ${owner} and d.repo_name = ${name} and v.slug = ${version ?? 'bozza'}`;
    if (!v) return c.json({ error: 'versione non trovata' }, 404);
    const job = await enqueue(sql, 'build', { versionId: v.id });
    await audit(c.get('actor'), 'build', `${repository}@${version ?? 'bozza'}`, { job });
    return c.json({ job }, 202);
  });

  app.get('/builds', async (c) => {
    const status = c.req.query('status') ?? null;
    const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
    return c.json(
      await sql`select b.id, d.id as document_id, d.repo_owner || '/' || d.repo_name as repository, v.slug as version, b.origin, b.status, b.commit, b.error,
          jsonb_array_length(b.problems)::int as problems, b.created_at, b.finished_at
        from build b join document d on d.id = b.document_id left join version v on v.id = b.version_id
        where (${status}::text is null or b.status = ${status})
        order by b.id desc limit ${limit}`,
    );
  });

  app.get('/builds/:id{[0-9]+}', async (c) => {
    const [b] = await sql`
      select b.*, d.repo_owner, d.repo_name, d.name as document_name, d.format, v.slug as version, v.published_build_id = b.id as published
      from build b join document d on d.id = b.document_id left join version v on v.id = b.version_id where b.id = ${Number(c.req.param('id'))}`;
    return b ? c.json(b) : c.json({ error: 'build non trovata' }, 404);
  });

  app.get('/jobs', async (c) => {
    const status = c.req.query('status') ?? null;
    return c.json(
      await sql`select id, kind, payload, status, attempts, max_attempts, last_error, run_after, created_at, finished_at from job
        where (${status}::text is null or status = ${status}) order by id desc limit 200`,
    );
  });

  app.post('/jobs/:id{[0-9]+}/retry', async (c) => {
    const [j] = await sql`update job set status = 'queued', attempts = 0, run_after = now(), locked_at = null, last_error = null
      where id = ${Number(c.req.param('id'))} and status = 'failed' returning id, kind, payload`;
    if (!j) return c.json({ error: 'solo i lavori falliti si possono rilanciare' }, 409);
    await audit(c.get('actor'), 'job.retry', `${j.kind} #${j.id}`, j.payload);
    return c.json({ job: j.id });
  });

  app.get('/webhooks', async (c) => c.json(await sql`select * from webhook_delivery order by id desc limit 200`));

  app.get('/audit', async (c) => c.json(await sql`select * from audit_log order by id desc limit 200`));

  // ------------------------------------------------------------------ stato dei collegamenti
  app.get('/checks', async (c) => {
    // l'ultimo esito vale un minuto: la home e la pagina dei collegamenti non rifanno i controlli a ogni visita
    if (c.req.query('fresh') === '1' || !lastChecks || Date.now() - new Date(lastChecks.at).getTime() > 60_000) {
      lastChecks = await runChecks(sql, config);
    }
    return c.json(lastChecks);
  });

  return app;
}
