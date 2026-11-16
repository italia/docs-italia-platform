# @docs-italia/myst

Lettura MyST con le estensioni di Docs Italia e risoluzione dell'AST.

## Compiti

- Parsing MyST con `myst-parser` e le direttive e i ruoli di Docs Italia (`highlights`, `rfc`, `forum`, `plantuml`, `only`, ruoli HTTP).
- Risoluzione: titoli numerati e ancore, etichette, figure, note, link tra pagine, riferimenti incrociati, immagini.
- Controlli con file e riga: link e ancore, immagini, testo alternativo, struttura dei titoli.
- Serializzazione a blocchi per l'editor (conserva le opzioni delle direttive).

Piano di progetto: sezioni 3.3, 3.6, 5.3.

Punto di partenza: `_poc/packages/toolkit/src/myst.ts, resolve.ts` nel PoC.

## Dipende da

- `@docs-italia/schema`
