# @docs-italia/toolkit

CLI docs-italia: init, check, build, dev, studio, publish, mcp.

## Compiti

- CLI `docs-italia` usata nei repository dei documenti, in CI e dal worker della piattaforma.
- Build del pacchetto, anteprima locale con ricaricamento automatico, server dello studio con SQLite.
- Invio del pacchetto a un'istanza; server MCP locale sul repository.

Piano di progetto: sezioni 4.1, 4.2, 5, 7.4.

Codice portato dal PoC (`_poc/packages/toolkit`) e poi esteso.

## Dipende da

- `@docs-italia/schema`
- `@docs-italia/myst`
- `@docs-italia/render`
- `@docs-italia/export`
- `@docs-italia/retrieval`
- `@docs-italia/forge`
