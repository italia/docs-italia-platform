/**
 * Docs Italia Studio — prima bozza dell'editor locale.
 *
 * Sinistra: struttura del documento (toc.json). Centro: sorgente MyST.
 * Destra: anteprima con lo stesso renderer del sito, problemi, Git, metadati, build.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type GitData, type Problem, type ProjectData, type TocEntry } from './api';
import { SourceEditor, type SourceEditorHandle } from './SourceEditor';
import { VisualEditor } from './visual/VisualEditor';

type Tab = 'anteprima' | 'problemi' | 'git' | 'metadati' | 'genera';
type SaveState = 'salvato' | 'modificato' | 'bozza' | 'salvataggio' | 'conflitto';
type Mode = 'sorgente' | 'visuale';

const MODE_KEY = 'docs-italia-studio-mode';
const savedMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'visuale' ? 'visuale' : 'sorgente';
  } catch {
    return 'sorgente';
  }
};

function useDebounced<T extends unknown[]>(fn: (...a: T) => void, ms: number) {
  const t = useRef<number | undefined>(undefined);
  const f = useRef(fn);
  f.current = fn;
  return useCallback((...a: T) => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => f.current(...a), ms);
  }, [ms]);
}

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '');

export function App() {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [baseHash, setBaseHash] = useState('');
  const [content, setContent] = useState('');
  const [state, setState] = useState<SaveState>('salvato');
  const [draftAt, setDraftAt] = useState<string | undefined>();
  const [preview, setPreview] = useState('');
  const [pageProblems, setPageProblems] = useState<Problem[]>([]);
  const [allProblems, setAllProblems] = useState<Problem[]>([]);
  const [tab, setTab] = useState<Tab>('anteprima');
  const [mode, setModeState] = useState<Mode>(savedMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };
  const [notice, setNotice] = useState<string | null>(null);
  const editor = useRef<SourceEditorHandle>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<string | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const reloadProject = useCallback(async () => {
    try {
      const p = await api.project();
      setProject(p);
      setAllProblems(p.problems);
      setError(null);
      return p;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  const open = useCallback(async (file: string, line?: number) => {
    const f = await api.file(file);
    setPath(file);
    setBaseHash(f.hash);
    const text = f.draft ? f.draft.content : f.content;
    setContent(text);
    editor.current?.setContent(text);
    setDraftAt(f.draft?.updatedAt);
    setState(f.draft ? (f.draft.conflict ? 'conflitto' : 'bozza') : 'salvato');
    if (f.draft?.conflict) setNotice('Il file è cambiato sul disco dopo l’ultima bozza: controlla prima di salvare.');
    renderPreview(file, text);
    if (line) setTimeout(() => editor.current?.goToLine(line), 0);
  }, []);

  useEffect(() => {
    reloadProject().then((p) => p && open(p.toc.root));
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'file') {
        void reloadProject();
        setNotice((n) => n ?? `File modificato fuori dall’editor: ${ev.file}`);
      }
    };
    return () => es.close();
  }, []);

  const renderPreview = useDebounced(async (file: string, text: string) => {
    try {
      const r = await api.preview(file, text);
      setPreview(r.html);
      setPageProblems(r.problems);
    } catch (e) {
      setPreview(`<p>Anteprima non disponibile: ${(e as Error).message}</p>`);
    }
  }, 250);

  const saveDraft = useDebounced(async (file: string, text: string, hash: string) => {
    await api.saveDraft(file, text, hash);
    setDraftAt(new Date().toISOString());
    setState((s) => (s === 'modificato' ? 'bozza' : s));
    // i controlli dell'intero documento tengono conto delle bozze
    setAllProblems(await api.check());
  }, 800);

  const onChange = (text: string) => {
    if (!path) return;
    setContent(text);
    setState('modificato');
    renderPreview(path, text);
    saveDraft(path, text, baseHash);
  };
  // modifica dall'editor visuale: il sorgente si aggiorna senza rimandare l'evento
  const onVisualContent = (text: string) => {
    editor.current?.setContent(text);
    onChange(text);
  };

  const save = async (force = false) => {
    if (!path) return;
    setState('salvataggio');
    try {
      const r = await api.save(path, contentRef.current, baseHash, force);
      setBaseHash(r.hash);
      setState('salvato');
      setDraftAt(undefined);
      setNotice(null);
      await reloadProject();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setState('conflitto');
        if (confirm(`${e.message}. Vuoi sovrascriverlo con la tua versione?`)) return save(true);
      } else {
        setState('modificato');
        setNotice(`Salvataggio non riuscito: ${(e as Error).message}`);
      }
    }
  };

  const discardDraft = async () => {
    if (!path || !confirm('Scartare la bozza e tornare al file salvato?')) return;
    await api.dropDraft(path);
    await open(path);
  };

  // link interni dell'anteprima: "#di:<pagina>[:<ancora>]"
  const onPreviewClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#di:')) {
      e.preventDefault();
      const [, slug, anchor] = href.split(':');
      const page = project?.pages.find((p) => p.slug === slug);
      if (!page) return;
      pendingAnchor.current = anchor ?? null;
      if (page.file !== path) void open(page.file);
      else scrollPreview(anchor);
    } else if (/^https?:/.test(href)) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener');
    }
  };
  const scrollPreview = (anchor?: string | null) => {
    if (!anchor) return previewBox.current?.scrollTo({ top: 0 });
    previewBox.current?.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: 'start' });
  };
  useEffect(() => {
    if (pendingAnchor.current !== null) {
      scrollPreview(pendingAnchor.current);
      pendingAnchor.current = null;
    }
  }, [preview]);

  if (error && !project) {
    return (
      <main className="p-8">
        <h1>Docs Italia Studio</h1>
        <p className="mt-4">Impossibile caricare il documento: {error}</p>
      </main>
    );
  }
  if (!project) return <main className="p-8">Caricamento…</main>;

  const current = project.pages.find((p) => p.file === path);
  const stateLabel: Record<SaveState, string> = {
    salvato: 'Salvato nel file',
    modificato: 'Modifiche in corso…',
    bozza: `Bozza salvata${draftAt ? ` alle ${time(draftAt)}` : ''} (non ancora nel file)`,
    salvataggio: 'Salvataggio…',
    conflitto: 'Conflitto con il file sul disco',
  };
  const errors = allProblems.filter((p) => p.level === 'errore').length;

  return (
    <div className="studio">
      <header className="studio-top">
        <div className="flex items-center gap-3 min-w-0">
          <strong className="whitespace-nowrap">Docs Italia Studio</strong>
          <span className="truncate opacity-90">{project.settings.name}</span>
        </div>
        <GitBadge />
      </header>

      <nav className="studio-side" aria-label="Struttura del documento">
        <Structure project={project} current={path} onOpen={(f) => void open(f)} onChanged={reloadProject} />
      </nav>

      <section className="studio-editor" aria-label="Sorgente">
        <div className="studio-bar">
          <span className="truncate font-semibold">{current ? `${current.number ? current.number + '. ' : ''}${current.title}` : path}</span>
          <span className={`studio-state studio-state-${state}`} role="status">{stateLabel[state]}</span>
          <span className="flex-1" />
          {(state === 'bozza' || state === 'conflitto') && (
            <button className="ita-btn ita-btn-xs ita-btn-outline" onClick={discardDraft}>Scarta bozza</button>
          )}
          <button className="ita-btn ita-btn-xs ita-btn-primary" onClick={() => void save()} disabled={state === 'salvato' || state === 'salvataggio'}>
            Salva <kbd className="opacity-70 ml-1">⌘S</kbd>
          </button>
        </div>
        <div className="studio-path">
          <code className="truncate">{path}</code>
          <span className="flex-1" />
          <div role="radiogroup" aria-label="Modo di modifica" className="studio-modes">
            {(['sorgente', 'visuale'] as Mode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'sorgente' ? 'Sorgente' : 'Visuale'}
              </button>
            ))}
          </div>
        </div>
        {notice && (
          <div className="studio-notice" role="alert">
            <span>{notice}</span>
            <button className="ita-btn ita-btn-xs ita-btn-ghost" onClick={() => setNotice(null)} aria-label="Chiudi avviso">×</button>
          </div>
        )}
        <div className="studio-source" hidden={mode === 'visuale'}>
          <SourceEditor ref={editor} label="Sorgente MyST della pagina" onChange={onChange} onSave={() => void save()} />
        </div>
        {mode === 'visuale' && path && <VisualEditor path={path} content={content} onContent={onVisualContent} />}
        {mode === 'sorgente' && pageProblems.length > 0 && (
          <ul className="studio-page-problems" aria-label="Problemi di questa pagina">
            {pageProblems.map((p, i) => (
              <li key={i}>
                <button onClick={() => p.line && editor.current?.goToLine(p.line)}>
                  {p.level === 'errore' ? '✖' : '⚠'} {p.line ? `riga ${p.line}: ` : ''}{p.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="studio-right" aria-label="Pannelli">
        <div role="tablist" className="studio-tabs">
          {(['anteprima', 'problemi', 'git', 'metadati', 'genera'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'problemi' ? `Problemi${allProblems.length ? ` (${allProblems.length})` : ''}` : t[0].toUpperCase() + t.slice(1)}
              {t === 'problemi' && errors > 0 && <span className="studio-dot" aria-label={`${errors} errori`} />}
            </button>
          ))}
        </div>
        <div className="studio-panel" ref={previewBox}>
          {tab === 'anteprima' && <div onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: preview }} />}
          {tab === 'problemi' && <ProblemsPanel problems={allProblems} onOpen={(f, l) => void open(f, l)} onRefresh={async () => setAllProblems(await api.check())} />}
          {tab === 'git' && <GitPanel />}
          {tab === 'metadati' && <SettingsPanel project={project} onSaved={reloadProject} />}
          {tab === 'genera' && <BuildPanel />}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Structure({ project, current, onOpen, onChanged }: { project: ProjectData; current: string | null; onOpen(f: string): void; onChanged(): void }) {
  const [title, setTitle] = useState('');
  const inToc = new Set(project.pages.map((p) => p.file));
  const others = project.files.filter((f) => !inToc.has(f));
  const hidden = project.pages.filter((p) => p.hidden);
  const drafts = new Set(project.drafts);

  const move = async (index: number, delta: number) => {
    const chapters: TocEntry[] = [...project.toc.chapters];
    const j = index + delta;
    if (j < 0 || j >= chapters.length) return;
    [chapters[index], chapters[j]] = [chapters[j], chapters[index]];
    await api.saveToc(chapters);
    onChanged();
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const r = await api.newChapter(title);
    setTitle('');
    await onChanged();
    onOpen(r.file);
  };
  const chapterIndex = (file: string) => project.toc.chapters.findIndex((c) => c.file === file);

  return (
    <>
      <p className="studio-caption">{project.toc.caption ?? 'Indice'}</p>
      <ol className="studio-toc">
        {project.pages.filter((p) => !p.hidden).map((p) => {
          const ci = chapterIndex(p.file);
          return (
            <li key={p.file} style={{ paddingLeft: `${p.depth * 0.75}rem` }}>
              <button className="studio-toc-link" aria-current={p.file === current ? 'page' : undefined} onClick={() => onOpen(p.file)}>
                {p.number && <span className="opacity-60 mr-1">{p.number}</span>}
                {p.title || p.file}
                {drafts.has(p.file) && <span className="studio-draft" title="Bozza non salvata"> •</span>}
              </button>
              {ci >= 0 && (
                <span className="studio-move">
                  <button aria-label={`Sposta su ${p.title}`} disabled={ci === 0} onClick={() => move(ci, -1)}>↑</button>
                  <button aria-label={`Sposta giù ${p.title}`} disabled={ci === project.toc.chapters.length - 1} onClick={() => move(ci, 1)}>↓</button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <form onSubmit={add} className="studio-new">
        <label htmlFor="nuovo-capitolo" className="studio-caption">Nuovo capitolo</label>
        <div className="flex gap-2">
          <input id="nuovo-capitolo" className="ita-input ita-input-sm flex-1 min-w-0" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titolo" />
          <button className="ita-btn ita-btn-xs ita-btn-primary">Aggiungi</button>
        </div>
      </form>
      {hidden.length > 0 && (
        <>
          <p className="studio-caption mt-6">Pagine nascoste</p>
          <ul className="studio-toc">
            {hidden.map((p) => (
              <li key={p.file}><button className="studio-toc-link" title="Pubblicata, ma fuori dall’indice (hidden in toc.json)" aria-current={p.file === current ? 'page' : undefined} onClick={() => onOpen(p.file)}>{p.title || p.file}</button></li>
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <p className="studio-caption mt-6">Non pubblicati</p>
          <ul className="studio-toc">
            {others.map((f) => (
              <li key={f}><button className="studio-toc-link" aria-current={f === current ? 'page' : undefined} onClick={() => onOpen(f)}>{f}</button></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function ProblemsPanel({ problems, onOpen, onRefresh }: { problems: Problem[]; onOpen(f: string, line?: number): void; onRefresh(): void }) {
  return (
    <div className="studio-pad">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg">Controlli del documento</h2>
        <button className="ita-btn ita-btn-xs ita-btn-outline" onClick={onRefresh}>Ricontrolla</button>
      </div>
      <p className="text-sm mb-3">Metadati, indice, link, ancore, immagini, testo alternativo, struttura dei titoli. Le bozze non salvate sono incluse.</p>
      {problems.length === 0 ? <p>Nessun problema.</p> : (
        <ul className="studio-problems">
          {problems.map((p, i) => (
            <li key={i}>
              <button onClick={() => p.file.endsWith('.md') && onOpen(p.file, p.line)}>
                <span className={p.level === 'errore' ? 'text-error' : 'text-warning'}>{p.level === 'errore' ? '✖' : '⚠'}</span>{' '}
                <code>{p.file}{p.line ? `:${p.line}` : ''}</code> {p.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GitBadge() {
  const [g, setG] = useState<GitData | null>(null);
  useEffect(() => {
    const load = () => api.git().then(setG).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (!g?.info.isRepo) return <span className="ita-badge">Git disattivato</span>;
  return (
    <span className="flex items-center gap-2 text-sm whitespace-nowrap">
      <span className="ita-badge ita-badge-inverse">branch: {g.branch}</span>
      {g.changes.length > 0 && <span>{g.changes.length} file modificati</span>}
    </span>
  );
}

function GitPanel() {
  const [g, setG] = useState<GitData | null>(null);
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => {
    const data = await api.git();
    setG(data);
    setDiff((await api.diff()).diff);
  };
  useEffect(() => void load(), []);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e) {
      setMsg(`Errore: ${(e as Error).message}`);
    }
  };
  if (!g) return <p className="studio-pad">Caricamento…</p>;
  if (!g.info.isRepo)
    return (
      <p className="studio-pad">
        {g.info.outerRepo
          ? `La cartella del documento è dentro un altro repository (${g.info.outerRepo}): per sicurezza le operazioni Git sono disattivate. Esegui "git init" nella cartella del documento per provarle.`
          : 'La cartella del documento non è un repository Git: esegui "git init" per usare branch e commit.'}
      </p>
    );
  return (
    <div className="studio-pad space-y-6">
      <p className="text-sm">Solo operazioni locali: lo studio non fa mai <code>push</code>. La pubblicazione passa da una pull request.</p>
      {msg && <p role="status" className="studio-notice">{msg}</p>}
      <div>
        <h2 className="text-lg mb-2">Branch</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <label htmlFor="branch" className="sr-only">Branch attivo</label>
          <select id="branch" className="ita-select ita-select-sm" value={g.branch} onChange={(e) => act(() => api.branch(e.target.value, false), `Passato al branch ${e.target.value}`)}>
            {g.branches.map((b) => <option key={b}>{b}</option>)}
          </select>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => api.branch(newBranch, true), `Creato il branch ${newBranch}`).then(() => setNewBranch('')); }}>
            <label htmlFor="nuovo-branch" className="sr-only">Nuovo branch</label>
            <input id="nuovo-branch" className="ita-input ita-input-sm" placeholder="nuovo-branch" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
            <button className="ita-btn ita-btn-xs ita-btn-outline" disabled={!newBranch}>Crea e passa</button>
          </form>
        </div>
      </div>
      <div>
        <h2 className="text-lg mb-2">Modifiche ({g.changes.length})</h2>
        {g.changes.length === 0 ? <p>Nessuna modifica rispetto all’ultimo commit.</p> : (
          <>
            <ul className="text-sm mb-3">{g.changes.map((c) => <li key={c.path}><code>{c.status}</code> {c.path}</li>)}</ul>
            <pre className="studio-diff">{diff.split('\n').map((l, i) => <span key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : ''}>{l}{'\n'}</span>)}</pre>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => api.commit(message), 'Commit creato').then(() => setMessage('')); }}>
              <label htmlFor="commit" className="sr-only">Messaggio di commit</label>
              <input id="commit" className="ita-input ita-input-sm flex-1" placeholder="Descrivi la modifica" value={message} onChange={(e) => setMessage(e.target.value)} />
              <button className="ita-btn ita-btn-xs ita-btn-primary" disabled={!message.trim()}>Crea commit</button>
            </form>
            <p className="text-sm mt-2">Le bozze non salvate non entrano nel commit: salva prima i file.</p>
          </>
        )}
      </div>
      <div>
        <h2 className="text-lg mb-2">Ultimi commit</h2>
        <ul className="text-sm space-y-1">{g.log.map((c) => <li key={c.commit}><code>{c.commit.slice(0, 7)}</code> {c.subject} <span className="opacity-60">— {c.author}, {new Date(c.date).toLocaleString('it-IT')}</span></li>)}</ul>
      </div>
    </div>
  );
}

function SettingsPanel({ project, onSaved }: { project: ProjectData; onSaved(): void }) {
  const [name, setName] = useState(project.settings.name);
  const [description, setDescription] = useState(project.settings.description);
  const [tags, setTags] = useState(project.settings.tags.join(', '));
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.saveSettings({ name, description, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      setMsg('Salvato in document_settings.yml (commenti e campi non mostrati qui restano invariati).');
      onSaved();
    } catch (err) {
      setMsg(`Errore: ${(err as Error).message}`);
    }
  };
  return (
    <form className="studio-pad space-y-4" onSubmit={submit}>
      <h2 className="text-lg">Metadati del documento</h2>
      {msg && <p role="status" className="studio-notice">{msg}</p>}
      <div className="ita-field"><label htmlFor="m-name" className="ita-label">Titolo</label><input id="m-name" className="ita-input w-full" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="ita-field"><label htmlFor="m-desc" className="ita-label">Descrizione</label><textarea id="m-desc" className="ita-textarea w-full" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="ita-field"><label htmlFor="m-tags" className="ita-label">Tag (separati da virgola)</label><input id="m-tags" className="ita-input w-full" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      <button className="ita-btn ita-btn-primary">Salva metadati</button>
    </form>
  );
}

function BuildPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.build>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.build());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const total = useMemo(() => (result ? Object.values(result.timings).reduce((a, b) => a + b, 0) : 0), [result]);
  return (
    <div className="studio-pad space-y-4">
      <h2 className="text-lg">Genera sito, PDF ed EPUB</h2>
      <p className="text-sm">Usa i file salvati, non le bozze. Il risultato è in <code>dist/</code>.</p>
      <button className="ita-btn ita-btn-primary" onClick={run} disabled={busy}>{busy ? 'Generazione in corso…' : 'Genera tutto'}</button>
      {err && <p className="studio-notice">Errore: {err}</p>}
      {result && (
        <>
          <ul className="space-y-1">
            <li><a className="ita-link" href="/sito/index.html" target="_blank">Sito a capitoli</a> · <a className="ita-link" href="/sito/pagina-singola.html" target="_blank">pagina singola</a></li>
            {['pdf', 'epub', 'zip'].filter((k) => result.outputs[k]).map((k) => (
              <li key={k}><a className="ita-link" href={`/sito/downloads/${result.outputs[k].split('/').pop()}`} target="_blank">{k.toUpperCase()}</a></li>
            ))}
            <li>Pacchetto per la piattaforma: <code>{result.outputs.bundle}</code></li>
          </ul>
          <p className="text-sm">Tempi: {Object.entries(result.timings).map(([k, v]) => `${k} ${v} ms`).join(' · ')} · totale {total} ms</p>
          {result.problems.length > 0 && <p className="text-sm">{result.problems.length} problemi: vedi la scheda Problemi.</p>}
        </>
      )}
    </div>
  );
}
