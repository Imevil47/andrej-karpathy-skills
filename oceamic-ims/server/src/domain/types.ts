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

// --- Phase 3: workforce cadence -------------------------------------------

export const CONTROL_ROUND_STATUSES = ['EN_COURS', 'TERMINE', 'ANNULE'] as const;
export type ControlRoundStatus = (typeof CONTROL_ROUND_STATUSES)[number];

export const LINE_CONTROL_STATUSES = ['EN_COURS', 'TERMINE'] as const;
export type LineControlStatus = (typeof LINE_CONTROL_STATUSES)[number];

export const MEASUREMENT_UNITS = ['BOITES', 'PIECES', 'KG', 'UNITES'] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

// Standards and cadence controls apply to a real, active labor activity: a
// line marked INACTIVE for a Run can never carry a standard or a control.
export const CADENCE_ACTIVITIES = [
  'GRATTAGE',
  'REMPLISSAGE',
  'GRATTAGE_REMPLISSAGE',
  'TRAITEMENT',
  'AUTRE',
] as const;
export type CadenceActivity = (typeof CADENCE_ACTIVITIES)[number];

export const COVERAGE_STATUSES = ['COMPLET', 'INCOMPLET'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

// Performance thresholds, centralised here so no UI component invents its own
// red/green cutoff (section 19). A run with no matched standard shows
// "Standard non défini" and never falls into any of these buckets.
export const PERFORMANCE_STATUSES = ['CONFORME', 'A_SURVEILLER', 'SOUS_STANDARD'] as const;
export type PerformanceStatus = (typeof PERFORMANCE_STATUSES)[number];

const PERFORMANCE_CONFORME_THRESHOLD = 95;
const PERFORMANCE_SURVEILLANCE_THRESHOLD = 85;

export function performanceStatus(performancePercent: number | null): PerformanceStatus | null {
  if (performancePercent === null) {
    return null;
  }
  if (performancePercent >= PERFORMANCE_CONFORME_THRESHOLD) {
    return 'CONFORME';
  }
  if (performancePercent >= PERFORMANCE_SURVEILLANCE_THRESHOLD) {
    return 'A_SURVEILLER';
  }
  return 'SOUS_STANDARD';
}

// --- Phase 4: filling, seaming, marking, sterilization, CCP, cooling -------

export const EQUIPMENT_TYPES = ['SERTISSEUSE', 'AUTOCLAVE', 'REMPLISSEUSE', 'AUTRE'] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const FILLING_OPERATION_STATUSES = ['PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE'] as const;
export type FillingOperationStatus = (typeof FILLING_OPERATION_STATUSES)[number];

// A sample's classification (section 12): always derived from the measured
// weight against the limits in force at the time, never chosen by the
// controller. UNDERWEIGHT is the operationally critical case (section 15).
export const WEIGHT_SAMPLE_STATUSES = ['SOUS_POIDS', 'CONFORME', 'SURPOIDS'] as const;
export type WeightSampleStatus = (typeof WEIGHT_SAMPLE_STATUSES)[number];

export const WEIGHT_CONTROL_STATUSES = ['CONFORME', 'A_CORRIGER', 'NON_CONFORME', 'INCOMPLET'] as const;
export type WeightControlStatus = (typeof WEIGHT_CONTROL_STATUSES)[number];

export const SEAMING_OPERATION_STATUSES = ['PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE'] as const;
export type SeamingOperationStatus = (typeof SEAMING_OPERATION_STATUSES)[number];

export const SEAMING_CONTROL_RESULTS = ['CONFORME', 'NON_CONFORME', 'INCOMPLET'] as const;
export type SeamingControlResult = (typeof SEAMING_CONTROL_RESULTS)[number];

export const MARKING_STATUSES = ['A_VERIFIER', 'VERIFIE', 'NON_CONFORME'] as const;
export type MarkingStatus = (typeof MARKING_STATUSES)[number];

export const STERILIZATION_CYCLE_STATUSES = [
  'PLANIFIE',
  'EN_CHARGEMENT',
  'EN_COURS',
  'TERMINE',
  'A_VERIFIER',
  'BLOQUE',
  'ANNULE',
] as const;
export type SterilizationCycleStatus = (typeof STERILIZATION_CYCLE_STATUSES)[number];

// Statuses in which a cycle still accepts loads, measurements and CCP data.
export const STERILIZATION_STATUSES_ACCEPTING_ENTRIES: readonly SterilizationCycleStatus[] = [
  'PLANIFIE',
  'EN_CHARGEMENT',
  'EN_COURS',
  'A_VERIFIER',
];

export function sterilizationCycleAcceptsEntries(status: SterilizationCycleStatus): boolean {
  return STERILIZATION_STATUSES_ACCEPTING_ENTRIES.includes(status);
}

// A measurement is either typed in by hand or, in the future, produced by
// connected equipment. Never pretend one is the other (section 52).
export const MEASUREMENT_SOURCE_TYPES = ['MANUEL', 'EQUIPEMENT', 'IMPORT'] as const;
export type MeasurementSourceType = (typeof MEASUREMENT_SOURCE_TYPES)[number];

export const CCP_RESULTS = ['CONFORME', 'NON_CONFORME', 'DEVIATION', 'A_VERIFIER'] as const;
export type CcpResult = (typeof CCP_RESULTS)[number];

export const CCP_DECISIONS = ['LIBERE', 'RETENU', 'A_VERIFIER'] as const;
export type CcpDecision = (typeof CCP_DECISIONS)[number];

export const DEVIATION_SEVERITIES = ['MINEURE', 'MAJEURE', 'CRITIQUE'] as const;
export type DeviationSeverity = (typeof DEVIATION_SEVERITIES)[number];

export const DEVIATION_STATUSES = [
  'OUVERTE',
  'EN_ANALYSE',
  'ACTION_REQUISE',
  'CLOTUREE',
  'ANNULEE',
] as const;
export type DeviationStatus = (typeof DEVIATION_STATUSES)[number];

export const CORRECTIVE_ACTION_STATUSES = ['OUVERTE', 'EN_COURS', 'TERMINEE', 'ANNULEE'] as const;
export type CorrectiveActionStatus = (typeof CORRECTIVE_ACTION_STATUSES)[number];

export const COOLING_RESULTS = ['CONFORME', 'NON_CONFORME', 'A_VERIFIER'] as const;
export type CoolingResult = (typeof COOLING_RESULTS)[number];

export const RUN_HOLD_STATUSES = ['ACTIF', 'LEVE'] as const;
export type RunHoldStatus = (typeof RUN_HOLD_STATUSES)[number];
