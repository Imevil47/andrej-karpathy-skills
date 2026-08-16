/** Briques d'interface partagées par tous les écrans. */

import type { ReactNode } from 'react';

export function PageHeader({
  titre,
  sousTitre,
  actions,
}: {
  titre: string;
  sousTitre?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ardoise-900">{titre}</h1>
        {sousTitre && <p className="mt-1 max-w-3xl text-sm text-ardoise-500">{sousTitre}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 sans-impression">{actions}</div>}
    </div>
  );
}

export function Carte({
  titre,
  actions,
  children,
  className = '',
}: {
  titre?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-ardoise-200 bg-white shadow-sm ${className}`}
    >
      {(titre || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ardoise-100 px-4 py-3">
          {titre && <h2 className="text-sm font-semibold text-ardoise-700">{titre}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export type TonKpi = 'neutre' | 'bon' | 'alerte' | 'critique';

const TONS: Record<TonKpi, string> = {
  neutre: 'text-ardoise-900',
  bon: 'text-emerald-700',
  alerte: 'text-amber-700',
  critique: 'text-rose-700',
};

export function Kpi({
  libelle,
  valeur,
  unite,
  detail,
  ton = 'neutre',
}: {
  libelle: string;
  valeur: string;
  unite?: string;
  detail?: string;
  ton?: TonKpi;
}) {
  return (
    <div className="rounded-xl border border-ardoise-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ardoise-500">{libelle}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabulaire ${TONS[ton]}`}>
        {valeur}
        {unite && <span className="ml-1 text-sm font-normal text-ardoise-400">{unite}</span>}
      </p>
      {detail && <p className="mt-1 text-xs text-ardoise-500">{detail}</p>}
    </div>
  );
}

export function Bouton({
  children,
  onClick,
  variante = 'secondaire',
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variante?: 'primaire' | 'secondaire' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const styles = {
    primaire: 'bg-mer-600 text-white hover:bg-mer-700 disabled:bg-ardoise-300',
    secondaire:
      'bg-white text-ardoise-700 border border-ardoise-300 hover:bg-ardoise-50 disabled:text-ardoise-300',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  }[variante];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition ${styles}`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  ton = 'neutre',
}: {
  children: ReactNode;
  ton?: TonKpi | 'info';
}) {
  const styles = {
    neutre: 'bg-ardoise-100 text-ardoise-700',
    info: 'bg-sky-100 text-sky-800',
    bon: 'bg-emerald-100 text-emerald-800',
    alerte: 'bg-amber-100 text-amber-800',
    critique: 'bg-rose-100 text-rose-800',
  }[ton];
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  );
}

export function Vide({ message }: { message: string }) {
  return (
    <p className="px-2 py-8 text-center text-sm text-ardoise-400">{message}</p>
  );
}

/* ------------------------------------------------------------------ */
/* Tableau responsive                                                  */
/* ------------------------------------------------------------------ */

export interface Colonne<T> {
  cle: string;
  entete: string;
  rendu: (ligne: T) => ReactNode;
  numerique?: boolean;
  /** Masquée sur mobile pour garder le tableau lisible. */
  secondaire?: boolean;
}

export function Tableau<T>({
  colonnes,
  lignes,
  clef,
  messageVide = 'Aucune donnée.',
  actions,
}: {
  colonnes: Colonne<T>[];
  lignes: T[];
  clef: (ligne: T) => string;
  messageVide?: string;
  actions?: (ligne: T) => ReactNode;
}) {
  if (lignes.length === 0) return <Vide message={messageVide} />;

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-ardoise-200 text-left">
            {colonnes.map((c) => (
              <th
                key={c.cle}
                className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ardoise-500 ${
                  c.numerique ? 'text-right' : ''
                } ${c.secondaire ? 'hidden lg:table-cell' : ''}`}
              >
                {c.entete}
              </th>
            ))}
            {actions && <th className="px-3 py-2 sans-impression" />}
          </tr>
        </thead>
        <tbody>
          {lignes.map((ligne) => (
            <tr
              key={clef(ligne)}
              className="border-b border-ardoise-100 last:border-0 hover:bg-ardoise-50/60"
            >
              {colonnes.map((c) => (
                <td
                  key={c.cle}
                  className={`px-3 py-2.5 align-middle ${
                    c.numerique ? 'text-right tabulaire' : ''
                  } ${c.secondaire ? 'hidden lg:table-cell' : ''}`}
                >
                  {c.rendu(ligne)}
                </td>
              ))}
              {actions && (
                <td className="px-3 py-2.5 text-right sans-impression">{actions(ligne)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
