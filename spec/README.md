# spec

Specifica pubblica del formato dei documenti Docs Italia, separata dal codice come per `publiccode.yml`. Chiunque può scrivere strumenti compatibili senza usare il toolkit.

Contenuto previsto:

- `document_settings.yml` esteso (retrocompatibile con quello attuale);
- `toc.json`;
- estensioni MyST di Docs Italia (direttive e ruoli);
- pacchetto di build: `manifest.json`, pagine con AST, `inventory.json`, `search.jsonl`, `chunks.jsonl`;
- `schemas/`: JSON Schema generati da `@docs-italia/schema`, versionati.

La specifica sarà scritta in MyST e costruita con il toolkit stesso. Piano di progetto: sezioni 3, 4.2, 8.
