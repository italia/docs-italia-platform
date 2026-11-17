# @docs-italia/render

AST → HTML con Italia Tailwind UI: sito, pagina singola, stampa, EPUB, anteprima.

## Compiti

- Renderer AST → HTML, sempre XHTML ben formato, con escape di tutto il testo dei documenti.
- Layout: sito a capitoli, pagina singola, stampa per il PDF, capitoli EPUB, frammento per l'anteprima dell'editor.
- Fogli di stile: Italia Tailwind UI con il solo tema `italia-original` (file generato), tipografia dei documenti.

Piano di progetto: sezioni 6.1, 6.4.

Codice portato dal PoC (`_poc/packages/render`) e poi esteso.

## Dipende da

- `@docs-italia/schema`
