# @docs-italia/retrieval

Testo, sezioni e frammenti per ricerca e RAG; ricerca ibrida.

## Compiti

- Sezioni e record per la ricerca del sito (`search.jsonl`).
- Frammenti per il RAG (`chunks.jsonl`) con il percorso dei titoli in testa e hash del contenuto.
- Normalizzazione del testo (apostrofi) prima di ricerca ed embedding.
- Ricerca ibrida (full-text + vettoriale con Reciprocal Rank Fusion), condivisa da server, sito e MCP.

Piano di progetto: sezioni 7.2, 7.3.

Punto di partenza: `_poc/packages/toolkit/src/text.ts` nel PoC.

## Dipende da

- `@docs-italia/schema`
