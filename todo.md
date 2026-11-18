# Nuovo Docs Italia — piano

Versione 6 · 17 novembre 2026 — adottato MyST; aggiunti RAG e server MCP; risultati del PoC del toolkit (sezione 12); dashboard di amministrazione (6.6)

## Sintesi

Obiettivi:

1. **Salvare ciò che c'è oggi** e ripopolare un nuovo Docs Italia partendo dai repository GitHub, senza dipendere dal database di Read the Docs.
2. **Due formati di documento**: l'RST attuale, invariato, e un nuovo formato Markdown più semplice, con l'alberatura del documento in un file JSON. Entrambi producono lo stesso albero sintattico (AST).
3. **Build e anteprima nei repository**: ogni documento si costruisce e si visualizza in locale e in CI, come fa oggi `eid-wallet-it-docs`. Docs Italia riceve un pacchetto già pronto e lo pubblica.
4. **Editor nel repository**: un'applicazione avviabile con Docker Compose, con SQLite per lo stato locale, che domani ospiterà un editor visuale per il Markdown.
5. **Contenuti interrogabili da sistemi di intelligenza artificiale**: i documenti pubblicati vengono indicizzati in un database vettoriale, e un server MCP (Model Context Protocol) espone ricerca e lettura agli assistenti e agli agenti (RAG, *retrieval-augmented generation*).
6. **Piattaforma riusabile**: server TypeScript, sito Astro, PostgreSQL, file server, editor Vite + React; il tutto installabile da altre PA come propria istanza.

Le scelte principali:

- **Il formato Markdown è MyST** (decisione presa), non Markdown semplice. MyST è un'estensione di CommonMark con direttive e ruoli equivalenti a quelli Sphinx, ha un parser TypeScript, un AST documentato e un serializzatore che riscrive l'AST in Markdown. Due repository del corpus lo usano già.
- **Un solo AST per i due formati**: l'AST di MyST. L'RST viene letto da Sphinx e convertito in quell'AST; il MyST viene letto direttamente in TypeScript. Sito, PDF, EPUB, ricerca ed editor lavorano tutti sull'AST, senza sapere da quale formato viene.
- **L'unità di pubblicazione è un pacchetto** (AST, indice, risorse, PDF, EPUB). Lo producono allo stesso modo la CLI in locale, la GitHub Action nel repository e il worker della piattaforma.
- **Ricerca e RAG partono dagli stessi dati**: le sezioni del pacchetto alimentano sia la ricerca testuale del sito sia gli embedding. Gli embedding vivono in PostgreSQL con pgvector, quindi non serve un secondo database.
- **Le versioni non ricostruibili** con la toolchain nuova vengono pubblicate come **versioni archiviate**, cioè l'HTML e i file scaricabili prodotti oggi, serviti così come sono.

---

## 1. Lo stato di partenza

### 1.1 Cosa espone il sito oggi

Il sito è attivo e l'API pubblica di Read the Docs risponde. Da lì ho estratto l'inventario completo, salvato in [inventario/docs-italia-api-snapshot.json](inventario/docs-italia-api-snapshot.json):

| | |
|---|---|
| Documenti pubblicati | 105 (100 in italiano, 5 in inglese) |
| Publisher | 6: Italia (71 documenti), AgID (21), INGV (6), Team per la Trasformazione Digitale (3), ICDP – Ministero della Cultura (1), PagoPA (1) |
| Versioni attive | 205: 130 da tag, 75 da branch; 51 documenti hanno una sola versione, il massimo è 36 |
| Versione predefinita | `bozza` (42), `stabile` (24), `versione-corrente` (14), altre (25) |

Per ogni versione l'API dà il riferimento Git esatto (il branch, oppure il commit del tag) e i link a PDF, EPUB e HTML compresso. È esattamente l'informazione che temevo esistesse solo nel database: **il dump di Read the Docs non è più indispensabile**.

Resta fuori dall'API, e va recuperato con altri mezzi:

| Informazione | Come recuperarla |
|---|---|
| Percorso della sorgente nel repository (`conf.py` in `docs/it`, `/rst`, `/src`) | Ricerca automatica nel repository (vedi 2.2); i casi ambigui sono pochi e si correggono a mano |
| Ordine dei documenti e progetti in evidenza | Lettura della home e delle pagine publisher del sito attuale |
| Vocabolario dei tag ammessi | Unione dei tag in uso, più il file `tags_vocabulary.py` del fork |
| Redirect personalizzati | Non esposti. Se esistono, servono dal database; altrimenti si accetta di perderli |
| Account utente | Non servono: l'accesso passerà da GitHub e dal nuovo sistema di autenticazione |

### 1.2 Cosa c'è su GitHub

Ho interrogato GitHub su tutti i documenti dichiarati negli `italia-conf` di Italia, AgID e Team Digitale ([inventario/github-scan-italia-agid-teamdigitale.tsv](inventario/github-scan-italia-agid-teamdigitale.tsv)):

- 102 repository esistono, 7 sono archiviati. Due voci (`comuni`, `anagrafe`) sono tag finiti per errore nell'elenco `documents` di un progetto.
- Branch predefinito: `master` 71, `main` 16, `versione-corrente` 13, altri 2. Il fork legge i metadati sempre da `master`, quindi per circa 30 repository oggi li legge dal branch sbagliato o da uno che non esiste.
- 100 su 102 hanno `document_settings.yml`; 40 hanno un `conf.py` proprio; 14 tengono la sorgente fuori dalla radice (`docs/`, `rst/`, `src/`).
- 53 repository hanno tag. 11 hanno un branch `gh-pages`, cioè già una forma di pubblicazione propria.
- Attività: 35 repository non ricevono modifiche dal 2020, 23 sono stati modificati nel 2025 o nel 2026.

Il repository di esempio `design-UX-cittadini-once-only-docs` mostra un'abitudine diffusa: branch chiamati `bozza` e `versione-corrente`, cioè i nomi delle versioni di Read the Docs riportati dentro Git.

### 1.3 Il contenuto

Sui 40 repository clonati in locale: circa 145.000 righe di RST. Le direttive più usate sono `list-table` (675), `code-block` (512), `note` (449), `include` (286), `figure` (284), `forum_italia` (257), `toctree` (219), `only` (176), `literalinclude` (171), `plantuml` (108). I ruoli più usati sono `:ref:` (2.630) e `:rfc:` (1.255). Ci sono 1.528 righe di tabelle a griglia e 346 note a piè di pagina.

`eid-wallet-it-docs` ha già il modello che vogliamo generalizzare: build HTML e PDF in GitHub Actions, anteprima per ogni pull request, versione per ogni release, indice delle versioni. È anche il caso più pesante (1 GB, tema proprio).

---

## 2. Salvataggio e ripopolamento

### 2.1 Fotografia dell'esistente (da fare per prima)

> La fotografia verrà fatta su cloud, fuori da questo lavoro.

Indipendente da tutto il resto, da fare finché il sito è attivo:

1. **Inventario**: fatto. È il file in `inventario/`.
2. **File scaricabili**: download di PDF, EPUB e HTML compresso per tutte le 205 versioni, partendo dai link dell'inventario.
3. **Copia dell'HTML pubblicato** di tutte le versioni, con un crawler limitato al dominio.
4. **Elenco di tutti gli URL pubblici**, dalla sitemap e dal crawl: servirà a verificare che il nuovo sito non rompa link.
5. **Ordine e progetti in evidenza**, letti da home e pagine publisher.
6. Facoltativo: il dump del database, se è facile ottenerlo, conservato a parte come riferimento.

Questa fotografia non è il punto di partenza del nuovo sistema. È la rete di sicurezza: alimenta le versioni archiviate (2.3) e il test di non regressione degli URL.

### 2.2 Ripopolamento dai repository

Il nuovo sistema si popola da GitHub con un importatore, e lo stesso importatore resta in funzione per la sincronizzazione continua:

1. Per ogni publisher configurato nell'istanza legge `italia-conf` dal **branch predefinito**: `publisher_settings.yml` e `projects_settings.yml`. Le regole di validazione sono le stesse del fork (`docsitalia/metadata.py`): campi obbligatori, slug, tag filtrati sul vocabolario.
2. Per ogni documento elencato legge `document_settings.yml` e individua la sorgente: formato (RST o MyST), radice dei documenti, lingue. Ordine di ricerca: campo esplicito in `document_settings.yml`; `conf.py` o `index.rst` alla radice; `docs/<lingua>/`; `docs/`, `rst/`, `src/`.
3. **Prima importazione**: le versioni da pubblicare e la versione predefinita vengono dall'inventario dell'API. Il riferimento Git è già esatto.
4. **Da lì in poi** le versioni si decidono nel repository (sezione 4.4), e l'inventario non serve più.
5. Ogni versione viene costruita con la toolchain nuova (sezione 4). Se la build fallisce, la versione viene pubblicata come archiviata e finisce in un elenco di lavoro.

### 2.3 Versioni archiviate

Molti tag risalgono al 2018–2020 e sono stati scritti per Sphinx 1.8. Pretendere che tutti si ricostruiscano con strumenti attuali è il modo più sicuro per bloccare la migrazione.

Una versione archiviata è l'HTML e i file scaricabili presi dalla fotografia, serviti agli stessi URL, con una cornice del nuovo sito (intestazione, selettore di versione, avviso "versione archiviata"). Non ha AST, quindi non entra nella ricerca a livello di sezione e non è modificabile, ma resta consultabile e scaricabile.

Regola pratica: la versione predefinita di ogni documento deve essere ricostruita con la toolchain nuova; le versioni storiche possono restare archiviate.

---

## 3. Formato dei documenti

### 3.1 Due formati, un AST

| | Formato RST (attuale) | Formato MyST (nuovo) |
|---|---|---|
| File | `.rst`, `conf.py` facoltativo | `.md` |
| Alberatura | `toctree` dentro i file | `toc.json` |
| Lettura | Sphinx, in Python | `myst-parser`, in TypeScript |
| AST | doctree Sphinx convertito in AST MyST | AST MyST nativo |
| Editor visuale | No: sorgente con anteprima | Sì |

Il formato si dichiara in `document_settings.yml`. Se manca, vale RST: i repository esistenti continuano a funzionare senza modifiche.

### 3.2 Perché MyST e non Markdown semplice (decisione presa)

Markdown semplice (CommonMark, anche con le estensioni GFM) non ha avvisi, figure con didascalia, riferimenti incrociati numerati, glossario, inclusione di file. Il corpus li usa migliaia di volte. Aggiungerli significa inventare una sintassi propria, scrivere un parser e mantenerlo.

MyST (Markedly Structured Text) risolve già questo problema:

- È CommonMark più direttive (```` ```{note} ```` o `:::{note}`) e ruoli (`` {ref}`etichetta` ``) con gli stessi nomi di Sphinx. Chi conosce l'RST di Docs Italia trova gli stessi concetti.
- Ha un parser TypeScript (`myst-parser`) che produce un AST basato su mdast, con una specifica pubblica (`myst-spec`).
- Ha un serializzatore (`myst-to-md`) che riscrive l'AST in Markdown: è quello che serve all'editor visuale.
- Sphinx lo legge con `myst_parser`, quindi un repository RST può aggiungere capitoli MyST, e la migrazione può essere graduale.
- `eid-wallet-it-docs` e `dati-semantic-guida-ndc-docs` lo usano già, tramite `myst_parser`.

Prendiamo da MyST il linguaggio, il parser, l'AST e il serializzatore. Non usiamo il suo generatore di siti: il sito è Astro.

### 3.3 Corrispondenza dei costrutti più usati

| RST oggi | MyST | Note |
|---|---|---|
| `toctree` | `toc.json` | L'alberatura esce dai file |
| `:ref:`, `:numref:`, `:doc:`, `:term:` | `{ref}`, `{numref}`, `{doc}`, `{term}` o link `[testo](#etichetta)` | Etichette con `(etichetta)=` prima del titolo |
| `note`, `warning`, `important`, `tip`, `admonition`, `seealso` | Stesse direttive | |
| `list-table` | `{list-table}`, oppure tabella GFM se semplice | MyST non accetta `:widths:` (verificato nel PoC): serve una `list-table` di Docs Italia che lo accetti, o l'opzione a monte |
| Tabelle a griglia | `{list-table}` | Le celle unite vanno ripensate: è il caso più costoso nella conversione |
| `figure`, `image` | Stesse direttive, o `![]()` | |
| `code-block`, `literalinclude`, `include` | Blocco recintato con linguaggio, `{literalinclude}`, `{include}` | |
| `glossary` | `{glossary}` | |
| Note a piè di pagina | `[^1]` | |
| `mermaid` | `{mermaid}` | |
| `plantuml` | Direttiva `{plantuml}` di Docs Italia | Resa in SVG durante la build |
| `forum_italia`, `discourse` | Direttiva `{forum}` di Docs Italia | Da decidere se mantenerla |
| `:rfc:`, ruoli HTTP, `:xml:`, `:mimetype:` | Ruoli di Docs Italia | Definiti una volta nel toolkit; `{rfc}` già scritto nel PoC |
| `highlights`, `epigraph` | `{highlights}` di Docs Italia, `{epigraph}` di MyST | `highlights` non esiste in MyST: scritta nel PoC come prima direttiva Docs Italia |
| `only:: format_html` / `format_latex` | Direttiva `{only}` con valori `web` e `stampa` | |
| `raw:: latex` | Non supportato | 8 occorrenze in tutto il corpus |

### 3.4 `toc.json`

Stessa forma della `toc` di MyST, così gli strumenti esistenti la capiscono:

```json
{
  "$schema": "https://docs.italia.it/schema/toc/1.json",
  "root": "index.md",
  "numbered": true,
  "chapters": [
    { "file": "introduzione.md" },
    {
      "file": "architettura/index.md",
      "children": [
        { "file": "architettura/componenti.md" },
        { "file": "architettura/sicurezza.md", "title": "Sicurezza" }
      ]
    },
    { "title": "Allegati", "children": [{ "file": "allegati/a.md" }] }
  ]
}
```

Regole, per non avere due fonti di verità:

- `toc.json` elenca **file** e il loro ordine. I titoli e le sezioni dentro un file vengono dai titoli del Markdown; `title` serve solo a sovrascrivere.
- Ogni file è una pagina nella vista a capitoli. La vista a pagina singola concatena i file nell'ordine della `toc`.
- La build segnala come errore un file `.md` non elencato e una voce che punta a un file inesistente.
- `numfig: true` mostra il numero nelle didascalie ("Figura 2.1"); senza, figure e tabelle sono numerate solo per `{numref}`. Una voce con `numbered: false` (ad esempio gli allegati) resta senza numero anche in un indice numerato. Entrambi aggiunti nel monorepo (12.7).

### 3.5 `document_settings.yml` esteso

Tutti i campi nuovi sono facoltativi. Un file attuale resta valido così com'è.

```yaml
document:
  name: Linee guida esempio
  description: Breve descrizione
  tags: [linee guida, interoperabilità]
  # campi nuovi
  format: myst            # rst (predefinito) | myst
  source: docs            # radice della sorgente, predefinito: ricerca automatica
  languages: [it, en]     # sottocartelle source/<lingua>; predefinito: [it]
  versions:
    draft: main           # branch pubblicato come "bozza"; predefinito: branch predefinito
    releases: tags        # tags | github-releases | none
    default: latest-release  # draft | latest-release | <nome versione>
  downloads: [pdf, epub, html]
  # informazioni che oggi stanno solo nel database (aggiunte nel PoC)
  publisher: Italia
  project: Designers Italia
  repository: https://github.com/italia/<repository>
```

Nel PoC lo schema esteso accetta tutti i 41 `document_settings.yml` dei repository locali, senza modifiche. I JSON Schema di `document_settings.yml` e `toc.json` sono generati dagli stessi schemi usati dal toolkit.

### 3.6 Fattibilità

Fattibile, con tre condizioni:

1. **Il convertitore da doctree Sphinx ad AST MyST è il componente più difficile del progetto.** Il doctree ha tipi di nodo diversi da mdast, e ogni estensione Sphinx ne aggiunge altri. Per i nodi non ancora mappati, il convertitore inserisce un nodo `html` con l'HTML prodotto da Sphinx: così la resa è completa dal primo giorno e i nodi si mappano uno alla volta, nell'ordine dato dalle statistiche del corpus.
2. **Le estensioni di Docs Italia** (`forum`, `plantuml`, ruoli RFC e HTTP, `only`) vanno scritte due volte: come plugin Sphinx per l'RST e come plugin `myst-parser` per il MyST. Sono poche e piccole.
3. **La conversione da RST a MyST è facoltativa e per documento.** Si fa dall'AST e si verifica che il MyST risultante, riletto, dia lo stesso AST. Va proposta ai documenti attivi, non imposta a tutti. **Il PoC ha mostrato che `myst-to-md` da solo non basta**: perde le opzioni delle direttive (`:alt:`, `:align:`, `:class:`) e riscrive le recinzioni; solo 1 file su 8 torna identico. Serve un serializzatore proprio per le direttive.
4. **Il convertitore deve gestire i casi trovati nel PoC** e produrre un rapporto per documento da far rivedere a chi lo cura: file iniettati dalla piattaforma (`banner.rst`, `glossario.rst`), link tra capitoli scritti come URL HTML, classi del tema attuale nel contenuto (`admonition-example display-page`), formattazione al posto della semantica (didascalie in `*…*`).

---

## 4. Build e anteprima nel repository

### 4.1 Il toolkit

Un solo strumento, distribuito come pacchetto sul registro npm (si esegue con Bun) e come immagine Docker:

```
docs-italia init        crea document_settings.yml, toc.json, compose.yml, workflow CI
docs-italia check       valida metadati, toc, link interni, immagini, etichette
docs-italia dev         anteprima locale con ricaricamento automatico
docs-italia build       produce il pacchetto (4.2)
docs-italia studio      avvia l'editor locale (sezione 5)
docs-italia publish     invia il pacchetto a un'istanza Docs Italia
docs-italia mcp         server MCP locale sul repository (sezione 7.4)
```

L'immagine Docker contiene Bun, Python con Sphinx e le estensioni ammesse, Chromium per il PDF, Java per PlantUML ed `epubcheck`. Chi lavora solo in MyST può usare il pacchetto con Bun, senza Python.

Il sito di anteprima di `docs-italia dev` usa lo stesso renderer del sito pubblico: quello che si vede in locale è quello che verrà pubblicato.

### 4.2 Il pacchetto

È il contratto tra repository e piattaforma, versionato e descritto con JSON Schema:

```
bundle/
  manifest.json        documento, versione, lingua, commit, formato, versione del toolkit, hash dei file
  metadata.json        document_settings.yml validato
  toc.json             alberatura risolta, con numerazione
  pages/<pagina>.json  AST MyST di ogni pagina, riferimenti già risolti
  inventory.json       etichette e ancore → pagina#ancora
  search.jsonl         un record per sezione: titolo, testo, ancora
  chunks.jsonl         frammenti per l'indicizzazione vettoriale (sezione 7.2), senza embedding
  assets/              immagini, SVG dei diagrammi, file scaricabili
  downloads/           documento.pdf, documento.epub, documento-html.zip
```

Ogni nodo dell'AST conserva file e righe di origine. Al sito non servono, all'editor sì.

Il pacchetto contiene un AST e non HTML: la piattaforma decide come renderlo. Questo è ciò che permette di accettare pacchetti costruiti altrove (4.3). Gli unici nodi con HTML grezzo sono quelli di ripiego della 3.6, e la piattaforma li sanifica.

### 4.3 Il flusso di pubblicazione

```
repository                          GitHub Actions                      istanza Docs Italia
──────────                          ──────────────                      ───────────────────
push su branch bozza      ──▶  build + anteprima                ──▶  pubblica "bozza"
pull request              ──▶  build + anteprima della PR       ──▶  URL di anteprima temporaneo, commentato nella PR
release / tag             ──▶  build, pacchetto allegato        ──▶  verifica e pubblica la versione
                                 alla release
```

- L'Action si autentica verso l'istanza con il **token OIDC di GitHub Actions**: l'istanza verifica da quale repository e da quale ref arriva il pacchetto, senza segreti da distribuire.
- Prima di pubblicare, l'istanza controlla che il repository sia elencato nell'`italia-conf` del publisher, valida il pacchetto contro lo schema e sanifica i nodi HTML.
- Per i repository senza Action (la maggior parte, nella prima fase) l'istanza costruisce il pacchetto da sola, con la stessa immagine, su webhook della GitHub App. Il risultato è identico.
- L'anteprima delle pull request vive sull'istanza (un URL per PR, cancellato alla chiusura) e non su GitHub Pages: niente branch `gh-pages` da gestire nei repository.

La GitHub Action è riusabile: un repository la aggiunge con un file di poche righe, che `docs-italia init` crea.

### 4.4 Versioni

| Versione | Da dove viene | URL |
|---|---|---|
| `bozza` (`draft` in inglese) | Branch indicato in `versions.draft`, altrimenti il predefinito | `/…/it/bozza/` |
| Versioni numerate | Tag o GitHub Release, secondo `versions.releases` | `/…/it/1.2.0/` |
| `stabile` (`stable`) | Alias della versione indicata da `versions.default` | `/…/it/stabile/` |
| Archiviate | Fotografia del sito attuale | Stesso URL di oggi |

Per i repository che oggi hanno branch chiamati `versione-corrente`, `versione-attuale` o simili, l'importazione mantiene lo slug attuale come alias, così gli URL non cambiano.

### 4.5 PDF ed EPUB

- **PDF**: pagina singola + CSS per la stampa + Chromium headless (Paged.js per numerazione, indice, intestazioni). Una sola catena di resa per entrambi i formati, aspetto coerente col sito.
- **EPUB**: generato dall'AST.
- **HTML compresso**: le pagine del sito esportate staticamente.

Le 108 direttive `only` con `format_latex` / `latex` indicano che alcuni editori curano il PDF separatamente. Prima di scartare LaTeX va fatta una prova di confronto sui tre documenti che le usano di più.

**Risultati del PoC** (Chrome headless, senza Paged.js): PDF *tagged* e accessibile, segnalibri, copertina, capitoli su pagine nuove, intestazione delle tabelle ripetuta, indirizzi dei link stampati; circa 1–2 secondi per un documento di 8 pagine. Mancano i numeri di pagina nell'indice e la possibilità di togliere il numero dalla copertina, e nei segnalibri si perde lo spazio dove il titolo va a capo: per questo serve Paged.js. L'EPUB è XML ben formato con struttura corretta, ma non è ancora stato validato con `epubcheck`, che va messo nella CI.

**Nel monorepo** (12.7) il PDF usa **Paged.js** come motore predefinito: indice con i numeri di pagina, piè di pagina con titolo e "pagina N di M", titolo del capitolo in testa, copertina senza numero, in circa un secondo. Paged.js 0.4 non regge i selettori di Tailwind (`:is()`, `:where()`), quindi il CSS del sito è escluso dalla sua analisi (`data-pagedjs-ignore`) e le regole di impaginazione stanno in un foglio a parte. Resta un difetto: nei segnalibri del PDF i titoli dei capitoli perdono il numero. Chrome da solo resta disponibile con `--pdf-engine chrome`. `epubcheck` è nella build quando è installato e nell'immagine del toolkit.

### 4.6 Ciclo di pubblicazione

Pubblicare un documento **non modifica il repository della piattaforma** (`docs-italia-platform`), che contiene solo il codice. I contenuti restano nei repository dei documenti; ciò che l'istanza pubblica finisce nel suo database e nel suo object storage, non in Git. La piattaforma non scrive mai nei repository dei documenti, tranne quando un utente salva dall'editor ospitato (5.6).

Esempio: pubblicazione della versione `2026.2` di un documento.

1. **Repository del documento**: chi lo cura crea il tag o la release `2026.2`.
2. **Costruzione del pacchetto**, in uno dei due modi:
   - la GitHub Action del repository lo costruisce con il toolkit e lo invia all'istanza, autenticandosi con il token OIDC di GitHub Actions;
   - se il repository non ha l'Action, la GitHub App avvisa l'istanza con un webhook e il worker costruisce il pacchetto con la stessa immagine del toolkit.
3. **Verifica**: il server controlla che il repository sia elencato nel `projects_settings.yml` del publisher in `italia-conf`, valida il pacchetto contro lo schema e sanifica gli eventuali nodi HTML.
4. **Archiviazione**: il pacchetto viene salvato nell'object storage sotto un percorso immutabile (ad esempio `…/2026.2/<id-build>/`).
5. **Registrazione in PostgreSQL**: righe della build e della versione; se è la versione predefinita, il puntatore `stabile` passa alla nuova versione. Pubblicare è spostare il puntatore; tornare indietro è rimetterlo dov'era.
6. **Effetti**:
   - cache del sito invalidata;
   - indice di ricerca aggiornato;
   - calcolo degli embedding accodato, solo per i frammenti con un hash nuovo (7.3).
7. **Sito**: la nuova versione è servita al suo URL, ad esempio `/italia/designers-italia/<documento>/it/2026.2/`.

| Evento nel repository del documento | Cosa fa l'istanza |
|---|---|
| Tag o release | Pubblica una nuova versione numerata; sposta `stabile` se è la predefinita |
| Push sul branch della bozza | Aggiorna la versione `bozza` |
| Pull request aperta o aggiornata | Costruisce un'anteprima a un URL temporaneo e lo segnala nella PR; la cancella alla chiusura |
| Push su `italia-conf` del publisher | Rilegge publisher e progetti; importa i documenti nuovi, disattiva quelli tolti |

Una versione ritirata o promossa dalla dashboard (6.6) resta così anche se nel repository arrivano nuovi eventi, finché un amministratore non annulla l'intervento.

Aggiungere un documento richiede una sola modifica in Git, fuori da questo repository: una riga in `projects_settings.yml` di `italia-conf`.

---

## 5. Editor nel repository

### 5.1 Avvio

`docs-italia init` aggiunge al repository un `compose.yml`:

```yaml
services:
  studio:
    image: ghcr.io/<org>/docs-italia-toolkit:1
    command: docs-italia studio
    ports: ["4321:4321"]
    volumes:
      - .:/workspace            # il repository
      - studio-data:/data       # SQLite e cache
volumes:
  studio-data:
```

`docker compose up` e si apre il browser. Senza Docker: `bunx docs-italia studio`.

### 5.2 Componenti

- **Server locale TypeScript**: legge e scrive i file del repository, esegue le operazioni Git, costruisce l'anteprima in modo incrementale.
- **Interfaccia Vite + React**: albero del documento da `toc.json` (o dai `toctree`), editor, anteprima affiancata, pannello dei problemi segnalati da `check`.
- **SQLite** per lo stato che non appartiene a Git: sessioni di modifica e bozze non ancora salvate, cache della build e degli indici, controllo dei link esterni, indice delle immagini, note di revisione locali.

Il contenuto vive **solo** nei file del repository. SQLite è una cache: cancellandolo non si perde nulla di già salvato.

### 5.3 Livelli di modifica

1. **Sorgente con anteprima**, per RST e MyST: editor di codice (CodeMirror) con evidenziazione, completamento di etichette e direttive, anteprima sincronizzata con lo scorrimento. Questo livello arriva per primo e copre il 100% dei documenti.
2. **Struttura**: riordino dei capitoli trascinando, creazione, rinomina e cancellazione di file (con aggiornamento di `toc.json` e dei riferimenti), caricamento di immagini, modulo per `document_settings.yml`.
3. **Editor visuale per MyST**: ProseMirror o Tiptap, con lo schema derivato dall'AST MyST. Le direttive note hanno un'interfaccia dedicata (avvisi, figure, tabelle, riferimenti con ricerca tra le etichette); quelle non note restano blocchi di sorgente modificabili come testo.

Per il livello 3, al salvataggio vengono riscritti **solo i blocchi modificati**, usando le posizioni di origine dell'AST. Il resto del file resta identico byte per byte, e il diff mostra solo le modifiche reali. Questa è la condizione perché l'editor sia accettato da chi lavora anche a mano in Git.

Il PoC ha confermato che non c'è alternativa. Rigenerando un capitolo semplice dall'AST, `myst-to-md` cambia 12 righe su 18, perde il testo alternativo delle immagini e riscrive gli apostrofi, che il parser converte in tipografici. Serve un serializzatore delle direttive che conservi le opzioni, misurato con `scripts/roundtrip.ts` del PoC.

**Fatto nel monorepo** (`packages/myst/src/serialize.ts`, 12.7): su 495 blocchi tra il documento di esempio, quello del PoC e i Markdown di `eid-wallet-it-docs`, l'AST resta identico nel 100% dei casi e il testo nel 96,8%. Per arrivarci:

- la tipografia automatica del parser è disattivata (il testo resta come è scritto);
- direttive e ruoli conservano la forma originale (`origin`);
- le posizioni delle note a piè di pagina, che `myst-parser` sbaglia, si ricavano dal sorgente;
- un blocco con posizioni sovrapposte non si può riscrivere.

Per l'RST non è previsto un editor visuale: il costo di una serializzazione RST affidabile non è giustificato quando esiste la strada della conversione a MyST.

### 5.4 Git

Le operazioni Git sono attive solo se la cartella del documento è la radice del proprio repository. Nel PoC il documento si trovava dentro un repository più grande (la home dell'utente): senza questo controllo lo studio avrebbe fatto branch e commit su quel repository.

Dallo studio si fa tutto il necessario senza conoscere Git: creare un branch di lavoro, salvare (commit), inviare (push), aprire una pull request, vedere l'anteprima della PR. Non si fa mai commit direttamente sul branch pubblicato.

### 5.5 Integrazione con l'istanza Docs Italia

Lo studio può collegarsi a un'istanza (accesso con *device flow*: si conferma un codice nel browser). Da collegato:

- vede lo stato di pubblicazione del documento e delle sue versioni;
- usa il vocabolario dei tag dell'istanza;
- inserisce riferimenti ad altri documenti pubblicati, con ricerca tra le loro etichette;
- chiede la pubblicazione di una versione (crea tag e release);
- parte da modelli di documento forniti dall'istanza.

### 5.6 Editor ospitato

In una fase successiva la stessa applicazione React gira anche dentro l'istanza, per chi non può o non vuole usare Docker. Cambia solo il backend: al posto di file system, Git locale e SQLite, usa la GitHub App, il server dell'istanza e PostgreSQL. Il codice dell'interfaccia è lo stesso, quindi va progettato da subito con un'interfaccia di backend separata.

---

## 6. La piattaforma

### 6.1 Componenti

```
                 GitHub (organizzazioni, italia-conf, repository)
                     │ webhook GitHub App          ▲ token OIDC delle Actions
                     ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│ Server TypeScript                                               │
│ API · autenticazione · autorizzazione · importazione            │
│ ricezione pacchetti · coda delle build · indicizzazione         │
└───────┬───────────────────┬──────────────────────┬──────────────┘
        │                   │ job                  │
        ▼                   ▼                      ▼
┌──────────────┐   ┌──────────────────┐   ┌────────────────────────┐
│ PostgreSQL   │   │ Worker di build  │   │ Object storage (S3)    │
│ pubblicazioni│   │ immagine toolkit │──▶│ pacchetti, file da     │
│ utenti, coda │   │ in container     │   │ scaricare, archiviate  │
│ ricerca      │   └──────────────────┘   └───────────┬────────────┘
└──────┬───────┘                                      │
       └──────────────┬───────────────────────────────┘
                      ▼
       ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
       │ Sito Astro (SSR)     │ │ Server MCP           │ │ Editor ospitato      │
       │ Italia Tailwind UI   │ │ assistenti e agenti  │ │ Vite + React         │
       └──────────────────────┘ └──────────┬───────────┘ └──────────────────────┘
                                           │ embedding delle domande
                                ┌──────────▼───────────┐
                                │ Servizio embedding   │
                                │ (modello locale o    │
                                │  fornitore esterno)  │
                                └──────────────────────┘
```

| Componente | Scelta | Note |
|---|---|---|
| Server | Bun, TypeScript, Hono | Leggero, tipizzato, adatto ad API e webhook; Bun è runtime, gestore di pacchetti e test runner di tutto il monorepo |
| Database | PostgreSQL con pgvector | Anche coda dei job (tabella con `FOR UPDATE SKIP LOCKED`, al posto di pg-boss: più semplice e senza dipendenze), ricerca testuale e vettoriale: niente Redis, Elasticsearch o database vettoriale separato |
| Embedding | Servizio dedicato, modello configurabile | Vedi 7.3 |
| Server MCP | TypeScript, SDK MCP ufficiale, trasporto Streamable HTTP | Vedi 7.4 |
| File | Object storage S3-compatibile; SeaweedFS (Apache-2.0) per le installazioni autonome: MinIO dal 2025 non distribuisce più immagini della versione comunitaria | Pacchetti immutabili: ogni build ha il suo prefisso, pubblicare è spostare un puntatore |
| Build | Container effimeri con l'immagine del toolkit (Docker in compose, Job in Kubernetes) | Senza rete dopo il clone, con limiti di CPU, memoria e tempo |
| Sito | Astro con adapter Node, rendering lato server | Una build statica di 205 versioni a ogni pubblicazione non è sostenibile; con SSR si mette in cache ogni pagina per pacchetto, e la cache si invalida alla pubblicazione |
| Editor | Vite + React | Stesso codice dello studio locale |
| Dashboard | Vite + React + Italia Tailwind UI (tema `italia-original`), servita dal server in `/dashboard/` (stessa origine dell'API); un indirizzo separato si può dare con il proxy davanti | Amministrazione dell'istanza; accesso con magic link per le sole email autorizzate (6.6) |
| Interfaccia | [Italia Tailwind UI](https://github.com/italia/italia-tailwind-ui): `@italia-tailwind/css` e `@italia-tailwind/recipes`, su Tailwind CSS 4 e daisyUI 5, licenza BSD-3-Clause | Solo CSS: niente Bootstrap né web component. Le stesse classi `ita-*` valgono per sito, anteprima, studio, editor e PDF. Per ora si usa **solo il tema predefinito `italia-original`** (decisione in 11); i temi si cambiano con `data-theme`, utile per il riuso (sezione 8) |

### 6.2 Responsabilità del server

- **Importazione e sincronizzazione** da `italia-conf` e dai repository (sezione 2.2).
- **Build** per i repository senza Action, **ricezione** dei pacchetti per quelli con Action.
- **Pubblicazione**: spostamento dei puntatori di versione, invalidazione della cache del sito, aggiornamento della ricerca, accodamento dell'indicizzazione vettoriale.
- **Autenticazione**: OIDC generico. GitHub come primo fornitore; per il riuso, qualsiasi fornitore OIDC (ad esempio Keycloak, o un proxy SPID/CIE).
- **Autorizzazione**, con quattro ruoli: amministratore dell'istanza, amministratore di un publisher, redattore di un documento, revisore. I ruoli si possono derivare dai permessi su GitHub (organizzazione, team, repository) o assegnare a mano.
- **API** per il sito, lo studio e l'editor ospitato.
- **API di amministrazione** per la dashboard, separate dalle altre: accesso con magic link, ogni azione registrata (6.6).

### 6.3 Modello dati, in breve

`publisher` → `project` → `document` → `version` → `build`; più `document_language` (traduzioni), `tag`, `redirect`, `search_section`, `chunk` e `embedding` (sezione 7), `user`, `role_assignment`, `api_client` (accessi al server MCP), `preview` (anteprime delle PR), `instance_settings`; per la dashboard `magic_link` (token monouso, salvati come hash), `admin_session`, `version_override` (ritiri e promozioni che prevalgono sul repository) e `audit_log` (registro delle azioni di amministrazione).

Stessa gerarchia di oggi. Lo schema si scrive da zero: non c'è migrazione di tabelle da Read the Docs, perché il ripopolamento parte da GitHub e dall'inventario.

### 6.4 Sito Astro

- Pagine: home, amministrazioni, publisher, progetto, documento (indice laterale, selettore di versione e lingua, precedente/successivo, vista a pagina singola o a capitoli, "modifica su GitHub", download), ricerca, pagine istituzionali.
- **URL identici a oggi**: `/{publisher}/{progetto}/{documento}/{lingua}/{versione}/{pagina}.html`, alias `bozza`/`stabile`/`draft`/`stable`, download su `/projects/{documento}/downloads/{pdf|epub|htmlzip}/{versione}/`. Test automatico su tutti gli URL della fotografia.
- Le ancore generate dal Sphinx attuale e da Sphinx 1.8 possono differire: dove succede, il convertitore emette anche l'identificativo vecchio.
- Ricerca: full-text di PostgreSQL in configurazione `italian` per le sezioni, `pg_trgm` per il completamento rapido su documenti, progetti e amministrazioni, filtri per tag e publisher.
- Accessibilità WCAG 2.1 AA, sitemap, URL canonici.

**Interfaccia con Italia Tailwind UI**:

- Il foglio di stile del sito importa `tailwindcss` e una versione di Italia Tailwind UI con il solo tema `italia-original`. Il punto di ingresso principale di `@italia-tailwind/css` carica tutti i 39 temi daisyUI: dalla 0.3 la libreria ha il punto di ingresso `@italia-tailwind/css/original.css` con il solo `italia-original`, che `italia.css` importa (fino alla 0.2 il file era generato estraendo il tema da `themes.css`). Il tema si indica con `data-theme` sull'elemento `html`.
- Header, footer, navigazione, briciole di pane, selettori di versione e lingua, card dei documenti e pagine di ricerca si scrivono come HTML con classi `ita-*`. Le *recipes* si usano solo per i componenti semplici (briciole di pane, indice di pagina, chip, icone): nel PoC `header()` e `footer()` inseriscono contenuto dimostrativo quando un argomento manca e non producono XHTML valido, e `callout()` genera id diversi a ogni build.
- Il preflight di Tailwind azzera margini ed elenchi e la libreria definisce solo i titoli: la tipografia dei documenti è un foglio di stile di Docs Italia (`prose.css` nel PoC), da proporre alla libreria.
- Anche con un solo tema il CSS pesa 341 KB (36 KB con gzip), perché i componenti `ita-*` finiscono tutti nel foglio. Da chiedere alla libreria: esportare `components.css` e i singoli componenti.
- Il renderer AST → HTML usa le stesse classi per i nodi del documento: gli avvisi MyST (`note`, `warning`, `tip`…) diventano avvisi `ita-*`, e così tabelle, figure e blocchi di codice. Così il contenuto dei documenti e l'interfaccia del sito hanno lo stesso aspetto.
- **Le recipes non fanno escape dei loro argomenti.** Il renderer deve fare escape di tutto il testo che arriva dai documenti prima di passarlo a una recipe. Va coperto da test, perché è la difesa principale contro l'HTML iniettato nei contenuti.
- Le icone si prendono dallo sprite SVG di `@italia-tailwind/recipes`.
- I componenti specifici di Docs Italia che la libreria non ha (indice laterale del documento, selettore di versione, banner "versione archiviata") si scrivono nello stesso stile, con le classi della libreria e i token del tema. Dove sono di uso generale, si propongono alla libreria a monte.

### 6.5 Organizzazione del codice

Un monorepo TypeScript con i workspace di Bun (installazione isolata: ogni pacchetto vede solo le dipendenze che dichiara). È questo repository, **`docs-italia-platform`**: l'ossatura c'è, con un README per ogni pacchetto.

Il nome distingue il software riusabile dall'istanza nazionale Docs Italia (`docs.italia.it`) e dagli strumenti `docs-italia-*` della piattaforma attuale. I pacchetti restano nello scope `@docs-italia/*` e la CLI si chiama `docs-italia`.

```
packages/
  schema/        JSON Schema e tipi: YAML, toc.json, pacchetto, AST con estensioni
  myst/          lettura MyST e plugin Docs Italia
  sphinx/        estensione Sphinx: builder del pacchetto, conversione doctree → AST (Python)
  render/        AST → HTML con le classi di Italia Tailwind UI, condiviso da sito, anteprima, PDF ed editor
  export/        PDF, EPUB, HTML compresso
  toolkit/       CLI docs-italia, server dello studio
  forge/         accesso a GitHub; in seguito GitLab
  retrieval/     frammentazione, embedding, ricerca ibrida: condiviso da server, sito e MCP
apps/
  server/        API, importazione, build, autenticazione, job di indicizzazione
  mcp/           server MCP
  site/          Astro
  editor/        Vite + React (studio locale ed editor ospitato)
  dashboard/     Vite + React + Italia Tailwind UI: amministrazione dell'istanza
deploy/
  compose/       istanza completa con Docker Compose
  helm/          istanza su Kubernetes
  toolkit/       Dockerfile dell'immagine del toolkit
spec/            specifica del formato e del pacchetto, scritta in MyST
```

**Accesso a GitHub: Octokit.** Il pacchetto `forge` definisce un'interfaccia comune (leggere file, elencare branch e tag, verificare webhook, creare commit, aprire pull request). Per GitHub la implementa Octokit; per GitLab, previsto per il riuso (8), una libreria equivalente con la stessa interfaccia. Il resto del codice non sa con quale fornitore sta parlando.

| Dove | Con Octokit |
|---|---|
| Server dell'istanza | Autenticazione come GitHub App (`@octokit/app`), ricezione e verifica dei webhook (`@octokit/webhooks`), lettura di `italia-conf`, branch, tag e release, stato delle build sui commit, commento con il link all'anteprima nelle pull request |
| Editor ospitato | Salvataggio senza un clone locale: commit di più file in una volta con la mutation GraphQL `createCommitOnBranch` (commit firmati dalla GitHub App), creazione del branch, apertura della pull request |
| Toolkit (`publish`) | Creazione del tag o della release dalla CLI |

Octokit chiama l'API di GitHub, non esegue Git. Quindi non si usa:

- nello **studio locale**, che lavora su un clone: stato, diff, branch e commit restano affidati al comando `git`;
- per scaricare la sorgente nel **worker di build**: un clone superficiale (`git clone --depth 1 --branch <ref>`) è più efficiente che leggere i file uno alla volta, e l'archivio di un ref scaricabile via API non contiene i submodule (`publiccode.yml-docs` ne usa uno).

**Due modalità di accesso a GitHub**, scelte con le variabili d'ambiente dell'istanza:

| | GitHub App (consigliata) | Token |
|---|---|---|
| Configurazione | `GITHUB_APP_ID`, la chiave privata (`GITHUB_APP_PRIVATE_KEY`, o `GITHUB_APP_PRIVATE_KEY_FILE` con il percorso di un file di segreti), `GITHUB_WEBHOOK_SECRET`; l'App si installa su ogni organizzazione | `GITHUB_TOKEN` (token *fine-grained* con accesso in lettura ai repository delle organizzazioni), `GITHUB_WEBHOOK_SECRET` |
| Permessi | Dichiarati dall'App e accettati da ogni organizzazione all'installazione | Quelli della persona che ha creato il token |
| Webhook | Uno solo, configurato nell'App, per tutte le organizzazioni | Da configurare a mano su ogni organizzazione o repository |
| Limiti dell'API | Per installazione, crescono con il numero di repository | 5.000 richieste l'ora per il titolare del token |
| Commit dall'editor ospitato | Firmati dall'App, a nome dell'utente | A nome del titolare del token: adatto solo alla lettura |
| Scadenza | Token di installazione rinnovati da soli ogni ora | Scadenza fissata alla creazione: va rinnovato a mano |
| Quando usarla | Istanza nazionale, più organizzazioni | Prove, installazioni piccole, prime fasi del riuso |

Con il token l'editor ospitato è disattivato: si può solo leggere e pubblicare.

Per restare nei limiti di frequenza dell'API: webhook invece di interrogazioni periodiche, richieste condizionali (ETag) e, dove possibile, GitHub App invece del token.

---

### 6.6 Dashboard di amministrazione

Un'applicazione per chi gestisce l'istanza, in **Vite + React + Italia Tailwind UI** (solo tema `italia-original`, come il resto della piattaforma). Dà una visione completa di organizzazioni, progetti e documenti. Il suo compito principale è **risolvere i problemi** e **ritirare o promuovere le versioni pubblicate** senza dover intervenire nei repository.

> **Stato** (prima versione, `apps/dashboard` e `apps/server/src/admin.ts`): panoramica, organizzazioni, documenti, build con problemi e log, coda, webhook, registro, stato dei collegamenti (database, archivio, coda e worker, conversione RST, GitHub con App/token/anonimo e limiti, `italia-conf`, webhook) e gli interventi ritira/ripristina e promuovi/torna alla regola del repository, con motivazione obbligatoria. La regola della versione predefinita è una funzione SQL (`default_version_id`) che tiene conto delle promozioni. **Accesso con magic link** fatto (`apps/server/src/auth.ts`, migrazione `004_accesso.sql`): come descritto sotto; in più la pagina del link chiede di premere "Accedi", così i filtri della posta che aprono i link non consumano il token, e senza `SMTP_URL`, solo su indirizzo locale, i link finiscono nel log del server (demo: `ACCESSO=email ./avvia.sh`). Restano `ADMIN_TOKEN` per gli script e `DASHBOARD_OPEN=1` in locale. **Aggiunta delle organizzazioni** fatta: verifica (accesso con App o token, `italia-conf`, documenti trovati) e prima sincronizzazione, nel registro; guida al collegamento in `docs/collegare-organizzazioni.md`. Mancano: controlli periodici (oggi su richiesta, con un minuto di cache), archiviazione delle versioni, ricostruzione dell'indice di ricerca, consegne dei webhook lette da GitHub, email di prova dallo stato dei collegamenti (oggi si verificano connessione e autenticazione SMTP), disattivazione di un'organizzazione (oggi un push su `italia-conf` la riattiverebbe).

**Accesso**

- Possono entrare solo le email elencate in una variabile d'ambiente. Il confronto ignora maiuscole e spazi; un'email tolta dall'elenco perde l'accesso alla richiesta successiva, anche con una sessione aperta.
- Si accede con un **magic link**:
  1. si inserisce l'email;
  2. se è autorizzata, arriva un link che vale **una volta sola** e per **15 minuti**;
  3. il link apre una sessione in un cookie `HttpOnly`, `Secure`, `SameSite=Strict`, che scade dopo 8 ore.
- La risposta alla richiesta del link è la stessa per email autorizzate e non: non si può scoprire chi ha accesso.
- I token sono salvati solo come hash. Le richieste di link hanno un limite di frequenza per email e per indirizzo IP.
- La dashboard è separata dal sistema di ruoli basato su GitHub (6.2): serve agli amministratori dell'istanza, non ai redattori.

```sh
DASHBOARD_ADMIN_EMAILS=nome.cognome@agid.gov.it,altra.persona@example.gov.it
DASHBOARD_URL=https://admin.docs.italia.it
SMTP_URL=smtps://utente:password@smtp.example.gov.it:465
SMTP_FROM="Docs Italia <noreply@docs.italia.it>"
MAGIC_LINK_TTL_MINUTES=15
ADMIN_SESSION_TTL_HOURS=8

# accesso a GitHub: GitHub App (consigliata) oppure token (6.5)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/github-app.pem
GITHUB_WEBHOOK_SECRET=…
# GITHUB_TOKEN=github_pat_…   in alternativa all'App
```

**Visione d'insieme**

- Organizzazioni, progetti e documenti, con lo stato di sincronizzazione di ogni `italia-conf`.
- Per ogni documento: versioni pubblicate, versione predefinita, ultima build, problemi dei controlli, anteprime aperte.
- Elenchi filtrabili di ciò che richiede attenzione: build fallite, documenti con errori, versioni archiviate, documenti elencati in `italia-conf` ma non importati, repository archiviati su GitHub.

**Risolvere i problemi**

- Log delle build e dei webhook ricevuti, con la possibilità di rilanciare una build o una sincronizzazione.
- Problemi dei controlli (`docs-italia check`) con file, riga e link al file su GitHub.
- Ricostruzione dell'indice di ricerca e degli embedding di un documento.

**Stato dei collegamenti**

Una pagina mostra se l'istanza riesce a parlare con tutto ciò da cui dipende. I controlli girano a intervalli regolari e su richiesta, con il pulsante "Verifica ora"; un controllo che fallisce compare in cima alla home della dashboard.

| Collegamento | Cosa si verifica |
|---|---|
| GitHub: modalità di accesso | Quale modalità è attiva (GitHub App o token, 6.5) e se la configurazione è completa |
| GitHub App | La chiave privata produce un JWT valido; elenco delle installazioni, una per organizzazione; organizzazioni configurate in Docs Italia senza l'App installata; permessi concessi rispetto a quelli richiesti; permessi nuovi in attesa di approvazione |
| Token GitHub | Il token è valido; a chi appartiene; permessi e repository raggiungibili; data di scadenza, con avviso 30 e 7 giorni prima |
| Limiti dell'API GitHub | Richieste rimaste e ora del prossimo azzeramento |
| Webhook | Ultima consegna ricevuta per ogni organizzazione; consegne fallite (per la GitHub App si leggono dall'API delle consegne e si possono rinviare); firma con `GITHUB_WEBHOOK_SECRET` corretta |
| `italia-conf` | Ogni repository di configurazione è leggibile e i suoi file sono validi |
| PostgreSQL | Connessione, versione, estensione `pgvector`, coda dei job (lavori in attesa e falliti) |
| Object storage | Lettura e scrittura di un file di prova |
| Worker di build | Ultimo contatto, versione dell'immagine del toolkit, Chromium disponibile |
| Email (SMTP) | Connessione e autenticazione; invio di un'email di prova a chi è collegato alla dashboard |
| Servizio di embedding | Risponde, e il modello caricato è quello configurato |
| Server MCP | Risponde a una ricerca di prova |

La dashboard non mostra mai i segreti: della chiave dell'App e del token si vedono solo l'impronta (ultimi caratteri) e la scadenza.

**Ritirare e promuovere versioni**

| Azione | Effetto |
|---|---|
| Ritira | La versione scompare dal sito, dalla ricerca e dal server MCP; il suo URL risponde con una pagina "versione ritirata" e il link alla versione predefinita |
| Ripristina | Annulla un ritiro |
| Promuovi a predefinita | Il puntatore `stabile` passa a questa versione, anche contro `versions.default` di `document_settings.yml` |
| Torna alla regola del repository | Annulla una promozione: vale di nuovo `document_settings.yml` |
| Archivia | La versione resta consultabile come versione archiviata (2.3), fuori dalla ricerca |

Ogni intervento:

- è un'operazione sul database (spostamento di puntatori, `version_override`), mai una scrittura nei repository;
- prevale sugli eventi successivi del repository finché non viene annullato (4.6);
- è visibile nella dashboard come forzato, con chi l'ha fatto, quando e perché;
- richiede una motivazione e finisce in `audit_log`.

## 7. Ricerca semantica, RAG e server MCP

### 7.1 Obiettivo e perimetro

Permettere ad assistenti e agenti (di chi lavora nelle PA, di fornitori, di sviluppatori, di cittadini) di trovare e citare i passaggi esatti di linee guida e documenti tecnici, sempre con il link alla versione da cui provengono.

Il server MCP **recupera e restituisce frammenti con le loro fonti; non genera risposte**. La risposta la scrive l'assistente che lo interroga. Docs Italia resta così responsabile solo di ciò che pubblica, non di come un modello lo riassume.

Restano due ricerche distinte, sugli stessi dati:

| | Ricerca del sito | Ricerca semantica (RAG) |
|---|---|---|
| Chi la usa | Persone, sul sito Astro | Assistenti e agenti, via MCP o API |
| Come trova | Parole (full-text italiano, completamento a trigrammi) | Significato (embedding) combinato con le parole |
| Restituisce | Pagine e sezioni da aprire | Frammenti di testo pronti da citare, con URL e versione |

Il sito può comunque usare la ricerca ibrida come miglioramento della propria ricerca (7.6).

### 7.2 Frammentazione dall'AST

I frammenti si ricavano dall'AST, non dall'HTML: la struttura del documento è già nota e non va indovinata.

- **Unità di base: la sezione**, cioè un titolo e il contenuto fino al titolo successivo. Un frammento non attraversa mai un titolo di primo o secondo livello.
- **Dimensione indicativa: 300–800 token.** Le sezioni lunghe si dividono tra un blocco e l'altro, ripetendo l'ultimo blocco nel frammento successivo. Le sezioni molto brevi si uniscono alla sezione che le contiene.
- **Blocchi indivisibili**: tabelle, blocchi di codice, liste, avvisi. Le tabelle diventano tabelle Markdown; le immagini diventano didascalia e testo alternativo; le note a piè di pagina vengono riportate in fondo al frammento.
- **Contesto in testa a ogni frammento**, incluso nel testo da vettorizzare: `AgID › PDND › Linee guida PDND (v1.2) › 3. Architettura › 3.2 Sicurezza`. Senza questo, frasi come "il soggetto deve…" perdono ogni riferimento.
- **Metadati di ogni frammento**: publisher, progetto, documento, versione, lingua, tag, URL canonico con ancora, etichette MyST, ordine nel documento, hash del contenuto.

- **Normalizzazione del testo** prima di ricerca ed embedding: il parser MyST converte gli apostrofi in tipografici (`dell'Interno` → `dell’Interno`), e chi cerca scrive quasi sempre quelli dritti.

La frammentazione la fa il toolkit e finisce nel pacchetto (`chunks.jsonl`). Nel PoC è già fatta: 12 frammenti da 74 a 414 token per il documento di prova, con il percorso dei titoli in testa e le tabelle in formato Markdown. Il conteggio dei token è ancora una stima (4 caratteri per token) e va fatto con il tokenizer del modello scelto. È deterministica e si può controllare in locale con `docs-italia build`. Gli embedding invece li calcola l'istanza, perché il modello è una scelta dell'istanza.

### 7.3 Embedding e indice

- **Archiviazione**: PostgreSQL con pgvector, indice HNSW, distanza coseno. Un solo database da gestire, da salvare e da installare per chi riusa.
- **Un embedding per contenuto, non per versione.** La tabella `embedding` è indicizzata per hash del frammento e modello; `chunk` collega la versione all'hash. Le versioni di uno stesso documento condividono gran parte del testo, quindi a ogni nuova versione si calcolano solo i frammenti cambiati.
- **Cambio di modello senza interruzioni**: i nuovi embedding si calcolano in background accanto ai vecchi, e il passaggio avviene in un colpo solo quando sono completi.
- **Ricerca ibrida**: risultati vettoriali e full-text (configurazione `italian`) fusi con *Reciprocal Rank Fusion*. La parte testuale è indispensabile per sigle, numeri di articolo, nomi di campi e codici (`PDND`, `art. 64-bis`, `client_assertion`), che gli embedding trovano male. Un riordinatore (*cross-encoder*) si aggiunge solo se le misure lo giustificano.
- **Filtri**: per impostazione predefinita solo la versione predefinita di ogni documento, così un assistente non cita una versione superata. Filtri espliciti per publisher, progetto, documento, versione, lingua, tag, "solo versioni stabili".
- **Cosa non si indicizza**: anteprime delle pull request e bozze non pubblicate. Le versioni archiviate (2.3) solo se non esiste una versione ricostruita, e con un segnale di qualità più bassa, perché il testo viene estratto dall'HTML.
- **Volume stimato**: alcune decine di migliaia di frammenti per le versioni predefinite. È una stima da verificare con il banco di prova della fase 1. pgvector regge questi volumi senza difficoltà.

**Modello di embedding.** Requisiti: buona qualità in italiano e in inglese, testi lunghi, licenza aperta, installabile in locale. L'installazione in locale conta per due motivi. Le domande degli utenti possono contenere dati personali, e così non escono dall'infrastruttura. E chi riusa la piattaforma non deve dipendere da un fornitore esterno. Il modello si sceglie con la valutazione della 7.5, confrontando due o tre modelli multilingue aperti con almeno un servizio esterno come riferimento.

Il calcolo avviene in un **servizio di embedding** separato, in container, dietro un'interfaccia HTTP comune. Così l'istanza può usare un modello locale o un fornitore esterno cambiando solo la configurazione. Per l'aggiornamento incrementale basta la CPU; per la prima indicizzazione completa conviene una GPU.

### 7.4 Server MCP

Server remoto in TypeScript con l'SDK ufficiale MCP, trasporto Streamable HTTP, su un indirizzo dell'istanza (ad esempio `https://docs.italia.it/mcp`). È un livello sottile sopra il pacchetto `retrieval`, lo stesso usato dall'API REST.

**Strumenti**, tutti in sola lettura. I nomi sono in inglese per interoperabilità; le descrizioni sono in italiano e in inglese.

| Strumento | Cosa fa |
|---|---|
| `search_docs` | Ricerca ibrida con filtri. Restituisce frammenti con testo, percorso dei titoli, documento, versione, URL con ancora, punteggio |
| `get_section` | Testo completo di una sezione in Markdown, partendo da un URL o da un identificativo; facoltativamente con le sottosezioni |
| `get_toc` | Indice di un documento in una versione |
| `list_documents` | Catalogo: publisher, progetti, documenti, con filtri per tag e testo |
| `list_versions` | Versioni di un documento, con date, tipo e versione predefinita |
| `compare_versions` | Differenze di una sezione tra due versioni (fase successiva: utile per seguire gli aggiornamenti delle linee guida) |

**Risorse**: ogni pagina pubblicata è una risorsa MCP, con modello di indirizzo `docsitalia://{publisher}/{progetto}/{documento}/{lingua}/{versione}/{pagina}`, che restituisce la pagina in Markdown.

**Regole sui risultati**:

- ogni frammento porta sempre URL canonico, nome del documento e versione, perché l'assistente possa citare la fonte;
- il testo restituito è Markdown ricavato dall'AST, non HTML;
- quando la versione richiesta non è la predefinita, il risultato lo dice esplicitamente.

**Accesso**:

- lettura pubblica senza registrazione, perché i contenuti sono pubblici, con limiti di frequenza per indirizzo;
- chiavi o autorizzazione OAuth secondo la specifica MCP per quote più alte, e per le istanze che pubblicano documenti ad accesso riservato;
- registro delle domande ridotto al minimo, con conservazione limitata e informativa privacy, perché le domande possono contenere dati personali.

**MCP locale nel toolkit**: `docs-italia mcp` avvia un server MCP locale (trasporto stdio) sul repository in lavorazione. Un assistente nell'IDE o nello studio può così interrogare il documento che si sta scrivendo e, se collegato, i documenti pubblicati sull'istanza: ad esempio per controllare che una definizione sia coerente con quella di un'altra linea guida.

### 7.5 Valutazione

- **Insieme di prova**: 150–200 domande reali, scritte con gli editori, ciascuna con le sezioni che dovrebbero essere trovate. Coprono definizioni, obblighi, riferimenti normativi, campi tecnici, domande in inglese su documenti italiani.
- **Misure**: quante volte la sezione giusta è tra i primi 5 risultati (*recall@5*) e quanto in alto compare (*MRR*).
- Le misure si rilanciano in CI a ogni modifica di frammentazione, ricerca o modello. Una modifica che peggiora i risultati non passa.
- In produzione si tengono d'occhio le domande senza risultati utili.

### 7.6 Ricadute sul sito

- La ricerca del sito può usare la ricerca ibrida: trova pagine anche quando l'utente non usa le parole esatte del documento. È un'opzione dello stesso pacchetto, da attivare dopo averla misurata.
- Una funzione "chiedi ai documenti", con risposte generate sul sito, **non fa parte di questo piano**. Su contenuti normativi richiede decisioni su responsabilità, accuratezza e costi che vanno prese a parte. L'architettura la permette senza modifiche, se verrà decisa.

---

## 8. Riuso da parte di altre PA

Va previsto dall'inizio, non aggiunto alla fine:

- **Nessun valore cablato**. Un file `instance.yml` definisce nome, dominio, logo, tema grafico (uno dei temi di Italia Tailwind UI o un tema daisyUI proprio, senza toccare il codice), pagine istituzionali (scritte come documenti MyST), elenco dei publisher, nome del repository di configurazione (`italia-conf` come predefinito), vocabolario dei tag, fornitori di autenticazione.
- **RAG e MCP facoltativi**: un'istanza può disattivarli, o scegliere in `instance.yml` il modello di embedding (locale o esterno) e le regole di accesso al server MCP.
- **Fornitori Git intercambiabili**: GitHub per primo; GitLab come secondo fornitore, perché molte PA lo usano in casa. Il pacchetto `forge` isola le differenze.
- **Due modalità di installazione**: Docker Compose (server, sito, server MCP, PostgreSQL con pgvector, SeaweedFS, worker, servizio di embedding) per un'amministrazione piccola, Helm per un cluster.
- **Specifica separata dal codice**: formato del documento, `toc.json`, pacchetto, estensioni di `document_settings.yml`, tutto versionato con JSON Schema in un repository proprio, come per `publiccode.yml`. Così il toolkit può essere usato anche senza un'istanza, e altri possono scrivere strumenti compatibili.
- **Requisiti delle Linee guida sul riuso**: licenza aperta, `publiccode.yml` in ogni repository, pubblicazione nel catalogo di Developers Italia, documentazione di installazione scritta nel formato stesso.

---

## 9. Fasi

| Fase | Contenuto |
|---|---|
| 0. Fotografia | Download dei file, copia dell'HTML, elenco URL, ordine e progetti in evidenza (2.1). Su cloud, fuori da questo lavoro |
| 1. Specifica e AST | Schema di `toc.json`, pacchetto, `document_settings.yml` esteso; lettura MyST con plugin Docs Italia; estensione Sphinx con conversione doctree → AST; **banco di prova** che costruisce tutte le 205 versioni e produce un rapporto di compatibilità |
| 2. Toolkit | CLI (`check`, `build`, `dev`), renderer, PDF ed EPUB, frammentazione (`chunks.jsonl`), immagine Docker, GitHub Action riusabile. **Nel monorepo** (12.7): toolkit MyST, conversione RST, Paged.js ed `epubcheck` fatti; immagine Docker e GitHub Action scritte, da provare |
| 3. Server | Modello dati, importazione, GitHub App, coda delle build, ricezione dei pacchetti con OIDC, autenticazione e ruoli, anteprime delle PR |
| 4. Sito | Astro, URL compatibili, versioni archiviate, ricerca, download, pagine istituzionali; dashboard di amministrazione con magic link (6.6), necessaria già al passaggio per gestire le versioni |
| 5. Passaggio | Ripopolamento completo, revisione con alcuni editori, confronto visivo con il sito attuale, cambio del DNS, guida "come pubblicare" aggiornata |
| 6. RAG e MCP | Insieme di prova e scelta del modello di embedding, servizio di embedding, indicizzazione incrementale, ricerca ibrida, server MCP con strumenti e risorse, limiti di accesso, MCP locale nel toolkit |
| 7. Studio locale | `compose.yml`, server locale, SQLite, editor di sorgente con anteprima, struttura, operazioni Git, collegamento all'istanza. **Prima bozza nel PoC** (sezione 12); mancano `compose.yml` e collegamento all'istanza |
| 8. Editor visuale e riuso | Editor visuale MyST, conversione RST → MyST, editor ospitato, `compare_versions`, pacchetto per GitLab, Helm, documentazione di installazione |

Le fasi 2, 3 e 4 si sovrappongono in parte una volta fissata la specifica della fase 1. La fase 6 può partire durante la fase 4, perché le servono solo i pacchetti e il database: l'insieme di prova e la scelta del modello si possono preparare anche prima.

La fase 0 non dipende da nessuna decisione e conviene avviarla subito.

---

## 10. Rischi

| Rischio | Effetto | Contromisura |
|---|---|---|
| Il sito si ferma prima della fotografia | Perse le versioni non ricostruibili e i file scaricabili | Fase 0 subito; l'inventario è già salvato |
| Conversione doctree → AST incompleta | Pagine rese male | Nodo HTML di ripiego; mappatura guidata dalle statistiche; banco di prova come test di regressione |
| Versioni storiche che non si costruiscono | Documenti mancanti | Versioni archiviate |
| `conf.py` con logica propria | Resa diversa da oggi | Il `conf.py` non viene eseguito; si leggono solo valori noti; censimento dei 40 `conf.py` in fase 1 |
| Ancore e URL diversi | Link rotti da siti istituzionali e atti | Test su tutti gli URL della fotografia; doppio identificativo |
| Pacchetti costruiti fuori dalla piattaforma | Contenuto non controllato pubblicato | Token OIDC, verifica su `italia-conf`, schema, sanificazione; l'HTML lo produce sempre la piattaforma |
| PDF meno curato del LaTeX attuale | Contestazioni degli editori | Prova comparativa in fase 2 |
| MyST cambia in modo incompatibile | Toolkit da adattare | Versioni dei pacchetti MyST bloccate nel toolkit; AST di Docs Italia versionato |
| Gli editori non adottano build nei repository | Il modello resta centralizzato | Non serve che la adottino: l'istanza costruisce da sola. La build nel repository è un vantaggio, non un obbligo |
| `eid-wallet-it-docs` (1 GB, tema e pipeline propri) | Non rientra nel modello comune | Primo candidato per la ricezione di pacchetti dalla sua CI; da concordare con i maintainer |
| Italia Tailwind UI non ha un componente che serve, o cambia le classi tra una versione e l'altra | Lavoro in più sull'interfaccia, regressioni grafiche | Versione della libreria bloccata; componenti mancanti scritti con i token del tema e proposti a monte; confronto visivo automatico prima di ogni aggiornamento |
| Le recipes di Italia Tailwind UI usate con testo dei documenti | HTML iniettato nelle pagine | Escape di tutto il testo prima di qualsiasi recipe, coperto da test; recipes solo per i componenti semplici |
| Salvataggi dell'editor che alterano parti non toccate | Perdita del testo alternativo, diff illeggibili, rifiuto da parte di chi lavora in Git | Riscrittura a blocchi; serializzatore delle direttive misurato con la prova di andata e ritorno |
| Assistenti che citano versioni superate | Indicazioni sbagliate su obblighi normativi | Filtro predefinito sulla versione predefinita; versione e URL sempre presenti in ogni risultato |
| Qualità del recupero insufficiente in italiano o su sigle e codici | Frammenti sbagliati, risposte sbagliate | Ricerca ibrida; insieme di prova misurato in CI; scelta del modello basata sulle misure |
| Testo malevolo nei contenuti indicizzati (*prompt injection*) | Un assistente esegue istruzioni nascoste in un documento | Si indicizzano solo versioni pubblicate da repository verificati, mai anteprime di pull request; i risultati MCP sono marcati come contenuto del documento |
| Domande degli utenti con dati personali | Problemi di protezione dei dati | Modello di embedding locale; registro minimo con conservazione limitata; informativa |
| Costo di calcolo degli embedding | Infrastruttura più costosa per chi riusa | Embedding per contenuto e non per versione; CPU per l'incrementale; RAG disattivabile |
| Abuso del server MCP pubblico | Carico eccessivo sul database | Limiti di frequenza; cache delle ricerche; quote più alte solo con chiave |
| Token GitHub scaduto o App disinstallata da un'organizzazione | Sincronizzazioni e build ferme senza che nessuno se ne accorga | Controlli periodici dei collegamenti nella dashboard, avvisi prima della scadenza del token, segnalazione in cima alla home |
| Magic link intercettato o casella email compromessa | Accesso non autorizzato alla dashboard | Link monouso valido 15 minuti, sessioni brevi, elenco di email ristretto, registro di ogni azione, motivazione obbligatoria; in seguito un secondo fattore |
| Interventi dalla dashboard in contrasto con il repository | Il sito non riflette quello che chi cura il documento si aspetta | Interventi visibili come forzati, con motivazione; annullabili; segnalati a chi cura il documento (commento sulla release o issue, da decidere) |

---

## 11. Decisioni

Prese:

- **MyST** è il formato Markdown di Docs Italia (16 novembre 2026).
- **RAG e server MCP** fanno parte del progetto (16 novembre 2026).
- **Interfaccia: solo il tema predefinito `italia-original`** di Italia Tailwind UI, per ora (16 novembre 2026).

Da prendere:

1. **Licenza** del codice e della specifica (ad esempio AGPL-3.0 o EUPL-1.2).
2. **Commenti del forum** (`forum_italia`, `discourse`, 270 occorrenze): mantenere, sostituire con un link, o rimuovere.
3. **PDF**: Paged.js è il motore predefinito nel monorepo e risolve i limiti di Chrome (4.5). Resta da decidere se basta, confrontandolo con il LaTeX attuale sui documenti con più `only:: format_latex`.
4. **Dove gira l'istanza** di Docs Italia e chi gestisce la GitHub App sulle organizzazioni.
5. **Redirect personalizzati**: verificare se ne esistono nel database attuale.
6. **Modello di embedding e dove calcolarlo**: modello aperto su infrastruttura propria (raccomandato) o fornitore esterno. Si decide con le misure della 7.5, ma va deciso subito se è disponibile una GPU.
7. **Accesso al server MCP**: completamente pubblico con limiti, o con registrazione obbligatoria.
8. **Invio delle email della dashboard**: quale servizio SMTP usare, e se avvisare chi cura un documento quando una sua versione viene ritirata o promossa.

## 12. Sperimentazioni: PoC del toolkit

Cartella [../italia/_poc/](../italia/_poc/), fuori da questo repository, con istruzioni in [README.md](../italia/_poc/README.md) e risultati completi in [CRITICITA.md](../italia/_poc/CRITICITA.md). Il PoC copre la fase 2 per il solo formato MyST e una prima bozza della fase 7. I test sono stati fatti solo in locale: i repository su GitHub non sono stati toccati.

### 12.1 Cosa è stato costruito

- **Documento di prova**: *Raccomandazioni UX per il once only* ([`design-UX-cittadini-once-only-docs`](https://github.com/italia/design-UX-cittadini-once-only-docs)), convertito a mano da RST a MyST con `toc.json` e `document_settings.yml` esteso.
- **Monorepo TypeScript** eseguito direttamente da Node 24+, senza compilazione (il monorepo definitivo usa invece Bun):
  - `schema`: validazione di `document_settings.yml` e `toc.json` con messaggi in italiano, JSON Schema generati, tipi del pacchetto;
  - `render`: AST → HTML con Italia Tailwind UI (solo tema `italia-original`), in cinque modalità: sito a capitoli, pagina singola, stampa, EPUB, anteprima;
  - `toolkit`: CLI `docs-italia` con `init`, `check`, `build`, `dev` e `studio`.
- **Build**: sito HTML a capitoli e a pagina singola, PDF (Chrome headless), EPUB 3, HTML compresso, pacchetto con `manifest.json` (hash dei file), AST per pagina con le posizioni di origine, `inventory.json`, `search.jsonl`, `chunks.jsonl`.
- **Controlli**: metadati, indice, link e ancore, riferimenti incrociati, immagini, testo alternativo, salti nei livelli dei titoli, file fuori indice, direttive sconosciute, schemi di link non ammessi. Ogni problema ha file e riga.
- **Anteprima** (`dev`): ricostruzione a ogni modifica, ricaricamento del browser, problemi mostrati sopra la pagina.
- **Studio** (Vite + React + CodeMirror, SQLite):
  - indice con riordino e creazione di capitoli;
  - bozze automatiche e conflitto segnalato se il file cambia sul disco;
  - anteprima con lo stesso renderer del sito;
  - schede Problemi, Git (solo locale, senza push), Metadati (conserva i commenti dello YAML) e Genera.
- **Estensioni MyST di Docs Italia**: direttiva `{highlights}` e ruolo `{rfc}`, il modello per le altre (3.3).
- **Test**: 22 test automatici, più la prova di andata e ritorno MyST → AST → MyST.

### 12.2 Misure

Documento di 8 pagine e 7 immagini, su Mac.

| Operazione | Tempo |
|---|---|
| Parsing e risoluzione dell'intero documento | 7–20 ms |
| Ricostruzione in anteprima dopo una modifica | ~40 ms |
| CSS (Tailwind 4) | ~300 ms |
| PDF | 1–2,4 s |
| Build completa | 1,5–2,9 s |

CSS del sito: 341 KB minificato, 36 KB con gzip. JavaScript dello studio: 846 KB.

### 12.3 Cosa conferma il piano

- La strada MyST in solo TypeScript funziona: un unico strumento, nessun Python, per sito, PDF, EPUB, pacchetto, anteprima ed editor.
- Il parsing è abbastanza veloce da aggiornare l'anteprima dell'editor a ogni pausa di battitura.
- L'AST conserva le posizioni di origine: è la base della riscrittura a blocchi (5.3).
- Lo schema esteso di `document_settings.yml` è retrocompatibile con tutti i 41 file locali.
- La frammentazione dall'AST produce frammenti con il contesto in testa, come previsto in 7.2.
- Il pacchetto contiene un AST e non HTML, quindi l'istanza resta l'unica a produrre l'HTML (4.2).

### 12.4 Cosa cambia nel piano

Già riportato nelle sezioni indicate:

| Risultato | Sezione |
|---|---|
| `myst-to-md` perde le opzioni delle direttive: riscrittura a blocchi obbligatoria e serializzatore proprio | 3.6, 5.3, 10 |
| `:widths:` non supportato da MyST; `highlights` da aggiungere come direttiva Docs Italia | 3.3 |
| Publisher, progetto e repository vanno in `document_settings.yml` | 3.5 |
| Casi da gestire nella conversione: file iniettati, link come URL HTML, classi del tema | 3.6 |
| PDF da Chrome buono ma senza numeri di pagina nell'indice: serve Paged.js | 4.5, 11 |
| Git attivo solo se il documento è la radice del proprio repository | 5.4 |
| Italia Tailwind UI: solo tema predefinito, recipes limitate ai componenti semplici, tipografia propria | 6.1, 6.4, 10, 11 |
| Apostrofi da normalizzare prima di ricerca ed embedding; token da contare con il tokenizer del modello | 7.2 |

### 12.5 Da segnalare a Italia Tailwind UI

1. `header()` e `footer()` inseriscono contenuto dimostrativo quando un argomento manca, e il link del marchio è fisso a `#`.
2. Le recipes non fanno escape degli argomenti e non producono XHTML (`<input>`, `<br>`, SVG senza namespace).
3. `callout()` genera id con un contatore globale, diversi da una build all'altra.
4. Nessuna opzione per scegliere i temi; `components.css` e i singoli componenti non sono esportati.
5. Manca un componente per la tipografia dei contenuti lunghi.

### 12.6 Cosa resta fuori dal PoC

- Formato RST e conversione doctree → AST (fase 1).
- Immagine Docker del toolkit, `compose.yml` dello studio, GitHub Action, invio del pacchetto a un'istanza.
- Paged.js per il PDF; validazione EPUB con `epubcheck`.
- Editor visuale (fase 8); più lingue e più versioni nello stesso repository.

### 12.7 Avanzamento nel monorepo

Dopo il PoC il codice è passato nei pacchetti di `docs-italia-platform` e gira con Bun. Lo stato, passo per passo:

| Passo | Stato | Dove |
|---|---|---|
| Codice del PoC nei pacchetti | Fatto. I tipi dell'AST sono in `schema`; `myst`, `render`, `export`, `retrieval`, `forge`, `toolkit` ed `editor` dipendono solo da ciò che dichiarano (installazione isolata di Bun). 47 test | `packages/*`, `apps/editor` |
| Documento di esempio | Fatto, con contenuto proprio: il repository originale del documento del PoC non dichiara una licenza | `examples/esempio-myst` |
| Serializzatore a blocchi | Fatto (5.3) | `packages/myst/src/serialize.ts`, `bun run fidelity` |
| Paged.js per il PDF | Fatto, motore predefinito (4.5) | `packages/export`, `packages/render/src/paged.css` |
| RST con Sphinx e conversione in MyST | Prima versione: builder `docsitalia-ast` ed estensione `docs_italia_sphinx`, comando `docs-italia convert`. Su `agid/lg-accessibilita-docs`: 11 pagine, nessun nodo perso, controllo senza problemi, 96,6% delle parole dell'uscita testuale di Sphinx (la differenza sono i numeri delle sezioni) | `packages/sphinx`, `packages/toolkit/src/convert.ts` |
| Immagine Docker, compose, GitHub Action | Immagine del toolkit **provata** (build con PDF ed EPUB validato da `epubcheck`); compose dell'istanza **provato** con `teamdigitale` sincronizzato da GitHub e pacchetti su SeaweedFS; l'Action va ancora provata su un repository vero | `deploy/toolkit/Dockerfile`, `examples/esempio-myst/compose.yml`, `.github/workflows/documento.yml`, `deploy/github/` |
| Specifica | Bozza 0, scritta in MyST e costruita con il toolkit | `spec/` |
| Segnalazioni a Italia Tailwind UI | Fatto: le modifiche sono uscite nella 0.3.0, adottata | `docs/segnalazioni/italia-tailwind-ui.md` |
| Banco di prova della conversione | Prima versione sui 41 repository presenti in locale (branch attuale): 40 convertiti, 994 pagine, tutte le build HTML riuscite, **26 senza errori al controllo**. Errori scesi da 1.163 a 275, quasi tutti in `eid-wallet-it-docs` e nelle pagine orfane, ora controllate anche loro | `packages/toolkit/scripts/banco.ts`, `inventario/banco-di-prova.md` |
| Banco di prova esteso | Fatto: tutte le 205 versioni attive dell'inventario dell'API, ognuna dal suo commit (SHA dei tag, nome dei branch): **201 convertite e costruite (98%)**, 122 senza errori al controllo; delle 77 versioni predefinite raggiunte, 47 senza errori. 86 documenti, 8.621 pagine. Le 4 mancanti non si scaricano più: `publiccodeyml` (commit del tag 0.2.1 e branch `master` spariti), `publiccodeyml-en` (`master`), `writing-toolkit` (branch `release`). Corretti nel convertitore: liste di campi (`:Fonte: Istat`, 61), descrizioni di oggetti dei domini Sphinx (`.. class::`, 20), argomenti e opzioni delle direttive su più righe (errori MyST), glossari con i termini come etichette per `{term}` (riferimenti rotti da 147 a 58) | `packages/toolkit/scripts/banco-esteso.ts`, `inventario/banco-esteso.md` |
| Pagine orfane | Fatto: `hidden` in `toc.json` (pagine costruite, fuori da indice, numerazione, pagina singola e PDF; nell'EPUB non lineari, solo se un link le raggiunge). La conversione ci mette le pagine fuori da ogni `toctree` e scarta i frammenti di `.. include::`. Spariti i 78 avvisi `not-in-toc` e i link rotti a `istruzioni_consultazione.html` | `packages/sphinx`, `packages/myst/src/project.ts`, `packages/render/src/layout.ts`, `packages/export/src/epub.ts` |
| EPUB del banco di prova | Validati con `epubcheck` tutti i 40: **39 validi** (prima 13), errori da 737 a 24, tutti in un'immagine SVG di `eid-wallet-it-docs`. Corretti: celle di tabella con più blocchi (XHTML malformato), nomi dei capitoli con spazi o accenti, URL delle immagini con spazi, link relativi non risolti, id delle etichette su elenchi e altri blocchi (anche nel sito), id delle note citate più volte, id con spazi (`:name: logo cie`), ruolo `doc-endnote` deprecato. Allegati linkati dal PDF e dall'EPUB: al sito con `filesUrl` (`--files-url`; il worker lo ricava da `SITE_URL`), altrimenti testo | `packages/export/src/epub.ts`, `packages/render/src/content.ts` |
| Segnalibri del PDF con Paged.js | Corretto: in stampa il numero dei titoli è testo semplice | `packages/render/src/content.ts` |
| Sito (fase 4) | Prima versione in Astro 7 sopra le API del server: home con ricerca, amministrazioni, publisher, progetto, pagina del documento (indice, versioni, pagina singola, download, sorgente), ricerca, pagine istituzionali (quelle legali sono segnaposto). **URL compatibili**: tutti i 77 URL dell'inventario dei documenti importati rispondono, zero errori; anche i vecchi URL dei download | `apps/site`, `apps/site/scripts/url-compat.ts` |
| Dashboard (6.6) | Prima versione senza autenticazione (`DASHBOARD_OPEN=1`, solo su indirizzo locale) o con `ADMIN_TOKEN`: visione d'insieme, stato dei collegamenti, ritiro e promozione delle versioni con registro. Provata nel browser sui dati locali | `apps/dashboard`, `apps/server/src/admin.ts`, `checks.ts` |
| Server (fase 3) | Prima versione: modello dati, sincronizzazione da `italia-conf` (regole del fork), versioni dall'inventario, coda in PostgreSQL, worker con conversione RST, pubblicazione con verifica del manifest, ricezione dei pacchetti con OIDC, webhook firmati, API e ricerca in italiano. Forge comune con `LocalForge` (clone locali) e `GitHubForge` (Octokit). Su dati reali: 3 publisher, 33 bozze e 98 versioni dell'inventario pubblicate (le altre versioni sono di repository non clonati in locale). 10 test di integrazione su PostgreSQL | `apps/server`, `packages/forge` |

Criticità emerse dopo il PoC:

- `myst-parser` imposta `spread` degli elenchi sempre allo stesso modo: elenchi compatti e distanziati si distinguono solo dal sorgente (righe vuote tra le voci).
- `myst-parser` assegna alle definizioni delle note la posizione del paragrafo che le cita.
- `{numref}` senza numerazione delle figure mostrava la didascalia al posto di "Figura 2.1": ora figure e tabelle sono sempre numerate per capitolo, e `numfig` decide se il numero compare.
- Nell'RST convertito il testo conserva gli a capo del sorgente: il serializzatore protegge l'inizio di ogni riga, non solo della prima.
- Sphinx rappresenta `:download:` con una sottoclasse di `reference`: va riconosciuto prima dei link.
- Paged.js 0.4 applica le regole a frammenti del documento senza `body`: i selettori di `paged.css` non devono partire da `body` o da sue classi.
- Con Bun, `italia.css` deve passare dal collegamento locale del pacchetto (`node_modules/@italia-tailwind/css`), perché il percorso reale contiene un hash che cambia a ogni versione.

Dal banco di prova:

- **Le etichette vanno risolte con l'indice di Sphinx** (`std.labels`), che comprende quelle generate da `autosectionlabel`: il builder raccoglie i riferimenti di tutte le pagine prima di scrivere e mette le etichette sull'elemento giusto (sezione, paragrafo, figura). Il `conf.py` si legge come testo solo per sapere se il documento usa `autosectionlabel`.
- **Non tutte le etichette RST sono etichette MyST**: `(§4.4)=` è testo. Le etichette si convertono in una forma sicura, e i riferimenti con la stessa regola.
- **Il risolutore confronta le etichette normalizzate** come fa MyST (minuscole, spazi compattati); le pagine stanno in uno spazio di nomi separato dalle etichette.
- **Le direttive sconosciute non vanno perse**: senza le estensioni del `conf.py` (mermaid, plantuml…) docutils le sostituisce con un errore. Il convertitore le ricostruisce come direttive MyST e il controllo le segnala.
- **Link scritti come URL HTML** verso altre pagine (`../pagina.html`, `../pagina`) diventano link ai file `.md`; URN e altri schemi non ammessi (`urn:oasis:…`, `about:blank`) diventano testo.
- La stessa pagina in più `toctree` (uno nascosto e uno visibile) compare una sola volta in `toc.json`.
- Con Paged.js, Chrome perde nei segnalibri del PDF un numero di titolo scritto in un `<span>` separato.
- Nell'istanza in container: gli id della stampa devono essere validi anche come selettori CSS (Paged.js li usa con `querySelector`: `#00_premessa` non lo è); il nome dei file scaricabili va passato dal worker (la cartella di lavoro non è il repository); il servizio che crea il bucket deve tollerare il riavvio.
- Restano da capire i riferimenti di `eid-wallet-it-docs` nella forma `pagina:slug-del-titolo` (188): non sono etichette di `autosectionlabel` e potrebbero dipendere da estensioni del suo `conf.py` o essere rotti anche nell'originale.

## 13. Prossimi passi

1. Provare la GitHub Action su un repository di prova, con l'invio del pacchetto all'istanza (token OIDC).
2. Provare `GitHubForge` con una GitHub App installata su un'organizzazione di prova.
3. ~~Banco di prova esteso.~~ **Fatto** (12.7, `inventario/banco-esteso.md`): 201 versioni su 205. Gli errori rimasti sono quasi tutti nei sorgenti, rotti anche sul sito attuale: ancore di Word (`_bookmark…`, `_Toc…`, 58 solo in `gl-acquisition-and-reuse-software-for-pa-docs`), immagini assenti dal repository (`design-comuni-docs`, 13 per versione; `dati-semantic-guida-ndc-docs`, 12), link a pagine rimosse. Tabelle con celle unite: 43 nel corpus completo (passo 4). Da aggiornare nell'inventario le 4 versioni che non esistono più. Demo ripopolata con tutti i repository dell'inventario (229 versioni su 93 documenti, tutti i 245 URL dell'inventario rispondono); ne sono uscite due correzioni: nomi di file con ".." (`…culturale..rst`) rifiutati come percorsi non validi, e la lingua dei documenti in inglese, che la piattaforma attuale teneva in Read the Docs e non nel repository (ora viene dall'inventario e la sincronizzazione la conserva).
4. Chiarire i riferimenti rimasti in `eid-wallet-it-docs` e le celle unite delle tabelle (11 tabelle, unione persa nella conversione).
5. Confronto del PDF di Paged.js con il LaTeX attuale sui documenti con più `only:: format_latex` (51 blocchi scartati nella conversione).
6. Editor visuale (fase 8) sopra `sourceBlocks` e `replaceBlocks`.
7. ~~Aprire le segnalazioni a Italia Tailwind UI.~~ **Fatto**: le modifiche (`docs/proposte-docs-italia-platform.md` nel repository della libreria) sono uscite nella 0.3.0, adottata: `italia.css` importa `original.css` (niente più file generato), le recipes ricevono il testo senza escape (lo fanno loro). Da valutare: `ita-prose` della libreria al posto di `packages/render/src/prose.css`, e le icone delle recipes negli EPUB, ora XHTML valido.
8. Server (fase 3), da completare: anteprime delle pull request, versioni archiviate, prova di `GitHubForge` su GitHub e di una GitHub Action vera che invia il pacchetto, istanza completa in `deploy/compose`.
9. Sito (fase 4), da completare: versioni archiviate (dipendono dalla fotografia, fase 0), pagine istituzionali come documenti MyST dell'istanza, confronto visivo con il sito attuale, verifica di accessibilità. **Fatti**: sitemap (`/sitemap.xml`, pagine della versione predefinita con il nome vero della versione; 839 URL sui dati della demo) e `robots.txt`; URL canonici con `SITE_URL` (l'alias `stabile` punta alla versione vera); pagina "versione ritirata" con stato 410, `noindex` e link alla stessa pagina della versione predefinita se esiste (anche i download rispondono 410).
10. Dashboard (6.6): ~~accesso con magic link ed elenco di email~~ (fatto), ~~pagina "versione ritirata" sul sito~~ (fatto, passo 9), controlli periodici, archiviazione delle versioni. Poi server MCP e RAG (fase 6).
11. Segnalare ad AgID che la descrizione nel suo `publisher_settings.yml` è quella di Developers Italia ("GitHub Italia è l'organizzazione…").
12. ~~Pagine orfane.~~ **Fatto** (12.7): `hidden` in `toc.json`. Le pagine orfane ora passano dal controllo e mostrano problemi che hanno anche sul sito attuale: residui di vecchie strutture in `lg-spid-attribute-authority-docs` (26 link a ancore `_Toc…` di Word), `allegati/02/01_introduzione` in `lg-documenti-informatici-docs`, pagine rimosse in `manuale-operativo-design-docs`, `doc/iso-iec-part-3` senza titolo in `lg-sicurezza-interoperabilita-docs`. Da valutare con gli editori se vanno pubblicate o tolte dai repository.
14. ~~Errori EPUB.~~ **Fatto** (12.7): 39 EPUB validi su 40. Resta `images/svg/status-update-as.svg` di `eid-wallet-it-docs`, esportato da draw.io con HTML dentro `foreignObject` (elementi `font`): da segnalare (si risolve esportando con "testo come SVG"); il controllo potrebbe avvisare.
13. Link rotti nei sorgenti, da segnalare ai proprietari (rotti anche sul sito attuale; elenco completo con `bun scripts/crawl.ts` in `apps/site`): pagine rimosse in `manuale-operativo-design-docs` (`sviluppo-web`, `seo`, `stile`, `accessibilita`), indirizzi senza `https://` (`www.normattiva.it/…` in `lg-competenze-digitali-*` e `pianotriennale-ict-doc`), link a etichette scritti come URL in `spid-cie-oidc-docs` (`<Entity_Configuration>`, `<MetadataOP>`), percorso `docs/premesse/…` in `dati-semantic-guida-ndc-docs`. Il controllo potrebbe segnalare gli indirizzi senza schema che iniziano con `www.`. Inoltre direttive senza spazio dopo `::` (`.. code-block::java`), che per RST sono commenti e quindi non vengono pubblicate, né oggi né dopo la conversione (che ora le conta tra il contenuto scartato): `cie-eid-sdk-docs` (5 blocchi di codice), `lg-qtsp-pec-statistiche-docs` (13), `lg-spid-firma-docs` (2), `lg-spid-uso-professionale-docs`, `lg-conservazione-cessazione-docs`.
