/** Coquille applicative: navigation, en-tête, alerte cohérence. */

import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { controlerCoherence } from '../domain/coherence';
import { useDb } from './state';

interface Entree {
  chemin: string;
  libelle: string;
  icone: string;
}

const GROUPES: { titre: string; entrees: Entree[] }[] = [
  {
    titre: 'Pilotage',
    entrees: [
      { chemin: '/', libelle: 'Dashboard', icone: '▦' },
      { chemin: '/tracabilite', libelle: 'Traçabilité', icone: '⇄' },
      { chemin: '/rapports', libelle: 'Rapports', icone: '▤' },
    ],
  },
  {
    titre: 'Matière',
    entrees: [
      { chemin: '/reception', libelle: 'Réception', icone: '⛟' },
      { chemin: '/chambre', libelle: 'Chambre positive', icone: '❄' },
      { chemin: '/sortie-matiere', libelle: 'Sortie matière', icone: '↥' },
      { chemin: '/stock', libelle: 'Stock', icone: '▣' },
    ],
  },
  {
    titre: 'Production',
    entrees: [
      { chemin: '/traitement', libelle: 'Zone Traitement', icone: '✂' },
      { chemin: '/filet', libelle: 'Machines Filet', icone: '⚙' },
      { chemin: '/cuisson', libelle: 'Cuisson', icone: '♨' },
      { chemin: '/grattage', libelle: 'Zone Grattage', icone: '✥' },
      { chemin: '/remplissage', libelle: 'Remplissage', icone: '◍' },
      { chemin: '/sertissage', libelle: 'Sertissage', icone: '◎' },
      { chemin: '/marquage', libelle: 'Marquage', icone: '⌗' },
      { chemin: '/sterilisation', libelle: 'Stérilisation', icone: '⧗' },
      { chemin: '/emballage', libelle: 'Emballage', icone: '▢' },
    ],
  },
  {
    titre: 'Suivi',
    entrees: [
      { chemin: '/arrets', libelle: 'Arrêts', icone: '⏸' },
      { chemin: '/parametres', libelle: 'Paramètres', icone: '⚒' },
    ],
  },
];

export function Layout() {
  const db = useDb();
  const location = useLocation();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const anomalies = controlerCoherence(db);
  const critiques = anomalies.filter((a) => a.severite === 'critique').length;

  const titreCourant =
    GROUPES.flatMap((g) => g.entrees).find((e) => e.chemin === location.pathname)?.libelle ??
    'Gestion d’exploitation';

  const navigation = (
    <nav className="space-y-5">
      {GROUPES.map((groupe) => (
        <div key={groupe.titre}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ardoise-400">
            {groupe.titre}
          </p>
          <ul className="space-y-0.5">
            {groupe.entrees.map((entree) => (
              <li key={entree.chemin}>
                <NavLink
                  to={entree.chemin}
                  onClick={() => setMenuOuvert(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? 'bg-mer-600 font-medium text-white'
                        : 'text-ardoise-200 hover:bg-ardoise-800'
                    }`
                  }
                >
                  <span className="w-4 text-center opacity-70">{entree.icone}</span>
                  {entree.libelle}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Navigation latérale — écrans larges */}
      <aside className="hidden w-60 shrink-0 flex-col bg-ardoise-900 p-3 lg:flex sans-impression">
        <EnTeteMarque />
        {navigation}
      </aside>

      {/* Barre supérieure — mobile et tablette */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-ardoise-900 px-4 py-3 lg:hidden sans-impression">
        <button
          type="button"
          onClick={() => setMenuOuvert(!menuOuvert)}
          className="rounded-lg px-2 py-1 text-2xl leading-none text-white"
          aria-label="Menu"
        >
          ☰
        </button>
        <span className="text-sm font-semibold text-white">{titreCourant}</span>
        {critiques > 0 ? (
          <span className="rounded-md bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">
            {critiques}
          </span>
        ) : (
          <span className="w-6" />
        )}
      </header>

      {menuOuvert && (
        <div className="fixed inset-0 z-40 lg:hidden sans-impression">
          <button
            type="button"
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-ardoise-950/50"
            onClick={() => setMenuOuvert(false)}
          />
          <div className="relative h-full w-72 overflow-y-auto bg-ardoise-900 p-3">
            <EnTeteMarque />
            {navigation}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
        {critiques > 0 && location.pathname !== '/rapports' && (
          <NavLink
            to="/rapports"
            className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 sans-impression"
          >
            <span className="font-semibold">{critiques} anomalie{critiques > 1 ? 's' : ''} de cohérence</span>
            <span className="text-rose-600">— voir le détail dans Rapports →</span>
          </NavLink>
        )}
        <Outlet />
      </main>
    </div>
  );
}

function EnTeteMarque() {
  return (
    <div className="mb-5 px-3 pt-2">
      <p className="text-sm font-semibold leading-tight text-white">
        Gestion d’Exploitation
      </p>
      <p className="text-xs text-ardoise-400">Usine de conserves</p>
    </div>
  );
}
