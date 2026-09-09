import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime } from '../format';
import { useResource } from '../hooks';
import { useUsers } from '../masterdata';
import { DOCUMENT_TYPE_LABELS } from './Documents';

type QualityDocumentDetail = Readonly<{
  document: Readonly<{
    id: string;
    documentCode: string;
    title: string;
    documentType: string;
    currentRevisionNumber: number | null;
    effectiveDate: string | null;
    ownerName: string;
    status: string;
  }>;
  revisions: readonly Readonly<{
    id: string;
    revisionNumber: number;
    status: string;
    effectiveDate: string | null;
    changeSummary: string;
    fileReference: string | null;
    createdByName: string;
    createdAt: string;
    approvedByName: string | null;
    approvedAt: string | null;
  }>[];
}>;

type Acknowledgment = Readonly<{
  id: string;
  userName: string;
  assignedAt: string;
  acknowledgedAt: string | null;
  status: string;
}>;

/** Document qualité (section 43) : "Voir la révision en vigueur" et
 * "Historique des révisions" restent deux vues distinctes - une révision
 * OBSOLETE ne s'affiche jamais comme la version courante (section 28). */
export function DocumentDetail() {
  const { id } = useParams();
  const resource = useResource<QualityDocumentDetail>(`/api/quality-documents/${id}`);
  const { can } = useAuth();
  const users = useUsers();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState('');
  const [expandedRevisionId, setExpandedRevisionId] = useState<string | null>(null);
  const [ackUserId, setAckUserId] = useState('');

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

  const acknowledgments = useResource<readonly Acknowledgment[]>(
    expandedRevisionId ? `/api/document-revisions/${expandedRevisionId}/acquittements` : '/api/document-revisions/aucun/acquittements',
  );

  if (resource.loading && resource.data === null) {
    return <p>Chargement...</p>;
  }
  if (resource.data === null) {
    return <div className="message erreur">{resource.error ?? 'Document introuvable.'}</div>;
  }

  const { document, revisions } = resource.data;
  const currentRevision = revisions.find((revision) => revision.revisionNumber === document.currentRevisionNumber);
  const hasDraftInProgress = revisions.some((revision) => revision.status === 'BROUILLON' || revision.status === 'EN_REVISION');

  return (
    <>
      <PageHeader title={`${document.documentCode} — ${document.title}`} subtitle={DOCUMENT_TYPE_LABELS[document.documentType] ?? document.documentType} actions={<Badge value={document.status} />} />
      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title="Révision en vigueur">
        {currentRevision ? (
          <KeyValue
            items={[
              { key: 'Révision', value: String(currentRevision.revisionNumber).padStart(2, '0') },
              { key: "Date d'effet", value: formatDate(currentRevision.effectiveDate) },
              { key: 'Objet', value: currentRevision.changeSummary },
              { key: 'Propriétaire', value: document.ownerName },
              { key: 'Approuvée par', value: currentRevision.approvedByName ?? '-' },
            ]}
          />
        ) : (
          <p style={{ color: 'var(--texte-doux)' }}>Aucune révision n'est encore en vigueur.</p>
        )}
        {can('document:manage') && !hasDraftInProgress ? (
          <form
            className="grille-champs"
            style={{ marginTop: 14 }}
            onSubmit={(event) => {
              event.preventDefault();
              void call(
                () => apiPost(`/api/quality-documents/${document.id}/revisions`, { changeSummary: changeSummary.trim(), fileReference: null }),
                'Nouvelle révision créée.',
              ).then(() => setChangeSummary(''));
            }}
          >
            <Field label="Objet de la nouvelle révision" hint={null}>
              <input value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} required />
            </Field>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button type="submit" className="secondaire">
                Créer une nouvelle révision
              </button>
            </div>
          </form>
        ) : null}
      </Card>

      <Card title="Historique des révisions">
        <DataTable
          columns={[
            { key: 'revision', label: 'Révision', numeric: false },
            { key: 'objet', label: 'Objet', numeric: false },
            { key: 'cree', label: 'Créée par', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'actions', label: '', numeric: false },
          ]}
          isEmpty={revisions.length === 0}
          emptyText="Aucune révision."
        >
          {revisions.map((revision) => (
            <tr key={revision.id}>
              <td>{String(revision.revisionNumber).padStart(2, '0')}</td>
              <td>{revision.changeSummary}</td>
              <td>
                {revision.createdByName}
                <div style={{ fontSize: 12, color: 'var(--texte-doux)' }}>{formatDateTime(revision.createdAt)}</div>
              </td>
              <td>
                <Badge value={revision.status} />
              </td>
              <td>
                <div className="ligne-boutons" style={{ marginTop: 0 }}>
                  {can('document:manage') && revision.status === 'BROUILLON' ? (
                    <button
                      type="button"
                      className="lien"
                      onClick={() =>
                        call(() => apiPost(`/api/document-revisions/${revision.id}/soumission`, {}), 'Révision soumise pour révision.')
                      }
                    >
                      Soumettre
                    </button>
                  ) : null}
                  {can('document:approve') && (revision.status === 'BROUILLON' || revision.status === 'EN_REVISION') ? (
                    <button
                      type="button"
                      className="lien"
                      onClick={() =>
                        call(() => apiPost(`/api/document-revisions/${revision.id}/approbation`, {}), 'Révision approuvée.')
                      }
                    >
                      Approuver
                    </button>
                  ) : null}
                  {can('document:approve') && revision.status === 'APPROUVE' ? (
                    <button
                      type="button"
                      className="lien"
                      onClick={() =>
                        call(() => apiPost(`/api/document-revisions/${revision.id}/mise-en-vigueur`, {}), 'Révision mise en vigueur.')
                      }
                    >
                      Mettre en vigueur
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="lien"
                    onClick={() => setExpandedRevisionId((current) => (current === revision.id ? null : revision.id))}
                  >
                    Acquittements
                  </button>
                </div>
                {expandedRevisionId === revision.id ? (
                  <div style={{ marginTop: 10 }}>
                    {can('document:manage') ? (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <select value={ackUserId} onChange={(event) => setAckUserId(event.target.value)}>
                          <option value="">Assigner à...</option>
                          {(users.data ?? []).map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.fullName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="lien"
                          disabled={ackUserId === ''}
                          onClick={() =>
                            call(
                              () => apiPost(`/api/document-revisions/${revision.id}/acquittements`, { userId: ackUserId }),
                              'Acquittement assigné.',
                            ).then(() => {
                              setAckUserId('');
                              acknowledgments.reload();
                            })
                          }
                        >
                          Assigner
                        </button>
                      </div>
                    ) : null}
                    <DataTable
                      columns={[
                        { key: 'utilisateur', label: 'Utilisateur', numeric: false },
                        { key: 'statut', label: 'Statut', numeric: false },
                      ]}
                      isEmpty={(acknowledgments.data ?? []).length === 0}
                      emptyText="Aucun acquittement assigné."
                    >
                      {(acknowledgments.data ?? []).map((ack) => (
                        <tr key={ack.id}>
                          <td>{ack.userName}</td>
                          <td>
                            <Badge value={ack.status} />
                          </td>
                        </tr>
                      ))}
                    </DataTable>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
