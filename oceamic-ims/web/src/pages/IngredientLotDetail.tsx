import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, formatQuantity, label } from '../format';
import { useResource } from '../hooks';
import { useIngredientLossReasons, useLocations } from '../masterdata';

type IngredientLotDetailPayload = Readonly<{
  id: string;
  lotCode: string;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierLotCode: string | null;
  receivedAt: string | null;
  manufactureDate: string | null;
  expiryDate: string | null;
  qualityStatus: string;
}>;

type IngredientMovementRow = Readonly<{
  id: string;
  movementCode: string;
  movementType: string;
  sourceLocationCode: string | null;
  destinationLocationCode: string | null;
  quantity: string;
  unit: string;
  occurredAt: string;
  reason: string | null;
  createdByName: string;
}>;

const QUALITY_STATUSES = ['LIBERE', 'BLOQUE', 'A_VERIFIER', 'REJETE'] as const;

/** Situation d'un lot ingrédient (sections 8/9/13) : identité, stock
 * calculé, mouvements et statut qualité - mirrors LotSituation.tsx. */
export function IngredientLotDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const lot = useResource<IngredientLotDetailPayload>(`/api/ingredient-lots/${id}`);
  const stock = useResource<{ quantity: string }>(`/api/ingredient-lots/${id}/stock`);
  const movements = useResource<readonly IngredientMovementRow[]>(`/api/ingredient-lots/${id}/mouvements`);
  const locations = useLocations();
  const lossReasons = useIngredientLossReasons();
  const ingredientLocations = (locations.data ?? []).filter((location) => location.stockDomain === 'INGREDIENT');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [qualityStatus, setQualityStatus] = useState<string>('LIBERE');
  const [qualityReason, setQualityReason] = useState('');

  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [transferQuantity, setTransferQuantity] = useState('');

  const [lossSourceLocationId, setLossSourceLocationId] = useState('');
  const [lossQuantity, setLossQuantity] = useState('');
  const [lossReasonId, setLossReasonId] = useState('');

  const call = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      lot.reload();
      stock.reload();
      movements.reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  if (lot.loading && lot.data === null) {
    return <p>Chargement...</p>;
  }
  if (lot.data === null) {
    return <div className="message erreur">{lot.error ?? 'Lot ingrédient introuvable.'}</div>;
  }

  const row = lot.data;
  const unit = movements.data?.[0]?.unit ?? '';

  return (
    <>
      <PageHeader
        title={`Lot ${row.lotCode}`}
        subtitle={`${row.ingredientCode} — ${row.ingredientName}`}
        actions={<Badge value={row.qualityStatus} />}
      />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Ingrédient', value: `${row.ingredientCode} — ${row.ingredientName}` },
            { key: 'Fournisseur', value: row.supplierName ?? '-' },
            { key: 'Code lot fournisseur', value: row.supplierLotCode ?? '-' },
            { key: 'Reçu le', value: formatDateTime(row.receivedAt) },
            { key: 'Date de fabrication', value: formatDate(row.manufactureDate) },
            { key: "Date d'expiration", value: formatDate(row.expiryDate) },
            { key: 'Statut qualité', value: <Badge value={row.qualityStatus} /> },
            { key: 'Stock total', value: stock.data ? `${formatQuantity(stock.data.quantity)} ${label(unit)}` : '-' },
          ]}
        />
      </Card>

      {can('ingredient:quality') ? (
        <Card title="Statut qualité">
          <div className="grille-champs">
            <Field label="Nouveau statut" hint={null}>
              <select value={qualityStatus} onChange={(event) => setQualityStatus(event.target.value)}>
                {QUALITY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Motif" hint={null}>
              <input value={qualityReason} onChange={(event) => setQualityReason(event.target.value)} />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button
              type="button"
              disabled={qualityReason.trim() === '' || qualityStatus === row.qualityStatus}
              onClick={() =>
                call(
                  () => apiPost(`/api/ingredient-lots/${row.id}/qualite`, { status: qualityStatus, reason: qualityReason.trim() }),
                  'Statut qualité mis à jour.',
                ).then(() => setQualityReason(''))
              }
            >
              Appliquer
            </button>
          </div>
        </Card>
      ) : null}

      {can('ingredient:transfer') ? (
        <Card title="Transfert">
          <div className="grille-champs">
            <Field label="Emplacement source" hint={null}>
              <select value={sourceLocationId} onChange={(event) => setSourceLocationId(event.target.value)}>
                <option value="">Sélectionner...</option>
                {ingredientLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Emplacement destination" hint={null}>
              <select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}>
                <option value="">Sélectionner...</option>
                {ingredientLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantité" hint={null}>
              <input value={transferQuantity} onChange={(event) => setTransferQuantity(event.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button
              type="button"
              className="secondaire"
              disabled={sourceLocationId === '' || destinationLocationId === '' || transferQuantity === ''}
              onClick={() =>
                call(
                  () =>
                    apiPost(`/api/ingredient-lots/${row.id}/transfert`, {
                      sourceLocationId,
                      destinationLocationId,
                      quantity: transferQuantity,
                      unit: movements.data?.[0]?.unit ?? 'L',
                      occurredAt: new Date().toISOString(),
                    }),
                  'Transfert enregistré.',
                ).then(() => setTransferQuantity(''))
              }
            >
              Transférer
            </button>
          </div>
        </Card>
      ) : null}

      {can('ingredient:transfer') ? (
        <Card title="Déclarer une perte">
          <div className="grille-champs">
            <Field label="Emplacement source" hint={null}>
              <select value={lossSourceLocationId} onChange={(event) => setLossSourceLocationId(event.target.value)}>
                <option value="">Sélectionner...</option>
                {ingredientLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Motif" hint={null}>
              <select value={lossReasonId} onChange={(event) => setLossReasonId(event.target.value)}>
                <option value="">Sélectionner...</option>
                {(lossReasons.data ?? []).map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantité" hint={null}>
              <input value={lossQuantity} onChange={(event) => setLossQuantity(event.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button
              type="button"
              className="secondaire"
              disabled={lossSourceLocationId === '' || lossReasonId === '' || lossQuantity === ''}
              onClick={() =>
                call(
                  () =>
                    apiPost(`/api/ingredient-lots/${row.id}/perte`, {
                      sourceLocationId: lossSourceLocationId,
                      quantity: lossQuantity,
                      unit: movements.data?.[0]?.unit ?? 'L',
                      occurredAt: new Date().toISOString(),
                      lossReasonId,
                      reason: null,
                    }),
                  'Perte enregistrée.',
                ).then(() => setLossQuantity(''))
              }
            >
              Déclarer la perte
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Mouvements">
        <DataTable
          columns={[
            { key: 'heure', label: 'Heure', numeric: false },
            { key: 'mouvement', label: 'Mouvement', numeric: false },
            { key: 'type', label: 'Type', numeric: false },
            { key: 'source', label: 'Source', numeric: false },
            { key: 'destination', label: 'Destination', numeric: false },
            { key: 'motif', label: 'Motif', numeric: false },
            { key: 'utilisateur', label: 'Utilisateur', numeric: false },
            { key: 'quantite', label: 'Quantité', numeric: true },
          ]}
          isEmpty={(movements.data ?? []).length === 0}
          emptyText="Aucun mouvement pour ce lot."
        >
          {(movements.data ?? []).map((movement) => (
            <tr key={movement.id}>
              <td>{formatDateTime(movement.occurredAt)}</td>
              <td>{movement.movementCode}</td>
              <td>
                <Badge value={movement.movementType} />
              </td>
              <td>{movement.sourceLocationCode ?? '-'}</td>
              <td>{movement.destinationLocationCode ?? '-'}</td>
              <td>{movement.reason ?? '-'}</td>
              <td>{movement.createdByName}</td>
              <td className="nombre">
                {formatQuantity(movement.quantity)} {label(movement.unit)}
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
