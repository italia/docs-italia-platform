import { useMemo } from 'react';
import { useApi, type DocumentRow } from '../api';
import { BuildStatus, ErrorBox, href, Loading, Page, When } from '../ui';

const STATES: Array<[string, string, (d: DocumentRow) => boolean]> = [
  ['', 'Tutti', (d) => d.active],
  ['problemi', 'Con problemi', (d) => d.last_status === 'failed' || d.errors > 0 || !!d.sync_error],
  ['build-fallite', 'Ultima build fallita', (d) => d.last_status === 'failed'],
  ['errori', 'Errori nei controlli', (d) => d.errors > 0],
  ['non-importati', 'Non importati', (d) => !!d.sync_error],
  ['interventi', 'Con interventi', (d) => d.overridden],
  ['inattivi', 'Non attivi', (d) => !d.active],
];

/** Filtri nel frammento dell'URL: si possono condividere e il tasto Indietro li ripristina. */
function setFilter(query: URLSearchParams, key: string, value: string) {
  const q = new URLSearchParams(query);
  if (value) q.set(key, value);
  else q.delete(key);
  const s = q.toString();
  history.replaceState(null, '', `#/documenti${s ? `?${s}` : ''}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function Documents({ query }: { query: URLSearchParams }) {
  const list = useApi<DocumentRow[]>('/documents');
  const text = query.get('q') ?? '';
  const owner = query.get('organizzazione') ?? '';
  const state = query.get('stato') ?? '';

  const owners = useMemo(() => [...new Set((list.data ?? []).map((d) => d.repo_owner))].sort(), [list.data]);
  const rows = useMemo(() => {
    const test = (STATES.find(([k]) => k === state) ?? STATES[0]!)[2];
    const t = text.trim().toLowerCase();
    return (list.data ?? []).filter(
      (d) => test(d) && (!owner || d.repo_owner === owner) && (!t || d.name.toLowerCase().includes(t) || d.repo_name.toLowerCase().includes(t)),
    );
  }, [list.data, text, owner, state]);

  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data) return <Loading />;
  return (
    <Page title="Documenti" subtitle={`${rows.length} di ${list.data.length}`}>
      <div className="da-filters" role="search">
        <div className="ita-field">
          <label className="ita-label" htmlFor="f-q">
            Cerca
          </label>
          <input id="f-q" type="search" className="ita-input" value={text} placeholder="Nome o repository" onChange={(e) => setFilter(query, 'q', e.target.value)} />
        </div>
        <div className="ita-field">
          <label className="ita-label" htmlFor="f-owner">
            Organizzazione
          </label>
          <select id="f-owner" className="ita-select" value={owner} onChange={(e) => setFilter(query, 'organizzazione', e.target.value)}>
            <option value="">Tutte</option>
            {owners.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="ita-field">
          <label className="ita-label" htmlFor="f-state">
            Stato
          </label>
          <select id="f-state" className="ita-select" value={state} onChange={(e) => setFilter(query, 'stato', e.target.value)}>
            {STATES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="da-panel da-table">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Progetto</th>
              <th>Formato</th>
              <th>Predefinita</th>
              <th>Versioni</th>
              <th>Ultima build</th>
              <th>Errori</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <a className="ita-link font-semibold" href={href(`/documenti/${d.id}`)}>
                    {d.name}
                  </a>
                  <div className="da-muted">
                    {d.repo_owner}/{d.repo_name}
                  </div>
                  {d.sync_error && <div className="text-error text-sm">non importato: {d.sync_error}</div>}
                  {d.overridden && <span className="ita-badge ita-badge-warning">intervento in vigore</span>}
                </td>
                <td>{d.project_name ?? '—'}</td>
                <td>{d.format === 'myst' ? 'MyST' : 'RST'}</td>
                <td>{d.default_version ?? '—'}</td>
                <td>{d.versions}</td>
                <td className="da-nowrap">
                  {d.last_build ? (
                    <a href={href(`/build/${d.last_build}`)} className="no-underline">
                      <BuildStatus status={d.last_status} /> <When at={d.last_at} />
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{d.errors > 0 ? <span className="ita-badge ita-badge-danger">{d.errors}</span> : <span className="da-muted">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="da-muted p-4">Nessun documento con questi filtri.</p>}
      </div>
    </Page>
  );
}
