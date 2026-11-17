# @docs-italia/forge

Accesso ai fornitori Git: GitHub, poi GitLab.

## Compiti

- Interfaccia comune verso il fornitore: leggere file, elencare branch e tag, verificare webhook e token OIDC, creare commit, aprire pull request.
- Implementazione GitHub con [Octokit](https://github.com/octokit), in due modalità scelte con le variabili d'ambiente:
  - GitHub App (`@octokit/app`) con token di installazione: consigliata, permette anche i commit dall'editor ospitato;
  - token (`GITHUB_TOKEN`, *fine-grained*): per prove e installazioni piccole, in sola lettura;
  - webhook (`@octokit/webhooks`): push, tag, release, pull request, modifiche a `italia-conf`;
  - lettura di `italia-conf` e dei repository dei documenti;
  - stato delle build sui commit e commento con il link all'anteprima nelle pull request;
  - commit di più file in una volta per l'editor ospitato, con la mutation GraphQL `createCommitOnBranch`.
- Verifica dei token OIDC delle GitHub Actions che inviano i pacchetti.
- Controlli dei collegamenti per la dashboard: validità della chiave dell'App o del token, installazioni e permessi per organizzazione, scadenza del token, limiti dell'API, consegne dei webhook.
- Operazioni Git locali per lo studio, con il comando `git`: stato, diff, branch, commit, mai push. Le operazioni sono attive solo se la cartella del documento è la radice del proprio repository.

## Cosa non fa con Octokit

Octokit chiama l'API di GitHub, non esegue Git:

- lo studio locale lavora su un clone e usa `git`;
- il worker di build scarica la sorgente con un clone superficiale (`git clone --depth 1 --branch <ref>`), perché l'archivio di un ref via API non contiene i submodule.

## Limiti dell'API

Webhook invece di interrogazioni periodiche, richieste condizionali (ETag) e, dove possibile, GitHub App invece del token.

Piano di progetto: sezioni 2.2, 4.3, 4.6, 5.4, 5.6, 6.5, 6.6, 8.

Codice portato dal PoC (`_poc/packages/toolkit/src/git.ts`) e poi esteso.

## Dipende da

- `@docs-italia/schema`
