# Creare un nuovo documento in MyST

Guida per chi cura un documento in un'amministrazione: come creare il repository di un documento nuovo, scriverlo in MyST, vederlo in anteprima e pubblicarlo su Docs Italia.

Per un documento che esiste già in RST c'è la guida [Portare in MyST un documento RST](convertire-documento-rst.md).

## In breve

1. Crei un repository GitHub nell'organizzazione della tua amministrazione e lo prepari con `docs-italia init`.
2. Scrivi le pagine in file `.md` (MyST) e le metti in ordine in `toc.json`.
3. Controlli con `docs-italia check` e guardi l'anteprima con `docs-italia dev`.
4. Fai il commit e il push, poi aggiungi il repository a `italia-conf` della tua amministrazione: la bozza compare su Docs Italia.
5. Per pubblicare una versione crei un tag (`1.0`): diventa la versione stabile.

## Prima di cominciare

- **Un'organizzazione GitHub collegata a Docs Italia**: quella della tua amministrazione, con il suo repository `italia-conf`. Se non è ancora collegata, se ne occupa chi amministra l'istanza (guida [Collegare un'organizzazione GitHub](collegare-organizzazioni.md)).
- **Il permesso di creare repository** nell'organizzazione, e di proporre modifiche a `italia-conf`.
- **Git** e un editor di testo. Va bene qualunque editor; il toolkit ha anche uno studio nel browser (più sotto).
- **Il toolkit `docs-italia`**, con Docker oppure con Bun (vedi sotto).

## Installare il toolkit

Il toolkit non è ancora pubblicato come pacchetto o come immagine pronta: per ora si prende dal repository della piattaforma.

### Con Docker (consigliato)

Contiene tutto: anche Chromium per il PDF e Python con Sphinx per i documenti RST.

```sh
git clone https://github.com/italia/docs-italia-platform.git
cd docs-italia-platform
docker build -f deploy/toolkit/Dockerfile -t docs-italia-toolkit:dev .   # una volta; l'immagine pesa circa 1,7 GB
```

Poi, dalla cartella del documento:

```sh
alias docs-italia='docker run --rm -it -v "$PWD":/documento docs-italia-toolkit:dev'
docs-italia help
```

Per l'anteprima e lo studio serve anche la porta: `docker run --rm -it -v "$PWD":/documento -p 127.0.0.1:4321:4321 docs-italia-toolkit:dev dev`. Più comodo: copia nel repository del documento il file [`examples/esempio-myst/compose.yml`](../examples/esempio-myst/compose.yml), poi usa `docker compose up anteprima` (http://127.0.0.1:4321) e `docker compose up studio` (http://127.0.0.1:4322).

Su Linux i file creati dal container appartengono a `root`: se serve, `sudo chown -R "$USER" .` nella cartella del documento.

### Con Bun

Serve [Bun](https://bun.sh) 1.4.4 (la versione è in `.bun-version`). Per il PDF serve anche Google Chrome installato.

```sh
git clone https://github.com/italia/docs-italia-platform.git
cd docs-italia-platform && bun install
alias docs-italia="bun $PWD/packages/toolkit/bin/docs-italia.ts"
```

Senza Chrome il comando `build` si ferma al PDF: usa `docs-italia build --html --epub` per costruire il resto.

## 1. Creare il repository

1. Su GitHub, nell'organizzazione della tua amministrazione: **New repository**. Il nome finisce di solito con `-docs`, per esempio `lg-esempio-docs`: diventa parte dell'indirizzo del documento. Il repository deve essere **pubblico**.
2. Clonalo e preparalo:

   ```sh
   git clone https://github.com/<organizzazione>/lg-esempio-docs.git
   cd lg-esempio-docs
   docs-italia init
   ```

`init` crea questi file e non sovrascrive quelli che ci sono già:

| File | A che serve |
|---|---|
| `document_settings.yml` | Titolo, descrizione, argomenti, formato e versioni del documento |
| `toc.json` | L'indice: quali pagine ci sono e in che ordine |
| `index.md` | La pagina iniziale |
| `introduzione.md` | Un primo capitolo di esempio |
| `images/` | Cartella per le immagini |
| `.gitignore` | Esclude dal repository i file generati (`dist/`, `.docs-italia/`) |
| `package.json` | Servirà quando il toolkit sarà pubblicato come pacchetto; per ora puoi cancellarlo |

## 2. Descrivere il documento: `document_settings.yml`

```yaml
document:
  name: "Linee guida di esempio"
  description: "A chi sono rivolte e che cosa stabiliscono, in una o due frasi."
  tags:
    - linee guida
    - interoperabilità
  format: myst
  languages: [it]
  downloads: [pdf, epub, html]
```

- `name`, `description` e `tags` sono obbligatori. I `tags` sono gli argomenti del documento; l'istanza tiene solo quelli del suo vocabolario.
- `format: myst` dice che le pagine sono in MyST: non va tolto.
- `downloads`: i formati scaricabili dal sito.
- Le versioni si regolano con `versions` (vedi il punto 7).

Tutti i campi sono descritti nella [specifica](../spec/capitoli/configurazione.md).

## 3. Scrivere le pagine

Ogni pagina è un file `.md`, e **comincia con un titolo di primo livello**:

```md
# Ambito di applicazione

Testo del capitolo.

## Soggetti destinatari

…
```

Le sezioni (`##`, `###`) vengono numerate da sole ("2.1", "2.1.1"): non scrivere i numeri nei titoli. Non saltare livelli (da `##` a `####`): il controllo lo segnala, perché pesa sull'accessibilità.

### Le cose che servono più spesso

**Avvisi**

```md
:::{note}
Testo della nota.
:::

:::{warning}
Attenzione a…
:::
```

Ci sono anche `tip`, `important`, `danger` e l'avviso con titolo libero `{admonition} Titolo`.

**Immagini e figure**, sempre con il testo alternativo:

````md
```{figure} images/architettura.png
:alt: Schema dell'architettura: il cittadino, l'ente e la piattaforma
:name: fig-architettura

Architettura della piattaforma.
```
````

**Tabelle**

```md
| Campo | Obbligatorio |
|---|---|
| name | sì |
```

Per le tabelle con didascalia o con celle che contengono elenchi si usa `{list-table}`: c'è un esempio nella [specifica](../spec/capitoli/configurazione.md).

**Link e riferimenti**

```md
Vedi [il capitolo sui requisiti](requisiti.md) o [una sua sezione](requisiti.md#sicurezza).

(req-sicurezza)=
## Requisiti di sicurezza

Più avanti: come descritto in {ref}`req-sicurezza`, e nella {numref}`fig-architettura`.
```

- un link a un altro file `.md` porta a quella pagina;
- `(nome)=` prima di un titolo, di una figura o di un paragrafo crea un'etichetta; `{ref}` la cita col suo titolo, `{numref}` col numero ("Figura 2.1");
- un link a un file del repository (un PDF in `allegati/`, per esempio) lo rende scaricabile.

**Note a piè di pagina**

```md
Come previsto dal regolamento[^eidas].

[^eidas]: Regolamento (UE) n. 910/2014.
```

**Glossario**

```md
:::{glossary}
Erogatore
: L'amministrazione che fornisce il servizio.
:::

Ogni {term}`erogatore` deve…
```

**Discussione su Forum Italia** (per le consultazioni)

```md
:::{forum_italia}
:topic_id: 12345
:::
```

L'HTML scritto a mano nelle pagine non viene pubblicato. Le estensioni di Docs Italia e le regole del testo sono nel capitolo [Sorgente MyST](../spec/capitoli/myst.md) della specifica.

## 4. L'indice: `toc.json`

```json
{
  "root": "index.md",
  "caption": "Indice dei contenuti",
  "numbered": true,
  "numfig": true,
  "chapters": [
    { "file": "introduzione.md" },
    { "file": "requisiti.md", "children": [{ "file": "requisiti/sicurezza.md" }] },
    { "file": "allegati/glossario.md", "numbered": false }
  ],
  "hidden": ["istruzioni-consultazione.md"]
}
```

- `chapters` elenca i capitoli in ordine; `children` crea sottocapitoli.
- `numfig: true` mostra il numero nelle didascalie di figure e tabelle ("Figura 2.1"): serve se usi `{numref}`.
- `numbered: false` su una voce toglie il numero a lei e ai suoi figli: serve per allegati e appendici.
- `hidden` elenca le pagine da pubblicare ma da tenere fuori dall'indice, dal PDF e dalla pagina singola, come le istruzioni per una consultazione pubblica: si raggiungono solo con un link.
- Un file `.md` che non compare né in `chapters` né in `hidden` non viene pubblicato: il controllo lo segnala.

## 5. Anteprima e controllo

```sh
docs-italia dev       # anteprima su http://127.0.0.1:4321, si aggiorna a ogni salvataggio
docs-italia studio    # studio nel browser su http://127.0.0.1:4322: editor, anteprima, struttura, commit in locale (il push resta da fare)
docs-italia check     # controlli: metadati, indice, link, immagini, riferimenti, accessibilità
```

Nello studio puoi scrivere nel **sorgente** o nella vista **visuale**: la pagina si vede come nel sito, un clic su un blocco lo apre (testo, avvisi, figure, tabelle, codice) e solo quel blocco viene riscritto nel file. Il resto resta com'era, quindi le modifiche fatte a mano e quelle visuali convivono.

`check` divide i problemi in **errori** (✖) e **avvisi** (⚠), con file e riga. Un errore non blocca la pubblicazione, ma va corretto: è quello che vedrebbe chi legge.

| Problema | Cosa vuol dire |
|---|---|
| `no-title` | La pagina non comincia con `# Titolo` |
| `broken-link`, `broken-anchor` | Link a una pagina o a un'ancora che non esiste |
| `broken-ref` | `{ref}` o `{numref}` a un'etichetta che non esiste |
| `missing-image` | Immagine non trovata nel repository |
| `not-in-toc` | Pagina che non compare in `toc.json`: non verrebbe pubblicata |
| `alt` | Immagine senza testo alternativo |
| `heading-skip` | Titoli che saltano un livello |
| `unsupported` | Direttiva o ruolo che Docs Italia non conosce |

Per vedere anche PDF ed EPUB: `docs-italia build`, poi apri `dist/downloads/`. La cartella `dist/` non va nel repository.

## 6. Pubblicare la bozza

1. Fai il commit e il push sul branch principale:

   ```sh
   git add -A && git commit -m "Prima stesura" && git push
   ```

2. Aggiungi il documento a **`italia-conf`** della tua amministrazione. In `projects_settings.yml`, aggiungi il nome del repository ai `documents` di un progetto, oppure crea un progetto nuovo:

   ```yaml
   projects:
     - name: Linee guida
       short_name: linee-guida
       description: Le linee guida dell'amministrazione.
       documents:
         - lg-esempio-docs
   ```

   La modifica si propone con una pull request, se `italia-conf` lo prevede.

3. Quando la modifica è sul branch principale di `italia-conf`, Docs Italia legge il nuovo elenco e costruisce la **bozza**. In pochi minuti il documento è su:

   `https://docs.italia.it/<organizzazione>/<progetto>/lg-esempio-docs/it/bozza/`

   `<progetto>` è lo `short_name` del progetto (o il nome), in minuscolo e con i trattini.

Da qui in poi **ogni push sul branch principale aggiorna la bozza**.

## 7. Pubblicare una versione

Una versione numerata si pubblica con un **tag**:

```sh
git tag 1.0
git push origin 1.0
```

Docs Italia la costruisce e la pubblica su `…/it/1.0/`. L'indirizzo `…/it/stabile/` porta alla **versione predefinita**:

- senza indicazioni, è la release con il numero più alto (`1.10` viene dopo `1.9`), o la bozza se non c'è ancora nessuna release;
- per sceglierla a mano, in `document_settings.yml`:

  ```yaml
    versions:
      default: "1.0"        # oppure latest-release: la release più recente
  ```

Altre regole utili:

- **Una release non si corregge spostando il tag**: si fa una release nuova (`1.0.1`). I tag sono la fotografia di ciò che è stato pubblicato.
- **Per la bozza** si può usare un branch diverso dal principale con `versions.draft: sviluppo`.
- `versions.releases: none` ignora i tag: resta solo la bozza. Il valore `github-releases`, che userà le release di GitHub, non è ancora supportato e per ora si comporta come `none`.
- Per **ritirare** una versione pubblicata per errore, chiedi a chi amministra l'istanza: si fa dalla dashboard, senza toccare il repository.

## Problemi frequenti

| Cosa succede | Perché | Cosa fare |
|---|---|---|
| Il documento non compare su Docs Italia | Non è in `italia-conf`, oppure la modifica di `italia-conf` non è sul branch principale | Controlla `projects_settings.yml` |
| Compare, ma senza contenuto aggiornato | Il push non è sul branch della bozza | Controlla il branch, o `versions.draft` |
| Il tag non diventa una versione | `versions.releases` è `none` o `github-releases` | Togli l'impostazione o usa `tags` |
| Una pagina non è nel sito | Non è in `toc.json` | Aggiungila a `chapters` o a `hidden` |
| Immagine assente nel PDF | Percorso sbagliato, o immagine esterna (`https://…`) | Metti l'immagine nel repository e controlla il percorso |
| Un link a un'altra pagina è rotto | Il link punta a `pagina.html` invece che a `pagina.md` | Linka il file `.md` |
