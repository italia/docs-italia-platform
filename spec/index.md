# Formato dei documenti Docs Italia

:::{highlights}
Bozza 0 della specifica. Cambia senza preavviso finché non viene pubblicata la versione 1.
:::

Questa specifica descrive come è fatto un documento pubblicabile su Docs Italia e cosa produce la sua build. Serve a chi scrive documenti, a chi scrive strumenti compatibili e a chi installa una propria istanza della piattaforma.

Un documento è un repository Git con tre elementi:

1. `document_settings.yml`: i metadati ({ref}`configurazione`);
2. la sorgente, in MyST o in RST;
3. per MyST, `toc.json`: l'indice dei capitoli ({ref}`indice`).

La build trasforma la sorgente in un **pacchetto** ({ref}`pacchetto`): l'AST di ogni pagina più indice, testi per la ricerca, frammenti per la ricerca semantica, immagini, PDF ed EPUB. Il pacchetto è ciò che un'istanza pubblica.

Gli schemi JSON di `document_settings.yml` e `toc.json` sono in `schemas/` e sono generati dagli stessi schemi usati dal toolkit.

## Parole chiave

*Deve* indica un requisito; *dovrebbe* una raccomandazione; *può* una possibilità.
