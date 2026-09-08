import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Message, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';

type FillingOperationRow = Readonly<{
  id: string;
  operationCode: string;
  productionRunId: string;
  runCode: string;
  productCode: string;
  productName: string;
  lineCode: string | null;
  format: string | null;
  startedAt: string;
  endedAt: string | null;
  status: string;
  lastControlAt: string | null;
  lastControlStatus: string | null;
}>;

/** Opérations de remplissage actives, avec accès direct à un nouveau contrôle poids (section 47). */
export function Remplissage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, error, loading, reload } = useResource<readonly FillingOperationRow[]>(
    '/api/filling-operations',
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const startWeightControl = async (operationId: string) => {
    setActionError(null);
    try {
      const created = await apiPost<{ id: string }>(
        `/api/filling-operations/${operationId}/controles-poids`,
        { sampleSize: 20, controlledAt: new Date().toISOString() },
      );
      navigate(`/qualite/controles-poids/${created.id}`);
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  const closeOperation = async (operationId: string) => {
    setActionError(null);
    try {
      await apiPost(`/api/filling-operations/${operationId}/cloture`, {});
      reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Remplissage" subtitle="Opérations de remplissage" actions={null} />
      <Message kind="erreur" text={actionError} />

      <Card title={null}>
        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'run', label: 'Run', numeric: false },
              { key: 'produit', label: 'Produit', numeric: false },
              { key: 'format', label: 'Format', numeric: false },
              { key: 'ligne', label: 'Ligne', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'dernier', label: 'Dernier contrôle poids', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'actions', label: '', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune opération de remplissage."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/production/${row.productionRunId}`}>{row.runCode}</Link>
                </td>
                <td>
                  {row.productCode} — {row.productName}
                </td>
                <td>{row.format ?? '-'}</td>
                <td>{row.lineCode ?? '-'}</td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>
                  {row.lastControlAt ? (
                    <>
                      {formatDateTime(row.lastControlAt)}{' '}
                      <Badge value={row.lastControlStatus} />
                    </>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  <Badge value={row.status} />
                </td>
                <td>
                  {row.status === 'EN_COURS' ? (
                    <div className="ligne-boutons" style={{ marginTop: 0 }}>
                      {can('weight:control') ? (
                        <button
                          type="button"
                          className="lien"
                          onClick={() => void startWeightControl(row.id)}
                        >
                          Nouveau contrôle poids
                        </button>
                      ) : null}
                      {can('filling:manage') ? (
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
