import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatQuantity } from '../format';
import { useResource } from '../hooks';
import { useLocations, useSpecies } from '../masterdata';

type StockRow = Readonly<{
  lotId: string;
  lotCode: string;
  speciesCode: string;
  sizeGrade: string | null;
  qualityGrade: string | null;
  locationCode: string;
  locationName: string;
  stockType: string;
  physicalQuantityKg: string;
  availableQuantityKg: string;
  isBlocked: boolean;
}>;

export function StockSituation() {
  const species = useSpecies();
  const locations = useLocations();
  const [filters, setFilters] = useState({
    lot: '',
    espece: '',
    emplacement: '',
    typeStock: '',
    bloques: '',
  });

  const query = buildQuery({
    lot: filters.lot,
    espece: filters.espece,
    emplacement: filters.emplacement,
    typeStock: filters.typeStock,
    bloques: filters.bloques,
  });
  const { data, error, loading } = useResource<readonly StockRow[]>(`/api/stock/situation${query}`);

  const update = (key: keyof typeof filters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <>
      <PageHeader
        title="Situation du stock"
        subtitle="Stock calculé à partir des mouvements, par lot et par emplacement"
        actions={null}
      />

      <Card title={null}>
        <div className="filtres">
          <input
            placeholder="Code lot"
            value={filters.lot}
            onChange={(event) => update('lot', event.target.value)}
          />
          <select value={filters.espece} onChange={(event) => update('espece', event.target.value)}>
            <option value="">Toutes les espèces</option>
            {(species.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={filters.emplacement}
            onChange={(event) => update('emplacement', event.target.value)}
          >
            <option value="">Tous les emplacements</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <select
            value={filters.typeStock}
            onChange={(event) => update('typeStock', event.target.value)}
          >
            <option value="">Interne et externe</option>
            <option value="INTERNE">Stock interne</option>
            <option value="EXTERNE">Stock externe</option>
          </select>
          <select value={filters.bloques} onChange={(event) => update('bloques', event.target.value)}>
            <option value="">Tous les statuts qualité</option>
            <option value="true">Lots bloqués uniquement</option>
          </select>
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'lot', label: 'Lot', numeric: false },
              { key: 'espece', label: 'Espèce', numeric: false },
              { key: 'calibre', label: 'Calibre', numeric: false },
              { key: 'qualite', label: 'Qualité connue', numeric: false },
              { key: 'emplacement', label: 'Emplacement', numeric: false },
              { key: 'type', label: 'Type de stock', numeric: false },
              { key: 'physique', label: 'Stock physique (kg)', numeric: true },
              { key: 'statut', label: 'Statut qualité', numeric: false },
              { key: 'dispo', label: 'Stock disponible (kg)', numeric: true },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun stock ne correspond aux filtres."
          >
            {(data ?? []).map((row) => (
              <tr key={`${row.lotId}-${row.locationCode}`}>
                <td>
                  <Link to={`/lots/${row.lotId}`}>{row.lotCode}</Link>
                </td>
                <td>{row.speciesCode}</td>
                <td>{row.sizeGrade ?? '-'}</td>
                <td>{row.qualityGrade ?? '-'}</td>
                <td>{row.locationName}</td>
                <td>
                  <Badge value={row.stockType} />
                </td>
                <td className="nombre">{formatQuantity(row.physicalQuantityKg)}</td>
                <td>
                  <Badge value={row.isBlocked ? 'BLOQUE' : 'ACTIF'} />
                </td>
                <td className="nombre">{formatQuantity(row.availableQuantityKg)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
