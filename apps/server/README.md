# @docs-italia/server

Server dell'istanza: API, importazione, build, autenticazione.

## Compiti

- API per sito, studio ed editor ospitato (Hono).
- Importazione e sincronizzazione da `italia-conf` e dai repository; ripopolamento iniziale dall'inventario.
- Coda delle build (pg-boss), ricezione dei pacchetti, pubblicazione, indicizzazione.
- Autenticazione OIDC e ruoli.

Piano di progetto: sezioni 2.2, 6.2, 6.3.

## Dipende da

- `@docs-italia/schema`
- `@docs-italia/forge`
- `@docs-italia/retrieval`
