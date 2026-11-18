/**
 * Configurazione dell'istanza dalle variabili d'ambiente.
 */
import { readFileSync } from 'node:fs';
import { GitHubForge, LocalForge, type Forge } from '@docs-italia/forge';
import { logMailer, smtpMailer, type Mailer } from './mail.ts';
import { FsStorage, S3Storage, type Storage } from './storage.ts';

export interface Config {
  databaseUrl: string;
  port: number;
  publicUrl: string;
  /** indirizzo del sito pubblico (Astro), per i link dalla dashboard */
  siteUrl: string;
  /** organizzazioni da sincronizzare (es. "agid,italia,teamdigitale") */
  organizations: string[];
  forge: Forge;
  storage: Storage;
  /** token per le operazioni di amministrazione (script, curl) */
  adminToken?: string;
  /**
   * Dashboard senza autenticazione (DASHBOARD_OPEN=1), finché non c'è il
   * magic link: solo con il server in ascolto su un indirizzo locale.
   */
  dashboardOpen?: boolean;
  /** indirizzo di ascolto */
  host?: string;

  /** email ammesse alla dashboard (DASHBOARD_ADMIN_EMAILS), normalizzate */
  adminEmails?: string[];
  /** indirizzo della dashboard nei magic link (predefinito: PUBLIC_URL/dashboard/) */
  dashboardUrl?: string;
  /** invio delle email: SMTP, o il log del server solo su indirizzo locale */
  mailer?: Mailer;
  magicLinkTtlMinutes?: number;
  sessionTtlHours?: number;
  /** X-Forwarded-For affidabile (server dietro un proxy): TRUST_PROXY=1 */
  trustProxy?: boolean;

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

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/** La dashboard aperta non deve mai essere raggiungibile da fuori. */
export function checkDashboardOpen(config: Pick<Config, 'dashboardOpen' | 'host'>): void {
  if (config.dashboardOpen && !LOOPBACK.has(config.host ?? '')) {
    throw new Error(`DASHBOARD_OPEN=1 è ammesso solo con HOST locale (127.0.0.1), non con "${config.host}": la dashboard sarebbe aperta a chiunque`);
  }
}

function mailerFromEnv(env: NodeJS.ProcessEnv, host: string): Mailer | undefined {
  if (env.SMTP_URL) return smtpMailer(env.SMTP_URL, env.SMTP_FROM ?? 'Docs Italia <noreply@docs.italia.it>');
  // senza SMTP i link finiscono nel log: ammesso solo su indirizzo locale
  return LOOPBACK.has(host) ? logMailer() : undefined;
}

const positive = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : fallback;
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = env.PUBLIC_URL ?? 'http://127.0.0.1:8080';
  const host = env.HOST ?? '127.0.0.1';
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://localhost/docs_italia_dev',
    port: Number(env.PORT ?? 8080),
    publicUrl,
    siteUrl: env.SITE_URL ?? publicUrl,
    organizations: (env.ORGANIZATIONS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    forge: forgeFromEnv(env),
    storage: storageFromEnv(env),
    adminToken: env.ADMIN_TOKEN,
    dashboardOpen: env.DASHBOARD_OPEN === '1',
    host,
    adminEmails: (env.DASHBOARD_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    dashboardUrl: env.DASHBOARD_URL,
    mailer: mailerFromEnv(env, host),
    magicLinkTtlMinutes: positive(env.MAGIC_LINK_TTL_MINUTES, 15),
    sessionTtlHours: positive(env.ADMIN_SESSION_TTL_HOURS, 8),
    trustProxy: env.TRUST_PROXY === '1',
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    oidcAudience: env.OIDC_AUDIENCE ?? publicUrl,
    oidcJwksUrl: env.OIDC_JWKS_URL ?? 'https://token.actions.githubusercontent.com/.well-known/jwks',
    oidcIssuer: env.OIDC_ISSUER ?? 'https://token.actions.githubusercontent.com',
    buildPdf: env.BUILD_PDF !== '0',
    worker: env.WORKER !== '0',
  };
}
