import { Card, DataTable, PageHeader } from '../components/ui';
import { useResource } from '../hooks';

type FgStockSummary = Readonly<{
  totalCartons: number;
  availableCartons: number;
  blockedCartons: number;
  reservedCartons: number;
}>;

type FgStockByLocationRow = Readonly<{
  locationId: string;
  locationCode: string;
  productCode: string;
  quantityCartons: number;
  quantityUnits: number;
}>;

/** Stock PF: summary cards (section 37) plus the table by location/product. */
export function StockPF() {
  const summary = useResource<FgStockSummary>('/api/fg-stock/summary');
  const byLocation = useResource<readonly FgStockByLocationRow[]>('/api/fg-stock/by-location');

  return (
    <>
      <PageHeader title="Stock PF" subtitle="Stock physique, disponible, bloqué et réservé" actions={null} />

      {summary.error ? <div className="message erreur">{summary.error}</div> : null}
      {summary.data === null ? null : (
        <div className="grille-cartes">
          <div className="indicateur accent">
            <div className="titre">Stock total (cartons)</div>
            <div className="valeur">{summary.data.totalCartons}</div>
          </div>
          <div className="indicateur">
            <div className="titre">Stock disponible</div>
            <div className="valeur">{summary.data.availableCartons}</div>
          </div>
          <div className="indicateur">
            <div className="titre">Stock bloqué</div>
            <div className="valeur">{summary.data.blockedCartons}</div>
          </div>
          <div className="indicateur">
            <div className="titre">Stock réservé</div>
            <div className="valeur">{summary.data.reservedCartons}</div>
          </div>
        </div>
      )}

      <Card title="Stock par emplacement et produit">
        {byLocation.error ? <div className="message erreur">{byLocation.error}</div> : null}
        {byLocation.loading ? (
          <p>Chargement...</p>
        ) : (
          <DataTable
            columns={[
              { key: 'emplacement', label: 'Emplacement', numeric: false },
              { key: 'produit', label: 'Produit', numeric: false },
              { key: 'cartons', label: 'Cartons', numeric: true },
              { key: 'unites', label: 'Unités', numeric: true },
            ]}
            isEmpty={(byLocation.data ?? []).length === 0}
            emptyText="Aucun stock PF enregistré."
          >
            {(byLocation.data ?? []).map((row) => (
              <tr key={`${row.locationId}-${row.productCode}`}>
                <td>{row.locationCode}</td>
                <td>{row.productCode}</td>
                <td className="nombre">{row.quantityCartons}</td>
                <td className="nombre">{row.quantityUnits}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
