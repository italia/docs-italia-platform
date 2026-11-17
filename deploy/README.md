# deploy

Installazione di un'istanza e immagine del toolkit.

| Cartella | Contenuto |
|---|---|
| `compose/` | Istanza completa con Docker Compose: server, sito, server MCP, worker, PostgreSQL con pgvector, MinIO, servizio di embedding. Per un'amministrazione piccola |
| `helm/` | La stessa istanza su Kubernetes |
| `toolkit/` | Immagine Docker del toolkit: Bun, Python con Sphinx, Chromium per il PDF, Java per PlantUML ed `epubcheck`. Usata in CI, dal worker e dallo studio (`compose.yml` nei repository dei documenti) |
| `github/` | Workflow da copiare nei repository dei documenti, che richiama il workflow riusabile `.github/workflows/documento.yml` |

Stato:

- `toolkit/Dockerfile`: scritto, **non ancora costruito** (il demone Docker non era attivo quando è stato scritto). `examples/esempio-myst/compose.yml` lo usa per studio e anteprima.
- `github/`: scritto, **non ancora provato** su GitHub.
- `compose/` e `helm/`: vuoti, arrivano con il server.

Piano di progetto: sezioni 4.1, 4.3, 5.1, 8.
