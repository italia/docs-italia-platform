/**
 * Fornitore Git su cartelle locali: <radice>/<owner>/<repository>, ognuno un
 * clone Git. Per sviluppo e test, e per importare i clone già presenti.
 *
 * Legge solo dagli oggetti Git (git show, git archive): la copia di lavoro dei
 * clone non viene mai toccata.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Forge, Refs, RepoInfo } from './forge.ts';

const run = promisify(execFile);

async function git(cwd: string, args: string[], encoding: 'utf8' | 'buffer' = 'utf8'): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 200 * 1024 * 1024, encoding: encoding as 'utf8' });
  return stdout;
}

export class LocalForge implements Forge {
  readonly kind = 'local' as const;
  constructor(readonly root: string) {}

  private dir(owner: string, name: string): string | null {
    const d = join(this.root, owner, name);
    return existsSync(join(d, '.git')) ? d : null;
  }

  /** Un ref può essere un branch locale, un branch remoto (origin/…), un tag o un commit. */
  private async resolve(dir: string, ref: string): Promise<string | null> {
    for (const r of [ref, `origin/${ref}`, `refs/tags/${ref}`]) {
      try {
        return (await git(dir, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`])).trim();
      } catch {}
    }
    return null;
  }

  async repo(owner: string, name: string): Promise<RepoInfo | null> {
    const dir = this.dir(owner, name);
    if (!dir) return null;
    let defaultBranch = '';
    try {
      defaultBranch = (await git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim().replace(/^origin\//, '');
    } catch {
      defaultBranch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    }
    return { owner, name, defaultBranch, archived: false, url: `https://github.com/${owner}/${name}` };
  }

  async readFile(owner: string, name: string, path: string, ref?: string): Promise<string | null> {
    const dir = this.dir(owner, name);
    if (!dir) return null;
    const r = ref ?? (await this.repo(owner, name))!.defaultBranch;
    const commit = await this.resolve(dir, r);
    if (!commit) return null;
    try {
      return await git(dir, ['show', `${commit}:${path}`]);
    } catch {
      return null;
    }
  }

  async refs(owner: string, name: string): Promise<Refs> {
    const dir = this.dir(owner, name);
    if (!dir) return { branches: [], tags: [] };
    const out = await git(dir, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(*objectname)', 'refs/heads', 'refs/remotes/origin', 'refs/tags']);
    const branches = new Map<string, string>();
    const tags: Refs['tags'] = [];
    for (const line of out.split('\n').filter(Boolean)) {
      const [ref, obj, peeled] = line.split('\t') as [string, string, string];
      if (ref.startsWith('refs/tags/')) tags.push({ name: ref.slice(10), commit: peeled || obj });
      else if (ref.startsWith('refs/remotes/origin/')) {
        const n = ref.slice(20);
        if (n !== 'HEAD') branches.set(n, obj);
      } else branches.set(ref.slice(11), obj);
    }
    return { branches: [...branches].map(([n, commit]) => ({ name: n, commit })), tags };
  }

  async checkout(owner: string, name: string, ref: string, dest: string): Promise<{ commit: string }> {
    const dir = this.dir(owner, name);
    if (!dir) throw new Error(`repository ${owner}/${name} non trovato in ${this.root}`);
    const commit = await this.resolve(dir, ref);
    if (!commit) throw new Error(`ref "${ref}" non trovato in ${owner}/${name}`);
    // git archive: la sorgente al commit, senza toccare la copia di lavoro (i submodule non sono inclusi)
    await run('sh', ['-c', `git -C "$1" archive --format=tar "$2" | tar -x -C "$3"`, 'sh', dir, commit, dest], { maxBuffer: 10 * 1024 * 1024 });
    return { commit };
  }
}
