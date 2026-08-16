/** Accès à la base et filtres partagés entre tous les écrans. */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { store } from '../data/store';
import type { Filtres } from '../domain/selectors';
import type { Database } from '../domain/types';

export function useDb(): Database {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

interface ContexteFiltres {
  filtres: Filtres;
  setFiltres: (f: Filtres) => void;
  reinitialiser: () => void;
}

const FiltresContext = createContext<ContexteFiltres | null>(null);

export function FournisseurFiltres({ children }: { children: ReactNode }) {
  const [filtres, setFiltres] = useState<Filtres>({});
  const valeur = useMemo(
    () => ({ filtres, setFiltres, reinitialiser: () => setFiltres({}) }),
    [filtres],
  );
  return <FiltresContext.Provider value={valeur}>{children}</FiltresContext.Provider>;
}

export function useFiltres(): ContexteFiltres {
  const contexte = useContext(FiltresContext);
  if (!contexte) throw new Error('useFiltres doit être utilisé dans <FournisseurFiltres>');
  return contexte;
}

/** Nombre de critères actifs — affiché sur le bouton Filtres. */
export function nbFiltresActifs(f: Filtres): number {
  return Object.values(f).filter(Boolean).length;
}
