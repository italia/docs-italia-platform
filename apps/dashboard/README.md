# @docs-italia/dashboard

Dashboard di amministrazione dell'istanza (Vite + React + Italia Tailwind UI, solo tema `italia-original`). Piano di progetto: sezione 6.6.

Serve a chi gestisce l'istanza, non ai redattori: dà la visione d'insieme e permette di risolvere i problemi e di ritirare o promuovere le versioni senza toccare i repository.

## Pagine

| Pagina | Cosa mostra | Cosa si può fare |
|---|---|---|
| Panoramica | Collegamenti che non funzionano, contatori, versioni con l'ultima build fallita, documenti non importati, documenti con errori nei controlli, interventi in vigore | — |
| Organizzazioni | Stato di sincronizzazione di ogni `italia-conf`, documenti, ultimo webhook | Sincronizzare |
| Documenti | Elenco filtrabile (testo, organizzazione, stato) | — |
| Documento | Versioni con stato, predefinita, controlli, ultima build, interventi; build recenti | Ricostruire una versione; ritirarla o ripristinarla; promuoverla a predefinita o tornare alla regola del repository |
| Build | Riepilogo, problemi dei controlli (con link al file su GitHub per i documenti MyST), log | — |
| Coda dei lavori | Sincronizzazioni e build in coda, in corso, fallite | Rilanciare un lavoro fallito |
| Webhook | Consegne di GitHub ricevute e cosa ne ha fatto il server | — |
| Stato dei collegamenti | Database, archivio dei file, coda e worker, GitHub (App, token o anonimo; limiti), `italia-conf`, webhook | Verificare ora |
| Registro | Chi ha fatto cosa, quando e perché | — |

Ogni intervento sulle versioni chiede una **motivazione**, è un'operazione sul database (`version_override`), prevale sugli eventi del repository finché non viene revocato e finisce nel registro (`audit_log`).

## Accesso

Il magic link (6.6) non c'è ancora. Nel frattempo:

- `DASHBOARD_OPEN=1`: dashboard aperta, **solo con il server su un indirizzo locale** (`HOST=127.0.0.1`, il predefinito); con un altro indirizzo il server non parte. Gli interventi sono registrati come «dashboard (accesso aperto)».
- Altrimenti la dashboard chiede il token di amministrazione (`ADMIN_TOKEN`), che resta solo nella scheda del browser. È il caso di Docker Compose, dove il server ascolta su `0.0.0.0` nel container.

## Sviluppo

```sh
bun run dev     # http://127.0.0.1:5174/dashboard/, le chiamate /api vanno al server sulla porta 8080
bun run build   # dist/, servita dal server in /dashboard/
```

Le rotte sono nel frammento dell'URL (`#/documenti/12`): il server serve sempre `index.html`, e i filtri si possono condividere come link.

## Dipende da

- `@docs-italia/render` (solo `italia.css`)
- l'API di amministrazione del server (`apps/server/src/admin.ts`)
