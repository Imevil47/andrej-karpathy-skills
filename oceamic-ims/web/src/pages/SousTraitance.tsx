import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDateTime, formatQuantity, label } from '../format';
import { useResource } from '../hooks';

type OperationRow = Readonly<{
  id: string;
  operationCode: string;
  sentAt: string;
  sourceType: string;
  quantitySentKg: string;
  status: string;
  subcontractorName: string;
  lotId: string | null;
  lotCode: string | null;
  sourceLocationCode: string | null;
  resultsKg: string;
  differenceKg: string;
}>;

export function SousTraitance() {
  const { can } = useAuth();
  const { data, error, loading } = useResource<readonly OperationRow[]>('/api/subcontracting');

  return (
    <>
      <PageHeader
        title="Sous-traitance"
        subtitle="Envois, résultats et bilan matière"
        actions={
          can('subcontracting:create') ? (
            <Link to="/sous-traitance/nouvelle">
              <button type="button">Nouvel envoi</button>
            </Link>
          ) : null
        }
      />

      <Card title={null}>
        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'code', label: 'Opération', numeric: false },
              { key: 'date', label: 'Envoi', numeric: false },
              { key: 'sous-traitant', label: 'Sous-traitant', numeric: false },
              { key: 'origine', label: 'Origine', numeric: false },
              { key: 'lot', label: 'Lot', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'envoye', label: 'Envoyé (kg)', numeric: true },
              { key: 'resultats', label: 'Résultats (kg)', numeric: true },
              { key: 'ecart', label: 'Écart (kg)', numeric: true },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune opération de sous-traitance."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/sous-traitance/${row.id}`}>
                    <strong>{row.operationCode}</strong>
                  </Link>
                </td>
                <td>{formatDateTime(row.sentAt)}</td>
                <td>{row.subcontractorName}</td>
                <td>{label(row.sourceType)}</td>
                <td>
                  {row.lotId ? <Link to={`/lots/${row.lotId}`}>{row.lotCode}</Link> : '-'}
                </td>
                <td>
                  <Badge value={row.status} />
                </td>
                <td className="nombre">{formatQuantity(row.quantitySentKg)}</td>
                <td className="nombre">{formatQuantity(row.resultsKg)}</td>
                <td className="nombre">{formatQuantity(row.differenceKg)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
