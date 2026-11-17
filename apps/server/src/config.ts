/**
 * Configurazione dell'istanza dalle variabili d'ambiente.
 */
import { readFileSync } from 'node:fs';
import { GitHubForge, LocalForge, type Forge } from '@docs-italia/forge';
import { FsStorage, S3Storage, type Storage } from './storage.ts';

export interface Config {
  databaseUrl: string;
  port: number;
  publicUrl: string;
  /** organizzazioni da sincronizzare (es. "agid,italia,teamdigitale") */
  organizations: string[];
  forge: Forge;
  storage: Storage;
  /** token per le operazioni di amministrazione, finché non c'è la dashboard */
  adminToken?: string;
  webhookSecret?: string;
  /** audience attesa nei token OIDC delle GitHub Actions */
  oidcAudience: string;
  /** JWKS dei token OIDC (predefinito: quello di GitHub Actions) */
  oidcJwksUrl: string;
  oidcIssuer: string;
  buildPdf: boolean;
  worker: boolean;
}

function forgeFromEnv(env: NodeJS.ProcessEnv): Forge {
  if (env.FORGE_LOCAL_ROOT) return new LocalForge(env.FORGE_LOCAL_ROOT);
  if (env.GITHUB_APP_ID && (env.GITHUB_APP_PRIVATE_KEY || env.GITHUB_APP_PRIVATE_KEY_FILE)) {
    const privateKey = env.GITHUB_APP_PRIVATE_KEY ?? readFileSync(env.GITHUB_APP_PRIVATE_KEY_FILE!, 'utf8');
    return new GitHubForge({ kind: 'app', appId: env.GITHUB_APP_ID, privateKey });
  }
  if (env.GITHUB_TOKEN) return new GitHubForge({ kind: 'token', token: env.GITHUB_TOKEN });
  return new GitHubForge({ kind: 'anonymous' });
}

function storageFromEnv(env: NodeJS.ProcessEnv): Storage {
  if (env.S3_BUCKET) {
    return new S3Storage({ bucket: env.S3_BUCKET, endpoint: env.S3_ENDPOINT, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, region: env.S3_REGION });
  }
  return new FsStorage(env.STORAGE_DIR ?? './.docs-italia/storage');
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = env.PUBLIC_URL ?? 'http://127.0.0.1:8080';
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://localhost/docs_italia_dev',
    port: Number(env.PORT ?? 8080),
    publicUrl,
    organizations: (env.ORGANIZATIONS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    forge: forgeFromEnv(env),
    storage: storageFromEnv(env),
    adminToken: env.ADMIN_TOKEN,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    oidcAudience: env.OIDC_AUDIENCE ?? publicUrl,
    oidcJwksUrl: env.OIDC_JWKS_URL ?? 'https://token.actions.githubusercontent.com/.well-known/jwks',
    oidcIssuer: env.OIDC_ISSUER ?? 'https://token.actions.githubusercontent.com',
    buildPdf: env.BUILD_PDF !== '0',
    worker: env.WORKER !== '0',
  };
}
