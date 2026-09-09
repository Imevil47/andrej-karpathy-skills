import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Accueil } from './pages/Accueil';
import { Arrets } from './pages/Arrets';
import { AuditDetail } from './pages/AuditDetail';
import { Audits } from './pages/Audits';
import { Cadence } from './pages/Cadence';
import { Capa } from './pages/Capa';
import { CapaDetail } from './pages/CapaDetail';
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
import { DocumentDetail } from './pages/DocumentDetail';
import { Documents } from './pages/Documents';
import { EmballageNouveau } from './pages/EmballageNouveau';
import { EquipementDetail } from './pages/EquipementDetail';
import { Equipements } from './pages/Equipements';
import { ExpeditionDetail } from './pages/ExpeditionDetail';
import { ExpeditionNouvelle } from './pages/ExpeditionNouvelle';
import { Expeditions } from './pages/Expeditions';
import { IncidentsFournisseurs } from './pages/IncidentsFournisseurs';
import { LotPFSituation } from './pages/LotPFSituation';
import { LotSituation } from './pages/LotSituation';
import { Lots } from './pages/Lots';
import { LotsPF } from './pages/LotsPF';
import { MaintenanceAccueil } from './pages/MaintenanceAccueil';
import { NonConformiteDetail } from './pages/NonConformiteDetail';
import { NonConformites } from './pages/NonConformites';
import { OrdreDeTravailDetail } from './pages/OrdreDeTravailDetail';
import { OrdresDeTravail } from './pages/OrdresDeTravail';
import { PaletteNouvelle } from './pages/PaletteNouvelle';
import { PaletteSituation } from './pages/PaletteSituation';
import { Palettes } from './pages/Palettes';
import { Pannes } from './pages/Pannes';
import { Parametres } from './pages/Parametres';
import { PiecesDeRechange } from './pages/PiecesDeRechange';
import { Preventif } from './pages/Preventif';
import { ProductionRunNouveau } from './pages/ProductionRunNouveau';
import { ProductionRunSituation } from './pages/ProductionRunSituation';
import { ProductionRuns } from './pages/ProductionRuns';
import { QualiteAccueil } from './pages/QualiteAccueil';
import { QualiteControles } from './pages/QualiteControles';
import { QualiteLotsBloques } from './pages/QualiteLotsBloques';
import { Reclamations } from './pages/Reclamations';
import { ReclamationDetail } from './pages/ReclamationDetail';
import { ReceptionNouvelle } from './pages/ReceptionNouvelle';
import { Receptions } from './pages/Receptions';
import { Remplissage } from './pages/Remplissage';
import { RetraitDetail } from './pages/RetraitDetail';
import { Retraits } from './pages/Retraits';
import { Sertissage } from './pages/Sertissage';
import { SousTraitance } from './pages/SousTraitance';
import { SousTraitanceDetail } from './pages/SousTraitanceDetail';
import { SousTraitanceNouvelle } from './pages/SousTraitanceNouvelle';
import { Sterilisation } from './pages/Sterilisation';
import { SterilisationCycle } from './pages/SterilisationCycle';
import { SterilisationNouveau } from './pages/SterilisationNouveau';
import { StockMouvements } from './pages/StockMouvements';
import { StockPF } from './pages/StockPF';
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
          <Route path="/emballage/nouveau" element={<EmballageNouveau />} />
          <Route path="/emballage/lots-pf" element={<LotsPF />} />
          <Route path="/emballage/lots-pf/:id" element={<LotPFSituation />} />
          <Route path="/palettes" element={<Palettes />} />
          <Route path="/palettes/nouvelle" element={<PaletteNouvelle />} />
          <Route path="/palettes/:id" element={<PaletteSituation />} />
          <Route path="/stock-pf" element={<StockPF />} />
          <Route path="/expeditions" element={<Expeditions />} />
          <Route path="/expeditions/nouvelle" element={<ExpeditionNouvelle />} />
          <Route path="/expeditions/:id" element={<ExpeditionDetail />} />
          <Route path="/qualite/accueil" element={<QualiteAccueil />} />
          <Route path="/qualite/non-conformites" element={<NonConformites />} />
          <Route path="/qualite/non-conformites/:id" element={<NonConformiteDetail />} />
          <Route path="/qualite/capa" element={<Capa />} />
          <Route path="/qualite/capa/:id" element={<CapaDetail />} />
          <Route path="/qualite/audits" element={<Audits />} />
          <Route path="/qualite/audits/:id" element={<AuditDetail />} />
          <Route path="/qualite/documents" element={<Documents />} />
          <Route path="/qualite/documents/:id" element={<DocumentDetail />} />
          <Route path="/qualite/reclamations" element={<Reclamations />} />
          <Route path="/qualite/reclamations/:id" element={<ReclamationDetail />} />
          <Route path="/qualite/incidents-fournisseurs" element={<IncidentsFournisseurs />} />
          <Route path="/qualite/retraits" element={<Retraits />} />
          <Route path="/qualite/retraits/:id" element={<RetraitDetail />} />
          <Route path="/maintenance/accueil" element={<MaintenanceAccueil />} />
          <Route path="/maintenance/equipements" element={<Equipements />} />
          <Route path="/maintenance/equipements/:id" element={<EquipementDetail />} />
          <Route path="/maintenance/pannes" element={<Pannes />} />
          <Route path="/maintenance/ordres-de-travail" element={<OrdresDeTravail />} />
          <Route path="/maintenance/ordres-de-travail/:id" element={<OrdreDeTravailDetail />} />
          <Route path="/maintenance/preventif" element={<Preventif />} />
          <Route path="/maintenance/pieces" element={<PiecesDeRechange />} />
          <Route path="/parametres" element={<Parametres />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
