/**
 * Schemi di Docs Italia: document_settings.yml, toc.json e pacchetto di build.
 *
 * Le regole su document_settings.yml riproducono quelle del fork attuale
 * (readthedocs/docsitalia/metadata.py): name, description e tags obbligatori.
 * I campi nuovi sono tutti facoltativi, così un file attuale resta valido.
 */
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

export const BUNDLE_SCHEMA_VERSION = 'docs-italia/bundle@0';

// ---------------------------------------------------------------------------
// document_settings.yml
// ---------------------------------------------------------------------------

export const DocumentSettingsSchema = z.object({
  document: z
    .object({
      name: z.string({ error: 'il campo "name" è obbligatorio' }).trim().min(1, 'il campo "name" è obbligatorio'),
      description: z.string({ error: 'il campo "description" è obbligatorio' }).trim().min(1, 'il campo "description" è obbligatorio'),
      tags: z.array(z.string().trim().min(1), { error: 'il campo "tags" è obbligatorio ed è un elenco' }).min(1, 'serve almeno un tag in "tags"'),
      short_name: z.string().optional(),
      language: z.string().optional(),
      // estensioni del nuovo formato
      format: z.enum(['rst', 'myst']).default('rst'),
      source: z.string().default('.'),
      languages: z.array(z.string()).default(['it']),
      versions: z
        .object({
          draft: z.string().optional(),
          releases: z.enum(['tags', 'github-releases', 'none']).default('tags'),
          default: z.string().default('latest-release'),
        })
        .partial({ releases: true, default: true })
        .optional(),
      downloads: z.array(z.enum(['pdf', 'epub', 'html'])).default(['pdf', 'epub', 'html']),
      publisher: z.string().optional(),
      project: z.string().optional(),
      repository: z.string().url().optional(),
    })
    // campi presenti nei repository ma ignorati dal fork (type, origin, author…)
    .passthrough(),
});

export type DocumentSettings = z.infer<typeof DocumentSettingsSchema>;

// ---------------------------------------------------------------------------
// italia-conf: publisher_settings.yml e projects_settings.yml
// (regole di readthedocs/docsitalia/metadata.py)
// ---------------------------------------------------------------------------

/** slugify di Django: lo slug dei progetti nella piattaforma attuale, e quindi negli URL. */
export function djangoSlugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '-');
}

export const PublisherSettingsSchema = z.object({
  publisher: z
    .object({
      name: z.string({ error: 'il campo "name" è obbligatorio' }).trim().min(1, 'il campo "name" è obbligatorio'),
      description: z.string({ error: 'il campo "description" è obbligatorio' }).trim().min(1, 'il campo "description" è obbligatorio'),
      short_name: z.string().optional(),
      logo: z.string().optional(),
      website: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .passthrough(),
});
export type PublisherSettings = z.infer<typeof PublisherSettingsSchema>;

export const ProjectsSettingsSchema = z.object({
  projects: z.array(
    z
      .object({
        name: z.string({ error: 'il campo "name" è obbligatorio' }).trim().min(1, 'il campo "name" è obbligatorio'),
        description: z.string({ error: 'il campo "description" è obbligatorio' }).trim().min(1, 'il campo "description" è obbligatorio'),
        // i nomi dei repository; YAML trasforma in null le voci vuote
        documents: z.array(z.string().nullable(), { error: 'il campo "documents" è obbligatorio' }).min(1, 'serve almeno un documento'),
        short_name: z.string().optional(),
        website: z.string().nullable().optional(),
        logo: z.string().nullable().optional(),
        tags: z.array(z.string()).nullable().optional(),
        start_date: z.unknown().optional(),
        end_date: z.unknown().optional(),
      })
      .passthrough()
      .transform((p) => ({ ...p, documents: p.documents.filter((d): d is string => Boolean(d)), slug: djangoSlugify(p.short_name || p.name) })),
  ),
});
export type ProjectsSettings = z.infer<typeof ProjectsSettingsSchema>;

function parseYamlWith<T>(schema: z.ZodType<T>, text: string, file: string): Parsed<T> {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (e) {
    return { ok: false, problems: [{ level: 'errore', file, code: 'yaml', message: `YAML non valido: ${(e as Error).message}` }] };
  }
  const r = schema.safeParse(data);
  return r.success ? { ok: true, value: r.data, problems: [] } : { ok: false, problems: zodProblems(file, r.error) };
}

export const parsePublisherSettings = (text: string, file = 'publisher_settings.yml') => parseYamlWith(PublisherSettingsSchema, text, file);
export const parseProjectsSettings = (text: string, file = 'projects_settings.yml') => parseYamlWith(ProjectsSettingsSchema, text, file);

// ---------------------------------------------------------------------------
// toc.json
// ---------------------------------------------------------------------------

export interface TocEntry {
  file?: string;
  title?: string;
  children?: TocEntry[];
  /** false: voce (e figli) senza numero anche se l'indice è numerato, es. gli allegati */
  numbered?: boolean;
}

export const TocEntrySchema: z.ZodType<TocEntry> = z.lazy(() =>
  z
    .object({
      file: z.string().regex(/\.md$/, 'le voci "file" devono puntare a un file .md').optional(),
      title: z.string().min(1).optional(),
      children: z.array(TocEntrySchema).optional(),
      numbered: z.boolean().optional(),
    })
    .strict()
    .refine((e) => e.file || (e.title && e.children?.length), {
      message: 'una voce senza "file" deve avere "title" e "children"',
    }),
);

export const TocSchema = z
  .object({
    $schema: z.string().optional(),
    root: z.string().regex(/\.md$/, '"root" deve puntare a un file .md').default('index.md'),
    caption: z.string().optional(),
    numbered: z.boolean().default(true),
    /** numero visibile nelle didascalie di figure e tabelle ("Figura 2.1"), come numfig di Sphinx */
    numfig: z.boolean().default(false),
    chapters: z.array(TocEntrySchema),
    /**
     * Pagine pubblicate ma fuori dall'indice: niente navigazione, numerazione,
     * pagina singola e PDF. Sono le pagine orfane di Sphinx (`:orphan:`), che i
     * documenti linkano (es. istruzioni_consultazione.html).
     */
    hidden: z.array(z.string().regex(/\.md$/, 'le voci di "hidden" devono essere file .md')).optional(),
  })
  .strict();

export type Toc = z.infer<typeof TocSchema>;

// ---------------------------------------------------------------------------
// Validazione con messaggi in italiano
// ---------------------------------------------------------------------------

export interface Problem {
  level: 'errore' | 'avviso';
  file: string;
  line?: number;
  message: string;
  code: string;
}

export type Parsed<T> = { ok: true; value: T; problems: Problem[] } | { ok: false; problems: Problem[] };

function zodProblems(file: string, error: z.ZodError): Problem[] {
  return error.issues.map((i) => ({
    level: 'errore' as const,
    file,
    code: 'schema',
    message: `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`,
  }));
}

export function parseDocumentSettings(text: string, file = 'document_settings.yml'): Parsed<DocumentSettings> {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (e) {
    return { ok: false, problems: [{ level: 'errore', file, code: 'yaml', message: `YAML non valido: ${(e as Error).message}` }] };
  }
  const r = DocumentSettingsSchema.safeParse(data);
  return r.success ? { ok: true, value: r.data, problems: [] } : { ok: false, problems: zodProblems(file, r.error) };
}

export function parseToc(text: string, file = 'toc.json'): Parsed<Toc> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, problems: [{ level: 'errore', file, code: 'json', message: `JSON non valido: ${(e as Error).message}` }] };
  }
  const r = TocSchema.safeParse(data);
  return r.success ? { ok: true, value: r.data, problems: [] } : { ok: false, problems: zodProblems(file, r.error) };
}

/** Filtro dei tag sul vocabolario ammesso, come _remove_invalid_tags del fork. */
export function filterTags(tags: string[], allowed?: Iterable<string>): { kept: string[]; dropped: string[] } {
  const norm = tags.map((t) => t.trim().toLowerCase());
  if (!allowed) return { kept: [...new Set(norm)], dropped: [] };
  const ok = new Set([...allowed].map((t) => t.trim().toLowerCase()));
  return { kept: [...new Set(norm.filter((t) => ok.has(t)))], dropped: norm.filter((t) => !ok.has(t)) };
}

// ---------------------------------------------------------------------------
// AST (MyST, con le estensioni di Docs Italia)
// ---------------------------------------------------------------------------

/** Nodo dell'AST: mdast/MyST più i campi aggiunti dalla risoluzione (anchor, number, internal…). */
export interface GenericNode {
  type: string;
  children?: GenericNode[];
  value?: string;
  [key: string]: any;
}

export interface SectionView {
  anchor: string;
  title: string;
  number?: string;
  depth: number;
}

export interface PageView {
  slug: string;
  title: string;
  number?: string;
  depth: number;
  /** pagina fuori dall'indice (toc.json, "hidden") */
  hidden?: boolean;
  tree: GenericNode;
  sections: SectionView[];
  footnotes: GenericNode[];
}

// ---------------------------------------------------------------------------
// Pacchetto di build (bundle)
// ---------------------------------------------------------------------------

export interface PageInfo {
  /** percorso del file sorgente, relativo alla radice della sorgente */
  file: string;
  /** slug della pagina: nome del file senza .md */
  slug: string;
  title: string;
  /** numero di capitolo ("3", "2.1"); assente per la pagina radice o se la toc non è numerata */
  number?: string;
  depth: number;
  parent?: string;
  /** pagina fuori dall'indice (toc.json, "hidden"): pubblicata, ma non in navigazione, pagina singola e PDF */
  hidden?: boolean;
}

export interface InventoryEntry {
  page: string;
  anchor: string;
  title: string;
  number?: string;
  kind: 'page' | 'section' | 'figure' | 'table' | 'target';
}

export interface SearchRecord {
  id: string;
  page: string;
  anchor: string;
  title: string;
  number?: string;
  path: string[];
  text: string;
}

export interface Chunk {
  id: string;
  /** sha256 del testo: serve a calcolare gli embedding una volta sola per contenuto */
  hash: string;
  page: string;
  anchor: string;
  path: string[];
  /** contesto in testa al frammento + testo; è ciò che va vettorizzato */
  text: string;
  tokens: number;
  url: string;
}

export interface Manifest {
  schema: typeof BUNDLE_SCHEMA_VERSION;
  document: { slug: string; name: string; description: string; tags: string[]; publisher?: string; project?: string; repository?: string };
  version: { name: string; ref?: string; commit?: string; dirty?: boolean };
  language: string;
  format: 'myst' | 'rst';
  toolkit: string;
  generatedAt: string;
  pages: PageInfo[];
  downloads: Record<string, string>;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export const schemas = {
  'document-settings': () => z.toJSONSchema(DocumentSettingsSchema, { io: 'input' }),
  toc: () => z.toJSONSchema(TocSchema, { io: 'input' }),
};
