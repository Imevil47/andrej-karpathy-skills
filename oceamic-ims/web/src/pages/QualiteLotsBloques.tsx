import { Link } from 'react-router-dom';
import { Card, DataTable, PageHeader } from '../components/ui';
import { formatDateTime, formatQuantity } from '../format';
import { useResource } from '../hooks';

type BlockedLotRow = Readonly<{
  lotBlockId: string;
  lotId: string;
  lotCode: string;
  speciesCode: string;
  blockedAt: string;
  reason: string;
  blockedByName: string;
  sourceInspectionCode: string | null;
  blockedQuantityKg: string;
}>;

export function QualiteLotsBloques() {
  const { data, error, loading } = useResource<readonly BlockedLotRow[]>('/api/quality/blocked-lots');

  return (
    <>
      <PageHeader
        title="Lots bloqués"
        subtitle="Blocages qualité actifs. La levée se fait depuis la situation du lot."
        actions={null}
      />

      <Card title={null}>
        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'lot', label: 'Lot', numeric: false },
              { key: 'espece', label: 'Espèce', numeric: false },
              { key: 'date', label: 'Bloqué le', numeric: false },
              { key: 'par', label: 'Bloqué par', numeric: false },
              { key: 'controle', label: 'Contrôle source', numeric: false },
              { key: 'motif', label: 'Motif', numeric: false },
              { key: 'quantite', label: 'Stock bloqué (kg)', numeric: true },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun lot bloqué."
          >
            {(data ?? []).map((row) => (
              <tr key={row.lotBlockId}>
                <td>
                  <Link to={`/lots/${row.lotId}`}>
                    <strong>{row.lotCode}</strong>
                  </Link>
                </td>
                <td>{row.speciesCode}</td>
                <td>{formatDateTime(row.blockedAt)}</td>
                <td>{row.blockedByName}</td>
                <td>{row.sourceInspectionCode ?? '-'}</td>
                <td>{row.reason}</td>
                <td className="nombre">{formatQuantity(row.blockedQuantityKg)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
