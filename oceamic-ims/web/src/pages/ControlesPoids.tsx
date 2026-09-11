import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';

type WeightControlRow = Readonly<{
  id: string;
  controlCode: string;
  runCode: string;
  productCode: string;
  format: string | null;
  controlledAt: string;
  controllerName: string;
  sampleCount: number;
  sampleSize: number;
  averageWeightG: string | null;
  underweightCount: number;
  overweightCount: number;
  controlStatus: string;
}>;

const STATUSES = ['CONFORME', 'A_CORRIGER', 'NON_CONFORME', 'INCOMPLET'] as const;

/** Historique des contrôles poids (section 19), avec accès direct au détail par boîte. */
export function ControlesPoids() {
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading } = useResource<readonly WeightControlRow[]>(
    `/api/filling-weight-controls${buildQuery(filters)}`,
  );

  return (
    <>
      <PageHeader title="Contrôles poids" subtitle="Historique des contrôles poids" actions={null} />

      <Card title={null}>
        <div className="filtres">
          <select
            value={filters.statut}
            onChange={(event) => setFilters({ statut: event.target.value })}
          >
            <option value="">Tous les résultats</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status === 'CONFORME'
                  ? 'Conforme'
                  : status === 'A_CORRIGER'
                    ? 'À corriger'
                    : status === 'NON_CONFORME'
                      ? 'Non conforme'
                      : 'Incomplet'}
              </option>
            ))}
          </select>
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'date', label: 'Date', numeric: false },
              { key: 'run', label: 'Run', numeric: false },
              { key: 'produit', label: 'Produit', numeric: false },
              { key: 'format', label: 'Format', numeric: false },
              { key: 'moyen', label: 'Poids moyen', numeric: true },
              { key: 'sous', label: 'Sous-poids', numeric: true },
              { key: 'sur', label: 'Surpoids', numeric: true },
              { key: 'resultat', label: 'Résultat', numeric: false },
              { key: 'controleur', label: 'Contrôleur', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun contrôle poids enregistré."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/controles-poids/${row.id}`}>
                    <strong>{formatDateTime(row.controlledAt)}</strong>
                  </Link>
                </td>
                <td>{row.runCode}</td>
                <td>{row.productCode}</td>
                <td>{row.format ?? '-'}</td>
                <td className="nombre">{row.averageWeightG ? `${row.averageWeightG} g` : '-'}</td>
                <td className="nombre">{row.underweightCount}</td>
                <td className="nombre">{row.overweightCount}</td>
                <td>
                  <Badge value={row.controlStatus} />
                  {` ${row.sampleCount} / ${row.sampleSize}`}
                </td>
                <td>{row.controllerName}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
