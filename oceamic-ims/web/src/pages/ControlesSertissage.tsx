import { Link } from 'react-router-dom';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';

type SeamingControlRow = Readonly<{
  id: string;
  productionRunId: string;
  runCode: string;
  machineCode: string | null;
  controlledAt: string;
  controllerName: string;
  measurementCount: number;
  nonConformeCount: number;
  result: string;
}>;

/** Historique des contrôles sertissage. */
export function ControlesSertissage() {
  const { data, error, loading } = useResource<readonly SeamingControlRow[]>('/api/seaming-controls');

  return (
    <>
      <PageHeader title="Contrôles sertissage" subtitle="Historique des contrôles sertissage" actions={null} />

      <Card title={null}>
        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'date', label: 'Date', numeric: false },
              { key: 'run', label: 'Run', numeric: false },
              { key: 'machine', label: 'Machine', numeric: false },
              { key: 'mesures', label: 'Mesures', numeric: true },
              { key: 'resultat', label: 'Résultat', numeric: false },
              { key: 'controleur', label: 'Contrôleur', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun contrôle sertissage enregistré."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/qualite/controles-sertissage/${row.id}`}>
                    <strong>{formatDateTime(row.controlledAt)}</strong>
                  </Link>
                </td>
                <td>{row.runCode}</td>
                <td>{row.machineCode ?? '-'}</td>
                <td className="nombre">{row.measurementCount}</td>
                <td>
                  <Badge value={row.result} />
                  {row.nonConformeCount > 0 ? ` — ${row.nonConformeCount} hors spécification` : ''}
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
