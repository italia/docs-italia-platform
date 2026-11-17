import { useApi, type AuditEntry } from '../api';
import { ErrorBox, Loading, Page, When } from '../ui';

const ACTIONS: Record<string, string> = {
  'version.withdraw': 'ritiro',
  'version.restore': 'ripristino',
  'version.promote': 'promozione',
  'version.unpromote': 'ritorno alla regola del repository',
  build: 'build',
  sync: 'sincronizzazione',
  seed: 'importazione dall\'inventario',
  'job.retry': 'lavoro rilanciato',
};

export function Audit() {
  const list = useApi<AuditEntry[]>('/audit');
  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data) return <Loading />;
  return (
    <Page title="Registro" subtitle="Gli ultimi 200 interventi: chi, quando, su cosa e perché.">
      <div className="da-panel da-table">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Chi</th>
              <th>Azione</th>
              <th>Oggetto</th>
              <th>Motivazione</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((e) => (
              <tr key={e.id}>
                <td>
                  <When at={e.at} />
                </td>
                <td>{e.actor}</td>
                <td>{ACTIONS[e.action] ?? e.action}</td>
                <td className="da-mono">{e.target ?? '—'}</td>
                <td>{typeof e.detail?.reason === 'string' ? `«${e.detail.reason}»` : <span className="da-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data.length === 0 && <p className="da-muted p-4">Nessun intervento registrato.</p>}
      </div>
    </Page>
  );
}
