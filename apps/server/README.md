# @docs-italia/server

Server dell'istanza: importazione da `italia-conf`, coda delle build, pubblicazione dei pacchetti, API per sito, MCP e dashboard.

Piano di progetto: sezioni 2.2, 4.3, 4.6, 6.2, 6.3, fase 3.

## Stato

Funzionante:

- modello dati e migrazioni (`src/migrations/`);
- sincronizzazione da `italia-conf` con le regole del fork (slug dei progetti, progetti e documenti tolti disattivati);
- versioni iniziali dall'inventario del sito attuale, con gli slug di oggi;
- coda dei lavori in PostgreSQL e worker che costruisce i pacchetti, convertendo l'RST con Sphinx;
- pubblicazione: manifest e hash verificati, storage, indice di ricerca, puntatore della versione;
- ricezione dei pacchetti dalle GitHub Actions con token OIDC;
- webhook GitHub firmati (push sul branch della bozza, tag, `italia-conf`);
- API di lettura e ricerca full-text in italiano.

Provato su dati reali: i tre publisher dai clone locali, 33 bozze e 98 versioni dall'inventario costruite e pubblicate. Provato anche come istanza completa (`deploy/compose`): `teamdigitale` sincronizzato da GitHub (accesso anonimo), tre documenti costruiti nel container con PDF ed EPUB validato e pubblicati su SeaweedFS.

Da fare:

- anteprime delle pull request;
- utenti e ruoli (arrivano con la dashboard, todo.md 6.6); per ora l'amministrazione usa un token;
- prova della ricezione con un'Action vera e di `GitHubForge` con GitHub App;
- versioni archiviate (todo.md 2.3).

## Avvio

```sh
# PostgreSQL con pg_trgm (e in seguito pgvector)
createdb docs_italia_dev

export DATABASE_URL=postgres://localhost/docs_italia_dev
export FORGE_LOCAL_ROOT=/percorso/con/<organizzazione>/<repository>   # oppure GITHUB_TOKEN / GitHub App
export ADMIN_TOKEN=…   GITHUB_WEBHOOK_SECRET=…

bun src/main.ts sync agid        # importa un publisher e accoda le bozze
bun src/main.ts seed ../../inventario/docs-italia-api-snapshot.json   # versioni del sito attuale
bun src/main.ts work             # esegue i lavori in coda
bun src/main.ts                  # API + worker su http://127.0.0.1:8080
```

## Variabili d'ambiente

| Variabile | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `PORT`, `HOST`, `PUBLIC_URL` | Indirizzo del server |
| `FORGE_LOCAL_ROOT` | Repository da clone locali (`<radice>/<organizzazione>/<repository>`) |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` o `GITHUB_APP_PRIVATE_KEY_FILE` | GitHub App (consigliata) |
| `GITHUB_TOKEN` | In alternativa all'App, token in lettura |
| `GITHUB_WEBHOOK_SECRET` | Verifica dei webhook |
| `STORAGE_DIR` | Storage su file system (predefinito `./.docs-italia/storage`) |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | Object storage S3-compatibile (SeaweedFS nel compose dell'istanza) |
| `OIDC_AUDIENCE` | Audience attesa nei token delle Actions (predefinita: `PUBLIC_URL`) |
| `ADMIN_TOKEN` | Operazioni di amministrazione, finché non c'è la dashboard |
| `BUILD_PDF=0` | Build senza PDF (sviluppo, test) |
| `WORKER=0` | Solo API, senza worker |
| `DOCS_ITALIA_PYTHON` | Python con Sphinx per i documenti RST |

## API

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /api/publishers` | Publisher attivi |
| `GET /api/publishers/:pub` | Publisher con progetti e documenti pubblicati |
| `GET /api/documents/:pub/:progetto/:doc` | Documento, versioni pubblicate, versione predefinita, alias `stabile` e `bozza` |
| `GET /api/documents/:pub/:progetto/:doc/:lingua/:versione/<file>` | File del pacchetto pubblicato (`toc.json`, `pages/…json`, `assets/…`, `downloads/…`); la versione accetta gli alias `stabile`/`stable`/`bozza`/`draft` |
| `GET /api/search?q=…&publisher=…&document=…` | Ricerca full-text in italiano sulla versione predefinita |
| `POST /api/webhooks/github` | Webhook GitHub (firma `X-Hub-Signature-256`) |
| `POST /api/bundles` | Pacchetto (zip) da una GitHub Action, con token OIDC; il repository deve essere in `italia-conf` |
| `POST /api/admin/sync/:org` · `POST /api/admin/seed` · `POST /api/admin/builds` · `GET /api/admin/builds` · `GET /api/admin/jobs` | Amministrazione (`Authorization: Bearer $ADMIN_TOKEN`) |

## Test

`bun test apps/server`: integrazione su PostgreSQL (`TEST_DATABASE_URL`, predefinito `postgres://localhost/docs_italia_test`; lo schema `public` viene ricreato), con repository Git creati al momento. Se il database non è raggiungibile i test si saltano.
