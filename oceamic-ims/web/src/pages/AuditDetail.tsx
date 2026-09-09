import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, label } from '../format';
import { useResource } from '../hooks';
import { useNonconformityCategories } from '../masterdata';

type AuditDetail = Readonly<{
  audit: Readonly<{
    id: string;
    auditCode: string;
    auditType: string;
    title: string;
    plannedDate: string;
    scope: string;
    leadAuditorName: string;
    status: string;
    findingCount: number;
    openFindingCount: number;
  }>;
  checklistItems: readonly Readonly<{
    itemId: string;
    displayOrder: number;
    question: string;
    expectedReference: string | null;
    result: string | null;
    observation: string | null;
    respondedByName: string | null;
  }>[];
  findings: readonly Readonly<{
    id: string;
    findingCode: string;
    findingType: string;
    description: string;
    severity: string;
    ownerName: string | null;
    dueAt: string | null;
    isOverdue: boolean;
    status: string;
    resultingNonconformityId: string | null;
  }>[];
}>;

const RESULTS = ['CONFORME', 'NON_CONFORME', 'OBSERVATION', 'NON_APPLICABLE'] as const;
const FINDING_TYPES = ['NON_CONFORMITE', 'OBSERVATION', 'POINT_FORT'] as const;
const FINDING_STATUSES = ['OUVERTE', 'ACTION_REQUISE', 'CLOTUREE', 'ANNULEE'] as const;

/** Audit (section 42) : réponses de grille de contrôle et constats, chacun
 * conceptuellement distinct de la non-conformité qu'un constat majeur
 * peut générer (section 70). */
export function AuditDetail() {
  const { id } = useParams();
  const resource = useResource<AuditDetail>(`/api/audits/${id}`);
  const { can } = useAuth();
  const categories = useNonconformityCategories();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [findingType, setFindingType] = useState('OBSERVATION');
  const [findingDescription, setFindingDescription] = useState('');
  const [findingSeverity, setFindingSeverity] = useState('MINEURE');
  const [ncrCategoryByFinding, setNcrCategoryByFinding] = useState<Record<string, string>>({});

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
    return <div className="message erreur">{resource.error ?? 'Audit introuvable.'}</div>;
  }

  const { audit, checklistItems, findings } = resource.data;

  return (
    <>
      <PageHeader
        title={`Audit ${audit.auditCode}`}
        subtitle={
          // Execution status and follow-up status are two different things
          // (section 7.7) : a completed audit can still have open findings.
          audit.status === 'TERMINE' && audit.openFindingCount > 0
            ? `${audit.title} — ${audit.openFindingCount} action${audit.openFindingCount > 1 ? 's' : ''} ouverte${audit.openFindingCount > 1 ? 's' : ''}`
            : audit.title
        }
        actions={<Badge value={audit.status} />}
      />
      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Type', value: label(audit.auditType) },
            { key: 'Date prévue', value: formatDate(audit.plannedDate) },
            { key: 'Périmètre', value: audit.scope },
            { key: 'Auditeur responsable', value: audit.leadAuditorName },
          ]}
        />
        <div className="ligne-boutons">
          {can('audit:conduct') && audit.status === 'PLANIFIE' ? (
            <button type="button" onClick={() => call(() => apiPost(`/api/audits/${audit.id}/demarrage`, {}), 'Audit démarré.')}>
              Démarrer
            </button>
          ) : null}
          {can('audit:conduct') && audit.status === 'EN_COURS' ? (
            <button type="button" onClick={() => call(() => apiPost(`/api/audits/${audit.id}/cloture`, {}), 'Audit clôturé.')}>
              Clôturer
            </button>
          ) : null}
          {can('audit:plan') && audit.status !== 'TERMINE' && audit.status !== 'ANNULE' ? (
            <button
              type="button"
              className="danger"
              onClick={() =>
                call(
                  () => apiPost(`/api/audits/${audit.id}/annulation`, { reason: 'Annulé depuis la fiche audit.' }),
                  'Audit annulé.',
                )
              }
            >
              Annuler
            </button>
          ) : null}
        </div>
      </Card>

      <Card title="Grille de contrôle">
        <DataTable
          columns={[
            { key: 'question', label: 'Question', numeric: false },
            { key: 'resultat', label: 'Résultat', numeric: false },
            { key: 'observation', label: 'Observation', numeric: false },
          ]}
          isEmpty={checklistItems.length === 0}
          emptyText="Aucune grille de contrôle associée."
        >
          {checklistItems.map((item) => (
            <ChecklistItemRow
              key={item.itemId}
              auditId={audit.id}
              item={item}
              canRespond={can('audit:conduct') && audit.status === 'EN_COURS'}
              onDone={() => resource.reload()}
            />
          ))}
        </DataTable>
      </Card>

      <Card title="Constats">
        {can('audit:conduct') && audit.status === 'EN_COURS' ? (
          <form
            className="grille-champs"
            style={{ marginBottom: 18 }}
            onSubmit={(event) => {
              event.preventDefault();
              void call(
                () =>
                  apiPost(`/api/audits/${audit.id}/constats`, {
                    findingType,
                    description: findingDescription.trim(),
                    severity: findingSeverity,
                    ownerUserId: null,
                    dueAt: null,
                  }),
                'Constat ajouté.',
              ).then(() => setFindingDescription(''));
            }}
          >
            <Field label="Type" hint={null}>
              <select value={findingType} onChange={(event) => setFindingType(event.target.value)}>
                {FINDING_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {label(type)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description" hint={null}>
              <input value={findingDescription} onChange={(event) => setFindingDescription(event.target.value)} required />
            </Field>
            <Field label="Gravité" hint={null}>
              <select value={findingSeverity} onChange={(event) => setFindingSeverity(event.target.value)}>
                <option value="MINEURE">Mineure</option>
                <option value="MAJEURE">Majeure</option>
                <option value="CRITIQUE">Critique</option>
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
            { key: 'code', label: 'Constat', numeric: false },
            { key: 'type', label: 'Type', numeric: false },
            { key: 'description', label: 'Description', numeric: false },
            { key: 'gravite', label: 'Gravité', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'ncr', label: 'Non-conformité', numeric: false },
          ]}
          isEmpty={findings.length === 0}
          emptyText="Aucun constat."
        >
          {findings.map((finding) => (
            <tr key={finding.id}>
              <td>
                <strong>{finding.findingCode}</strong>
              </td>
              <td>{label(finding.findingType)}</td>
              <td>{finding.description}</td>
              <td>
                <Badge value={finding.severity} />
              </td>
              <td>
                <Badge value={finding.status} />
                {can('audit:conduct') && finding.status !== 'CLOTUREE' && finding.status !== 'ANNULEE' ? (
                  <div className="ligne-boutons" style={{ marginTop: 6 }}>
                    {FINDING_STATUSES.filter((status) => status !== finding.status).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className="lien"
                        onClick={() =>
                          call(
                            () => apiPost(`/api/audit-findings/${finding.id}/statut`, { status }),
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
              <td>
                {finding.resultingNonconformityId ? (
                  <Link to={`/qualite/non-conformites/${finding.resultingNonconformityId}`}>Voir la NC</Link>
                ) : can('audit:conduct') ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={ncrCategoryByFinding[finding.id] ?? ''}
                      onChange={(event) =>
                        setNcrCategoryByFinding((current) => ({ ...current, [finding.id]: event.target.value }))
                      }
                    >
                      <option value="">Catégorie...</option>
                      {(categories.data ?? []).map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="lien"
                      disabled={!ncrCategoryByFinding[finding.id]}
                      onClick={() =>
                        call(
                          () =>
                            apiPost(`/api/audit-findings/${finding.id}/non-conformite`, {
                              detectedAt: new Date().toISOString(),
                              categoryId: ncrCategoryByFinding[finding.id],
                              title: `Constat audit ${finding.findingCode}`,
                              severity: finding.severity,
                              ownerUserId: null,
                            }),
                          'Non-conformité créée depuis le constat.',
                        )
                      }
                    >
                      Créer une NC
                    </button>
                  </div>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}

function ChecklistItemRow({
  auditId,
  item,
  canRespond,
  onDone,
}: {
  auditId: string;
  item: Readonly<{
    itemId: string;
    question: string;
    result: string | null;
    observation: string | null;
  }>;
  canRespond: boolean;
  onDone: () => void;
}) {
  const [result, setResult] = useState(item.result ?? 'CONFORME');
  const [observation, setObservation] = useState(item.observation ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <tr>
      <td>{item.question}</td>
      <td>
        {canRespond ? (
          <select value={result} onChange={(event) => setResult(event.target.value)}>
            {RESULTS.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        ) : (
          <Badge value={item.result} />
        )}
      </td>
      <td>
        {canRespond ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={observation} onChange={(event) => setObservation(event.target.value)} />
            <button
              type="button"
              className="lien"
              onClick={() => {
                setError(null);
                apiPost(`/api/audits/${auditId}/reponses`, {
                  checklistItemId: item.itemId,
                  result,
                  observation: observation.trim() === '' ? null : observation.trim(),
                  evidenceReference: null,
                })
                  .then(onDone)
                  .catch((failure: Error) => setError(failure.message));
              }}
            >
              Enregistrer
            </button>
            {error ? <span style={{ color: 'var(--alerte)', fontSize: 12 }}>{error}</span> : null}
          </div>
        ) : (
          item.observation ?? '-'
        )}
      </td>
    </tr>
  );
}
