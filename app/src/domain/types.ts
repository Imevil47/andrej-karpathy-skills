/**
 * Modèle de données — Gestion d'Exploitation Usine de Conserves.
 *
 * Règle structurante: toute table opérationnelle porte un `lotId`.
 * Aucune donnée isolée: chaque opération est rattachée à un lot, une ligne/machine
 * et une plage horaire.
 */

export type ID = string;

/** Horodatage ISO 8601 (ex: "2026-08-16T07:30"). */
export type DateTimeISO = string;
/** Date ISO (ex: "2026-08-16"). */
export type DateISO = string;

export type Equipe = 'Matin' | 'Après-midi' | 'Nuit';

export const EQUIPES: Equipe[] = ['Matin', 'Après-midi', 'Nuit'];

/** Zones de l'usine — sert au filtrage et au rattachement des arrêts. */
export type Zone =
  | 'Réception'
  | 'Chambre positive'
  | 'Traitement'
  | 'Filet'
  | 'Cuisson'
  | 'Grattage'
  | 'Remplissage'
  | 'Sertissage'
  | 'Marquage'
  | 'Stérilisation'
  | 'Emballage';

export const ZONES: Zone[] = [
  'Réception',
  'Chambre positive',
  'Traitement',
  'Filet',
  'Cuisson',
  'Grattage',
  'Remplissage',
  'Sertissage',
  'Marquage',
  'Stérilisation',
  'Emballage',
];

/** Destination de la matière après la coupe (section 5). */
export type Destination = 'Somerage/Mise en boîte' | 'Grattage' | 'Filet';

export const DESTINATIONS: Destination[] = [
  'Somerage/Mise en boîte',
  'Grattage',
  'Filet',
];

export type EtatMachine = 'Disponible' | 'En production' | 'À l’arrêt' | 'Maintenance';

export const ETATS_MACHINE: EtatMachine[] = [
  'Disponible',
  'En production',
  'À l’arrêt',
  'Maintenance',
];

export type MotifArret =
  | 'Panne machine'
  | 'Réglage'
  | 'Manque matière'
  | 'Manque emballage'
  | 'Manque personnel'
  | 'Nettoyage'
  | 'Changement produit'
  | 'Problème qualité'
  | 'Attente cuisson'
  | 'Attente sertissage'
  | 'Attente stérilisation'
  | 'Maintenance'
  | 'Autre';

export const MOTIFS_ARRET: MotifArret[] = [
  'Panne machine',
  'Réglage',
  'Manque matière',
  'Manque emballage',
  'Manque personnel',
  'Nettoyage',
  'Changement produit',
  'Problème qualité',
  'Attente cuisson',
  'Attente sertissage',
  'Attente stérilisation',
  'Maintenance',
  'Autre',
];

/** Catégorie d'arrêt — permet d'agréger les causes au dashboard. */
export type CategorieArret = 'Technique' | 'Organisationnel' | 'Qualité' | 'Planifié';

export const CATEGORIES_ARRET: CategorieArret[] = [
  'Technique',
  'Organisationnel',
  'Qualité',
  'Planifié',
];

/** Catégorie par défaut associée à chaque motif standard. */
export const CATEGORIE_PAR_MOTIF: Record<MotifArret, CategorieArret> = {
  'Panne machine': 'Technique',
  'Réglage': 'Technique',
  'Manque matière': 'Organisationnel',
  'Manque emballage': 'Organisationnel',
  'Manque personnel': 'Organisationnel',
  'Nettoyage': 'Planifié',
  'Changement produit': 'Planifié',
  'Problème qualité': 'Qualité',
  'Attente cuisson': 'Organisationnel',
  'Attente sertissage': 'Organisationnel',
  'Attente stérilisation': 'Organisationnel',
  'Maintenance': 'Planifié',
  'Autre': 'Organisationnel',
};

export type TypeLiquide = 'Huile' | 'Sauce' | 'Eau';

export const TYPES_LIQUIDE: TypeLiquide[] = ['Huile', 'Sauce', 'Eau'];

/* ------------------------------------------------------------------ */
/* Référentiels                                                        */
/* ------------------------------------------------------------------ */

/** products */
export interface Product {
  id: ID;
  code: string;
  nom: string;
  espece: string;
  formatBoite?: string;
  poidsCibleG?: number;
  boitesParCarton?: number;
  cartonsParPalette?: number;
}

/** lines — lignes de traitement et de grattage */
export interface Line {
  id: ID;
  nom: string;
  zone: Zone;
  active: boolean;
}

/** machines — machines filet, sertisseuses, marqueuses, autoclaves... */
export interface Machine {
  id: ID;
  nom: string;
  zone: Zone;
  etat: EtatMachine;
  actif: boolean;
}

/** employees — opérateurs et opératrices */
export interface Employee {
  id: ID;
  matricule: string;
  nom: string;
  poste?: string;
  equipe?: Equipe;
  actif: boolean;
}

/** recipes — dosage liquide théorique par produit */
export interface Recipe {
  id: ID;
  productId: ID;
  typeLiquide: TypeLiquide;
  reference: string;
  /** Dosage théorique par boîte. */
  dosageTheorique: number;
  unite: 'ml' | 'g';
}

/* ------------------------------------------------------------------ */
/* Lot — clé de traçabilité                                            */
/* ------------------------------------------------------------------ */

export type StatutLot = 'Ouvert' | 'En production' | 'Clôturé';

/** lots */
export interface Lot {
  id: ID;
  /** Identifiant métier, ex: LOT-2026-08-001 */
  code: string;
  date: DateISO;
  espece: string;
  productId?: ID;
  equipe?: Equipe;
  statut: StatutLot;
  observations?: string;
}

/* ------------------------------------------------------------------ */
/* Champs communs aux opérations                                       */
/* ------------------------------------------------------------------ */

/**
 * Socle commun: toute opération est tracée par lot, plage horaire et
 * ressource. Les durées ne sont jamais saisies — elles sont calculées.
 */
export interface OperationBase {
  id: ID;
  lotId: ID;
  productId?: ID;
  date: DateISO;
  equipe?: Equipe;
  heureDebut: DateTimeISO;
  heureFin?: DateTimeISO;
  operateurId?: ID;
  observations?: string;
}

/* ------------------------------------------------------------------ */
/* 3. Réception camion                                                 */
/* ------------------------------------------------------------------ */

/** receptions */
export interface Reception {
  id: ID;
  numero: string;
  lotId: ID;
  date: DateISO;
  heureArrivee: DateTimeISO;
  camion: string;
  fournisseur: string;
  espece: string;
  /** Quantité annoncée / pesée brute (kg). */
  quantiteRecue: number;
  /** Tare ou quantité non matière déduite (kg). */
  tare?: number;
  temperature?: number;
  quantiteAcceptee: number;
  quantiteRefusee: number;
  chambreDestination: string;
  operateurId?: ID;
  observations?: string;
}

/* ------------------------------------------------------------------ */
/* 4. Chambre positive — mouvements de stock                           */
/* ------------------------------------------------------------------ */

export type SensMouvement = 'ENTREE' | 'SORTIE';

/** stock_movements */
export interface StockMovement {
  id: ID;
  lotId: ID;
  productId?: ID;
  espece: string;
  chambre: string;
  sens: SensMouvement;
  quantite: number;
  date: DateISO;
  heure: DateTimeISO;
  /** Origine (réception) ou destination (ligne de traitement, machine filet). */
  reference?: string;
  destination?: Destination;
  operateurId?: ID;
  observations?: string;
}

/* ------------------------------------------------------------------ */
/* 5. Zone Traitement                                                  */
/* ------------------------------------------------------------------ */

/** treatment_operations */
export interface TreatmentOperation extends OperationBase {
  lineId: ID;
  destination: Destination;
  quantiteEntree: number;
  quantiteSortie: number;
  /** Pertes déclarées (déchets, têtes, viscères...). */
  pertes: number;
  nbPersonnel?: number;
}

/* ------------------------------------------------------------------ */
/* 6. Machines Filet                                                   */
/* ------------------------------------------------------------------ */

/** filet_operations */
export interface FiletOperation extends OperationBase {
  machineId: ID;
  quantiteEntree: number;
  quantiteSortie: number;
  pertes: number;
  nbPersonnel?: number;
}

/* ------------------------------------------------------------------ */
/* 7. Mise en grille et cuisson                                        */
/* ------------------------------------------------------------------ */

/** cuisson_operations */
export interface CuissonOperation extends OperationBase {
  machineId?: ID;
  nombreGrilles: number;
  quantiteEntree: number;
  quantiteSortie: number;
  /** Paramètres du cycle (température °C / durée consigne). */
  temperature?: number;
  dureeConsigneMin?: number;
  /** Perte à l'égouttage, incluse dans le rendement. */
  pertes: number;
  nbPersonnel?: number;
}

/* ------------------------------------------------------------------ */
/* 8-9. Zone Grattage + suivi individuel                               */
/* ------------------------------------------------------------------ */

/** Production individuelle d'une opératrice sur une session de grattage. */
export interface OperatriceProduction {
  employeeId: ID;
  heureDebut?: DateTimeISO;
  heureFin?: DateTimeISO;
  nombreBoites: number;
}

/** grattage_operations */
export interface GrattageOperation extends OperationBase {
  lineId: ID;
  quantiteEntree: number;
  nombreBoites: number;
  /** Poids moyen visé par boîte (g) — sert au calcul matière consommée. */
  poidsMoyenG?: number;
  quantiteRejetee: number;
  operatrices: OperatriceProduction[];
}

/* ------------------------------------------------------------------ */
/* 10. Remplissage                                                     */
/* ------------------------------------------------------------------ */

/** filling_operations */
export interface FillingOperation extends OperationBase {
  lineId: ID;
  nombreBoites: number;
  poidsCibleG: number;
  poidsReelMoyenG: number;
  poidsMinG?: number;
  poidsMaxG?: number;
  boitesSousPoids: number;
  boitesSurPoids: number;
  rebut: number;
  /** Matière consommée réellement (kg). */
  quantiteMatiereConsommee: number;
  nbPersonnel?: number;
}

/* ------------------------------------------------------------------ */
/* 11. Huile / Sauce / Eau                                             */
/* ------------------------------------------------------------------ */

/** liquid_consumptions */
export interface LiquidConsumption {
  id: ID;
  lotId: ID;
  productId?: ID;
  recipeId?: ID;
  date: DateISO;
  lineId?: ID;
  typeLiquide: TypeLiquide;
  reference?: string;
  nombreBoites: number;
  /** Dosage théorique par boîte (ml ou g). */
  dosageTheorique: number;
  unite: 'ml' | 'g';
  /** Quantité réellement consommée, exprimée en L ou kg. */
  quantiteReelle: number;
  observations?: string;
}

/* ------------------------------------------------------------------ */
/* 12. Sertissage                                                      */
/* ------------------------------------------------------------------ */

/** sertissage_operations */
export interface SertissageOperation extends OperationBase {
  machineId: ID;
  boitesAvant: number;
  boitesApres: number;
  boitesConformes: number;
  boitesNonConformes: number;
  rebut: number;
  reglages?: string;
}

/* ------------------------------------------------------------------ */
/* 13. Marquage                                                        */
/* ------------------------------------------------------------------ */

/** marquage_operations */
export interface MarquageOperation extends OperationBase {
  machineId?: ID;
  codeMarquage: string;
  dateProduction: DateISO;
  /** DLC/DDM calculée selon la spécification produit. */
  dateReglementaire?: DateISO;
  nombreBoites: number;
  erreursMarquage: number;
  rebut: number;
}

/* ------------------------------------------------------------------ */
/* 14. Stérilisation                                                   */
/* ------------------------------------------------------------------ */

export type ResultatCycle = 'Conforme' | 'Non conforme' | 'En cours';

/** sterilisation_cycles */
export interface SterilisationCycle extends OperationBase {
  numeroCycle: string;
  autoclaveId: ID;
  nombreBoites: number;
  temperature?: number;
  pression?: number;
  valeurSterilisatrice?: number;
  resultat: ResultatCycle;
  nonConformites?: string;
  rejets: number;
}

/* ------------------------------------------------------------------ */
/* 15. Emballage                                                       */
/* ------------------------------------------------------------------ */

/** packaging_operations */
export interface PackagingOperation extends OperationBase {
  lineId?: ID;
  nombreBoites: number;
  boitesParCarton: number;
  cartonsParPalette: number;
  nombreCartons: number;
  nombrePalettes: number;
  rebut: number;
  nbPersonnel?: number;
}

/* ------------------------------------------------------------------ */
/* 16. Arrêts                                                          */
/* ------------------------------------------------------------------ */

/** stops */
export interface Stop {
  id: ID;
  zone: Zone;
  lineId?: ID;
  machineId?: ID;
  lotId?: ID;
  productId?: ID;
  date: DateISO;
  heureDebut: DateTimeISO;
  heureFin?: DateTimeISO;
  motif: MotifArret;
  categorie: CategorieArret;
  commentaire?: string;
  actionCorrective?: string;
}

/* ------------------------------------------------------------------ */
/* Contrôles qualité                                                   */
/* ------------------------------------------------------------------ */

export type ResultatControle = 'Conforme' | 'Non conforme';

/** quality_controls */
export interface QualityControl {
  id: ID;
  lotId: ID;
  productId?: ID;
  zone: Zone;
  date: DateISO;
  heure: DateTimeISO;
  type: string;
  valeur?: number;
  unite?: string;
  resultat: ResultatControle;
  controleurId?: ID;
  observations?: string;
}

/* ------------------------------------------------------------------ */
/* Base de données applicative                                         */
/* ------------------------------------------------------------------ */

export interface Database {
  products: Product[];
  lines: Line[];
  machines: Machine[];
  employees: Employee[];
  recipes: Recipe[];
  lots: Lot[];
  receptions: Reception[];
  stockMovements: StockMovement[];
  treatmentOperations: TreatmentOperation[];
  filetOperations: FiletOperation[];
  cuissonOperations: CuissonOperation[];
  grattageOperations: GrattageOperation[];
  fillingOperations: FillingOperation[];
  liquidConsumptions: LiquidConsumption[];
  sertissageOperations: SertissageOperation[];
  marquageOperations: MarquageOperation[];
  sterilisationCycles: SterilisationCycle[];
  packagingOperations: PackagingOperation[];
  stops: Stop[];
  qualityControls: QualityControl[];
}

export type TableName = keyof Database;

export const EMPTY_DB: Database = {
  products: [],
  lines: [],
  machines: [],
  employees: [],
  recipes: [],
  lots: [],
  receptions: [],
  stockMovements: [],
  treatmentOperations: [],
  filetOperations: [],
  cuissonOperations: [],
  grattageOperations: [],
  fillingOperations: [],
  liquidConsumptions: [],
  sertissageOperations: [],
  marquageOperations: [],
  sterilisationCycles: [],
  packagingOperations: [],
  stops: [],
  qualityControls: [],
};
