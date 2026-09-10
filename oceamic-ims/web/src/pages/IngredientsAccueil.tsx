import { Link } from 'react-router-dom';
import { Card, PageHeader } from '../components/ui';
import { useResource } from '../hooks';

type IngredientHomeSummary = Readonly<{
  oilStockLiters: number;
  blockedLots: number;
  recoveredOilAvailable: number;
  recoveredOilExpiringSoon: number;
  runsWithUnexplainedDifference: number;
}>;

/** Section 48: "Ingrédients — Vue d'ensemble", operational counts only - no
 * decorative analytics, mirrors MaintenanceAccueil.tsx/QualiteAccueil.tsx. */
export function IngredientsAccueil() {
  const { data, error, loading } = useResource<IngredientHomeSummary>('/api/ingredients/home-summary');

  return (
    <>
      <PageHeader title="Ingrédients — Vue d'ensemble" subtitle="Stock, cuves, consommation et huile récupérée" actions={null} />
      {loading ? <p>Chargement...</p> : null}
      {error ? <div className="message erreur">{error}</div> : null}
      {data === null ? null : (
        <>
          <div className="grille-cartes">
            <Link to="/ingredients/stock" className="indicateur accent" style={{ display: 'block' }}>
              <div className="titre">Stock huile (L)</div>
              <div className="valeur">{data.oilStockLiters}</div>
            </Link>
            <Link to="/ingredients/lots" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Lots bloqués</div>
              <div className="valeur">{data.blockedLots}</div>
            </Link>
            <Link to="/ingredients/recuperation" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Huile récupérée disponible</div>
              <div className="valeur">{data.recoveredOilAvailable}</div>
            </Link>
            <Link to="/ingredients/recuperation" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Huile récupérée expirant bientôt</div>
              <div className="valeur">{data.recoveredOilExpiringSoon}</div>
            </Link>
            <Link to="/production" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Écarts ingrédient à justifier</div>
              <div className="valeur">{data.runsWithUnexplainedDifference}</div>
            </Link>
          </div>

          <Card title="Accès rapides">
            <div className="ligne-boutons" style={{ marginTop: 0 }}>
              <Link to="/ingredients/stock">
                <button type="button" className="secondaire">
                  Stocks
                </button>
              </Link>
              <Link to="/ingredients/lots">
                <button type="button" className="secondaire">
                  Lots
                </button>
              </Link>
              <Link to="/ingredients/cuves">
                <button type="button" className="secondaire">
                  Cuves
                </button>
              </Link>
              <Link to="/ingredients/recuperation">
                <button type="button" className="secondaire">
                  Récupération
                </button>
              </Link>
            </div>
          </Card>

          <Card title="Actions rapides">
            <div className="ligne-boutons" style={{ marginTop: 0 }}>
              <Link to="/ingredients/lots#creation">
                <button type="button">Réceptionner un lot</button>
              </Link>
              <Link to="/ingredients/cuves#creation">
                <button type="button">Créer une cuve</button>
              </Link>
              <Link to="/ingredients/recuperation#creation">
                <button type="button">Enregistrer une récupération</button>
              </Link>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
