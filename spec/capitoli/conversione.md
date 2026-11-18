(conversione)=
# Conversione dall'RST

`docs-italia convert` converte un documento RST in MyST senza modificare l'originale. Sphinx legge l'RST con l'estensione `docs_italia_sphinx`, **senza eseguire il `conf.py`** del repository; ogni pagina viene poi riscritta in MyST.

## Corrispondenze

- `toctree` diventa `toc.json`; un `toctree` numerato dà `numbered: true`, gli altri voci con `numbered: false`.
- Le pagine che non stanno in nessun `toctree` (`:orphan:` o dimenticate) vanno in `hidden`: Sphinx le pubblica e i documenti le linkano. I frammenti usati con `.. include::` non sono pagine e restano fuori, così come i file tipici di un repository (`README`, `LICENSE`…).
- Etichette (`.. _nome:`) e riferimenti (`:ref:`, `:numref:`, `:doc:`, `:term:`) restano etichette e ruoli.
- Avvisi, `topic` e `admonition` diventano avvisi MyST; le classi si conservano.
- Tabelle a griglia e `list-table` diventano `list-table`. Le celle unite perdono l'unione e sono segnalate.
- `:download:` diventa un link al file, che viene copiato.
- `only:: format_html` resta; `only:: format_latex` e `raw:: latex` vengono scartati e segnalati.

## Rapporto

`conversione.json` elenca i nodi non convertiti e il contenuto scartato, con file e riga, i file copiati e gli avvisi di Sphinx. Va rivisto da chi cura il documento prima di adottare la versione MyST.
