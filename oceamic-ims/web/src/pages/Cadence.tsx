import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildQuery } from '../api';
import { Badge, Card, DataTable, PageHeader } from '../components/ui';
import { formatDateTime, label } from '../format';
import { useResource } from '../hooks';
import { useProductionLines, useProducts } from '../masterdata';

type CadenceRow = Readonly<{
  id: string;
  controlledAt: string;
  runCode: string;
  productCode: string;
  speciesCode: string;
  lineCode: string;
  lineName: string;
  activityType: string;
  employeeNumber: string;
  employeeName: string;
  quantityCompleted: string;
  measurementUnit: string;
  measurementDurationSeconds: number;
  cadencePerHour: string;
  standardCadenceSnapshot: string | null;
  performancePercent: string | null;
  performanceStatus: string | null;
}>;

/** Reusable cadence history: filterable by date, Run, ligne or employée. */
export function Cadence() {
  const products = useProducts();
  const lines = useProductionLines();
  const [filters, setFilters] = useState({
    du: '',
    au: '',
    produit: '',
    ligne: '',
    employee: '',
  });

  const { data, error, loading } = useResource<readonly CadenceRow[]>(
    `/api/cadence${buildQuery(filters)}`,
  );

  const update = (key: keyof typeof filters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <>
      <PageHeader
        title="Cadence"
        subtitle="Historique des mesures de cadence individuelle"
        actions={null}
      />

      <Card title={null}>
        <div className="filtres">
          <input type="date" value={filters.du} onChange={(event) => update('du', event.target.value)} />
          <input type="date" value={filters.au} onChange={(event) => update('au', event.target.value)} />
          <select value={filters.produit} onChange={(event) => update('produit', event.target.value)}>
            <option value="">Tous les produits</option>
            {(products.data ?? []).map((product) => (
              <option key={product.id} value={product.id}>
                {product.code}
              </option>
            ))}
          </select>
          <select value={filters.ligne} onChange={(event) => update('ligne', event.target.value)}>
            <option value="">Toutes les lignes</option>
            {(lines.data ?? []).map((line) => (
              <option key={line.id} value={line.id}>
                {line.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Matricule"
            value={filters.employee}
            onChange={(event) => update('employee', event.target.value)}
          />
        </div>

        {error ? <div className="message erreur">{error}</div> : null}
        {loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'heure', label: 'Heure', numeric: false },
              { key: 'run', label: 'Run', numeric: false },
              { key: 'produit', label: 'Produit', numeric: false },
              { key: 'ligne', label: 'Ligne', numeric: false },
              { key: 'activite', label: 'Activité', numeric: false },
              { key: 'matricule', label: 'Matricule', numeric: false },
              { key: 'employee', label: 'Employée', numeric: false },
              { key: 'quantite', label: 'Quantité', numeric: true },
              { key: 'cadence', label: 'Cadence', numeric: true },
              { key: 'standard', label: 'Standard', numeric: true },
              { key: 'performance', label: 'Performance', numeric: false },
            ]}
            isEmpty={(data ?? []).length === 0}
            emptyText="Aucune mesure de cadence."
          >
            {(data ?? []).map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.controlledAt)}</td>
                <td>
                  <Link to={`/production`}>{row.runCode}</Link>
                </td>
                <td>{row.productCode}</td>
                <td>{row.lineCode}</td>
                <td>{label(row.activityType)}</td>
                <td>{row.employeeNumber}</td>
                <td>{row.employeeName}</td>
                <td className="nombre">
                  {row.quantityCompleted} {label(row.measurementUnit)}
                </td>
                <td className="nombre">{row.cadencePerHour} / h</td>
                <td className="nombre">
                  {row.standardCadenceSnapshot === null ? '-' : `${row.standardCadenceSnapshot} / h`}
                </td>
                <td>
                  {row.performancePercent === null ? (
                    <span className="badge">Standard non défini</span>
                  ) : (
                    <>
                      {row.performancePercent} %{' '}
                      {row.performanceStatus ? <Badge value={row.performanceStatus} /> : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
