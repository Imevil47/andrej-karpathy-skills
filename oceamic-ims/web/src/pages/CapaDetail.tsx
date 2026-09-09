import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, label } from '../format';
import { useResource } from '../hooks';
import { useUsers } from '../masterdata';

type CapaDetail = Readonly<{
  capa: Readonly<{
    id: string;
    capaCode: string;
    sourceNonconformityCode: string | null;
    title: string;
    description: string;
    capaType: string;
    priority: string;
    ownerName: string;
    openedAt: string;
    dueAt: string | null;
    isOverdue: boolean;
    effectivenessRequired: boolean;
    latestEffective: boolean | null;
    status: string;
    canClose: boolean;
  }>;
  actions: readonly Readonly<{
    id: string;
    actionType: string;
    description: string;
    responsibleName: string;
    plannedDate: string | null;
    dueDate: string | null;
    completedAt: string | null;
    status: string;
    isOverdue: boolean;
    completionEvidence: string | null;
  }>[];
  effectivenessChecks: readonly Readonly<{
    id: string;
    checkedAt: string;
    checkedByName: string;
    method: string;
    result: string;
    effective: boolean;
    notes: string | null;
  }>[];
}>;

/** CAPA (section 41) : la clôture est un bouton unique, jamais atteignable
 * tant que `canClose` (venant de capa_summary) est faux. */
export function CapaDetail() {
  const { id } = useParams();
  const resource = useResource<CapaDetail>(`/api/capa/${id}`);
  const { can } = useAuth();
  const users = useUsers();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [actionType, setActionType] = useState('ACTION_CORRECTIVE');
  const [actionDescription, setActionDescription] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');

  const [checkMethod, setCheckMethod] = useState('');
  const [checkResult, setCheckResult] = useState('');
  const [effective, setEffective] = useState(true);

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
    return <div className="message erreur">{resource.error ?? 'CAPA introuvable.'}</div>;
  }

  const { capa, actions, effectivenessChecks } = resource.data;
  const isOpen = capa.status !== 'CLOTUREE' && capa.status !== 'ANNULEE';

  return (
    <>
      <PageHeader
        title={`CAPA ${capa.capaCode}`}
        subtitle={capa.title}
        actions={<Badge value={capa.status} />}
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Source', value: capa.sourceNonconformityCode ?? 'Aucune (préventif)' },
            { key: 'Type', value: label(capa.capaType) },
            { key: 'Priorité', value: label(capa.priority) },
            { key: 'Description', value: capa.description },
            { key: 'Responsable', value: capa.ownerName },
            { key: 'Ouverture', value: formatDate(capa.openedAt) },
            {
              key: 'Échéance',
              value: capa.dueAt ? (
                <>
                  {formatDate(capa.dueAt)}
                  {capa.isOverdue ? <span className="badge alerte" style={{ marginLeft: 8 }}>En retard</span> : null}
                </>
              ) : (
                '-'
              ),
            },
            {
              key: "Contrôle d'efficacité",
              value: capa.effectivenessRequired
                ? capa.latestEffective === null
                  ? 'Requis, non encore vérifié'
                  : capa.latestEffective
                    ? 'Efficace'
                    : 'Non efficace'
                : 'Non requis',
            },
          ]}
        />
        {isOpen ? (
          <div className="ligne-boutons">
            {can('capa:approve') ? (
              <button
                type="button"
                disabled={!capa.canClose}
                onClick={() => call(() => apiPost(`/api/capa/${capa.id}/cloture`, {}), 'CAPA clôturé.')}
                title={capa.canClose ? undefined : 'Clôture impossible : des actions obligatoires restent ouvertes.'}
              >
                Clôturer
              </button>
            ) : null}
            {can('capa:manage') ? (
              <button
                type="button"
                className="danger"
                onClick={() =>
                  call(
                    () => apiPost(`/api/capa/${capa.id}/annulation`, { reason: 'Annulé depuis la fiche CAPA.' }),
                    'CAPA annulé.',
                  )
                }
              >
                Annuler
              </button>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card title="Actions">
        {can('capa:manage') && isOpen ? (
          <form
            className="grille-champs"
            style={{ marginBottom: 18 }}
            onSubmit={(event) => {
              event.preventDefault();
              void call(
                () =>
                  apiPost(`/api/capa/${capa.id}/actions`, {
                    actionType,
                    description: actionDescription.trim(),
                    responsibleUserId,
                    plannedDate: null,
                    dueDate: null,
                  }),
                'Action ajoutée.',
              ).then(() => {
                setActionDescription('');
                setResponsibleUserId('');
              });
            }}
          >
            <Field label="Type" hint={null}>
              <select value={actionType} onChange={(event) => setActionType(event.target.value)}>
                <option value="CORRECTION">Correction</option>
                <option value="ACTION_CORRECTIVE">Action corrective</option>
                <option value="ACTION_PREVENTIVE">Action préventive</option>
                <option value="VERIFICATION">Vérification</option>
              </select>
            </Field>
            <Field label="Description" hint={null}>
              <input value={actionDescription} onChange={(event) => setActionDescription(event.target.value)} required />
            </Field>
            <Field label="Responsable" hint={null}>
              <select value={responsibleUserId} onChange={(event) => setResponsibleUserId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {(users.data ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button type="submit" className="secondaire">
                Ajouter
              </button>
            </div>
          </form>
        ) : null}
        <DataTable
          columns={[
            { key: 'type', label: 'Type', numeric: false },
            { key: 'description', label: 'Description', numeric: false },
            { key: 'responsable', label: 'Responsable', numeric: false },
            { key: 'echeance', label: 'Échéance', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'action', label: '', numeric: false },
          ]}
          isEmpty={actions.length === 0}
          emptyText="Aucune action."
        >
          {actions.map((row) => (
            <tr key={row.id}>
              <td>{label(row.actionType)}</td>
              <td>{row.description}</td>
              <td>{row.responsibleName}</td>
              <td>
                {formatDate(row.dueDate)}
                {row.isOverdue ? <div className="badge alerte" style={{ marginTop: 4 }}>En retard</div> : null}
              </td>
              <td>
                <Badge value={row.status} />
              </td>
              <td>
                {can('action:complete') && row.status !== 'TERMINEE' && row.status !== 'ANNULEE' ? (
                  <button
                    type="button"
                    className="lien"
                    onClick={() =>
                      call(
                        () => apiPost(`/api/capa-actions/${row.id}/completion`, { evidence: null }),
                        'Action terminée.',
                      )
                    }
                  >
                    Terminer
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>

      {capa.effectivenessRequired ? (
        <Card title="Vérification d'efficacité">
          {can('capa:manage') && isOpen ? (
            <form
              className="grille-champs"
              style={{ marginBottom: 18 }}
              onSubmit={(event) => {
                event.preventDefault();
                void call(
                  () =>
                    apiPost(`/api/capa/${capa.id}/efficacite`, {
                      checkedAt: new Date().toISOString(),
                      method: checkMethod.trim(),
                      result: checkResult.trim(),
                      effective,
                      notes: null,
                    }),
                  "Contrôle d'efficacité enregistré.",
                ).then(() => {
                  setCheckMethod('');
                  setCheckResult('');
                });
              }}
            >
              <Field label="Méthode de vérification" hint={null}>
                <input value={checkMethod} onChange={(event) => setCheckMethod(event.target.value)} required />
              </Field>
              <Field label="Résultat constaté" hint={null}>
                <input value={checkResult} onChange={(event) => setCheckResult(event.target.value)} required />
              </Field>
              <Field label="Efficace" hint={null}>
                <select value={effective ? 'oui' : 'non'} onChange={(event) => setEffective(event.target.value === 'oui')}>
                  <option value="oui">Oui</option>
                  <option value="non">Non</option>
                </select>
              </Field>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button type="submit" className="secondaire">
                  Enregistrer
                </button>
              </div>
            </form>
          ) : null}
          <DataTable
            columns={[
              { key: 'date', label: 'Date', numeric: false },
              { key: 'methode', label: 'Méthode', numeric: false },
              { key: 'resultat', label: 'Résultat', numeric: false },
              { key: 'efficace', label: 'Efficace', numeric: false },
              { key: 'controleur', label: 'Contrôlé par', numeric: false },
            ]}
            isEmpty={effectivenessChecks.length === 0}
            emptyText="Aucun contrôle d'efficacité enregistré."
          >
            {effectivenessChecks.map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.checkedAt)}</td>
                <td>{row.method}</td>
                <td>{row.result}</td>
                <td>{row.effective ? <Badge value="CONFORME" /> : <Badge value="NON_CONFORME" />}</td>
                <td>{row.checkedByName}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {capa.sourceNonconformityCode ? (
        <p>
          <Link to="/qualite/non-conformites">Retour aux non-conformités</Link>
        </p>
      ) : null}
    </>
  );
}
