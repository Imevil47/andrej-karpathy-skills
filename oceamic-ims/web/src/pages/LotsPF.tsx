import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDate } from '../format';
import { useResource } from '../hooks';

type FinishedGoodLotRow = Readonly<{
  id: string;
  lotCode: string;
  runCode: string;
  productCode: string;
  productName: string;
  format: string | null;
  productionDate: string;
  qualityStatus: string;
  physicalCartons: number;
  availableCartons: number;
}>;

export function LotsPF() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error, loading } = useResource<readonly FinishedGoodLotRow[]>(
    `/api/finished-good-lots${buildQuery({ recherche: applied })}`,
  );

  return (
    <>
      <PageHeader
        title="Lots PF"
        subtitle="Lots de produits finis"
        actions={
          can('packaging:manage') ? (
            <Link to="/emballage/nouveau">
              <button type="button">Nouveau Lot PF</button>
            </Link>
          ) : null
        }
      />

      <Card title={null}>
        <form
          className="filtres"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search);
          }}
        >
          <input
            placeholder="Code Lot PF"
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
              { key: 'lot', label: 'Lot PF', numeric: false },
              { key: 'run', label: 'Run source', numeric: false },
              { key: 'produit', label: 'Produit', numeric: false },
              { key: 'format', label: 'Format', numeric: false },
              { key: 'date', label: 'Date de production', numeric: false },
              { key: 'statut', label: 'Statut qualité', numeric: false },
              { key: 'physique', label: 'Cartons physiques', numeric: true },
              { key: 'dispo', label: 'Cartons disponibles', numeric: true },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun Lot PF ne correspond aux filtres."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/emballage/lots-pf/${row.id}`}>
                    <strong>{row.lotCode}</strong>
                  </Link>
                </td>
                <td>{row.runCode}</td>
                <td>
                  {row.productCode} — {row.productName}
                </td>
                <td>{row.format ?? '-'}</td>
                <td>{formatDate(row.productionDate)}</td>
                <td>
                  <Badge value={row.qualityStatus} />
                </td>
                <td className="nombre">{row.physicalCartons}</td>
                <td className="nombre">{row.availableCartons}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
