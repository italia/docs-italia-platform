(configurazione)=
# Configurazione: `document_settings.yml`

Il file sta nella radice del repository. Un file scritto per la piattaforma attuale resta valido: tutti i campi nuovi sono facoltativi.

## Campi

:::{list-table} Campi di `document`.
:header-rows: 1
:name: tab-campi

* - Campo
  - Obbligatorio
  - Significato
* - `name`
  - sì
  - Titolo del documento.
* - `description`
  - sì
  - Descrizione breve.
* - `tags`
  - sì
  - Elenco di argomenti; un'istanza può filtrarli su un vocabolario.
* - `format`
  - no
  - `rst` (predefinito) o `myst`.
* - `source`
  - no
  - Cartella della sorgente, relativa alla radice. Predefinito: `.`.
* - `languages`
  - no
  - Lingue del documento. Predefinito: `[it]`.
* - `versions`
  - no
  - `draft` (branch della bozza), `releases` (`tags`, `github-releases`, `none`), `default`.
* - `downloads`
  - no
  - Formati scaricabili tra `pdf`, `epub`, `html`.
* - `publisher`, `project`, `repository`
  - no
  - Informazioni che la piattaforma attuale tiene solo nel suo database.
:::

Altri campi presenti nei repository attuali (`short_name`, `author`, `type`…) sono conservati e ignorati.

## Esempio

```yaml
document:
  name: Linee guida di esempio
  description: Breve descrizione.
  tags: [linee guida, interoperabilità]
  format: myst
  downloads: [pdf, epub, html]
```
