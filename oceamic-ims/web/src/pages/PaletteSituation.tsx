import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useResource } from '../hooks';
import { useLocations } from '../masterdata';

type PalletSituation = Readonly<{
  pallet: Readonly<{
    id: string;
    palletCode: string;
    status: string;
    qualityStatus: string;
    locationId: string | null;
    locationCode: string | null;
    quantityCartons: number;
    quantityUnits: number;
    isReserved: boolean;
    reservedForShipmentId: string | null;
  }>;
  contents: readonly Readonly<{
    finishedGoodLotId: string;
    lotCode: string;
    productCode: string;
    productName: string;
    quantityCartons: number;
    quantityUnits: number;
  }>[];
  movements: readonly Readonly<{
    movementCode: string;
    occurredAt: string;
    movementType: string;
    sourceLocationCode: string | null;
    destinationLocationCode: string | null;
    quantityCartons: number;
    reason: string | null;
  }>[];
  decisions: readonly Readonly<{
    decisionType: string;
    reason: string;
    decidedAt: string;
    decidedByName: string;
  }>[];
  blocks: readonly Readonly<{ status: string; blockedAt: string; reason: string; releasedAt: string | null }>[];
  shipments: readonly Readonly<{
    shipmentId: string;
    shipmentCode: string;
    status: string;
    customerName: string;
    containerNumber: string | null;
    quantityCartons: number;
    shippedAt: string | null;
  }>[];
}>;

export function PaletteSituation() {
  const { id } = useParams();
  const { can } = useAuth();
  const locations = useLocations();
  const { data, error, loading, reload } = useResource<PalletSituation>(`/api/pallets/${id}/situation`);

  const [decisionReason, setDecisionReason] = useState('');
  const [transferLocationId, setTransferLocationId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await action();
      setActionSuccess(message);
      reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  const decide = (decisionType: 'BLOQUE' | 'LIBERE' | 'ACCEPTE' | 'REJETE') =>
    run(
      () =>
        apiPost('/api/fg-quality/decisions', {
          entityType: 'PALLET',
          entityId: id,
          decisionType,
          reason: decisionReason.trim(),
          notes: null,
        }),
      'Décision qualité enregistrée.',
    ).then(() => setDecisionReason(''));

  if (loading) {
    return <p>Chargement...</p>;
  }
  if (error || data === null) {
    return <div className="message erreur">{error ?? 'Palette introuvable.'}</div>;
  }

  const { pallet } = data;
  const pfLocations = (locations.data ?? []).filter(
    (location) => location.stockDomain === 'PF' || location.stockDomain === 'MIXTE',
  );

  return (
    <>
      <PageHeader
        title={`Situation de la palette ${pallet.palletCode}`}
        subtitle={pallet.locationCode ? `Emplacement actuel : ${pallet.locationCode}` : 'Aucune position physique'}
        actions={
          <>
            <Badge value={pallet.status} />
            <Badge value={pallet.qualityStatus} />
          </>
        }
      />

      <Message kind="erreur" text={actionError} />
      <Message kind="succes" text={actionSuccess} />

      {pallet.qualityStatus === 'BLOQUE' ? (
        <div className="message erreur">Cette palette est bloquée par le service Qualité : elle ne peut pas être expédiée.</div>
      ) : null}

      <Card title="Vue générale">
        <KeyValue
          items={[
            { key: 'Palette', value: pallet.palletCode },
            { key: 'Statut', value: <Badge value={pallet.status} /> },
            { key: 'Statut qualité', value: <Badge value={pallet.qualityStatus} /> },
            { key: 'Emplacement', value: pallet.locationCode ?? '-' },
            { key: 'Cartons', value: pallet.quantityCartons },
            { key: 'Unités', value: pallet.quantityUnits },
            { key: 'Réservée', value: pallet.isReserved ? 'Oui' : 'Non' },
          ]}
        />
      </Card>

      <Card title="Composition">
        <DataTable
          columns={[
            { key: 'lot', label: 'Lot PF', numeric: false },
            { key: 'produit', label: 'Produit', numeric: false },
            { key: 'cartons', label: 'Cartons', numeric: true },
            { key: 'unites', label: 'Unités', numeric: true },
          ]}
          isEmpty={data.contents.length === 0}
          emptyText="Aucune composition."
        >
          {data.contents.map((content) => (
            <tr key={content.finishedGoodLotId}>
              <td>
                <Link to={`/emballage/lots-pf/${content.finishedGoodLotId}`}>{content.lotCode}</Link>
              </td>
              <td>
                {content.productCode} — {content.productName}
              </td>
              <td className="nombre">{content.quantityCartons}</td>
              <td className="nombre">{content.quantityUnits}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Mouvements de stock PF">
        {can('fgstock:manage') && pallet.status === 'EN_STOCK' ? (
          <form
            className="filtres"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  apiPost(`/api/pallets/${pallet.id}/transfert`, {
                    sourceLocationId: pallet.locationId,
                    destinationLocationId: transferLocationId,
                    occurredAt: new Date().toISOString(),
                    notes: null,
                  }),
                'Palette transférée.',
              ).then(() => setTransferLocationId(''));
            }}
          >
            <select value={transferLocationId} onChange={(event) => setTransferLocationId(event.target.value)} required>
              <option value="">Emplacement de destination...</option>
              {pfLocations
                .filter((location) => location.code !== pallet.locationCode)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
            <button type="submit">Transférer</button>
          </form>
        ) : null}

        <DataTable
          columns={[
            { key: 'code', label: 'Mouvement', numeric: false },
            { key: 'date', label: 'Date', numeric: false },
            { key: 'type', label: 'Type', numeric: false },
            { key: 'source', label: 'Source', numeric: false },
            { key: 'destination', label: 'Destination', numeric: false },
            { key: 'motif', label: 'Motif', numeric: false },
            { key: 'cartons', label: 'Cartons', numeric: true },
          ]}
          isEmpty={data.movements.length === 0}
          emptyText="Aucun mouvement."
        >
          {data.movements.map((movement) => (
            <tr key={movement.movementCode}>
              <td>{movement.movementCode}</td>
              <td>{formatDateTime(movement.occurredAt)}</td>
              <td>
                <Badge value={movement.movementType} />
              </td>
              <td>{movement.sourceLocationCode ?? '-'}</td>
              <td>{movement.destinationLocationCode ?? '-'}</td>
              <td>{movement.reason ?? '-'}</td>
              <td className="nombre">{movement.quantityCartons}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Expéditions">
        <DataTable
          columns={[
            { key: 'expedition', label: 'Expédition', numeric: false },
            { key: 'client', label: 'Client', numeric: false },
            { key: 'conteneur', label: 'Conteneur', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'cartons', label: 'Cartons', numeric: true },
            { key: 'expedie', label: 'Expédié le', numeric: false },
          ]}
          isEmpty={data.shipments.length === 0}
          emptyText="Cette palette n'a fait l'objet d'aucune expédition."
        >
          {data.shipments.map((shipment, index) => (
            <tr key={`${shipment.shipmentId}-${index}`}>
              <td>
                <Link to={`/expeditions/${shipment.shipmentId}`}>{shipment.shipmentCode}</Link>
              </td>
              <td>{shipment.customerName}</td>
              <td>{shipment.containerNumber ?? '-'}</td>
              <td>
                <Badge value={shipment.status} />
              </td>
              <td className="nombre">{shipment.quantityCartons}</td>
              <td>{formatDateTime(shipment.shippedAt)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Qualité">
        <DataTable
          columns={[
            { key: 'decision', label: 'Décision', numeric: false },
            { key: 'date', label: 'Date', numeric: false },
            { key: 'motif', label: 'Motif', numeric: false },
            { key: 'auteur', label: 'Décidé par', numeric: false },
          ]}
          isEmpty={data.decisions.length === 0}
          emptyText="Aucune décision qualité."
        >
          {data.decisions.map((decision, index) => (
            <tr key={`${decision.decidedAt}-${index}`}>
              <td>
                <Badge value={decision.decisionType} />
              </td>
              <td>{formatDateTime(decision.decidedAt)}</td>
              <td>{decision.reason}</td>
              <td>{decision.decidedByName}</td>
            </tr>
          ))}
        </DataTable>

        {can('fgquality:decide') ? (
          <div style={{ marginTop: 18 }}>
            <Field label="Motif de la décision qualité" hint={null}>
              <input
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                placeholder="Motif obligatoire"
              />
            </Field>
            <div className="ligne-boutons">
              {pallet.qualityStatus === 'BLOQUE' ? (
                <button type="button" onClick={() => decide('LIBERE')} disabled={decisionReason.trim() === ''}>
                  Libérer la palette
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => decide('ACCEPTE')} disabled={decisionReason.trim() === ''}>
                    Accepter (libère)
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => decide('BLOQUE')}
                    disabled={decisionReason.trim() === ''}
                  >
                    Bloquer la palette
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
