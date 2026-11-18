#!/usr/bin/env bun
/**
 * docs-italia — toolkit dei documenti Docs Italia (PoC).
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from '../src/build.ts';
import { check, formatProblems } from '@docs-italia/myst';

const HELP = `docs-italia <comando> [opzioni]

Comandi:
  init [cartella]   crea document_settings.yml, toc.json, index.md e package.json
  convert <rst> --out <cartella>
                    converte un documento RST in MyST (serve Python con Sphinx)
  check             valida metadati, indice, link, immagini, riferimenti
  build             produce sito HTML, PDF, EPUB, HTML compresso e pacchetto
                    --html --pdf --epub --zip --bundle per produrne solo alcuni
                    --pdf-engine pagedjs|chrome (predefinito pagedjs)
                    --files-url <url> indirizzo pubblico dei file del documento:
                    nel PDF e nell'EPUB gli allegati si linkano lì (senza, diventano testo)
  dev               anteprima locale con ricaricamento automatico (--port, predefinita 4321)
  studio            editor locale (--port, predefinita 4322)

Opzioni comuni:
  --dir <cartella>  cartella del documento (predefinita: quella corrente)
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      port: { type: 'string' },
      html: { type: 'boolean' },
      pdf: { type: 'boolean' },
      epub: { type: 'boolean' },
      zip: { type: 'boolean' },
      bundle: { type: 'boolean' },
      open: { type: 'boolean' },
      'pdf-engine': { type: 'string' },
      out: { type: 'string' },
      'files-url': { type: 'string' },
    },
  });
  const root = resolve(values.dir ?? positionals[0] ?? '.');

  switch (cmd) {
    case 'check': {
      const problems = check(root);
      console.log(formatProblems(problems));
      process.exitCode = problems.some((p) => p.level === 'errore') ? 1 : 0;
      break;
    }
    case 'build': {
      const only = ['html', 'pdf', 'epub', 'zip', 'bundle'].filter((k) => values[k as keyof typeof values]);
      const sel = only.length ? Object.fromEntries(['html', 'pdf', 'epub', 'zip', 'bundle'].map((k) => [k, only.includes(k)])) : {};
      const started = performance.now();
      const engine = values['pdf-engine'];
      if (engine && engine !== 'chrome' && engine !== 'pagedjs') throw new Error('--pdf-engine vale chrome o pagedjs');
      const filesUrl = values['files-url'];
      if (filesUrl && !/^https?:\/\//.test(filesUrl)) throw new Error('--files-url deve essere un indirizzo http o https');
      const r = await build(root, {
        ...sel,
        pdfEngine: engine as 'chrome' | 'pagedjs' | undefined,
        filesUrl: filesUrl && !filesUrl.endsWith('/') ? `${filesUrl}/` : filesUrl,
        log: (m) => console.log(`  ${m}`) });
      console.log(`\nTempi (ms): ${Object.entries(r.timings).map(([k, v]) => `${k} ${v}`).join(' · ')} · totale ${Math.round(performance.now() - started)}`);
      if (r.problems.length) console.log(`\n${formatProblems(r.problems)}`);
      process.exitCode = r.problems.some((p) => p.level === 'errore') ? 1 : 0;
      break;
    }
    case 'dev': {
      const { dev } = await import('../src/dev.ts');
      await dev(root, { port: Number(values.port ?? 4321) });
      break;
    }
    case 'studio': {
      const { studio } = await import('../src/studio.ts');
      await studio(root, { port: Number(values.port ?? 4322) });
      break;
    }
    case 'convert': {
      const { convert } = await import('../src/convert.ts');
      if (!values.out) throw new Error('indica la cartella di uscita con --out');
      const r = await convert(root, values.out, { log: (m) => console.log(`  ${m}`) });
      const count = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} (${v})`).join(', ') || 'nessuno';
      console.log(`\nPagine: ${r.pages} · file copiati: ${r.assets.length - r.missingAssets.length}`);
      console.log(`Nodi non convertiti: ${count(r.unsupported)}`);
      console.log(`Contenuto scartato: ${count(r.dropped)}`);
      if (r.missingAssets.length) console.log(`File citati ma assenti: ${r.missingAssets.join(', ')}`);
      if (r.sphinxWarnings.length) console.log(`Avvisi di Sphinx: ${r.sphinxWarnings.length} (in conversione.json)`);
      console.log(`\nRapporto: ${values.out}/conversione.json. Prossimo passo: docs-italia check --dir ${values.out}`);
      break;
    }
    case 'init': {
      const { init } = await import('../src/init.ts');
      init(root);
      break;
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      break;
    default:
      console.error(`Comando sconosciuto: ${cmd}\n\n${HELP}`);
      process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
