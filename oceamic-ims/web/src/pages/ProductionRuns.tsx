import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDate, formatDateTime, formatQuantity } from '../format';
import { useResource } from '../hooks';
import { useProducts, useSpecies } from '../masterdata';

type RunRow = Readonly<{
  id: string;
  runCode: string;
  productionDate: string;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  speciesCode: string;
  productCode: string;
  inputKg: string;
  usefulKg: string;
  differenceKg: string;
  balanceStatus: string;
  yieldPercent: string | null;
}>;

export function ProductionRuns() {
  const { can } = useAuth();
  const species = useSpecies();
  const products = useProducts();
  const [filters, setFilters] = useState({ du: '', au: '', espece: '', produit: '', statut: '' });

  const { data, error, loading } = useResource<readonly RunRow[]>(
    `/api/production/runs${buildQuery(filters)}`,
  );

  const update = (key: keyof typeof filters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <>
      <PageHeader
        title="Runs de production"
        subtitle="Ordres de production, entrée matière et rendement"
        actions={
          can('production:run') ? (
            <Link to="/production/nouveau">
              <button type="button">Nouveau Run</button>
            </Link>
          ) : null
        }
      />

      <Card title={null}>
        <div className="filtres">
          <input
            type="date"
            value={filters.du}
            onChange={(event) => update('du', event.target.value)}
          />
          <input
            type="date"
            value={filters.au}
            onChange={(event) => update('au', event.target.value)}
          />
          <select value={filters.espece} onChange={(event) => update('espece', event.target.value)}>
            <option value="">Toutes les espèces</option>
            {(species.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select value={filters.produit} onChange={(event) => update('produit', event.target.value)}>
            <option value="">Tous les produits</option>
            {(products.data ?? []).map((product) => (
              <option key={product.id} value={product.id}>
                {product.code}
              </option>
            ))}
          </select>
          <select value={filters.statut} onChange={(event) => update('statut', event.target.value)}>
            <option value="">Tous les statuts</option>
            <option value="PLANIFIE">Planifié</option>
            <option value="EN_COURS">En cours</option>
            <option value="SUSPENDU">Suspendu</option>
            <option value="TERMINE">Terminé</option>
            <option value="ANNULE">Annulé</option>
          </select>
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'run', label: 'Run', numeric: false },
              { key: 'date', label: 'Date', numeric: false },
              { key: 'espece', label: 'Espèce', numeric: false },
              { key: 'produit', label: 'Produit', numeric: false },
              { key: 'debut', label: 'Début', numeric: false },
              { key: 'fin', label: 'Fin', numeric: false },
              { key: 'entree', label: 'Entrée MP (kg)', numeric: true },
              { key: 'sortie', label: 'Sortie utile (kg)', numeric: true },
              { key: 'rendement', label: 'Rendement', numeric: true },
              { key: 'ecart', label: 'Écart (kg)', numeric: true },
              { key: 'statut', label: 'Statut', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucun ordre de production."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/production/${row.id}`}>
                    <strong>{row.runCode}</strong>
                  </Link>
                </td>
                <td>{formatDate(row.productionDate)}</td>
                <td>{row.speciesCode}</td>
                <td>{row.productCode}</td>
                <td>{formatDateTime(row.startedAt)}</td>
                <td>{formatDateTime(row.endedAt)}</td>
                <td className="nombre">{formatQuantity(row.inputKg)}</td>
                <td className="nombre">{formatQuantity(row.usefulKg)}</td>
                <td className="nombre">
                  {row.yieldPercent === null ? '-' : `${row.yieldPercent} %`}
                </td>
                <td className="nombre">
                  {formatQuantity(row.differenceKg)}{' '}
                  {row.balanceStatus === 'ECART_A_JUSTIFIER' ? <Badge value="ECART_A_JUSTIFIER" /> : null}
                </td>
                <td>
                  <Badge value={row.status} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
