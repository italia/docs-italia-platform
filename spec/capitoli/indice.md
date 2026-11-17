(indice)=
# Indice: `toc.json`

Per i documenti MyST l'indice è un file JSON nella cartella della sorgente. Elenca i **file** e il loro ordine; i titoli vengono dai file stessi.

## Campi

- `root`: la pagina iniziale. Predefinito: `index.md`.
- `caption`: titolo dell'indice.
- `numbered`: numerazione di capitoli e sezioni ("2.1"). Predefinito: `true`.
- `numfig`: numero visibile nelle didascalie di figure e tabelle ("Figura 2.1"). Predefinito: `false`. Con `false` le figure sono comunque numerate per `{numref}`, ma il controllo segnala l'uso di `{numref}`.
- `chapters`: le voci dell'indice.

Ogni voce ha `file`, oppure `title` e `children` (un gruppo senza pagina propria). `children` crea sottocapitoli. `numbered: false` toglie la numerazione alla voce e ai suoi figli, per esempio agli allegati.

## Regole

- Un file `.md` della sorgente che non compare nell'indice non viene pubblicato: il controllo lo segnala.
- Ogni file deve cominciare con un titolo di primo livello.
- I file tipici di un repository (`README.md`, `CHANGELOG.md`, `LICENSE.md`…) non fanno parte del documento.

```json
{
  "root": "index.md",
  "numbered": true,
  "chapters": [
    { "file": "introduzione.md" },
    { "file": "architettura.md", "children": [{ "file": "sicurezza.md" }] },
    { "file": "allegati/a.md", "numbered": false }
  ]
}
```
