/**
 * @docs-italia/retrieval — Testo, sezioni e frammenti per ricerca e RAG; ricerca ibrida.
 *
 * - Sezioni e record per la ricerca del sito (search.jsonl).
 * - Frammenti per il RAG (chunks.jsonl) con il percorso dei titoli in testa e hash del contenuto.
 * - Normalizzazione del testo (apostrofi) prima di ricerca ed embedding.
 * - Ricerca ibrida (full-text + vettoriale con Reciprocal Rank Fusion), condivisa da server, sito e MCP.
 *
 * Ossatura: il codice arriverà dal PoC (poc/packages/toolkit/src/text.ts).
 */
export {};
