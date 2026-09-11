import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime } from '../format';
import { useResource } from '../hooks';

type ShipmentDetail = Readonly<{
  shipment: Readonly<{
    id: string;
    shipmentCode: string;
    plannedDate: string;
    shippedAt: string | null;
    customerName: string;
    destination: string;
    containerNumber: string | null;
    sealNumber: string | null;
    vehicleRegistration: string | null;
    targetTemperatureC: string | null;
    gensetRequired: boolean | null;
    status: string;
    cancellationReason: string | null;
    notes: string | null;
  }>;
  lines: readonly Readonly<{
    palletId: string;
    palletCode: string;
    lotCode: string | null;
    quantityCartons: number;
    quantityUnits: number;
    qualityStatus: string;
    reservationStatus: string | null;
  }>[];
}>;

type PalletOption = Readonly<{ id: string; palletCode: string; status: string; qualityStatus: string }>;

const ACCEPTS_ENTRIES = ['PLANIFIEE', 'EN_PREPARATION', 'EN_CHARGEMENT'];

/** Shipment detail, doubling as the container loading screen (section 27):
 * container info, pallet loading, confirmation and cancellation. */
export function ExpeditionDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useResource<ShipmentDetail>(`/api/shipments/${id}`);
  const availablePallets = useResource<readonly PalletOption[]>('/api/pallets?statut=EN_STOCK');

  const [palletId, setPalletId] = useState('');
  const [containerNumber, setContainerNumber] = useState('');
  const [sealNumber, setSealNumber] = useState('');
  const [vehicleRegistration, setVehicleRegistration] = useState('');
  const [targetTemperatureC, setTargetTemperatureC] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await action();
      setActionSuccess(message);
      reload();
      availablePallets.reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  if (loading) {
    return <p>Chargement...</p>;
  }
  if (error || data === null) {
    return <div className="message erreur">{error ?? 'Expédition introuvable.'}</div>;
  }

  const { shipment, lines } = data;
  const acceptsEntries = ACCEPTS_ENTRIES.includes(shipment.status);

  return (
    <>
      <PageHeader
        title={`Expédition ${shipment.shipmentCode}`}
        subtitle={`${shipment.customerName} — ${shipment.destination}`}
        actions={
          <>
            <Badge value={shipment.status} />
            <button type="button" className="secondaire imprimer-masquer" onClick={() => window.print()}>
              Imprimer (bon d'expédition / liste de colisage)
            </button>
          </>
        }
      />

      <Message kind="erreur" text={actionError} />
      <Message kind="succes" text={actionSuccess} />

      {shipment.status === 'ANNULEE' ? (
        <div className="message erreur">Expédition annulée : {shipment.cancellationReason}</div>
      ) : null}

      <Card title="Vue générale">
        <KeyValue
          items={[
            { key: 'Client', value: shipment.customerName },
            { key: 'Destination', value: shipment.destination },
            { key: 'Date prévue', value: formatDate(shipment.plannedDate) },
            { key: 'Expédié le', value: formatDateTime(shipment.shippedAt) },
          ]}
        />
      </Card>

      <Card title="Conteneur / transport">
        <KeyValue
          items={[
            { key: 'N° conteneur', value: shipment.containerNumber ?? '-' },
            { key: 'N° scellé', value: shipment.sealNumber ?? '-' },
            { key: 'Immatriculation véhicule', value: shipment.vehicleRegistration ?? '-' },
            { key: 'Température consigne (°C)', value: shipment.targetTemperatureC ?? '-' },
            { key: 'Groupe frigorifique (GENSET)', value: shipment.gensetRequired ? 'Oui' : 'Non' },
          ]}
        />
        {can('shipment:manage') && acceptsEntries ? (
          <form
            className="grille-champs imprimer-masquer"
            style={{ marginTop: 18 }}
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  apiPost(`/api/shipments/${shipment.id}/conteneur`, {
                    containerNumber: containerNumber.trim() === '' ? shipment.containerNumber : containerNumber.trim(),
                    sealNumber: sealNumber.trim() === '' ? shipment.sealNumber : sealNumber.trim(),
                    vehicleRegistration:
                      vehicleRegistration.trim() === '' ? shipment.vehicleRegistration : vehicleRegistration.trim(),
                    targetTemperatureC:
                      targetTemperatureC.trim() === '' ? shipment.targetTemperatureC : targetTemperatureC.trim(),
                    gensetRequired: shipment.gensetRequired,
                  }),
                'Informations conteneur mises à jour.',
              );
            }}
          >
            <Field label="N° conteneur" hint={null}>
              <input value={containerNumber} onChange={(event) => setContainerNumber(event.target.value)} />
            </Field>
            <Field label="N° scellé" hint={null}>
              <input value={sealNumber} onChange={(event) => setSealNumber(event.target.value)} />
            </Field>
            <Field label="Immatriculation" hint={null}>
              <input value={vehicleRegistration} onChange={(event) => setVehicleRegistration(event.target.value)} />
            </Field>
            <Field label="Température consigne (°C)" hint={null}>
              <input value={targetTemperatureC} onChange={(event) => setTargetTemperatureC(event.target.value)} inputMode="decimal" />
            </Field>
            <div style={{ alignSelf: 'end' }}>
              <button type="submit">Mettre à jour</button>
            </div>
          </form>
        ) : null}
      </Card>

      <Card title="Chargement du conteneur / Palettes">
        {can('shipment:manage') && acceptsEntries ? (
          <form
            className="filtres imprimer-masquer"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () => apiPost(`/api/shipments/${shipment.id}/palettes`, { palletId }),
                'Palette chargée.',
              ).then(() => setPalletId(''));
            }}
          >
            <select value={palletId} onChange={(event) => setPalletId(event.target.value)} required>
              <option value="">Palette à charger...</option>
              {(availablePallets.data ?? []).map((pallet) => (
                <option key={pallet.id} value={pallet.id}>
                  {pallet.palletCode} ({pallet.qualityStatus})
                </option>
              ))}
            </select>
            <button type="submit">Charger</button>
          </form>
        ) : null}

        <DataTable
          columns={[
            { key: 'palette', label: 'Palette', numeric: false },
            { key: 'lot', label: 'Lot PF', numeric: false },
            { key: 'qualite', label: 'Statut qualité', numeric: false },
            { key: 'reservation', label: 'Réservation', numeric: false },
            { key: 'cartons', label: 'Cartons', numeric: true },
          ]}
          isEmpty={lines.length === 0}
          emptyText="Aucune palette chargée."
        >
          {lines.map((line) => (
            <tr key={line.palletId}>
              <td>
                <Link to={`/palettes/${line.palletId}`}>{line.palletCode}</Link>
              </td>
              <td>{line.lotCode ?? '-'}</td>
              <td>
                <Badge value={line.qualityStatus} />
              </td>
              <td>{line.reservationStatus ? <Badge value={line.reservationStatus} /> : '-'}</td>
              <td className="nombre">{line.quantityCartons}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      {can('shipment:manage') && acceptsEntries ? (
        <div className="imprimer-masquer">
          <Card title="Confirmation / Annulation">
            <div className="ligne-boutons" style={{ marginTop: 0 }}>
              <button
                type="button"
                onClick={() =>
                  run(() => apiPost(`/api/shipments/${shipment.id}/confirmation`, {}), 'Expédition confirmée.')
                }
              >
                Confirmer l'expédition
              </button>
            </div>
            <form
              className="filtres"
              style={{ marginTop: 18 }}
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => apiPost(`/api/shipments/${shipment.id}/annulation`, { reason: cancellationReason.trim() }),
                  'Expédition annulée.',
                ).then(() => setCancellationReason(''));
              }}
            >
              <input
                placeholder="Motif d'annulation"
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value)}
              />
              <button type="submit" className="danger" disabled={cancellationReason.trim() === ''}>
                Annuler l'expédition
              </button>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}
