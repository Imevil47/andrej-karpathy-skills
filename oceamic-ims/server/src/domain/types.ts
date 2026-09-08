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
  'PRODUCTION',
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

// --- Phase 2: production -------------------------------------------------

export const RUN_STATUSES = ['PLANIFIE', 'EN_COURS', 'SUSPENDU', 'TERMINE', 'ANNULE'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_LINE_ACTIVITIES = [
  'GRATTAGE',
  'REMPLISSAGE',
  'GRATTAGE_REMPLISSAGE',
  'TRAITEMENT',
  'INACTIVE',
  'AUTRE',
] as const;
export type RunLineActivity = (typeof RUN_LINE_ACTIVITIES)[number];

// Every material disposition of a run. The unexplained difference is not part
// of this list: it is calculated, never declared.
export const OUTPUT_TYPES = [
  'SORTIE_UTILE',
  'SOUS_PRODUIT',
  'REWORK',
  'RECLASSEMENT',
  'PERTE_REELLE',
  'AUTRE',
] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

// Categories that carry a reason and are declared on the "Déclarer une perte"
// screen. They are stored in the same ledger as the useful output.
export const LOSS_OUTPUT_TYPES = [
  'PERTE_REELLE',
  'SOUS_PRODUIT',
  'REWORK',
  'RECLASSEMENT',
] as const;
export type LossOutputType = (typeof LOSS_OUTPUT_TYPES)[number];

// Only the useful output counts towards material yield.
export const YIELD_OUTPUT_TYPES: readonly OutputType[] = ['SORTIE_UTILE'];

export const RECORD_STATUSES = ['VALIDE', 'ANNULE'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const BALANCE_STATUSES = ['EQUILIBRE', 'A_CONTROLER', 'ECART_A_JUSTIFIER'] as const;
export type BalanceStatus = (typeof BALANCE_STATUSES)[number];

/** A run whose material difference is beyond tolerance must be justified. */
export function requiresDifferenceJustification(balanceStatus: BalanceStatus): boolean {
  return balanceStatus === 'ECART_A_JUSTIFIER';
}

/** Statuses in which a run still accepts consumption, outputs and losses. */
export const RUN_STATUSES_ACCEPTING_ENTRIES: readonly RunStatus[] = [
  'PLANIFIE',
  'EN_COURS',
  'SUSPENDU',
];

export function runAcceptsEntries(status: RunStatus): boolean {
  return RUN_STATUSES_ACCEPTING_ENTRIES.includes(status);
}
