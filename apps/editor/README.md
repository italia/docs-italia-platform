# @docs-italia/editor

Interfaccia dell'editor (Vite + React): studio locale ed editor ospitato.

## Compiti

- Struttura del documento, editor del sorgente MyST (CodeMirror), anteprima con il renderer del sito.
- Schede Problemi, Git, Metadati, Genera.
- Editor visuale (`src/visual/`, Tiptap): la pagina come sequenza di blocchi, ognuno mostrato come nel sito; un clic lo apre nell'editor adatto (testo, avviso, figura, tabella, codice, etichetta, o sorgente per il resto). Al termine si riscrive solo quel blocco, con `applyEdits` di `@docs-italia/myst`: il resto del file resta identico. Ruoli, riferimenti e note dentro il testo sono pastiglie che tornano nel file come erano (`src/visual/ast.ts`).
- Lo stesso codice gira nello studio locale (SQLite) e nell'istanza (PostgreSQL).

Piano di progetto: sezioni 5.2, 5.3, 5.6.

Codice portato dal PoC (`_poc/apps/editor`) e poi esteso.

## Dipende da

- `@docs-italia/render`
- `@tiptap/*` (ProseMirror) per il testo dell'editor visuale
