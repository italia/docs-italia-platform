/**
 * @docs-italia/forge — accesso ai fornitori Git.
 *
 * - Interfaccia comune (Forge) con due implementazioni: LocalForge (clone
 *   locali, per sviluppo e test) e GitHubForge (Octokit, GitHub App o token).
 * - Operazioni Git locali per lo studio e il toolkit (mai push).
 */
export * from './forge.ts';
export { LocalForge } from './local.ts';
export { GitHubForge, type GitHubAuth } from './github.ts';
export * from './git.ts';
