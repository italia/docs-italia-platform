import { expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { GitHubForge } from '../src/github.ts';

/** fetch finto: risponde alle rotte indicate, 404 alle altre. */
function fakeFetch(routes: Record<string, { body: unknown; headers?: Record<string, string> }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    const r = routes[path];
    if (!r) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(r.body), { status: 200, headers: { 'content-type': 'application/json', ...r.headers } });
  }) as typeof fetch;
}

const rate = { resources: { core: { remaining: 4800, limit: 5000, reset: Math.floor(Date.now() / 1000) + 3600 } } };

test('token: valido, scadenza vicina, limiti; il token non compare', async () => {
  const exp = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const forge = new GitHubForge(
    { kind: 'token', token: 'github_pat_SEGRETO1234' },
    { fetch: fakeFetch({ '/user': { body: { login: 'docs-bot' }, headers: { 'github-authentication-token-expiration': exp } }, '/rate_limit': { body: rate } }) },
  );
  const checks = await forge.status(['italia']);
  const by = (n: string) => checks.find((c) => c.name.startsWith(n))!;
  expect(by('Modalità').detail).toBe('token (…1234)');
  expect(by('Token')).toMatchObject({ status: 'avviso' });
  expect(by('Token').detail).toContain('docs-bot');
  expect(by('Token').detail).toContain('scade tra');
  expect(by('Limiti')).toMatchObject({ status: 'ok' });
  expect(by('Limiti').detail).toContain('4800 richieste rimaste su 5000');
  expect(JSON.stringify(checks)).not.toContain('SEGRETO');
});

test('token non valido: errore', async () => {
  const forge = new GitHubForge({ kind: 'token', token: 'x' }, { fetch: fakeFetch({ '/rate_limit': { body: rate } }) });
  const checks = await forge.status([]);
  expect(checks.find((c) => c.name === 'Token')?.status).toBe('errore');
});

test('GitHub App: installazione mancante su un\'organizzazione', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const forge = new GitHubForge(
    { kind: 'app', appId: '42', privateKey },
    {
      fetch: fakeFetch({
        '/app': { body: { name: 'Docs Italia' } },
        '/app/installations': { body: [{ id: 7, account: { login: 'italia' }, repository_selection: 'all', permissions: { contents: 'read', metadata: 'read' } }] },
        '/app/installations/7/access_tokens': { body: { token: 'ghs_installazione', expires_at: new Date(Date.now() + 3600_000).toISOString() } },
        '/rate_limit': { body: rate },
      }),
    },
  );
  const checks = await forge.status(['italia', 'agid']);
  expect(checks.find((c) => c.name === 'Chiave privata')).toMatchObject({ status: 'ok' });
  expect(checks.find((c) => c.name === 'Installazione su agid')).toMatchObject({ status: 'errore' });
  expect(checks.find((c) => c.name === 'Installazione su italia')?.detail).toContain('contents: read');
  expect(checks.find((c) => c.name === "Limiti dell'API (italia)")).toMatchObject({ status: 'ok' });
  expect(JSON.stringify(checks)).not.toContain('PRIVATE KEY');
});

test('anonimo: avviso', async () => {
  const forge = new GitHubForge({ kind: 'anonymous' }, { fetch: fakeFetch({ '/rate_limit': { body: rate } }) });
  const checks = await forge.status([]);
  expect(checks[0]).toMatchObject({ name: 'Modalità di accesso', status: 'avviso' });
});
