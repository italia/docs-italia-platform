# @docs-italia/export

PDF, EPUB e HTML compresso a partire dall'AST.

## Compiti

Stato: funzionante. PDF con Paged.js (predefinito) o Chrome (`--pdf-engine chrome`), EPUB 3, validazione con `epubcheck` quando è installato.


- PDF con Chromium headless e CSS di stampa (poi Paged.js per l'indice con i numeri di pagina).
- EPUB 3 generato dall'AST, validato con `epubcheck` in CI.
- Archivio HTML del sito.

Piano di progetto: sezioni 4.5.

Codice portato dal PoC (`_poc/packages/toolkit/src/pdf.ts, epub.ts`) e poi esteso.

## Dipende da

- `@docs-italia/render`
