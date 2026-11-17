import { useState } from 'react';
import { api, useApi, type ChecksResult } from '../api';
import { CheckBadge, ErrorBox, Loading, Page, When } from '../ui';

export function Checks() {
  const result = useApi<ChecksResult>('/checks');
  const [fresh, setFresh] = useState<ChecksResult | null>(null);
  const [busy, setBusy] = useState(false);
  const data = fresh ?? result.data;

  const verify = async () => {
    setBusy(true);
    try {
      setFresh(await api<ChecksResult>('/checks?fresh=1'));
    } finally {
      setBusy(false);
    }
  };

  const groups = new Map<string, NonNullable<typeof data>['checks']>();
  for (const c of data?.checks ?? []) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);

  return (
    <Page
      title="Stato dei collegamenti"
      subtitle={data ? <>Ultima verifica <When at={data.at} />. I segreti non sono mai mostrati.</> : undefined}
      actions={
        <button type="button" className="ita-btn ita-btn-primary ita-btn-xs" onClick={verify} disabled={busy}>
          {busy ? 'Verifica in corso…' : 'Verifica ora'}
        </button>
      }
    >
      {result.error && <ErrorBox error={result.error} />}
      {!data ? (
        <Loading />
      ) : (
        [...groups].map(([group, checks]) => (
          <section key={group} className="da-panel" aria-labelledby={`g-${group}`}>
            <h2 id={`g-${group}`}>{group}</h2>
            <div className="da-table">
              <table className="table table-sm">
                <tbody>
                  {checks.map((c) => (
                    <tr key={c.name}>
                      <th scope="row" className="w-64 font-semibold">
                        {c.name}
                      </th>
                      <td className="w-32">
                        <CheckBadge status={c.status} />
                      </td>
                      <td>{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </Page>
  );
}
