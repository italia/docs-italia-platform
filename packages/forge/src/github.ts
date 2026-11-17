/**
 * Fornitore GitHub con Octokit, in due modalità (todo.md, 6.5):
 * - GitHub App (consigliata): GITHUB_APP_ID + chiave privata; un'installazione per organizzazione;
 * - token: GITHUB_TOKEN (fine-grained, in lettura).
 *
 * La sorgente si scarica come archivio del ref: i submodule non sono inclusi
 * (per quei repository serve un clone, da fare nel worker).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import type { Forge, Refs, RepoInfo } from './forge.ts';

const run = promisify(execFile);

export type GitHubAuth = { kind: 'token'; token: string } | { kind: 'app'; appId: string; privateKey: string } | { kind: 'anonymous' };

export class GitHubForge implements Forge {
  readonly kind = 'github' as const;
  private base: Octokit;
  private perOwner = new Map<string, Octokit>();

  constructor(
    readonly auth: GitHubAuth,
    private opts: { baseUrl?: string; fetch?: typeof fetch } = {},
  ) {
    this.base = this.make(auth.kind === 'token' ? auth.token : undefined, auth.kind === 'app' ? { appId: auth.appId, privateKey: auth.privateKey } : undefined);
  }

  private make(token?: string, app?: { appId: string; privateKey: string; installationId?: number }): Octokit {
    return new Octokit({
      ...(app ? { authStrategy: createAppAuth, auth: app } : token ? { auth: token } : {}),
      baseUrl: this.opts.baseUrl,
      request: this.opts.fetch ? { fetch: this.opts.fetch } : undefined,
      userAgent: 'docs-italia-platform',
    });
  }

  /** Con la GitHub App ogni organizzazione ha la sua installazione e il suo token. */
  private async client(owner: string): Promise<Octokit> {
    if (this.auth.kind !== 'app') return this.base;
    const cached = this.perOwner.get(owner);
    if (cached) return cached;
    const { data } = await this.base.rest.apps.getOrgInstallation({ org: owner });
    const c = this.make(undefined, { appId: this.auth.appId, privateKey: this.auth.privateKey, installationId: data.id });
    this.perOwner.set(owner, c);
    return c;
  }

  async repo(owner: string, name: string): Promise<RepoInfo | null> {
    try {
      const { data } = await (await this.client(owner)).rest.repos.get({ owner, repo: name });
      return { owner, name, defaultBranch: data.default_branch, archived: data.archived, url: data.html_url };
    } catch (e: any) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async readFile(owner: string, name: string, path: string, ref?: string): Promise<string | null> {
    try {
      const { data } = await (await this.client(owner)).rest.repos.getContent({ owner, repo: name, path, ref, mediaType: { format: 'raw' } });
      return typeof data === 'string' ? data : null;
    } catch (e: any) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async refs(owner: string, name: string): Promise<Refs> {
    const c = await this.client(owner);
    const branches = await c.paginate(c.rest.repos.listBranches, { owner, repo: name, per_page: 100 });
    const tags = await c.paginate(c.rest.repos.listTags, { owner, repo: name, per_page: 100 });
    return {
      branches: branches.map((b) => ({ name: b.name, commit: b.commit.sha })),
      tags: tags.map((t) => ({ name: t.name, commit: t.commit.sha })),
    };
  }

  async checkout(owner: string, name: string, ref: string, dest: string): Promise<{ commit: string }> {
    const c = await this.client(owner);
    const { data: commit } = await c.rest.repos.getCommit({ owner, repo: name, ref });
    const res = await c.rest.repos.downloadTarballArchive({ owner, repo: name, ref: commit.sha });
    const file = `${dest}.tar.gz`;
    await Bun.write(file, res.data as ArrayBuffer);
    // l'archivio di GitHub ha una cartella radice "<owner>-<repo>-<sha>": si toglie
    await run('tar', ['-xzf', file, '-C', dest, '--strip-components=1']);
    await run('rm', ['-f', file]);
    return { commit: commit.sha };
  }
}
