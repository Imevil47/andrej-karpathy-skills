/**
 * Vues dérivées: stock, indicateurs par opération, traçabilité, agrégats
 * dashboard. Rien n'est stocké ici — tout est recalculé depuis la base.
 */

import {
  cadenceHoraire,
  dureeMinutes,
  ecartMatiere,
  productivite,
  rendement,
  tauxPerte,
  tempsArretCumuleMin,
  tempsNet,
} from './calculations';
import type {
  Database,
  DateISO,
  Destination,
  Equipe,
  ID,
  Stop,
  Zone,
} from './types';

/* ------------------------------------------------------------------ */
/* Filtres (section 21)                                                */
/* ------------------------------------------------------------------ */

export interface Filtres {
  dateDebut?: DateISO;
  dateFin?: DateISO;
  equipe?: Equipe;
  lotId?: ID;
  productId?: ID;
  espece?: string;
  lineId?: ID;
  machineId?: ID;
  zone?: Zone;
  operateurId?: ID;
  destination?: Destination;
}

export const FILTRES_VIDES: Filtres = {};

/** Enregistrement filtrable: tout ce sur quoi les filtres peuvent porter. */
interface Filtrable {
  date?: DateISO;
  equipe?: Equipe;
  lotId?: ID;
  productId?: ID;
  espece?: string;
  lineId?: ID;
  machineId?: ID;
  zone?: Zone;
  operateurId?: ID;
  destination?: Destination;
}

/**
 * Applique les filtres actifs. Un critère qui ne s'applique pas à la table
 * (ex: `lineId` sur une réception) est ignoré pour cette table.
 */
export function appliquerFiltres<T extends Filtrable>(rows: T[], f: Filtres): T[] {
  return rows.filter((r) => {
    if (f.dateDebut && r.date && r.date < f.dateDebut) return false;
    if (f.dateFin && r.date && r.date > f.dateFin) return false;
    if (f.equipe && r.equipe && r.equipe !== f.equipe) return false;
    if (f.lotId && r.lotId !== undefined && r.lotId !== f.lotId) return false;
    if (f.productId && r.productId !== undefined && r.productId !== f.productId) return false;
    if (f.espece && r.espece !== undefined && r.espece !== f.espece) return false;
    if (f.lineId && r.lineId !== undefined && r.lineId !== f.lineId) return false;
    if (f.machineId && r.machineId !== undefined && r.machineId !== f.machineId) return false;
    if (f.zone && r.zone !== undefined && r.zone !== f.zone) return false;
    if (f.operateurId && r.operateurId !== undefined && r.operateurId !== f.operateurId) return false;
    if (f.destination && r.destination !== undefined && r.destination !== f.destination) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Arrêts rattachés à une opération                                    */
/* ------------------------------------------------------------------ */

export interface FenetreOperation {
  zone?: Zone;
  lineId?: ID;
  machineId?: ID;
  heureDebut: string;
  heureFin?: string;
}

/**
 * Arrêts imputables à une opération: même ressource (ligne ou machine, sinon
 * même zone) et chevauchement de la plage horaire.
 */
export function arretsDeLOperation(db: Database, op: FenetreOperation): Stop[] {
  const debut = new Date(op.heureDebut).getTime();
  const fin = op.heureFin ? new Date(op.heureFin).getTime() : Infinity;

  return db.stops.filter((s) => {
    const memeRessource = op.machineId
      ? s.machineId === op.machineId
      : op.lineId
        ? s.lineId === op.lineId
        : op.zone
          ? s.zone === op.zone && !s.lineId && !s.machineId
          : false;
    if (!memeRessource) return false;

    const sDebut = new Date(s.heureDebut).getTime();
    const sFin = s.heureFin ? new Date(s.heureFin).getTime() : sDebut;
    return sDebut < fin && sFin > debut;
  });
}

/** Indicateurs temps calculés pour une opération quelconque. */
export interface IndicateursTemps {
  dureeBruteMin: number | null;
  tempsArretMin: number;
  tempsNetMin: number | null;
  nbArrets: number;
}

export function indicateursTemps(db: Database, op: FenetreOperation): IndicateursTemps {
  const arrets = arretsDeLOperation(db, op);
  const dureeBruteMin = dureeMinutes(op.heureDebut, op.heureFin);
  const tempsArretMin = tempsArretCumuleMin(arrets);
  return {
    dureeBruteMin,
    tempsArretMin,
    tempsNetMin: tempsNet(dureeBruteMin, tempsArretMin),
    nbArrets: arrets.length,
  };
}

/** Indicateurs complets d'une opération de transformation matière. */
export interface IndicateursOperation extends IndicateursTemps {
  rendementPct: number | null;
  pertesKg: number;
  tauxPertePct: number | null;
  ecartKg: number;
  cadenceKgH: number | null;
  productiviteKgHPers: number | null;
}

export function indicateursOperation(
  db: Database,
  op: FenetreOperation & {
    quantiteEntree: number;
    quantiteSortie: number;
    pertes: number;
    nbPersonnel?: number;
  },
): IndicateursOperation {
  const temps = indicateursTemps(db, op);
  return {
    ...temps,
    rendementPct: rendement(op.quantiteEntree, op.quantiteSortie),
    pertesKg: op.quantiteEntree - op.quantiteSortie,
    tauxPertePct: tauxPerte(op.quantiteEntree, op.quantiteSortie),
    ecartKg: ecartMatiere(op.quantiteEntree, op.quantiteSortie, op.pertes),
    cadenceKgH: cadenceHoraire(op.quantiteSortie, temps.tempsNetMin),
    productiviteKgHPers: productivite(op.quantiteSortie, op.nbPersonnel, temps.tempsNetMin),
  };
}

/* ------------------------------------------------------------------ */
/* Chambre positive / stock (section 4)                                */
/* ------------------------------------------------------------------ */

export interface LigneStock {
  lotId: ID;
  lotCode: string;
  espece: string;
  chambre: string;
  entrees: number;
  sorties: number;
  stock: number;
  dernierMouvement?: string;
}

export function stockChambre(db: Database, f: Filtres = {}): LigneStock[] {
  const codeLot = new Map(db.lots.map((l) => [l.id, l.code]));
  const parClef = new Map<string, LigneStock>();

  for (const mvt of appliquerFiltres(db.stockMovements, f)) {
    const clef = `${mvt.lotId}|${mvt.chambre}`;
    const ligne =
      parClef.get(clef) ??
      ({
        lotId: mvt.lotId,
        lotCode: codeLot.get(mvt.lotId) ?? '(lot inconnu)',
        espece: mvt.espece,
        chambre: mvt.chambre,
        entrees: 0,
        sorties: 0,
        stock: 0,
      } satisfies LigneStock);

    if (mvt.sens === 'ENTREE') ligne.entrees += mvt.quantite;
    else ligne.sorties += mvt.quantite;
    ligne.stock = ligne.entrees - ligne.sorties;
    if (!ligne.dernierMouvement || mvt.heure > ligne.dernierMouvement) {
      ligne.dernierMouvement = mvt.heure;
    }
    parClef.set(clef, ligne);
  }

  return [...parClef.values()].sort((a, b) => a.lotCode.localeCompare(b.lotCode));
}

/** Stock disponible d'un lot (toutes chambres confondues). */
export function stockDisponible(db: Database, lotId: ID): number {
  return db.stockMovements
    .filter((m) => m.lotId === lotId)
    .reduce((total, m) => total + (m.sens === 'ENTREE' ? m.quantite : -m.quantite), 0);
}

/* ------------------------------------------------------------------ */
/* Traçabilité (section 19)                                            */
/* ------------------------------------------------------------------ */

export interface EtapeTrace {
  ordre: number;
  etape: string;
  zone?: Zone;
  ressource?: string;
  heureDebut?: string;
  heureFin?: string;
  entree?: string;
  sortie?: string;
  pertes?: string;
  detail?: string;
}

/**
 * Parcours complet d'un lot, de la réception au produit fini.
 * L'ordre des étapes suit le flux réel de l'usine.
 */
export function traceLot(db: Database, lotId: ID): EtapeTrace[] {
  const nomLigne = new Map(db.lines.map((l) => [l.id, l.nom]));
  const nomMachine = new Map(db.machines.map((m) => [m.id, m.nom]));
  const etapes: EtapeTrace[] = [];

  for (const r of db.receptions.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 1,
      etape: 'Réception camion',
      zone: 'Réception',
      ressource: r.camion,
      heureDebut: r.heureArrivee,
      entree: `${r.quantiteRecue} kg reçus`,
      sortie: `${r.quantiteAcceptee} kg acceptés`,
      pertes: `${r.quantiteRefusee} kg refusés`,
      detail: `${r.fournisseur} — ${r.espece} — ${r.temperature ?? '—'} °C`,
    });
  }

  for (const m of db.stockMovements.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: m.sens === 'ENTREE' ? 2 : 3,
      etape: m.sens === 'ENTREE' ? 'Entrée chambre positive' : 'Sortie chambre positive',
      zone: 'Chambre positive',
      ressource: m.chambre,
      heureDebut: m.heure,
      entree: m.sens === 'ENTREE' ? `${m.quantite} kg` : undefined,
      sortie: m.sens === 'SORTIE' ? `${m.quantite} kg` : undefined,
      detail: m.destination ?? m.reference,
    });
  }

  for (const o of db.treatmentOperations.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 4,
      etape: 'Traitement / coupe',
      zone: 'Traitement',
      ressource: nomLigne.get(o.lineId),
      heureDebut: o.heureDebut,
      heureFin: o.heureFin,
      entree: `${o.quantiteEntree} kg`,
      sortie: `${o.quantiteSortie} kg`,
      pertes: `${o.pertes} kg`,
      detail: `Destination: ${o.destination}`,
    });
  }

  for (const o of db.filetOperations.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 5,
      etape: 'Machine filet',
      zone: 'Filet',
      ressource: nomMachine.get(o.machineId),
      heureDebut: o.heureDebut,
      heureFin: o.heureFin,
      entree: `${o.quantiteEntree} kg`,
      sortie: `${o.quantiteSortie} kg`,
      pertes: `${o.pertes} kg`,
    });
  }

  for (const o of db.cuissonOperations.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 6,
      etape: 'Mise en grille / cuisson',
      zone: 'Cuisson',
      ressource: nomMachine.get(o.machineId ?? ''),
      heureDebut: o.heureDebut,
      heureFin: o.heureFin,
      entree: `${o.quantiteEntree} kg`,
      sortie: `${o.quantiteSortie} kg`,
      pertes: `${o.pertes} kg`,
      detail: `${o.nombreGrilles} grilles — ${o.temperature ?? '—'} °C`,
    });
  }

  for (const o of db.grattageOperations.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 7,
      etape: 'Grattage',
      zone: 'Grattage',
      ressource: nomLigne.get(o.lineId),
      heureDebut: o.heureDebut,
      heureFin: o.heureFin,
      entree: `${o.quantiteEntree} kg`,
      sortie: `${o.nombreBoites} boîtes`,
      pertes: `${o.quantiteRejetee} kg rejetés`,
      detail: `${o.operatrices.length} opératrices`,
    });
  }

  for (const o of db.fillingOperations.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 8,
      etape: 'Remplissage',
      zone: 'Remplissage',
      ressource: nomLigne.get(o.lineId),
      heureDebut: o.heureDebut,
      heureFin: o.heureFin,
      entree: `${o.quantiteMatiereConsommee} kg`,
      sortie: `${o.nombreBoites} boîtes`,
      pertes: `${o.rebut} rebut`,
      detail: `Poids réel ${o.poidsReelMoyenG} g / cible ${o.poidsCibleG} g`,
    });
  }

  for (const c of db.liquidConsumptions.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 9,
      etape: 'Dosage liquide',
      zone: 'Remplissage',
      ressource: c.typeLiquide,
      entree: `${c.quantiteReelle} ${c.unite === 'ml' ? 'L' : 'kg'}`,
      sortie: `${c.nombreBoites} boîtes`,
      detail: `${c.dosageTheorique} ${c.unite}/boîte`,
    });
  }

  for (const o of db.sertissageOperations.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 10,
      etape: 'Sertissage',
      zone: 'Sertissage',
      ressource: nomMachine.get(o.machineId),
      heureDebut: o.heureDebut,
      heureFin: o.heureFin,
      entree: `${o.boitesAvant} boîtes`,
      sortie: `${o.boitesApres} boîtes`,
      pertes: `${o.rebut} rebut`,
      detail: `${o.boitesNonConformes} non conformes`,
    });
  }

  for (const o of db.marquageOperations.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 11,
      etape: 'Marquage',
      zone: 'Marquage',
      ressource: nomMachine.get(o.machineId ?? ''),
      heureDebut: o.heureDebut,
      heureFin: o.heureFin,
      sortie: `${o.nombreBoites} boîtes`,
      pertes: `${o.rebut} rebut`,
      detail: `Code ${o.codeMarquage}`,
    });
  }

  for (const c of db.sterilisationCycles.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 12,
      etape: 'Stérilisation',
      zone: 'Stérilisation',
      ressource: nomMachine.get(c.autoclaveId),
      heureDebut: c.heureDebut,
      heureFin: c.heureFin,
      entree: `${c.nombreBoites} boîtes`,
      pertes: `${c.rejets} rejets`,
      detail: `Cycle ${c.numeroCycle} — ${c.resultat}`,
    });
  }

  for (const o of db.packagingOperations.filter((x) => x.lotId === lotId)) {
    etapes.push({
      ordre: 13,
      etape: 'Emballage / produit fini',
      zone: 'Emballage',
      heureDebut: o.heureDebut,
      heureFin: o.heureFin,
      entree: `${o.nombreBoites} boîtes`,
      sortie: `${o.nombreCartons} cartons / ${o.nombrePalettes} palettes`,
      pertes: `${o.rebut} rebut`,
    });
  }

  return etapes.sort((a, b) => {
    if (a.ordre !== b.ordre) return a.ordre - b.ordre;
    return (a.heureDebut ?? '').localeCompare(b.heureDebut ?? '');
  });
}

/* ------------------------------------------------------------------ */
/* Bilan matière d'un lot                                              */
/* ------------------------------------------------------------------ */

export interface BilanLot {
  recuKg: number;
  accepteKg: number;
  entreeChambreKg: number;
  sortieChambreKg: number;
  stockChambreKg: number;
  traiteEntreeKg: number;
  traiteSortieKg: number;
  pertesDeclareesKg: number;
  boitesRemplies: number;
  boitesSerties: number;
  boitesSterilisees: number;
  boitesEmballees: number;
  cartons: number;
  palettes: number;
  rendementGlobalPct: number | null;
  /** Sortie de l'étape la plus avancée atteinte par le lot. */
  matiereRetrouveeKg: number;
  ecartMatiereKg: number;
}

export function bilanLot(db: Database, lotId: ID): BilanLot {
  const s = <T>(rows: T[], get: (r: T) => number) =>
    rows.reduce((total, r) => total + (get(r) || 0), 0);

  const receptions = db.receptions.filter((r) => r.lotId === lotId);
  const mvts = db.stockMovements.filter((m) => m.lotId === lotId);
  const traitements = db.treatmentOperations.filter((o) => o.lotId === lotId);
  const filets = db.filetOperations.filter((o) => o.lotId === lotId);
  const cuissons = db.cuissonOperations.filter((o) => o.lotId === lotId);
  const grattages = db.grattageOperations.filter((o) => o.lotId === lotId);
  const remplissages = db.fillingOperations.filter((o) => o.lotId === lotId);
  const sertissages = db.sertissageOperations.filter((o) => o.lotId === lotId);
  const cycles = db.sterilisationCycles.filter((o) => o.lotId === lotId);
  const emballages = db.packagingOperations.filter((o) => o.lotId === lotId);

  const entreeChambreKg = s(mvts.filter((m) => m.sens === 'ENTREE'), (m) => m.quantite);
  const sortieChambreKg = s(mvts.filter((m) => m.sens === 'SORTIE'), (m) => m.quantite);
  const traiteEntreeKg = s(traitements, (o) => o.quantiteEntree) + s(filets, (o) => o.quantiteEntree);
  const traiteSortieKg = s(traitements, (o) => o.quantiteSortie) + s(filets, (o) => o.quantiteSortie);
  const pertesDeclareesKg =
    s(traitements, (o) => o.pertes) +
    s(filets, (o) => o.pertes) +
    s(cuissons, (o) => o.pertes) +
    s(grattages, (o) => o.quantiteRejetee);

  const boitesRemplies = s(remplissages, (o) => o.nombreBoites);
  const boitesEmballees = s(emballages, (o) => o.nombreBoites);
  const recuKg = s(receptions, (r) => r.quantiteRecue);

  /*
   * Matière retrouvée: sortie de l'étape la plus avancée que le lot ait
   * atteinte. Comparer la sortie de chambre à la sortie du traitement tout en
   * déduisant les pertes de cuisson et de grattage compterait deux fois les
   * mêmes kilos — l'écart doit se lire au bout de la chaîne parcourue.
   */
  const matiereConditionneeKg = s(remplissages, (o) => o.quantiteMatiereConsommee);
  const matiereGratteeKg = s(grattages, (o) => (o.nombreBoites * (o.poidsMoyenG ?? 0)) / 1000);
  const sortieCuissonKg = s(cuissons, (o) => o.quantiteSortie);
  const matiereRetrouveeKg =
    matiereConditionneeKg || matiereGratteeKg || sortieCuissonKg || traiteSortieKg;

  return {
    recuKg,
    accepteKg: s(receptions, (r) => r.quantiteAcceptee),
    entreeChambreKg,
    sortieChambreKg,
    stockChambreKg: entreeChambreKg - sortieChambreKg,
    traiteEntreeKg,
    traiteSortieKg,
    pertesDeclareesKg,
    boitesRemplies: boitesRemplies || s(grattages, (o) => o.nombreBoites),
    boitesSerties: s(sertissages, (o) => o.boitesApres),
    boitesSterilisees: s(cycles, (c) => c.nombreBoites - c.rejets),
    boitesEmballees,
    cartons: s(emballages, (o) => o.nombreCartons),
    palettes: s(emballages, (o) => o.nombrePalettes),
    rendementGlobalPct: rendement(traiteEntreeKg, traiteSortieKg),
    matiereRetrouveeKg,
    ecartMatiereKg: ecartMatiere(sortieChambreKg, matiereRetrouveeKg, pertesDeclareesKg),
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard (section 20)                                              */
/* ------------------------------------------------------------------ */

export interface KpisDashboard {
  // Production
  boitesProduites: number;
  boitesConformes: number;
  boitesNonConformes: number;
  rebut: number;
  cartons: number;
  palettes: number;
  productionParLigne: { nom: string; valeur: number }[];
  productionParProduit: { nom: string; valeur: number }[];
  productionParHeure: { nom: string; valeur: number }[];
  // Performance
  cadenceBoitesH: number | null;
  rendementMatierePct: number | null;
  productiviteBoitesHPers: number | null;
  tauxPertePct: number | null;
  tempsNetMin: number;
  // Arrêts
  tempsArretMin: number;
  nbArrets: number;
  topCauses: { nom: string; valeur: number }[];
  arretsParLigne: { nom: string; valeur: number }[];
  arretsParMachine: { nom: string; valeur: number }[];
  // Matière
  matiereEntreeKg: number;
  matiereConsommeeKg: number;
  pertesKg: number;
  stockKg: number;
  ecartMatiereKg: number;
}

export function kpisDashboard(db: Database, f: Filtres = {}): KpisDashboard {
  const s = <T>(rows: T[], get: (r: T) => number) =>
    rows.reduce((total, r) => total + (get(r) || 0), 0);

  const nomLigne = new Map(db.lines.map((l) => [l.id, l.nom]));
  const nomMachine = new Map(db.machines.map((m) => [m.id, m.nom]));
  const nomProduit = new Map(db.products.map((p) => [p.id, p.nom]));

  const receptions = appliquerFiltres(db.receptions, f);
  const mvts = appliquerFiltres(db.stockMovements, f);
  const traitements = appliquerFiltres(db.treatmentOperations, f);
  const filets = appliquerFiltres(db.filetOperations, f);
  const cuissons = appliquerFiltres(db.cuissonOperations, f);
  const grattages = appliquerFiltres(db.grattageOperations, f);
  const remplissages = appliquerFiltres(db.fillingOperations, f);
  const sertissages = appliquerFiltres(db.sertissageOperations, f);
  const emballages = appliquerFiltres(db.packagingOperations, f);
  const arrets = appliquerFiltres(db.stops, f);

  const boitesProduites = s(remplissages, (o) => o.nombreBoites);
  const boitesConformes = s(sertissages, (o) => o.boitesConformes);
  const boitesNonConformes = s(sertissages, (o) => o.boitesNonConformes);

  const matiereEntreeKg = s(mvts.filter((m) => m.sens === 'ENTREE'), (m) => m.quantite);
  const matiereSortieChambreKg = s(mvts.filter((m) => m.sens === 'SORTIE'), (m) => m.quantite);
  const traiteEntreeKg = s(traitements, (o) => o.quantiteEntree) + s(filets, (o) => o.quantiteEntree);
  const traiteSortieKg = s(traitements, (o) => o.quantiteSortie) + s(filets, (o) => o.quantiteSortie);
  const pertesKg =
    s(traitements, (o) => o.pertes) +
    s(filets, (o) => o.pertes) +
    s(cuissons, (o) => o.pertes) +
    s(grattages, (o) => o.quantiteRejetee);

  // Même logique que le bilan par lot: on compare à l'étape la plus avancée.
  const matiereRetrouveeKg =
    s(remplissages, (o) => o.quantiteMatiereConsommee) ||
    s(grattages, (o) => (o.nombreBoites * (o.poidsMoyenG ?? 0)) / 1000) ||
    s(cuissons, (o) => o.quantiteSortie) ||
    traiteSortieKg;

  const tempsArretMin = tempsArretCumuleMin(arrets);

  /*
   * Temps net de production: chaque opération ne se voit imputer que les arrêts
   * de SA ressource qui recouvrent SA plage horaire. Soustraire le temps d'arrêt
   * de toute l'usine d'une seule ligne gonflerait artificiellement la cadence.
   */
  const operationsProduction = remplissages.length ? remplissages : grattages;
  const tempsNetMin = operationsProduction.reduce(
    (total, o) => total + (indicateursTemps(db, { ...o, lineId: o.lineId }).tempsNetMin ?? 0),
    0,
  );

  const personnelProduction = s(remplissages, (o) => o.nbPersonnel ?? 0);

  const agreger = (
    entrees: { clef: string | undefined; valeur: number }[],
    limite?: number,
  ): { nom: string; valeur: number }[] => {
    const parClef = new Map<string, number>();
    for (const e of entrees) {
      const nom = e.clef ?? '—';
      parClef.set(nom, (parClef.get(nom) ?? 0) + e.valeur);
    }
    const liste = [...parClef.entries()]
      .map(([nom, valeur]) => ({ nom, valeur }))
      .sort((a, b) => b.valeur - a.valeur);
    return limite ? liste.slice(0, limite) : liste;
  };

  return {
    boitesProduites,
    boitesConformes,
    boitesNonConformes,
    rebut: s(remplissages, (o) => o.rebut) + s(sertissages, (o) => o.rebut) + s(emballages, (o) => o.rebut),
    cartons: s(emballages, (o) => o.nombreCartons),
    palettes: s(emballages, (o) => o.nombrePalettes),

    productionParLigne: agreger(
      remplissages.map((o) => ({ clef: nomLigne.get(o.lineId), valeur: o.nombreBoites })),
    ),
    productionParProduit: agreger(
      remplissages.map((o) => ({ clef: nomProduit.get(o.productId ?? ''), valeur: o.nombreBoites })),
    ),
    productionParHeure: agreger(
      remplissages.map((o) => ({
        clef: `${new Date(o.heureDebut).getHours().toString().padStart(2, '0')} h`,
        valeur: o.nombreBoites,
      })),
    ).sort((a, b) => a.nom.localeCompare(b.nom)),

    cadenceBoitesH: cadenceHoraire(boitesProduites, tempsNetMin),
    rendementMatierePct: rendement(traiteEntreeKg, traiteSortieKg),
    productiviteBoitesHPers: productivite(boitesProduites, personnelProduction, tempsNetMin),
    tauxPertePct: tauxPerte(traiteEntreeKg, traiteSortieKg),
    tempsNetMin,

    tempsArretMin,
    nbArrets: arrets.length,
    topCauses: agreger(
      arrets.map((a) => ({
        clef: a.motif,
        valeur: dureeMinutes(a.heureDebut, a.heureFin) ?? 0,
      })),
      5,
    ),
    arretsParLigne: agreger(
      arrets.filter((a) => a.lineId).map((a) => ({
        clef: nomLigne.get(a.lineId!),
        valeur: dureeMinutes(a.heureDebut, a.heureFin) ?? 0,
      })),
    ),
    arretsParMachine: agreger(
      arrets.filter((a) => a.machineId).map((a) => ({
        clef: nomMachine.get(a.machineId!),
        valeur: dureeMinutes(a.heureDebut, a.heureFin) ?? 0,
      })),
    ),

    matiereEntreeKg: matiereEntreeKg || s(receptions, (r) => r.quantiteAcceptee),
    matiereConsommeeKg: matiereSortieChambreKg,
    pertesKg,
    stockKg: matiereEntreeKg - matiereSortieChambreKg,
    ecartMatiereKg: ecartMatiere(matiereSortieChambreKg, matiereRetrouveeKg, pertesKg),
  };
}

/* ------------------------------------------------------------------ */
/* Classements (section 25)                                            */
/* ------------------------------------------------------------------ */

export interface PerformanceLigne {
  nom: string;
  zone: Zone;
  production: number;
  rendementPct: number | null;
  tempsArretMin: number;
  nbArrets: number;
  cadence: number | null;
}

export function performanceParLigne(db: Database, f: Filtres = {}): PerformanceLigne[] {
  const traitements = appliquerFiltres(db.treatmentOperations, f);
  const grattages = appliquerFiltres(db.grattageOperations, f);
  const remplissages = appliquerFiltres(db.fillingOperations, f);
  const arrets = appliquerFiltres(db.stops, f);

  return db.lines
    .filter((l) => l.active)
    .map((ligne) => {
      const trt = traitements.filter((o) => o.lineId === ligne.id);
      const grt = grattages.filter((o) => o.lineId === ligne.id);
      const rmp = remplissages.filter((o) => o.lineId === ligne.id);
      const arretsLigne = arrets.filter((a) => a.lineId === ligne.id);

      const entree = trt.reduce((t, o) => t + o.quantiteEntree, 0);
      const sortie = trt.reduce((t, o) => t + o.quantiteSortie, 0);
      const boites =
        rmp.reduce((t, o) => t + o.nombreBoites, 0) || grt.reduce((t, o) => t + o.nombreBoites, 0);
      const production = boites || sortie;

      const brut = [...trt, ...grt, ...rmp].reduce(
        (t, o) => t + (dureeMinutes(o.heureDebut, o.heureFin) ?? 0),
        0,
      );
      const arretMin = tempsArretCumuleMin(arretsLigne);
      const net = Math.max(0, brut - arretMin);

      return {
        nom: ligne.nom,
        zone: ligne.zone,
        production,
        rendementPct: rendement(entree, sortie),
        tempsArretMin: arretMin,
        nbArrets: arretsLigne.length,
        cadence: cadenceHoraire(production, net),
      };
    })
    .filter((p) => p.production > 0 || p.tempsArretMin > 0);
}

/** Production individuelle des opératrices de grattage (section 9). */
export interface PerformanceOperatrice {
  matricule: string;
  nom: string;
  ligne: string;
  boites: number;
  tempsNetMin: number;
  cadenceBoitesH: number | null;
}

export function performanceOperatrices(db: Database, f: Filtres = {}): PerformanceOperatrice[] {
  const nomLigne = new Map(db.lines.map((l) => [l.id, l.nom]));
  const employes = new Map(db.employees.map((e) => [e.id, e]));
  const resultats: PerformanceOperatrice[] = [];

  for (const op of appliquerFiltres(db.grattageOperations, f)) {
    const temps = indicateursTemps(db, op);
    for (const prod of op.operatrices) {
      const employe = employes.get(prod.employeeId);
      const brutMin =
        dureeMinutes(prod.heureDebut ?? op.heureDebut, prod.heureFin ?? op.heureFin) ?? 0;
      const netMin = Math.max(0, brutMin - temps.tempsArretMin);
      resultats.push({
        matricule: employe?.matricule ?? '—',
        nom: employe?.nom ?? '(opératrice inconnue)',
        ligne: nomLigne.get(op.lineId) ?? '—',
        boites: prod.nombreBoites,
        tempsNetMin: netMin,
        cadenceBoitesH: cadenceHoraire(prod.nombreBoites, netMin),
      });
    }
  }

  return resultats.sort((a, b) => (b.cadenceBoitesH ?? 0) - (a.cadenceBoitesH ?? 0));
}
