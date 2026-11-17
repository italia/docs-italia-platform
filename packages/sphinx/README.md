# docs-italia-sphinx

Estensione Sphinx di Docs Italia, in Python. È l'unico pacchetto non TypeScript: serve a leggere i documenti RST esistenti.

## Compiti

- Builder `docsitalia` che serializza il doctree risolto nel pacchetto di Docs Italia (stesso formato prodotto dal toolkit per MyST).
- Conversione doctree → AST MyST, con un nodo HTML di ripiego per i nodi non ancora mappati.
- Direttive e ruoli di Docs Italia per l'RST (`forum_italia`, `plantuml`, `only`, ruoli HTTP).
- Banco di prova: costruisce tutte le versioni pubblicate e produce un rapporto di compatibilità.

Il `conf.py` dei repository non viene eseguito.

## Stato

Funzionante per la conversione: il builder `docsitalia-ast` scrive l'AST MyST di ogni pagina, `toc.json` e `report.json`, e `docs-italia convert` lo usa per riscrivere il documento in MyST. Provato su `agid/lg-accessibilita-docs`: 11 pagine, nessun nodo perso, il 96,6% delle parole dell'uscita testuale di Sphinx (la differenza sono i numeri delle sezioni).

```sh
python3 -m venv packages/sphinx/.venv
packages/sphinx/.venv/bin/pip install -e packages/sphinx
bun run docs-italia convert <documento-rst> --out <cartella>
```

Richiede Sphinx 9 (Python 3.12+).

Piano di progetto: sezioni 3.1, 3.6, fase 1.
