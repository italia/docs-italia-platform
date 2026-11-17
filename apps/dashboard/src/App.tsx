import { useState, type FormEvent } from 'react';
import { token, useApi, type Whoami } from './api';
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

/** Senza DASHBOARD_OPEN=1 il server chiede il token di amministrazione. */
function TokenForm({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    token.set(value.trim());
    onDone();
  };
  return (
    <main className="max-w-xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-4">Docs Italia — Amministrazione</h1>
      <div className="ita-callout ita-callout-warning mb-6">
        <div className="ita-callout-body">
          <p>
            L'accesso con magic link non è ancora disponibile. Avvia il server con <code>DASHBOARD_OPEN=1</code> (solo su indirizzo locale) oppure inserisci il
            token di amministrazione (<code>ADMIN_TOKEN</code>): resta solo in questa scheda del browser.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="ita-field">
        <label className="ita-label" htmlFor="token">
          Token di amministrazione
        </label>
        <input id="token" type="password" autoComplete="off" className="ita-input w-full mb-4" required value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="ita-btn ita-btn-primary" type="submit">
          Entra
        </button>
      </form>
    </main>
  );
}

export function App() {
  const { path, query } = useRoute();
  const me = useApi<Whoami>('/whoami');

  if (me.loading && !me.data) return <Loading />;
  if (me.error?.status === 401) return <TokenForm onDone={me.reload} />;
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
              onClick={() => {
                token.clear();
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
