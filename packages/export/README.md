# @docs-italia/export

PDF, EPUB e HTML compresso a partire dall'AST.

## Compiti

- PDF con Chromium headless e CSS di stampa (poi Paged.js per l'indice con i numeri di pagina).
- EPUB 3 generato dall'AST, validato con `epubcheck` in CI.
- Archivio HTML del sito.

Piano di progetto: sezioni 4.5.

Punto di partenza: `poc/packages/toolkit/src/pdf.ts, epub.ts` nel PoC.

## Dipende da

- `@docs-italia/render`
