/**
 * Componenti comuni: rotte nel frammento (#/documenti/3), stati, date,
 * caricamento ed errori, finestra per la motivazione degli interventi.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ApiError, CheckStatus } from './api';

// ---------------------------------------------------------------- rotte

/** Percorso nel frammento: "#/documenti/3?stato=x" → { path: "/documenti/3", query }. */
export function useRoute() {
  const read = () => {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    return { path: path || '/', query: new URLSearchParams(qs ?? '') };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      const next = read();
      // i filtri cambiano solo la query: si torna in cima solo cambiando pagina
      setRoute((prev) => {
        if (prev.path !== next.path) window.scrollTo(0, 0);
        return next;
      });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const href = (path: string) => `#${path}`;

// ---------------------------------------------------------------- stati e date

const BUILD: Record<string, [string, string]> = {
  ok: ['riuscita', 'ita-badge-success'],
  failed: ['fallita', 'ita-badge-danger'],
  running: ['in corso', 'ita-badge-primary'],
  queued: ['in coda', 'ita-badge-secondary'],
  done: ['fatto', 'ita-badge-success'],
};

export function BuildStatus({ status }: { status: string | null }) {
  if (!status) return <span className="da-muted">—</span>;
  const [label, cls] = BUILD[status] ?? [status, 'ita-badge-secondary'];
  return <span className={`ita-badge ${cls}`}>{label}</span>;
}

const CHECK: Record<CheckStatus, string> = {
  ok: 'ita-badge-success',
  avviso: 'ita-badge-warning',
  errore: 'ita-badge-danger',
  'non configurato': 'ita-badge-secondary',
};

export function CheckBadge({ status }: { status: CheckStatus }) {
  return <span className={`ita-badge ${CHECK[status]}`}>{status}</span>;
}

export function Badge({ children, tone = 'secondary' }: { children: ReactNode; tone?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' }) {
  return <span className={`ita-badge ita-badge-${tone}`}>{children}</span>;
}

const fmt = new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' });

export function relative(d: string | null): string {
  if (!d) return 'mai';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'adesso';
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86_400) return `${Math.round(s / 3600)} ore fa`;
  return `${Math.round(s / 86_400)} giorni fa`;
}

export function When({ at }: { at: string | null }) {
  if (!at) return <span className="da-muted">—</span>;
  return (
    <time dateTime={at} title={fmt.format(new Date(at))}>
      {relative(at)}
    </time>
  );
}

export function duration(from: string | null, to: string | null): string {
  if (!from || !to) return '—';
  const s = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// ---------------------------------------------------------------- caricamento ed errori

export function Loading() {
  return (
    <p role="status" className="da-muted">
      Caricamento…
    </p>
  );
}

export function ErrorBox({ error }: { error: ApiError | Error }) {
  return (
    <div className="ita-alert ita-alert-danger" role="alert">
      <p>{error.message}</p>
    </div>
  );
}

/** Esito di un'azione, annunciato ai lettori di schermo. */
export function Notice({ message, onClose }: { message: { text: string; tone: 'success' | 'danger' } | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className={`ita-alert ita-alert-${message.tone} mb-4`} role={message.tone === 'danger' ? 'alert' : 'status'}>
      <p>{message.text}</p>
      <button type="button" className="ita-alert-close" aria-label="Chiudi il messaggio" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

export function Page({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          {subtitle && <p className="da-muted mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="da-actions">{actions}</div>}
      </div>
      {children}
    </>
  );
}

// ---------------------------------------------------------------- motivazione degli interventi

export interface ReasonRequest {
  title: string;
  description: ReactNode;
  confirm: string;
  danger?: boolean;
  run: (reason: string) => Promise<void>;
}

/** Ogni intervento sulle versioni richiede una motivazione, che finisce nel registro. */
export function ReasonDialog({ request, onClose }: { request: ReasonRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // durante l'animazione di chiusura resta il contenuto dell'ultima richiesta
  const [shown, setShown] = useState<ReasonRequest | null>(request);
  if (request && request !== shown) setShown(request);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (request && !d.open) {
      setReason('');
      setError(null);
      d.showModal();
    } else if (!request && d.open) d.close();
  }, [request]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await request.run(reason.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="modal ita-modal" aria-labelledby={`${id}-title`} onClose={onClose}>
      <form className="modal-box" onSubmit={submit}>
        <button type="button" className="ita-modal-close" aria-label="Chiudi" onClick={onClose}>
          ×
        </button>
        <h2 id={`${id}-title`} className="ita-modal-title">
          {shown?.title}
        </h2>
        <div className="ita-modal-body">
          <div className="mb-4">{shown?.description}</div>
          <div className="ita-field">
            <label className="ita-label" htmlFor={`${id}-reason`}>
              Motivazione <span className="da-muted">(obbligatoria, resta nel registro)</span>
            </label>
            <textarea id={`${id}-reason`} className="ita-textarea w-full" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && (
            <p className="text-error mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-action">
          <button type="button" className="ita-btn ita-btn-outline" onClick={onClose}>
            Annulla
          </button>
          <button type="submit" className={`ita-btn ${shown?.danger ? 'ita-btn-danger' : 'ita-btn-primary'}`} disabled={busy || !reason.trim()}>
            {busy ? 'In corso…' : shown?.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
