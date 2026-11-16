# @docs-italia/forge

Accesso ai fornitori Git: GitHub, poi GitLab.

## Compiti

- Interfaccia comune verso il fornitore: leggere file, elencare branch e tag, verificare webhook e token OIDC, creare commit, aprire pull request.
- Implementazione GitHub con [Octokit](https://github.com/octokit):
  - autenticazione come GitHub App (`@octokit/app`) con token di installazione;
  - webhook (`@octokit/webhooks`): push, tag, release, pull request, modifiche a `italia-conf`;
  - lettura di `italia-conf` e dei repository dei documenti;
  - stato delle build sui commit e commento con il link all'anteprima nelle pull request;
  - commit di più file in una volta per l'editor ospitato, con la mutation GraphQL `createCommitOnBranch`.
- Verifica dei token OIDC delle GitHub Actions che inviano i pacchetti.
- Operazioni Git locali per lo studio, con il comando `git`: stato, diff, branch, commit, mai push. Le operazioni sono attive solo se la cartella del documento è la radice del proprio repository.

## Cosa non fa con Octokit

Octokit chiama l'API di GitHub, non esegue Git:

- lo studio locale lavora su un clone e usa `git`;
- il worker di build scarica la sorgente con un clone superficiale (`git clone --depth 1 --branch <ref>`), perché l'archivio di un ref via API non contiene i submodule.

## Limiti dell'API

Webhook invece di interrogazioni periodiche, richieste condizionali (ETag), token di installazione della GitHub App invece di token personali.

Piano di progetto: sezioni 2.2, 4.3, 4.6, 5.4, 5.6, 6.5, 8.

Punto di partenza: `_poc/packages/toolkit/src/git.ts` nel PoC.

## Dipende da

- `@docs-italia/schema`
