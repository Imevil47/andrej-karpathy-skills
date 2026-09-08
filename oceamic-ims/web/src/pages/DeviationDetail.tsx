import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDateTime, label } from '../format';
import { useResource } from '../hooks';

type DeviationDetail = Readonly<{
  deviation: Readonly<{
    id: string;
    deviationCode: string;
    runCode: string | null;
    productionRunId: string | null;
    cycleCode: string | null;
    sterilizationCycleId: string | null;
    processStage: string;
    detectedAt: string;
    deviationType: string;
    description: string;
    severity: string;
    status: string;
    detectedByName: string;
  }>;
  actions: readonly Readonly<{
    id: string;
    actionDescription: string;
    responsibleName: string | null;
    dueAt: string | null;
    completedAt: string | null;
    verificationNotes: string | null;
    status: string;
  }>[];
}>;

const STATUSES = ['OUVERTE', 'EN_ANALYSE', 'ACTION_REQUISE', 'CLOTUREE', 'ANNULEE'] as const;

export function DeviationDetail() {
  const { id } = useParams();
  const resource = useResource<DeviationDetail>(`/api/deviations/${id}`);
  const { can } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionDescription, setActionDescription] = useState('');

  const call = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      resource.reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  if (resource.loading && resource.data === null) {
    return <p>Chargement...</p>;
  }
  if (resource.data === null) {
    return <div className="message erreur">{resource.error ?? 'Déviation introuvable.'}</div>;
  }

  const { deviation, actions } = resource.data;
  const isOpen = deviation.status !== 'CLOTUREE' && deviation.status !== 'ANNULEE';

  return (
    <>
      <PageHeader
        title={`Déviation ${deviation.deviationCode}`}
        subtitle={
          deviation.productionRunId ? (
            <Link to={`/production/${deviation.productionRunId}`}>{deviation.runCode}</Link>
          ) : deviation.sterilizationCycleId ? (
            <Link to={`/production/sterilisation/${deviation.sterilizationCycleId}`}>{deviation.cycleCode}</Link>
          ) : null
        }
        actions={<Badge value={deviation.status} />}
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Étape', value: deviation.processStage },
            { key: 'Type', value: deviation.deviationType },
            { key: 'Gravité', value: <Badge value={deviation.severity} /> },
            { key: 'Description', value: deviation.description },
            { key: 'Détectée le', value: formatDateTime(deviation.detectedAt) },
            { key: 'Détectée par', value: deviation.detectedByName },
          ]}
        />
        {can('deviation:manage') && isOpen ? (
          <div className="ligne-boutons">
            {STATUSES.filter((status) => status !== deviation.status).map((status) => (
              <button
                key={status}
                type="button"
                className="secondaire"
                onClick={() =>
                  call(
                    () => apiPost(`/api/deviations/${deviation.id}/statut`, { status }),
                    `Statut : ${label(status)}.`,
                  )
                }
              >
                {label(status)}
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      <Card title="Actions correctives">
        {can('deviation:manage') && isOpen ? (
          <form
            className="filtres"
            onSubmit={(event) => {
              event.preventDefault();
              void call(
                () =>
                  apiPost(`/api/deviations/${deviation.id}/actions`, {
                    actionDescription: actionDescription.trim(),
                    responsibleUserId: null,
                    dueAt: null,
                  }),
                'Action corrective créée.',
              ).then(() => setActionDescription(''));
            }}
          >
            <input
              placeholder="Description de l'action corrective"
              value={actionDescription}
              onChange={(event) => setActionDescription(event.target.value)}
              style={{ minWidth: 280 }}
            />
            <button type="submit" disabled={actionDescription.trim() === ''}>
              Ajouter
            </button>
          </form>
        ) : null}

        <DataTable
          columns={[
            { key: 'description', label: 'Action', numeric: false },
            { key: 'responsable', label: 'Responsable', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'actions', label: '', numeric: false },
          ]}
          isEmpty={actions.length === 0}
          emptyText="Aucune action corrective."
        >
          {actions.map((action) => (
            <tr key={action.id}>
              <td>{action.actionDescription}</td>
              <td>{action.responsibleName ?? '-'}</td>
              <td>
                <Badge value={action.status} />
              </td>
              <td>
                {can('deviation:manage') && action.status !== 'TERMINEE' && action.status !== 'ANNULEE' ? (
                  <button
                    type="button"
                    className="lien"
                    onClick={() =>
                      call(
                        () => apiPost(`/api/corrective-actions/${action.id}/cloture`, { verificationNotes: null }),
                        'Action corrective clôturée.',
                      )
                    }
                  >
                    Clôturer
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
