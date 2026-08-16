/**
 * Formulaires déclaratifs.
 *
 * Les écrans décrivent leurs champs; le rendu, la saisie et la conversion de
 * types sont mutualisés. Un champ `calcule` affiche un résultat dérivé et n'est
 * jamais saisissable (règle de la section 23).
 */

import { useState, type ReactNode } from 'react';
import { Bouton } from './primitives';

export interface Option {
  value: string;
  label: string;
}

export interface Champ<T> {
  nom: keyof T & string;
  label: string;
  type: 'texte' | 'nombre' | 'date' | 'datetime' | 'select' | 'zone-texte';
  options?: Option[];
  requis?: boolean;
  pas?: number;
  suffixe?: string;
  aide?: string;
  /** Occupe toute la largeur du formulaire. */
  large?: boolean;
}

/** Valeur affichée, calculée à partir de la saisie en cours. */
export interface ChampCalcule<T> {
  label: string;
  valeur: (brouillon: Partial<T>) => string;
  aide?: string;
}

function Etiquette({ children, aide }: { children: ReactNode; aide?: string }) {
  return (
    <span className="mb-1 block text-xs font-medium text-ardoise-600">
      {children}
      {aide && <span className="ml-1 font-normal text-ardoise-400">— {aide}</span>}
    </span>
  );
}

const CLASSE_SAISIE =
  'w-full min-h-11 rounded-lg border border-ardoise-300 bg-white px-3 text-sm text-ardoise-900 outline-none focus:border-mer-500 focus:ring-2 focus:ring-mer-500/20';

export function Formulaire<T extends object>({
  champs,
  calcules = [],
  valeursInitiales,
  onValider,
  onAnnuler,
  libelleValider = 'Enregistrer',
}: {
  champs: Champ<T>[];
  calcules?: ChampCalcule<T>[];
  valeursInitiales: Partial<T>;
  onValider: (valeurs: Partial<T>) => void;
  onAnnuler: () => void;
  libelleValider?: string;
}) {
  const [brouillon, setBrouillon] = useState<Partial<T>>(valeursInitiales);

  const modifier = (nom: string, valeur: unknown) =>
    setBrouillon((b) => ({ ...b, [nom]: valeur }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onValider(brouillon);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {champs.map((champ) => {
          const valeur = brouillon[champ.nom];
          const commun = {
            id: champ.nom,
            required: champ.requis,
            className: CLASSE_SAISIE,
          };
          return (
            <label
              key={champ.nom}
              htmlFor={champ.nom}
              className={champ.large ? 'sm:col-span-2 lg:col-span-3' : ''}
            >
              <Etiquette aide={champ.aide}>
                {champ.label}
                {champ.suffixe ? ` (${champ.suffixe})` : ''}
              </Etiquette>

              {champ.type === 'select' ? (
                <select
                  {...commun}
                  value={(valeur as string) ?? ''}
                  onChange={(e) => modifier(champ.nom, e.target.value || undefined)}
                >
                  <option value="">—</option>
                  {champ.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : champ.type === 'zone-texte' ? (
                <textarea
                  {...commun}
                  rows={2}
                  className={`${CLASSE_SAISIE} py-2`}
                  value={(valeur as string) ?? ''}
                  onChange={(e) => modifier(champ.nom, e.target.value)}
                />
              ) : (
                <input
                  {...commun}
                  type={
                    champ.type === 'nombre'
                      ? 'number'
                      : champ.type === 'date'
                        ? 'date'
                        : champ.type === 'datetime'
                          ? 'datetime-local'
                          : 'text'
                  }
                  step={champ.type === 'nombre' ? (champ.pas ?? 'any') : undefined}
                  value={(valeur as string | number | undefined) ?? ''}
                  onChange={(e) =>
                    modifier(
                      champ.nom,
                      champ.type === 'nombre'
                        ? e.target.value === ''
                          ? undefined
                          : Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              )}
            </label>
          );
        })}
      </div>

      {calcules.length > 0 && (
        <div className="rounded-lg border border-dashed border-ardoise-300 bg-ardoise-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ardoise-500">
            Calculé automatiquement
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {calcules.map((c) => (
              <div key={c.label}>
                <p className="text-xs text-ardoise-500">{c.label}</p>
                <p className="text-sm font-semibold tabulaire text-ardoise-800">
                  {c.valeur(brouillon)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-ardoise-100 pt-3">
        <Bouton onClick={onAnnuler}>Annuler</Bouton>
        <Bouton type="submit" variante="primaire">
          {libelleValider}
        </Bouton>
      </div>
    </form>
  );
}

/** Panneau modal (plein écran sur mobile). */
export function Modale({
  titre,
  onFermer,
  children,
}: {
  titre: string;
  onFermer: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ardoise-950/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-ardoise-100 bg-white px-4 py-3">
          <h2 className="text-base font-semibold text-ardoise-900">{titre}</h2>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="rounded-lg px-2 py-1 text-xl leading-none text-ardoise-400 hover:bg-ardoise-100"
          >
            ×
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
