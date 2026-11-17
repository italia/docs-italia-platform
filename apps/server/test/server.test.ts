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
import { createApp } from '../src/api.ts';
import type { Config } from '../src/config.ts';
import { connect, migrate, type Db } from '../src/db.ts';
import { oidcVerifier } from '../src/oidc.ts';
import { FsStorage } from '../src/storage.ts';
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

  test('documento tolto da italia-conf: disattivato', async () => {
    const conf = join(root, 'esempio', 'italia-conf');
    writeFileSync(join(conf, 'projects_settings.yml'), 'projects:\n  - name: Progetto di prova\n    short_name: Prova\n    description: Progetto\n    documents:\n      - documento-prova\n');
    git(conf, 'commit', '-qam', 'tolto documento-rst');
    await syncPublisher(sql, config.forge, 'esempio');
    const [d] = await sql`select active from document where repo_name = 'documento-rst'`;
    expect(d.active).toBe(false);
  });
});
