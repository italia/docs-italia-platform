/**
 * Editor visuale (todo.md, 5.3): conversione tra l'AST MyST di un blocco e il
 * documento ProseMirror di Tiptap.
 *
 * Regola di fedeltà: ciò che l'editor di testo non sa modificare (ruoli,
 * riferimenti, note, immagini in linea, formule…) diventa un nodo atomico
 * "mystInline" che porta con sé il nodo originale e torna nell'AST identico.
 * Il serializzatore lo riscrive nella forma di partenza.
 */

export interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  [key: string]: any;
}

export interface PmMark {
  type: 'bold' | 'italic' | 'code' | 'link';
  attrs?: Record<string, any>;
}

export interface PmNode {
  type: string;
  attrs?: Record<string, any>;
  content?: PmNode[];
  text?: string;
  marks?: PmMark[];
}

// ---------------------------------------------------------------------------- in linea

export function inlineToPm(nodes: MdNode[] | undefined, marks: PmMark[] = []): PmNode[] {
  const out: PmNode[] = [];
  const m = (extra?: PmMark) => (extra ? [...marks, extra] : marks).map((x) => ({ ...x }));
  for (const n of nodes ?? []) {
    if (n.origin?.kind === 'role') {
      out.push({ type: 'mystInline', attrs: { node: n }, marks: m() });
      continue;
    }
    switch (n.type) {
      case 'text':
        if (n.value) out.push({ type: 'text', text: n.value, marks: m() });
        break;
      case 'emphasis':
        out.push(...inlineToPm(n.children, m({ type: 'italic' })));
        break;
      case 'strong':
        out.push(...inlineToPm(n.children, m({ type: 'bold' })));
        break;
      case 'inlineCode':
        if (n.value) out.push({ type: 'text', text: n.value, marks: m({ type: 'code' }) });
        break;
      case 'link':
        if (n.children?.length && n.url !== undefined) {
          out.push(...inlineToPm(n.children, m({ type: 'link', attrs: { href: n.url, title: n.title ?? null } })));
          break;
        }
        out.push({ type: 'mystInline', attrs: { node: n }, marks: m() });
        break;
      case 'break':
        out.push({ type: 'hardBreak', marks: m() });
        break;
      default:
        out.push({ type: 'mystInline', attrs: { node: n }, marks: m() });
    }
  }
  // ProseMirror non vuole elenchi di marchi vuoti
  for (const o of out) if (!o.marks?.length) delete o.marks;
  return out;
}

const ORDER: PmMark['type'][] = ['italic', 'bold', 'link']; // dal più interno al più esterno

function wrap(node: MdNode, marks: PmMark[] = []): MdNode {
  let n = node;
  for (const type of ORDER) {
    const mark = marks.find((x) => x.type === type);
    if (!mark) continue;
    if (type === 'italic') n = { type: 'emphasis', children: [n] };
    else if (type === 'bold') n = { type: 'strong', children: [n] };
    else n = { type: 'link', url: mark.attrs?.href ?? '', ...(mark.attrs?.title ? { title: mark.attrs.title } : {}), children: [n] };
  }
  return n;
}

const mergeable = (a: MdNode, b: MdNode) =>
  a.type === b.type && (a.type === 'emphasis' || a.type === 'strong' || (a.type === 'link' && a.url === b.url && a.title === b.title));

/** Fonde i nodi adiacenti con lo stesso contenitore: **a****b** → **ab**. */
function merge(nodes: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && last.type === 'text' && n.type === 'text') last.value = (last.value ?? '') + (n.value ?? '');
    else if (last && mergeable(last, n)) last.children = [...(last.children ?? []), ...(n.children ?? [])];
    else out.push(n);
  }
  for (const n of out) if (n.children && n.type !== 'crossReference' && !n.origin) n.children = merge(n.children);
  return out;
}

export function pmToInline(content: PmNode[] | undefined): MdNode[] {
  const out: MdNode[] = [];
  for (const c of content ?? []) {
    let node: MdNode | null = null;
    if (c.type === 'text') {
      const code = c.marks?.some((m) => m.type === 'code');
      node = code ? { type: 'inlineCode', value: c.text ?? '' } : { type: 'text', value: c.text ?? '' };
    } else if (c.type === 'hardBreak') node = { type: 'break' };
    else if (c.type === 'mystInline') node = structuredClone(c.attrs?.node);
    if (node) out.push(wrap(node, c.marks));
  }
  return merge(out);
}

// ---------------------------------------------------------------------------- blocchi

/** Il blocco si modifica come testo (paragrafi, titoli, elenchi, citazioni)? */
export function isRichBlock(n: MdNode): boolean {
  if (n.origin?.kind === 'directive') return false;
  switch (n.type) {
    case 'paragraph':
    case 'heading':
      return true;
    case 'list':
      return (n.children ?? []).every((li) => li.type === 'listItem' && li.checked == null && (li.children ?? []).every(isRichBlock));
    case 'blockquote':
      return (n.children ?? []).every(isRichBlock);
    default:
      return false;
  }
}

export function blockToPm(n: MdNode): PmNode {
  switch (n.type) {
    case 'paragraph':
      return { type: 'paragraph', content: inlineToPm(n.children) };
    case 'heading':
      return { type: 'heading', attrs: { level: Math.min(6, Math.max(1, n.depth ?? 1)) }, content: inlineToPm(n.children) };
    case 'list':
      return {
        type: n.ordered ? 'orderedList' : 'bulletList',
        attrs: { ...(n.ordered ? { start: n.start ?? 1 } : {}), spread: !!n.spread },
        content: (n.children ?? []).map((li) => ({
          type: 'listItem',
          content: li.children?.length ? li.children.map(blockToPm) : [{ type: 'paragraph' }],
        })),
      };
    case 'blockquote':
      return { type: 'blockquote', content: (n.children ?? []).map(blockToPm) };
    default:
      throw new Error(`blocco non modificabile come testo: ${n.type}`);
  }
}

export function pmToBlock(n: PmNode): MdNode {
  switch (n.type) {
    case 'paragraph':
      return { type: 'paragraph', children: pmToInline(n.content) };
    case 'heading':
      return { type: 'heading', depth: n.attrs?.level ?? 1, children: pmToInline(n.content) };
    case 'bulletList':
    case 'orderedList': {
      const ordered = n.type === 'orderedList';
      const spread = !!n.attrs?.spread;
      return {
        type: 'list',
        ordered,
        ...(ordered ? { start: n.attrs?.start ?? 1 } : {}),
        spread,
        children: (n.content ?? []).map((li) => ({ type: 'listItem', spread, children: (li.content ?? []).map(pmToBlock) })),
      };
    }
    case 'blockquote':
      return { type: 'blockquote', children: (n.content ?? []).map(pmToBlock) };
    default:
      return { type: 'paragraph', children: [] };
  }
}

/** Documento Tiptap → blocchi MyST, senza i paragrafi vuoti in fondo o in testa. */
export function docToBlocks(doc: PmNode): MdNode[] {
  const blocks = (doc.content ?? []).map(pmToBlock);
  const empty = (b: MdNode) => b.type === 'paragraph' && !b.children?.length;
  while (blocks.length && empty(blocks[blocks.length - 1]!)) blocks.pop();
  while (blocks.length && empty(blocks[0]!)) blocks.shift();
  return blocks;
}

export const blocksToDoc = (nodes: MdNode[]): PmNode => ({ type: 'doc', content: nodes.length ? nodes.map(blockToPm) : [{ type: 'paragraph' }] });
export const inlineToDoc = (nodes: MdNode[] | undefined): PmNode => ({ type: 'doc', content: [{ type: 'paragraph', content: inlineToPm(nodes) }] });
export const docToInline = (doc: PmNode): MdNode[] => pmToInline(doc.content?.[0]?.content);

/** Testo della pastiglia di un nodo non modificabile come testo. */
export function chipLabel(n: MdNode): string {
  if (n.type === 'crossReference') {
    const text = (n.children ?? []).map(plain).join('');
    return `↗ ${text || n.label || n.identifier}`;
  }
  if (n.type === 'footnoteReference') return `[^${n.label ?? n.identifier}]`;
  if (n.origin?.kind === 'role') return `{${n.origin.name}} ${String(n.origin.value ?? '')}`;
  if (n.type === 'image') return `🖼 ${n.alt || n.url}`;
  if (n.type === 'inlineMath') return `$${n.value ?? ''}$`;
  const text = plain(n);
  return text || n.type;
}

export function plain(n: MdNode): string {
  if (n.type === 'text' || n.type === 'inlineCode') return n.value ?? '';
  return (n.children ?? []).map(plain).join('');
}
