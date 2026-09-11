import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { Card, DataTable, PageHeader } from '../components/ui';
import { formatQuantity, label } from '../format';
import { useResource } from '../hooks';
import { useIngredients, useLocations } from '../masterdata';

type IngredientStockRow = Readonly<{
  ingredientLotId: string;
  lotCode: string;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  locationId: string;
  locationCode: string;
  quantity: string;
  unit: string;
}>;

/** Stock ingrédient (section 13) : toujours calculé à partir du grand livre
 * de mouvements, jamais un total stocké/modifiable - mirrors
 * StockSituation.tsx. */
export function IngredientStock() {
  const ingredients = useIngredients();
  const locations = useLocations();
  const [ingredientId, setIngredientId] = useState('');
  const [locationId, setLocationId] = useState('');

  const query = buildQuery({ ingredient: ingredientId, emplacement: locationId });
  const { data, error, loading } = useResource<readonly IngredientStockRow[]>(`/api/ingredient-stock${query}`);
  const ingredientLocations = (locations.data ?? []).filter((location) => location.stockDomain === 'INGREDIENT');

  return (
    <>
      <PageHeader title="Stock ingrédients" subtitle="Stock calculé à partir du grand livre de mouvements, par lot et par emplacement" actions={null} />

      <Card title={null}>
        <div className="filtres">
          <select value={ingredientId} onChange={(event) => setIngredientId(event.target.value)}>
            <option value="">Tous les ingrédients</option>
            {(ingredients.data ?? []).map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.ingredientCode} — {ingredient.name}
              </option>
            ))}
          </select>
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">Tous les emplacements</option>
            {ingredientLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
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
              { key: 'emplacement', label: 'Emplacement', numeric: false },
              { key: 'quantite', label: 'Quantité', numeric: true },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun stock ne correspond aux filtres."
          >
            {(data ?? []).map((row) => (
              <tr key={`${row.ingredientLotId}-${row.locationId}`}>
                <td>
                  <Link to={`/ingredients/lots/${row.ingredientLotId}`}>{row.lotCode}</Link>
                </td>
                <td>
                  {row.ingredientCode} — {row.ingredientName}
                </td>
                <td>{row.locationCode}</td>
                <td className="nombre">
                  {formatQuantity(row.quantity)} {label(row.unit)}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
