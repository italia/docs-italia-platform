import { useState, type FormEvent } from 'react';
import { api, GUIDE_URL, useApi, type Publisher, type PublisherCheck } from '../api';
import { Badge, CheckBadge, ErrorBox, href, Loading, Notice, Page, When } from '../ui';

/**
 * Aggiunta di un'organizzazione: prima la verifica (accesso a GitHub,
 * italia-conf, documenti), poi la prima sincronizzazione.
 */
function AddPublisher({ onAdded }: { onAdded: (text: string) => void }) {
  const [owner, setOwner] = useState('');
  const [check, setCheck] = useState<PublisherCheck | null>(null);
  const [state, setState] = useState<{ busy?: 'verifica' | 'aggiunta'; error?: Error }>({});

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setState({ busy: 'verifica' });
    setCheck(null);
    try {
      setCheck(await api<PublisherCheck>(`/publishers/check/${encodeURIComponent(owner.trim())}`));
      setState({});
    } catch (err) {
      setState({ error: err as Error });
    }
  };
  const add = async () => {
    if (!check) return;
    setState({ busy: 'aggiunta' });
    try {
      const r = await api<{ job: number; slug: string; existing: boolean }>('/publishers', { method: 'POST', body: { owner: check.owner } });
      onAdded(
        r.existing
          ? `${r.slug} c'era già: sincronizzazione in coda (lavoro ${r.job}).`
          : `${r.slug} aggiunta: la prima sincronizzazione è in coda (lavoro ${r.job}) e accoderà le build delle bozze. Per gli aggiornamenti automatici servono i webhook (vedi la guida).`,
      );
      setCheck(null);
      setOwner('');
      setState({});
    } catch (err) {
      setState({ error: err as Error });
    }
  };

  const docs = check?.projects.flatMap((p) => p.documents.map((d) => ({ ...d, project: p.name }))) ?? [];
  return (
    <section className="da-panel" aria-labelledby="aggiungi">
      <h2 id="aggiungi">Aggiungi un'organizzazione</h2>
      <p className="da-muted mb-4">
        Prima l'organizzazione va collegata all'istanza, con la GitHub App installata o con il token: lo spiega la{' '}
        <a className="ita-link" href={GUIDE_URL}>
          guida al collegamento
        </a>
        . La verifica non cambia nulla; l'aggiunta avvia la prima sincronizzazione di italia-conf.
      </p>
      <form onSubmit={verify} className="flex flex-wrap items-end gap-3">
        <div className="ita-field">
          <label className="ita-label" htmlFor="owner">
            Nome dell'organizzazione su GitHub
          </label>
          <input
            id="owner"
            className="ita-input ita-input-sm w-72"
            placeholder="es. AgID"
            required
            autoComplete="off"
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setCheck(null);
            }}
          />
        </div>
        <button type="submit" className="ita-btn ita-btn-outline ita-btn-primary ita-btn-sm" disabled={!!state.busy || !owner.trim()}>
          {state.busy === 'verifica' ? 'Verifica in corso…' : 'Verifica'}
        </button>
      </form>
      {state.error && (
        <div className="mt-4">
          <ErrorBox error={state.error} />
        </div>
      )}
      {check && (
        <div className="mt-6" aria-live="polite">
          <h3 className="font-semibold mb-2">
            {check.publisher ? `${check.publisher.name} (${check.owner})` : check.owner}
          </h3>
          {check.existing && (
            <p className="mb-2">
              <Badge tone="warning">già presente</Badge> come «{check.existing.slug}»{check.existing.active ? '' : ', non attiva'}: aggiungendola si risincronizza.
            </p>
          )}
          <div className="da-table mb-4">
            <table className="table table-sm">
              <tbody>
                {check.access.map((c) => (
                  <tr key={`${c.group}-${c.name}`}>
                    <th scope="row" className="w-64 font-semibold">
                      {c.name}
                    </th>
                    <td className="w-32">
                      <CheckBadge status={c.status} />
                    </td>
                    <td>{c.detail}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="w-64 font-semibold">
                    {check.conf.repo}
                  </th>
                  <td className="w-32">
                    <CheckBadge status={check.ok ? 'ok' : 'errore'} />
                  </td>
                  <td>
                    {check.ok ? (
                      <>
                        valido: {check.summary.projects} progetti, {check.summary.documents} documenti ({check.summary.found} trovati
                        {check.summary.missing ? `, ${check.summary.missing} mancanti` : ''})
                        {check.conf.url && (
                          <>
                            {' · '}
                            <a className="ita-link" href={check.conf.url}>
                              apri
                            </a>
                          </>
                        )}
                      </>
                    ) : (
                      check.conf.problems.join('; ')
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {docs.length > 0 && (
            <details className="mb-4">
              <summary className="cursor-pointer">Documenti elencati in {check.conf.repo}</summary>
              <div className="da-table mt-2">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Progetto</th>
                      <th>Repository</th>
                      <th>Stato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={`${d.project}-${d.repo}`}>
                        <td>{d.project}</td>
                        <td>{d.repo}</td>
                        <td>
                          {!d.found ? (
                            <Badge tone="danger">non trovato</Badge>
                          ) : !d.settings ? (
                            <Badge tone="warning">senza document_settings.yml</Badge>
                          ) : d.archived ? (
                            <Badge tone="secondary">archiviato su GitHub</Badge>
                          ) : (
                            <Badge tone="success">trovato</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <button type="button" className="ita-btn ita-btn-primary ita-btn-sm" onClick={add} disabled={!check.ok || !!state.busy}>
            {state.busy === 'aggiunta' ? 'Aggiunta…' : check.existing ? 'Risincronizza' : 'Aggiungi e sincronizza'}
          </button>
          {!check.ok && <p className="da-muted mt-2">Si può aggiungere quando italia-conf è raggiungibile e valido.</p>}
        </div>
      )}
    </section>
  );
}

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
      <AddPublisher
        onAdded={(text) => {
          setMessage({ text, tone: 'success' });
          list.reload();
        }}
      />
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
