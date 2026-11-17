/**
 * `docs-italia check`: metadati, indice, link, immagini, riferimenti, accessibilità.
 */
import type { Problem } from '@docs-italia/schema';
import { loadProject, ProjectError } from './project.ts';
import { diskReader, resolveProject, type SourceReader } from './resolve.ts';

export function check(root: string, read?: SourceReader): Problem[] {
  try {
    const project = loadProject(root);
    return resolveProject(project, read ?? diskReader(project)).problems;
  } catch (e) {
    if (e instanceof ProjectError) return e.problems;
    throw e;
  }
}

export function formatProblems(problems: Problem[]): string {
  if (!problems.length) return 'Nessun problema.';
  const sorted = [...problems].sort((a, b) => (a.level === b.level ? a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) : a.level === 'errore' ? -1 : 1));
  const errors = problems.filter((p) => p.level === 'errore').length;
  return [
    ...sorted.map((p) => `${p.level === 'errore' ? '✖' : '⚠'} ${p.file}${p.line ? `:${p.line}` : ''}  ${p.message}  [${p.code}]`),
    '',
    `${errors} errori, ${problems.length - errors} avvisi.`,
  ].join('\n');
}
