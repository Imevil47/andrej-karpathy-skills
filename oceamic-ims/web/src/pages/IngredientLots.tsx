import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost, buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, nowLocalInput } from '../format';
import { useResource } from '../hooks';
import { useIngredients, useLocations } from '../masterdata';

type IngredientLotRow = Readonly<{
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

const QUALITY_STATUSES = ['LIBERE', 'BLOQUE', 'A_VERIFIER', 'REJETE'] as const;

/** Lots ingrédient (sections 8/9) : matières de production traçables, un
 * statut qualité qui leur est propre, jamais un total quotidien saisi à la
 * main - mirrors Receptions.tsx/Lots.tsx. */
export function IngredientLots() {
  const { can } = useAuth();
  const ingredients = useIngredients();
  const locations = useLocations();
  const [ingredientFilter, setIngredientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const query = buildQuery({ ingredient: ingredientFilter, statut: statusFilter });
  const { data, error, loading, reload } = useResource<readonly IngredientLotRow[]>(`/api/ingredient-lots${query}`);
  const ingredientLocations = (locations.data ?? []).filter((location) => location.stockDomain === 'INGREDIENT');

  const [ingredientId, setIngredientId] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [supplierLotCode, setSupplierLotCode] = useState('');
  const [manufactureDate, setManufactureDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [receivedAt, setReceivedAt] = useState(nowLocalInput());
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedIngredient = (ingredients.data ?? []).find((ingredient) => ingredient.id === ingredientId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedIngredient) {
      return;
    }
    setBusy(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      const lot = await apiPost<{ id: string; lotCode: string }>('/api/ingredient-lots', {
        lotCode: lotCode.trim() === '' ? `AUTO-${Date.now()}` : lotCode.trim(),
        ingredientId,
        supplierId: null,
        supplierLotCode: supplierLotCode.trim() === '' ? null : supplierLotCode.trim(),
        receivedAt: new Date(receivedAt).toISOString(),
        manufactureDate: manufactureDate === '' ? null : manufactureDate,
        expiryDate: expiryDate === '' ? null : expiryDate,
        notes: null,
      });
      await apiPost(`/api/ingredient-lots/${lot.id}/reception`, {
        destinationLocationId,
        quantity,
        unit: selectedIngredient.defaultUnit,
        occurredAt: new Date(receivedAt).toISOString(),
      });
      setCreateSuccess(`Lot ${lot.lotCode} réceptionné.`);
      setLotCode('');
      setSupplierLotCode('');
      setQuantity('');
      reload();
    } catch (failure) {
      setCreateError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Lots ingrédient" subtitle="Matières de production traçables : huiles, sauces, saumure, sel..." actions={null} />

      {can('ingredient:reception') ? (
        <Card title="Nouveau lot et réception">
          <Message kind="erreur" text={createError} />
          <Message kind="succes" text={createSuccess} />
          <form id="creation" onSubmit={submit}>
            <div className="grille-champs">
              <Field label="Ingrédient" hint={null}>
                <select value={ingredientId} onChange={(event) => setIngredientId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {(ingredients.data ?? []).map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {ingredient.ingredientCode} — {ingredient.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Code du lot" hint="Laisser vide pour un code généré automatiquement.">
                <input value={lotCode} onChange={(event) => setLotCode(event.target.value)} />
              </Field>
              <Field label="Code lot fournisseur" hint={null}>
                <input value={supplierLotCode} onChange={(event) => setSupplierLotCode(event.target.value)} />
              </Field>
              <Field label="Date de fabrication" hint={null}>
                <input type="date" value={manufactureDate} onChange={(event) => setManufactureDate(event.target.value)} />
              </Field>
              <Field label="Date d'expiration" hint={null}>
                <input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
              </Field>
              <Field label="Emplacement de réception" hint={null}>
                <select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)} required>
                  <option value="">Sélectionner...</option>
                  {ingredientLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Quantité${selectedIngredient ? ` (${selectedIngredient.defaultUnit})` : ''}`} hint={null}>
                <input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" required />
              </Field>
              <Field label="Reçu le" hint={null}>
                <input type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} required />
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit" disabled={busy || !selectedIngredient}>
                Créer et réceptionner
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={null}>
        <div className="filtres">
          <select value={ingredientFilter} onChange={(event) => setIngredientFilter(event.target.value)}>
            <option value="">Tous les ingrédients</option>
            {(ingredients.data ?? []).map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.ingredientCode} — {ingredient.name}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Tous les statuts qualité</option>
            {QUALITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'lot', label: 'Lot', numeric: false },
              { key: 'ingredient', label: 'Ingrédient', numeric: false },
              { key: 'fournisseur', label: 'Fournisseur', numeric: false },
              { key: 'recu', label: 'Reçu le', numeric: false },
              { key: 'expiration', label: 'Expiration', numeric: false },
              { key: 'statut', label: 'Statut qualité', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun lot ingrédient."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/ingredients/lots/${row.id}`}>
                    <strong>{row.lotCode}</strong>
                  </Link>
                </td>
                <td>
                  {row.ingredientCode} — {row.ingredientName}
                </td>
                <td>{row.supplierName ?? '-'}</td>
                <td>{formatDateTime(row.receivedAt)}</td>
                <td>{formatDate(row.expiryDate)}</td>
                <td>
                  <Badge value={row.qualityStatus} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
