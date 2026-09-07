// Shared operational vocabulary of Phase 1. The database enforces the same
// values through CHECK constraints.

export const ROLE_CODES = ['ADMIN', 'QUALITE', 'STOCK', 'PRODUCTION', 'LECTURE'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const STOCK_TYPES = ['INTERNE', 'EXTERNE'] as const;
export type StockType = (typeof STOCK_TYPES)[number];

export const LOCATION_TYPES = ['USINE', 'ENTREPOT', 'SOUS_TRAITANT', 'ZONE_TRANSIT', 'AUTRE'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const LOT_STATUSES = ['ACTIF', 'BLOQUE', 'EPUISE', 'FRACTIONNE', 'CLOTURE'] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const RECEPTION_TYPES = [
  'FOURNISSEUR',
  'RETOUR_SOUS_TRAITANCE',
  'TRANSFERT_ENTRANT',
  'RETOUR_PRODUCTION',
  'AUTRE',
] as const;
export type ReceptionType = (typeof RECEPTION_TYPES)[number];

export const MOVEMENT_TYPES = [
  'RECEPTION',
  'TRANSFERT',
  'CONSOMMATION',
  'SOUS_TRAITANCE',
  'RETOUR',
  'PERTE',
  'AJUSTEMENT',
  'FRACTIONNEMENT',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const REFERENCE_TYPES = [
  'RECEPTION',
  'TRANSFERT',
  'SOUS_TRAITANCE',
  'SOUS_TRAITANCE_RESULTAT',
  'PERTE',
  'AJUSTEMENT',
  'FRACTIONNEMENT',
  'ANNULATION',
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export const SUBCONTRACTING_SOURCE_TYPES = ['FOURNISSEUR', 'STOCK_EXISTANT'] as const;
export type SubcontractingSourceType = (typeof SUBCONTRACTING_SOURCE_TYPES)[number];

export const SUBCONTRACTING_STATUSES = ['EN_COURS', 'CLOTURE', 'ANNULE'] as const;
export type SubcontractingStatus = (typeof SUBCONTRACTING_STATUSES)[number];

export const SUBCONTRACTING_RESULT_TYPES = ['PRODUIT', 'PERTE'] as const;
export type SubcontractingResultType = (typeof SUBCONTRACTING_RESULT_TYPES)[number];

export const INSPECTION_TYPES = ['RECEPTION', 'STOCKAGE', 'SOUS_TRAITANCE', 'RECONTROLE', 'AUTRE'] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const PROCESS_STAGES = ['RECEPTION', 'STOCKAGE', 'SOUS_TRAITANCE', 'AUTRE'] as const;
export type ProcessStage = (typeof PROCESS_STAGES)[number];

export const INSPECTION_RESULTS = ['CONFORME', 'NON_CONFORME', 'A_SURVEILLER'] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const DECISION_TYPES = [
  'ACCEPTE',
  'ACCEPTE_SOUS_RESERVE',
  'BLOQUE',
  'REJETE',
  'RECONTROLE_REQUIS',
  'LIBERE',
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const BLOCK_STATUSES = ['ACTIF', 'LEVE', 'ANNULE'] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];

// Operations forbidden while the quality department holds an active block on a
// lot (specification section 29). A transfer between controlled storage
// locations stays allowed: blocked material must remain physically movable.
export const OPERATIONS_BLOCKED_BY_QUALITY: readonly MovementType[] = [
  'CONSOMMATION',
  'SOUS_TRAITANCE',
];

export function isBlockedByQuality(movementType: MovementType): boolean {
  return OPERATIONS_BLOCKED_BY_QUALITY.includes(movementType);
}
