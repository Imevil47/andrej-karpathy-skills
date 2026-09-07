import { Link } from 'react-router-dom';
import { Card, DataTable, PageHeader } from '../components/ui';
import { formatQuantity, label } from '../format';
import { useResource } from '../hooks';

type HomeSummary = Readonly<{
  internalStockKg: string;
  externalStockKg: string;
  totalStockKg: string;
  blockedLots: number;
  receptionsToday: number;
  subcontractingInProgress: number;
  byLocation: readonly Readonly<{
    locationCode: string;
    locationName: string;
    stockType: string;
    quantityKg: string;
  }>[];
}>;

export function Accueil() {
  const { data, error, loading } = useResource<HomeSummary>('/api/home/summary');

  return (
    <>
      <PageHeader title="Accueil" subtitle="Situation opérationnelle du jour" actions={null} />
      {loading ? <p>Chargement...</p> : null}
      {error ? <div className="message erreur">{error}</div> : null}
      {data === null ? null : (
        <>
          <div className="grille-cartes">
            <div className="indicateur accent">
              <div className="titre">Stock interne</div>
              <div className="valeur">
                {formatQuantity(data.internalStockKg)}
                <span className="unite">kg</span>
              </div>
            </div>
            <div className="indicateur">
              <div className="titre">Stock externe</div>
              <div className="valeur">
                {formatQuantity(data.externalStockKg)}
                <span className="unite">kg</span>
              </div>
            </div>
            <div className="indicateur">
              <div className="titre">Lots bloqués</div>
              <div className="valeur">{data.blockedLots}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Réceptions aujourd'hui</div>
              <div className="valeur">{data.receptionsToday}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Sous-traitances en cours</div>
              <div className="valeur">{data.subcontractingInProgress}</div>
            </div>
          </div>

          <Card title="Stock par emplacement">
            <DataTable
              columns={[
                { key: 'emplacement', label: 'Emplacement', numeric: false },
                { key: 'type', label: 'Type de stock', numeric: false },
                { key: 'quantite', label: 'Stock physique (kg)', numeric: true },
              ]}
              isEmpty={data.byLocation.length === 0}
              emptyText="Aucun stock enregistré."
            >
              {data.byLocation.map((row) => (
                <tr key={row.locationCode}>
                  <td>
                    <strong>{row.locationName}</strong>
                  </td>
                  <td>{label(row.stockType)}</td>
                  <td className="nombre">{formatQuantity(row.quantityKg)}</td>
                </tr>
              ))}
            </DataTable>
          </Card>

          <Card title="Accès rapides">
            <div className="ligne-boutons" style={{ marginTop: 0 }}>
              <Link to="/receptions/nouvelle">
                <button type="button">Nouvelle réception</button>
              </Link>
              <Link to="/stock/transfert">
                <button type="button" className="secondaire">
                  Transfert de stock
                </button>
              </Link>
              <Link to="/tracabilite">
                <button type="button" className="secondaire">
                  Rechercher un lot
                </button>
              </Link>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
