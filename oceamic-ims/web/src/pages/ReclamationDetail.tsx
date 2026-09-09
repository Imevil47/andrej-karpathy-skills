import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, label } from '../format';
import { useResource } from '../hooks';
import { useNonconformityCategories } from '../masterdata';

type ComplaintDetail = Readonly<{
  complaint: Readonly<{
    id: string;
    complaintCode: string;
    receivedAt: string;
    customerName: string;
    shipmentCode: string | null;
    finishedGoodLotCode: string | null;
    complaintType: string;
    severity: string;
    status: string;
    ownerName: string | null;
    resultingNonconformityId: string | null;
    resultingCapaId: string | null;
  }>;
  traceability: readonly Readonly<{
    palletCode: string;
    finishedGoodLotCode: string;
    runCode: string;
    cycleCode: string;
    rawMaterialLotCode: string;
    supplierName: string | null;
  }>[];
}>;

const STATUSES = ['OUVERTE', 'EN_ANALYSE', 'ACTION_REQUISE', 'CLOTUREE', 'ANNULEE'] as const;

/** Réclamation client (sections 17-18, 60) : la traçabilité Client ->
 * Expédition -> Palettes -> Lot PF -> Stérilisation -> Run -> Lots MP est
 * recalculée depuis les relations existantes, jamais ressaisie à la main. */
export function ReclamationDetail() {
  const { id } = useParams();
  const resource = useResource<ComplaintDetail>(`/api/complaints/${id}`);
  const { can } = useAuth();
  const categories = useNonconformityCategories();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');

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
    return <div className="message erreur">{resource.error ?? 'Réclamation introuvable.'}</div>;
  }

  const { complaint, traceability } = resource.data;
  const isOpen = complaint.status !== 'CLOTUREE' && complaint.status !== 'ANNULEE';

  return (
    <>
      <PageHeader
        title={`Réclamation ${complaint.complaintCode}`}
        subtitle={`${complaint.customerName} — ${label(complaint.complaintType)}`}
        actions={
          <>
            <Badge value={complaint.severity} />
            <Badge value={complaint.status} />
          </>
        }
      />
      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Reçue le', value: formatDate(complaint.receivedAt) },
            { key: 'Expédition', value: complaint.shipmentCode ?? '-' },
            { key: 'Lot PF', value: complaint.finishedGoodLotCode ?? '-' },
            { key: 'Responsable', value: complaint.ownerName ?? '-' },
          ]}
        />
        {can('complaint:manage') && isOpen ? (
          <div className="ligne-boutons">
            {STATUSES.filter((status) => status !== complaint.status).map((status) => (
              <button
                key={status}
                type="button"
                className="secondaire"
                onClick={() => call(() => apiPost(`/api/complaints/${complaint.id}/statut`, { status }), `Statut : ${label(status)}.`)}
              >
                {label(status)}
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      <Card title="Traçabilité (calculée depuis l'expédition)">
        <DataTable
          columns={[
            { key: 'palette', label: 'Palette', numeric: false },
            { key: 'lot-pf', label: 'Lot PF', numeric: false },
            { key: 'run', label: 'Run', numeric: false },
            { key: 'cycle', label: 'Cycle de stérilisation', numeric: false },
            { key: 'lot-mp', label: 'Lot matière première', numeric: false },
            { key: 'fournisseur', label: 'Fournisseur', numeric: false },
          ]}
          isEmpty={traceability.length === 0}
          emptyText="Aucune traçabilité disponible (réclamation non liée à une expédition)."
        >
          {traceability.map((row, index) => (
            <tr key={`${row.palletCode}-${row.rawMaterialLotCode}-${index}`}>
              <td>{row.palletCode}</td>
              <td>{row.finishedGoodLotCode}</td>
              <td>{row.runCode}</td>
              <td>{row.cycleCode}</td>
              <td>{row.rawMaterialLotCode}</td>
              <td>{row.supplierName ?? '-'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Non-conformité et CAPA">
        <KeyValue
          items={[
            {
              key: 'Non-conformité',
              value: complaint.resultingNonconformityId ? (
                <Link to={`/qualite/non-conformites/${complaint.resultingNonconformityId}`}>Voir la NC</Link>
              ) : (
                '-'
              ),
            },
            {
              key: 'CAPA',
              value: complaint.resultingCapaId ? <Link to={`/qualite/capa/${complaint.resultingCapaId}`}>Voir le CAPA</Link> : '-',
            },
          ]}
        />
        {can('complaint:manage') && complaint.resultingNonconformityId === null ? (
          <form
            className="grille-champs"
            style={{ marginTop: 14 }}
            onSubmit={(event) => {
              event.preventDefault();
              void call(
                () =>
                  apiPost(`/api/complaints/${complaint.id}/non-conformite`, {
                    detectedAt: new Date().toISOString(),
                    categoryId,
                    title: title.trim(),
                    description: `Issue de la réclamation ${complaint.complaintCode}.`,
                    severity: complaint.severity,
                    ownerUserId: null,
                  }),
                'Non-conformité créée depuis la réclamation.',
              );
            }}
          >
            <Field label="Catégorie" hint={null}>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
                <option value="">Sélectionner...</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Titre" hint={null}>
              <input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </Field>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button type="submit" className="secondaire">
                Créer la non-conformité
              </button>
            </div>
          </form>
        ) : null}
      </Card>
    </>
  );
}
