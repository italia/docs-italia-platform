/**
 * Dall'AST MyST grezzo all'AST risolto di Docs Italia.
 *
 * Primo passaggio, pagina per pagina: direttive e ruoli sostituiti dai loro
 * nodi, titoli con ancora e numero, etichette, figure, note a piè di pagina.
 * Secondo passaggio, sull'intero documento: link tra pagine, ancore,
 * riferimenti incrociati, immagini.
 *
 * Ogni nodo conserva `position` (righe e colonne di origine): serve all'editor.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';

/**
 * Un file del documento (immagine, allegato) esiste ed è dentro il progetto.
 * Il documento non è fidato: "../" o un link simbolico non devono portare nel
 * pacchetto pubblicato file che stanno fuori dal repository.
 */
export function projectFile(sourceDir: string, target: string): boolean {
  if (target.startsWith('..') || target.startsWith('/')) return false;
  const file = join(sourceDir, target);
  if (!existsSync(file)) return false;
  const root = realpathSync(sourceDir);
  const real = realpathSync(file);
  return real.startsWith(root + sep) && statSync(real).isFile();
}
import type { GenericNode, InventoryEntry, PageInfo, PageView, Problem, SectionView } from '@docs-italia/schema';
import { parseMyst } from './myst.ts';
import type { Project } from './project.ts';

export interface ResolvedPage extends PageInfo, PageView {
  source: string;
  /** ancore presenti nella pagina */
  anchors: Set<string>;
}

export interface ResolvedDoc {
  project: Project;
  pages: ResolvedPage[];
  inventory: Record<string, InventoryEntry>;
  assets: Set<string>;
  problems: Problem[];
}

export type SourceReader = (file: string) => string;

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toPlain(node: GenericNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'image') return node.alt ?? '';
  return (node.children ?? []).map(toPlain).join('');
}

const lineOf = (n: GenericNode) => n.position?.start?.line as number | undefined;
const SAFE_SCHEME = /^(https?|mailto|tel):/i;
/** Come normalizeIdentifier di myst-common: i riferimenti arrivano già in questa forma. */
export const labelKey = (s: string) => s.replace(/[\t\n\r ]+/g, ' ').trim().toLowerCase();
/** Ancora di un'etichetta: un id non può contenere spazi ("nome con spazi" → "nome-con-spazi"). */
const anchorOf = (label: string) => label.replace(/\s+/g, '-');

/**
 * Sostituisce mystDirective e mystRole con i nodi che producono. Il primo nodo
 * prodotto conserva in `origin` la forma originale (nome, argomenti, opzioni,
 * valore): serve al serializzatore per riscrivere ruoli e opzioni che non
 * conosce senza perderli.
 */
export function liftDirectives(nodes: GenericNode[], file = '', problems: Problem[] = []): GenericNode[] {
  return lift(nodes, file, problems);
}

function lift(nodes: GenericNode[], file: string, problems: Problem[]): GenericNode[] {
  const out: GenericNode[] = [];
  for (const n of nodes) {
    if (n.type === 'mystDirective' || n.type === 'mystRole') {
      if (n.children?.length) {
        const kids = lift(n.children, file, problems);
        if (kids[0] && !kids[0].position) kids[0].position = n.position;
        if (kids[0]) {
          kids[0].directive = n.name;
          kids[0].origin = { kind: n.type === 'mystDirective' ? 'directive' : 'role', name: n.name, args: n.args, options: n.options, value: n.value };
        }
        out.push(...kids);
      } else {
        problems.push({ level: 'errore', file, line: lineOf(n), code: 'unsupported', message: `${n.type === 'mystDirective' ? 'direttiva' : 'ruolo'} "${n.name}" non supportato` });
        out.push({
          type: 'unsupported',
          name: n.name,
          value: n.value,
          position: n.position,
          origin: { kind: n.type === 'mystDirective' ? 'directive' : 'role', name: n.name, args: n.args, options: n.options, value: n.value },
        });
      }
      continue;
    }
    if (n.type === 'mystComment') continue;
    if (n.type === 'html') {
      problems.push({ level: 'avviso', file, line: lineOf(n), code: 'raw-html', message: 'HTML grezzo nel Markdown: non viene pubblicato' });
    }
    if (n.children) n.children = lift(n.children, file, problems);
    out.push(n);
  }
  return out;
}

function walk(node: GenericNode, fn: (n: GenericNode, parent?: GenericNode) => void, parent?: GenericNode) {
  fn(node, parent);
  node.children?.forEach((c) => walk(c, fn, node));
}

function firstPass(project: Project, info: PageInfo, read: SourceReader, problems: Problem[], inventory: Record<string, InventoryEntry>): ResolvedPage {
  const file = info.file;
  let source = '';
  try {
    source = read(file);
  } catch {
    problems.push({ level: 'errore', file, code: 'missing', message: 'file non leggibile' });
  }
  const parsed = parseMyst(source, file);
  problems.push(...parsed.problems);
  const tree = parsed.tree as GenericNode;
  tree.children = lift(tree.children ?? [], file, problems);

  const anchors = new Set<string>();
  const unique = (base: string) => {
    let id = base || 'sezione';
    for (let i = 2; anchors.has(id); i++) id = `${base}-${i}`;
    anchors.add(id);
    return id;
  };

  // etichette (label)= : si applicano al nodo successivo
  const pendingLabels = new Map<GenericNode, string[]>();
  walk(tree, (n) => {
    const kids = n.children ?? [];
    kids.forEach((c, i) => {
      if (c.type !== 'mystTarget') return;
      const next = kids.slice(i + 1).find((k) => k.type !== 'mystTarget');
      if (next) pendingLabels.set(next, [...(pendingLabels.get(next) ?? []), c.label]);
      else problems.push({ level: 'avviso', file, line: lineOf(c), code: 'label', message: `etichetta "${c.label}" senza contenuto dopo` });
    });
  });

  const register = (label: string, entry: InventoryEntry, n: GenericNode) => {
    const key = labelKey(label);
    if (inventory[key]) {
      problems.push({ level: 'errore', file, line: lineOf(n), code: 'label-duplicate', message: `etichetta "${label}" già definita in ${inventory[key].page}` });
      return;
    }
    inventory[key] = entry;
  };

  // titoli: ancora e numero
  const counters = [0, 0, 0, 0, 0, 0];
  const sections: SectionView[] = [];
  let title = info.title;
  let h1count = 0;
  let lastDepth = 0;
  walk(tree, (n) => {
    if (n.type !== 'heading') return;
    const text = toPlain(n).trim();
    const depth: number = n.depth ?? 1;
    if (lastDepth && depth > lastDepth + 1) {
      problems.push({ level: 'avviso', file, line: lineOf(n), code: 'heading-skip', message: `titolo di livello ${depth} dopo uno di livello ${lastDepth}: salta un livello (accessibilità)` });
    }
    lastDepth = depth;
    if (depth === 1) {
      h1count++;
      if (!info.title) title = text;
      n.anchor = unique(slugify(text));
      if (info.number) n.number = info.number;
      if (h1count > 1) problems.push({ level: 'avviso', file, line: lineOf(n), code: 'h1', message: 'più di un titolo di primo livello nella stessa pagina' });
    } else {
      counters[depth - 1]++;
      for (let d = depth; d < counters.length; d++) counters[d] = 0;
      n.anchor = unique(slugify(text));
      if (info.number) n.number = [info.number, ...counters.slice(1, depth)].join('.');
    }
    sections.push({ anchor: n.anchor, title: text, number: n.number, depth });
    for (const label of new Set((pendingLabels.get(n) ?? []).map(labelKey))) register(label, { page: info.slug, anchor: n.anchor, title: text, number: n.number, kind: 'section' }, n);
  });
  if (!h1count) problems.push({ level: 'errore', file, code: 'no-title', message: 'la pagina deve iniziare con un titolo di primo livello (# Titolo)' });
  if (!title) title = info.slug;

  // elenchi compatti o distanziati: myst-parser imposta sempre spread in modo
  // fisso, quindi si ricava dal sorgente (riga vuota prima di una voce)
  const lines = source.split('\n');
  walk(tree, (n) => {
    if (n.type !== 'list' || !n.children?.length) return;
    const loose = n.children.slice(1).some((li) => {
      const start = li.position?.start?.line;
      return start && start >= 2 && lines[start - 2]?.trim() === '';
    });
    n.spread = loose;
    for (const li of n.children) li.spread = loose;
  });

  // figure e tabelle: didascalie, numerazione per capitolo ("2.1"), etichette
  const figCount = { figure: 0, table: 0 };
  walk(tree, (n) => {
    if (n.type === 'container') {
      if (n.kind === 'figure') {
        const kids = n.children ?? [];
        const imgIdx = kids.findIndex((k) => k.type === 'image');
        const after = kids.slice(imgIdx + 1);
        if (after.length && !after.some((k) => k.type === 'caption')) {
          const [cap, ...legend] = after;
          n.children = [...kids.slice(0, imgIdx + 1), { type: 'caption', children: [cap] }, ...(legend.length ? [{ type: 'legend', children: legend }] : [])];
        }
      }
      const cap = n.children?.find((k) => k.type === 'caption');
      if (cap && (n.kind === 'figure' || n.kind === 'table')) {
        const k = ++figCount[n.kind as 'figure' | 'table'];
        n.number = info.number ? `${info.number}.${k}` : String(k);
        n.showNumber = project.toc.numfig;
      }
      // la stessa etichetta può arrivare sia da :name: sia da un'etichetta (label)= prima del blocco
      const labels = [...new Set([...(n.label ? [n.label] : []), ...(pendingLabels.get(n) ?? [])].map(labelKey))];
      if (labels.length) n.anchor = unique(anchorOf(labels[0]!));
      for (const label of labels) register(label, { page: info.slug, anchor: n.anchor, title: toPlain(cap).trim() || label, number: n.number, kind: n.kind === 'table' ? 'table' : 'figure' }, n);
    } else if (n.type !== 'heading' && pendingLabels.has(n)) {
      const labels = [...new Set(pendingLabels.get(n)!.map(labelKey))];
      n.anchor = unique(anchorOf(labels[0]!));
      for (const label of labels) register(label, { page: info.slug, anchor: n.anchor, title: toPlain(n).trim().slice(0, 80) || label, kind: 'target' }, n);
    }
  });

  // glossario: ogni termine è un'etichetta "term-<termine>", come in Sphinx, che {term} raggiunge
  walk(tree, (g) => {
    if (g.type !== 'glossary') return;
    walk(g, (n) => {
      if (n.type !== 'definitionTerm') return;
      const term = toPlain(n).trim();
      if (!term) return;
      n.anchor = unique(`term-${slugify(term)}`);
      register(`term-${term}`, { page: info.slug, anchor: n.anchor, title: term, kind: 'target' }, n);
    });
  });

  // note a piè di pagina: definizioni tolte dal flusso, numerate per ordine di citazione
  const footnotes: GenericNode[] = [];
  const strip = (n: GenericNode) => {
    if (!n.children) return;
    n.children = n.children.filter((c) => {
      if (c.type === 'footnoteDefinition') {
        footnotes.push(c);
        return false;
      }
      strip(c);
      return true;
    });
  };
  strip(tree);
  const order = new Map<string, number>();
  const cited = new Map<string, number>();
  walk(tree, (n) => {
    if (n.type !== 'footnoteReference') return;
    if (!order.has(n.identifier)) order.set(n.identifier, order.size + 1);
    n.enumerator = order.get(n.identifier);
    // quante volte la nota è già stata citata: serve a dare un id diverso a ogni citazione
    cited.set(n.identifier, (cited.get(n.identifier) ?? 0) + 1);
    n.refIndex = cited.get(n.identifier);
    if (!footnotes.some((f) => f.identifier === n.identifier)) problems.push({ level: 'errore', file, line: lineOf(n), code: 'footnote', message: `nota "${n.label}" senza definizione` });
  });
  for (const f of footnotes) {
    f.enumerator = order.get(f.identifier);
    if (!f.enumerator) problems.push({ level: 'avviso', file, line: lineOf(f), code: 'footnote-unused', message: `nota "${f.label}" mai citata nel testo` });
  }

  // le pagine stanno in uno spazio di nomi separato: una pagina "approfondimento" non è un'etichetta
  inventory[`doc:${info.slug}`] = { page: info.slug, anchor: '', title, number: info.number, kind: 'page' };
  return { ...info, title, tree, sections, footnotes: footnotes.filter((f) => f.enumerator), source, anchors };
}

function secondPass(page: ResolvedPage, doc: ResolvedDoc) {
  const { problems, inventory, project } = doc;
  const file = page.file;
  const byFile = new Map(doc.pages.map((p) => [p.file, p]));
  const here = dirname(file);

  const resolveAnchor = (target: ResolvedPage, anchor: string): string | undefined => {
    if (target.anchors.has(anchor)) return anchor;
    const inv = inventory[labelKey(anchor)];
    if (inv && inv.page === target.slug) return inv.anchor;
    return undefined;
  };

  walk(page.tree, (n) => {
    if (n.type === 'link') {
      const url: string = n.url ?? '';
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        if (!SAFE_SCHEME.test(url)) {
          problems.push({ level: 'errore', file, line: lineOf(n), code: 'unsafe-link', message: `link con schema non ammesso: "${url.slice(0, 40)}" (ammessi http, https, mailto, tel)` });
          n.url = undefined;
        }
        return;
      }
      if (url.startsWith('#')) {
        const id = decodeURIComponent(url.slice(1));
        const local = resolveAnchor(page, id);
        const inv = inventory[labelKey(id)];
        if (local) n.internal = { page: page.slug, anchor: local };
        else if (inv) n.internal = { page: inv.page, anchor: inv.anchor || undefined };
        else problems.push({ level: 'errore', file, line: lineOf(n), code: 'broken-link', message: `ancora o etichetta "${id}" inesistente` });
        return;
      }
      const [path, hash] = url.split('#');
      const target = normalize(join(here, decodeURIComponent(path))).split('\\').join('/');
      if (path.endsWith('.md')) {
        const tp = byFile.get(target);
        if (!tp) {
          problems.push({ level: 'errore', file, line: lineOf(n), code: 'broken-link', message: `link a "${path}": la pagina non esiste o non è nell'indice` });
          return;
        }
        let anchor: string | undefined;
        if (hash) {
          anchor = resolveAnchor(tp, decodeURIComponent(hash));
          if (!anchor) problems.push({ level: 'errore', file, line: lineOf(n), code: 'broken-anchor', message: `link a "${url}": l'ancora "${hash}" non esiste in ${tp.file}` });
        }
        n.internal = { page: tp.slug, anchor };
        return;
      }
      if (projectFile(project.sourceDir, target)) {
        n.asset = target;
        doc.assets.add(target);
      } else {
        problems.push({ level: 'errore', file, line: lineOf(n), code: 'broken-link', message: `link a "${url}": file inesistente o fuori dal progetto` });
      }
      return;
    }
    if (n.type === 'crossReference') {
      const inv = inventory[labelKey(n.identifier ?? n.label ?? '')];
      if (!inv) {
        problems.push({ level: 'errore', file, line: lineOf(n), code: 'broken-ref', message: `riferimento a "${n.identifier}": etichetta inesistente` });
        return;
      }
      const label = inv.kind === 'figure' ? 'Figura' : inv.kind === 'table' ? 'Tabella' : 'Sezione';
      if (n.kind === 'numref' && (inv.kind === 'figure' || inv.kind === 'table') && !project.toc.numfig) {
        problems.push({ level: 'avviso', file, line: lineOf(n), code: 'numref-numfig', message: `{numref} su "${n.identifier}", ma il numero non compare nelle didascalie: attiva "numfig" in toc.json` });
      }
      const text = n.kind === 'numref' && inv.number ? `${label} ${inv.number}` : `${inv.number ? inv.number + ' ' : ''}${inv.title}`;
      n.resolved = { page: inv.page, anchor: inv.anchor || undefined, text };
      return;
    }
    if (n.type === 'image') {
      const url: string = n.url ?? '';
      if (/^https?:/i.test(url)) {
        problems.push({ level: 'avviso', file, line: lineOf(n), code: 'external-image', message: `immagine esterna "${url}": non sarà nel PDF/EPUB se il sito non è raggiungibile` });
      } else {
        const target = normalize(join(here, decodeURIComponent(url))).split('\\').join('/');
        if (projectFile(project.sourceDir, target)) {
          n.asset = target;
          doc.assets.add(target);
        } else {
          problems.push({ level: 'errore', file, line: lineOf(n), code: 'missing-image', message: `immagine "${url}" inesistente o fuori dal progetto` });
        }
      }
      if (!n.alt?.trim()) problems.push({ level: 'avviso', file, line: lineOf(n), code: 'alt', message: 'immagine senza testo alternativo (accessibilità)' });
    }
  });
}

export function resolveProject(project: Project, read: SourceReader): ResolvedDoc {
  const problems: Problem[] = [...project.problems];
  const inventory: Record<string, InventoryEntry> = {};
  const pages = project.pages.map((p) => firstPass(project, p, read, problems, inventory));
  const doc: ResolvedDoc = { project, pages, inventory, assets: new Set(), problems };
  for (const p of pages) secondPass(p, doc);
  return doc;
}

/** Lettore che legge dal disco. */
export function diskReader(project: Project): SourceReader {
  return (file) => readFileSync(join(project.sourceDir, file), 'utf8');
}
