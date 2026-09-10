import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, KeyValue, Message, PageHeader } from '../components/ui';
import { formatDateTime, formatQuantity, label, nowLocalInput } from '../format';
import { useResource } from '../hooks';
import { useIngredientLossReasons, useIngredientTanks, useIngredients, useLocations } from '../masterdata';

type TankBatchRow = Readonly<{
  id: string;
  batchCode: string;
  tankId: string;
  tankCode: string;
  status: string;
  startedAt: string;
  closedAt: string | null;
  totalInputQuantity: string;
  remainingQuantity: string;
}>;

type TankBatchInputRow = Readonly<{ id: string; ingredientLotId: string; lotCode: string; quantity: string; unit: string; addedAt: string }>;

type TankMeasurementRow = Readonly<{ id: string; measuredAt: string; quantity: string; unit: string; measurementMethod: string | null }>;

type IngredientLotOption = Readonly<{ id: string; lotCode: string; ingredientId: string; ingredientCode: string; ingredientName: string; qualityStatus: string }>;

/** Situation d'une cuve (sections 20-22) : TANK (matériel) vs TANK BATCH
 * (contenu traçable) restent deux concepts distincts, jamais fusionnés - un
 * mélange de plusieurs lots reste une liste complète, jamais une allocation
 * fabriquée. */
export function CuveDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const tanks = useIngredientTanks();
  const tank = (tanks.data ?? []).find((entry) => entry.id === id) ?? null;
  const batches = useResource<readonly TankBatchRow[]>(`/api/tank-batches?tank=${id}`);
  const measurements = useResource<readonly TankMeasurementRow[]>(`/api/ingredient-tanks/${id}/mesures`);
  const lots = useResource<readonly IngredientLotOption[]>('/api/ingredient-lots?statut=LIBERE');
  const ingredients = useIngredients();
  const locations = useLocations();
  const lossReasons = useIngredientLossReasons();
  const ingredientLocations = (locations.data ?? []).filter((location) => location.stockDomain === 'INGREDIENT');

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const inputs = useResource<readonly TankBatchInputRow[]>(
    selectedBatchId ? `/api/tank-batches/${selectedBatchId}/entrees` : '/api/tank-batches/aucun/entrees',
  );

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [feedLotId, setFeedLotId] = useState('');
  const [feedSourceLocationId, setFeedSourceLocationId] = useState('');
  const [feedQuantity, setFeedQuantity] = useState('');

  const [lossSourceLocationId, setLossSourceLocationId] = useState('');
  const [lossQuantity, setLossQuantity] = useState('');
  const [lossReasonId, setLossReasonId] = useState('');

  const [measurementQuantity, setMeasurementQuantity] = useState('');
  const [measurementMethod, setMeasurementMethod] = useState('');
  const [measuredAt, setMeasuredAt] = useState(nowLocalInput());

  const call = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      batches.reload();
      inputs.reload();
      measurements.reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  if (tanks.loading && tank === null) {
    return <p>Chargement...</p>;
  }
  if (tank === null) {
    return <div className="message erreur">{tanks.error ?? 'Cuve introuvable.'}</div>;
  }

  const selectedLot = (lots.data ?? []).find((entry) => entry.id === feedLotId);
  const feedUnit = selectedLot ? (ingredients.data ?? []).find((entry) => entry.id === selectedLot.ingredientId)?.defaultUnit ?? 'L' : 'L';
  const selectedBatch = (batches.data ?? []).find((entry) => entry.id === selectedBatchId) ?? null;

  return (
    <>
      <PageHeader title={`Cuve ${tank.tankCode}`} subtitle={tank.name} actions={null} />

      <Message kind="erreur" text={error} />
      <Message kind="succes" text={success} />

      <Card title={null}>
        <KeyValue
          items={[
            { key: 'Ingrédient habituel', value: tank.ingredientTypeName ?? 'Non renseigné' },
            { key: 'Capacité', value: tank.capacityLiters ? `${formatQuantity(tank.capacityLiters)} L` : '-' },
            { key: 'Emplacement', value: tank.locationCode ?? '-' },
          ]}
        />
      </Card>

      {can('ingredient:transfer') ? (
        <Card title="Ouvrir un nouveau lot de cuve">
          <p className="aide">
            Un lot de cuve capture un événement de contenu traçable, distinct du matériel physique.
          </p>
          <div className="ligne-boutons" style={{ marginTop: 0 }}>
            <button
              type="button"
              onClick={() =>
                call(
                  () => apiPost(`/api/ingredient-tanks/${id}/lots`, {}),
                  'Lot de cuve ouvert.',
                )
              }
            >
              Ouvrir un lot de cuve
            </button>
          </div>
        </Card>
      ) : null}

      <Card title="Lots de cuve">
        <DataTable
          columns={[
            { key: 'lot', label: 'Lot de cuve', numeric: false },
            { key: 'statut', label: 'Statut', numeric: false },
            { key: 'debut', label: 'Ouvert le', numeric: false },
            { key: 'fin', label: 'Clôturé le', numeric: false },
            { key: 'entree', label: 'Total alimenté', numeric: true },
            { key: 'restant', label: 'Restant (théorique)', numeric: true },
            { key: 'actions', label: '', numeric: false },
          ]}
          isEmpty={(batches.data ?? []).length === 0}
          emptyText="Aucun lot de cuve pour cette cuve."
        >
          {(batches.data ?? []).map((batch) => (
            <tr key={batch.id}>
              <td>
                <strong>{batch.batchCode}</strong>
              </td>
              <td>
                <Badge value={batch.status} />
              </td>
              <td>{formatDateTime(batch.startedAt)}</td>
              <td>{batch.closedAt ? formatDateTime(batch.closedAt) : '-'}</td>
              <td className="nombre">{formatQuantity(batch.totalInputQuantity)} L</td>
              <td className="nombre">{formatQuantity(batch.remainingQuantity)} L</td>
              <td>
                <button type="button" className="lien" onClick={() => setSelectedBatchId(batch.id)}>
                  Gérer
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>

      {selectedBatch ? (
        <Card title={`Lot de cuve ${selectedBatch.batchCode}`}>
          <h3 style={{ marginTop: 0 }}>Généalogie (lots ayant alimenté ce lot de cuve)</h3>
          <DataTable
            columns={[
              { key: 'lot', label: 'Lot ingrédient', numeric: false },
              { key: 'heure', label: 'Ajouté le', numeric: false },
              { key: 'quantite', label: 'Quantité', numeric: true },
            ]}
            isEmpty={(inputs.data ?? []).length === 0}
            emptyText="Aucune entrée pour ce lot de cuve."
          >
            {(inputs.data ?? []).map((input) => (
              <tr key={input.id}>
                <td>{input.lotCode}</td>
                <td>{formatDateTime(input.addedAt)}</td>
                <td className="nombre">
                  {formatQuantity(input.quantity)} {label(input.unit)}
                </td>
              </tr>
            ))}
          </DataTable>

          {can('ingredient:transfer') && selectedBatch.status === 'OUVERT' ? (
            <>
              <h3>Alimenter la cuve</h3>
              <div className="grille-champs">
                <Field label="Lot ingrédient (statut libéré)" hint="Le mélange de plusieurs lots reste toujours visible, jamais fusionné.">
                  <select value={feedLotId} onChange={(event) => setFeedLotId(event.target.value)}>
                    <option value="">Sélectionner...</option>
                    {(lots.data ?? []).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.lotCode} — {entry.ingredientCode}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Emplacement source" hint={null}>
                  <select value={feedSourceLocationId} onChange={(event) => setFeedSourceLocationId(event.target.value)}>
                    <option value="">Sélectionner...</option>
                    {ingredientLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`Quantité (${feedUnit})`} hint={null}>
                  <input value={feedQuantity} onChange={(event) => setFeedQuantity(event.target.value)} inputMode="decimal" />
                </Field>
              </div>
              <div className="ligne-boutons">
                <button
                  type="button"
                  disabled={feedLotId === '' || feedSourceLocationId === '' || feedQuantity === ''}
                  onClick={() =>
                    call(
                      () =>
                        apiPost(`/api/tank-batches/${selectedBatch.id}/entrees`, {
                          ingredientLotId: feedLotId,
                          sourceLocationId: feedSourceLocationId,
                          quantity: feedQuantity,
                          unit: feedUnit,
                          addedAt: new Date().toISOString(),
                        }),
                      'Cuve alimentée.',
                    ).then(() => {
                      setFeedLotId('');
                      setFeedQuantity('');
                    })
                  }
                >
                  Alimenter
                </button>
              </div>

              <h3>Perte depuis la cuve</h3>
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
                <Field label="Quantité (L)" hint={null}>
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
                        apiPost(`/api/tank-batches/${selectedBatch.id}/perte`, {
                          sourceLocationId: lossSourceLocationId,
                          quantity: lossQuantity,
                          unit: 'L',
                          occurredAt: new Date().toISOString(),
                          lossReasonId,
                          reason: null,
                          productionRunId: null,
                        }),
                      'Perte enregistrée.',
                    ).then(() => setLossQuantity(''))
                  }
                >
                  Déclarer la perte
                </button>
                <button
                  type="button"
                  className="secondaire"
                  onClick={() =>
                    call(
                      () => apiPost(`/api/tank-batches/${selectedBatch.id}/cloture`, {}),
                      'Lot de cuve clôturé.',
                    )
                  }
                >
                  Clôturer le lot de cuve
                </button>
              </div>
            </>
          ) : null}
        </Card>
      ) : null}

      <Card title="Mesures manuelles de la cuve">
        <p className="aide">Une mesure manuelle reste distincte du stock théorique calculé à partir des mouvements.</p>
        {can('ingredient:transfer') ? (
          <div className="grille-champs">
            <Field label="Quantité mesurée (L)" hint={null}>
              <input value={measurementQuantity} onChange={(event) => setMeasurementQuantity(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Méthode" hint={null}>
              <input value={measurementMethod} onChange={(event) => setMeasurementMethod(event.target.value)} placeholder="Jauge, sonde..." />
            </Field>
            <Field label="Mesuré le" hint={null}>
              <input type="datetime-local" value={measuredAt} onChange={(event) => setMeasuredAt(event.target.value)} />
            </Field>
          </div>
        ) : null}
        {can('ingredient:transfer') ? (
          <div className="ligne-boutons">
            <button
              type="button"
              className="secondaire"
              disabled={measurementQuantity === ''}
              onClick={() =>
                call(
                  () =>
                    apiPost(`/api/ingredient-tanks/${id}/mesures`, {
                      measuredAt: new Date(measuredAt).toISOString(),
                      quantity: measurementQuantity,
                      unit: 'L',
                      measurementMethod: measurementMethod.trim() === '' ? null : measurementMethod.trim(),
                    }),
                  'Mesure enregistrée.',
                ).then(() => setMeasurementQuantity(''))
              }
            >
              Enregistrer la mesure
            </button>
          </div>
        ) : null}

        <DataTable
          columns={[
            { key: 'heure', label: 'Mesuré le', numeric: false },
            { key: 'methode', label: 'Méthode', numeric: false },
            { key: 'quantite', label: 'Quantité', numeric: true },
          ]}
          isEmpty={(measurements.data ?? []).length === 0}
          emptyText="Aucune mesure manuelle."
        >
          {(measurements.data ?? []).map((measurement) => (
            <tr key={measurement.id}>
              <td>{formatDateTime(measurement.measuredAt)}</td>
              <td>{measurement.measurementMethod ?? '-'}</td>
              <td className="nombre">
                {formatQuantity(measurement.quantity)} {label(measurement.unit)}
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
    </>
  );
}
