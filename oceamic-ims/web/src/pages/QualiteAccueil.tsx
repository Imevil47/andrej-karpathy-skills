import { Link } from 'react-router-dom';
import { Card, PageHeader } from '../components/ui';
import { useResource } from '../hooks';

type QmsHomeSummary = Readonly<{
  openNonconformities: number;
  overdueCapa: number;
  blockedLots: number;
  openComplaints: number;
  upcomingAudits: number;
  overdueActions: number;
}>;

/** Section 37: "Qualité — Vue d'ensemble", five/six focused counts, no
 * decorative charts. */
export function QualiteAccueil() {
  const { data, error, loading } = useResource<QmsHomeSummary>('/api/qms/home-summary');

  return (
    <>
      <PageHeader title="Qualité — Vue d'ensemble" subtitle="Situation du système qualité" actions={null} />
      {loading ? <p>Chargement...</p> : null}
      {error ? <div className="message erreur">{error}</div> : null}
      {data === null ? null : (
        <>
          <div className="grille-cartes">
            <Link to="/qualite/non-conformites" className="indicateur accent" style={{ display: 'block' }}>
              <div className="titre">Non-conformités ouvertes</div>
              <div className="valeur">{data.openNonconformities}</div>
            </Link>
            <Link to="/qualite/capa" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">CAPA en retard</div>
              <div className="valeur">{data.overdueCapa}</div>
            </Link>
            <Link to="/qualite/lots-bloques" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Lots bloqués</div>
              <div className="valeur">{data.blockedLots}</div>
            </Link>
            <Link to="/qualite/reclamations" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Réclamations ouvertes</div>
              <div className="valeur">{data.openComplaints}</div>
            </Link>
            <Link to="/qualite/audits" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Audits à venir (14 j)</div>
              <div className="valeur">{data.upcomingAudits}</div>
            </Link>
            <Link to="/qualite/capa" className="indicateur" style={{ display: 'block' }}>
              <div className="titre">Actions en retard</div>
              <div className="valeur">{data.overdueActions}</div>
            </Link>
          </div>

          <Card title="Accès rapides">
            <div className="ligne-boutons" style={{ marginTop: 0 }}>
              <Link to="/qualite/non-conformites">
                <button type="button">Non-conformités</button>
              </Link>
              <Link to="/qualite/capa">
                <button type="button" className="secondaire">
                  CAPA
                </button>
              </Link>
              <Link to="/qualite/audits">
                <button type="button" className="secondaire">
                  Audits
                </button>
              </Link>
              <Link to="/qualite/reclamations">
                <button type="button" className="secondaire">
                  Réclamations
                </button>
              </Link>
              <Link to="/qualite/documents">
                <button type="button" className="secondaire">
                  Documents
                </button>
              </Link>
              <Link to="/qualite/retraits">
                <button type="button" className="secondaire">
                  Retraits / rappels
                </button>
              </Link>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
