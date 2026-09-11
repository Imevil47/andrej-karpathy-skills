import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDate, formatQuantity } from '../format';
import { useResource } from '../hooks';
import { useSpecies } from '../masterdata';

type LotRow = Readonly<{
  id: string;
  lotCode: string;
  speciesCode: string;
  supplierName: string | null;
  vesselName: string | null;
  status: string;
  initialReceptionDate: string | null;
  parentLotCode: string | null;
  stockKg: string;
  isBlocked: boolean;
}>;

export function Lots() {
  const species = useSpecies();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [speciesId, setSpeciesId] = useState('');
  const { data, error, loading } = useResource<readonly LotRow[]>(
    `/api/lots${buildQuery({ recherche: applied, espece: speciesId })}`,
  );

  return (
    <>
      <PageHeader title="Lots matière première" subtitle="Identité des lots" actions={null} />

      <Card title={null}>
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search);
          }}
        >
          <input
            placeholder="Code lot"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={speciesId} onChange={(event) => setSpeciesId(event.target.value)}>
            <option value="">Toutes les espèces</option>
            {(species.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button type="submit" className="secondaire">
            Rechercher
          </button>
        </form>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'lot', label: 'Lot', numeric: false },
              { key: 'espece', label: 'Espèce', numeric: false },
              { key: 'fournisseur', label: 'Fournisseur', numeric: false },
              { key: 'bateau', label: 'Bateau', numeric: false },
              { key: 'parent', label: 'Lot parent', numeric: false },
              { key: 'reception', label: 'Première réception', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'stock', label: 'Stock (kg)', numeric: true },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun lot ne correspond aux filtres."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/lots/${row.id}`}>
                    <strong>{row.lotCode}</strong>
                  </Link>
                </td>
                <td>{row.speciesCode}</td>
                <td>{row.supplierName ?? '-'}</td>
                <td>{row.vesselName ?? '-'}</td>
                <td>{row.parentLotCode ?? '-'}</td>
                <td>{formatDate(row.initialReceptionDate)}</td>
                <td>
                  <Badge value={row.status} />
                </td>
                <td className="nombre">{formatQuantity(row.stockKg)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
