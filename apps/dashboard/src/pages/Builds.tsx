import { useMemo, useState } from 'react';
import { useApi, type BuildDetail, type BuildRow, type Problem } from '../api';
import { BuildStatus, duration, ErrorBox, href, Loading, Page, When } from '../ui';

const STATUSES: Array<[string, string]> = [
  ['', 'Tutte'],
  ['failed', 'Fallite'],
  ['running', 'In corso'],
  ['ok', 'Riuscite'],
];

export function Builds({ query }: { query: URLSearchParams }) {
  const status = query.get('stato') ?? '';
  const list = useApi<BuildRow[]>(`/builds?limit=200${status ? `&status=${status}` : ''}`);
  return (
    <Page title="Build" subtitle="Le ultime 200, dal worker e dalle GitHub Action.">
      <div className="da-filters">
        <div className="ita-field">
          <label className="ita-label" htmlFor="b-state">
            Stato
          </label>
          <select id="b-state" className="ita-select" value={status} onChange={(e) => (location.hash = `#/build${e.target.value ? `?stato=${e.target.value}` : ''}`)}>
            {STATUSES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {list.error && <ErrorBox error={list.error} />}
      {!list.data ? (
        <Loading />
      ) : (
        <div className="da-panel da-table">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Build</th>
                <th>Documento</th>
                <th>Versione</th>
                <th>Stato</th>
                <th>Origine</th>
                <th>Problemi</th>
                <th>Iniziata</th>
                <th>Durata</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id}>
                  <td>
                    <a className="ita-link" href={href(`/build/${b.id}`)}>
                      #{b.id}
                    </a>
                  </td>
                  <td>
                    <a className="ita-link" href={href(`/documenti/${b.document_id}`)}>
                      {b.repository}
                    </a>
                  </td>
                  <td>{b.version ?? '—'}</td>
                  <td>
                    <BuildStatus status={b.status} />
                    {b.error && <div className="text-error text-sm">{b.error.slice(0, 120)}</div>}
                  </td>
                  <td>{b.origin === 'action' ? 'GitHub Action' : 'worker'}</td>
                  <td>{b.problems}</td>
                  <td>
                    <When at={b.created_at} />
                  </td>
                  <td>{duration(b.created_at, b.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.length === 0 && <p className="da-muted p-4">Nessuna build.</p>}
        </div>
      )}
    </Page>
  );
}

/** Link al file su GitHub: solo per i documenti MyST, dove i percorsi sono quelli del repository. */
function fileLink(b: BuildDetail, p: Problem) {
  if (!p.file) return null;
  const label = `${p.file}${p.line ? `:${p.line}` : ''}`;
  if (b.format !== 'myst' || !b.commit) return <span className="da-mono">{label}</span>;
  return (
    <a className="ita-link da-mono" href={`https://github.com/${b.repo_owner}/${b.repo_name}/blob/${b.commit}/${p.file}${p.line ? `#L${p.line}` : ''}`}>
      {label}
    </a>
  );
}

export function BuildDetailPage({ id }: { id: number }) {
  const b = useApi<BuildDetail>(`/builds/${id}`);
  const [level, setLevel] = useState<'' | 'errore' | 'avviso'>('');
  // prima gli errori, poi gli avvisi; a parità, per file e riga
  const problems = useMemo(
    () =>
      [...(b.data?.problems ?? [])]
        .filter((p) => !level || p.level === level)
        .sort((a, z) => (a.level === z.level ? 0 : a.level === 'errore' ? -1 : 1) || (a.file ?? '').localeCompare(z.file ?? '') || (a.line ?? 0) - (z.line ?? 0)),
    [b.data, level],
  );
  if (b.error) return <ErrorBox error={b.error} />;
  if (!b.data) return <Loading />;
  const d = b.data;
  const errors = d.problems.filter((p) => p.level === 'errore').length;

  return (
    <Page
      title={`Build #${d.id}`}
      subtitle={
        <>
          <a className="ita-link" href={href(`/documenti/${d.document_id}`)}>
            {d.document_name}
          </a>{' '}
          · {d.version ?? 'versione rimossa'}
        </>
      }
    >
      <section className="da-panel" aria-labelledby="b-info">
        <h2 id="b-info">Riepilogo</h2>
        <dl className="da-meta">
          <dt>Stato</dt>
          <dd>
            <BuildStatus status={d.status} /> {d.published && <span className="ita-badge ita-badge-primary">pubblicata ora</span>}
          </dd>
          <dt>Origine</dt>
          <dd>{d.origin === 'action' ? 'GitHub Action (pacchetto inviato con OIDC)' : 'worker del server'}</dd>
          <dt>Ref e commit</dt>
          <dd className="da-mono">
            {d.ref ?? '—'} · {d.commit ?? '—'}
          </dd>
          <dt>Iniziata</dt>
          <dd>
            <When at={d.started_at ?? d.created_at} />
          </dd>
          <dt>Durata</dt>
          <dd>{duration(d.started_at ?? d.created_at, d.finished_at)}</dd>
        </dl>
        {d.error && (
          <div className="ita-alert ita-alert-danger mt-4" role="alert">
            <p className="da-mono">{d.error}</p>
          </div>
        )}
      </section>

      <section className="da-panel" aria-labelledby="b-problems">
        <h2 id="b-problems">
          Problemi dei controlli ({errors} errori, {d.problems.length - errors} avvisi)
        </h2>
        {d.problems.length > 0 && (
          <div className="da-filters">
            <div className="ita-field">
              <label className="ita-label" htmlFor="p-level">
                Livello
              </label>
              <select id="p-level" className="ita-select" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
                <option value="">Tutti</option>
                <option value="errore">Errori</option>
                <option value="avviso">Avvisi</option>
              </select>
            </div>
          </div>
        )}
        {d.format !== 'myst' && d.problems.length > 0 && (
          <p className="da-muted mb-2">Documento RST: i file indicati sono quelli del progetto MyST convertito, non del repository.</p>
        )}
        {d.problems.length === 0 ? (
          <p className="da-muted">Nessun problema.</p>
        ) : (
          <div className="da-table">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Livello</th>
                  <th>Codice</th>
                  <th>File</th>
                  <th>Messaggio</th>
                </tr>
              </thead>
              <tbody>
                {problems.slice(0, 500).map((p, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`ita-badge ${p.level === 'errore' ? 'ita-badge-danger' : 'ita-badge-warning'}`}>{p.level}</span>
                    </td>
                    <td className="da-mono">{p.code}</td>
                    <td>{fileLink(d, p)}</td>
                    <td>{p.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {problems.length > 500 && <p className="da-muted p-2">Mostrati i primi 500 di {problems.length}.</p>}
          </div>
        )}
      </section>

      <section className="da-panel" aria-labelledby="b-log">
        <h2 id="b-log">Log</h2>
        <pre className="da-log da-mono" tabIndex={0} aria-label="Log della build">
          {d.log || 'Nessun log.'}
        </pre>
      </section>
    </Page>
  );
}
