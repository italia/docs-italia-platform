# Docs Italia

Nuova piattaforma di [Docs Italia](https://docs.italia.it), che sostituisce l'attuale fork di Read the Docs.

Usa gli stessi repository GitHub e gli stessi file di configurazione di oggi (`italia-conf`, `publisher_settings.yml`, `projects_settings.yml`, `document_settings.yml`). Aggiunge:

- un formato Markdown accanto all'RST: [MyST](https://mystmd.org), con l'indice del documento in `toc.json`;
- build e anteprima nei repository dei documenti;
- un editor locale;
- ricerca semantica e un server MCP per gli assistenti;
- la possibilità per altre PA di installare la propria istanza.

> **Stato: ossatura.** Le cartelle, i pacchetti e le loro dipendenze ci sono, ma il codice no. Il punto di partenza è il PoC del toolkit, che costruisce già un documento MyST in sito, PDF, EPUB e pacchetto, e ha una prima bozza dell'editor.

## Come funziona

```
repository del documento                     istanza Docs Italia
────────────────────────                     ───────────────────
.md + toc.json + document_settings.yml
        │
        ▼  toolkit (CLI docs-italia)
pacchetto: AST, indice, ricerca,      ──▶   server ── PostgreSQL + pgvector
frammenti, immagini, PDF, EPUB               │    └─ object storage (pacchetti, download)
        │                                     ├──▶ sito (Astro)
        └─ anteprima locale, studio           ├──▶ server MCP
                                              └──▶ editor ospitato
```

1. Ogni documento vive in un repository. Il toolkit lo legge (MyST in TypeScript, RST tramite Sphinx) e produce un **pacchetto**: AST per pagina, indice, inventario delle etichette, testi per la ricerca, frammenti per il RAG, immagini, PDF ed EPUB.
2. Il pacchetto si costruisce allo stesso modo in locale, nella GitHub Action del repository o nel worker dell'istanza.
3. L'istanza riceve il pacchetto, lo verifica e lo pubblica. Il sito rende l'AST in HTML: l'HTML lo produce sempre la piattaforma, mai il repository.

## Struttura

```
packages/            librerie
  schema/            schemi di configurazione e del pacchetto
  myst/              lettura MyST e risoluzione dell'AST
  sphinx/            estensione Sphinx in Python: RST → AST
  render/            AST → HTML con Italia Tailwind UI
  export/            PDF, EPUB, HTML compresso
  retrieval/         ricerca e frammenti per il RAG
  forge/             GitHub (poi GitLab) e Git locale
  toolkit/           CLI docs-italia
apps/                applicazioni
  server/            API, importazione, build, autenticazione
  mcp/               server MCP
  site/              sito pubblico
  editor/            studio locale ed editor ospitato
deploy/              Docker Compose, Helm, immagine del toolkit
spec/                specifica pubblica del formato e JSON Schema
```

## Pacchetti

| Pacchetto | Cosa fa | Usato da |
|---|---|---|
| [`@docs-italia/schema`](packages/schema) | Valida `document_settings.yml` (retrocompatibile con il fork attuale) e `toc.json`, con messaggi in italiano. Definisce il formato del pacchetto. Genera i JSON Schema di `spec/` | tutti |
| [`@docs-italia/myst`](packages/myst) | Legge MyST con le estensioni di Docs Italia. Risolve titoli numerati, ancore, etichette, link tra pagine e riferimenti. Esegue i controlli con file e riga. Riscrive solo i blocchi modificati per l'editor | toolkit, studio |
| [`docs-italia-sphinx`](packages/sphinx) | Estensione Sphinx (Python) che converte l'RST esistente nello stesso AST. È l'unico pacchetto non TypeScript | toolkit, worker |
| [`@docs-italia/render`](packages/render) | Trasforma l'AST in HTML (sempre XHTML valido, con escape di tutto il testo). Layout per sito, pagina singola, stampa, EPUB e anteprima. Usa Italia Tailwind UI con il solo tema `italia-original` | export, sito, editor |
| [`@docs-italia/export`](packages/export) | PDF con Chromium (poi Paged.js), EPUB 3, archivio HTML | toolkit |
| [`@docs-italia/retrieval`](packages/retrieval) | Prepara i record per la ricerca e i frammenti per il RAG, con il percorso dei titoli in testa e un hash per contenuto. Normalizza il testo. Fa la ricerca ibrida (full-text + vettoriale) | toolkit, server, sito, MCP |
| [`@docs-italia/forge`](packages/forge) | Legge `italia-conf` e i repository; gestisce webhook, GitHub App e token OIDC. Esegue le operazioni Git locali dello studio (mai push) | server, toolkit |
| [`@docs-italia/toolkit`](packages/toolkit) | La CLI `docs-italia` (vedi sotto) | repository dei documenti, CI, worker |

## Applicazioni

| Applicazione | Tecnologie | Cosa fa |
|---|---|---|
| [`apps/server`](apps/server) | Bun, Hono, PostgreSQL, pg-boss | API; importazione da `italia-conf` e ripopolamento iniziale; coda delle build; ricezione e pubblicazione dei pacchetti; indicizzazione; autenticazione OIDC e ruoli |
| [`apps/mcp`](apps/mcp) | SDK MCP, Streamable HTTP | Ricerca e lettura dei documenti per assistenti e agenti, sempre con fonte e versione. Restituisce frammenti, non genera risposte |
| [`apps/site`](apps/site) | Astro con rendering lato server, Italia Tailwind UI | Sito pubblico con gli stessi URL di oggi; versioni archiviate; ricerca; download |
| [`apps/editor`](apps/editor) | Vite, React, CodeMirror | Studio locale (con SQLite) ed editor ospitato nell'istanza (con PostgreSQL): stesso codice, backend diverso |

## Strumenti

### CLI `docs-italia`

Si installa nei repository dei documenti e si usa in locale, in CI e nel worker dell'istanza.

| Comando | Cosa fa |
|---|---|
| `docs-italia init` | Crea `document_settings.yml`, `toc.json`, i primi file e gli script npm, senza sovrascrivere nulla |
| `docs-italia check` | Controlla metadati, indice, link e ancore, riferimenti, immagini, testo alternativo, struttura dei titoli |
| `docs-italia build` | Produce sito HTML, PDF, EPUB, HTML compresso e pacchetto in `dist/`; `--html`, `--pdf`, `--epub`, `--bundle` per produrne solo alcuni |
| `docs-italia dev` | Anteprima locale con ricaricamento automatico e problemi mostrati sopra la pagina |
| `docs-italia studio` | Editor locale nel browser, anche tramite `docker compose up` nel repository del documento |
| `docs-italia publish` | Invia il pacchetto a un'istanza |
| `docs-italia mcp` | Server MCP locale sul documento in lavorazione |

Nell'ossatura la CLI elenca i comandi ma non li esegue ancora.

### Tecnologie

| Ambito | Strumento | Note |
|---|---|---|
| Runtime e gestore di pacchetti | [Bun](https://bun.sh) (versione in `.bun-version`) | Esegue TypeScript senza compilazione; `bun.lock` è il file di blocco |
| Monorepo | Workspace di Bun, installazione isolata | Ogni pacchetto vede solo le dipendenze che dichiara: una dipendenza dimenticata fa fallire subito import e test. Le dipendenze tra pacchetti sono `"*"` |
| Test | `bun test` con `bun:test` | File `*.test.ts` in `packages/<nome>/test/` e `apps/<nome>/test/`; `tests/` alla radice controlla la struttura del monorepo |
| Controllo dei tipi | TypeScript 5.9 (`bun run typecheck`) | Solo controllo: l'esecuzione è di Bun |
| Formato dei documenti | `myst-parser`, `myst-directives`, `myst-roles` | Più le estensioni di Docs Italia |
| RST | Sphinx 8 (Python 3.12+) | Solo in `packages/sphinx`; il `conf.py` dei repository non viene eseguito |
| Interfaccia | Tailwind CSS 4, daisyUI 5, [Italia Tailwind UI](https://github.com/italia/italia-tailwind-ui) | Solo il tema `italia-original`, per ora |
| PDF | Chromium headless, poi Paged.js | Nell'immagine del toolkit |
| Validazione EPUB | `epubcheck` | In CI |
| Database | PostgreSQL con pgvector e pg-boss | Metadati, coda, ricerca testuale e vettoriale |
| File | Object storage S3-compatibile, MinIO per le installazioni autonome | Pacchetti immutabili |
| Studio locale | SQLite (`bun:sqlite`) | Solo bozze e registro: il contenuto sta nei file del repository |

## Avvio

```sh
bun install
bun test
bun run typecheck
bun run docs-italia help
```

Serve Bun alla versione indicata in `.bun-version`.

Per `packages/sphinx` serve Python 3.12+: `pip install -e packages/sphinx`.

## Documenti di progetto

| File | Contenuto |
|---|---|
| [`todo.md`](todo.md) | Piano di progetto: stato di partenza, formato dei documenti, toolkit, editor, piattaforma, RAG e MCP, riuso, fasi, rischi, decisioni, risultati del PoC |
| [`inventario/`](inventario) | Fotografia dei 105 documenti e delle 205 versioni pubblicate oggi (dall'API di Docs Italia), e scansione su GitHub dei repository dichiarati in `italia-conf` |

Il PoC del toolkit è fuori da questo repository, in `../italia/_poc`.

## Convenzioni

- Messaggi per l'utente in italiano: errori, controlli, interfaccia.
- Ogni pacchetto ha un README con i suoi compiti e le sue dipendenze; il test di struttura in `tests/` lo verifica.
- Le modifiche al formato dei documenti passano prima da `spec/`.
- Le operazioni Git del toolkit e dello studio sono solo locali; la pubblicazione passa da una pull request.

## Licenza

Da decidere (ad esempio AGPL-3.0 o EUPL-1.2). Quando sarà scelta, il repository avrà `LICENSE` e `publiccode.yml` per il catalogo di Developers Italia.
