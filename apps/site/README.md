# @docs-italia/site

Sito pubblico dell'istanza (Astro, rendering lato server) sopra le API del server. Il contenuto dei documenti lo produce `@docs-italia/render`, lo stesso renderer del toolkit, con Italia Tailwind UI (solo tema `italia-original`).

Piano di progetto: sezione 6.4, fase 4.

## Stato

Prima versione funzionante:

- home con ricerca, amministrazioni, pagina del publisher e del progetto;
- pagina del documento:
  - indice laterale e indice della pagina;
  - selettore di versione;
  - pagina precedente e successiva;
  - pagina singola;
  - download;
  - collegamento al sorgente su GitHub;
  - banner della bozza;
- ricerca full-text in italiano con le parole evidenziate;
- pagine istituzionali: "Che cos'è" e "Come pubblicare" scritte; note legali, privacy e cookie sono segnaposto, perché il loro contenuto lo decide l'amministrazione che gestisce l'istanza.

**URL compatibili con il sito attuale.** Sui documenti importati in locale, tutti i 77 URL dell'inventario (canonici e di versione) rispondono, con zero errori (`scripts/url-compat.ts`).

| URL | Pagina |
|---|---|
| `/<publisher>/<progetto>/<documento>/` | Redirect alla versione predefinita, con l'URL canonico di oggi |
| `/<publisher>/<progetto>/<documento>/<lingua>/<versione>/` | Pagina iniziale; la versione accetta `stabile`/`stable` e `bozza`/`draft` |
| `…/<versione>/<pagina>.html` (e il vecchio stile `…/<pagina>/`) | Capitolo |
| `…/<versione>/pagina-singola.html` | Tutto il documento in una pagina |
| `/projects/<documento>/downloads/<pdf\|epub\|htmlzip>/<versione>/` | File scaricabili, agli URL di oggi |

Da fare:

- versioni archiviate;
- sitemap;
- pagine istituzionali come documenti MyST dell'istanza;
- confronto visivo con il sito attuale;
- cache davanti al sito (CDN o proxy);
- verifica di accessibilità con strumenti automatici e manuale.

## Avvio

```sh
bun run build                                   # in apps/site
API_URL=http://127.0.0.1:8080 PORT=4321 bun run start
bun scripts/url-compat.ts --site http://127.0.0.1:4321 --api http://127.0.0.1:8080
```

| Variabile | Uso |
|---|---|
| `API_URL` | Indirizzo del server dell'istanza (predefinito `http://127.0.0.1:8080`) |
| `HOST`, `PORT` | Indirizzo del sito |
