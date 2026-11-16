# deploy

Installazione di un'istanza e immagine del toolkit.

| Cartella | Contenuto |
|---|---|
| `compose/` | Istanza completa con Docker Compose: server, sito, server MCP, worker, PostgreSQL con pgvector, MinIO, servizio di embedding. Per un'amministrazione piccola |
| `helm/` | La stessa istanza su Kubernetes |
| `toolkit/` | Immagine Docker del toolkit: Node, Python con Sphinx, Chromium per il PDF, Java per PlantUML ed `epubcheck`. Usata in CI, dal worker e dallo studio (`compose.yml` nei repository dei documenti) |

Ossatura: le cartelle sono vuote. Piano di progetto: sezioni 4.1, 5.1, 8.
