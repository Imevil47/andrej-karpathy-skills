import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Message, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';

type SeamingOperationRow = Readonly<{
  id: string;
  operationCode: string;
  productionRunId: string;
  runCode: string;
  machineCode: string | null;
  startedAt: string;
  endedAt: string | null;
  status: string;
  lastControlAt: string | null;
  lastControlResult: string | null;
}>;

/** Opérations de sertissage actives (section 49). */
export function Sertissage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, error, loading, reload } = useResource<readonly SeamingOperationRow[]>(
    '/api/seaming-operations',
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const startControl = async (operationId: string) => {
    setActionError(null);
    try {
      const created = await apiPost<{ id: string }>(`/api/seaming-operations/${operationId}/controles`, {
        machineId: null,
        controlledAt: new Date().toISOString(),
        notes: null,
      });
      navigate(`/qualite/controles-sertissage/${created.id}`);
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  const closeOperation = async (operationId: string) => {
    setActionError(null);
    try {
      await apiPost(`/api/seaming-operations/${operationId}/cloture`, {});
      reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Sertissage" subtitle="Opérations de sertissage" actions={null} />
      <Message kind="erreur" text={actionError} />

      <Card title={null}>
        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'run', label: 'Run', numeric: false },
              { key: 'machine', label: 'Machine', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'dernier', label: 'Dernier contrôle', numeric: false },
              { key: 'resultat', label: 'Résultat', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'actions', label: '', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune opération de sertissage."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/production/${row.productionRunId}`}>{row.runCode}</Link>
                </td>
                <td>{row.machineCode ?? '-'}</td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>{row.lastControlAt ? formatDateTime(row.lastControlAt) : '-'}</td>
                <td>{row.lastControlResult ? <Badge value={row.lastControlResult} /> : '-'}</td>
                <td>
                  <Badge value={row.status} />
                </td>
                <td>
                  {row.status === 'EN_COURS' ? (
                    <div className="ligne-boutons" style={{ marginTop: 0 }}>
                      {can('seaming:control') ? (
                        <button type="button" className="lien" onClick={() => void startControl(row.id)}>
                          Nouveau contrôle
                        </button>
                      ) : null}
                      {can('seaming:operate') ? (
                        <button type="button" className="lien" onClick={() => void closeOperation(row.id)}>
                          Terminer
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
