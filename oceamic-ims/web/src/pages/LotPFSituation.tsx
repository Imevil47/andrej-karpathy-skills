import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime } from '../format';
import { useResource } from '../hooks';

type FinishedGoodLotSituation = Readonly<{
  lot: Readonly<{
    id: string;
    lotCode: string;
    packagingBatchId: string;
    batchCode: string;
    runCode: string;
    productCode: string;
    productName: string;
    format: string | null;
    piecesPerCan: number | null;
    productionDate: string;
    bestBeforeDate: string | null;
    qualityStatus: string;
    commercialStatus: string | null;
    physicalCartons: number;
    physicalUnits: number;
    blockedCartons: number;
    reservedCartons: number;
    availableCartons: number;
  }>;
  sources: readonly Readonly<{
    sterilizationCycleId: string;
    cycleCode: string;
    productionRunId: string;
    runCode: string;
    quantityUnits: number | null;
  }>[];
  pallets: readonly Readonly<{
    palletId: string;
    palletCode: string;
    status: string;
    qualityStatus: string;
    quantityCartons: number;
    quantityUnits: number;
    locationCode: string | null;
  }>[];
  shipments: readonly Readonly<{
    shipmentId: string;
    shipmentCode: string;
    status: string;
    customerName: string;
    containerNumber: string | null;
    palletCode: string;
    quantityCartons: number;
    shippedAt: string | null;
  }>[];
  decisions: readonly Readonly<{
    decisionType: string;
    reason: string;
    decidedAt: string;
    decidedByName: string;
    notes: string | null;
  }>[];
  blocks: readonly Readonly<{
    status: string;
    blockedAt: string;
    reason: string;
    releasedAt: string | null;
    releaseReason: string | null;
  }>[];
}>;

export function LotPFSituation() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useResource<FinishedGoodLotSituation>(
    `/api/finished-good-lots/${id}/situation`,
  );

  const [decisionReason, setDecisionReason] = useState('');
  const [quantityCans, setQuantityCans] = useState('');
  const [quantityCartons, setQuantityCartons] = useState('');
  const [unitsPerCarton, setUnitsPerCarton] = useState('');
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
          entityType: 'FINISHED_GOOD_LOT',
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
    return <div className="message erreur">{error ?? 'Lot PF introuvable.'}</div>;
  }

  const { lot } = data;

  return (
    <>
      <PageHeader
        title={`Situation du Lot PF ${lot.lotCode}`}
        subtitle={`${lot.productCode} — ${lot.productName} — Run ${lot.runCode}`}
        actions={
          <>
            <Badge value={lot.qualityStatus} />
            <button type="button" className="secondaire imprimer-masquer" onClick={() => window.print()}>
              Imprimer (traçabilité)
            </button>
          </>
        }
      />

      <Message kind="erreur" text={actionError} />
      <Message kind="succes" text={actionSuccess} />

      {lot.qualityStatus === 'BLOQUE' ? (
        <div className="message erreur">
          Ce Lot PF est bloqué par le service Qualité : aucune palette de ce lot ne peut être expédiée.
        </div>
      ) : null}

      <Card title="Vue générale">
        <KeyValue
          items={[
            { key: 'Lot PF', value: lot.lotCode },
            { key: 'Produit', value: `${lot.productCode} — ${lot.productName}` },
            { key: 'Format', value: lot.format ?? '-' },
            { key: 'Pièces par boîte', value: lot.piecesPerCan ?? '-' },
            { key: 'Date de production', value: formatDate(lot.productionDate) },
            { key: 'DLC', value: formatDate(lot.bestBeforeDate) },
            { key: 'Statut commercial', value: lot.commercialStatus ?? '-' },
            { key: 'Cartons physiques', value: lot.physicalCartons },
            { key: 'Cartons bloqués', value: lot.blockedCartons },
            { key: 'Cartons réservés', value: lot.reservedCartons },
            { key: 'Cartons disponibles', value: lot.availableCartons },
          ]}
        />
      </Card>

      <Card title="Origine production / Stérilisation">
        <DataTable
          columns={[
            { key: 'cycle', label: 'Cycle de stérilisation', numeric: false },
            { key: 'run', label: 'Run', numeric: false },
            { key: 'quantite', label: 'Quantité (unités)', numeric: true },
          ]}
          isEmpty={data.sources.length === 0}
          emptyText="Aucune source enregistrée."
        >
          {data.sources.map((source) => (
            <tr key={source.sterilizationCycleId}>
              <td>
                <Link to={`/production/sterilisation/${source.sterilizationCycleId}`}>{source.cycleCode}</Link>
              </td>
              <td>
                <Link to={`/production/${source.productionRunId}`}>{source.runCode}</Link>
              </td>
              <td className="nombre">{source.quantityUnits ?? '-'}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Emballage">
        {can('packaging:manage') ? (
          <form
            className="grille-champs imprimer-masquer"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  apiPost(`/api/packaging-batches/${lot.packagingBatchId}/sorties`, {
                    finishedGoodLotId: lot.id,
                    quantityCans: Number(quantityCans.trim()),
                    quantityCartons: Number(quantityCartons.trim()),
                    unitsPerCarton: Number(unitsPerCarton.trim()),
                    occurredAt: new Date().toISOString(),
                    notes: null,
                  }),
                "Sortie d'emballage enregistrée.",
              ).then(() => {
                setQuantityCans('');
                setQuantityCartons('');
                setUnitsPerCarton('');
              });
            }}
          >
            <Field label="Boîtes emballées" hint={null}>
              <input value={quantityCans} onChange={(event) => setQuantityCans(event.target.value)} inputMode="numeric" required />
            </Field>
            <Field label="Cartons" hint={null}>
              <input
                value={quantityCartons}
                onChange={(event) => setQuantityCartons(event.target.value)}
                inputMode="numeric"
                required
              />
            </Field>
            <Field label="Boîtes par carton" hint={null}>
              <input
                value={unitsPerCarton}
                onChange={(event) => setUnitsPerCarton(event.target.value)}
                inputMode="numeric"
                required
              />
            </Field>
            <div style={{ alignSelf: 'end' }}>
              <button type="submit">Enregistrer la sortie</button>
            </div>
          </form>
        ) : null}
        <p style={{ color: 'var(--texte-doux)' }}>
          Lot d'emballage : <strong>{lot.batchCode}</strong>
        </p>
      </Card>

      <Card title="Palettes">
        <DataTable
          columns={[
            { key: 'palette', label: 'Palette', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'qualite', label: 'Statut qualité', numeric: false },
            { key: 'emplacement', label: 'Emplacement', numeric: false },
            { key: 'cartons', label: 'Cartons', numeric: true },
            { key: 'unites', label: 'Unités', numeric: true },
          ]}
          isEmpty={data.pallets.length === 0}
          emptyText="Aucune palette pour ce Lot PF."
        >
          {data.pallets.map((pallet) => (
            <tr key={pallet.palletId}>
              <td>
                <Link to={`/palettes/${pallet.palletId}`}>
                  <strong>{pallet.palletCode}</strong>
                </Link>
              </td>
              <td>
                <Badge value={pallet.status} />
              </td>
              <td>
                <Badge value={pallet.qualityStatus} />
              </td>
              <td>{pallet.locationCode ?? '-'}</td>
              <td className="nombre">{pallet.quantityCartons}</td>
              <td className="nombre">{pallet.quantityUnits}</td>
            </tr>
          ))}
        </DataTable>
        {can('packaging:manage') ? (
          <div className="ligne-boutons imprimer-masquer">
            <Link to={`/palettes/nouvelle?lot=${lot.id}`}>
              <button type="button" className="secondaire">
                Nouvelle palette
              </button>
            </Link>
          </div>
        ) : null}
      </Card>

      <Card title="Expéditions">
        <DataTable
          columns={[
            { key: 'expedition', label: 'Expédition', numeric: false },
            { key: 'client', label: 'Client', numeric: false },
            { key: 'conteneur', label: 'Conteneur', numeric: false },
            { key: 'palette', label: 'Palette', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'cartons', label: 'Cartons', numeric: true },
            { key: 'expedie', label: 'Expédié le', numeric: false },
          ]}
          isEmpty={data.shipments.length === 0}
          emptyText="Ce Lot PF n'a fait l'objet d'aucune expédition."
        >
          {data.shipments.map((shipment, index) => (
            <tr key={`${shipment.shipmentId}-${index}`}>
              <td>
                <Link to={`/expeditions/${shipment.shipmentId}`}>{shipment.shipmentCode}</Link>
              </td>
              <td>{shipment.customerName}</td>
              <td>{shipment.containerNumber ?? '-'}</td>
              <td>{shipment.palletCode}</td>
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

        <DataTable
          columns={[
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'bloque', label: 'Bloqué le', numeric: false },
            { key: 'motif', label: 'Motif', numeric: false },
            { key: 'leve', label: 'Levé le', numeric: false },
          ]}
          isEmpty={data.blocks.length === 0}
          emptyText="Aucun blocage."
        >
          {data.blocks.map((block, index) => (
            <tr key={`${block.blockedAt}-${index}`}>
              <td>
                <Badge value={block.status} />
              </td>
              <td>{formatDateTime(block.blockedAt)}</td>
              <td>{block.reason}</td>
              <td>{formatDateTime(block.releasedAt)}</td>
            </tr>
          ))}
        </DataTable>

        {can('fgquality:decide') ? (
          <div className="imprimer-masquer" style={{ marginTop: 18 }}>
            <Field label="Motif de la décision qualité" hint={null}>
              <input
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                placeholder="Motif obligatoire"
              />
            </Field>
            <div className="ligne-boutons">
              {lot.qualityStatus === 'BLOQUE' ? (
                <button type="button" onClick={() => decide('LIBERE')} disabled={decisionReason.trim() === ''}>
                  Libérer le Lot PF
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => decide('ACCEPTE')}
                    disabled={decisionReason.trim() === ''}
                  >
                    Accepter (libère)
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => decide('BLOQUE')}
                    disabled={decisionReason.trim() === ''}
                  >
                    Bloquer le Lot PF
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      <Card title="Traçabilité">
        <p style={{ color: 'var(--texte-doux)', marginTop: 0 }}>
          Traçabilité complète (amont matières premières, aval expéditions) disponible depuis l'écran
          « Traçabilité », en recherchant {lot.lotCode} ou l'un des Runs / cycles ci-dessus.
        </p>
        <div className="ligne-boutons imprimer-masquer" style={{ marginTop: 0 }}>
          <Link to="/tracabilite">
            <button type="button" className="secondaire">
              Ouvrir la traçabilité
            </button>
          </Link>
        </div>
      </Card>
    </>
  );
}
