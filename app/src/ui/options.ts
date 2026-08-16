/** Listes de choix et libellés dérivés des référentiels. */

import type { Option } from './forms';
import type { Database, ID, Zone } from '../domain/types';

export const optionsLots = (db: Database): Option[] =>
  db.lots.map((l) => ({ value: l.id, label: `${l.code} — ${l.espece}` }));

export const optionsProduits = (db: Database): Option[] =>
  db.products.map((p) => ({ value: p.id, label: p.nom }));

export const optionsLignes = (db: Database, zone: Zone): Option[] =>
  db.lines.filter((l) => l.zone === zone && l.active).map((l) => ({ value: l.id, label: l.nom }));

export const optionsMachines = (db: Database, zone: Zone): Option[] =>
  db.machines.filter((m) => m.zone === zone && m.actif).map((m) => ({ value: m.id, label: m.nom }));

export const optionsEmployes = (db: Database): Option[] =>
  db.employees
    .filter((e) => e.actif)
    .map((e) => ({ value: e.id, label: `${e.matricule} — ${e.nom}` }));

export const optionsEnum = <T extends string>(valeurs: readonly T[]): Option[] =>
  valeurs.map((v) => ({ value: v, label: v }));

/** Libellés: renvoient un tiret plutôt qu'une chaîne vide pour rester lisibles. */
export const libelleLot = (db: Database, id?: ID) =>
  db.lots.find((l) => l.id === id)?.code ?? '—';

export const libelleProduit = (db: Database, id?: ID) =>
  db.products.find((p) => p.id === id)?.nom ?? '—';

export const libelleLigne = (db: Database, id?: ID) =>
  db.lines.find((l) => l.id === id)?.nom ?? '—';

export const libelleMachine = (db: Database, id?: ID) =>
  db.machines.find((m) => m.id === id)?.nom ?? '—';

export const libelleEmploye = (db: Database, id?: ID) =>
  db.employees.find((e) => e.id === id)?.nom ?? '—';

/** "2026-08-16T14:35" → "14:35". */
export const heure = (iso?: string) => (iso ? iso.slice(11, 16) : '—');

/** Date du jour au format ISO court. */
export const dateDuJour = () => new Date().toISOString().slice(0, 10);

/** Horodatage courant compatible <input type="datetime-local">. */
export const maintenant = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
