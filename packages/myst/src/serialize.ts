/**
 * Serializzazione a blocchi: AST → MyST, per l'editor (todo.md, 5.3).
 *
 * Non si rigenera mai il file intero. Il file è una sequenza di blocchi di
 * primo livello con le loro righe di origine; al salvataggio si riscrivono solo
 * i blocchi modificati e il resto resta identico byte per byte.
 *
 * Il serializzatore conosce avvisi, figure, list-table, citazioni e codice, e
 * ne conserva le opzioni. Per ruoli e direttive che non conosce usa la forma
 * originale salvata in `origin` dalla sostituzione delle direttive.
 */
import type { GenericNode } from '@docs-italia/schema';
import { parseMyst } from './myst.ts';
import { liftDirectives } from './resolve.ts';

const INLINE = new Set(['text', 'emphasis', 'strong', 'inlineCode', 'link', 'image', 'break', 'footnoteReference', 'crossReference', 'inlineMath', 'subscript', 'superscript', 'abbreviation', 'html']);
const ADMONITION_KINDS = new Set(['note', 'tip', 'hint', 'important', 'attention', 'caution', 'warning', 'danger', 'error', 'seealso']);
const QUOTE_DIRECTIVES: Record<string, string> = { epigraph: 'epigraph', highlights: 'highlights', 'pull-quote': 'pull-quote' };

// ---------------------------------------------------------------------------
// Testo in linea
// ---------------------------------------------------------------------------

/** Escape del testo: solo i caratteri che MyST interpreterebbe. */
export function escapeText(s: string, atLineStart = false): string {
  const out = s
    .replace(/\\/g, '\\\\')
    .replace(/([*`[\]$])/g, '\\$1')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (m) => m.replace('_', '\\_'))
    .replace(/<(?=[a-zA-Z/!?])/g, '\\<')
    .replace(/&(?=#?[a-zA-Z0-9]+;)/g, '\\&');
  // inizio di riga: il primo solo se il testo apre il blocco, gli altri sempre
  // (il testo convertito dall'RST conserva gli a capo del sorgente)
  const lineStart = /^(\s*)(#{1,6}(?=\s|$)|>|[-+](?=\s)|\d+(?=[.)]\s)|=+\s*$|%|:{3,}|\((?=[^)]*\)=))/;
  return out
    .split('\n')
    // per i numeri si protegge il punto ("1\\."): "\\1." non è un escape valido
    .map((l, i) => (i === 0 && !atLineStart ? l : l.replace(lineStart, (_m, sp, tok) => (/^\d/.test(tok) ? `${sp}${tok}\\` : `${sp}\\${tok}`))))
    .join('\n');
}

function longestRun(s: string, ch: string): number {
  let max = 0;
  let cur = 0;
  for (const c of s) {
    cur = c === ch ? cur + 1 : 0;
    max = Math.max(max, cur);
  }
  return max;
}

function roleText(o: GenericNode['origin']): string {
  const value = String(o.value ?? '');
  const ticks = '`'.repeat(longestRun(value, '`') + 1);
  return `{${o.name}}${ticks}${value}${ticks}`;
}

export function serializeInline(nodes: GenericNode[] | undefined, atLineStart = true): string {
  let out = '';
  for (const n of nodes ?? []) {
    out += inline(n, atLineStart && out === '');
  }
  return out;
}

function inline(n: GenericNode, atLineStart: boolean): string {
  if (n.origin?.kind === 'role') return roleText(n.origin);
  switch (n.type) {
    case 'text':
      return escapeText(n.value ?? '', atLineStart);
    case 'emphasis':
      return `*${serializeInline(n.children, false)}*`;
    case 'strong':
      return `**${serializeInline(n.children, false)}**`;
    case 'inlineCode': {
      const v = n.value ?? '';
      const ticks = '`'.repeat(longestRun(v, '`') + 1);
      const pad = v.startsWith('`') || v.endsWith('`') ? ' ' : '';
      return `${ticks}${pad}${v}${pad}${ticks}`;
    }
    case 'link': {
      const text = serializeInline(n.children, false);
      const only = n.children?.length === 1 && n.children[0].type === 'text' ? n.children[0].value : undefined;
      if (n.url && only === n.url && /^(https?|mailto):/i.test(n.url)) return `<${n.url}>`;
      if (!n.url) return text;
      return `[${text}](${n.url.includes(' ') ? `<${n.url}>` : n.url}${n.title ? ` "${n.title.replace(/"/g, '\\"')}"` : ''})`;
    }
    case 'image':
      return `![${escapeText(n.alt ?? '')}](${n.url ?? ''}${n.title ? ` "${n.title.replace(/"/g, '\\"')}"` : ''})`;
    case 'break':
      return '\\\n';
    case 'footnoteReference':
      return `[^${n.label ?? n.identifier}]`;
    case 'crossReference':
      return roleText({ name: n.kind === 'numref' ? 'numref' : 'ref', value: n.label ?? n.identifier });
    case 'inlineMath':
      return `$${n.value ?? ''}$`;
    case 'unsupported':
      return n.origin ? roleText(n.origin) : escapeText(n.value ?? '');
    case 'html':
      return n.value ?? '';
    default:
      return serializeInline(n.children, false);
  }
}

// ---------------------------------------------------------------------------
// Blocchi
// ---------------------------------------------------------------------------

const indent = (s: string, pad: string) =>
  s
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');

function fence(body: string, min = 3): string {
  const runs = [...body.matchAll(/^(:{3,})/gm)].map((m) => m[1].length);
  return ':'.repeat(Math.max(min, ...runs.map((r) => r + 1)));
}

function optionLines(options: Record<string, unknown>): string {
  return Object.entries(options)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
    .map(([k, v]) => (v === true ? `:${k}:` : `:${k}: ${v}`))
    .join('\n');
}

function directive(name: string, args: string | undefined, options: Record<string, unknown>, body: string): string {
  const opts = optionLines(options);
  const f = fence(body);
  const parts = [`${f}{${name}}${args ? ` ${args}` : ''}`];
  if (opts) parts.push(opts);
  if (body) parts.push(...(opts ? ['', body] : [body]));
  parts.push(f);
  return parts.join('\n');
}

/** Opzioni originali da conservare, tolte quelle che il serializzatore ricalcola. */
function passthrough(n: GenericNode, computed: string[]): Record<string, unknown> {
  const o = { ...(n.origin?.options ?? {}) };
  for (const k of computed) delete o[k];
  return o;
}

export function serializeBlocks(nodes: GenericNode[] | undefined, separator = '\n\n'): string {
  return (nodes ?? []).map(serializeBlock).filter((s) => s !== '').join(separator);
}

export function serializeBlock(n: GenericNode): string {
  // direttive sconosciute: forma originale
  if (n.type === 'unsupported' && n.origin?.kind === 'directive') return rawDirective(n.origin);
  switch (n.type) {
    case 'heading':
      return `${'#'.repeat(n.depth ?? 1)} ${serializeInline(n.children, false)}`;
    case 'paragraph':
      return serializeInline(n.children, true);
    case 'mystTarget':
      return `(${n.label})=`;
    case 'thematicBreak':
      return '---';
    case 'blockquote':
      return indent(serializeBlocks(n.children), '> ').replace(/^$/gm, '>');
    case 'code':
      return serializeCode(n);
    case 'list':
      return serializeList(n);
    case 'table':
      return serializeTable(n);
    case 'admonition':
      return serializeAdmonition(n);
    case 'container':
      return serializeContainer(n);
    case 'footnoteDefinition': {
      const [first, ...rest] = n.children ?? [];
      const head = `[^${n.label ?? n.identifier}]: ${first ? serializeBlock(first) : ''}`;
      return rest.length ? `${head}\n\n${indent(serializeBlocks(rest), '    ')}` : head;
    }
    case 'image': {
      // immagine come blocco: direttiva {image} con le sue opzioni, oppure ![]()
      if (n.origin?.kind === 'directive') {
        const options = { ...passthrough(n, ['alt', 'align', 'width', 'height', 'class', 'name']), alt: n.alt, align: n.align, width: n.width, height: n.height, class: n.class, name: n.label };
        return directive(n.origin.name, n.url, options, '');
      }
      return inline(n, true);
    }
    case 'definitionList':
      return serializeDefinitionList(n);
    case 'math':
      return `$$\n${n.value ?? ''}\n$$`;
    case 'html':
      return n.value ?? '';
    case 'mystComment':
    case 'comment':
      return `% ${n.value ?? ''}`;
    default:
      if (n.origin?.kind === 'directive') return rawDirective(n.origin);
      throw new Error(`serializzazione non supportata per il nodo "${n.type}"`);
  }
}

function rawDirective(o: GenericNode['origin']): string {
  return directive(o.name, o.args, o.options ?? {}, String(o.value ?? ''));
}

function serializeCode(n: GenericNode): string {
  const value = n.value ?? '';
  if (n.origin?.kind === 'directive' && n.origin.name !== 'code') {
    // es. {code-block} python con opzioni, {literalinclude}: forma originale
    if (n.origin.name !== 'code-block' && n.origin.name !== 'sourcecode') return rawDirective(n.origin);
    const ticks = '`'.repeat(Math.max(3, longestRun(value, '`') + 1));
    const opts = optionLines(n.origin.options ?? {});
    return `${ticks}{${n.origin.name}}${n.lang ? ` ${n.lang}` : ''}\n${opts ? `${opts}\n` : ''}${value}\n${ticks}`;
  }
  const ticks = '`'.repeat(Math.max(3, longestRun(value, '`') + 1));
  return `${ticks}${n.lang ?? ''}${n.meta ? ` ${n.meta}` : ''}\n${value}\n${ticks}`;
}

/** Lista di definizioni MyST: "Termine" seguito da ": definizione" (righe successive rientrate di 2). */
function serializeDefinitionList(n: GenericNode): string {
  const parts: string[] = [];
  for (const c of n.children ?? []) {
    if (c.type === 'definitionTerm') {
      parts.push(`${parts.length ? '\n' : ''}${serializeInline(c.children, true)}`);
    } else if (c.type === 'definitionDescription') {
      // definizione compatta: testo in linea senza paragrafo intorno
      const inlineOnly = (c.children ?? []).every((k) => INLINE.has(k.type));
      const body = inlineOnly ? serializeInline(c.children, true) : serializeBlocks(c.children);
      const [first, ...rest] = body.split('\n');
      parts.push(`: ${first ?? ''}${rest.length ? `\n${indent(rest.join('\n'), '  ')}` : ''}`);
    }
  }
  return parts.join('\n');
}

function serializeList(n: GenericNode): string {
  const loose = Boolean(n.spread);
  let num = n.start ?? 1;
  return (n.children ?? [])
    .map((li) => {
      const marker = n.ordered ? `${num++}.` : '-';
      const pad = ' '.repeat(marker.length + 1);
      // caselle di controllo (estensione tasklist)
      const box = li.checked === true ? '[x] ' : li.checked === false ? '[ ] ' : '';
      const body = serializeBlocks(li.children, loose ? '\n\n' : '\n');
      const [first, ...rest] = body.split('\n');
      return `${marker} ${box}${first}${rest.length ? `\n${indent(rest.join('\n'), pad)}` : ''}`;
    })
    .join(loose ? '\n\n' : '\n');
}

function cellText(c: GenericNode): string {
  const kids = c.children ?? [];
  const content = kids.length === 1 && kids[0].type === 'paragraph' ? kids[0].children : kids;
  return serializeInline(content, false).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function serializeTable(n: GenericNode): string {
  const rows = n.children ?? [];
  if (!rows.length) return '';
  const head = rows[0];
  const align = (head.children ?? []).map((c) => (c.align === 'left' ? ':--' : c.align === 'right' ? '--:' : c.align === 'center' ? ':-:' : '---'));
  const line = (r: GenericNode) => `| ${(r.children ?? []).map(cellText).join(' | ')} |`;
  return [line(head), `|${align.join('|')}|`, ...rows.slice(1).map(line)].join('\n');
}

function serializeAdmonition(n: GenericNode): string {
  const titleNode = n.children?.find((c) => c.type === 'admonitionTitle');
  const body = serializeBlocks(n.children?.filter((c) => c !== titleNode));
  const name = n.origin?.name ?? (titleNode || !ADMONITION_KINDS.has(n.kind) ? 'admonition' : n.kind);
  const title = titleNode ? serializeInline(titleNode.children, false) : undefined;
  const generic = name === 'admonition';
  const options = { ...passthrough(n, ['class']), class: n.class };
  return directive(generic ? 'admonition' : name, title ?? n.origin?.args, options, body);
}

function serializeContainer(n: GenericNode): string {
  const kids = n.children ?? [];
  if (n.kind === 'figure') {
    const img = kids.find((k) => k.type === 'image');
    const caption = kids.find((k) => k.type === 'caption');
    const legend = kids.find((k) => k.type === 'legend');
    // prima della risoluzione la didascalia è il primo paragrafo dopo l'immagine
    const loose = !caption ? kids.filter((k) => k !== img && k.type !== 'legend') : [];
    const capBlocks = caption ? caption.children : loose.slice(0, 1);
    const legendBlocks = legend ? legend.children : loose.slice(1);
    const options = {
      ...passthrough(n, ['alt', 'align', 'name', 'width', 'class']),
      alt: img?.alt,
      align: img?.align,
      width: img?.width,
      name: n.label,
      class: n.class,
    };
    const body = [serializeBlocks(capBlocks), serializeBlocks(legendBlocks)].filter(Boolean).join('\n\n');
    return directive('figure', img?.url, options, body);
  }
  if (n.kind === 'table') {
    const caption = kids.find((k) => k.type === 'caption');
    const table = kids.find((k) => k.type === 'table');
    const rows = table?.children ?? [];
    const headerRows = rows.filter((r) => r.children?.every((c) => c.header)).length;
    const cell = (c: GenericNode) => {
      const text = serializeBlocks(c.children);
      const [first, ...rest] = text.split('\n');
      return `  - ${first ?? ''}${rest.length ? `\n${indent(rest.join('\n'), '    ')}` : ''}`;
    };
    const body = rows.map((r) => `* ${(r.children ?? []).map(cell).join('\n').slice(2)}`).join('\n');
    const options = { ...passthrough(n, ['header-rows', 'name', 'class']), 'header-rows': headerRows || undefined, name: n.label, class: n.class };
    const args = caption ? serializeInline(caption.children?.length === 1 && caption.children[0].type === 'paragraph' ? caption.children[0].children : caption.children, false) : undefined;
    return directive(n.origin?.name === 'list-table' || !n.origin ? 'list-table' : n.origin.name, args, options, body);
  }
  if (n.kind === 'quote') {
    const cls = String(n.class ?? '').split(/\s+/)[0];
    const name = n.origin?.name ?? QUOTE_DIRECTIVES[cls] ?? 'blockquote';
    const inner = kids.length === 1 && kids[0].type === 'blockquote' ? kids[0].children : kids;
    return directive(name, n.origin?.args, passthrough(n, []), serializeBlocks(inner));
  }
  if (n.origin?.kind === 'directive') return rawDirective(n.origin);
  throw new Error(`serializzazione non supportata per il contenitore "${n.kind}"`);
}

// ---------------------------------------------------------------------------
// Blocchi di primo livello e sostituzione nel file
// ---------------------------------------------------------------------------

export interface SourceBlock {
  /** righe di origine, 1-based e comprese */
  start: number;
  end: number;
  /** testo originale del blocco */
  text: string;
  /** nodi del blocco, con direttive e ruoli già sostituiti */
  nodes: GenericNode[];
  /** false se le righe di origine non sono affidabili: il blocco non va riscritto */
  editable: boolean;
}

/**
 * myst-parser assegna alle definizioni delle note la posizione del paragrafo
 * che le cita: la riga vera si cerca nel sorgente ("[^etichetta]:") insieme
 * alle righe di continuazione (rientrate, anche dopo righe vuote).
 */
function footnoteRange(lines: string[], label: string): [number, number] | undefined {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex((l) => new RegExp(`^\\[\\^${esc}\\]:`).test(l));
  if (start < 0) return undefined;
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s+\S/.test(lines[i])) end = i;
    else if (lines[i].trim() !== '') break;
  }
  return [start + 1, end + 1];
}

/** Divide un file MyST nei suoi blocchi di primo livello, con le righe di origine. */
export function sourceBlocks(source: string, file = 'file.md'): SourceBlock[] {
  const lines = source.split('\n');
  const raw = parseMyst(source, file).tree.children ?? [];
  const blocks: SourceBlock[] = raw
    .filter((n: GenericNode) => n.position)
    .map((n: GenericNode) => {
      let start: number = n.position.start.line;
      let end: number = n.position.end.line;
      let editable = true;
      if (n.type === 'footnoteDefinition') {
        const r = footnoteRange(lines, n.label ?? n.identifier);
        if (r) [start, end] = r;
        else editable = false;
      }
      while (end > start && !lines[end - 1]?.trim()) end--;
      return { start, end, text: lines.slice(start - 1, end).join('\n'), nodes: liftDirectives([structuredClone(n)]), editable };
    })
    .sort((a, b) => a.start - b.start);
  // righe sovrapposte: posizioni non affidabili, nessuno dei due blocchi si riscrive
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].start <= blocks[i - 1].end) {
      blocks[i].editable = false;
      blocks[i - 1].editable = false;
    }
  }
  return blocks;
}

/**
 * Sostituisce nel file solo i blocchi indicati (per indice in sourceBlocks).
 * Il resto del file, righe vuote comprese, resta identico.
 */
export function replaceBlocks(source: string, blocks: SourceBlock[], changes: Map<number, GenericNode[]>): string {
  const lines = source.split('\n');
  const sorted = [...changes.entries()].sort((a, b) => b[0] - a[0]);
  for (const [i, nodes] of sorted) {
    const b = blocks[i];
    if (!b) throw new Error(`blocco ${i} inesistente`);
    if (!b.editable) throw new Error(`il blocco alle righe ${b.start}-${b.end} non ha posizioni affidabili e non si può riscrivere`);
    lines.splice(b.start - 1, b.end - b.start + 1, ...serializeBlocks(nodes).split('\n'));
  }
  return lines.join('\n');
}
