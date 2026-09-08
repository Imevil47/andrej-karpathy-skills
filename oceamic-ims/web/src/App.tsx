import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Accueil } from './pages/Accueil';
import { Arrets } from './pages/Arrets';
import { Cadence } from './pages/Cadence';
import { CCP } from './pages/CCP';
import { Connexion } from './pages/Connexion';
import { ControlePoidsDetail } from './pages/ControlePoidsDetail';
import { ControlesPoids } from './pages/ControlesPoids';
import { ControleRound } from './pages/ControleRound';
import { ControlesHoraires } from './pages/ControlesHoraires';
import { ControleSertissageDetail } from './pages/ControleSertissageDetail';
import { ControlesSertissage } from './pages/ControlesSertissage';
import { DeviationDetail } from './pages/DeviationDetail';
import { Deviations } from './pages/Deviations';
import { LotSituation } from './pages/LotSituation';
import { Lots } from './pages/Lots';
import { Parametres } from './pages/Parametres';
import { ProductionRunNouveau } from './pages/ProductionRunNouveau';
import { ProductionRunSituation } from './pages/ProductionRunSituation';
import { ProductionRuns } from './pages/ProductionRuns';
import { QualiteControles } from './pages/QualiteControles';
import { QualiteLotsBloques } from './pages/QualiteLotsBloques';
import { ReceptionNouvelle } from './pages/ReceptionNouvelle';
import { Receptions } from './pages/Receptions';
import { Remplissage } from './pages/Remplissage';
import { Sertissage } from './pages/Sertissage';
import { SousTraitance } from './pages/SousTraitance';
import { SousTraitanceDetail } from './pages/SousTraitanceDetail';
import { SousTraitanceNouvelle } from './pages/SousTraitanceNouvelle';
import { Sterilisation } from './pages/Sterilisation';
import { SterilisationCycle } from './pages/SterilisationCycle';
import { SterilisationNouveau } from './pages/SterilisationNouveau';
import { StockMouvements } from './pages/StockMouvements';
import { StockSituation } from './pages/StockSituation';
import { StockTransfert } from './pages/StockTransfert';
import { Tracabilite } from './pages/Tracabilite';

export function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return <div className="page-connexion">Chargement...</div>;
  }
  if (session === null) {
    return <Connexion />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Accueil />} />
          <Route path="/receptions" element={<Receptions />} />
          <Route path="/receptions/nouvelle" element={<ReceptionNouvelle />} />
          <Route path="/stock" element={<StockSituation />} />
          <Route path="/stock/mouvements" element={<StockMouvements />} />
          <Route path="/stock/transfert" element={<StockTransfert />} />
          <Route path="/lots" element={<Lots />} />
          <Route path="/lots/:id" element={<LotSituation />} />
          <Route path="/production" element={<ProductionRuns />} />
          <Route path="/production/nouveau" element={<ProductionRunNouveau />} />
          <Route path="/production/controles" element={<ControlesHoraires />} />
          <Route path="/production/controles/:id" element={<ControleRound />} />
          <Route path="/production/cadence" element={<Cadence />} />
          <Route path="/production/arrets" element={<Arrets />} />
          <Route path="/production/remplissage" element={<Remplissage />} />
          <Route path="/production/sertissage" element={<Sertissage />} />
          <Route path="/production/sterilisation" element={<Sterilisation />} />
          <Route path="/production/sterilisation/nouveau" element={<SterilisationNouveau />} />
          <Route path="/production/sterilisation/:id" element={<SterilisationCycle />} />
          <Route path="/production/:id" element={<ProductionRunSituation />} />
          <Route path="/sous-traitance" element={<SousTraitance />} />
          <Route path="/sous-traitance/nouvelle" element={<SousTraitanceNouvelle />} />
          <Route path="/sous-traitance/:id" element={<SousTraitanceDetail />} />
          <Route path="/qualite/controles" element={<QualiteControles />} />
          <Route path="/qualite/controles-poids" element={<ControlesPoids />} />
          <Route path="/qualite/controles-poids/:id" element={<ControlePoidsDetail />} />
          <Route path="/qualite/controles-sertissage" element={<ControlesSertissage />} />
          <Route path="/qualite/controles-sertissage/:id" element={<ControleSertissageDetail />} />
          <Route path="/qualite/ccp" element={<CCP />} />
          <Route path="/qualite/lots-bloques" element={<QualiteLotsBloques />} />
          <Route path="/qualite/deviations" element={<Deviations />} />
          <Route path="/qualite/deviations/:id" element={<DeviationDetail />} />
          <Route path="/tracabilite" element={<Tracabilite />} />
          <Route path="/parametres" element={<Parametres />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
