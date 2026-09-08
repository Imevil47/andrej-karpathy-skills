import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, buildQuery } from '../api';
import { Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { label } from '../format';

type SearchHit = Readonly<{
  kind:
    | 'LOT'
    | 'RECEPTION'
    | 'SOUS_TRAITANCE'
    | 'MOUVEMENT'
    | 'RUN'
    | 'LOT_PF'
    | 'PALETTE'
    | 'EXPEDITION'
    | 'CONTENEUR'
    | 'CLIENT';
  label: string;
  detail: string;
  lotId: string;
}>;

const ROUTE_BY_KIND: Readonly<Record<SearchHit['kind'], (id: string) => string>> = {
  LOT: (id) => `/lots/${id}`,
  RECEPTION: (id) => `/lots/${id}`,
  SOUS_TRAITANCE: (id) => `/lots/${id}`,
  MOUVEMENT: (id) => `/lots/${id}`,
  RUN: (id) => `/production/${id}`,
  LOT_PF: (id) => `/emballage/lots-pf/${id}`,
  PALETTE: (id) => `/palettes/${id}`,
  EXPEDITION: (id) => `/expeditions/${id}`,
  CONTENEUR: (id) => `/expeditions/${id}`,
  CLIENT: () => '/parametres',
};

const ACTION_LABEL_BY_KIND: Readonly<Record<SearchHit['kind'], string>> = {
  LOT: 'Situation du lot',
  RECEPTION: 'Situation du lot',
  SOUS_TRAITANCE: 'Situation du lot',
  MOUVEMENT: 'Situation du lot',
  RUN: 'Situation du Run',
  LOT_PF: 'Situation du Lot PF',
  PALETTE: 'Situation de la palette',
  EXPEDITION: 'Voir l’expédition',
  CONTENEUR: 'Voir l’expédition',
  CLIENT: 'Voir dans Paramètres',
};

/** Every search result leads to its own screen (section 34): Lot MP, Run, Lot
 * PF, Palette, Expédition, Conteneur or Client. */
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
        subtitle="Recherche par Lot MP, Run, Lot PF, Palette, Expédition, Conteneur ou Client"
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
                    onClick={() => navigate(ROUTE_BY_KIND[hit.kind](hit.lotId))}
                  >
                    {ACTION_LABEL_BY_KIND[hit.kind]}
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
