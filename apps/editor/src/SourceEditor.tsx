/** Editor del sorgente MyST (CodeMirror 6). */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';

export interface SourceEditorHandle {
  setContent(text: string): void;
  goToLine(line: number): void;
  focus(): void;
}

interface Props {
  onChange(text: string): void;
  onSave(): void;
  label: string;
}

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(function SourceEditor({ onChange, onSave, label }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const silent = useRef(false);
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (handlers.current.onSave(), true) }]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !silent.current) handlers.current.onChange(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ 'aria-label': label }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // creato una sola volta: il contenuto cambia con setContent, non ricreando l'editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    setContent(text) {
      const v = view.current!;
      silent.current = true;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: { anchor: 0 } });
      silent.current = false;
    },
    goToLine(line) {
      const v = view.current!;
      const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
      v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      v.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  return <div ref={host} className="studio-cm" />;
});
