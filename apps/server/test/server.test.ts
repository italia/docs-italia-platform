/**
 * Integrazione del server su PostgreSQL vero e repository Git creati al momento.
 * Database: TEST_DATABASE_URL (predefinito postgres://localhost/docs_italia_test);
 * se non è raggiungibile i test si saltano. Lo schema "public" viene ricreato.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { LocalForge } from '@docs-italia/forge';
import { build } from '@docs-italia/toolkit';
import { Hono } from 'hono';
import { OPEN_ACTOR } from '../src/admin.ts';
import { createApp } from '../src/api.ts';
import { checkDashboardOpen, type Config } from '../src/config.ts';
import { serveDashboard } from '../src/dashboard.ts';
import { connect, migrate, type Db } from '../src/db.ts';
import { oidcVerifier } from '../src/oidc.ts';
import { FsStorage } from '../src/storage.ts';
import { seedFromSnapshot } from '../src/seed.ts';
import { syncPublisher } from '../src/sync.ts';
import { workOnce } from '../src/worker.ts';

const URL_DB = process.env.TEST_DATABASE_URL ?? 'postgres://localhost/docs_italia_test';
const EXAMPLE = join(import.meta.dir, '../../../examples/esempio-myst');
const PYTHON = join(import.meta.dir, '../../../packages/sphinx/.venv/bin/python');

let available = true;
try {
  const probe = connect(URL_DB, 1);
  await probe`select 1`;
  await probe.close();
} catch {
  available = false;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' });

function makeRepo(root: string, name: string, files: Record<string, string> | string): string {
  const dir = join(root, 'esempio', name);
  mkdirSync(dir, { recursive: true });
  if (typeof files === 'string') cpSync(files, dir, { recursive: true, filter: (s) => !/\/(dist|\.docs-italia)(\/|$)/.test(s) });
  else for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'prima versione');
  return dir;
}

describe.skipIf(!available)('server', () => {
  let sql: Db;
  let app: ReturnType<typeof createApp>;
  let root: string;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  const config = {} as Config;
  const SECRET = 'segreto-webhook';

  beforeAll(async () => {
    sql = connect(URL_DB, 4);
    await sql.unsafe('drop schema if exists public cascade; create schema public;');
    await migrate(sql);

    root = mkdtempSync(join(tmpdir(), 'docs-italia-forge-'));
    makeRepo(root, 'italia-conf', {
      'publisher_settings.yml': 'publisher:\n  name: Ente di esempio\n  description: Publisher di prova\n',
      'projects_settings.yml':
        'projects:\n  - name: Progetto di prova\n    short_name: Prova\n    description: Progetto\n    documents:\n      - documento-prova\n      - documento-rst\n      - repo-mancante\n',
    });
    const doc = makeRepo(root, 'documento-prova', EXAMPLE);
    git(doc, 'tag', '1.0');
    makeRepo(root, 'documento-rst', {
      'document_settings.yml': 'document:\n  name: Documento RST\n  description: Prova di conversione\n  tags: [prova]\n',
      'index.rst': 'Documento RST\n=============\n\n.. toctree::\n   :numbered:\n\n   capitolo\n',
      'capitolo.rst': '.. _capitolo:\n\nCapitolo\n========\n\nTesto con un rimando a :ref:`capitolo`.\n',
    });

    keys = await generateKeyPair('RS256');
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256' }] });
    Object.assign(config, {
      databaseUrl: URL_DB,
      port: 0,
      publicUrl: 'https://docs.example.test',
      organizations: ['esempio'],
      forge: new LocalForge(root),
      storage: new FsStorage(join(root, '.storage')),
      adminToken: 'token-admin',
      webhookSecret: SECRET,
      oidcAudience: 'https://docs.example.test',
      oidcIssuer: 'https://token.actions.githubusercontent.com',
      oidcJwksUrl: '',
      buildPdf: false,
      worker: false,
    } satisfies Config);
    process.env.DOCS_ITALIA_PYTHON ??= PYTHON;
    app = createApp({ sql, config, oidc: oidcVerifier({ issuer: config.oidcIssuer, audience: config.oidcAudience, keys: jwks }) });
  });

  afterAll(async () => {
    await sql?.close();
  });

  const drain = async () => {
    let n = 0;
    while (await workOnce({ sql, config })) n++;
    return n;
  };
  const hook = (event: string, payload: object, secret = SECRET) => {
    const body = JSON.stringify(payload);
    return app.request('/api/webhooks/github', {
      method: 'POST',
      body,
      headers: { 'x-github-event': event, 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
    });
  };
  const repoPayload = (name: string) => ({ repository: { name, owner: { login: 'esempio' } } });

  test('sincronizzazione da italia-conf', async () => {
    const r = await syncPublisher(sql, config.forge, 'esempio', { queueBuilds: true });
    expect(r.projects).toBe(1);
    expect(r.documents).toBe(2);
    expect(r.missing).toEqual(['repo-mancante']);
    const [p] = await sql`select slug from project`;
    expect(p.slug).toBe('prova'); // slug da short_name, come nel fork
  });

  test('webhook: firma non valida rifiutata, tag accodato', async () => {
    expect((await hook('push', { ...repoPayload('documento-prova'), ref: 'refs/tags/1.0' }, 'sbagliato')).status).toBe(401);
    const res = await hook('push', { ...repoPayload('documento-prova'), ref: 'refs/tags/1.0' });
    expect(res.status).toBe(202);
    expect((await res.json()).job).toBeGreaterThan(0);
  });

  test('worker: build e pubblicazione (anche con conversione RST)', async () => {
    const hasPython = existsSync(process.env.DOCS_ITALIA_PYTHON!);
    expect(await drain()).toBeGreaterThanOrEqual(3);
    const builds = await sql`select d.repo_name, v.slug, b.status, b.error from build b join document d on d.id = b.document_id join version v on v.id = b.version_id order by b.id`;
    const ok = (repo: string, slug: string) => builds.find((b: any) => b.repo_name === repo && b.slug === slug)?.status;
    expect(ok('documento-prova', 'bozza')).toBe('ok');
    expect(ok('documento-prova', '1.0')).toBe('ok');
    if (hasPython) expect(ok('documento-rst', 'bozza')).toBe('ok');
  });

  test('API: documento, alias "stabile", file del pacchetto, ricerca', async () => {
    const pubs = await (await app.request('/api/publishers')).json();
    expect(pubs[0].slug).toBe('esempio');
    const doc = await (await app.request('/api/documents/esempio/prova/documento-prova')).json();
    expect(doc.versions.map((v: any) => v.slug).sort()).toEqual(['1.0', 'bozza']);
    expect(doc.defaultVersion).toBe('1.0'); // l'ultima release
    expect(doc.aliases.stabile).toBe('1.0');
    const toc = await app.request('/api/documents/esempio/prova/documento-prova/it/stabile/toc.json');
    expect(toc.status).toBe(200);
    expect((await toc.json()).pages.length).toBe(5);
    const page = await (await app.request('/api/documents/esempio/prova/documento-prova/it/bozza/pages/capitoli/costrutti.json')).json();
    expect(page.title).toBe('Avvisi e figure');
    expect((await app.request('/api/documents/esempio/prova/documento-prova/it/bozza/../../segreti')).status).toBeGreaterThanOrEqual(400);
    const hits = await (await app.request('/api/search?q=' + encodeURIComponent('flusso pacchetto'))).json();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].document).toBe('documento-prova');
  });

  test('amministrazione: senza token rifiutata', async () => {
    expect((await app.request('/api/admin/jobs')).status).toBe(401);
    expect((await app.request('/api/admin/jobs', { headers: { authorization: 'Bearer token-admin' } })).status).toBe(200);
  });

  describe('pacchetti dalle GitHub Actions (OIDC)', () => {
    let zip: Uint8Array;
    const token = (claims: Record<string, string>, aud = 'https://docs.example.test') =>
      new SignJWT({ repository_owner: 'esempio', sha: 'abc123', ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://token.actions.githubusercontent.com')
        .setAudience(aud)
        .setExpirationTime('5m')
        .sign(keys.privateKey);
    const post = async (jwt: string, body: Uint8Array) =>
      app.request('/api/bundles', { method: 'POST', body, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/zip' } });

    beforeAll(async () => {
      const out = mkdtempSync(join(tmpdir(), 'docs-italia-bundle-'));
      await build(EXAMPLE, { outDir: out, html: false, pdf: false, epub: false, zip: false, bundle: true });
      const files: Record<string, Uint8Array> = {};
      const { readdirSync, readFileSync, statSync } = await import('node:fs');
      const walk = (d: string, base = d) => {
        for (const n of readdirSync(d)) {
          const f = join(d, n);
          if (statSync(f).isDirectory()) walk(f, base);
          else files[f.slice(base.length + 1)] = new Uint8Array(readFileSync(f));
        }
      };
      walk(join(out, 'bundle'));
      zip = zipSync(files);
    });

    test('pacchetto valido di un tag: pubblicato', async () => {
      const res = await post(await token({ repository: 'esempio/documento-prova', ref: 'refs/tags/2.0' }), zip);
      expect(res.status).toBe(201);
      const doc = await (await app.request('/api/documents/esempio/prova/documento-prova')).json();
      expect(doc.defaultVersion).toBe('2.0');
    });

    test('repository non elencato in italia-conf: 403', async () => {
      expect((await post(await token({ repository: 'esempio/altro', ref: 'refs/tags/1.0' }), zip)).status).toBe(403);
    });

    test('audience sbagliata: 401', async () => {
      expect((await post(await token({ repository: 'esempio/documento-prova', ref: 'refs/tags/3.0' }, 'https://altro.example'), zip)).status).toBe(401);
    });

    test('pacchetto manomesso: rifiutato', async () => {
      const { unzipSync } = await import('fflate');
      const files = unzipSync(zip);
      files['toc.json'] = strToU8('{"manomesso":true}');
      const res = await post(await token({ repository: 'esempio/documento-prova', ref: 'refs/tags/3.0' }), zipSync(files));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toContain('hash non corrispondente');
    });
  });

  test('sitemap: pagine della versione predefinita di ogni documento', async () => {
    const { documents } = await (await app.request('/api/sitemap')).json();
    const d = documents.find((x: any) => x.document === 'documento-prova');
    expect(d).toMatchObject({ publisher: 'esempio', project: 'prova', language: 'it' });
    expect(d.version).toBe((await (await app.request('/api/documents/esempio/prova/documento-prova')).json()).defaultVersion);
    expect(d.pages[0]).toBe('index');
    expect(d.pages.length).toBeGreaterThan(1);
  });

  test('versione predefinita dichiarata con il nome del branch: API e ricerca usano quella versione', async () => {
    await sql`update document set default_version = 'main' where repo_name = 'documento-prova'`;
    try {
      const doc = await (await app.request('/api/documents/esempio/prova/documento-prova')).json();
      expect(doc.defaultVersion).toBe('bozza');
      expect(doc.declaredDefault).toBe('bozza');
      const hits = await (await app.request('/api/search?q=' + encodeURIComponent('flusso pacchetto'))).json();
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h: any) => h.document !== 'documento-prova' || h.version === 'bozza')).toBe(true);
    } finally {
      await sql`update document set default_version = null where repo_name = 'documento-prova'`;
    }
    // senza dichiarazione: l'ultima release in ordine di versione
    expect((await (await app.request('/api/documents/esempio/prova/documento-prova')).json()).defaultVersion).toBe('2.0');
  });

  describe('dashboard', () => {
    const auth = { authorization: 'Bearer token-admin' };
    const call = (path: string, init: RequestInit = {}) =>
      app.request(`/api/admin${path}`, { ...init, headers: { ...auth, 'content-type': 'application/json', ...(init.headers ?? {}) } });
    const act = (versionId: number, action: string, reason?: string) => call(`/versions/${versionId}/${action}`, { method: 'POST', body: JSON.stringify({ reason }) });
    const publicDoc = async () => (await app.request('/api/documents/esempio/prova/documento-prova')).json();
    let docId: number;
    let ids: Record<string, number>;

    beforeAll(async () => {
      const [d] = await sql`select id from document where repo_name = 'documento-prova'`;
      docId = d.id;
      ids = Object.fromEntries((await sql`select slug, id from version where document_id = ${docId}`).map((v: any) => [v.slug, v.id]));
    });

    test('accesso: token, oppure aperta solo su indirizzo locale', async () => {
      expect((await app.request('/api/admin/whoami')).status).toBe(401);
      expect((await (await call('/whoami')).json()).actor).toBe('admin-token');
      const open = createApp({ sql, config: { ...config, dashboardOpen: true }, oidc: async () => ({}) as any });
      const who = await (await open.request('/api/admin/whoami')).json();
      expect(who).toMatchObject({ open: true, actor: OPEN_ACTOR });
      expect(() => checkDashboardOpen({ dashboardOpen: true, host: '0.0.0.0' })).toThrow('solo con HOST locale');
      expect(() => checkDashboardOpen({ dashboardOpen: true, host: '127.0.0.1' })).not.toThrow();
    });

    describe('magic link', () => {
      const sent: Array<{ to: string; text: string }> = [];
      const mailer = { kind: 'smtp' as const, describe: 'prova', send: async (e: { to: string; text: string }) => void sent.push(e), verify: async () => {} };
      const cfg = () => ({ ...config, adminEmails: ['admin@example.gov.it'], mailer, dashboardUrl: 'https://admin.example.test/dashboard/' }) as Config;
      let ml: ReturnType<typeof createApp>;
      const post = (path: string, body: object, headers: Record<string, string> = {}) =>
        ml.request(`/api/admin${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
      const linkToken = () => sent.at(-1)!.text.match(/#\/accesso\?token=([\w-]+)/)![1]!;
      const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!;

      beforeAll(async () => {
        await sql`delete from admin_login_request`;
        ml = createApp({ sql, config: cfg(), oidc: async () => ({}) as any });
      });

      test('stessa risposta per email autorizzate e non; il link arriva solo a quelle autorizzate', async () => {
        const a = await post('/auth/request', { email: '  Admin@Example.gov.it ' });
        const b = await post('/auth/request', { email: 'altro@example.gov.it' });
        expect(a.status).toBe(200);
        expect(await a.json()).toEqual(await b.json());
        await Bun.sleep(10);
        expect(sent.map((e) => e.to)).toEqual(['admin@example.gov.it']);
        expect(sent[0]!.text).toContain('https://admin.example.test/dashboard/#/accesso?token=');
        expect((await post('/auth/request', { email: 'non-email' })).status).toBe(400);
      });

      test('il link vale una volta; la sessione è in un cookie HttpOnly, Secure, SameSite=Strict', async () => {
        const token = linkToken();
        const [row] = await sql`select token_hash from admin_login_request where token_hash is not null order by id desc limit 1`;
        expect(row.token_hash).not.toBe(token); // nel database solo l'hash
        const res = await post('/auth/session', { token });
        expect(res.status).toBe(200);
        const set = res.headers.get('set-cookie')!;
        expect(set).toContain('HttpOnly');
        expect(set).toContain('Secure');
        expect(set).toContain('SameSite=Strict');
        expect(set).toContain('Path=/api/admin');
        expect((await post('/auth/session', { token })).status).toBe(401);
        const who = await (await ml.request('/api/admin/whoami', { headers: { cookie: cookieOf(res) } })).json();
        expect(who).toMatchObject({ actor: 'admin@example.gov.it', via: 'session' });
        const [log] = await sql`select actor, action from audit_log where action = 'login' order by id desc limit 1`;
        expect(log.actor).toBe('admin@example.gov.it');
      });

      test('link scaduto rifiutato; email tolta dall’elenco: fuori anche con la sessione aperta', async () => {
        await post('/auth/request', { email: 'admin@example.gov.it' });
        await Bun.sleep(10);
        await sql`update admin_login_request set expires_at = now() - interval '1 minute' where token_hash is not null and used_at is null`;
        expect((await post('/auth/session', { token: linkToken() })).status).toBe(401);

        await post('/auth/request', { email: 'admin@example.gov.it' });
        await Bun.sleep(10);
        const cookie = cookieOf(await post('/auth/session', { token: linkToken() }));
        expect((await ml.request('/api/admin/whoami', { headers: { cookie } })).status).toBe(200);
        const removed = createApp({ sql, config: { ...cfg(), adminEmails: ['altra@example.gov.it'] }, oidc: async () => ({}) as any });
        expect((await removed.request('/api/admin/whoami', { headers: { cookie } })).status).toBe(401);
      });

      test('uscita: la sessione non vale più', async () => {
        await post('/auth/request', { email: 'admin@example.gov.it' });
        await Bun.sleep(10);
        const cookie = cookieOf(await post('/auth/session', { token: linkToken() }));
        expect((await post('/auth/logout', {}, { cookie })).status).toBe(200);
        expect((await ml.request('/api/admin/whoami', { headers: { cookie } })).status).toBe(401);
      });

      test('limite di frequenza per email, uguale per autorizzate e non', async () => {
        await sql`delete from admin_login_request`;
        for (const email of ['admin@example.gov.it', 'altro@example.gov.it']) {
          for (let i = 0; i < 5; i++) expect((await post('/auth/request', { email })).status).toBe(200);
          expect((await post('/auth/request', { email })).status).toBe(429);
        }
      });

      test('senza email o senza SMTP il magic link è spento', async () => {
        const off = createApp({ sql, config: { ...config, adminEmails: [], mailer: undefined }, oidc: async () => ({}) as any });
        expect(await (await off.request('/api/admin/auth/status')).json()).toEqual({ open: false, magicLink: false });
        const res = await off.request('/api/admin/auth/request', { method: 'POST', body: JSON.stringify({ email: 'admin@example.gov.it' }), headers: { 'content-type': 'application/json' } });
        expect(res.status).toBe(503);
      });
    });

    describe('organizzazioni', () => {
      test('verifica: accesso, italia-conf, documenti trovati e mancanti', async () => {
        const r = await (await call('/publishers/check/esempio')).json();
        expect(r.ok).toBe(true);
        expect(r.existing).toEqual({ slug: 'esempio', active: true });
        expect(r.publisher.name).toBe('Ente di esempio');
        expect(r.summary).toEqual({ projects: 1, documents: 3, found: 2, missing: 1 });
        expect(r.projects[0].documents.find((d: any) => d.repo === 'repo-mancante').found).toBe(false);
        expect(r.access.some((x: any) => x.name === 'Organizzazione esempio' && x.status === 'ok')).toBe(true);
        const none = await (await call('/publishers/check/nessuna-org')).json();
        expect(none.ok).toBe(false);
        expect(none.conf.found).toBe(false);
        expect((await call('/publishers/check/nome%20con%20spazi')).status).toBe(400);
      });

      test('aggiunta: accoda la sincronizzazione e la registra; italia-conf non valido rifiutato', async () => {
        makeRepo(root, '../nuova-org/italia-conf', {
          'publisher_settings.yml': 'publisher:\n  name: Nuova amministrazione\n  description: Prova\n',
          'projects_settings.yml': 'projects:\n  - name: Progetto nuovo\n    description: Progetto\n    documents:\n      - non-ancora\n',
        });
        makeRepo(root, '../rotta/italia-conf', { 'publisher_settings.yml': 'publisher:\n  name: Senza descrizione\n', 'projects_settings.yml': 'projects: []\n' });
        const res = await call('/publishers', { method: 'POST', body: JSON.stringify({ owner: 'nuova-org' }) });
        expect(res.status).toBe(202);
        const { job, existing } = await res.json();
        expect(existing).toBe(false);
        await workOnce({ sql, config });
        const [j] = await sql`select status from job where id = ${job}`;
        expect(j.status).toBe('done');
        const [p] = await sql`select name, active from publisher where slug = 'nuova-org'`;
        expect(p).toEqual({ name: 'Nuova amministrazione', active: true });
        const [log] = await sql`select action, target from audit_log where action = 'publisher.add' order by id desc limit 1`;
        expect(log.target).toBe('nuova-org');
        const bad = await call('/publishers', { method: 'POST', body: JSON.stringify({ owner: 'rotta' }) });
        expect(bad.status).toBe(422);
        expect((await bad.json()).error).toContain('description');
        await sql`update publisher set active = false where slug = 'nuova-org'`;
      });

      test('webhook con il nome dell’organizzazione in maiuscolo (come lo manda GitHub)', async () => {
        const res = await hook('push', { repository: { name: 'Documento-Prova', owner: { login: 'ESEMPIO' } }, ref: 'refs/heads/nessun-branch' });
        expect((await res.json()).ignored).toBe('ref non pubblicato'); // riconosciuti publisher e documento
      });
    });

    test('documenti e dettaglio', async () => {
      const docs = await (await call('/documents')).json();
      const d = docs.find((x: any) => x.id === docId);
      expect(d).toMatchObject({ default_version: '2.0', versions: 3 });
      const detail = await (await call(`/documents/${docId}`)).json();
      expect(detail.versions.filter((v: any) => v.published_build_id).map((v: any) => v.slug)).toEqual(['bozza', '2.0', '1.0']); // bozza prima, release in ordine numerico
      expect(detail.versions.find((v: any) => v.slug === '3.0')).toMatchObject({ published_build_id: null, last_status: 'failed' }); // pacchetto manomesso: mai pubblicata
      expect(detail.default_version_id).toBe(ids['2.0']);
      const build = await (await call(`/builds/${detail.builds[0].id}`)).json();
      expect(build.repo_name).toBe('documento-prova');
    });

    test('promuovere e tornare alla regola del repository', async () => {
      expect((await act(ids['1.0']!, 'promote')).status).toBe(400); // motivazione obbligatoria
      expect((await act(ids['1.0']!, 'promote', 'la 2.0 ha un errore nelle tabelle')).status).toBe(200);
      let doc = await publicDoc();
      expect(doc.defaultVersion).toBe('1.0');
      expect(doc.declaredDefault).toBe('1.0'); // il sito reindirizza alla promossa
      // promuoverne un'altra revoca la prima promozione
      await act(ids.bozza!, 'promote', 'prova');
      expect((await publicDoc()).defaultVersion).toBe('bozza');
      expect((await act(ids['1.0']!, 'unpromote', 'prova')).status).toBe(409);
      await act(ids.bozza!, 'unpromote', 'torna la regola del repository');
      doc = await publicDoc();
      expect(doc.defaultVersion).toBe('2.0');
      expect(doc.declaredDefault).toBe(null);
    });

    test('ritirare: sparisce dal sito e prevale sul repository; ripristinare', async () => {
      expect((await act(ids['2.0']!, 'withdraw', 'pubblicata per errore')).status).toBe(200);
      expect((await act(ids['2.0']!, 'withdraw', 'di nuovo')).status).toBe(409);
      const doc = await publicDoc();
      expect(doc.versions.map((v: any) => v.slug)).not.toContain('2.0');
      expect(doc.defaultVersion).toBe('1.0');
      // il sito mostra "versione ritirata": solo slug e data, non la motivazione
      expect(doc.withdrawn.map((w: any) => w.slug)).toEqual(['2.0']);
      expect(JSON.stringify(doc.withdrawn)).not.toContain('per errore');
      expect((await app.request('/api/documents/esempio/prova/documento-prova/it/2.0/toc.json')).status).toBe(404);
      // un nuovo push del tag non la ripubblica
      const res = await hook('push', { ...repoPayload('documento-prova'), ref: 'refs/tags/2.0' });
      expect((await res.json()).ignored).toBe('versione ritirata');
      const overview = await (await call('/overview')).json();
      expect(overview.overrides.map((o: any) => o.action)).toEqual(['withdraw']);
      expect((await act(ids['2.0']!, 'restore', 'corretta')).status).toBe(200);
      expect((await publicDoc()).defaultVersion).toBe('2.0');
      expect((await publicDoc()).withdrawn).toEqual([]);
      const log = await (await call('/audit')).json();
      expect(log.find((e: any) => e.action === 'version.withdraw')).toMatchObject({ actor: 'admin-token', target: 'esempio/documento-prova@2.0', detail: { reason: 'pubblicata per errore' } });
    });

    test('visione d\'insieme e stato dei collegamenti', async () => {
      const o = await (await call('/overview')).json();
      expect(o.counts.publishers).toBe(1);
      expect(o.attention.documents.map((d: any) => d.repo_name)).toContain('repo-mancante');
      const { checks } = await (await call('/checks?fresh=1')).json();
      const get = (name: string) => checks.find((c: any) => c.name === name);
      expect(get('PostgreSQL').status).toBe('ok');
      expect(get('Lettura e scrittura').status).toBe('ok');
      expect(get('Modalità di accesso').detail).toContain('cartelle locali');
      expect(get('esempio/italia-conf').status).toBe('ok');
      expect(JSON.stringify(checks)).not.toContain('token-admin');
    });

    test('rilanciare un lavoro fallito', async () => {
      const [j] = await sql`insert into job (kind, payload, status, attempts, last_error) values ('sync', ${{ owner: 'nessuno' }}, 'failed', 3, 'errore') returning id`;
      expect((await call(`/jobs/${j.id}/retry`, { method: 'POST' })).status).toBe(200);
      const [after] = await sql`select status, attempts from job where id = ${j.id}`;
      expect(after).toMatchObject({ status: 'queued', attempts: 0 });
      await sql`delete from job where id = ${j.id}`;
      expect((await call(`/jobs/${j.id}/retry`, { method: 'POST' })).status).toBe(409);
    });

    test('file della dashboard: applicazione, risorse, niente percorsi fuori dalla cartella', async () => {
      const dist = mkdtempSync(join(tmpdir(), 'docs-italia-dashboard-'));
      mkdirSync(join(dist, 'assets'));
      writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Dashboard</title>');
      writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
      const h = new Hono();
      serveDashboard(h, dist);
      expect((await h.request('/dashboard')).status).toBe(301);
      expect(await (await h.request('/dashboard/')).text()).toContain('Dashboard');
      const js = await h.request('/dashboard/assets/app.js');
      expect(js.headers.get('content-type')).toContain('javascript');
      expect(js.headers.get('cache-control')).toContain('immutable');
      expect((await h.request('/dashboard/%2e%2e/%2e%2e/package.json')).status).toBe(404); // normalizzato dal parser degli URL
      expect((await h.request('/dashboard/..%2F..%2Fpackage.json')).status).toBe(400); // "/" codificato: lo ferma il controllo
    });
  });

  test('lingua dall\'inventario: resta anche dopo una nuova sincronizzazione, se document_settings.yml non la dichiara', async () => {
    await seedFromSnapshot(sql, [{ slug: 'documento-rst', repo: 'https://github.com/esempio/documento-rst.git', default_version: 'bozza', language: 'en', active_versions: [] }]);
    await syncPublisher(sql, config.forge, 'esempio');
    const [d] = await sql`select language from document where repo_name = 'documento-rst'`;
    expect(d.language).toBe('en');
    await sql`update document set language = 'it' where repo_name = 'documento-rst'`;
  });

  test('documento tolto da italia-conf: disattivato', async () => {
    const conf = join(root, 'esempio', 'italia-conf');
    writeFileSync(join(conf, 'projects_settings.yml'), 'projects:\n  - name: Progetto di prova\n    short_name: Prova\n    description: Progetto\n    documents:\n      - documento-prova\n');
    git(conf, 'commit', '-qam', 'tolto documento-rst');
    await syncPublisher(sql, config.forge, 'esempio');
    const [d] = await sql`select active from document where repo_name = 'documento-rst'`;
    expect(d.active).toBe(false);
  });
});
