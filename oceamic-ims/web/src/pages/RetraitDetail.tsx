import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDateTime, label } from '../format';
import { useResource } from '../hooks';

type RecallEventDetail = Readonly<{
  event: Readonly<{
    id: string;
    recallCode: string;
    eventType: string;
    targetEntityType: string;
    targetEntityId: string;
    targetLabel: string | null;
    openedAt: string;
    closedAt: string | null;
    severity: string;
    status: string;
    initiatedByName: string;
    affectedCount: number;
  }>;
  affected: readonly Readonly<{
    id: string;
    entityType: string;
    entityId: string;
    label: string | null;
    impactType: string;
    quantity: string | null;
    status: string;
  }>[];
}>;

type MassBalance = Readonly<{
  producedCartons: number;
  inStockCartons: number;
  blockedCartons: number;
  shippedCartons: number;
  adjustedCartons: number;
  unexplainedCartons: number;
}>;

const AFFECTED_STATUSES = ['IDENTIFIE', 'EN_TRAITEMENT', 'TRAITE'] as const;

/**
 * Retrait / rappel (sections 32-36, 61) : l'ensemble des entités affectées
 * (Runs, cycles, Lots PF, palettes, expéditions, clients) provient
 * uniquement de `computeImpact` côté serveur - cette page ne fait
 * qu'afficher ce résultat calculé.
 */
export function RetraitDetail() {
  const { id } = useParams();
  const resource = useResource<RecallEventDetail>(`/api/recall-events/${id}`);
  const { can } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [observations, setObservations] = useState('');

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

  const finishedGoodLotId =
    resource.data?.event.targetEntityType === 'FINISHED_GOOD_LOT' ? resource.data.event.targetEntityId : null;
  const massBalance = useResource<MassBalance>(
    `/api/finished-good-lots/${finishedGoodLotId ?? 'aucun'}/bilan-matiere`,
  );

  if (resource.loading && resource.data === null) {
    return <p>Chargement...</p>;
  }
  if (resource.data === null) {
    return <div className="message erreur">{resource.error ?? 'Retrait / rappel introuvable.'}</div>;
  }

  const { event, affected } = resource.data;
  const isOpen = event.status !== 'CLOTURE' && event.status !== 'ANNULE';
  const elapsedMinutes = event.closedAt
    ? Math.round((new Date(event.closedAt).getTime() - new Date(event.openedAt).getTime()) / 60000)
    : null;

  const byType = (entityType: string) => affected.filter((row) => row.entityType === entityType);

  return (
    <>
      <PageHeader
        title={`${label(event.eventType)} ${event.recallCode}`}
        subtitle={`Lot d'origine : ${event.targetLabel ?? event.targetEntityId}`}
        actions={
          <>
            <Badge value={event.severity} />
            <Badge value={event.status} />
          </>
        }
      />
      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Ouvert le', value: formatDateTime(event.openedAt) },
            { key: 'Initié par', value: event.initiatedByName },
            { key: 'Clôturé le', value: event.closedAt ? formatDateTime(event.closedAt) : '-' },
            { key: 'Durée', value: elapsedMinutes !== null ? `${elapsedMinutes} min` : '-' },
            { key: 'Entités affectées', value: String(event.affectedCount) },
          ]}
        />
        {isOpen ? (
          <div className="ligne-boutons">
            {can('recall:exercise') ? (
              <button
                type="button"
                className="secondaire"
                onClick={() => call(() => apiPost(`/api/recall-events/${event.id}/actualisation`, {}), 'Impact actualisé.')}
              >
                Actualiser l'impact
              </button>
            ) : null}
          </div>
        ) : null}
        {can('recall:exercise') && isOpen ? (
          <form
            className="grille-champs"
            style={{ marginTop: 14 }}
            onSubmit={(event_) => {
              event_.preventDefault();
              void call(
                () => apiPost(`/api/recall-events/${event.id}/cloture`, { observations: observations.trim() }),
                'Évènement clôturé.',
              );
            }}
          >
            <Field label="Observations de clôture" hint={null}>
              <input value={observations} onChange={(event_) => setObservations(event_.target.value)} required />
            </Field>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button type="submit" className="secondaire">
                Clôturer
              </button>
            </div>
          </form>
        ) : null}
      </Card>

      {finishedGoodLotId && massBalance.data ? (
        <Card title="Bilan matière du Lot PF">
          <KeyValue
            items={[
              { key: 'Produit (cartons)', value: massBalance.data.producedCartons },
              { key: 'En stock', value: massBalance.data.inStockCartons },
              { key: 'Bloqué', value: massBalance.data.blockedCartons },
              { key: 'Expédié', value: massBalance.data.shippedCartons },
              { key: 'Ajusté', value: massBalance.data.adjustedCartons },
              { key: 'Inexpliqué', value: massBalance.data.unexplainedCartons },
            ]}
          />
        </Card>
      ) : null}

      <Card title="Entités affectées">
        {(['PRODUCTION_RUN', 'STERILIZATION_CYCLE', 'FINISHED_GOOD_LOT', 'PALLET', 'SHIPMENT', 'CUSTOMER'] as const).map(
          (entityType) => {
            const rows = byType(entityType);
            if (rows.length === 0) {
              return null;
            }
            return (
              <div key={entityType} style={{ marginBottom: 18 }}>
                <h3>{label(entityType)}</h3>
                <DataTable
                  columns={[
                    { key: 'entite', label: 'Entité', numeric: false },
                    { key: 'impact', label: 'Impact', numeric: false },
                    { key: 'quantite', label: 'Quantité', numeric: true },
                    { key: 'statut', label: 'Statut', numeric: false },
                  ]}
                  isEmpty={false}
                  emptyText=""
                >
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.label ?? row.entityId}</td>
                      <td>{label(row.impactType)}</td>
                      <td className="nombre">{row.quantity ?? '-'}</td>
                      <td>
                        <Badge value={row.status} />
                        {can('recall:exercise') ? (
                          <div style={{ marginTop: 6 }}>
                            {AFFECTED_STATUSES.filter((status) => status !== row.status).map((status) => (
                              <button
                                key={status}
                                type="button"
                                className="lien"
                                style={{ marginRight: 8 }}
                                onClick={() =>
                                  call(
                                    () => apiPost(`/api/recall-affected-entities/${row.id}/statut`, { status }),
                                    `Statut : ${label(status)}.`,
                                  )
                                }
                              >
                                {label(status)}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            );
          },
        )}
      </Card>
    </>
  );
}
