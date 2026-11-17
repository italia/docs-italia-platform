import { useState } from 'react';
import { api, useApi, type DocumentDetail, type VersionRow, type Whoami } from '../api';
import { BuildStatus, duration, ErrorBox, href, Loading, Notice, Page, ReasonDialog, When, type ReasonRequest } from '../ui';

const KIND: Record<string, string> = { draft: 'bozza', release: 'release', branch: 'branch', archived: 'archiviata' };

function versionState(v: VersionRow) {
  const withdrawn = v.overrides.some((o) => o.action === 'withdraw');
  if (withdrawn) return <span className="ita-badge ita-badge-danger">ritirata</span>;
  if (!v.active) return <span className="ita-badge ita-badge-secondary">non attiva</span>;
  if (!v.published_build_id) return <span className="ita-badge ita-badge-warning">non pubblicata</span>;
  return <span className="ita-badge ita-badge-success">pubblicata</span>;
}

export function DocumentPage({ id, me }: { id: number; me: Whoami }) {
  const doc = useApi<DocumentDetail>(`/documents/${id}`);
  const [request, setRequest] = useState<ReasonRequest | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);

  if (doc.error) return <ErrorBox error={doc.error} />;
  if (!doc.data) return <Loading />;
  const d = doc.data;
  const target = (v: VersionRow) => `${d.repo_owner}/${d.repo_name}@${v.slug}`;
  const siteDoc = d.project ? `${me.siteUrl.replace(/\/$/, '')}/${d.repo_owner}/${d.project}/${d.slug}/` : null;

  const act = (v: VersionRow, action: 'withdraw' | 'restore' | 'promote' | 'unpromote', done: string) => async (reason: string) => {
    await api(`/versions/${v.id}/${action}`, { method: 'POST', body: { reason } });
    setMessage({ text: done, tone: 'success' });
    doc.reload();
  };

  const rebuild = async (v: VersionRow) => {
    try {
      const { job } = await api<{ job: number }>(`/versions/${v.id}/build`, { method: 'POST' });
      setMessage({ text: `Build di ${v.slug} in coda (lavoro ${job}). La versione pubblicata resta quella attuale finché la nuova build non riesce.`, tone: 'success' });
    } catch (e) {
      setMessage({ text: (e as Error).message, tone: 'danger' });
    }
  };

  const actions = (v: VersionRow) => {
    const withdrawn = v.overrides.some((o) => o.action === 'withdraw');
    const promoted = v.overrides.some((o) => o.action === 'promote');
    const isDefault = d.default_version_id === v.id;
    return (
      <div className="da-actions">
        <button type="button" className="ita-btn ita-btn-outline ita-btn-xs" onClick={() => rebuild(v)}>
          Ricostruisci<span className="sr-only"> {v.slug}</span>
        </button>
        {withdrawn ? (
          <button
            type="button"
            className="ita-btn ita-btn-primary ita-btn-xs"
            onClick={() =>
              setRequest({
                title: `Ripristinare ${v.slug}?`,
                description: <p>La versione torna sul sito e nella ricerca; i nuovi eventi del repository la aggiornano di nuovo.</p>,
                confirm: 'Ripristina',
                run: act(v, 'restore', `${target(v)} ripristinata.`),
              })
            }
          >
            Ripristina<span className="sr-only"> {v.slug}</span>
          </button>
        ) : (
          v.active && (
            <button
              type="button"
              className="ita-btn ita-btn-danger ita-btn-xs"
              onClick={() =>
                setRequest({
                  title: `Ritirare ${v.slug}?`,
                  description: (
                    <>
                      <p>
                        La versione scompare dal sito e dalla ricerca{isDefault ? ' e la versione predefinita passa alla successiva secondo la regola' : ''}. I file
                        restano nell'archivio: si può ripristinare.
                      </p>
                      <p className="mt-2">Finché il ritiro è in vigore, i nuovi push o tag del repository non la ripubblicano.</p>
                    </>
                  ),
                  confirm: 'Ritira',
                  danger: true,
                  run: act(v, 'withdraw', `${target(v)} ritirata.`),
                })
              }
            >
              Ritira<span className="sr-only"> {v.slug}</span>
            </button>
          )
        )}
        {promoted ? (
          <button
            type="button"
            className="ita-btn ita-btn-outline ita-btn-xs"
            onClick={() =>
              setRequest({
                title: 'Tornare alla regola del repository?',
                description: <p>La versione predefinita torna quella indicata da document_settings.yml, o l'ultima release.</p>,
                confirm: 'Torna alla regola',
                run: act(v, 'unpromote', `Promozione di ${target(v)} revocata: vale la regola del repository.`),
              })
            }
          >
            Torna alla regola del repository
          </button>
        ) : (
          v.active &&
          v.published_build_id &&
          !isDefault && (
            <button
              type="button"
              className="ita-btn ita-btn-outline ita-btn-xs"
              onClick={() =>
                setRequest({
                  title: `Promuovere ${v.slug} a predefinita?`,
                  description: (
                    <p>
                      Gli indirizzi «stabile» e la radice del documento portano a questa versione, anche contro <code>document_settings.yml</code>, finché la
                      promozione non viene revocata. Un'eventuale altra promozione dello stesso documento viene revocata.
                    </p>
                  ),
                  confirm: 'Promuovi',
                  run: act(v, 'promote', `${target(v)} è ora la versione predefinita.`),
                })
              }
            >
              Promuovi a predefinita<span className="sr-only"> {v.slug}</span>
            </button>
          )
        )}
      </div>
    );
  };

  return (
    <Page
      title={d.name}
      subtitle={
        <>
          {d.publisher_name} · {d.project_name ?? 'nessun progetto'}
        </>
      }
      actions={
        <>
          {siteDoc && d.active && (
            <a className="ita-btn ita-btn-outline ita-btn-xs" href={siteDoc}>
              Sul sito
            </a>
          )}
          <a className="ita-btn ita-btn-outline ita-btn-xs" href={`https://github.com/${d.repo_owner}/${d.repo_name}`}>
            Repository
          </a>
        </>
      }
    >
      <Notice message={message} onClose={() => setMessage(null)} />
      {d.sync_error && (
        <div className="ita-alert ita-alert-danger mb-4" role="alert">
          <p>
            <strong>Non importato:</strong> {d.sync_error}. Correggere il repository o italia-conf e sincronizzare l'organizzazione.
          </p>
        </div>
      )}

      <section className="da-panel" aria-labelledby="doc-info">
        <h2 id="doc-info">Documento</h2>
        <dl className="da-meta">
          <dt>Repository</dt>
          <dd className="da-mono">
            {d.repo_owner}/{d.repo_name}
          </dd>
          <dt>Formato</dt>
          <dd>{d.format === 'myst' ? 'MyST' : 'RST (convertito in MyST a ogni build)'}</dd>
          <dt>Lingua</dt>
          <dd>{d.language}</dd>
          <dt>Branch della bozza</dt>
          <dd className="da-mono">{d.draft_branch ?? '—'}</dd>
          <dt>Predefinita dichiarata</dt>
          <dd>{d.default_version ?? <span className="da-muted">nessuna: l'ultima release</span>}</dd>
          <dt>Stato</dt>
          <dd>{d.active ? 'attivo' : 'non attivo (tolto da italia-conf o non importato)'}</dd>
        </dl>
        {d.description && <p className="mt-3">{d.description}</p>}
      </section>

      <section className="da-panel" aria-labelledby="doc-versions">
        <h2 id="doc-versions">Versioni</h2>
        <div className="da-table">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Versione</th>
                <th>Stato</th>
                <th>Pubblicata</th>
                <th>Controlli</th>
                <th>Ultima build</th>
                <th>Interventi</th>
                <th>
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.slug}</strong> {d.default_version_id === v.id && <span className="ita-badge ita-badge-primary">predefinita</span>}
                    <div className="da-muted">
                      {KIND[v.kind] ?? v.kind}
                      {v.ref && v.ref !== v.slug ? ` · ${v.ref}` : ''}
                      {v.commit ? ` · ${v.commit.slice(0, 7)}` : ''}
                    </div>
                  </td>
                  <td>{versionState(v)}</td>
                  <td>
                    {v.published_build_id ? (
                      <a className="ita-link" href={href(`/build/${v.published_build_id}`)}>
                        <When at={v.published_at} />
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {v.published_build_id ? (
                      v.errors > 0 ? (
                        <span className="ita-badge ita-badge-danger">{v.errors} errori</span>
                      ) : v.problems > 0 ? (
                        <span className="ita-badge ita-badge-warning">{v.problems} avvisi</span>
                      ) : (
                        <span className="da-muted">nessun problema</span>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="da-nowrap">
                    {v.last_build ? (
                      <a href={href(`/build/${v.last_build}`)} className="no-underline">
                        <BuildStatus status={v.last_status} /> <When at={v.last_at} />
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {v.overrides.map((o) => (
                      <div key={o.id} className="text-sm">
                        <strong>{o.action === 'withdraw' ? 'ritirata' : o.action === 'promote' ? 'promossa' : o.action}</strong>: «{o.reason}»
                        <div className="da-muted">
                          {o.actor}, <When at={o.created_at} />
                        </div>
                      </div>
                    ))}
                  </td>
                  <td>{actions(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="da-panel" aria-labelledby="doc-builds">
        <h2 id="doc-builds">Build recenti</h2>
        <div className="da-table">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Build</th>
                <th>Versione</th>
                <th>Stato</th>
                <th>Origine</th>
                <th>Commit</th>
                <th>Problemi</th>
                <th>Iniziata</th>
                <th>Durata</th>
              </tr>
            </thead>
            <tbody>
              {d.builds.map((b) => (
                <tr key={b.id}>
                  <td>
                    <a className="ita-link" href={href(`/build/${b.id}`)}>
                      #{b.id}
                    </a>
                  </td>
                  <td>{b.version ?? '—'}</td>
                  <td>
                    <BuildStatus status={b.status} />
                  </td>
                  <td>{b.origin === 'action' ? 'GitHub Action' : 'worker'}</td>
                  <td className="da-mono">{b.commit?.slice(0, 7) ?? '—'}</td>
                  <td>{b.problems}</td>
                  <td>
                    <When at={b.created_at} />
                  </td>
                  <td>{duration(b.created_at, b.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <ReasonDialog request={request} onClose={() => setRequest(null)} />
    </Page>
  );
}
