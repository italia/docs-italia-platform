/**
 * Operazioni Git locali. Il PoC non fa mai push: lavora solo sui branch locali.
 */
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

export interface GitInfo {
  isRepo: boolean;
  /** radice del repository che contiene la cartella, se non è la cartella stessa */
  outerRepo?: string;
  branch?: string;
  commit?: string;
  dirty?: boolean;
  tag?: string;
}

/**
 * Informazioni sul repository. La cartella del documento deve essere la radice
 * del repository: se è solo una sottocartella di un repository più grande
 * (come nel PoC), le operazioni Git finirebbero su quel repository, quindi
 * vengono disattivate.
 */
export async function gitInfo(cwd: string): Promise<GitInfo> {
  try {
    const top = await git(cwd, ['rev-parse', '--show-toplevel']);
    if (realpathSync(top) !== realpathSync(cwd)) return { isRepo: false, outerRepo: top };
  } catch {
    return { isRepo: false };
  }
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined);
  const commit = await git(cwd, ['rev-parse', 'HEAD']).catch(() => undefined);
  const dirty = (await git(cwd, ['status', '--porcelain', '--', '.']).catch(() => '')).length > 0;
  const tag = await git(cwd, ['describe', '--tags', '--exact-match']).catch(() => undefined);
  return { isRepo: true, branch, commit, dirty, tag };
}

export interface GitStatusEntry {
  path: string;
  status: string;
}

export async function gitStatus(cwd: string): Promise<{ branch?: string; branches: string[]; changes: GitStatusEntry[] }> {
  const info = await gitInfo(cwd);
  if (!info.isRepo) return { branches: [], changes: [] };
  const branches = (await git(cwd, ['branch', '--format=%(refname:short)'])).split('\n').filter(Boolean);
  const changes = (await git(cwd, ['status', '--porcelain=v1', '--', '.']))
    .split('\n')
    .filter(Boolean)
    .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }));
  return { branch: info.branch, branches, changes };
}

export async function gitDiff(cwd: string, path?: string): Promise<string> {
  return git(cwd, ['diff', '--no-color', '--', path ?? '.']);
}

const BRANCH_RE = /^[a-z0-9][a-z0-9._/-]{0,80}$/i;

async function requireOwnRepo(cwd: string) {
  const info = await gitInfo(cwd);
  if (!info.isRepo) {
    throw new Error(
      info.outerRepo
        ? `la cartella del documento è dentro il repository ${info.outerRepo}: le operazioni Git sono disattivate (esegui "git init" nella cartella del documento)`
        : 'la cartella del documento non è un repository Git',
    );
  }
}

export async function gitCheckout(cwd: string, branch: string, create: boolean): Promise<void> {
  if (!BRANCH_RE.test(branch) || branch.includes('..')) throw new Error(`nome di branch non valido: "${branch}"`);
  await requireOwnRepo(cwd);
  await git(cwd, create ? ['switch', '-c', branch] : ['switch', branch]);
}

export async function gitCommit(cwd: string, message: string, author?: { name: string; email: string }): Promise<string> {
  if (!message.trim()) throw new Error('serve un messaggio di commit');
  await requireOwnRepo(cwd);
  await git(cwd, ['add', '--all', '--', '.']);
  const args = ['commit', '-m', message];
  if (author) args.push(`--author=${author.name} <${author.email}>`);
  await git(cwd, args);
  return git(cwd, ['rev-parse', 'HEAD']);
}

export async function gitLog(cwd: string, n = 10): Promise<Array<{ commit: string; date: string; author: string; subject: string }>> {
  const out = await git(cwd, ['log', `-${n}`, '--format=%H%x1f%cI%x1f%an%x1f%s']).catch(() => '');
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [commit, date, author, subject] = l.split('\x1f');
      return { commit, date, author, subject };
    });
}
