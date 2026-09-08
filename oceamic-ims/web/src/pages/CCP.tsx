import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';

type SterilizationCycleRow = Readonly<{
  id: string;
  cycleCode: string;
  autoclaveCode: string;
  programCode: string;
  startedAt: string;
  status: string;
  latestCcpResult: string | null;
  latestCcpDecision: string | null;
  runCodes: readonly string[];
}>;

/** Vue CCP : chaque cycle avec sa dernière décision, pour repérer vite ce qui reste à vérifier. */
export function CCP() {
  const [filters, setFilters] = useState({ statut: '' });
  const { data, error, loading } = useResource<readonly SterilizationCycleRow[]>(
    `/api/sterilization-cycles${buildQuery(filters)}`,
  );

  return (
    <>
      <PageHeader title="CCP" subtitle="Décisions critiques de stérilisation, par cycle" actions={null} />

      <Card title={null}>
        <div className="filtres">
          <select value={filters.statut} onChange={(event) => setFilters({ statut: event.target.value })}>
            <option value="">Tous les cycles</option>
            <option value="A_VERIFIER">À vérifier</option>
            <option value="BLOQUE">Bloqué</option>
          </select>
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'cycle', label: 'Cycle', numeric: false },
              { key: 'autoclave', label: 'Autoclave', numeric: false },
              { key: 'run', label: 'Run', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'resultat', label: 'Dernier résultat CCP', numeric: false },
              { key: 'decision', label: 'Décision', numeric: false },
              { key: 'statut', label: 'Statut du cycle', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun cycle."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/production/sterilisation/${row.id}`}>
                    <strong>{row.cycleCode}</strong>
                  </Link>
                </td>
                <td>{row.autoclaveCode}</td>
                <td>{row.runCodes.join(', ') || '-'}</td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>{row.latestCcpResult ? <Badge value={row.latestCcpResult} /> : 'Aucune donnée'}</td>
                <td>{row.latestCcpDecision ? <Badge value={row.latestCcpDecision} /> : '-'}</td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
