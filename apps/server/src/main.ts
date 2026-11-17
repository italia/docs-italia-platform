/**
 * Avvio del server: migrazioni, API, worker.
 *
 *   bun src/main.ts              serve API e worker
 *   bun src/main.ts migrate      applica le migrazioni
 *   bun src/main.ts sync <org>   sincronizza un publisher (e accoda le build)
 *   bun src/main.ts seed <file>  versioni iniziali dall'inventario
 *   bun src/main.ts work         esegue i lavori in coda fino a esaurirli
 */
import { readFileSync } from 'node:fs';
import { createApp } from './api.ts';
import { configFromEnv } from './config.ts';
import { connect, migrate } from './db.ts';
import { oidcVerifier } from './oidc.ts';
import { seedFromSnapshot } from './seed.ts';
import { syncPublisher } from './sync.ts';
import { startWorker, workOnce } from './worker.ts';

const config = configFromEnv();
const sql = connect(config.databaseUrl);
const [cmd, arg] = process.argv.slice(2);

const applied = await migrate(sql);
if (applied.length) console.log(`migrazioni applicate: ${applied.join(', ')}`);

if (cmd === 'migrate') {
  await sql.close();
} else if (cmd === 'sync') {
  const r = await syncPublisher(sql, config.forge, arg!, { queueBuilds: true });
  console.log(JSON.stringify(r, null, 2));
  await sql.close();
} else if (cmd === 'seed') {
  const r = await seedFromSnapshot(sql, JSON.parse(readFileSync(arg!, 'utf8')), { queueBuilds: true });
  console.log(JSON.stringify(r, null, 2));
  await sql.close();
} else if (cmd === 'work') {
  let n = 0;
  while (await workOnce({ sql, config })) n++;
  console.log(`${n} lavori eseguiti`);
  await sql.close();
} else {
  const oidc = oidcVerifier({ issuer: config.oidcIssuer, audience: config.oidcAudience, jwksUrl: config.oidcJwksUrl });
  const app = createApp({ sql, config, oidc });
  if (config.worker) startWorker({ sql, config });
  Bun.serve({ port: config.port, hostname: process.env.HOST ?? '127.0.0.1', fetch: app.fetch });
  console.log(`docs-italia-platform server: http://127.0.0.1:${config.port}  (forge: ${config.forge.kind}, organizzazioni: ${config.organizations.join(', ') || 'nessuna'})`);
}
