import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Accueil } from './pages/Accueil';
import { Connexion } from './pages/Connexion';
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
import { SousTraitance } from './pages/SousTraitance';
import { SousTraitanceDetail } from './pages/SousTraitanceDetail';
import { SousTraitanceNouvelle } from './pages/SousTraitanceNouvelle';
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
          <Route path="/production/:id" element={<ProductionRunSituation />} />
          <Route path="/sous-traitance" element={<SousTraitance />} />
          <Route path="/sous-traitance/nouvelle" element={<SousTraitanceNouvelle />} />
          <Route path="/sous-traitance/:id" element={<SousTraitanceDetail />} />
          <Route path="/qualite/controles" element={<QualiteControles />} />
          <Route path="/qualite/lots-bloques" element={<QualiteLotsBloques />} />
          <Route path="/tracabilite" element={<Tracabilite />} />
          <Route path="/parametres" element={<Parametres />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
