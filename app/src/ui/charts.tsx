/**
 * Graphiques d'exploitation.
 *
 * Une seule série par graphique: la comparaison porte sur des grandeurs
 * (production, temps perdu), pas sur des identités — une teinte unique suffit
 * et aucune légende n'est nécessaire, le titre nomme la série. Les valeurs sont
 * étiquetées directement, les axes restent discrets.
 */

import { fmtInt } from '../domain/calculations';
import { Vide } from './primitives';

export interface Serie {
  nom: string;
  valeur: number;
}

export type TeinteGraphe = 'mer' | 'alerte';

const TEINTES: Record<TeinteGraphe, { barre: string }> = {
  mer: { barre: 'bg-mer-600' },
  alerte: { barre: 'bg-rose-500' },
};

/** Barres horizontales — comparaison de grandeurs entre catégories nommées. */
export function BarresHorizontales({
  donnees,
  unite = '',
  teinte = 'mer',
  formater = fmtInt,
  messageVide = 'Aucune donnée.',
}: {
  donnees: Serie[];
  unite?: string;
  teinte?: TeinteGraphe;
  formater?: (v: number) => string;
  messageVide?: string;
}) {
  if (donnees.length === 0) return <Vide message={messageVide} />;
  const max = Math.max(...donnees.map((d) => d.valeur), 1);
  const styles = TEINTES[teinte];

  return (
    <ul className="space-y-2.5">
      {donnees.map((d) => (
        <li key={d.nom} title={`${d.nom}: ${formater(d.valeur)} ${unite}`.trim()}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ardoise-700">{d.nom}</span>
            <span className="shrink-0 font-medium tabulaire text-ardoise-900">
              {formater(d.valeur)}
              {unite && <span className="ml-0.5 text-xs text-ardoise-400">{unite}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-ardoise-100">
            <div
              className={`h-full rounded ${styles.barre} transition-[width]`}
              style={{ width: `${(d.valeur / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Colonnes — évolution d'une grandeur au fil des heures de production. */
export function Colonnes({
  donnees,
  unite = '',
  teinte = 'mer',
  messageVide = 'Aucune donnée.',
}: {
  donnees: Serie[];
  unite?: string;
  teinte?: TeinteGraphe;
  messageVide?: string;
}) {
  if (donnees.length === 0) return <Vide message={messageVide} />;
  const max = Math.max(...donnees.map((d) => d.valeur), 1);
  const styles = TEINTES[teinte];

  return (
    <div className="flex gap-1.5">
      {donnees.map((d) => (
        <div
          key={d.nom}
          className="group flex min-w-0 max-w-24 flex-1 flex-col items-center gap-1"
          title={`${d.nom}: ${fmtInt(d.valeur)} ${unite}`.trim()}
        >
          <span className="text-[11px] font-medium tabulaire text-ardoise-600 opacity-0 transition group-hover:opacity-100">
            {fmtInt(d.valeur)}
          </span>
          {/* Piste de hauteur fixe: la barre s'y proportionne au maximum de la série. */}
          <div className="flex h-40 w-full items-end">
            <div
              className={`w-full rounded-t ${styles.barre} transition-[height]`}
              style={{ height: `${Math.max((d.valeur / max) * 100, 1)}%` }}
            />
          </div>
          <span className="w-full truncate text-center text-[11px] text-ardoise-400">
            {d.nom}
          </span>
        </div>
      ))}
    </div>
  );
}
