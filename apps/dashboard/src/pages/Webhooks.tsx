import { useApi, type WebhookDelivery } from '../api';
import { ErrorBox, Loading, Page, When } from '../ui';

export function Webhooks() {
  const list = useApi<WebhookDelivery[]>('/webhooks');
  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data) return <Loading />;
  return (
    <Page title="Webhook" subtitle="Le ultime 200 consegne di GitHub con firma valida e cosa ne ha fatto il server.">
      <div className="da-panel da-table">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Ricevuto</th>
              <th>Evento</th>
              <th>Repository</th>
              <th>Esito</th>
              <th>Dettagli</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((w) => (
              <tr key={w.id}>
                <td>
                  <When at={w.at} />
                </td>
                <td className="da-mono">{w.event}</td>
                <td>{w.owner ? `${w.owner}/${w.repo}` : '—'}</td>
                <td>{w.outcome}</td>
                <td className="da-mono text-xs">{Object.keys(w.detail ?? {}).length ? JSON.stringify(w.detail) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data.length === 0 && <p className="da-muted p-4">Nessuna consegna ricevuta.</p>}
      </div>
    </Page>
  );
}
