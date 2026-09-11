import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../auth';
import { Card, DataTable, Field, Message, PageHeader } from '../components/ui';
import { formatQuantity } from '../format';
import { useIngredientTanks, useIngredientTypes, useLocations } from '../masterdata';

/** Cuves (tanks, section 20) : matériel physique - jamais lié en permanence
 * à un ingrédient (le type indiqué n'est qu'une indication d'usage
 * habituel, jamais imposé). */
export function Cuves() {
  const { can } = useAuth();
  const tanks = useIngredientTanks();
  const ingredientTypes = useIngredientTypes();
  const locations = useLocations();
  const ingredientLocations = (locations.data ?? []).filter((location) => location.stockDomain === 'INGREDIENT');

  const [tankCode, setTankCode] = useState('');
  const [name, setName] = useState('');
  const [ingredientTypeId, setIngredientTypeId] = useState('');
  const [capacityLiters, setCapacityLiters] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/ingredient-tanks', {
        tankCode: tankCode.trim(),
        name: name.trim(),
        ingredientTypeId: ingredientTypeId === '' ? null : ingredientTypeId,
        capacityLiters: capacityLiters.trim() === '' ? null : capacityLiters.trim(),
        locationId: locationId === '' ? null : locationId,
      });
      setTankCode('');
      setName('');
      setCapacityLiters('');
      tanks.reload();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Cuves" subtitle="Matériel physique de mélange - le contenu réel se suit par lot de cuve" actions={null} />

      {can('masterdata:write') ? (
        <Card title="Nouvelle cuve">
          <Message kind="erreur" text={error} />
          <form id="creation" onSubmit={create}>
            <div className="grille-champs">
              <Field label="Code" hint={null}>
                <input value={tankCode} onChange={(event) => setTankCode(event.target.value)} required />
              </Field>
              <Field label="Nom" hint={null}>
                <input value={name} onChange={(event) => setName(event.target.value)} required />
              </Field>
              <Field label="Ingrédient habituel" hint="Indication seulement, jamais imposée.">
                <select value={ingredientTypeId} onChange={(event) => setIngredientTypeId(event.target.value)}>
                  <option value="">Non renseigné</option>
                  {(ingredientTypes.data ?? []).map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Capacité (L)" hint={null}>
                <input value={capacityLiters} onChange={(event) => setCapacityLiters(event.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Emplacement" hint={null}>
                <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                  <option value="">Non renseigné</option>
                  {ingredientLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="ligne-boutons">
              <button type="submit">Créer</button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={null}>
        {tanks.error ? <div className="message erreur">{tanks.error}</div> : null}
        {tanks.loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'code', label: 'Code', numeric: false },
              { key: 'nom', label: 'Nom', numeric: false },
              { key: 'type', label: 'Ingrédient habituel', numeric: false },
              { key: 'capacite', label: 'Capacité', numeric: true },
              { key: 'emplacement', label: 'Emplacement', numeric: false },
            ]}
            isEmpty={(tanks.data ?? []).length === 0}
            emptyText="Aucune cuve."
          >
            {(tanks.data ?? []).map((tank) => (
              <tr key={tank.id}>
                <td>
                  <Link to={`/ingredients/cuves/${tank.id}`}>
                    <strong>{tank.tankCode}</strong>
                  </Link>
                </td>
                <td>{tank.name}</td>
                <td>{tank.ingredientTypeName ?? '-'}</td>
                <td className="nombre">{tank.capacityLiters ? `${formatQuantity(tank.capacityLiters)} L` : '-'}</td>
                <td>{tank.locationCode ?? '-'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
