/**
 * `docs-italia init`: scheletro di un nuovo documento MyST. Non sovrascrive
 * file esistenti.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const FILES: Record<string, (name: string) => string> = {
  'document_settings.yml': (name) => `document:
  name: "${name}"
  description: "Descrizione breve del documento."
  tags:
    - linee guida
  format: myst
  source: .
  languages: [it]
  downloads: [pdf, epub, html]
`,
  'toc.json': () => `${JSON.stringify(
    {
      $schema: 'https://docs.italia.it/schema/toc/1.json',
      root: 'index.md',
      caption: 'Indice dei contenuti',
      numbered: true,
      chapters: [{ file: 'introduzione.md' }],
    },
    null,
    2,
  )}\n`,
  'index.md': (name) => `# ${name}

Presentazione del documento: a chi è rivolto e che cosa contiene.
`,
  'introduzione.md': () => `# Introduzione

Primo capitolo. Ogni file elencato in \`toc.json\` è un capitolo.

:::{note}
Gli avvisi si scrivono con la sintassi delle direttive MyST.
:::
`,
  '.gitignore': () => 'node_modules/\ndist/\n.docs-italia/\n',
  'package.json': (name) => `${JSON.stringify(
    {
      name: basename(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
      private: true,
      type: 'module',
      scripts: {
        check: 'docs-italia check',
        build: 'docs-italia build',
        dev: 'docs-italia dev',
        studio: 'docs-italia studio',
      },
      devDependencies: { '@docs-italia/toolkit': '*' },
    },
    null,
    2,
  )}\n`,
};

export function init(dir: string): void {
  mkdirSync(join(dir, 'images'), { recursive: true });
  const name = basename(dir).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  for (const [file, make] of Object.entries(FILES)) {
    const path = join(dir, file);
    if (existsSync(path)) {
      console.log(`  esiste già, lasciato com'è: ${file}`);
      continue;
    }
    writeFileSync(path, make(name));
    console.log(`  creato: ${file}`);
  }
  console.log(`\nProssimi passi: modifica document_settings.yml, poi "docs-italia dev" per l'anteprima.`);
}
