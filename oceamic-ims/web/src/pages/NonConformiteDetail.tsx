import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader, Tabs } from '../components/ui';
import { formatDateTime, label } from '../format';
import { useResource } from '../hooks';
import { useUsers } from '../masterdata';

type NonconformityDetail = Readonly<{
  nonconformity: Readonly<{
    id: string;
    nonconformityCode: string;
    detectedAt: string;
    title: string;
    description: string;
    sourceType: string | null;
    sourceId: string | null;
    sourceLabel: string | null;
    categoryName: string;
    severity: string;
    priority: string;
    status: string;
    detectedByName: string;
    ownerName: string | null;
    dueAt: string | null;
    isOverdue: boolean;
    qualityBlockRequired: boolean;
    blockEntityType: string | null;
    blockEntityId: string | null;
    blockReferenceId: string | null;
  }>;
  links: readonly Readonly<{ entityType: string; entityId: string; relationshipType: string; label: string | null }>[];
  investigations: readonly Readonly<{
    id: string;
    startedAt: string;
    completedAt: string | null;
    investigatorName: string;
    facts: string;
    immediateCorrection: string | null;
    impactAssessment: string | null;
    rootCauseRequired: boolean;
    notes: string | null;
  }>[];
  rootCauses: readonly Readonly<{
    id: string;
    method: string;
    analysisText: string;
    rootCause: string;
    validatedByName: string | null;
    validatedAt: string | null;
  }>[];
  capas: readonly Readonly<{ id: string; capaCode: string; capaType: string; status: string }>[];
}>;

type AuditEntry = Readonly<{ id: string; occurredAt: string; action: string; userName: string | null }>;

const STATUSES = ['OUVERTE', 'EN_ANALYSE', 'ACTION_REQUISE', 'EN_ATTENTE', 'A_VERIFIER', 'CLOTUREE', 'ANNULEE'] as const;
const TABS = [
  { key: 'general', label: 'Vue générale' },
  { key: 'source', label: 'Source & liens' },
  { key: 'investigation', label: 'Investigation' },
  { key: 'cause', label: 'Cause racine' },
  { key: 'capa', label: 'CAPA liés' },
  { key: 'blocage', label: 'Blocage' },
  { key: 'historique', label: 'Historique' },
] as const;

export function NonConformiteDetail() {
  const { id } = useParams();
  const resource = useResource<NonconformityDetail>(`/api/nonconformities/${id}`);
  const history = useResource<readonly AuditEntry[]>(`/api/audit?entite=${id}`);
  const { can } = useAuth();
  const users = useUsers();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('general');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [investigator, setInvestigator] = useState('');
  const [facts, setFacts] = useState('');
  const [method, setMethod] = useState('5_POURQUOI');
  const [analysisText, setAnalysisText] = useState('');
  const [rootCause, setRootCause] = useState('');

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
    return <div className="message erreur">{resource.error ?? 'Non-conformité introuvable.'}</div>;
  }

  const { nonconformity, links, investigations, rootCauses, capas } = resource.data;
  const isOpen = nonconformity.status !== 'CLOTUREE' && nonconformity.status !== 'ANNULEE';

  return (
    <>
      <PageHeader
        title={`Non-conformité ${nonconformity.nonconformityCode}`}
        subtitle={nonconformity.title}
        actions={
          <>
            <Badge value={nonconformity.severity} />
            <Badge value={nonconformity.status} />
          </>
        }
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Tabs tabs={TABS} active={tab} onSelect={(key) => setTab(key as (typeof TABS)[number]['key'])} />

      {tab === 'general' ? (
        <Card title={null}>
          <KeyValue
            items={[
              { key: 'Catégorie', value: nonconformity.categoryName },
              { key: 'Priorité', value: label(nonconformity.priority) },
              { key: 'Description', value: nonconformity.description },
              { key: 'Détectée le', value: formatDateTime(nonconformity.detectedAt) },
              { key: 'Détectée par', value: nonconformity.detectedByName },
              { key: 'Responsable', value: nonconformity.ownerName ?? '-' },
              {
                key: 'Échéance',
                value: nonconformity.dueAt ? (
                  <>
                    {formatDateTime(nonconformity.dueAt)}
                    {nonconformity.isOverdue ? <span className="badge alerte" style={{ marginLeft: 8 }}>En retard</span> : null}
                  </>
                ) : (
                  '-'
                ),
              },
            ]}
          />
          {can('ncr:manage') && isOpen ? (
            <div className="ligne-boutons">
              {STATUSES.filter((status) => status !== nonconformity.status).map((status) => (
                <button
                  key={status}
                  type="button"
                  className="secondaire"
                  onClick={() =>
                    call(
                      () => apiPost(`/api/nonconformities/${nonconformity.id}/statut`, { status, reason: null }),
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
      ) : null}

      {tab === 'source' ? (
        <Card title="Source et entités liées">
          <KeyValue
            items={[
              { key: 'Type de source', value: label(nonconformity.sourceType) },
              { key: 'Entité source', value: nonconformity.sourceLabel ?? '-' },
            ]}
          />
          <DataTable
            columns={[
              { key: 'type', label: 'Type', numeric: false },
              { key: 'entite', label: 'Entité', numeric: false },
              { key: 'relation', label: 'Relation', numeric: false },
            ]}
            isEmpty={links.length === 0}
            emptyText="Aucun lien enregistré."
          >
            {links.map((link) => (
              <tr key={`${link.entityType}-${link.entityId}-${link.relationshipType}`}>
                <td>{label(link.entityType)}</td>
                <td>{link.label ?? link.entityId}</td>
                <td>{label(link.relationshipType)}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'investigation' ? (
        <Card title="Investigation">
          {can('ncr:manage') && isOpen ? (
            <form
              className="grille-champs"
              onSubmit={(event) => {
                event.preventDefault();
                void call(
                  () =>
                    apiPost(`/api/nonconformities/${nonconformity.id}/investigation`, {
                      startedAt: new Date().toISOString(),
                      completedAt: new Date().toISOString(),
                      investigatorUserId: investigator,
                      facts: facts.trim(),
                      immediateCorrection: null,
                      impactAssessment: null,
                      rootCauseRequired: true,
                      notes: null,
                    }),
                  'Investigation enregistrée.',
                ).then(() => {
                  setInvestigator('');
                  setFacts('');
                });
              }}
              style={{ marginBottom: 18 }}
            >
              <Field label="Enquêteur" hint={null}>
                <select value={investigator} onChange={(event) => setInvestigator(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(users.data ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.fullName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Faits constatés" hint={null}>
                <input value={facts} onChange={(event) => setFacts(event.target.value)} required />
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
              { key: 'date', label: 'Débutée le', numeric: false },
              { key: 'enqueteur', label: 'Enquêteur', numeric: false },
              { key: 'faits', label: 'Faits', numeric: false },
              { key: 'correction', label: 'Correction immédiate', numeric: false },
            ]}
            isEmpty={investigations.length === 0}
            emptyText="Aucune investigation enregistrée."
          >
            {investigations.map((investigation) => (
              <tr key={investigation.id}>
                <td>{formatDateTime(investigation.startedAt)}</td>
                <td>{investigation.investigatorName}</td>
                <td>{investigation.facts}</td>
                <td>{investigation.immediateCorrection ?? '-'}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'cause' ? (
        <Card title="Analyse de cause racine">
          {can('ncr:manage') && isOpen ? (
            <form
              className="grille-champs"
              onSubmit={(event) => {
                event.preventDefault();
                void call(
                  () =>
                    apiPost(`/api/nonconformities/${nonconformity.id}/cause-racine`, {
                      method,
                      analysisText: analysisText.trim(),
                      rootCause: rootCause.trim(),
                    }),
                  'Analyse de cause racine enregistrée.',
                ).then(() => {
                  setAnalysisText('');
                  setRootCause('');
                });
              }}
              style={{ marginBottom: 18 }}
            >
              <Field label="Méthode" hint={null}>
                <select value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value="5_POURQUOI">5 pourquoi</option>
                  <option value="ISHIKAWA">Ishikawa</option>
                  <option value="PARETO">Pareto</option>
                  <option value="ANALYSE_SIMPLE">Analyse simple</option>
                  <option value="AUTRE">Autre</option>
                </select>
              </Field>
              <Field label="Analyse" hint={null}>
                <input value={analysisText} onChange={(event) => setAnalysisText(event.target.value)} required />
              </Field>
              <Field label="Cause racine identifiée" hint={null}>
                <input value={rootCause} onChange={(event) => setRootCause(event.target.value)} required />
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
              { key: 'methode', label: 'Méthode', numeric: false },
              { key: 'cause', label: 'Cause racine', numeric: false },
              { key: 'validation', label: 'Validation', numeric: false },
              { key: 'actions', label: '', numeric: false },
            ]}
            isEmpty={rootCauses.length === 0}
            emptyText="Aucune analyse de cause racine."
          >
            {rootCauses.map((analysis) => (
              <tr key={analysis.id}>
                <td>{label(analysis.method)}</td>
                <td>{analysis.rootCause}</td>
                <td>
                  {analysis.validatedByName ? `Validée par ${analysis.validatedByName}` : 'Non validée'}
                </td>
                <td>
                  {can('ncr:approve') && analysis.validatedByName === null ? (
                    <button
                      type="button"
                      className="lien"
                      onClick={() =>
                        call(
                          () => apiPost(`/api/root-cause-analyses/${analysis.id}/validation`, {}),
                          'Cause racine validée.',
                        )
                      }
                    >
                      Valider
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}

      {tab === 'capa' ? (
        <Card title="CAPA liés">
          <DataTable
            columns={[
              { key: 'code', label: 'CAPA', numeric: false },
              { key: 'type', label: 'Type', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={capas.length === 0}
            emptyText="Aucun CAPA lié."
          >
            {capas.map((capa) => (
              <tr key={capa.id}>
                <td>
                  <Link to={`/qualite/capa/${capa.id}`}>
                    <strong>{capa.capaCode}</strong>
                  </Link>
                </td>
                <td>{label(capa.capaType)}</td>
                <td>
                  <Badge value={capa.status} />
                </td>
              </tr>
            ))}
          </DataTable>
          {can('capa:manage') ? (
            <Link to={`/qualite/capa?ncr=${nonconformity.id}`}>
              <button type="button" className="secondaire" style={{ marginTop: 14 }}>
                Créer un CAPA depuis cette non-conformité
              </button>
            </Link>
          ) : null}
        </Card>
      ) : null}

      {tab === 'blocage' ? (
        <Card title="Blocage qualité">
          <KeyValue
            items={[
              { key: 'Blocage requis', value: nonconformity.qualityBlockRequired ? 'Oui' : 'Non' },
              { key: 'Entité bloquée', value: label(nonconformity.blockEntityType) },
              { key: 'Référence du blocage', value: nonconformity.blockReferenceId ?? '-' },
            ]}
          />
          {can('ncr:manage') && isOpen && nonconformity.blockReferenceId === null ? (
            <BlockageForm nonconformityId={nonconformity.id} onDone={() => call(async () => undefined, 'Blocage déclenché.')} />
          ) : null}
        </Card>
      ) : null}

      {tab === 'historique' ? (
        <Card title="Historique">
          <DataTable
            columns={[
              { key: 'date', label: 'Date', numeric: false },
              { key: 'action', label: 'Action', numeric: false },
              { key: 'utilisateur', label: 'Utilisateur', numeric: false },
            ]}
            isEmpty={(history.data ?? []).length === 0}
            emptyText="Aucun évènement."
          >
            {(history.data ?? []).map((entry) => (
              <tr key={entry.id}>
                <td>{formatDateTime(entry.occurredAt)}</td>
                <td>{entry.action}</td>
                <td>{entry.userName ?? '-'}</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}
    </>
  );
}

function BlockageForm({ nonconformityId, onDone }: { nonconformityId: string; onDone: () => void }) {
  const [entityType, setEntityType] = useState<'RAW_MATERIAL_LOT' | 'FINISHED_GOOD_LOT' | 'PALLET'>('RAW_MATERIAL_LOT');
  const [entityId, setEntityId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grille-champs"
      style={{ marginTop: 14 }}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        apiPost(`/api/nonconformities/${nonconformityId}/blocage`, { entityType, entityId, reason: reason.trim() })
          .then(onDone)
          .catch((failure: Error) => setError(failure.message));
      }}
    >
      {error ? <div className="message erreur">{error}</div> : null}
      <Field label="Type d'entité" hint={null}>
        <select value={entityType} onChange={(event) => setEntityType(event.target.value as typeof entityType)}>
          <option value="RAW_MATERIAL_LOT">Lot matière première</option>
          <option value="FINISHED_GOOD_LOT">Lot PF</option>
          <option value="PALLET">Palette</option>
        </select>
      </Field>
      <Field label="Identifiant de l'entité" hint="UUID du lot ou de la palette.">
        <input value={entityId} onChange={(event) => setEntityId(event.target.value)} required />
      </Field>
      <Field label="Motif" hint={null}>
        <input value={reason} onChange={(event) => setReason(event.target.value)} required />
      </Field>
      <div style={{ display: 'flex', alignItems: 'end' }}>
        <button type="submit" className="secondaire">
          Déclencher le blocage
        </button>
      </div>
    </form>
  );
}
