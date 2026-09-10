import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import oceamicMark from '../assets/oceamic-mark.png';
import { useAuth } from '../auth';
import { label } from '../format';

// React Router does not scroll to a URL's #hash on client-side navigation
// the way a full page load does - this restores that behavior so a link
// like "#creation" (the "Actions rapides" shortcuts) actually lands on the
// creation form, not just the top of the list.
function useScrollToHash(): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '') {
      return;
    }
    const target = document.getElementById(hash.slice(1));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);
}

type NavigationEntry = Readonly<{ to: string; label: string; permission: string | null }>;

type NavigationGroup = Readonly<{ title: string | null; entries: readonly NavigationEntry[] }>;

// Navigation stays deliberately small in Phase 1, and every entry is hidden
// when the role does not carry the matching permission.
const NAVIGATION: readonly NavigationGroup[] = [
  {
    title: null,
    entries: [
      { to: '/', label: 'Accueil', permission: null },
      { to: '/receptions', label: 'Réceptions', permission: 'stock:read' },
    ],
  },
  {
    title: 'Stock',
    entries: [
      { to: '/stock', label: 'Situation du stock', permission: 'stock:read' },
      { to: '/stock/mouvements', label: 'Mouvements', permission: 'stock:read' },
      { to: '/stock/transfert', label: 'Transfert', permission: 'stock:transfer' },
    ],
  },
  {
    title: null,
    entries: [{ to: '/lots', label: 'Lots MP', permission: 'stock:read' }],
  },
  {
    title: 'Production',
    entries: [
      { to: '/production', label: 'Runs de production', permission: 'production:read' },
      { to: '/production/nouveau', label: 'Nouveau Run', permission: 'production:run' },
      { to: '/production/controles', label: 'Contrôles horaires', permission: 'production:read' },
      { to: '/production/cadence', label: 'Cadence', permission: 'production:read' },
      { to: '/production/arrets', label: 'Arrêts', permission: 'production:read' },
      { to: '/production/remplissage', label: 'Remplissage', permission: 'production:read' },
      { to: '/production/sertissage', label: 'Sertissage', permission: 'production:read' },
      { to: '/production/sterilisation', label: 'Stérilisation', permission: 'production:read' },
    ],
  },
  {
    title: 'Ingrédients',
    entries: [
      { to: '/ingredients/accueil', label: "Vue d'ensemble", permission: 'ingredient:read' },
      { to: '/ingredients/stock', label: 'Stocks', permission: 'ingredient:read' },
      { to: '/ingredients/lots', label: 'Lots', permission: 'ingredient:read' },
      { to: '/ingredients/cuves', label: 'Cuves', permission: 'ingredient:read' },
      { to: '/ingredients/recuperation', label: 'Récupération', permission: 'ingredient:read' },
    ],
  },
  {
    title: null,
    entries: [
      { to: '/sous-traitance', label: 'Sous-traitance', permission: 'subcontracting:read' },
    ],
  },
  {
    title: 'Qualité',
    entries: [
      { to: '/qualite/accueil', label: "Vue d'ensemble", permission: 'qms:read' },
      { to: '/qualite/controles', label: 'Contrôles', permission: 'quality:read' },
      { to: '/qualite/controles-poids', label: 'Contrôles poids', permission: 'production:read' },
      { to: '/qualite/controles-sertissage', label: 'Contrôles sertissage', permission: 'production:read' },
      { to: '/qualite/ccp', label: 'CCP', permission: 'production:read' },
      { to: '/qualite/lots-bloques', label: 'Lots bloqués', permission: 'quality:read' },
      { to: '/qualite/deviations', label: 'Déviations', permission: 'production:read' },
      { to: '/qualite/non-conformites', label: 'Non-conformités', permission: 'qms:read' },
      { to: '/qualite/capa', label: 'CAPA', permission: 'qms:read' },
      { to: '/qualite/reclamations', label: 'Réclamations', permission: 'qms:read' },
      { to: '/qualite/incidents-fournisseurs', label: 'Incidents fournisseur', permission: 'qms:read' },
      { to: '/qualite/audits', label: 'Audits', permission: 'qms:read' },
      { to: '/qualite/documents', label: 'Documents', permission: 'qms:read' },
      { to: '/qualite/retraits', label: 'Retraits / Rappels', permission: 'qms:read' },
    ],
  },
  {
    title: 'Emballage',
    entries: [
      { to: '/emballage/lots-pf', label: 'Lots PF', permission: 'production:read' },
      { to: '/palettes', label: 'Palettes', permission: 'stock:read' },
    ],
  },
  {
    title: 'Stock PF',
    entries: [{ to: '/stock-pf', label: 'Situation du stock', permission: 'stock:read' }],
  },
  {
    title: 'Expéditions',
    entries: [{ to: '/expeditions', label: 'Expéditions', permission: 'stock:read' }],
  },
  {
    title: 'Maintenance',
    entries: [
      { to: '/maintenance/accueil', label: "Vue d'ensemble", permission: 'maintenance:read' },
      { to: '/maintenance/equipements', label: 'Équipements', permission: 'maintenance:read' },
      { to: '/maintenance/pannes', label: 'Pannes', permission: 'maintenance:read' },
      { to: '/maintenance/ordres-de-travail', label: 'Ordres de travail', permission: 'maintenance:read' },
      { to: '/maintenance/preventif', label: 'Préventif', permission: 'maintenance:read' },
      { to: '/maintenance/pieces', label: 'Pièces de rechange', permission: 'maintenance:read' },
    ],
  },
  {
    title: null,
    entries: [
      { to: '/tracabilite', label: 'Traçabilité', permission: 'traceability:read' },
      { to: '/parametres', label: 'Paramètres', permission: 'masterdata:write' },
    ],
  },
];

export function Layout() {
  const { session, signOut, can } = useAuth();
  useScrollToHash();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="marque">
          <img src={oceamicMark} alt="OCEAMIC" className="marque-logo" />
          <div className="marque-texte">
            <span className="marque-nom">OCEAMIC</span>
            <span className="marque-site">Laayoune II · IMS</span>
          </div>
        </div>
        <nav>
          {NAVIGATION.map((group, index) => {
            const visible = group.entries.filter(
              (entry) => entry.permission === null || can(entry.permission),
            );
            if (visible.length === 0) {
              return null;
            }
            return (
              <div key={group.title ?? `groupe-${index}`}>
                {group.title === null ? null : <div className="groupe">{group.title}</div>}
                {visible.map((entry) => (
                  <NavLink
                    key={entry.to}
                    to={entry.to}
                    end={entry.to === '/'}
                    className={({ isActive }) => (isActive ? 'actif' : '')}
                  >
                    {entry.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="pied">
          <div>
            <strong>{session?.user.fullName}</strong>
          </div>
          <div>{label(session?.user.role ?? null)}</div>
          <button className="lien" type="button" onClick={signOut} style={{ marginTop: 8 }}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="contenu">
        <Outlet />
      </main>
    </div>
  );
}
