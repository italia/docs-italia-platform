import { useState } from 'react';
import { api, useApi, type Publisher } from '../api';
import { ErrorBox, href, Loading, Notice, Page, When } from '../ui';

export function Publishers() {
  const list = useApi<Publisher[]>('/publishers');
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const sync = async (slug: string) => {
    setBusy(slug);
    try {
      const { job } = await api<{ job: number }>(`/sync/${slug}`, { method: 'POST' });
      setMessage({ text: `Sincronizzazione di ${slug} in coda (lavoro ${job}): legge italia-conf e accoda le build delle versioni nuove.`, tone: 'success' });
    } catch (e) {
      setMessage({ text: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data) return <Loading />;
  return (
    <Page title="Organizzazioni" subtitle="Ogni organizzazione GitHub con il suo repository di configurazione (italia-conf).">
      <Notice message={message} onClose={() => setMessage(null)} />
      <div className="da-panel da-table">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Organizzazione</th>
              <th>Configurazione</th>
              <th>Progetti</th>
              <th>Documenti</th>
              <th>Ultima sincronizzazione</th>
              <th>Ultimo webhook</th>
              <th>
                <span className="sr-only">Azioni</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((p) => (
              <tr key={p.slug}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="da-muted">{p.slug}</div>
                  {!p.active && <span className="ita-badge ita-badge-secondary">non attiva</span>}
                </td>
                <td>
                  <a className="ita-link" href={`https://github.com/${p.slug}/${p.conf_repo}`}>
                    {p.conf_repo}
                  </a>
                </td>
                <td>{p.projects}</td>
                <td>
                  <a className="ita-link" href={href(`/documenti?organizzazione=${p.slug}`)}>
                    {p.documents}
                  </a>
                  {p.document_errors > 0 && (
                    <div>
                      <a className="ita-badge ita-badge-danger" href={href(`/documenti?organizzazione=${p.slug}&stato=non-importati`)}>
                        {p.document_errors} non importati
                      </a>
                    </div>
                  )}
                </td>
                <td>
                  {p.sync_error ? (
                    <span className="text-error">
                      fallita: {p.sync_error}
                    </span>
                  ) : (
                    <When at={p.synced_at} />
                  )}
                </td>
                <td>
                  <When at={p.last_webhook} />
                </td>
                <td>
                  <button type="button" className="ita-btn ita-btn-primary ita-btn-xs" disabled={busy === p.slug} onClick={() => sync(p.slug)}>
                    Sincronizza<span className="sr-only"> {p.name}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
