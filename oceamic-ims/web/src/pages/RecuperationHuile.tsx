import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDateTime, formatQuantity } from '../format';
import { useResource } from '../hooks';
import { useIngredientContainers, useIngredients, useLocations } from '../masterdata';

type RecoveredBatchRow = Readonly<{
  id: string;
  recoveryCode: string;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  sourceProductionRunId: string;
  sourceRunCode: string;
  recoveredAt: string;
  quantity: string;
  reusedQuantity: string;
  remainingQuantity: string;
  unit: string;
  storageLocationCode: string | null;
  reuseDeadline: string;
  isExpired: boolean;
  effectiveStatus: string;
}>;

type RunOption = Readonly<{ id: string; runCode: string }>;

const REUSABLE_STATUSES = ['DISPONIBLE', 'UTILISE_PARTIELLEMENT'];

/** Récupération et réutilisation d'huile (sections 24-32) : un matériau
 * réellement nouveau né du procédé, une date limite toujours calculée
 * (jamais saisie), une réutilisation FEFO (les lots proches de l'échéance
 * en premier) - un lot expiré ne redevient jamais réutilisable par un
 * simple changement de statut. */
export function RecuperationHuile() {
  const { can } = useAuth();
  const ingredients = useIngredients();
  const recoverableIngredients = (ingredients.data ?? []).filter((ingredient) => ingredient.isRecoverable);
  const locations = useLocations();
  const ingredientLocations = (locations.data ?? []).filter((location) => location.stockDomain === 'INGREDIENT');
  const containers = useIngredientContainers();
  const runs = useResource<readonly RunOption[]>('/api/production/runs');

  const [ingredientFilter, setIngredientFilter] = useState('');
  const [availableOnly, setAvailableOnly] = useState(true);
  const query = buildQuery({ ingredient: ingredientFilter, disponiblesUniquement: availableOnly ? 'true' : '' });
  const { data, error, loading, reload } = useResource<readonly RecoveredBatchRow[]>(`/api/recovered-ingredients${query}`);
  const sorted = [...(data ?? [])].sort((a, b) => new Date(a.reuseDeadline).getTime() - new Date(b.reuseDeadline).getTime());

  const [recIngredientId, setRecIngredientId] = useState('');
  const [recSourceRunId, setRecSourceRunId] = useState('');
  const [recQuantity, setRecQuantity] = useState('');
  const [recStorageLocationId, setRecStorageLocationId] = useState('');
  const [recContainerId, setRecContainerId] = useState('');

  const [reuseBatchId, setReuseBatchId] = useState<string | null>(null);
  const [reuseDestinationRunId, setReuseDestinationRunId] = useState('');
  const [reuseQuantity, setReuseQuantity] = useState('');

  const [error2, setError2] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedRecIngredient = recoverableIngredients.find((ingredient) => ingredient.id === recIngredientId);
  const reuseBatch = sorted.find((batch) => batch.id === reuseBatchId) ?? null;

  const call = async (action: () => Promise<unknown>, message: string) => {
    setError2(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(message);
      reload();
    } catch (failure) {
      setError2((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Huile récupérée" subtitle="Récupération, délai de réutilisation calculé et réutilisation FEFO" actions={null} />

      <Message kind="erreur" text={error2} />
      <Message kind="succes" text={success} />

      {can('ingredient:consume') ? (
        <Card title="Nouvelle récupération">
          <form
            id="creation"
            onSubmit={(event) => {
              event.preventDefault();
              if (!selectedRecIngredient) {
                return;
              }
              void call(
                () =>
                  apiPost('/api/recovered-ingredients', {
                    ingredientId: recIngredientId,
                    sourceProductionRunId: recSourceRunId,
                    sourceFillingOperationId: null,
                    recoveredAt: new Date().toISOString(),
                    quantity: recQuantity,
                    unit: selectedRecIngredient.defaultUnit,
                    storageLocationId: recStorageLocationId === '' ? null : recStorageLocationId,
                    containerId: recContainerId === '' ? null : recContainerId,
                    notes: null,
                  }),
                'Récupération enregistrée. Délai de réutilisation calculé automatiquement.',
              ).then(() => setRecQuantity(''));
            }}
          >
            <div className="grille-champs">
              <Field label="Ingrédient récupérable" hint={null}>
                <select value={recIngredientId} onChange={(event) => setRecIngredientId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {recoverableIngredients.map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {ingredient.ingredientCode} — {ingredient.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Run source" hint={null}>
                <select value={recSourceRunId} onChange={(event) => setRecSourceRunId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(runs.data ?? []).map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.runCode}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Quantité${selectedRecIngredient ? ` (${selectedRecIngredient.defaultUnit})` : ''}`} hint={null}>
                <input value={recQuantity} onChange={(event) => setRecQuantity(event.target.value)} inputMode="decimal" required />
              </Field>
              <Field label="Emplacement de stockage" hint={null}>
                <select value={recStorageLocationId} onChange={(event) => setRecStorageLocationId(event.target.value)}>
                  <option value="">Non renseigné</option>
                  {ingredientLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Contenant" hint={null}>
                <select value={recContainerId} onChange={(event) => setRecContainerId(event.target.value)}>
                  <option value="">Non renseigné</option>
                  {(containers.data ?? []).map((container) => (
                    <option key={container.id} value={container.id}>
                      {container.containerCode}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit" disabled={!selectedRecIngredient}>
                Enregistrer la récupération
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={null}>
        <div className="filtres">
          <select value={ingredientFilter} onChange={(event) => setIngredientFilter(event.target.value)}>
            <option value="">Tous les ingrédients</option>
            {recoverableIngredients.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.ingredientCode} — {ingredient.name}
              </option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} />
            Disponibles uniquement (triées par échéance)
          </label>
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'code', label: 'Récupération', numeric: false },
              { key: 'ingredient', label: 'Ingrédient', numeric: false },
              { key: 'source', label: 'Run source', numeric: false },
              { key: 'recupere', label: 'Récupérée le', numeric: false },
              { key: 'quantite', label: 'Quantité', numeric: true },
              { key: 'restant', label: 'Restant', numeric: true },
              { key: 'echeance', label: 'Délai de réutilisation', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'actions', label: '', numeric: false },
            ]}
            isEmpty={sorted.length === 0}
            emptyText="Aucune récupération."
          >
            {sorted.map((batch) => {
              const isReusable = REUSABLE_STATUSES.includes(batch.effectiveStatus);
              return (
                <tr key={batch.id}>
                  <td>
                    <strong>{batch.recoveryCode}</strong>
                  </td>
                  <td>
                    {batch.ingredientCode} — {batch.ingredientName}
                  </td>
                  <td>
                    <Link to={`/production/${batch.sourceProductionRunId}`}>{batch.sourceRunCode}</Link>
                  </td>
                  <td>{formatDateTime(batch.recoveredAt)}</td>
                  <td className="nombre">{formatQuantity(batch.quantity)}</td>
                  <td className="nombre">{formatQuantity(batch.remainingQuantity)}</td>
                  <td className={batch.isExpired ? 'nombre' : ''} style={batch.isExpired ? { color: 'var(--alerte)' } : undefined}>
                    {formatDateTime(batch.reuseDeadline)}
                  </td>
                  <td>
                    <Badge value={batch.effectiveStatus} />
                  </td>
                  <td>
                    <div className="ligne-boutons" style={{ marginTop: 0 }}>
                      {can('ingredient:consume') && isReusable ? (
                        <button type="button" className="lien" onClick={() => setReuseBatchId(batch.id)}>
                          Réutiliser
                        </button>
                      ) : null}
                      {can('ingredient:quality') && batch.effectiveStatus !== 'ELIMINE' ? (
                        <>
                          <button
                            type="button"
                            className="lien"
                            onClick={() =>
                              call(
                                () =>
                                  apiPost(`/api/recovered-ingredients/${batch.id}/statut`, {
                                    status: 'BLOQUE',
                                    reason: 'Blocage qualité (interface).',
                                  }),
                                'Lot de récupération bloqué.',
                              )
                            }
                          >
                            Bloquer
                          </button>
                          <button
                            type="button"
                            className="lien"
                            onClick={() =>
                              call(
                                () =>
                                  apiPost(`/api/recovered-ingredients/${batch.id}/statut`, {
                                    status: 'ELIMINE',
                                    reason: 'Élimination (interface).',
                                  }),
                                'Lot de récupération éliminé.',
                              )
                            }
                          >
                            Éliminer
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      {reuseBatch ? (
        <Card title={`Réutiliser ${reuseBatch.recoveryCode}`}>
          <p className="aide">
            Restant : {formatQuantity(reuseBatch.remainingQuantity)} {reuseBatch.unit} — délai de réutilisation :{' '}
            {formatDateTime(reuseBatch.reuseDeadline)}.
          </p>
          <div className="grille-champs">
            <Field label="Run destination" hint={null}>
              <select value={reuseDestinationRunId} onChange={(event) => setReuseDestinationRunId(event.target.value)}>
                <option value="">Sélectionner...</option>
                {(runs.data ?? []).map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.runCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Quantité (${reuseBatch.unit})`} hint={null}>
              <input value={reuseQuantity} onChange={(event) => setReuseQuantity(event.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button
              type="button"
              disabled={reuseDestinationRunId === '' || reuseQuantity === ''}
              onClick={() =>
                call(
                  () =>
                    apiPost(`/api/recovered-ingredients/${reuseBatch.id}/reutilisation`, {
                      destinationProductionRunId: reuseDestinationRunId,
                      destinationFillingOperationId: null,
                      quantity: reuseQuantity,
                      unit: reuseBatch.unit,
                      reusedAt: new Date().toISOString(),
                    }),
                  'Réutilisation enregistrée.',
                ).then(() => {
                  setReuseQuantity('');
                  setReuseBatchId(null);
                })
              }
            >
              Confirmer la réutilisation
            </button>
            <button type="button" className="secondaire" onClick={() => setReuseBatchId(null)}>
              Annuler
            </button>
          </div>
        </Card>
      ) : null}
    </>
  );
}
