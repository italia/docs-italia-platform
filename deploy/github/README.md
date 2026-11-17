# GitHub Actions per i repository dei documenti

- `../../.github/workflows/documento.yml`: workflow riusabile di questo repository. Controlla e costruisce un documento (MyST, o RST con Sphinx) e salva pacchetto e sito come artefatti.
- `documento.yml` (qui): il file da copiare nei repository dei documenti, in `.github/workflows/docs-italia.yml`.

Non ancora provati su GitHub: il primo repository di prova li verificherà. L'invio del pacchetto all'istanza con il token OIDC arriverà con il server (todo.md, 4.3).
