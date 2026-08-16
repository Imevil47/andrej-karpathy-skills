/**
 * Contrôles de cohérence (section 18).
 *
 * Le moteur parcourt la base et remonte toutes les incohérences détectables
 * automatiquement. Il ne modifie rien: il signale.
 */

import { dureeMinutes } from './calculations';
import type { Database, ID, Zone } from './types';

export type Severite = 'critique' | 'avertissement';

export interface Anomalie {
  id: string;
  severite: Severite;
  /** Règle violée, telle que nommée dans le cahier des charges. */
  regle: string;
  message: string;
  zone?: Zone;
  lotCode?: string;
  /** Écart chiffré quand la règle en produit un. */
  ecart?: number;
}

/** Somme d'une propriété numérique sur une collection. */
function somme<T>(rows: T[], get: (row: T) => number | undefined): number {
  return rows.reduce((total, row) => total + (get(row) ?? 0), 0);
}

export function controlerCoherence(db: Database): Anomalie[] {
  const anomalies: Anomalie[] = [];
  const codeLot = new Map(db.lots.map((l) => [l.id, l.code]));
  const nomLigne = new Map(db.lines.map((l) => [l.id, l.nom]));
  const nomMachine = new Map(db.machines.map((m) => [m.id, m.nom]));

  const pousser = (a: Omit<Anomalie, 'id'>) =>
    anomalies.push({ ...a, id: `${a.regle}-${anomalies.length}` });

  /* --- Sortie > Entrée / Perte négative ------------------------------ */

  const fluxMatiere: {
    zone: Zone;
    ressource: string;
    lotId: ID;
    entree: number;
    sortie: number;
    pertes: number;
  }[] = [
    ...db.treatmentOperations.map((o) => ({
      zone: 'Traitement' as Zone,
      ressource: nomLigne.get(o.lineId) ?? 'Ligne',
      lotId: o.lotId,
      entree: o.quantiteEntree,
      sortie: o.quantiteSortie,
      pertes: o.pertes,
    })),
    ...db.filetOperations.map((o) => ({
      zone: 'Filet' as Zone,
      ressource: nomMachine.get(o.machineId) ?? 'Machine',
      lotId: o.lotId,
      entree: o.quantiteEntree,
      sortie: o.quantiteSortie,
      pertes: o.pertes,
    })),
    ...db.cuissonOperations.map((o) => ({
      zone: 'Cuisson' as Zone,
      ressource: nomMachine.get(o.machineId ?? '') ?? 'Cuisson',
      lotId: o.lotId,
      entree: o.quantiteEntree,
      sortie: o.quantiteSortie,
      pertes: o.pertes,
    })),
  ];

  for (const flux of fluxMatiere) {
    if (flux.sortie > flux.entree) {
      pousser({
        severite: 'critique',
        regle: 'Sortie > Entrée',
        zone: flux.zone,
        lotCode: codeLot.get(flux.lotId),
        ecart: flux.sortie - flux.entree,
        message: `${flux.ressource}: sortie ${flux.sortie} kg supérieure à l'entrée ${flux.entree} kg.`,
      });
    }
    if (flux.pertes < 0) {
      pousser({
        severite: 'critique',
        regle: 'Perte négative',
        zone: flux.zone,
        lotCode: codeLot.get(flux.lotId),
        ecart: flux.pertes,
        message: `${flux.ressource}: perte déclarée négative (${flux.pertes} kg).`,
      });
    }
  }

  /* --- Stock négatif -------------------------------------------------- */

  const stockParLot = new Map<ID, number>();
  for (const mvt of db.stockMovements) {
    const signe = mvt.sens === 'ENTREE' ? 1 : -1;
    stockParLot.set(mvt.lotId, (stockParLot.get(mvt.lotId) ?? 0) + signe * mvt.quantite);
  }
  for (const [lotId, stock] of stockParLot) {
    if (stock < -0.001) {
      pousser({
        severite: 'critique',
        regle: 'Stock négatif',
        zone: 'Chambre positive',
        lotCode: codeLot.get(lotId),
        ecart: stock,
        message: `Le stock chambre du lot est négatif (${stock.toFixed(1)} kg): les sorties dépassent les entrées.`,
      });
    }
  }

  /* --- Cascade boîtes: remplissage ≥ sertissage ≥ emballage ----------- */

  const lotsConcernes = new Set([
    ...db.fillingOperations.map((o) => o.lotId),
    ...db.sertissageOperations.map((o) => o.lotId),
    ...db.packagingOperations.map((o) => o.lotId),
    ...db.grattageOperations.map((o) => o.lotId),
  ]);

  for (const lotId of lotsConcernes) {
    const remplies = somme(
      db.fillingOperations.filter((o) => o.lotId === lotId),
      (o) => o.nombreBoites - o.rebut,
    );
    const serties = somme(
      db.sertissageOperations.filter((o) => o.lotId === lotId),
      (o) => o.boitesApres,
    );
    const emballees = somme(
      db.packagingOperations.filter((o) => o.lotId === lotId),
      (o) => o.nombreBoites,
    );

    if (serties > remplies) {
      pousser({
        severite: 'critique',
        regle: 'Quantité sertie > quantité remplie',
        zone: 'Sertissage',
        lotCode: codeLot.get(lotId),
        ecart: serties - remplies,
        message: `${serties} boîtes serties pour ${remplies} boîtes remplies (hors rebut).`,
      });
    }
    if (emballees > serties) {
      pousser({
        severite: 'critique',
        regle: 'Quantité emballée > quantité sertie',
        zone: 'Emballage',
        lotCode: codeLot.get(lotId),
        ecart: emballees - serties,
        message: `${emballees} boîtes emballées pour ${serties} boîtes serties.`,
      });
    }
  }

  /* --- Production sans matière disponible ----------------------------- */

  for (const lotId of lotsConcernes) {
    const sortiesChambre = somme(
      db.stockMovements.filter((m) => m.lotId === lotId && m.sens === 'SORTIE'),
      (m) => m.quantite,
    );
    const production =
      somme(db.grattageOperations.filter((o) => o.lotId === lotId), (o) => o.nombreBoites) +
      somme(db.fillingOperations.filter((o) => o.lotId === lotId), (o) => o.nombreBoites);

    if (production > 0 && sortiesChambre <= 0) {
      pousser({
        severite: 'critique',
        regle: 'Production sans matière disponible',
        lotCode: codeLot.get(lotId),
        message: `Production enregistrée (${production} boîtes) sans aucune sortie de chambre pour ce lot.`,
      });
    }
  }

  /* --- Consommation matière > matière sortie de chambre --------------- */

  for (const lotId of lotsConcernes) {
    const sortiesChambre = somme(
      db.stockMovements.filter((m) => m.lotId === lotId && m.sens === 'SORTIE'),
      (m) => m.quantite,
    );
    const consommee = somme(
      db.fillingOperations.filter((o) => o.lotId === lotId),
      (o) => o.quantiteMatiereConsommee,
    );
    if (sortiesChambre > 0 && consommee > sortiesChambre + 0.001) {
      pousser({
        severite: 'avertissement',
        regle: 'Quantité produite > quantité disponible',
        zone: 'Remplissage',
        lotCode: codeLot.get(lotId),
        ecart: consommee - sortiesChambre,
        message: `Matière consommée au remplissage (${consommee.toFixed(1)} kg) supérieure à la matière sortie de chambre (${sortiesChambre.toFixed(1)} kg).`,
      });
    }
  }

  /* --- Temps fin < temps début ---------------------------------------- */

  const plagesHoraires: { zone: Zone; libelle: string; lotId?: ID; debut: string; fin?: string }[] = [
    ...db.treatmentOperations.map((o) => ({ zone: 'Traitement' as Zone, libelle: 'Traitement', lotId: o.lotId, debut: o.heureDebut, fin: o.heureFin })),
    ...db.filetOperations.map((o) => ({ zone: 'Filet' as Zone, libelle: 'Filet', lotId: o.lotId, debut: o.heureDebut, fin: o.heureFin })),
    ...db.cuissonOperations.map((o) => ({ zone: 'Cuisson' as Zone, libelle: 'Cuisson', lotId: o.lotId, debut: o.heureDebut, fin: o.heureFin })),
    ...db.grattageOperations.map((o) => ({ zone: 'Grattage' as Zone, libelle: 'Grattage', lotId: o.lotId, debut: o.heureDebut, fin: o.heureFin })),
    ...db.fillingOperations.map((o) => ({ zone: 'Remplissage' as Zone, libelle: 'Remplissage', lotId: o.lotId, debut: o.heureDebut, fin: o.heureFin })),
    ...db.sertissageOperations.map((o) => ({ zone: 'Sertissage' as Zone, libelle: 'Sertissage', lotId: o.lotId, debut: o.heureDebut, fin: o.heureFin })),
    ...db.marquageOperations.map((o) => ({ zone: 'Marquage' as Zone, libelle: 'Marquage', lotId: o.lotId, debut: o.heureDebut, fin: o.heureFin })),
    ...db.sterilisationCycles.map((o) => ({ zone: 'Stérilisation' as Zone, libelle: `Cycle ${o.numeroCycle}`, lotId: o.lotId, debut: o.heureDebut, fin: o.heureFin })),
    ...db.packagingOperations.map((o) => ({ zone: 'Emballage' as Zone, libelle: 'Emballage', lotId: o.lotId, debut: o.heureDebut, fin: o.heureFin })),
    ...db.stops.map((s) => ({ zone: s.zone, libelle: `Arrêt ${s.motif}`, lotId: s.lotId, debut: s.heureDebut, fin: s.heureFin })),
  ];

  for (const plage of plagesHoraires) {
    const duree = dureeMinutes(plage.debut, plage.fin);
    if (duree !== null && duree < 0) {
      pousser({
        severite: 'critique',
        regle: 'Temps fin < temps début',
        zone: plage.zone,
        lotCode: plage.lotId ? codeLot.get(plage.lotId) : undefined,
        ecart: duree,
        message: `${plage.libelle}: heure de fin antérieure à l'heure de début.`,
      });
    }
  }

  /* --- Arrêts qui se chevauchent -------------------------------------- */

  const clefRessource = (s: (typeof db.stops)[number]) =>
    s.machineId ?? s.lineId ?? `zone:${s.zone}`;

  const arretsParRessource = new Map<string, typeof db.stops>();
  for (const s of db.stops) {
    if (!s.heureFin) continue;
    const clef = clefRessource(s);
    arretsParRessource.set(clef, [...(arretsParRessource.get(clef) ?? []), s]);
  }

  for (const [clef, arrets] of arretsParRessource) {
    const tries = [...arrets].sort(
      (a, b) => new Date(a.heureDebut).getTime() - new Date(b.heureDebut).getTime(),
    );
    for (let i = 1; i < tries.length; i++) {
      const precedent = tries[i - 1];
      const courant = tries[i];
      const finPrecedente = new Date(precedent.heureFin!).getTime();
      const debutCourant = new Date(courant.heureDebut).getTime();
      if (debutCourant < finPrecedente) {
        const ressource =
          nomMachine.get(clef) ?? nomLigne.get(clef) ?? clef.replace('zone:', '');
        pousser({
          severite: 'avertissement',
          regle: 'Arrêts qui se chevauchent',
          zone: courant.zone,
          lotCode: courant.lotId ? codeLot.get(courant.lotId) : undefined,
          ecart: (finPrecedente - debutCourant) / 60000,
          message: `${ressource}: l'arrêt « ${courant.motif} » chevauche l'arrêt « ${precedent.motif} ».`,
        });
      }
    }
  }

  /* --- Lot inexistant -------------------------------------------------- */

  const lotsConnus = new Set(db.lots.map((l) => l.id));
  const referencesLot: { table: string; lotId?: ID }[] = [
    ...db.receptions.map((r) => ({ table: 'Réceptions', lotId: r.lotId })),
    ...db.stockMovements.map((m) => ({ table: 'Mouvements de stock', lotId: m.lotId })),
    ...db.treatmentOperations.map((o) => ({ table: 'Traitement', lotId: o.lotId })),
    ...db.filetOperations.map((o) => ({ table: 'Filet', lotId: o.lotId })),
    ...db.cuissonOperations.map((o) => ({ table: 'Cuisson', lotId: o.lotId })),
    ...db.grattageOperations.map((o) => ({ table: 'Grattage', lotId: o.lotId })),
    ...db.fillingOperations.map((o) => ({ table: 'Remplissage', lotId: o.lotId })),
    ...db.liquidConsumptions.map((o) => ({ table: 'Liquides', lotId: o.lotId })),
    ...db.sertissageOperations.map((o) => ({ table: 'Sertissage', lotId: o.lotId })),
    ...db.marquageOperations.map((o) => ({ table: 'Marquage', lotId: o.lotId })),
    ...db.sterilisationCycles.map((o) => ({ table: 'Stérilisation', lotId: o.lotId })),
    ...db.packagingOperations.map((o) => ({ table: 'Emballage', lotId: o.lotId })),
    ...db.stops.filter((s) => s.lotId).map((s) => ({ table: 'Arrêts', lotId: s.lotId })),
  ];

  const tablesOrphelines = new Set<string>();
  for (const ref of referencesLot) {
    if (!ref.lotId || lotsConnus.has(ref.lotId)) continue;
    if (tablesOrphelines.has(ref.table)) continue;
    tablesOrphelines.add(ref.table);
    pousser({
      severite: 'critique',
      regle: 'Lot inexistant',
      message: `${ref.table}: enregistrement rattaché à un lot qui n'existe pas.`,
    });
  }

  return anomalies;
}
