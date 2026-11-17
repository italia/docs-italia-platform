/**
 * Controlli sulla struttura del monorepo: ogni workspace ha nome, descrizione,
 * README e punto di ingresso, e le dipendenze interne puntano a workspace esistenti.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const workspaces: string[] = rootPkg.workspaces;
const pkgs = workspaces.map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) }));
const names = new Set(pkgs.map((p) => p.pkg.name));

describe('workspace', () => {
  for (const { dir, pkg } of pkgs) {
    test(dir, () => {
      expect(pkg.name).toStartWith('@docs-italia/');
      expect(pkg.description?.length).toBeGreaterThan(0);
      expect(pkg.private).toBe(true);
      expect(existsSync(join(root, dir, 'README.md'))).toBe(true);
      // librerie e server: src/index.ts; app per il browser (editor, dashboard): src/main.tsx; sito Astro: astro.config.mjs
      const entries = [join('src', 'index.ts'), join('src', 'main.tsx'), 'astro.config.mjs'];
      expect(entries.some((e) => existsSync(join(root, dir, e)))).toBe(true);
      for (const dep of Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@docs-italia/'))) {
        expect(names.has(dep)).toBe(true);
      }
    });
  }
});

test('i pacchetti interni non hanno dipendenze circolari', () => {
  const deps = new Map(pkgs.map(({ pkg }) => [pkg.name as string, Object.keys(pkg.dependencies ?? {}).filter((d) => names.has(d))]));
  const visit = (name: string, path: string[]): void => {
    expect(path).not.toContain(name);
    for (const d of deps.get(name) ?? []) visit(d, [...path, name]);
  };
  for (const name of deps.keys()) visit(name, []);
});

test('ogni pacchetto (non browser) si importa', async () => {
  for (const { dir } of pkgs) {
    const entry = join(root, dir, 'src', 'index.ts');
    if (existsSync(entry)) await import(entry);
  }
});
