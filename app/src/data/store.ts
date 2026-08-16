/**
 * Couche de persistance.
 *
 * Le stockage est local (localStorage) mais toute l'application passe par ce
 * module: remplacer `read`/`write` par des appels HTTP suffit à basculer sur
 * une base serveur sans toucher aux écrans.
 */

import { EMPTY_DB, type Database, type TableName } from '../domain/types';
import { seedDatabase } from './seed';

const STORAGE_KEY = 'usine-conserves.db.v1';

let cache: Database | null = null;
const listeners = new Set<() => void>();

function read(): Database {
  if (cache) return cache;
  try {
    const brut = localStorage.getItem(STORAGE_KEY);
    if (brut) {
      // Fusion avec EMPTY_DB: une table ajoutée par une version ultérieure
      // ne casse pas une base existante.
      cache = { ...EMPTY_DB, ...(JSON.parse(brut) as Partial<Database>) };
      return cache;
    }
  } catch {
    // Base illisible: on repart d'une base de démonstration plutôt que de
    // laisser l'application dans un état inutilisable.
  }
  cache = seedDatabase();
  write(cache);
  return cache;
}

function write(db: Database): void {
  cache = db;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  listeners.forEach((l) => l());
}

export const store = {
  getSnapshot(): Database {
    return read();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Ajoute une ligne dans une table et renvoie l'enregistrement créé. */
  insert<T extends TableName>(
    table: T,
    row: Omit<Database[T][number], 'id'> & { id?: string },
  ): Database[T][number] {
    const db = read();
    const enregistrement = { ...row, id: row.id ?? crypto.randomUUID() } as Database[T][number];
    write({ ...db, [table]: [...db[table], enregistrement] as Database[T] });
    return enregistrement;
  },

  update<T extends TableName>(
    table: T,
    id: string,
    patch: Partial<Database[T][number]>,
  ): void {
    const db = read();
    const lignes = (db[table] as { id: string }[]).map((l) =>
      l.id === id ? { ...l, ...patch } : l,
    );
    write({ ...db, [table]: lignes as Database[T] });
  },

  remove<T extends TableName>(table: T, id: string): void {
    const db = read();
    const lignes = (db[table] as { id: string }[]).filter((l) => l.id !== id);
    write({ ...db, [table]: lignes as Database[T] });
  },

  /** Remplace intégralement la base (import de sauvegarde). */
  replace(db: Database): void {
    write({ ...EMPTY_DB, ...db });
  },

  /** Réinitialise avec le jeu de démonstration. */
  reset(): void {
    write(seedDatabase());
  },

  /** Vide toutes les données opérationnelles, garde les référentiels. */
  clearOperations(): void {
    const db = read();
    write({
      ...EMPTY_DB,
      products: db.products,
      lines: db.lines,
      machines: db.machines,
      employees: db.employees,
      recipes: db.recipes,
    });
  },
};
