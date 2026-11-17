# deploy

Installazione di un'istanza e immagine del toolkit.

| Cartella | Contenuto |
|---|---|
| `compose/` | Istanza completa con Docker Compose: server, sito, server MCP, worker, PostgreSQL con pgvector, SeaweedFS (object storage S3), servizio di embedding. Per un'amministrazione piccola |
| `helm/` | La stessa istanza su Kubernetes |
| `toolkit/` | Immagine Docker del toolkit: Bun, Python con Sphinx, Chromium per il PDF, Java per PlantUML ed `epubcheck`. Usata in CI, dal worker e dallo studio (`compose.yml` nei repository dei documenti) |
| `github/` | Workflow da copiare nei repository dei documenti, che richiama il workflow riusabile `.github/workflows/documento.yml` |

Stato:

- `toolkit/Dockerfile`: costruito e provato (1,66 GB): build completa con PDF da Chromium ed EPUB validato da `epubcheck`. `examples/esempio-myst/compose.yml` lo usa per studio e anteprima.
- `github/`: scritto, **non ancora provato** su GitHub.
- `compose/`: istanza con PostgreSQL (pgvector), SeaweedFS e server; provata con `teamdigitale` sincronizzato da GitHub. Mancano sito, server MCP e servizio di embedding, che arriveranno con le loro fasi. Si avvia con `cp .env.example .env` e `docker compose up -d`.
- `helm/`: vuoto.

Piano di progetto: sezioni 4.1, 4.3, 5.1, 8.
