/**
 * Testo ricco dell'editor visuale, con Tiptap (ProseMirror).
 *
 * - modalità "blocchi": paragrafi, titoli, elenchi, citazioni;
 * - modalità "in linea": un solo paragrafo (didascalie, celle, titoli degli avvisi).
 *
 * Grassetto, corsivo, codice e link si modificano; tutto il resto del testo in
 * linea (riferimenti, ruoli, note…) è una pastiglia che si può spostare o
 * cancellare, ma non cambiare: torna nel file com'era.
 */
import { useRef, useState } from 'react';
import { Mark, mergeAttributes, Node, Extension } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { chipLabel, type MdNode, type PmNode } from './ast';

export interface Pickers {
  labels: Array<{ key: string; title: string; number?: string; kind: string; page: string }>;
  pages: Array<{ file: string; title: string; number?: string }>;
  /** pagina che si sta modificando: i link alle altre pagine sono relativi a lei */
  path: string;
}

/** Nodo atomico con il nodo MyST originale. */
const MystInline = Node.create({
  name: 'mystInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      node: {
        default: null,
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-node') ?? 'null');
          } catch {
            return null;
          }
        },
        renderHTML: (attrs) => ({ 'data-node': JSON.stringify(attrs.node) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-myst-inline]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const n = node.attrs.node as MdNode | null;
    return ['span', mergeAttributes(HTMLAttributes, { 'data-myst-inline': '', class: 'vis-chip', title: 'Si modifica nel sorgente; qui si può spostare o cancellare' }), n ? chipLabel(n) : '?'];
  },
});

/** Codice in linea che, a differenza di quello di Tiptap, convive con grassetto e corsivo. */
const InlineCode = Mark.create({
  name: 'code',
  excludes: '',
  code: true,
  parseHTML: () => [{ tag: 'code' }],
  renderHTML: ({ HTMLAttributes }) => ['code', HTMLAttributes, 0],
  addKeyboardShortcuts() {
    return { 'Mod-e': () => this.editor.commands.toggleMark(this.name) };
  },
});

/** Elenchi compatti o distanziati: si conserva com'erano. */
const ListSpread = Extension.create({
  name: 'listSpread',
  addGlobalAttributes() {
    return [{ types: ['bulletList', 'orderedList'], attributes: { spread: { default: false, rendered: false } } }];
  },
});

const InlineDoc = Node.create({ name: 'doc', topNode: true, content: 'paragraph' });

function extensions(mode: 'blocchi' | 'in linea') {
  const inline = mode === 'in linea';
  return [
    StarterKit.configure({
      codeBlock: false,
      code: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: true },
      heading: inline ? false : { levels: [1, 2, 3, 4, 5, 6] },
      ...(inline ? { document: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, blockquote: false } : {}),
    }),
    ...(inline ? [InlineDoc] : [ListSpread]),
    InlineCode,
    MystInline,
  ];
}

/** Link da un file della sorgente a un altro, relativo alla cartella del primo. */
export function relativeLink(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

function Toolbar({ editor, mode, pickers }: { editor: Editor; mode: 'blocchi' | 'in linea'; pickers: Pickers }) {
  const [panel, setPanel] = useState<'link' | 'ref' | null>(null);
  const [url, setUrl] = useState('');
  const [filter, setFilter] = useState('');
  const btn = (label: string, active: boolean, run: () => void, title?: string) => (
    <button type="button" className={`vis-tool${active ? ' vis-tool-on' : ''}`} aria-pressed={active} title={title ?? label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  );
  const c = () => editor.chain().focus();
  const level = [1, 2, 3, 4, 5, 6].find((l) => editor.isActive('heading', { level: l }));
  const openLink = () => {
    setUrl(editor.getAttributes('link').href ?? '');
    setPanel(panel === 'link' ? null : 'link');
  };
  const applyLink = (href: string) => {
    if (!href) c().unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive('link')) c().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    else c().extendMarkRange('link').setLink({ href }).run();
    setPanel(null);
  };
  const insertRef = (l: Pickers['labels'][number]) => {
    const numref = l.kind === 'figure' || l.kind === 'table';
    const role = numref ? 'numref' : 'ref';
    const node: MdNode = { type: 'crossReference', kind: role, identifier: l.key, label: l.key, children: [], origin: { kind: 'role', name: role, value: l.key } };
    c().insertContent({ type: 'mystInline', attrs: { node } }).run();
    setPanel(null);
  };
  const labels = pickers.labels.filter((l) => !filter || `${l.key} ${l.title}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 40);

  return (
    <div className="vis-toolbar" role="toolbar" aria-label="Formattazione">
      {mode === 'blocchi' && (
        <select
          className="vis-tool"
          aria-label="Tipo di blocco"
          value={level ? `h${level}` : editor.isActive('blockquote') ? 'quote' : 'p'}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'p') c().setParagraph().run();
            else if (v === 'quote') c().toggleBlockquote().run();
            else c().setHeading({ level: Number(v.slice(1)) as 1 }).run();
          }}
        >
          <option value="p">Paragrafo</option>
          {[1, 2, 3, 4].map((l) => (
            <option key={l} value={`h${l}`}>Titolo {l}</option>
          ))}
          <option value="quote">Citazione</option>
        </select>
      )}
      {btn('G', editor.isActive('bold'), () => c().toggleBold().run(), 'Grassetto (⌘B)')}
      {btn('C', editor.isActive('italic'), () => c().toggleItalic().run(), 'Corsivo (⌘I)')}
      {btn('</>', editor.isActive('code'), () => c().toggleMark('code').run(), 'Codice (⌘E)')}
      {btn('Link', editor.isActive('link'), openLink)}
      {btn('Riferimento', panel === 'ref', () => setPanel(panel === 'ref' ? null : 'ref'), 'Riferimento a un\'etichetta del documento')}
      {mode === 'blocchi' && btn('• Elenco', editor.isActive('bulletList'), () => c().toggleBulletList().run())}
      {mode === 'blocchi' && btn('1. Elenco', editor.isActive('orderedList'), () => c().toggleOrderedList().run())}
      {panel === 'link' && (
        <div className="vis-popover">
          <label className="vis-label" htmlFor="vis-url">Indirizzo (https://…, mailto:…) o pagina del documento</label>
          <div className="flex gap-2">
            <input id="vis-url" className="ita-input ita-input-sm flex-1" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyLink(url))} autoFocus />
            <button type="button" className="ita-btn ita-btn-xs ita-btn-primary" onClick={() => applyLink(url)}>Applica</button>
            {editor.isActive('link') && <button type="button" className="ita-btn ita-btn-xs ita-btn-outline" onClick={() => applyLink('')}>Togli</button>}
          </div>
          <select className="vis-tool mt-2 w-full" aria-label="Pagina del documento" value="" onChange={(e) => e.target.value && setUrl(relativeLink(pickers.path, e.target.value))}>
            <option value="">Oppure scegli una pagina…</option>
            {pickers.pages.map((p) => (
              <option key={p.file} value={p.file}>{`${p.number ? `${p.number} ` : ''}${p.title || p.file}`}</option>
            ))}
          </select>
        </div>
      )}
      {panel === 'ref' && (
        <div className="vis-popover">
          <label className="vis-label" htmlFor="vis-ref">Cerca tra le etichette del documento</label>
          <input id="vis-ref" className="ita-input ita-input-sm w-full" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
          <ul className="vis-refs">
            {labels.map((l) => (
              <li key={l.key}>
                <button type="button" onClick={() => insertRef(l)}>
                  <code>{l.key}</code> {l.number ? `${l.number} ` : ''}{l.title} <span className="opacity-60">({l.page})</span>
                </button>
              </li>
            ))}
            {!labels.length && <li className="opacity-70">Nessuna etichetta. Si crea con «(nome)=» prima di un titolo, una figura o un paragrafo.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RichTextProps {
  doc: PmNode;
  mode: 'blocchi' | 'in linea';
  pickers: Pickers;
  label: string;
  onChange(doc: PmNode): void;
  /** Invio in modalità in linea, ⌘Invio in modalità blocchi */
  onSubmit?(): void;
  autoFocus?: boolean;
}

export function RichText({ doc, mode, pickers, label, onChange, onSubmit, autoFocus }: RichTextProps) {
  const handlers = useRef({ onChange, onSubmit });
  handlers.current = { onChange, onSubmit };
  const editor = useEditor({
    extensions: extensions(mode),
    content: doc as any,
    immediatelyRender: true,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: `vis-rich di-prose${mode === 'in linea' ? ' vis-rich-inline' : ''}`, 'aria-label': label, role: 'textbox', 'aria-multiline': mode === 'blocchi' ? 'true' : 'false' },
      handleKeyDown: (_view, e) => {
        if ((mode === 'in linea' && e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          handlers.current.onSubmit?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => handlers.current.onChange(ed.getJSON() as PmNode),
  });
  if (!editor) return null;
  return (
    <div className="vis-richbox">
      <Toolbar editor={editor} mode={mode} pickers={pickers} />
      <EditorContent editor={editor} />
    </div>
  );
}
