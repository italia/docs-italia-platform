import { useState, type FormEvent } from 'react';
import { api, token, useApi, type Whoami } from './api';
import { Audit } from './pages/Audit';
import { BuildDetailPage, Builds } from './pages/Builds';
import { Checks } from './pages/Checks';
import { DocumentPage } from './pages/Document';
import { Documents } from './pages/Documents';
import { Jobs } from './pages/Jobs';
import { Overview } from './pages/Overview';
import { Publishers } from './pages/Publishers';
import { Webhooks } from './pages/Webhooks';
import { ErrorBox, href, Loading, useRoute } from './ui';

const NAV: Array<[string, string]> = [
  ['/', 'Panoramica'],
  ['/organizzazioni', 'Organizzazioni'],
  ['/documenti', 'Documenti'],
  ['/build', 'Build'],
  ['/coda', 'Coda dei lavori'],
  ['/webhook', 'Webhook'],
  ['/collegamenti', 'Stato dei collegamenti'],
  ['/registro', 'Registro'],
];

function Route({ path, query, me }: { path: string; query: URLSearchParams; me: Whoami }) {
  let m: RegExpMatchArray | null;
  if (path === '/') return <Overview />;
  if (path === '/organizzazioni') return <Publishers />;
  if (path === '/documenti') return <Documents query={query} />;
  if ((m = path.match(/^\/documenti\/(\d+)$/))) return <DocumentPage id={Number(m[1])} me={me} />;
  if (path === '/build') return <Builds query={query} />;
  if ((m = path.match(/^\/build\/(\d+)$/))) return <BuildDetailPage id={Number(m[1])} />;
  if (path === '/coda') return <Jobs query={query} />;
  if (path === '/webhook') return <Webhooks />;
  if (path === '/collegamenti') return <Checks />;
  if (path === '/registro') return <Audit />;
  return (
    <>
      <h1 className="text-3xl font-bold mb-4">Pagina non trovata</h1>
      <p>
        <a className="ita-link" href={href('/')}>
          Torna alla panoramica
        </a>
      </p>
    </>
  );
}

/** Il token di amministrazione (script, emergenze): resta solo in questa scheda del browser. */
function TokenForm({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    token.set(value.trim());
    onDone();
  };
  return (
    <form onSubmit={submit} className="ita-field">
      <label className="ita-label" htmlFor="token">
        Token di amministrazione
      </label>
      <input id="token" type="password" autoComplete="off" className="ita-input w-full mb-4" required value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="ita-btn ita-btn-outline ita-btn-primary" type="submit">
        Entra con il token
      </button>
    </form>
  );
}

/** Accesso con magic link: si inserisce l'email, arriva un link. */
function Login({ onDone }: { onDone: () => void }) {
  const status = useApi<{ open: boolean; magicLink: boolean }>('/auth/status');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<{ sending?: boolean; message?: string; error?: Error }>({});
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ sending: true });
    try {
      const r = await api<{ message: string }>('/auth/request', { method: 'POST', body: { email } });
      setState({ message: r.message });
    } catch (err) {
      setState({ error: err as Error });
    }
  };
  return (
    <main className="max-w-xl mx-auto p-8" id="main">
      <h1 className="text-3xl font-bold mb-4">Docs Italia — Amministrazione</h1>
      {status.data?.magicLink ? (
        state.message ? (
          <div className="ita-callout ita-callout-success mb-6" role="status">
            <div className="ita-callout-body">
              <p>{state.message}</p>
              <p>Il link vale una volta sola e per pochi minuti. Puoi chiudere questa pagina.</p>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="ita-field mb-8">
            <label className="ita-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="ita-input w-full mb-4"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {state.error && <ErrorBox error={state.error} />}
            <button className="ita-btn ita-btn-primary mt-2" type="submit" disabled={state.sending}>
              {state.sending ? 'Invio…' : 'Ricevi il link per entrare'}
            </button>
          </form>
        )
      ) : status.data ? (
        <div className="ita-callout ita-callout-warning mb-6">
          <div className="ita-callout-body">
            <p>
              L'accesso con email non è configurato su questa istanza: servono <code>DASHBOARD_ADMIN_EMAILS</code> e <code>SMTP_URL</code>. Si può entrare con il
              token di amministrazione.
            </p>
          </div>
        </div>
      ) : (
        <Loading />
      )}
      <details className="mt-6" open={status.data ? !status.data.magicLink : false}>
        <summary className="cursor-pointer mb-4">Accesso con il token di amministrazione</summary>
        <TokenForm onDone={onDone} />
      </details>
    </main>
  );
}

/** Torna alla panoramica sostituendo l'indirizzo (il token non resta nella cronologia). */
function leaveAccessPage() {
  history.replaceState(null, '', `${location.pathname}#/`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * Pagina del magic link. Il token si consuma solo premendo "Accedi": i filtri
 * della posta che aprono i link per controllarli non lo usano al posto nostro.
 */
function Access({ query, onDone }: { query: URLSearchParams; onDone: () => void }) {
  const [state, setState] = useState<{ busy?: boolean; error?: Error }>({});
  const t = query.get('token') ?? '';
  const enter = async () => {
    setState({ busy: true });
    try {
      await api('/auth/session', { method: 'POST', body: { token: t } });
      token.clear();
      // il token non deve restare nella barra degli indirizzi né nella cronologia
      leaveAccessPage();
      onDone();
    } catch (err) {
      setState({ error: err as Error });
    }
  };
  return (
    <main className="max-w-xl mx-auto p-8" id="main">
      <h1 className="text-3xl font-bold mb-4">Docs Italia — Amministrazione</h1>
      {state.error ? (
        <>
          <ErrorBox error={state.error} />
          <p className="mt-4">
            <a
              className="ita-link"
              href={href('/')}
              onClick={(e) => {
                e.preventDefault();
                leaveAccessPage();
              }}
            >
              Chiedi un nuovo link
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="mb-6">Premi il pulsante per entrare nella dashboard. La sessione dura alcune ore; per chiuderla prima usa «Esci».</p>
          <button type="button" className="ita-btn ita-btn-primary" onClick={enter} disabled={state.busy || !t}>
            {state.busy ? 'Accesso…' : 'Accedi'}
          </button>
        </>
      )}
    </main>
  );
}

export function App() {
  const { path, query } = useRoute();
  const me = useApi<Whoami>('/whoami');

  if (path === '/accesso') return <Access query={query} onDone={me.reload} />;
  if (me.loading && !me.data) return <Loading />;
  if (me.error?.status === 401) return <Login onDone={me.reload} />;
  if (me.error || !me.data) return <main className="p-8">{me.error ? <ErrorBox error={me.error} /> : null}</main>;

  const section = '/' + (path.split('/')[1] ?? '');
  return (
    <div className="da-shell">
      <header className="da-top">
        <a href={href('/')} className="text-lg font-bold">
          Docs Italia · Amministrazione
        </a>
        <div className="flex items-center gap-4 text-sm">
          <span>{me.data.actor}</span>
          <a href={me.data.siteUrl} className="underline">
            Sito pubblico
          </a>
          {!me.data.open && (
            <button
              type="button"
              className="ita-btn ita-btn-xs ita-btn-inverse"
              onClick={async () => {
                token.clear();
                if (me.data?.via === 'session') await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
                me.reload();
              }}
            >
              Esci
            </button>
          )}
        </div>
      </header>
      <div className="da-notice">
        {me.data.open && (
          <div className="ita-alert ita-alert-warning rounded-none" role="note">
            <p>
              <strong>Accesso senza autenticazione</strong> (<code>DASHBOARD_OPEN=1</code>): la dashboard risponde solo su indirizzo locale. Gli interventi sono
              registrati come «{me.data.actor}».
            </p>
          </div>
        )}
      </div>
      <nav className="da-nav" aria-label="Sezioni">
        <ul>
          {NAV.map(([to, label]) => (
            <li key={to}>
              <a href={href(to)} aria-current={section === to || (to !== '/' && path.startsWith(to + '/')) ? 'page' : undefined}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main className="da-main" id="main">
        <Route path={path} query={query} me={me.data} />
      </main>
    </div>
  );
}
