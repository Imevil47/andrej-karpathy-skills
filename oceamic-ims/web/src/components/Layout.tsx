import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { label } from '../format';

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
      { to: '/qualite/controles', label: 'Contrôles', permission: 'quality:read' },
      { to: '/qualite/lots-bloques', label: 'Lots bloqués', permission: 'quality:read' },
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="marque">
          OCEAMIC <span>IMS</span>
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
