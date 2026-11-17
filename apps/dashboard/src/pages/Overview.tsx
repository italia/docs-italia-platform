import { useApi, type ChecksResult, type Overview as OverviewData } from '../api';
import { ErrorBox, href, Loading, Page, When } from '../ui';

const ACTION: Record<string, string> = { withdraw: 'Ritirata', promote: 'Promossa a predefinita', archive: 'Archiviata' };

export function Overview() {
  const o = useApi<OverviewData>('/overview');
  const checks = useApi<ChecksResult>('/checks');
  if (o.error) return <ErrorBox error={o.error} />;
  if (!o.data) return <Loading />;
  const { counts, attention, overrides } = o.data;
  const failing = checks.data?.checks.filter((c) => c.status === 'errore') ?? [];
  const warnings = checks.data?.checks.filter((c) => c.status === 'avviso') ?? [];

  const counters: Array<[string, number, string, boolean]> = [
    ['Organizzazioni', counts.publishers, '/organizzazioni', false],
    ['Progetti', counts.projects, '/documenti', false],
    ['Documenti', counts.documents, '/documenti', false],
    ['Versioni pubblicate', counts.versions, '/documenti', false],
    ['Lavori in coda', counts.queued + counts.running, '/coda', false],
    ['Lavori falliti', counts.failed_jobs, '/coda?stato=failed', counts.failed_jobs > 0],
    ['Build fallite (7 giorni)', counts.failed_builds_week, '/build?stato=failed', counts.failed_builds_week > 0],
  ];

  return (
    <Page title="Panoramica" actions={<button type="button" className="ita-btn ita-btn-outline ita-btn-xs" onClick={() => (o.reload(), checks.reload())}>Aggiorna</button>}>
      {checks.loading && !checks.data && <p className="da-muted mb-4">Verifica dei collegamenti in corso…</p>}
      {failing.length > 0 && (
        <div className="ita-alert ita-alert-danger mb-6" role="alert">
          <div>
            <p className="font-bold">
              {failing.length === 1 ? 'Un collegamento non funziona' : `${failing.length} collegamenti non funzionano`}
            </p>
            <ul className="list-disc ps-5 mt-1">
              {failing.map((c) => (
                <li key={c.group + c.name}>
                  <strong>
                    {c.group} · {c.name}
                  </strong>
                  : {c.detail}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              <a className="ita-link" href={href('/collegamenti')}>
                Stato dei collegamenti
              </a>
            </p>
          </div>
        </div>
      )}
      {failing.length === 0 && warnings.length > 0 && (
        <div className="ita-alert ita-alert-warning mb-6" role="status">
          <p>
            {warnings.length} avvisi sui collegamenti ({warnings.map((w) => w.name).join(', ')}).{' '}
            <a className="ita-link" href={href('/collegamenti')}>
              Dettagli
            </a>
          </p>
        </div>
      )}

      <ul className="da-counters" aria-label="Riepilogo">
        {counters.map(([label, n, to, bad]) => (
          <li key={label} className={`da-counter ${bad ? 'da-counter-bad' : ''}`}>
            <a href={href(to)} className="no-underline">
              <strong>{n}</strong>
              {label}
            </a>
          </li>
        ))}
      </ul>

      <section className="da-panel" aria-labelledby="att-build">
        <h2 id="att-build">Versioni con l'ultima build fallita</h2>
        {attention.failing.length === 0 ? (
          <p className="da-muted">Nessuna.</p>
        ) : (
          <div className="da-table">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Versione</th>
                  <th>Errore</th>
                  <th>Sul sito</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {attention.failing.map((f) => (
                  <tr key={f.build}>
                    <td>
                      <a className="ita-link" href={href(`/documenti/${f.document_id}`)}>
                        {f.name}
                      </a>
                      <div className="da-muted">
                        {f.repo_owner}/{f.repo_name}
                      </div>
                    </td>
                    <td>{f.version}</td>
                    <td>
                      <a className="ita-link" href={href(`/build/${f.build}`)}>
                        {(f.error ?? 'vedi il log').slice(0, 140)}
                      </a>
                    </td>
                    <td>{f.published ? 'resta la build precedente' : <strong>mai pubblicata</strong>}</td>
                    <td>
                      <When at={f.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="da-panel" aria-labelledby="att-sync">
        <h2 id="att-sync">Sincronizzazione</h2>
        {attention.publishers.length === 0 && attention.documents.length === 0 ? (
          <p className="da-muted">Tutte le organizzazioni e i documenti elencati in italia-conf sono importati.</p>
        ) : (
          <ul className="space-y-2">
            {attention.publishers.map((p) => (
              <li key={p.slug}>
                <strong>{p.name}</strong>: sincronizzazione fallita — {p.sync_error}{' '}
                <a className="ita-link" href={href('/organizzazioni')}>
                  Organizzazioni
                </a>
              </li>
            ))}
            {attention.documents.map((d) => (
              <li key={d.id}>
                <a className="ita-link" href={href(`/documenti/${d.id}`)}>
                  {d.repo_owner}/{d.repo_name}
                </a>{' '}
                non importato: {d.sync_error}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="da-panel" aria-labelledby="att-errors">
        <h2 id="att-errors">Documenti con errori nei controlli</h2>
        <p className="da-muted mb-2">Errori di <code>docs-italia check</code> nella versione predefinita pubblicata (link e riferimenti rotti, immagini mancanti…).</p>
        {attention.withErrors.length === 0 ? (
          <p className="da-muted">Nessuno.</p>
        ) : (
          <ul className="space-y-1">
            {attention.withErrors.map((d) => (
              <li key={d.id}>
                <a className="ita-link" href={href(`/documenti/${d.id}`)}>
                  {d.name}
                </a>{' '}
                <span className="da-muted">
                  ({d.version}): {d.errors} errori
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="da-panel" aria-labelledby="att-overrides">
        <h2 id="att-overrides">Interventi in vigore</h2>
        <p className="da-muted mb-2">Decisioni della dashboard che prevalgono sui repository finché non vengono revocate.</p>
        {overrides.length === 0 ? (
          <p className="da-muted">Nessuno: valgono le regole dei repository.</p>
        ) : (
          <ul className="space-y-2">
            {overrides.map((x) => (
              <li key={x.id}>
                <strong>{ACTION[x.action] ?? x.action}</strong>:{' '}
                <a className="ita-link" href={href(`/documenti/${x.document_id}`)}>
                  {x.repo_owner}/{x.repo_name}@{x.version}
                </a>{' '}
                — «{x.reason}» <span className="da-muted">({x.actor}, <When at={x.created_at} />)</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
