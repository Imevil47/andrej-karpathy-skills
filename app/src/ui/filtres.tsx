/** Barre de filtres commune à tous les écrans (section 21). */

import type { Filtres } from '../domain/selectors';
import { DESTINATIONS, EQUIPES, ZONES } from '../domain/types';
import { Bouton } from './primitives';
import { nbFiltresActifs, useDb, useFiltres } from './state';
import { useState } from 'react';

const TOUS_CRITERES: (keyof Filtres)[] = [
  'dateDebut',
  'dateFin',
  'equipe',
  'lotId',
  'productId',
  'espece',
  'lineId',
  'machineId',
  'zone',
  'operateurId',
  'destination',
];

export function BarreFiltres({ criteres = TOUS_CRITERES }: { criteres?: (keyof Filtres)[] }) {
  const db = useDb();
  const { filtres, setFiltres, reinitialiser } = useFiltres();
  const [ouvert, setOuvert] = useState(false);
  const actifs = nbFiltresActifs(filtres);

  const modifier = (clef: keyof Filtres, valeur: string) =>
    setFiltres({ ...filtres, [clef]: valeur || undefined });

  const especes = [...new Set(db.lots.map((l) => l.espece))].sort();

  const champ = (clef: keyof Filtres): { label: string; contenu: React.ReactNode } | null => {
    const classe =
      'w-full min-h-10 rounded-lg border border-ardoise-300 bg-white px-2.5 text-sm outline-none focus:border-mer-500';
    const select = (options: { value: string; label: string }[], label: string) => ({
      label,
      contenu: (
        <select
          className={classe}
          value={(filtres[clef] as string) ?? ''}
          onChange={(e) => modifier(clef, e.target.value)}
        >
          <option value="">Tous</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ),
    });

    switch (clef) {
      case 'dateDebut':
      case 'dateFin':
        return {
          label: clef === 'dateDebut' ? 'Du' : 'Au',
          contenu: (
            <input
              type="date"
              className={classe}
              value={(filtres[clef] as string) ?? ''}
              onChange={(e) => modifier(clef, e.target.value)}
            />
          ),
        };
      case 'equipe':
        return select(EQUIPES.map((e) => ({ value: e, label: e })), 'Équipe');
      case 'lotId':
        return select(db.lots.map((l) => ({ value: l.id, label: l.code })), 'Lot');
      case 'productId':
        return select(db.products.map((p) => ({ value: p.id, label: p.nom })), 'Produit');
      case 'espece':
        return select(especes.map((e) => ({ value: e, label: e })), 'Espèce');
      case 'lineId':
        return select(db.lines.map((l) => ({ value: l.id, label: l.nom })), 'Ligne');
      case 'machineId':
        return select(db.machines.map((m) => ({ value: m.id, label: m.nom })), 'Machine');
      case 'zone':
        return select(ZONES.map((z) => ({ value: z, label: z })), 'Zone');
      case 'operateurId':
        return select(
          db.employees.map((e) => ({ value: e.id, label: `${e.matricule} — ${e.nom}` })),
          'Opérateur',
        );
      case 'destination':
        return select(DESTINATIONS.map((d) => ({ value: d, label: d })), 'Destination');
      default:
        return null;
    }
  };

  return (
    <div className="mb-4 sans-impression">
      <div className="flex flex-wrap items-center gap-2">
        <Bouton onClick={() => setOuvert(!ouvert)}>
          Filtres{actifs > 0 ? ` (${actifs})` : ''} {ouvert ? '▲' : '▼'}
        </Bouton>
        {actifs > 0 && (
          <button
            type="button"
            onClick={reinitialiser}
            className="text-sm text-mer-600 underline underline-offset-2"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {ouvert && (
        <div className="mt-2 grid grid-cols-2 gap-3 rounded-xl border border-ardoise-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-5">
          {criteres.map((clef) => {
            const c = champ(clef);
            if (!c) return null;
            return (
              <label key={clef} className="block">
                <span className="mb-1 block text-xs font-medium text-ardoise-600">{c.label}</span>
                {c.contenu}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
