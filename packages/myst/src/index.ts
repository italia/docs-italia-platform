/**
 * @docs-italia/myst — lettura MyST con le estensioni di Docs Italia,
 * caricamento del documento, risoluzione dell'AST e controlli.
 */
export { parseMyst, docsItaliaDirectives, docsItaliaRoles, type ParseResult } from './myst.ts';
export { loadProject, slugOf, ProjectError, type Project } from './project.ts';
export { resolveProject, diskReader, liftDirectives, slugify, toPlain, type ResolvedDoc, type ResolvedPage, type SourceReader } from './resolve.ts';
export { check, formatProblems } from './check.ts';
export { serializeBlock, serializeBlocks, serializeInline, escapeText, sourceBlocks, replaceBlocks, applyEdits, type SourceBlock, type BlockEdit, type BlockContent } from './serialize.ts';
