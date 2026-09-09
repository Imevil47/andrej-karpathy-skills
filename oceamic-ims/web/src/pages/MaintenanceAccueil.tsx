import { Link } from 'react-router-dom';
import { Card, PageHeader } from '../components/ui';
import { useResource } from '../hooks';

type MaintenanceHomeSummary = Readonly<{
  openFailures: number;
  equipmentDown: number;
  workOrdersInProgress: number;
  preventiveOverdue: number;
  interventionsToday: number;
  partsBelowMinimum: number;
}>;

/** Section 48: "Maintenance — Vue d'ensemble", operational counts only, no
 * decorative analytics - mirrors QualiteAccueil.tsx. */
export function MaintenanceAccueil() {
  const { data, error, loading } = useResource<MaintenanceHomeSummary>('/api/maintenance/home-summary');

  return (
    <>
      <PageHeader title="Maintenance — Vue d'ensemble" subtitle="Équipements, pannes et interventions" actions={null} />
      {loading ? <p>Chargement...</p> : null}
      {error ? <div className="message erreur">{error}</div> : null}
      {data === null ? null : (
        <>
          <div className="grille-cartes">
            <Link to="/maintenance/pannes" className="indicateur accent" style={{ display: 'block' }}>
              <div className="titre">Pannes ouvertes</div>
              <div className="valeur">{data.openFailures}</div>
            </Link>
            <Link to="/maintenance/equipements" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Équipements en panne</div>
              <div className="valeur">{data.equipmentDown}</div>
            </Link>
            <Link to="/maintenance/ordres-de-travail" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">OT en cours</div>
              <div className="valeur">{data.workOrdersInProgress}</div>
            </Link>
            <Link to="/maintenance/preventif" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Préventifs en retard</div>
              <div className="valeur">{data.preventiveOverdue}</div>
            </Link>
            <Link to="/maintenance/ordres-de-travail" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Interventions aujourd'hui</div>
              <div className="valeur">{data.interventionsToday}</div>
            </Link>
            <Link to="/maintenance/pieces" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Pièces sous minimum</div>
              <div className="valeur">{data.partsBelowMinimum}</div>
            </Link>
          </div>

          <Card title="Accès rapides">
            <div className="ligne-boutons" style={{ marginTop: 0 }}>
              <Link to="/maintenance/equipements">
                <button type="button" className="secondaire">
                  Équipements
                </button>
              </Link>
              <Link to="/maintenance/pannes">
                <button type="button" className="secondaire">
                  Pannes
                </button>
              </Link>
              <Link to="/maintenance/ordres-de-travail">
                <button type="button" className="secondaire">
                  Ordres de travail
                </button>
              </Link>
              <Link to="/maintenance/preventif">
                <button type="button" className="secondaire">
                  Préventif
                </button>
              </Link>
              <Link to="/maintenance/pieces">
                <button type="button" className="secondaire">
                  Pièces de rechange
                </button>
              </Link>
            </div>
          </Card>

          <Card title="Actions rapides">
            <div className="ligne-boutons" style={{ marginTop: 0 }}>
              <Link to="/maintenance/pannes#creation">
                <button type="button">Déclarer une panne</button>
              </Link>
              <Link to="/maintenance/ordres-de-travail#creation">
                <button type="button">Créer un ordre de travail</button>
              </Link>
              <Link to="/maintenance/preventif#creation">
                <button type="button">Planifier un préventif</button>
              </Link>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
