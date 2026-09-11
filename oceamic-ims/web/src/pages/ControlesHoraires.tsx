import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';

type ControlRoundRow = Readonly<{
  id: string;
  roundCode: string;
  runCode: string;
  productionRunId: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  controllerName: string;
  linesVisited: number;
  linesCompleted: number;
  employeesExpected: number;
  employeesControlled: number;
  coveragePercent: string | null;
}>;

export function ControlesHoraires() {
  const [statut, setStatut] = useState('');
  const { data, error, loading } = useResource<readonly ControlRoundRow[]>(
    `/api/cadence/control-rounds${buildQuery({ statut })}`,
  );

  return (
    <>
      <PageHeader
        title="Contrôles horaires"
        subtitle="Tours de contrôle de cadence, tous Runs confondus"
        actions={null}
      />

      <Card title={null}>
        <div className="filtres">
          <select value={statut} onChange={(event) => setStatut(event.target.value)}>
            <option value="">Tous les statuts</option>
            <option value="EN_COURS">En cours</option>
            <option value="TERMINE">Terminé</option>
            <option value="ANNULE">Annulé</option>
          </select>
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'tour', label: 'Tour', numeric: false },
              { key: 'run', label: 'Run', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'fin', label: 'Fin', numeric: false },
              { key: 'controleur', label: 'Contrôleur', numeric: false },
              { key: 'lignes', label: 'Lignes', numeric: false },
              { key: 'employees', label: 'Employées', numeric: false },
              { key: 'couverture', label: 'Couverture', numeric: true },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun tour de contrôle."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/production/controles/${row.id}`}>
                    <strong>{row.roundCode}</strong>
                  </Link>
                </td>
                <td>
                  <Link to={`/production/${row.productionRunId}`}>{row.runCode}</Link>
                </td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>{formatDateTime(row.endedAt)}</td>
                <td>{row.controllerName}</td>
                <td>
                  {row.linesCompleted} / {row.linesVisited}
                </td>
                <td>
                  {row.employeesControlled} / {row.employeesExpected}
                </td>
                <td className="nombre">
                  {row.coveragePercent === null ? '-' : `${row.coveragePercent} %`}
                </td>
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
