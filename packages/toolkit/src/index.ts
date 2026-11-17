/**
 * @docs-italia/toolkit — build, anteprima e studio dei documenti.
 * La CLI è in bin/docs-italia.ts.
 */
export { build, documentSlug, toDocView, versionName, TOOLKIT_VERSION, type BuildOptions, type BuildResult } from './build.ts';
export { buildCss } from './css.ts';
export { dev } from './dev.ts';
export { studio } from './studio.ts';
export { init } from './init.ts';
export { convert, findRstSource, type ConvertReport } from './convert.ts';
