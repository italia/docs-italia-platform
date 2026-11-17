/**
 * Genera src/italia.css: Italia Tailwind UI con il solo tema predefinito
 * (italia-original), invece dei 39 temi caricati da "@italia-tailwind/css".
 *
 * Il tema non viene copiato a mano: si estrae dal themes.css della versione
 * installata, così un aggiornamento della libreria si propaga rilanciando lo
 * script. Il test test/italia-css.test.ts segnala quando il file è da rigenerare.
 *
 * Uso: bun run italia-css (nella cartella packages/render)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const THEME = 'italia-original';

export function generate(): string {
  // Bun installa i pacchetti in modo isolato: si usa il collegamento nel
  // node_modules del pacchetto render, che non cambia tra le versioni (il
  // percorso reale, in node_modules/.bun, contiene un hash).
  const local = fileURLToPath(new URL('../node_modules/@italia-tailwind/css', import.meta.url));
  const pkgDir = existsSync(local) ? local : dirname(createRequire(import.meta.url).resolve('@italia-tailwind/css/package.json'));
  const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  const srcDir = join(pkgDir, 'src');
  const here = fileURLToPath(new URL('../src/', import.meta.url));
  // components.css non è tra gli "exports" del pacchetto: si importa per percorso
  const rel = (f: string) => relative(here, join(srcDir, f)).split('\\').join('/');

  const themes = readFileSync(join(srcDir, 'themes.css'), 'utf8');
  const block = themes.match(new RegExp(`@plugin "daisyui/theme" \\{\\s*name: "${THEME}";[\\s\\S]*?\\n\\}`))?.[0];
  if (!block) throw new Error(`tema "${THEME}" non trovato in @italia-tailwind/css ${version}`);

  return `/*
 * GENERATO da packages/render/scripts/italia-css.ts: non modificare a mano.
 * Italia Tailwind UI (@italia-tailwind/css ${version}) con il solo tema "${THEME}".
 * Sostituisce @import "@italia-tailwind/css", che carica tutti i temi daisyUI.
 */
@plugin "daisyui" {
  themes: false;
  logs: false;
}

@import "${rel('fonts.css')}";

${block}

@import "${rel('base.css')}";
@import "${rel('extensions.css')}";
@import "${rel('components.css')}";
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../src/italia.css', import.meta.url));
  writeFileSync(out, generate());
  console.log(`scritto ${out}`);
}
