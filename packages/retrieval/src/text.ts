/**
 * Testo semplice dall'AST: record per la ricerca del sito (search.jsonl) e
 * frammenti per l'indicizzazione vettoriale (chunks.jsonl), sezione 7.2 del piano.
 */
import { createHash } from 'node:crypto';
import type { Chunk, GenericNode, SearchRecord } from '@docs-italia/schema';
import { toPlain, type ResolvedDoc, type ResolvedPage } from '@docs-italia/myst';

const MAX_TOKENS = 800;
const TARGET_TOKENS = 500;

/**
 * Normalizzazione prima di ricerca ed embedding: il parser MyST converte
 * apostrofi e virgolette in tipografici, mentre chi cerca scrive quasi sempre
 * quelli dritti.
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/\u00A0/g, ' ');
}

/** Stima grezza: ~4 caratteri per token. Il conteggio vero dipende dal modello di embedding. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

function inline(n: GenericNode): string {
  switch (n.type) {
    case 'text':
    case 'inlineCode':
      return n.value ?? '';
    case 'break':
      return '\n';
    case 'image':
      return n.alt ? `[immagine: ${n.alt}]` : '';
    case 'footnoteReference':
      return `[${n.enumerator ?? n.label}]`;
    case 'crossReference':
      return n.children?.length ? n.children.map(inline).join('') : (n.resolved?.text ?? n.label ?? '');
    case 'link': {
      const text = (n.children ?? []).map(inline).join('');
      return /^https?:/.test(n.url ?? '') && text !== n.url ? `${text} (${n.url})` : text;
    }
    default:
      return (n.children ?? []).map(inline).join('');
  }
}

/** Un blocco in testo semplice, in stile Markdown (tabelle comprese). */
export function blockText(n: GenericNode): string {
  switch (n.type) {
    case 'heading':
    case 'paragraph':
      return inline(n);
    case 'list':
      return (n.children ?? []).map((li, i) => `${n.ordered ? `${(n.start ?? 1) + i}.` : '-'} ${(li.children ?? []).map(blockText).join(' ')}`).join('\n');
    case 'blockquote':
      return (n.children ?? []).map((c) => `> ${blockText(c)}`).join('\n');
    case 'code':
      return n.value ?? '';
    case 'admonition': {
      const t = n.children?.find((c) => c.type === 'admonitionTitle');
      const body = (n.children ?? []).filter((c) => c !== t).map(blockText).join('\n');
      return `${t ? inline(t) : 'Nota'}: ${body}`;
    }
    case 'container': {
      if (n.kind === 'figure') {
        const img = n.children?.find((c) => c.type === 'image');
        const cap = n.children?.find((c) => c.type === 'caption');
        return `[Figura: ${img?.alt ?? ''}${cap ? ` — ${toPlain(cap).trim()}` : ''}]`;
      }
      return (n.children ?? []).map(blockText).join('\n');
    }
    case 'caption':
      return `Tabella: ${toPlain(n).trim()}`;
    case 'table':
      return (n.children ?? []).map((r) => `| ${(r.children ?? []).map((c) => (c.children ?? []).map(blockText).join(' ').replace(/\|/g, '\\|')).join(' | ')} |`).join('\n');
    case 'thematicBreak':
      return '';
    default:
      return n.children ? n.children.map(blockText).join('\n') : (n.value ?? '');
  }
}

interface Section {
  anchor: string;
  title: string;
  number?: string;
  depth: number;
  path: string[];
  blocks: GenericNode[];
}

/** Divide una pagina in sezioni: un titolo e i blocchi fino al titolo successivo. */
export function sectionsOf(page: ResolvedPage, docName: string): Section[] {
  const out: Section[] = [];
  const trail: string[] = [];
  let cur: Section | undefined;
  for (const n of page.tree.children ?? []) {
    if (n.type === 'heading') {
      const label = `${n.number ? n.number + (n.depth === 1 ? '. ' : ' ') : ''}${toPlain(n).trim()}`;
      trail.length = Math.max(0, n.depth - 1);
      trail[n.depth - 1] = label;
      cur = { anchor: n.anchor, title: toPlain(n).trim(), number: n.number, depth: n.depth, path: [docName, ...trail.filter(Boolean)], blocks: [] };
      out.push(cur);
      continue;
    }
    if (!cur) {
      cur = { anchor: '', title: page.title, depth: 1, path: [docName, page.title], blocks: [] };
      out.push(cur);
    }
    cur.blocks.push(n);
  }
  return out;
}

export function searchRecords(doc: ResolvedDoc): SearchRecord[] {
  const name = doc.project.settings.name;
  return doc.pages.flatMap((p) =>
    sectionsOf(p, name).map((s) => ({
      id: `${p.slug}#${s.anchor}`,
      page: p.slug,
      anchor: s.anchor,
      title: s.title,
      number: s.number,
      path: s.path,
      text: normalizeText(s.blocks.map(blockText).filter(Boolean).join('\n')),
    })),
  );
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Frammenti per il RAG: una sezione per frammento; le sezioni lunghe si
 * dividono tra un blocco e l'altro ripetendo l'ultimo blocco. Tabelle, codice
 * e avvisi non vengono mai spezzati.
 */
export function chunks(doc: ResolvedDoc, urlFor: (page: string, anchor: string) => string): Chunk[] {
  const name = doc.project.settings.name;
  const out: Chunk[] = [];
  for (const p of doc.pages) {
    for (const s of sectionsOf(p, name)) {
      const header = s.path.join(' › ');
      const texts = s.blocks.map(blockText).filter((t) => t.trim());
      if (!texts.length) continue;
      const groups: string[][] = [];
      let g: string[] = [];
      for (const t of texts) {
        const size = estimateTokens([...g, t].join('\n\n'));
        if (g.length && size > TARGET_TOKENS) {
          groups.push(g);
          g = [g[g.length - 1], t];
        } else g.push(t);
      }
      if (g.length) groups.push(g);
      groups.forEach((grp, i) => {
        const text = normalizeText(`${header}\n\n${grp.join('\n\n')}`);
        out.push({
          id: `${p.slug}#${s.anchor}${groups.length > 1 ? `/${i + 1}` : ''}`,
          hash: sha(text),
          page: p.slug,
          anchor: s.anchor,
          path: s.path,
          text,
          tokens: estimateTokens(text),
          url: urlFor(p.slug, s.anchor),
        });
      });
    }
  }
  return out;
}

export { MAX_TOKENS };
