# @docs-italia/myst

Lettura MyST con le estensioni di Docs Italia e risoluzione dell'AST.

## Compiti

Stato: funzionante. Lettura, risoluzione, controlli e serializzazione a blocchi (`src/serialize.ts`), misurata con `bun run fidelity <cartelle>`: AST identico sul 100% dei 495 blocchi provati.


- Parsing MyST con `myst-parser` e le direttive e i ruoli di Docs Italia (`highlights`, `rfc`, `forum`, `plantuml`, `only`, ruoli HTTP).
- Risoluzione: titoli numerati e ancore, etichette, figure, note, link tra pagine, riferimenti incrociati, immagini.
- Controlli con file e riga: link e ancore, immagini, testo alternativo, struttura dei titoli.
- Serializzazione a blocchi per l'editor (conserva le opzioni delle direttive).

Piano di progetto: sezioni 3.3, 3.6, 5.3.

Codice portato dal PoC (`_poc/packages/toolkit/src/myst.ts, resolve.ts`) e poi esteso.

## Dipende da

- `@docs-italia/schema`
