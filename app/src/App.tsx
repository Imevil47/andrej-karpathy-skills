import { HashRouter, Route, Routes } from 'react-router-dom';
import { PageArrets } from './pages/Arrets';
import { PageChambre, PageSortieMatiere } from './pages/Chambre';
import {
  PageEmballage,
  PageMarquage,
  PageRemplissage,
  PageSertissage,
  PageSterilisation,
} from './pages/Conditionnement';
import { PageDashboard } from './pages/Dashboard';
import { PageGrattage } from './pages/Grattage';
import { PageParametres } from './pages/Parametres';
import { PageCuisson, PageFilet, PageTraitement } from './pages/Production';
import { PageRapports } from './pages/Rapports';
import { PageReception } from './pages/Reception';
import { PageStock } from './pages/Stock';
import { PageTracabilite } from './pages/Tracabilite';
import { Layout } from './ui/Layout';
import { FournisseurFiltres } from './ui/state';

export default function App() {
  return (
    <FournisseurFiltres>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<PageDashboard />} />
            <Route path="/tracabilite" element={<PageTracabilite />} />
            <Route path="/rapports" element={<PageRapports />} />
            <Route path="/reception" element={<PageReception />} />
            <Route path="/chambre" element={<PageChambre />} />
            <Route path="/sortie-matiere" element={<PageSortieMatiere />} />
            <Route path="/stock" element={<PageStock />} />
            <Route path="/traitement" element={<PageTraitement />} />
            <Route path="/filet" element={<PageFilet />} />
            <Route path="/cuisson" element={<PageCuisson />} />
            <Route path="/grattage" element={<PageGrattage />} />
            <Route path="/remplissage" element={<PageRemplissage />} />
            <Route path="/sertissage" element={<PageSertissage />} />
            <Route path="/marquage" element={<PageMarquage />} />
            <Route path="/sterilisation" element={<PageSterilisation />} />
            <Route path="/emballage" element={<PageEmballage />} />
            <Route path="/arrets" element={<PageArrets />} />
            <Route path="/parametres" element={<PageParametres />} />
          </Route>
        </Routes>
      </HashRouter>
    </FournisseurFiltres>
  );
}
