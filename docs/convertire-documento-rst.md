# Portare in MyST un documento RST

Guida per chi cura un documento già pubblicato su Docs Italia in reStructuredText (RST, con Sphinx): come convertirlo in MyST, controllare il risultato e passare alla versione MyST senza perdere le versioni pubblicate.

Per un documento nuovo c'è la guida [Creare un nuovo documento in MyST](nuovo-documento-myst.md).

## Serve davvero?

**No, non è obbligatorio.** I documenti RST continuano a funzionare: a ogni build Docs Italia li converte da sé, e il risultato sul sito è lo stesso di questa guida.

Conviene passare a MyST quando il documento è ancora in lavorazione e vuoi:

- scriverlo in una sintassi più semplice, vicina al Markdown;
- usare lo studio nel browser (`docs-italia studio`), che lavora sui file MyST;
- avere controlli con il file e la riga giusti, sui file che scrivi davvero;
- togliere dal repository `conf.py`, `requirements.txt` e gli script di Sphinx.

Per un documento chiuso, che non cambierà più, non serve.

## Cosa succede alle versioni pubblicate

**Nulla.** I tag già pubblicati restano com'erano: sono commit in RST, e se vengono ricostruiti Docs Italia li converte come oggi. La conversione vale dal primo commit in MyST in poi: la bozza appena unisci il branch, e le release dal primo tag successivo.

## Prima di cominciare

- Il **toolkit `docs-italia`**, installato come spiegato in [Creare un nuovo documento in MyST](nuovo-documento-myst.md#installare-il-toolkit). La conversione usa Python con Sphinx: con Docker c'è già; con Bun va preparato una volta, dalla cartella di `docs-italia-platform`:

  ```sh
  python3 -m venv packages/sphinx/.venv
  packages/sphinx/.venv/bin/pip install ./packages/sphinx
  ```

- Un clone del repository del documento, aggiornato.
- Un po' di tempo per rileggere: la conversione è automatica, ma il risultato va guardato pagina per pagina.

## 1. Convertire in una cartella a parte

La conversione **non modifica mai la cartella di origine**: scrive il risultato in un'altra cartella, che deve stare fuori dal repository.

```sh
cd lg-esempio-docs
git switch -c myst                                  # un branch per il passaggio
docs-italia convert . --out ../lg-esempio-docs-myst
```

Il primo argomento è la cartella con `index.rst`: di solito la radice del repository (`.`), a volte `docs/it`, `docs`, `rst` o `src`.

Con Docker, la cartella di uscita deve essere visibile al container: si monta la cartella che contiene entrambe.

```sh
docker run --rm -it -v "$PWD/..":/lavoro -w /lavoro/lg-esempio-docs docs-italia-toolkit:dev \
  convert . --out ../lg-esempio-docs-myst
```

Nella cartella di uscita trovi:

| File | Cosa contiene |
|---|---|
| `*.md` | Le pagine, una per ogni file `.rst`, nelle stesse cartelle |
| `toc.json` | L'indice, ricavato dai `toctree` |
| `document_settings.yml` | Lo stesso del repository, con `format: myst` (commenti e campi conservati) |
| immagini e allegati | I file citati dalle pagine, copiati |
| `conversione.json` | Il rapporto: cosa non è stato convertito e dove |

**Il `conf.py` non viene eseguito.** Se ne leggono solo le impostazioni che servono, come `autosectionlabel`. Le estensioni di Sphinx che usava (mermaid, plantuml…) non ci sono: le loro direttive restano nel testo e il controllo le segnala.

## 2. Leggere il rapporto

Alla fine `convert` stampa un riepilogo:

```
Pagine: 16 · file copiati: 12
Nodi non convertiti: nessuno
Contenuto scartato: tabella con celle unite (unione persa) (1)
Avvisi di Sphinx: 14 (in conversione.json)
```

In `conversione.json` ogni voce ha file e riga.

| Voce | Cosa vuol dire | Cosa fare |
|---|---|---|
| **Nodi non convertiti** | Costrutti RST che il convertitore non conosce: il testo resta, la forma no | Riscriverli in MyST |
| `tabella con celle unite` | Le celle unite di una tabella a griglia diventano celle separate | Rivedere la tabella: spesso basta ripetere il testo, o dividerla |
| `only:: format_latex`, `raw:: latex` | Contenuto che oggi compare solo nel PDF di LaTeX | Decidere se serve: il PDF nuovo è fatto dalla stessa pagina del sito |
| `commento che sembra una direttiva` | `.. code-block::java` senza spazio dopo `::`: per l'RST è un commento, e non è pubblicato nemmeno oggi | Il blocco è sparito anche dal sito attuale: rimetterlo in MyST |
| `etichetta ripetuta` | La stessa etichetta in due punti | Rinominarne una |
| **File citati ma assenti** | Immagini o allegati che il documento cita ma che non sono nel repository | Rotti anche sul sito attuale: aggiungerli o togliere il riferimento |
| **Avvisi di Sphinx** | Gli stessi avvisi che dà oggi la build | Utili per capire i problemi del sorgente |

## 3. Controllare e guardare il risultato

```sh
docs-italia check --dir ../lg-esempio-docs-myst
docs-italia dev   --dir ../lg-esempio-docs-myst      # anteprima su http://127.0.0.1:4321
```

Confronta l'anteprima con il documento su docs.italia.it, pagina per pagina. Le differenze più frequenti:

- **Contenuto incluso.** Con `.. include::` un frammento compariva in più pagine. Nella conversione il testo viene copiato in ognuna: dopo il passaggio, una modifica va fatta in ogni pagina.
- **Pagine orfane.** Le pagine fuori da ogni `toctree` (per esempio `istruzioni_consultazione`) finiscono in `hidden` di `toc.json`: sono pubblicate e linkabili, ma fuori dall'indice. Se una era solo un residuo, toglila dal repository e da `hidden`.
- **Glossario.** `.. glossary::` diventa `{glossary}` e `:term:` diventa `{term}`: i termini si linkano come prima.
- **Riferimenti rotti.** `broken-ref` e `broken-link` sono quasi sempre rotti anche sul sito attuale. I casi tipici sono ancore copiate da Word (`#_Toc…`, `#_bookmark…`), link a pagine rimosse e indirizzi senza `https://`. È il momento giusto per correggerli.
- **Numeri delle figure.** Se il `conf.py` aveva `numfig = True`, metti `"numfig": true` in `toc.json`.
- **Lingua.** Se il documento non è in italiano e `document_settings.yml` non lo dice, aggiungi `languages: [en]`.

Gli errori del controllo non bloccano la pubblicazione, ma conviene arrivare a zero, o almeno sapere quali restano e perché.

## 4. Sostituire i sorgenti nel repository

Nel branch `myst`, togli i file RST e quelli di Sphinx e copia al loro posto il risultato della conversione (senza il rapporto).

```sh
# 1. i sorgenti RST e i file che servivano solo a Sphinx (adatta l'elenco al repository)
git rm -r --ignore-unmatch -- '*.rst' conf.py requirements.txt Makefile make.bat _static _templates

# 2. il risultato della conversione, nella radice del repository
rsync -a --exclude conversione.json ../lg-esempio-docs-myst/ ./

# 3. i file generati restano fuori dal repository
printf 'dist/\n.docs-italia/\n' >> .gitignore

git add -A
git status
```

- Tieni `README.md`, `LICENSE`, `.github/` e tutto ciò che non riguarda la build.
- Se il repository ha script propri per Sphinx (per esempio per i diagrammi), toglili solo se servivano soltanto alla build.
- Se la sorgente era in una sottocartella (`docs/it`), metti comunque il risultato nella **radice** e togli la sottocartella. `document_settings.yml` sta sempre nella radice; se preferisci tenere le pagine in una cartella, indicala con `source: docs`.
- Git riconosce quasi tutti i file come **rinominati** (`.rst` → `.md`): la storia di ogni pagina si conserva.

Controlla di nuovo, questa volta nel repository:

```sh
docs-italia check
docs-italia dev
```

## 5. Proporre e unire il passaggio

```sh
git commit -m "Passaggio a MyST"
git push -u origin myst
```

Apri una pull request dal branch `myst`, così chi lavora al documento può rivedere il passaggio. Le anteprime delle pull request su Docs Italia non ci sono ancora: per rivederlo si usa `docs-italia dev` sul branch.

Quando la pull request è unita al branch principale:

- la **bozza** su Docs Italia viene ricostruita dai file MyST, senza conversione;
- il **prossimo tag** sarà la prima release in MyST;
- le release precedenti restano quelle di prima.

Non serve cambiare nulla in `italia-conf`: il documento è lo stesso.

## Se qualcosa va storto

- **Prima di unire**: basta cancellare il branch `myst`. Il branch principale non è stato toccato.
- **Dopo aver unito**: annulla il merge con `git revert -m 1 <commit del merge>` e fai il push. La bozza torna a essere costruita dall'RST.

## Problemi frequenti

| Cosa succede | Perché | Cosa fare |
|---|---|---|
| `convert` dice "manca index.rst" | La cartella indicata non è quella della sorgente | Indica la cartella con `index.rst` (`docs/it`, `docs`, `rst`…) |
| "la cartella di uscita non può stare dentro quella di origine" | `--out` punta dentro il repository | Usa una cartella fuori, per esempio `../nome-myst` |
| "Sphinx non riuscito" | Python o Sphinx non installati (con Bun) | Prepara l'ambiente Python come sopra, o usa Docker |
| Una direttiva compare come "costrutto non supportato" | Veniva da un'estensione del `conf.py` | Riscriverla in MyST, o sostituirla con un'immagine |
| Una pagina manca dal sito dopo il passaggio | Non è in `toc.json` | Aggiungila a `chapters` o a `hidden` |
| Il PDF è diverso da quello di prima | Il PDF nuovo è generato dalla pagina del sito, non da LaTeX | È atteso: controlla che il contenuto ci sia tutto |
