/**
 * @docs-italia/forge — Accesso ai fornitori Git: GitHub, poi GitLab.
 *
 * - Interfaccia comune: leggere file, elencare branch e tag, verificare webhook e
 *   token OIDC, creare commit, aprire pull request.
 * - GitHub con Octokit: GitHub App, webhook, API REST e GraphQL
 *   (createCommitOnBranch per l'editor ospitato).
 * - Git locale per lo studio con il comando git (mai push); clone superficiale
 *   per il worker di build.
 *
 * Ossatura: il codice arriverà dal PoC (_poc/packages/toolkit/src/git.ts).
 */
export {};
