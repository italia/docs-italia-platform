import { useState } from 'react';
import { api, useApi, type Job } from '../api';
import { BuildStatus, ErrorBox, href, Loading, Notice, Page, When } from '../ui';

const STATUSES: Array<[string, string]> = [
  ['', 'Tutti'],
  ['queued', 'In coda'],
  ['running', 'In corso'],
  ['failed', 'Falliti'],
  ['done', 'Fatti'],
];

function what(j: Job) {
  if (j.kind === 'sync') return <>sincronizzazione di {String(j.payload.owner)}</>;
  if (j.kind === 'build') return <>build della versione {String(j.payload.versionId)}</>;
  return <>{j.kind}</>;
}

export function Jobs({ query }: { query: URLSearchParams }) {
  const status = query.get('stato') ?? '';
  const list = useApi<Job[]>(`/jobs${status ? `?status=${status}` : ''}`);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);

  const retry = async (j: Job) => {
    try {
      await api(`/jobs/${j.id}/retry`, { method: 'POST' });
      setMessage({ text: `Lavoro ${j.id} di nuovo in coda.`, tone: 'success' });
      list.reload();
    } catch (e) {
      setMessage({ text: (e as Error).message, tone: 'danger' });
    }
  };

  return (
    <Page
      title="Coda dei lavori"
      subtitle="Sincronizzazioni e build, eseguite dal worker in ordine (PostgreSQL, FOR UPDATE SKIP LOCKED)."
      actions={
        <button type="button" className="ita-btn ita-btn-outline ita-btn-xs" onClick={list.reload}>
          Aggiorna
        </button>
      }
    >
      <Notice message={message} onClose={() => setMessage(null)} />
      <div className="da-filters">
        <div className="ita-field">
          <label className="ita-label" htmlFor="j-state">
            Stato
          </label>
          <select id="j-state" className="ita-select" value={status} onChange={(e) => (location.hash = `#/coda${e.target.value ? `?stato=${e.target.value}` : ''}`)}>
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
                <th>Lavoro</th>
                <th>Cosa</th>
                <th>Stato</th>
                <th>Tentativi</th>
                <th>Creato</th>
                <th>Concluso</th>
                <th>
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((j) => (
                <tr key={j.id}>
                  <td>#{j.id}</td>
                  <td>
                    {what(j)}
                    {j.last_error && <div className="text-error text-sm da-mono">{j.last_error.slice(0, 200)}</div>}
                  </td>
                  <td>
                    <BuildStatus status={j.status} />
                  </td>
                  <td>
                    {j.attempts}/{j.max_attempts}
                  </td>
                  <td>
                    <When at={j.created_at} />
                  </td>
                  <td>
                    <When at={j.finished_at} />
                  </td>
                  <td>
                    {j.status === 'failed' && (
                      <button type="button" className="ita-btn ita-btn-primary ita-btn-xs" onClick={() => retry(j)}>
                        Rilancia<span className="sr-only"> il lavoro {j.id}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.length === 0 && (
            <p className="da-muted p-4">
              Nessun lavoro. <a className="ita-link" href={href('/build')}>Build</a>
            </p>
          )}
        </div>
      )}
    </Page>
  );
}
