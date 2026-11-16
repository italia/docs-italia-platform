# docs-italia-sphinx

Estensione Sphinx di Docs Italia, in Python. È l'unico pacchetto non TypeScript: serve a leggere i documenti RST esistenti.

## Compiti

- Builder `docsitalia` che serializza il doctree risolto nel pacchetto di Docs Italia (stesso formato prodotto dal toolkit per MyST).
- Conversione doctree → AST MyST, con un nodo HTML di ripiego per i nodi non ancora mappati.
- Direttive e ruoli di Docs Italia per l'RST (`forum_italia`, `plantuml`, `only`, ruoli HTTP).
- Banco di prova: costruisce tutte le versioni pubblicate e produce un rapporto di compatibilità.

Il `conf.py` dei repository non viene eseguito: si leggono solo valori noti.

Piano di progetto: sezioni 3.1, 3.6, fase 1.
