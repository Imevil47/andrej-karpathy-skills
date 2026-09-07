import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, buildQuery } from '../api';
import { Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { label } from '../format';

type SearchHit = Readonly<{
  kind: 'LOT' | 'RECEPTION' | 'SOUS_TRAITANCE' | 'MOUVEMENT';
  label: string;
  detail: string;
  lotId: string;
}>;

/** Every search result leads to one page: "Situation du lot". */
export function Tracabilite() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setHits(await apiGet<readonly SearchHit[]>(`/api/search${buildQuery({ q: term.trim() })}`));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Traçabilité"
        subtitle="Recherche par lot, réception, camion, fournisseur, sous-traitance ou mouvement"
        actions={null}
      />

      <Card title={null}>
        <form onSubmit={submit}>
          <div className="filtres">
            <Field label="Recherche" hint="Deux caractères minimum.">
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="LOT-MP-001, REC-..., 12345-A-6"
                required
              />
            </Field>
          </div>
          <div className="ligne-boutons" style={{ marginTop: 0 }}>
            <button type="submit" disabled={busy}>
              {busy ? 'Recherche...' : 'Rechercher'}
            </button>
          </div>
        </form>
      </Card>

      <Message kind="erreur" text={error} />

      {hits === null ? null : (
        <Card title="Résultats">
          <DataTable
            columns={[
              { key: 'type', label: 'Type', numeric: false },
              { key: 'code', label: 'Référence', numeric: false },
              { key: 'detail', label: 'Détail', numeric: false },
              { key: 'action', label: '', numeric: false },
            ]}
            isEmpty={hits.length === 0}
            emptyText="Aucun résultat."
          >
            {hits.map((hit) => (
              <tr key={`${hit.kind}-${hit.label}`}>
                <td>{label(hit.kind)}</td>
                <td>
                  <strong>{hit.label}</strong>
                </td>
                <td>{hit.detail}</td>
                <td>
                  <button
                    type="button"
                    className="lien"
                    onClick={() => navigate(`/lots/${hit.lotId}`)}
                  >
                    Situation du lot
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      )}
    </>
  );
}
