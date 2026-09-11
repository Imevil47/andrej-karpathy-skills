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
  runsInProgress: number;
  consumedTodayKg: string;
  runsWithDifferenceToJustify: number;
  controlRoundsToday: number;
  incompleteControlRounds: number;
  activeDowntimeCount: number;
  weightControlsToCorrect: number;
  activeSterilizationCycles: number;
  ccpToVerify: number;
  openDeviations: number;
  byLocation: readonly Readonly<{
    locationCode: string;
    locationName: string;
    stockType: string;
    quantityKg: string;
  }>[];
  fgAvailableCartons: number;
  fgBlockedFinishedGoodLots: number;
  shipmentsInPreparation: number;
  palletsToLoad: number;
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
            <div className="indicateur">
              <div className="titre">Runs en cours</div>
              <div className="valeur">{data.runsInProgress}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Matière consommée aujourd'hui</div>
              <div className="valeur">
                {formatQuantity(data.consumedTodayKg)}
                <span className="unite">kg</span>
              </div>
            </div>
            <div className="indicateur">
              <div className="titre">Écarts matière à justifier</div>
              <div className="valeur">{data.runsWithDifferenceToJustify}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Tours de contrôle aujourd'hui</div>
              <div className="valeur">{data.controlRoundsToday}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Contrôles incomplets</div>
              <div className="valeur">{data.incompleteControlRounds}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Arrêts en cours</div>
              <div className="valeur">{data.activeDowntimeCount}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Contrôles poids à corriger</div>
              <div className="valeur">{data.weightControlsToCorrect}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Cycles de stérilisation en cours</div>
              <div className="valeur">{data.activeSterilizationCycles}</div>
            </div>
            <div className="indicateur">
              <div className="titre">CCP à vérifier</div>
              <div className="valeur">{data.ccpToVerify}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Déviations ouvertes</div>
              <div className="valeur">{data.openDeviations}</div>
            </div>
            <div className="indicateur accent">
              <div className="titre">Stock PF disponible (cartons)</div>
              <div className="valeur">{data.fgAvailableCartons}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Lots PF bloqués</div>
              <div className="valeur">{data.fgBlockedFinishedGoodLots}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Expéditions en préparation</div>
              <div className="valeur">{data.shipmentsInPreparation}</div>
            </div>
            <div className="indicateur">
              <div className="titre">Palettes à charger</div>
              <div className="valeur">{data.palletsToLoad}</div>
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
              <Link to="/production/nouveau">
                <button type="button" className="secondaire">
                  Nouveau Run
                </button>
              </Link>
              <Link to="/production/controles">
                <button type="button" className="secondaire">
                  Contrôles horaires
                </button>
              </Link>
              <Link to="/production/sterilisation">
                <button type="button" className="secondaire">
                  Stérilisation
                </button>
              </Link>
              <Link to="/qualite/deviations">
                <button type="button" className="secondaire">
                  Déviations
                </button>
              </Link>
              <Link to="/emballage/nouveau">
                <button type="button" className="secondaire">
                  Nouveau Lot PF
                </button>
              </Link>
              <Link to="/expeditions/nouvelle">
                <button type="button" className="secondaire">
                  Nouvelle expédition
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
