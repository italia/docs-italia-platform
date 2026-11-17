(myst)=
# Sorgente MyST

La sorgente è [MyST](https://mystmd.org): CommonMark con direttive (`:::{note}`) e ruoli (`` {ref}`etichetta` ``).

## Estensioni di Docs Italia

:::{list-table} Direttive e ruoli aggiunti da Docs Italia.
:header-rows: 1
:name: tab-estensioni

* - Nome
  - Tipo
  - Uso
* - `highlights`
  - direttiva
  - Testo in evidenza in apertura, come in docutils.
* - `forum_italia` (alias `forum`, `discourse`)
  - direttiva
  - Discussione su Forum Italia; opzioni `topic_id`, `scope`. Nel sito diventa un link; nel PDF e nell'EPUB non compare.
* - `rfc`
  - ruolo
  - Link a una RFC: `` {rfc}`7519` ``.
:::

Le classi degli avvisi `testo-suggerito` ed `esempio` hanno uno stile proprio.

## Regole del testo

- Le virgolette e gli apostrofi restano come sono scritti: la sorgente non viene trasformata.
- L'HTML grezzo non viene pubblicato.
- I link ammessi sono `http`, `https`, `mailto`, `tel`, i link ad altri file `.md` (anche con ancora) e i link a file della sorgente, che diventano scaricabili.
- Le immagini dovrebbero avere un testo alternativo: il controllo segnala quelle che non ce l'hanno.
- I titoli non dovrebbero saltare livelli.

## Non supportato

- L'opzione `:widths:` di `list-table`.
- Le direttive `only` e `raw` della piattaforma attuale; nella conversione dall'RST il contenuto per la sola stampa viene scartato e segnalato.
