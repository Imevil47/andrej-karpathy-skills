import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { useResource } from '../hooks';

type PalletRow = Readonly<{
  id: string;
  palletCode: string;
  status: string;
  qualityStatus: string;
  locationCode: string | null;
  quantityCartons: number;
  quantityUnits: number;
  isReserved: boolean;
  lotCodes: readonly string[];
}>;

export function Palettes() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error, loading } = useResource<readonly PalletRow[]>(
    `/api/pallets${buildQuery({ recherche: applied })}`,
  );

  return (
    <>
      <PageHeader title="Palettes" subtitle="Unités logistiques de stock PF" actions={null} />

      <Card title={null}>
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search);
          }}
        >
          <input
            placeholder="Code palette"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
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
              { key: 'palette', label: 'Palette', numeric: false },
              { key: 'lots', label: 'Lots PF', numeric: false },
              { key: 'statut', label: 'Statut', numeric: false },
              { key: 'qualite', label: 'Statut qualité', numeric: false },
              { key: 'emplacement', label: 'Emplacement', numeric: false },
              { key: 'reservee', label: 'Réservée', numeric: false },
              { key: 'cartons', label: 'Cartons', numeric: true },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune palette ne correspond aux filtres."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/palettes/${row.id}`}>
                    <strong>{row.palletCode}</strong>
                  </Link>
                </td>
                <td>{row.lotCodes.join(', ') || '-'}</td>
                <td>
                  <Badge value={row.status} />
                </td>
                <td>
                  <Badge value={row.qualityStatus} />
                </td>
                <td>{row.locationCode ?? '-'}</td>
                <td>{row.isReserved ? 'Oui' : 'Non'}</td>
                <td className="nombre">{row.quantityCartons}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
