/**
 * Accesso alla dashboard con magic link (todo.md, 6.6).
 *
 * 1. Si inserisce l'email. Se è nell'elenco DASHBOARD_ADMIN_EMAILS arriva un
 *    link che vale una volta sola e per MAGIC_LINK_TTL_MINUTES (15). La risposta
 *    è la stessa per email autorizzate e non, e l'invio non si aspetta: dalla
 *    risposta, nemmeno dal tempo, non si capisce chi ha accesso.
 * 2. Il link apre la dashboard (#/accesso?token=…: il token sta dopo il "#" e
 *    non arriva ai server). La pagina chiede di premere "Accedi": i filtri della
 *    posta che aprono i link per controllarli non consumano il token.
 * 3. Si apre una sessione in un cookie HttpOnly, SameSite=Strict (Secure con
 *    https) che scade dopo ADMIN_SESSION_TTL_HOURS (8).
 *
 * Ogni richiesta ricontrolla l'elenco: un'email tolta perde subito l'accesso,
 * anche con una sessione aperta. Di link e sessioni si salva solo l'hash.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Config } from './config.ts';
import type { Db } from './db.ts';

export const SESSION_COOKIE = 'di_admin_session';
const COOKIE_PATH = '/api/admin';
/** limiti di frequenza delle richieste di link, in una finestra di 15 minuti */
export const LIMITS = { windowMinutes: 15, perEmail: 5, perIp: 20 };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export function isAdmin(config: Pick<Config, 'adminEmails'>, email: string): boolean {
  return (config.adminEmails ?? []).includes(normalizeEmail(email));
}

/** Indirizzo del client: dalla connessione, o da X-Forwarded-For con TRUST_PROXY=1. */
export function clientIp(c: Context, config: Pick<Config, 'trustProxy'>): string | null {
  if (config.trustProxy) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null; // nei test (app.request) non c'è una connessione
  }
}

export function magicLinkEnabled(config: Pick<Config, 'adminEmails' | 'mailer'>): boolean {
  return !!config.mailer && (config.adminEmails?.length ?? 0) > 0;
}

export type LinkRequest = { status: 'accepted' } | { status: 'limited' } | { status: 'disabled' };

/**
 * Richiesta di un link. "accepted" sia per le email autorizzate sia per le
 * altre; "limited" oltre i limiti di frequenza, per tutti allo stesso modo.
 */
export async function requestLink(sql: Db, config: Config, input: { email: string; ip: string | null }, onError: (e: unknown) => void = console.error): Promise<LinkRequest> {
  if (!magicLinkEnabled(config)) return { status: 'disabled' };
  const email = normalizeEmail(input.email);
  const since = new Date(Date.now() - LIMITS.windowMinutes * 60_000);
  const [{ byEmail, byIp }] = await sql`
    select
      (select count(*)::int from admin_login_request where email = ${email} and created_at > ${since}) as "byEmail",
      (select count(*)::int from admin_login_request where ip = ${input.ip} and created_at > ${since}) as "byIp"`;
  if (byEmail >= LIMITS.perEmail || (input.ip && byIp >= LIMITS.perIp)) return { status: 'limited' };

  if (!isAdmin(config, email)) {
    await sql`insert into admin_login_request (email, ip) values (${email}, ${input.ip})`;
    return { status: 'accepted' };
  }
  const token = newToken();
  const ttl = config.magicLinkTtlMinutes ?? 15;
  await sql`
    insert into admin_login_request (email, ip, token_hash, expires_at)
    values (${email}, ${input.ip}, ${hash(token)}, now() + make_interval(mins => ${ttl}))`;
  const link = `${dashboardUrl(config)}#/accesso?token=${token}`;
  // l'invio non si aspetta: il tempo di risposta non deve dire se l'email è autorizzata
  config
    .mailer!.send({
      to: email,
      subject: 'Accesso alla dashboard di Docs Italia',
      text: [
        'Per entrare nella dashboard di amministrazione di Docs Italia apri questo link:',
        '',
        link,
        '',
        `Il link vale una volta sola e scade tra ${ttl} minuti.`,
        'Se non hai chiesto tu di accedere, ignora questa email.',
      ].join('\n'),
    })
    .catch(onError);
  return { status: 'accepted' };
}

export function dashboardUrl(config: Pick<Config, 'dashboardUrl' | 'publicUrl'>): string {
  const url = config.dashboardUrl ?? `${config.publicUrl.replace(/\/$/, '')}/dashboard/`;
  return url.endsWith('/') ? url : `${url}/`;
}

/** Consuma un link e apre una sessione. null: link inesistente, già usato, scaduto o email non più autorizzata. */
export async function openSession(sql: Db, config: Config, input: { token: string; ip: string | null }): Promise<{ token: string; email: string } | null> {
  if (!input.token) return null;
  return sql.begin(async (tx) => {
    const [r] = await tx`
      update admin_login_request set used_at = now()
      where token_hash = ${hash(input.token)} and used_at is null and expires_at > now()
      returning email`;
    if (!r || !isAdmin(config, r.email)) return null;
    const token = newToken();
    const hours = config.sessionTtlHours ?? 8;
    await tx`
      insert into admin_session (email, token_hash, ip, expires_at)
      values (${r.email}, ${hash(token)}, ${input.ip}, now() + make_interval(hours => ${hours}))`;
    return { token, email: r.email as string };
  });
}

/** Email della sessione del cookie, se valida e ancora autorizzata. */
export async function sessionEmail(sql: Db, config: Config, c: Context): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const [s] = await sql`
    update admin_session set last_seen_at = now()
    where token_hash = ${hash(token)} and ended_at is null and expires_at > now()
    returning email`;
  return s && isAdmin(config, s.email) ? (s.email as string) : null;
}

export function setSessionCookie(c: Context, config: Config, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    path: COOKIE_PATH,
    httpOnly: true,
    sameSite: 'Strict',
    secure: dashboardUrl(config).startsWith('https://'),
    maxAge: (config.sessionTtlHours ?? 8) * 3600,
  });
}

export async function closeSession(sql: Db, c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await sql`update admin_session set ended_at = now() where token_hash = ${hash(token)} and ended_at is null`;
  deleteCookie(c, SESSION_COOKIE, { path: COOKIE_PATH });
}
