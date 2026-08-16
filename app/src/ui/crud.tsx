/**
 * Écran d'exploitation générique: résumé, filtres, tableau, saisie.
 *
 * Les 17 écrans partagent la même mécanique — seuls changent les champs, les
 * colonnes et les indicateurs. Mutualiser évite 17 variantes divergentes.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { store } from '../data/store';
import { appliquerFiltres, type Filtres } from '../domain/selectors';
import type { Database, TableName } from '../domain/types';
import { BarreFiltres } from './filtres';
import { Formulaire, Modale, type Champ, type ChampCalcule } from './forms';
import { Bouton, Carte, PageHeader, Tableau, type Colonne } from './primitives';
import { useDb, useFiltres } from './state';

export interface OptionsEcran<T extends { id: string }> {
  titre: string;
  sousTitre?: string;
  table: TableName;
  /** Fonction de la base: les listes de choix dépendent des référentiels. */
  champs: (db: Database) => Champ<T>[];
  calcules?: ChampCalcule<T>[];
  colonnes: (db: Database) => Colonne<T>[];
  /** Valeurs pré-remplies à la création (date du jour, heure courante...). */
  valeursParDefaut: (db: Database) => Partial<T>;
  /**
   * Dérive les champs calculables juste avant l'enregistrement, pour ne jamais
   * demander à l'utilisateur une valeur que le système sait déduire.
   */
  avantEnregistrement?: (valeurs: Partial<T>) => Partial<T>;
  /** Filtrage spécifique si les filtres génériques ne suffisent pas. */
  filtrer?: (lignes: T[], filtres: Filtres, db: Database) => T[];
  /** Bandeau d'indicateurs au-dessus du tableau. */
  resume?: (lignes: T[], db: Database) => ReactNode;
  /** Contenu additionnel sous le tableau (analyses, sous-tableaux). */
  complement?: (lignes: T[], db: Database) => ReactNode;
  libelleCreation?: string;
  /** Critères de filtre pertinents pour cet écran. */
  filtresAffiches?: (keyof Filtres)[];
}

export function EcranExploitation<T extends { id: string }>({
  titre,
  sousTitre,
  table,
  champs,
  calcules,
  colonnes,
  valeursParDefaut,
  avantEnregistrement,
  filtrer,
  resume,
  complement,
  libelleCreation = 'Nouvelle saisie',
  filtresAffiches,
}: OptionsEcran<T>) {
  const db = useDb();
  const { filtres } = useFiltres();
  const [edition, setEdition] = useState<{ ligne?: T } | null>(null);

  const lignes = useMemo(() => {
    const brutes = db[table] as unknown as T[];
    const filtrees = filtrer
      ? filtrer(brutes, filtres, db)
      : appliquerFiltres(brutes as never, filtres) as unknown as T[];
    return [...filtrees].reverse();
  }, [db, table, filtres, filtrer]);

  const enregistrer = (saisie: Partial<T>) => {
    const valeurs = avantEnregistrement ? avantEnregistrement(saisie) : saisie;
    if (edition?.ligne) {
      store.update(table, edition.ligne.id, valeurs as never);
    } else {
      store.insert(table, valeurs as never);
    }
    setEdition(null);
  };

  const supprimer = (ligne: T) => {
    if (confirm('Supprimer définitivement cet enregistrement ?')) {
      store.remove(table, ligne.id);
    }
  };

  return (
    <>
      <PageHeader
        titre={titre}
        sousTitre={sousTitre}
        actions={
          <Bouton variante="primaire" onClick={() => setEdition({})}>
            + {libelleCreation}
          </Bouton>
        }
      />

      <BarreFiltres criteres={filtresAffiches} />

      {resume && <div className="mb-4">{resume(lignes, db)}</div>}

      <Carte titre={`${lignes.length} enregistrement${lignes.length > 1 ? 's' : ''}`}>
        <Tableau
          colonnes={colonnes(db)}
          lignes={lignes}
          clef={(l) => l.id}
          messageVide="Aucun enregistrement pour les filtres actifs."
          actions={(ligne) => (
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setEdition({ ligne })}
                className="rounded px-2 py-1 text-xs font-medium text-mer-600 hover:bg-mer-500/10"
              >
                Modifier
              </button>
              <button
                type="button"
                onClick={() => supprimer(ligne)}
                className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                Supprimer
              </button>
            </div>
          )}
        />
      </Carte>

      {complement && <div className="mt-4">{complement(lignes, db)}</div>}

      {edition && (
        <Modale
          titre={edition.ligne ? `${titre} — modification` : `${titre} — ${libelleCreation}`}
          onFermer={() => setEdition(null)}
        >
          <Formulaire
            champs={champs(db)}
            calcules={calcules}
            valeursInitiales={edition.ligne ?? valeursParDefaut(db)}
            onValider={enregistrer}
            onAnnuler={() => setEdition(null)}
          />
        </Modale>
      )}
    </>
  );
}
