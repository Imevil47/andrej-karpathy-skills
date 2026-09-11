import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiPatch, apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader, Tabs } from '../components/ui';
import { formatDate, formatDateTime, formatDuration, label } from '../format';
import { useResource } from '../hooks';
import { useFailureCauses, useFailureModes, useSpareParts } from '../masterdata';

type WorkOrderDetail = Readonly<{
  id: string;
  workOrderCode: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  productionLineCode: string | null;
  workOrderType: string;
  priority: string;
  status: string;
  title: string;
  description: string | null;
  requestedAt: string;
  requestedByName: string;
  dueAt: string | null;
  assignedToName: string | null;
  failureReportId: string | null;
  failureCode: string | null;
  restoredAt: string | null;
  restoredByName: string | null;
  verificationResult: string | null;
  closedAt: string | null;
  closedByName: string | null;
}>;

type InterventionRow = Readonly<{
  id: string;
  technicianName: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  diagnostic: string | null;
  actionPerformed: string | null;
  failureModeCode: string | null;
  failureCauseCode: string | null;
}>;

type WorkOrderStatus =
  | 'OUVERT'
  | 'PLANIFIE'
  | 'EN_COURS'
  | 'EN_ATTENTE_PIECE'
  | 'EN_ATTENTE_PRODUCTION'
  | 'TERMINE'
  | 'ANNULE';

// Mirrors server/src/domain/types.ts WORK_ORDER_ALLOWED_TRANSITIONS /
// WORK_ORDER_PRIMARY_NEXT_STATUS - TERMINE is excluded, it goes through the
// dedicated closure form below with its own approval gate.
const WO_ALLOWED_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  OUVERT: ['PLANIFIE', 'EN_COURS', 'ANNULE'],
  PLANIFIE: ['EN_COURS', 'ANNULE'],
  EN_COURS: ['EN_ATTENTE_PIECE', 'EN_ATTENTE_PRODUCTION', 'ANNULE'],
  EN_ATTENTE_PIECE: ['EN_COURS', 'ANNULE'],
  EN_ATTENTE_PRODUCTION: ['EN_COURS', 'ANNULE'],
  TERMINE: [],
  ANNULE: [],
};
const WO_PRIMARY_NEXT_STATUS: Readonly<Partial<Record<WorkOrderStatus, WorkOrderStatus>>> = {
  OUVERT: 'PLANIFIE',
  PLANIFIE: 'EN_COURS',
  EN_ATTENTE_PIECE: 'EN_COURS',
  EN_ATTENTE_PRODUCTION: 'EN_COURS',
};

const TABS = [
  { key: 'general', label: 'Vue générale' },
  { key: 'interventions', label: 'Interventions' },
] as const;

/** Ordre de travail (section 45) : statut contraint côté serveur, clôture
 * gérée par un formulaire dédié (section 15/52), interventions en flux
 * rapide (section 46 : Démarrer → Diagnostic → Action → Pièces → Terminer). */
export function OrdreDeTravailDetail() {
  const { id } = useParams();
  const resource = useResource<WorkOrderDetail>(`/api/work-orders/${id}`);
  const interventions = useResource<readonly InterventionRow[]>(`/api/work-orders/${id}/interventions`);
  const { can } = useAuth();
  const failureModes = useFailureModes();
  const failureCauses = useFailureCauses();
  const spareParts = useSpareParts();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('general');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [secondaryStatus, setSecondaryStatus] = useState('');
  const [verificationResult, setVerificationResult] = useState('');

  const [diagnostic, setDiagnostic] = useState('');
  const [actionPerformed, setActionPerformed] = useState('');
  const [failureModeId, setFailureModeId] = useState('');
  const [failureCauseId, setFailureCauseId] = useState('');
  const [partId, setPartId] = useState('');
  const [partQuantity, setPartQuantity] = useState('');

  const call = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      resource.reload();
      interventions.reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  if (resource.loading && resource.data === null) {
    return <p>Chargement...</p>;
  }
  if (resource.data === null) {
    return <div className="message erreur">{resource.error ?? 'Ordre de travail introuvable.'}</div>;
  }

  const wo = resource.data;
  const status = wo.status as WorkOrderStatus;
  const isClosed = status === 'TERMINE' || status === 'ANNULE';
  const primaryNext = WO_PRIMARY_NEXT_STATUS[status] ?? null;
  const otherOptions = WO_ALLOWED_TRANSITIONS[status].filter((value) => value !== primaryNext);
  const openIntervention = (interventions.data ?? []).find((row) => row.endedAt === null) ?? null;
  const canManage = can('workorder:manage') || can('workorder:approve');

  const changeStatus = (next: WorkOrderStatus) =>
    call(() => apiPost(`/api/work-orders/${wo.id}/statut`, { statut: next }), `Statut : ${label(next)}.`);

  return (
    <>
      <PageHeader
        title={`Ordre de travail ${wo.workOrderCode}`}
        subtitle={wo.title}
        actions={
          <>
            <Badge value={wo.priority} />
            <Badge value={wo.status} />
          </>
        }
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Tabs tabs={TABS} active={tab} onSelect={(key) => setTab(key as (typeof TABS)[number]['key'])} />

      {tab === 'general' ? (
        <>
          <Card title={null}>
            <KeyValue
              items={[
                { key: 'Équipement', value: `${wo.equipmentCode} — ${wo.equipmentName}` },
                { key: 'Ligne', value: wo.productionLineCode ?? '-' },
                { key: 'Type', value: label(wo.workOrderType) },
                { key: 'Description', value: wo.description ?? '-' },
                { key: 'Panne source', value: wo.failureCode ?? '-' },
                { key: 'Demandé par', value: wo.requestedByName },
                { key: 'Demandé le', value: formatDateTime(wo.requestedAt) },
                { key: 'Assigné à', value: wo.assignedToName ?? '-' },
                { key: 'Échéance', value: formatDate(wo.dueAt) },
              ]}
            />
            {canManage && !isClosed ? (
              <div className="ligne-boutons">
                {primaryNext ? (
                  <button type="button" onClick={() => void changeStatus(primaryNext)}>
                    Passer à « {label(primaryNext)} »
                  </button>
                ) : null}
                {otherOptions.length > 0 ? (
                  <>
                    <select value={secondaryStatus} onChange={(event) => setSecondaryStatus(event.target.value)}>
                      <option value="">Changer le statut...</option>
                      {otherOptions.map((value) => (
                        <option key={value} value={value}>
                          {label(value)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="secondaire"
                      disabled={secondaryStatus === ''}
                      onClick={() => {
                        void changeStatus(secondaryStatus as WorkOrderStatus).then(() => setSecondaryStatus(''));
                      }}
                    >
                      Appliquer
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </Card>

          {isClosed ? (
            <Card title="Remise en service">
              <KeyValue
                items={[
                  { key: 'Clôturé par', value: wo.closedByName ?? '-' },
                  { key: 'Clôturé le', value: formatDateTime(wo.closedAt) },
                  { key: 'Remis en service le', value: formatDateTime(wo.restoredAt) },
                  { key: 'Remis en service par', value: wo.restoredByName ?? '-' },
                  { key: 'Résultat de vérification', value: wo.verificationResult ? <Badge value={wo.verificationResult} /> : '-' },
                ]}
              />
            </Card>
          ) : canManage ? (
            <Card title="Clôturer l'ordre de travail">
              <p className="aide">
                Nécessite au moins une intervention avec une action réalisée documentée. Un résultat de
                vérification est requis pour un équipement à criticité haute/critique ou un OT urgent
                (RESPONSABLE_MAINTENANCE).
              </p>
              <div className="ligne-boutons">
                <select value={verificationResult} onChange={(event) => setVerificationResult(event.target.value)}>
                  <option value="">Résultat de vérification (si requis)</option>
                  <option value="CONFORME">Conforme</option>
                  <option value="NON_CONFORME">Non conforme</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    call(
                      () =>
                        apiPost(`/api/work-orders/${wo.id}/cloture`, {
                          verificationResult: verificationResult === '' ? null : verificationResult,
                        }),
                      'Ordre de travail clôturé.',
                    )
                  }
                >
                  Clôturer
                </button>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === 'interventions' ? (
        <>
          {can('intervention:manage') && !isClosed && openIntervention === null ? (
            <Card title="Nouvelle intervention">
              <button
                type="button"
                onClick={() =>
                  call(
                    () => apiPost(`/api/work-orders/${wo.id}/interventions`, {}),
                    'Intervention démarrée.',
                  )
                }
              >
                Démarrer une intervention
              </button>
            </Card>
          ) : null}

          {openIntervention !== null ? (
            <Card title="Intervention en cours">
              <p className="aide">Démarrée le {formatDateTime(openIntervention.startedAt)}.</p>
              <div className="grille-champs">
                <Field label="Diagnostic" hint={null}>
                  <input value={diagnostic} onChange={(event) => setDiagnostic(event.target.value)} />
                </Field>
                <Field label="Action réalisée" hint={null}>
                  <input value={actionPerformed} onChange={(event) => setActionPerformed(event.target.value)} />
                </Field>
                <Field label="Mode de défaillance" hint={null}>
                  <select value={failureModeId} onChange={(event) => setFailureModeId(event.target.value)}>
                    <option value="">Non renseigné</option>
                    {(failureModes.data ?? []).map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Cause" hint="« Cause non déterminée » reste un choix valide.">
                  <select value={failureCauseId} onChange={(event) => setFailureCauseId(event.target.value)}>
                    <option value="">Non renseignée</option>
                    {(failureCauses.data ?? []).map((cause) => (
                      <option key={cause.id} value={cause.id}>
                        {cause.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="ligne-boutons">
                <button
                  type="button"
                  className="secondaire"
                  onClick={() =>
                    call(
                      () =>
                        apiPatch(`/api/interventions/${openIntervention.id}`, {
                          diagnostic: diagnostic.trim() === '' ? null : diagnostic.trim(),
                          actionPerformed: actionPerformed.trim() === '' ? null : actionPerformed.trim(),
                          failureModeId: failureModeId === '' ? null : failureModeId,
                          failureCauseId: failureCauseId === '' ? null : failureCauseId,
                        }),
                      'Intervention mise à jour.',
                    )
                  }
                >
                  Enregistrer le diagnostic
                </button>
              </div>

              <div style={{ marginTop: 18 }}>
                <h3>Pièces utilisées</h3>
                <div className="ligne-boutons" style={{ marginTop: 0 }}>
                  <select value={partId} onChange={(event) => setPartId(event.target.value)}>
                    <option value="">Sélectionner une pièce...</option>
                    {(spareParts.data ?? []).map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.partCode} — {part.name} (stock : {part.currentStock})
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Quantité"
                    value={partQuantity}
                    onChange={(event) => setPartQuantity(event.target.value)}
                    style={{ maxWidth: 120 }}
                  />
                  <button
                    type="button"
                    className="secondaire"
                    disabled={partId === '' || partQuantity === ''}
                    onClick={() =>
                      call(
                        () =>
                          apiPost(`/api/interventions/${openIntervention.id}/pieces`, {
                            sparePartId: partId,
                            quantity: partQuantity,
                          }),
                        'Pièce enregistrée.',
                      ).then(() => {
                        setPartId('');
                        setPartQuantity('');
                        spareParts.reload();
                      })
                    }
                  >
                    Ajouter
                  </button>
                </div>
              </div>

              <div className="ligne-boutons">
                <button
                  type="button"
                  onClick={() =>
                    call(
                      () =>
                        apiPost(`/api/interventions/${openIntervention.id}/cloture`, {
                          actionPerformed: actionPerformed.trim() === '' ? null : actionPerformed.trim(),
                        }),
                      'Intervention terminée.',
                    ).then(() => {
                      setDiagnostic('');
                      setActionPerformed('');
                      setFailureModeId('');
                      setFailureCauseId('');
                    })
                  }
                >
                  Terminer l'intervention
                </button>
              </div>
            </Card>
          ) : null}

          <Card title="Historique des interventions">
            <DataTable
              columns={[
                { key: 'technicien', label: 'Technicien', numeric: false },
                { key: 'debut', label: 'Début', numeric: false },
                { key: 'duree', label: 'Durée', numeric: false },
                { key: 'diagnostic', label: 'Diagnostic', numeric: false },
                { key: 'action', label: 'Action réalisée', numeric: false },
                { key: 'mode', label: 'Mode / cause', numeric: false },
              ]}
              isEmpty={(interventions.data ?? []).length === 0}
              emptyText="Aucune intervention."
            >
              {(interventions.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.technicianName}</td>
                  <td>{formatDateTime(row.startedAt)}</td>
                  <td>{formatDuration(row.durationSeconds)}</td>
                  <td>{row.diagnostic ?? '-'}</td>
                  <td>{row.actionPerformed ?? '-'}</td>
                  <td>
                    {label(row.failureModeCode)} / {label(row.failureCauseCode)}
                  </td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </>
      ) : null}
    </>
  );
}
