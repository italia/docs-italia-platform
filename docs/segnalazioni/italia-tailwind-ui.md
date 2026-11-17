# Segnalazioni per Italia Tailwind UI

Bozze di issue per [italia/italia-tailwind-ui](https://github.com/italia/italia-tailwind-ui), emerse usando `@italia-tailwind/css` e `@italia-tailwind/recipes` 0.2.0 in docs-italia-platform. Da rileggere e aprire a mano.

La versione verificata sul sorgente, con file e righe, sta nel repository della libreria: `docs/proposte-docs-italia-platform.md` (clone locale `italia-tailwind-ui`, 17 novembre 2026). Rispetto a questa bozza aggiunge che il contatore globale degli id è anche in `checkbox`, `hero` e `autocomplete`, e che `calloutMore()` usa un id fisso, ripetuto se i riquadri sono più d'uno.

---

## 1. `header()` e `footer()` inseriscono contenuto dimostrativo quando un argomento manca

**Cosa succede.** Senza argomenti espliciti, le recipes riempiono l'intestazione e il piè di pagina con dati di esempio. Anche passando elenchi vuoti:

```ts
header({ owner: 'Docs Italia', title: 'Doc', links: [], slimLinks: [], socials: [], languages: [], access: 'none', search: false });
footer({ brand: 'Docs Italia', columns: [], socials: [], smallPrints: [{ label: 'Privacy', href: '#' }] });
```

- `header()` produce un selettore di lingua con scritto `undefined` e un pulsante del menu che apre un menu vuoto;
- `footer()` aggiunge la sezione "Contatti" con "Comune di Lorem Ipsum, Via Roma 0".

Inoltre il link del marchio è sempre `href="#"` e non si può impostare.

**Proposta.** Contenuto dimostrativo solo nelle pagine di documentazione e nelle storie, non come valore predefinito delle recipes. Un elenco vuoto o un argomento assente non mostra la sezione. Un argomento `href` per il marchio.

---

## 2. Le recipes non fanno escape degli argomenti e non producono XHTML

**Cosa succede.**

- Il testo passato alle recipes (`label`, `title`…) finisce nell'HTML così com'è. Il README lo dice, ma chi usa le recipes con contenuti di terzi (documenti, dati di un CMS) rischia l'iniezione di HTML.
- L'HTML non è XHTML valido: `<input …>` e `<br>` non chiusi, `<svg>` senza `xmlns`. Le recipes non si possono quindi usare in un EPUB.

**Proposta.** Escape degli argomenti di testo, con un argomento separato e dichiarato (ad esempio `html`) per chi vuole passare markup. Elementi vuoti chiusi (`<br />`) e `xmlns` sugli SVG: non cambiano nulla in HTML e rendono l'uscita usabile anche in XHTML.

---

## 3. `callout()` genera id diversi a ogni esecuzione

**Cosa succede.** L'id del titolo (`callout-title-12`) viene da un contatore globale: dipende da quante recipes sono state chiamate prima. Due build dello stesso documento producono HTML diverso, e i confronti tra build e la cache non funzionano.

**Proposta.** Un argomento `id`, già presente, usato anche per il titolo (`${id}-title`), e id derivati dal contenuto quando manca.

---

## 4. Nessun modo di scegliere i temi; `components.css` non è esportato

**Cosa succede.** `@italia-tailwind/css` attiva daisyUI con `themes: all` (39 temi) e il README sconsiglia di dichiarare di nuovo il plugin. Chi vuole solo `italia-original` deve estrarre il tema da `themes.css` e importare i singoli file. `components.css` però non è tra gli `exports` del pacchetto e va importato per percorso.

Con il solo tema `italia-original` il CSS di un sito di documentazione scende da 384 KB a 341 KB minificati. Il resto viene dai componenti `ita-*`, che finiscono tutti nel foglio anche se la pagina ne usa pochi.

**Proposta.**

- Un punto di ingresso senza temi (o con il solo `italia-original`), ad esempio `@italia-tailwind/css/core.css`.
- `components.css` e i singoli componenti (`components/callout.css`…) tra gli `exports`.

---

## 5. Un componente per la tipografia dei contenuti lunghi

**Cosa succede.** Il preflight di Tailwind azzera margini ed elenchi e la libreria definisce solo i titoli. Per pubblicare testi lunghi (documentazione, linee guida, articoli) serve una tipografia completa: paragrafi, elenchi, tabelle, citazioni, codice, figure, note.

**Proposta.** Un componente `ita-prose`, con i token del tema, sul modello di `@tailwindcss/typography`. docs-italia-platform ne ha una prima versione (`packages/render/src/prose.css`) che si può proporre come punto di partenza.

---

## Nota per chi usa Paged.js

Non è un problema della libreria, ma vale la pena documentarlo. Paged.js 0.4 divide i selettori alle virgole anche dentro `:is()` e `:where()`, quindi non riesce ad analizzare il CSS della libreria. Il CSS va escluso dalla sua analisi con `data-pagedjs-ignore`, e le regole di impaginazione vanno scritte in un foglio a parte.
