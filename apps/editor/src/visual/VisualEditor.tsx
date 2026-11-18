/**
 * Editor visuale MyST (todo.md, 5.3, livello 3).
 *
 * La pagina è la sequenza dei suoi blocchi di primo livello, ognuno mostrato
 * come nel sito. Un clic apre il blocco nell'editor adatto; "Fatto" lo
 * riscrive nel sorgente con il serializzatore a blocchi: cambiano solo le
 * righe di quel blocco, il resto del file resta identico. Gli spostamenti
 * riusano il testo originale del blocco.
 *
 * Il sorgente resta l'unica verità: ogni modifica produce un nuovo testo, che
 * passa dalle bozze e dall'anteprima come quelle fatte nel sorgente.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { api, type BlockData, type BlockEditRequest, type BlocksData } from '../api';
import { blocksToDoc, docToBlocks, docToInline, inlineToDoc, isRichBlock, type MdNode, type PmNode } from './ast';
import { relativeLink, RichText, type Pickers } from './RichText';

/** Percorso dalla radice della sorgente di un file citato da una pagina ("../images/a.png" da "capitoli/b.md"). */
function fromPage(page: string, url: string): string {
  const parts = page.split('/').slice(0, -1);
  for (const seg of url.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

type Content = { nodes: MdNode[] } | { text: string };

const ADMONITIONS: Array<[string, string]> = [
  ['note', 'Nota'],
  ['tip', 'Suggerimento'],
  ['important', 'Importante'],
  ['warning', 'Attenzione'],
  ['caution', 'Cautela'],
  ['danger', 'Pericolo'],
  ['attention', 'Attenzione (forte)'],
  ['hint', 'Indicazione'],
  ['seealso', 'Vedi anche'],
  ['error', 'Errore'],
  ['admonition', 'Riquadro con titolo'],
];

const p = (text = ''): MdNode => ({ type: 'paragraph', children: text ? [{ type: 'text', value: text }] : [] });

/** Blocchi nuovi: il modello con cui si apre l'editor. */
const TEMPLATES: Array<{ id: string; label: string; content: Content }> = [
  { id: 'paragrafo', label: 'Paragrafo', content: { nodes: [p()] } },
  { id: 'titolo', label: 'Titolo', content: { nodes: [{ type: 'heading', depth: 2, children: [] }] } },
  { id: 'elenco', label: 'Elenco', content: { nodes: [{ type: 'list', ordered: false, spread: false, children: [{ type: 'listItem', children: [p()] }] }] } },
  { id: 'avviso', label: 'Avviso', content: { nodes: [{ type: 'admonition', kind: 'note', children: [p()], origin: { kind: 'directive', name: 'note' } }] } },
  {
    id: 'figura',
    label: 'Figura',
    content: { nodes: [{ type: 'container', kind: 'figure', children: [{ type: 'image', url: '', alt: '' }, p()], origin: { kind: 'directive', name: 'figure', options: {} } }] },
  },
  {
    id: 'tabella',
    label: 'Tabella',
    content: {
      nodes: [
        {
          type: 'table',
          children: [0, 1].map((r) => ({ type: 'tableRow', children: [0, 1].map(() => ({ type: 'tableCell', header: r === 0, children: [] })) })),
        },
      ],
    },
  },
  { id: 'codice', label: 'Codice', content: { nodes: [{ type: 'code', lang: '', value: '' }] } },
  { id: 'sorgente', label: 'Sorgente MyST', content: { text: '' } },
];

// ---------------------------------------------------------------------------- tipi di blocco

type Kind = 'testo' | 'avviso' | 'figura' | 'tabella' | 'codice' | 'etichetta' | 'sorgente';

const simpleCell = (c: MdNode, gfm: boolean) => gfm || (c.children ?? []).length === 0 || ((c.children ?? []).length === 1 && c.children![0]!.type === 'paragraph');

function kindOf(nodes: MdNode[] | null): Kind {
  if (!nodes || nodes.length !== 1) return nodes && nodes.length > 1 && nodes.every(isRichBlock) ? 'testo' : 'sorgente';
  const n = nodes[0]!;
  if (isRichBlock(n)) return 'testo';
  if (n.type === 'admonition' && (n.children ?? []).filter((c) => c.type !== 'admonitionTitle').every(isRichBlock)) return 'avviso';
  if (n.type === 'container' && n.kind === 'figure') {
    const kids = n.children ?? [];
    const img = kids.filter((k) => k.type === 'image');
    const rest = kids.filter((k) => k.type !== 'image');
    if (img.length === 1 && rest.length <= 1 && rest.every((k) => k.type === 'paragraph')) return 'figura';
  }
  if (n.type === 'table' && (n.children ?? []).every((r) => (r.children ?? []).every((c) => simpleCell(c, true)))) return 'tabella';
  if (n.type === 'container' && n.kind === 'table') {
    const table = n.children?.find((k) => k.type === 'table');
    const ok = table && (n.children ?? []).every((k) => k.type === 'table' || k.type === 'caption') && (table.children ?? []).every((r) => (r.children ?? []).every((c) => simpleCell(c, false)));
    if (ok) return 'tabella';
  }
  if (n.type === 'code' && (!n.origin || ['code', 'code-block', 'sourcecode'].includes(n.origin.name))) return 'codice';
  if (n.type === 'mystTarget') return 'etichetta';
  return 'sorgente';
}

const KIND_LABEL: Record<Kind, string> = { testo: 'Testo', avviso: 'Avviso', figura: 'Figura', tabella: 'Tabella', codice: 'Codice', etichetta: 'Etichetta', sorgente: 'Sorgente MyST' };

// ---------------------------------------------------------------------------- editor dei blocchi

interface EditorProps {
  initial: Content;
  pickers: Pickers;
  images: string[];
  onDone(c: Content | null): void;
  onCancel(): void;
}

function Actions({ onDone, onCancel, disabled, hint }: { onDone(): void; onCancel(): void; disabled?: boolean; hint?: string }) {
  return (
    <div className="vis-actions">
      {hint && <span className="vis-hint">{hint}</span>}
      <span className="flex-1" />
      <button type="button" className="ita-btn ita-btn-xs ita-btn-outline" onClick={onCancel}>Annulla</button>
      <button type="button" className="ita-btn ita-btn-xs ita-btn-primary" onClick={onDone} disabled={disabled}>Fatto</button>
    </div>
  );
}

function TextEditor({ initial, pickers, onDone, onCancel }: EditorProps) {
  const nodes = 'nodes' in initial ? initial.nodes : [];
  const doc = useRef<PmNode | null>(null);
  const done = () => onDone(doc.current ? { nodes: docToBlocks(doc.current) } : null);
  return (
    <>
      <RichText doc={blocksToDoc(nodes)} mode="blocchi" pickers={pickers} label="Testo del blocco" autoFocus onChange={(d) => (doc.current = d)} onSubmit={done} />
      <Actions onDone={done} onCancel={onCancel} hint="⌘Invio per finire. Invio crea un nuovo paragrafo." />
    </>
  );
}

function AdmonitionEditor({ initial, pickers, onDone, onCancel }: EditorProps) {
  const n = ('nodes' in initial ? initial.nodes[0] : null)!;
  const titleNode = n.children?.find((c) => c.type === 'admonitionTitle');
  const [kind, setKind] = useState<string>(n.origin?.name === 'admonition' || !n.kind ? 'admonition' : n.kind);
  const title = useRef<PmNode | null>(null);
  const body = useRef<PmNode | null>(null);
  const [hasTitle, setHasTitle] = useState(!!titleNode || kind === 'admonition');
  const done = () => {
    const t = title.current ? docToInline(title.current) : titleNode?.children ?? [];
    const kids = body.current ? docToBlocks(body.current) : (n.children ?? []).filter((c) => c !== titleNode);
    const generic = kind === 'admonition';
    if (generic && !t.length) return alert('Un riquadro con titolo ha bisogno del titolo.');
    const out: MdNode = {
      ...n,
      kind: generic ? undefined : kind,
      children: [...(hasTitle && t.length ? [{ type: 'admonitionTitle', children: t }] : []), ...(kids.length ? kids : [p()])],
      // il titolo ora è nei figli: l'argomento originale non deve tornare
      origin: { ...(n.origin ?? { kind: 'directive' }), name: kind, args: undefined },
    };
    onDone({ nodes: [out] });
  };
  return (
    <div className="vis-form">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="vis-field">
          <span className="vis-label">Tipo</span>
          <select className="ita-select ita-select-sm" value={kind} onChange={(e) => (setKind(e.target.value), e.target.value === 'admonition' && setHasTitle(true))}>
            {ADMONITIONS.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        {kind !== 'admonition' && (
          <label className="flex items-center gap-2 pb-1">
            <input type="checkbox" checked={hasTitle} onChange={(e) => setHasTitle(e.target.checked)} /> Titolo personalizzato
          </label>
        )}
      </div>
      {hasTitle && (
        <div className="vis-field">
          <span className="vis-label">Titolo</span>
          <RichText doc={inlineToDoc(titleNode?.children)} mode="in linea" pickers={pickers} label="Titolo dell'avviso" onChange={(d) => (title.current = d)} onSubmit={done} />
        </div>
      )}
      <div className="vis-field">
        <span className="vis-label">Testo</span>
        <RichText
          doc={blocksToDoc((n.children ?? []).filter((c) => c !== titleNode))}
          mode="blocchi"
          pickers={pickers}
          label="Testo dell'avviso"
          autoFocus
          onChange={(d) => (body.current = d)}
          onSubmit={done}
        />
      </div>
      <Actions onDone={done} onCancel={onCancel} />
    </div>
  );
}

function FigureEditor({ initial, pickers, images, onDone, onCancel }: EditorProps) {
  const n = ('nodes' in initial ? initial.nodes[0] : null)!;
  const img = n.children!.find((k) => k.type === 'image')!;
  const cap = n.children!.find((k) => k.type === 'paragraph');
  const [url, setUrl] = useState<string>(img.url ?? '');
  const [alt, setAlt] = useState<string>(img.alt ?? '');
  const [width, setWidth] = useState<string>(img.width ?? '');
  const [label, setLabel] = useState<string>(n.label ?? '');
  const caption = useRef<PmNode | null>(null);
  const done = () => {
    if (!url.trim()) return alert("Scegli l'immagine.");
    const capNodes = caption.current ? docToInline(caption.current) : cap?.children ?? [];
    const out: MdNode = {
      ...n,
      label: label.trim() || undefined,
      identifier: label.trim() || undefined,
      children: [{ ...img, url: url.trim(), alt: alt.trim(), width: width.trim() || undefined }, ...(capNodes.length ? [{ type: 'paragraph', children: capNodes }] : [])],
    };
    onDone({ nodes: [out] });
  };
  return (
    <div className="vis-form">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="vis-field">
          <span className="vis-label">Immagine</span>
          <input className="ita-input ita-input-sm" list="vis-images" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="images/schema.png" autoFocus />
          {/* i percorsi delle immagini sono relativi alla pagina */}
          <datalist id="vis-images">
            {images.map((i) => (
              <option key={i} value={relativeLink(pickers.path, i)} />
            ))}
          </datalist>
        </label>
        <label className="vis-field">
          <span className="vis-label">Larghezza (facoltativa)</span>
          <input className="ita-input ita-input-sm" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="es. 60% o 400px" />
        </label>
      </div>
      <label className="vis-field">
        <span className="vis-label">Testo alternativo, per chi non vede l'immagine</span>
        <input className="ita-input ita-input-sm" value={alt} onChange={(e) => setAlt(e.target.value)} />
        {!alt.trim() && <span className="vis-warn">Senza testo alternativo l'immagine non è accessibile.</span>}
      </label>
      <div className="vis-field">
        <span className="vis-label">Didascalia</span>
        <RichText doc={inlineToDoc(cap?.children)} mode="in linea" pickers={pickers} label="Didascalia della figura" onChange={(d) => (caption.current = d)} onSubmit={done} />
      </div>
      <label className="vis-field">
        <span className="vis-label">Etichetta (per citarla con un riferimento)</span>
        <input className="ita-input ita-input-sm" value={label} onChange={(e) => setLabel(e.target.value.replace(/\s+/g, '-'))} placeholder="fig-architettura" />
      </label>
      {url && !/^https?:/.test(url) && <img className="vis-figure-preview" src={`/files/${fromPage(pickers.path, url)}`} alt="" />}
      <Actions onDone={done} onCancel={onCancel} />
    </div>
  );
}

/** Tabella: GFM (celle in linea) oppure list-table (un paragrafo per cella). */
function TableEditor({ initial, pickers, onDone, onCancel }: EditorProps) {
  const n = ('nodes' in initial ? initial.nodes[0] : null)!;
  const gfm = n.type === 'table';
  const table = gfm ? n : n.children!.find((k) => k.type === 'table')!;
  const captionNode = gfm ? undefined : n.children!.find((k) => k.type === 'caption');
  const cellInline = (c: MdNode) => (gfm ? c.children ?? [] : c.children?.[0]?.children ?? []);
  const [rows, setRows] = useState<MdNode[][]>(() => (table.children ?? []).map((r) => (r.children ?? []).map((c) => ({ ...c, children: cellInline(c) }))));
  const [header, setHeader] = useState<boolean>(gfm || (table.children?.[0]?.children ?? []).every((c) => c.header));
  const caption = useRef<PmNode | null>(null);
  const edits = useRef(new Map<string, PmNode>());
  const [version, setVersion] = useState(0); // le celle si ricreano quando cambia la forma della tabella
  const cols = Math.max(1, ...rows.map((r) => r.length));

  const current = () =>
    rows.map((r, i) =>
      Array.from({ length: cols }, (_, j) => {
        const c = r[j] ?? { type: 'tableCell', children: [] };
        const d = edits.current.get(`${i}:${j}`);
        return { ...c, children: d ? docToInline(d) : c.children ?? [] };
      }),
    );
  const reshape = (f: (r: MdNode[][]) => MdNode[][]) => {
    const next = f(current());
    edits.current.clear();
    setRows(next);
    setVersion((v) => v + 1);
  };
  const empty = (): MdNode => ({ type: 'tableCell', children: [] });

  const done = () => {
    const grid = current();
    const builtRows = grid.map((r, i) => ({
      type: 'tableRow',
      children: r.map((c) => {
        const { children, ...rest } = c;
        const isHeader = i === 0 && header;
        return { ...rest, header: isHeader || undefined, children: gfm ? children : children?.length ? [{ type: 'paragraph', children }] : [] };
      }),
    }));
    if (gfm) return onDone({ nodes: [{ ...n, children: builtRows }] });
    const capNodes = caption.current ? docToInline(caption.current) : captionNode?.children?.[0]?.children ?? [];
    const kids = [...(capNodes.length ? [{ type: 'caption', children: [{ type: 'paragraph', children: capNodes }] }] : []), { ...table, children: builtRows }];
    onDone({ nodes: [{ ...n, children: kids }] });
  };

  return (
    <div className="vis-form">
      {!gfm && (
        <div className="vis-field">
          <span className="vis-label">Titolo della tabella</span>
          <RichText doc={inlineToDoc(captionNode?.children?.[0]?.children)} mode="in linea" pickers={pickers} label="Titolo della tabella" onChange={(d) => (caption.current = d)} />
        </div>
      )}
      <div className="vis-table-wrap">
        <table className="vis-table" key={version}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i === 0 && header ? 'vis-table-head' : ''}>
                {Array.from({ length: cols }, (_, j) => (
                  <td key={j}>
                    <RichText
                      doc={inlineToDoc(r[j]?.children)}
                      mode="in linea"
                      pickers={pickers}
                      label={`Riga ${i + 1}, colonna ${j + 1}`}
                      onChange={(d) => edits.current.set(`${i}:${j}`, d)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ita-btn ita-btn-xs ita-btn-outline" onClick={() => reshape((g) => [...g, Array.from({ length: cols }, empty)])}>+ Riga</button>
        <button type="button" className="ita-btn ita-btn-xs ita-btn-outline" onClick={() => reshape((g) => g.map((r) => [...r, empty()]))}>+ Colonna</button>
        <button type="button" className="ita-btn ita-btn-xs ita-btn-outline" disabled={rows.length <= (header ? 2 : 1)} onClick={() => reshape((g) => g.slice(0, -1))}>− Ultima riga</button>
        <button type="button" className="ita-btn ita-btn-xs ita-btn-outline" disabled={cols <= 1} onClick={() => reshape((g) => g.map((r) => r.slice(0, cols - 1)))}>− Ultima colonna</button>
        {!gfm && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Prima riga di intestazione
          </label>
        )}
      </div>
      <Actions onDone={done} onCancel={onCancel} hint={gfm ? 'Tabella Markdown: la prima riga è sempre l’intestazione.' : undefined} />
    </div>
  );
}

function CodeEditor({ initial, onDone, onCancel }: EditorProps) {
  const n = ('nodes' in initial ? initial.nodes[0] : null)!;
  const [lang, setLang] = useState<string>(n.lang ?? '');
  const [value, setValue] = useState<string>(n.value ?? '');
  const done = () => onDone({ nodes: [{ ...n, lang: lang.trim() || undefined, value }] });
  return (
    <div className="vis-form">
      <label className="vis-field">
        <span className="vis-label">Linguaggio (facoltativo)</span>
        <input className="ita-input ita-input-sm w-48" value={lang} onChange={(e) => setLang(e.target.value)} placeholder="json, yaml, python…" />
      </label>
      <textarea className="vis-code" value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(24, Math.max(4, value.split('\n').length + 1))} aria-label="Codice" autoFocus spellCheck={false} />
      <Actions onDone={done} onCancel={onCancel} />
    </div>
  );
}

function LabelEditor({ initial, onDone, onCancel }: EditorProps) {
  const n = ('nodes' in initial ? initial.nodes[0] : null)!;
  const [label, setLabel] = useState<string>(n.label ?? '');
  const done = () => (label.trim() ? onDone({ nodes: [{ ...n, label: label.trim(), identifier: label.trim().toLowerCase() }] }) : alert('Scrivi il nome dell’etichetta.'));
  return (
    <div className="vis-form">
      <label className="vis-field">
        <span className="vis-label">Etichetta del blocco che segue (si cita con un riferimento)</span>
        <input className="ita-input ita-input-sm" value={label} onChange={(e) => setLabel(e.target.value.replace(/\s+/g, '-'))} autoFocus onKeyDown={(e) => e.key === 'Enter' && done()} />
      </label>
      <p className="vis-hint">Cambiare il nome rompe i riferimenti che usano quello vecchio: il pannello dei problemi li segnala.</p>
      <Actions onDone={done} onCancel={onCancel} />
    </div>
  );
}

function SourceBlockEditor({ initial, onDone, onCancel }: EditorProps) {
  const [text, setText] = useState('text' in initial ? initial.text : '');
  return (
    <div className="vis-form">
      <textarea className="vis-code" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(30, Math.max(4, text.split('\n').length + 1))} aria-label="Sorgente MyST del blocco" autoFocus spellCheck={false} />
      <Actions onDone={() => onDone({ text })} onCancel={onCancel} hint="Questo blocco si modifica come sorgente MyST: il resto della pagina non cambia." />
    </div>
  );
}

const EDITORS: Record<Kind, (p: EditorProps) => ReactElement> = {
  testo: TextEditor,
  avviso: AdmonitionEditor,
  figura: FigureEditor,
  tabella: TableEditor,
  codice: CodeEditor,
  etichetta: LabelEditor,
  sorgente: SourceBlockEditor,
};

// ---------------------------------------------------------------------------- pagina

interface Props {
  path: string;
  content: string;
  /** nuovo testo della pagina dopo una modifica visuale */
  onContent(text: string): void;
}

type Open = { mode: 'edit'; index: number } | { mode: 'new'; after: number; template: (typeof TEMPLATES)[number] } | null;

export function VisualEditor({ path, content, onContent }: Props) {
  const [data, setData] = useState<BlocksData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>([]);
  const loaded = useRef<string | null>(null);

  const load = useCallback(async (text: string) => {
    try {
      setData(await api.blocks(path, text));
      loaded.current = text;
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);

  useEffect(() => {
    history.current = [];
    setOpen(null);
  }, [path]);
  useEffect(() => {
    if (content !== loaded.current) void load(content);
  }, [content, load]);

  const apply = async (edits: BlockEditRequest[]) => {
    setBusy(true);
    try {
      const r = await api.applyBlocks(path, content, edits);
      if (r.content !== content) {
        history.current.push(content);
        onContent(r.content);
      }
      setOpen(null);
      setMenu(null);
    } catch (e) {
      alert(`Modifica non applicata: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const undo = () => {
    const prev = history.current.pop();
    if (prev !== undefined) onContent(prev);
  };

  if (error) return <div className="vis-empty" role="alert">Editor visuale non disponibile: {error}</div>;
  if (!data) return <div className="vis-empty">Caricamento…</div>;

  const pickers: Pickers = { labels: data.labels, pages: data.pages, path };
  const blocks = data.blocks;

  const finish = (b: BlockData | null, initial: Content) => (c: Content | null) => {
    if (!c) return setOpen(null); // nessuna modifica
    const empty = 'nodes' in c ? !c.nodes.length : !c.text.trim();
    if (b) {
      if (JSON.stringify(c) === JSON.stringify(initial)) return setOpen(null);
      void apply([empty ? { op: 'delete', index: b.index } : { op: 'replace', index: b.index, ...c }]);
    } else if (!empty && open?.mode === 'new') {
      void apply([{ op: 'insert', after: open.after, ...c }]);
    } else setOpen(null);
  };

  const insertMenu = (after: number) =>
    menu === after && (
      <div className="vis-insert" role="menu" aria-label="Inserisci un blocco">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" role="menuitem" className="ita-btn ita-btn-xs ita-btn-outline" onClick={() => (setOpen({ mode: 'new', after, template: t }), setMenu(null))}>
            {t.label}
          </button>
        ))}
        <button type="button" className="ita-btn ita-btn-xs ita-btn-ghost" onClick={() => setMenu(null)} aria-label="Chiudi">×</button>
      </div>
    );
  const newEditor = (after: number) => {
    if (open?.mode !== 'new' || open.after !== after) return null;
    const initial = open.template.content;
    const kind = 'text' in initial ? 'sorgente' : kindOf(initial.nodes);
    const Editor = EDITORS[kind];
    return (
      <div className="vis-block vis-block-open">
        <div className="vis-block-kind">Nuovo blocco: {open.template.label}</div>
        <Editor initial={initial} pickers={pickers} images={data.images} onDone={finish(null, initial)} onCancel={() => setOpen(null)} />
      </div>
    );
  };
  const addButton = (after: number) => (
    <button type="button" className="vis-add" onClick={() => setMenu(menu === after ? null : after)} aria-expanded={menu === after} title="Inserisci un blocco qui">
      + Inserisci
    </button>
  );

  return (
    <div className={`vis${busy ? ' vis-busy' : ''}`}>
      <div className="vis-top">
        <span className="vis-hint">Clic su un blocco per modificarlo. Si riscrivono solo i blocchi modificati.</span>
        <span className="flex-1" />
        <button type="button" className="ita-btn ita-btn-xs ita-btn-outline" onClick={undo} disabled={!history.current.length || busy}>Annulla l'ultima modifica</button>
      </div>
      {addButton(-1)}
      {insertMenu(-1)}
      {newEditor(-1)}
      {!blocks.length && open?.mode !== 'new' && <p className="vis-empty">Pagina vuota: inserisci il primo blocco.</p>}
      {blocks.map((b, i) => {
        const kind = b.editable ? kindOf(b.nodes) : 'sorgente';
        const isOpen = open?.mode === 'edit' && open.index === b.index;
        const initial: Content = kind === 'sorgente' ? { text: b.text } : { nodes: b.nodes };
        const Editor = EDITORS[kind];
        return (
          <div key={`${b.index}:${b.start}`}>
            <div className={`vis-block${isOpen ? ' vis-block-open' : ''}`}>
              <div className="vis-block-bar">
                <span className="vis-block-kind">{KIND_LABEL[kind]}</span>
                <span className="vis-block-lines">righe {b.start}{b.end > b.start ? `–${b.end}` : ''}</span>
                <span className="flex-1" />
                {!isOpen && b.editable && (
                  <>
                    <button type="button" className="vis-tool" disabled={i === 0 || busy} onClick={() => void apply([{ op: 'move', index: b.index, after: i - 2 }])} aria-label="Sposta su">↑</button>
                    <button type="button" className="vis-tool" disabled={i === blocks.length - 1 || busy} onClick={() => void apply([{ op: 'move', index: b.index, after: i + 1 }])} aria-label="Sposta giù">↓</button>
                    <button type="button" className="vis-tool" disabled={busy} onClick={() => confirm('Eliminare questo blocco?') && void apply([{ op: 'delete', index: b.index }])} aria-label="Elimina">✕</button>
                  </>
                )}
              </div>
              {isOpen ? (
                <Editor initial={initial} pickers={pickers} images={data.images} onDone={finish(b, initial)} onCancel={() => setOpen(null)} />
              ) : (
                <div
                  className="vis-view di-prose"
                  role="button"
                  tabIndex={0}
                  aria-label={`Modifica il blocco: ${KIND_LABEL[kind]}, righe ${b.start}-${b.end}`}
                  aria-disabled={!b.editable || undefined}
                  onClick={(e) => {
                    e.preventDefault(); // i link dell'anteprima non si seguono
                    if (b.editable) setOpen({ mode: 'edit', index: b.index });
                  }}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), b.editable && setOpen({ mode: 'edit', index: b.index }))}
                  dangerouslySetInnerHTML={{
                    __html:
                      kind === 'etichetta'
                        ? `<p class="vis-target">Etichetta <code>${escapeHtml(String(b.nodes[0]?.label ?? ''))}</code> del blocco che segue</p>`
                        : b.html || `<pre class="vis-raw">${escapeHtml(b.text)}</pre>`,
                  }}
                />
              )}
              {!b.editable && <p className="vis-warn">Le righe di questo blocco si sovrappongono a un altro: si modifica nel sorgente.</p>}
            </div>
            {addButton(b.index)}
            {insertMenu(b.index)}
            {newEditor(b.index)}
          </div>
        );
      })}
      {data.problems.length > 0 && (
        <ul className="vis-problems" aria-label="Problemi di questa pagina">
          {data.problems.map((pr, k) => (
            <li key={k}>{pr.level === 'errore' ? '✖' : '⚠'} {pr.line ? `riga ${pr.line}: ` : ''}{pr.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
