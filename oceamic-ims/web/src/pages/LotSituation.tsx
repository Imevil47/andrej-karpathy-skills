import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, formatQuantity, label } from '../format';
import { useResource } from '../hooks';

type LotSituationPayload = Readonly<{
  lot: Readonly<{
    id: string;
    lotCode: string;
    status: string;
    origin: string | null;
    tideNumber: string | null;
    captureDate: string | null;
    initialReceptionDate: string | null;
    notes: string | null;
    speciesName: string;
    supplierName: string | null;
    vesselName: string | null;
    parentLotId: string | null;
    parentLotCode: string | null;
    createdByName: string;
    totalStockKg: string;
    isBlocked: boolean;
  }>;
  stockByLocation: readonly Readonly<{
    locationCode: string;
    locationName: string;
    stockType: string;
    physicalQuantityKg: string;
    blockedQuantityKg: string;
    availableQuantityKg: string;
  }>[];
  receptions: readonly Readonly<{
    receptionCode: string;
    receivedAt: string;
    quantityKg: string;
    receptionType: string;
    truckRegistration: string | null;
    destinationLocationCode: string;
    documentReference: string | null;
  }>[];
  movements: readonly Readonly<{
    id: string;
    movementCode: string;
    occurredAt: string;
    movementType: string;
    quantityKg: string;
    sourceLocationCode: string | null;
    destinationLocationCode: string | null;
    reason: string | null;
    createdByName: string;
  }>[];
  inspections: readonly Readonly<{
    inspectionCode: string;
    inspectedAt: string;
    inspectionType: string;
    temperatureC: string | null;
    histaminePpm: string | null;
    abvt: string | null;
    qualityGrade: string | null;
    sizeGrade: string | null;
    result: string;
    inspectorName: string;
  }>[];
  decisions: readonly Readonly<{
    decisionType: string;
    reason: string;
    decidedAt: string;
    decidedByName: string;
    inspectionCode: string | null;
  }>[];
  blocks: readonly Readonly<{
    status: string;
    blockedAt: string;
    reason: string;
    releasedAt: string | null;
    releaseReason: string | null;
    blockedByName: string;
    releasedByName: string | null;
  }>[];
  subcontracting: readonly Readonly<{
    operationCode: string;
    sentAt: string;
    sourceType: string;
    quantitySentKg: string;
    status: string;
    subcontractorName: string;
    resultsKg: string;
    differenceKg: string;
  }>[];
  children: readonly Readonly<{ id: string; lotCode: string; status: string; stockKg: string }>[];
  productionRuns: readonly Readonly<{
    runId: string;
    runCode: string;
    productionDate: string;
    runStatus: string;
    productCode: string;
    productName: string;
    consumedKg: string;
  }>[];
}>;

/**
 * "Situation du lot": the single traceability page of Phase 1. Identity,
 * stock, movements, quality and subcontracting of one lot, in one place.
 */
export function LotSituation() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useResource<LotSituationPayload>(
    `/api/lots/${id}/situation`,
  );
  const [decisionReason, setDecisionReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const decide = async (decisionType: 'BLOQUE' | 'LIBERE') => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await apiPost('/api/quality/decisions', {
        rawMaterialLotId: id,
        inspectionId: null,
        decisionType,
        reason: decisionReason.trim(),
        notes: null,
      });
      setActionSuccess(
        decisionType === 'BLOQUE' ? 'Lot bloqué par le service Qualité.' : 'Lot libéré.',
      );
      setDecisionReason('');
      reload();
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  if (loading) {
    return <p>Chargement...</p>;
  }
  if (error || data === null) {
    return <div className="message erreur">{error ?? 'Lot introuvable.'}</div>;
  }

  const { lot } = data;

  return (
    <>
      <PageHeader
        title={`Situation du lot ${lot.lotCode}`}
        subtitle={`${lot.speciesName} — stock total ${formatQuantity(lot.totalStockKg)} kg`}
        actions={<Badge value={lot.isBlocked ? 'BLOQUE' : lot.status} />}
      />

      <Message kind="erreur" text={actionError} />
      <Message kind="succes" text={actionSuccess} />

      {lot.isBlocked ? (
        <div className="message erreur">
          Ce lot est bloqué par le service Qualité. La consommation et la sous-traitance sont
          interdites.
        </div>
      ) : null}

      <Card title="Identité et origine">
        <KeyValue
          items={[
            { key: 'Code lot', value: lot.lotCode },
            { key: 'Espèce', value: lot.speciesName },
            { key: 'Fournisseur', value: lot.supplierName ?? '-' },
            { key: 'Bateau', value: lot.vesselName ?? '-' },
            { key: 'Marée', value: lot.tideNumber ?? '-' },
            { key: 'Origine', value: lot.origin ?? '-' },
            { key: 'Date de capture', value: formatDate(lot.captureDate) },
            { key: 'Première réception', value: formatDate(lot.initialReceptionDate) },
            {
              key: 'Lot parent',
              value: lot.parentLotId ? (
                <Link to={`/lots/${lot.parentLotId}`}>{lot.parentLotCode}</Link>
              ) : (
                '-'
              ),
            },
            { key: 'Créé par', value: lot.createdByName },
          ]}
        />
      </Card>

      <Card title="Stock actuel par emplacement">
        <DataTable
          columns={[
            { key: 'emplacement', label: 'Emplacement', numeric: false },
            { key: 'type', label: 'Type de stock', numeric: false },
            { key: 'physique', label: 'Stock physique (kg)', numeric: true },
            { key: 'bloque', label: 'Stock bloqué (kg)', numeric: true },
            { key: 'dispo', label: 'Stock disponible (kg)', numeric: true },
          ]}
          isEmpty={data.stockByLocation.length === 0}
          emptyText="Aucun stock pour ce lot."
        >
          {data.stockByLocation.map((row) => (
            <tr key={row.locationCode}>
              <td>{row.locationName}</td>
              <td>
                <Badge value={row.stockType} />
              </td>
              <td className="nombre">{formatQuantity(row.physicalQuantityKg)}</td>
              <td className="nombre">{formatQuantity(row.blockedQuantityKg)}</td>
              <td className="nombre">{formatQuantity(row.availableQuantityKg)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Réceptions">
        <DataTable
          columns={[
            { key: 'code', label: 'Réception', numeric: false },
            { key: 'date', label: 'Date', numeric: false },
            { key: 'type', label: 'Type', numeric: false },
            { key: 'camion', label: 'Camion', numeric: false },
            { key: 'document', label: 'Document', numeric: false },
            { key: 'destination', label: 'Destination', numeric: false },
            { key: 'quantite', label: 'Quantité (kg)', numeric: true },
          ]}
          isEmpty={data.receptions.length === 0}
          emptyText="Aucune réception."
        >
          {data.receptions.map((row) => (
            <tr key={row.receptionCode}>
              <td>{row.receptionCode}</td>
              <td>{formatDateTime(row.receivedAt)}</td>
              <td>{label(row.receptionType)}</td>
              <td>{row.truckRegistration ?? '-'}</td>
              <td>{row.documentReference ?? '-'}</td>
              <td>{row.destinationLocationCode}</td>
              <td className="nombre">{formatQuantity(row.quantityKg)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Historique des mouvements">
        <DataTable
          columns={[
            { key: 'code', label: 'Mouvement', numeric: false },
            { key: 'date', label: 'Date', numeric: false },
            { key: 'type', label: 'Type', numeric: false },
            { key: 'source', label: 'Source', numeric: false },
            { key: 'destination', label: 'Destination', numeric: false },
            { key: 'motif', label: 'Motif', numeric: false },
            { key: 'auteur', label: 'Utilisateur', numeric: false },
            { key: 'quantite', label: 'Quantité (kg)', numeric: true },
          ]}
          isEmpty={data.movements.length === 0}
          emptyText="Aucun mouvement."
        >
          {data.movements.map((row) => (
            <tr key={row.id}>
              <td>{row.movementCode}</td>
              <td>{formatDateTime(row.occurredAt)}</td>
              <td>{label(row.movementType)}</td>
              <td>{row.sourceLocationCode ?? '-'}</td>
              <td>{row.destinationLocationCode ?? '-'}</td>
              <td>{row.reason ?? '-'}</td>
              <td>{row.createdByName}</td>
              <td className="nombre">{formatQuantity(row.quantityKg)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Contrôles qualité">
        <DataTable
          columns={[
            { key: 'code', label: 'Contrôle', numeric: false },
            { key: 'date', label: 'Date', numeric: false },
            { key: 'type', label: 'Type', numeric: false },
            { key: 'temperature', label: 'Température (°C)', numeric: true },
            { key: 'histamine', label: 'Histamine (ppm)', numeric: true },
            { key: 'abvt', label: 'ABVT', numeric: true },
            { key: 'qualite', label: 'Qualité', numeric: false },
            { key: 'calibre', label: 'Calibre', numeric: false },
            { key: 'resultat', label: 'Résultat', numeric: false },
            { key: 'controleur', label: 'Contrôleur', numeric: false },
          ]}
          isEmpty={data.inspections.length === 0}
          emptyText="Aucun contrôle enregistré."
        >
          {data.inspections.map((row) => (
            <tr key={row.inspectionCode}>
              <td>{row.inspectionCode}</td>
              <td>{formatDateTime(row.inspectedAt)}</td>
              <td>{label(row.inspectionType)}</td>
              <td className="nombre">{row.temperatureC ?? '-'}</td>
              <td className="nombre">{row.histaminePpm ?? '-'}</td>
              <td className="nombre">{row.abvt ?? '-'}</td>
              <td>{row.qualityGrade ?? '-'}</td>
              <td>{row.sizeGrade ?? '-'}</td>
              <td>
                <Badge value={row.result} />
              </td>
              <td>{row.inspectorName}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Décisions qualité">
        <DataTable
          columns={[
            { key: 'decision', label: 'Décision', numeric: false },
            { key: 'date', label: 'Date', numeric: false },
            { key: 'motif', label: 'Motif', numeric: false },
            { key: 'controle', label: 'Contrôle source', numeric: false },
            { key: 'auteur', label: 'Décidé par', numeric: false },
          ]}
          isEmpty={data.decisions.length === 0}
          emptyText="Aucune décision qualité."
        >
          {data.decisions.map((row, index) => (
            <tr key={`${row.decidedAt}-${index}`}>
              <td>
                <Badge value={row.decisionType} />
              </td>
              <td>{formatDateTime(row.decidedAt)}</td>
              <td>{row.reason}</td>
              <td>{row.inspectionCode ?? '-'}</td>
              <td>{row.decidedByName}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Blocages et libérations">
        <DataTable
          columns={[
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'bloque', label: 'Bloqué le', numeric: false },
            { key: 'par', label: 'Bloqué par', numeric: false },
            { key: 'motif', label: 'Motif du blocage', numeric: false },
            { key: 'leve', label: 'Levé le', numeric: false },
            { key: 'levepar', label: 'Levé par', numeric: false },
            { key: 'motifleve', label: 'Motif de la levée', numeric: false },
          ]}
          isEmpty={data.blocks.length === 0}
          emptyText="Aucun blocage."
        >
          {data.blocks.map((row, index) => (
            <tr key={`${row.blockedAt}-${index}`}>
              <td>
                <Badge value={row.status} />
              </td>
              <td>{formatDateTime(row.blockedAt)}</td>
              <td>{row.blockedByName}</td>
              <td>{row.reason}</td>
              <td>{formatDateTime(row.releasedAt)}</td>
              <td>{row.releasedByName ?? '-'}</td>
              <td>{row.releaseReason ?? '-'}</td>
            </tr>
          ))}
        </DataTable>

        {can('quality:decide') ? (
          <div style={{ marginTop: 18 }}>
            <Field label="Motif de la décision qualité" hint={null}>
              <input
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                placeholder="Motif obligatoire"
              />
            </Field>
            <div className="ligne-boutons">
              {lot.isBlocked ? (
                can('quality:release') ? (
                  <button
                    type="button"
                    onClick={() => decide('LIBERE')}
                    disabled={decisionReason.trim() === ''}
                  >
                    Libérer le lot
                  </button>
                ) : null
              ) : (
                <button
                  type="button"
                  className="danger"
                  onClick={() => decide('BLOQUE')}
                  disabled={decisionReason.trim() === ''}
                >
                  Bloquer le lot
                </button>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      <Card title="Sous-traitance">
        <DataTable
          columns={[
            { key: 'code', label: 'Opération', numeric: false },
            { key: 'date', label: 'Envoi', numeric: false },
            { key: 'sous-traitant', label: 'Sous-traitant', numeric: false },
            { key: 'mode', label: 'Origine', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'envoye', label: 'Envoyé (kg)', numeric: true },
            { key: 'resultats', label: 'Résultats (kg)', numeric: true },
            { key: 'ecart', label: 'Écart (kg)', numeric: true },
          ]}
          isEmpty={data.subcontracting.length === 0}
          emptyText="Aucune opération de sous-traitance."
        >
          {data.subcontracting.map((row) => (
            <tr key={row.operationCode}>
              <td>{row.operationCode}</td>
              <td>{formatDateTime(row.sentAt)}</td>
              <td>{row.subcontractorName}</td>
              <td>{label(row.sourceType)}</td>
              <td>
                <Badge value={row.status} />
              </td>
              <td className="nombre">{formatQuantity(row.quantitySentKg)}</td>
              <td className="nombre">{formatQuantity(row.resultsKg)}</td>
              <td className="nombre">{formatQuantity(row.differenceKg)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Runs consommateurs">
        <DataTable
          columns={[
            { key: 'run', label: 'Run', numeric: false },
            { key: 'date', label: 'Date', numeric: false },
            { key: 'produit', label: 'Produit', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'quantite', label: 'Quantité consommée (kg)', numeric: true },
          ]}
          isEmpty={data.productionRuns.length === 0}
          emptyText="Ce lot n'a été consommé par aucun ordre de production."
        >
          {data.productionRuns.map((row) => (
            <tr key={row.runId}>
              <td>
                <Link to={`/production/${row.runId}`}>
                  <strong>{row.runCode}</strong>
                </Link>
              </td>
              <td>{formatDate(row.productionDate)}</td>
              <td>
                {row.productCode} — {row.productName}
              </td>
              <td>
                <Badge value={row.runStatus} />
              </td>
              <td className="nombre">{formatQuantity(row.consumedKg)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Lots issus du fractionnement">
        <DataTable
          columns={[
            { key: 'lot', label: 'Lot enfant', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'stock', label: 'Stock (kg)', numeric: true },
          ]}
          isEmpty={data.children.length === 0}
          emptyText="Aucun lot enfant."
        >
          {data.children.map((child) => (
            <tr key={child.id}>
              <td>
                <Link to={`/lots/${child.id}`}>{child.lotCode}</Link>
              </td>
              <td>
                <Badge value={child.status} />
              </td>
              <td className="nombre">{formatQuantity(child.stockKg)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
