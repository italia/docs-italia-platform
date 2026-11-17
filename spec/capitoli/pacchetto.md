(pacchetto)=
# Pacchetto di build

Il pacchetto è una cartella con file JSON e risorse. Lo produce allo stesso modo il toolkit in locale, la GitHub Action del repository o il worker di un'istanza.

```text
manifest.json        documento, versione, commit, versione del toolkit, hash dei file
metadata.json        document_settings.yml validato
toc.json             pagine in ordine, con numeri e livelli
inventory.json       etichette → pagina e ancora
pages/<pagina>.json  AST MyST risolto, con le posizioni di origine
search.jsonl         un record per sezione: titolo, percorso, testo
chunks.jsonl         frammenti per la ricerca semantica
assets/              immagini e file scaricabili
downloads/           PDF, EPUB, HTML compresso
```

## Manifest

`schema` vale `docs-italia/bundle@0`. `files` elenca ogni file con dimensione e SHA-256: un'istanza deve verificarli prima di pubblicare.

## AST

L'AST è quello di MyST (mdast) con i campi aggiunti dalla risoluzione:

- `anchor` e `number` su titoli, figure e tabelle;
- `internal` sui link ad altre pagine (`page`, `anchor`);
- `resolved` sui riferimenti incrociati;
- `asset` su immagini e link a file;
- `position` con le righe di origine;
- `origin` con la forma originale di direttive e ruoli.

Il pacchetto contiene un AST e non HTML: l'HTML lo produce sempre l'istanza.

## Frammenti

Ogni frammento di `chunks.jsonl` è una sezione, o una parte di sezione lunga, con il percorso dei titoli in testa:

```text
Documento › 2. Capitolo › 2.1 Sezione

Testo della sezione…
```

Il testo è normalizzato (apostrofi e virgolette dritti). `hash` è lo SHA-256 del testo: un'istanza calcola un embedding per contenuto, non per versione.
