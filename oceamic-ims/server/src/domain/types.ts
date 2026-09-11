// Shared operational vocabulary of Phase 1. The database enforces the same
// values through CHECK constraints.

// Phase 6 adds RESPONSABLE_QUALITE (approves root cause / CAPA closure /
// document approval, releases critical blocks, initiates recalls) and
// AUDITEUR (conducts assigned audits, records findings) - see section 53.
// Phase 7 adds MAINTENANCE (works failures, work orders, interventions,
// preventive tasks, spare-part consumption) and RESPONSABLE_MAINTENANCE
// (additionally configures preventive plans, closes important work orders,
// manages equipment master data, authorizes stock adjustments) - see
// permissions.ts for the exact split.
export const ROLE_CODES = [
  'ADMIN',
  'QUALITE',
  'STOCK',
  'PRODUCTION',
  'LECTURE',
  'RESPONSABLE_QUALITE',
  'AUDITEUR',
  'MAINTENANCE',
  'RESPONSABLE_MAINTENANCE',
] as const;
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

// Phase 7 widens this list (section 7): a configurable vocabulary, never
// hardcoded per-type behaviour anywhere in the app.
export const EQUIPMENT_TYPES = [
  'SERTISSEUSE',
  'AUTOCLAVE',
  'REMPLISSEUSE',
  'CONVOYEUR',
  'POMPE',
  'COMPRESSEUR',
  'CHAUDIERE',
  'CHAMBRE_FROIDE',
  'BALANCE',
  'DETECTEUR',
  'MACHINE_TRAITEMENT',
  'AUTRE',
] as const;
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

// --- Phase 5: packaging, finished goods, pallets, PF stock, shipments ------

// Which stock a location is meant to hold (section 14). Existing Phase 1
// locations default to 'MP' at the schema level, preserving their current
// meaning exactly; nothing about raw-material stock changes.
export const LOCATION_STOCK_DOMAINS = ['MP', 'PF', 'MIXTE'] as const;
export type LocationStockDomain = (typeof LOCATION_STOCK_DOMAINS)[number];

export const PACKAGING_BATCH_STATUSES = ['PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE'] as const;
export type PackagingBatchStatus = (typeof PACKAGING_BATCH_STATUSES)[number];

// Shared by finished_good_lots.quality_status and pallets.quality_status
// (section 19): never automatically LIBERE just because packaging or
// palletizing completed. Kept fully separate from operational status - a
// pallet can be EN_STOCK and BLOQUE at the same time.
export const FG_QUALITY_STATUSES = ['BLOQUE', 'A_VERIFIER', 'LIBERE', 'REJETE'] as const;
export type FgQualityStatus = (typeof FG_QUALITY_STATUSES)[number];

export const PALLET_STATUSES = [
  'EN_PREPARATION',
  'TERMINEE',
  'EN_STOCK',
  'RESERVEE',
  'EXPEDIEE',
  'ANNULEE',
] as const;
export type PalletStatus = (typeof PALLET_STATUSES)[number];

// RESERVATION / LIBERATION_RESERVATION are deliberately absent: a reservation
// never changes a physical location, so it is never a stock movement
// (section 16's own principle, applied consistently).
export const FG_MOVEMENT_TYPES = [
  'ENTREE_PRODUCTION',
  'TRANSFERT',
  'EXPEDITION',
  'RETOUR',
  'AJUSTEMENT',
  'BLOCAGE_LOGISTIQUE',
] as const;
export type FgMovementType = (typeof FG_MOVEMENT_TYPES)[number];

export const FG_REFERENCE_TYPES = [
  'PACKAGING',
  'TRANSFERT',
  'EXPEDITION',
  'RETOUR',
  'AJUSTEMENT',
  'BLOCAGE_LOGISTIQUE',
  'ANNULATION',
] as const;
export type FgReferenceType = (typeof FG_REFERENCE_TYPES)[number];

// Polymorphic quality decisions/blocks (section 20): one shared mechanism for
// the two new Phase 5 entity types, instead of duplicating Phase 1's
// quality_decisions/lot_blocks logic a second and third time.
export const FG_ENTITY_TYPES = ['FINISHED_GOOD_LOT', 'PALLET'] as const;
export type FgEntityType = (typeof FG_ENTITY_TYPES)[number];

export const FG_DECISION_TYPES = ['ACCEPTE', 'BLOQUE', 'REJETE', 'LIBERE'] as const;
export type FgDecisionType = (typeof FG_DECISION_TYPES)[number];

export const SHIPMENT_STATUSES = [
  'PLANIFIEE',
  'EN_PREPARATION',
  'EN_CHARGEMENT',
  'EXPEDIEE',
  'ANNULEE',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

// Statuses in which a shipment still accepts pallets/reservations.
export const SHIPMENT_STATUSES_ACCEPTING_ENTRIES: readonly ShipmentStatus[] = [
  'PLANIFIEE',
  'EN_PREPARATION',
  'EN_CHARGEMENT',
];

export function shipmentAcceptsEntries(status: ShipmentStatus): boolean {
  return SHIPMENT_STATUSES_ACCEPTING_ENTRIES.includes(status);
}

export const RESERVATION_STATUSES = ['ACTIF', 'CONSOMMEE', 'ANNULEE'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const PACKAGING_LABEL_RESULTS = ['CONFORME', 'NON_CONFORME'] as const;
export type PackagingLabelResult = (typeof PACKAGING_LABEL_RESULTS)[number];

// --- Phase 6: horizontal Quality Management System (QMS) --------------------

// Shared severity scale (section 7), reused identically by non-conformities,
// complaints, supplier incidents, audit findings and recall events - one
// vocabulary across the whole QMS rather than a scale per entity.
export const QMS_SEVERITIES = ['MINEURE', 'MAJEURE', 'CRITIQUE'] as const;
export type QmsSeverity = (typeof QMS_SEVERITIES)[number];

export const QMS_PRIORITIES = ['BASSE', 'NORMALE', 'HAUTE', 'URGENTE'] as const;
export type QmsPriority = (typeof QMS_PRIORITIES)[number];

export const NONCONFORMITY_STATUSES = [
  'OUVERTE',
  'EN_ANALYSE',
  'ACTION_REQUISE',
  'EN_ATTENTE',
  'A_VERIFIER',
  'CLOTUREE',
  'ANNULEE',
] as const;
export type NonconformityStatus = (typeof NONCONFORMITY_STATUSES)[number];

// Every open (non-final) NCR status - used both for "open" dashboard counts
// and to gate a new active quality block from being opened twice.
export const NONCONFORMITY_OPEN_STATUSES: readonly NonconformityStatus[] = [
  'OUVERTE',
  'EN_ANALYSE',
  'ACTION_REQUISE',
  'EN_ATTENTE',
  'A_VERIFIER',
];

/**
 * Allowed next statuses for a non-conformity, keyed by current status
 * (section 4/57-style discipline extended to the workflow itself): a fresh
 * OUVERTE record can never jump straight to CLOTUREE, and CLOTUREE is only
 * reachable from A_VERIFIER, so closing always passes through a
 * verification step. Enforced server-side in `updateNonconformityStatus`,
 * never only a UI convention - the same list also drives which transitions
 * the screen offers.
 */
export const NONCONFORMITY_ALLOWED_TRANSITIONS: Readonly<Record<NonconformityStatus, readonly NonconformityStatus[]>> = {
  OUVERTE: ['EN_ANALYSE', 'ANNULEE'],
  EN_ANALYSE: ['ACTION_REQUISE', 'EN_ATTENTE', 'ANNULEE'],
  ACTION_REQUISE: ['EN_ATTENTE', 'A_VERIFIER', 'ANNULEE'],
  EN_ATTENTE: ['ACTION_REQUISE', 'A_VERIFIER', 'ANNULEE'],
  A_VERIFIER: ['ACTION_REQUISE', 'CLOTUREE', 'ANNULEE'],
  CLOTUREE: [],
  ANNULEE: [],
};

/** The single most logical next step from a given status, shown as the
 * primary action; every other allowed transition stays reachable through a
 * secondary "Changer le statut" control (section 7.1). */
export const NONCONFORMITY_PRIMARY_NEXT_STATUS: Readonly<Partial<Record<NonconformityStatus, NonconformityStatus>>> = {
  OUVERTE: 'EN_ANALYSE',
  EN_ANALYSE: 'ACTION_REQUISE',
  ACTION_REQUISE: 'A_VERIFIER',
  EN_ATTENTE: 'ACTION_REQUISE',
  A_VERIFIER: 'CLOTUREE',
};

// Polymorphic linking (section 5): entity_type spans every module an NCR,
// complaint, recall or audit finding can point back to - validated in the
// service layer, never a real foreign key (the same reasoning as
// finished_goods_quality_blocks in Phase 5).
export const QMS_ENTITY_TYPES = [
  'RAW_MATERIAL_LOT',
  'RECEPTION',
  'PRODUCTION_RUN',
  'FILLING_OPERATION',
  'FILLING_WEIGHT_CONTROL',
  'SEAMING_OPERATION',
  'SEAMING_CONTROL',
  'MARKING_EVENT',
  'STERILIZATION_CYCLE',
  'CCP_CONTROL',
  'PROCESS_DEVIATION',
  'DOWNTIME_EVENT',
  'SUBCONTRACTING_OPERATION',
  'FINISHED_GOOD_LOT',
  'PALLET',
  'SHIPMENT',
  'SUPPLIER',
  'CUSTOMER',
  'EQUIPMENT',
  'AUDIT',
  'AUDIT_FINDING',
  'CUSTOMER_COMPLAINT',
  'SUPPLIER_QUALITY_INCIDENT',
  // Phase 7: a non-conformity can point back at the failure/work order that
  // caused or investigated it (section 63's seaming-defect scenario),
  // reusing this same polymorphic mechanism rather than a new one.
  'FAILURE_REPORT',
  'MAINTENANCE_WORK_ORDER',
  // Phase 8 (section 54): an ingredient lot incident (contamination,
  // certificate mismatch...) can raise an NCR/quality block the same way
  // any other lot does, reusing this mechanism rather than a parallel one.
  'INGREDIENT_LOT',
] as const;
export type QmsEntityType = (typeof QMS_ENTITY_TYPES)[number];

export const NONCONFORMITY_LINK_RELATIONSHIPS = [
  'SOURCE',
  'AFFECTE',
  'DETECTE_SUR',
  'CONSEQUENCE',
] as const;
export type NonconformityLinkRelationship = (typeof NONCONFORMITY_LINK_RELATIONSHIPS)[number];

// Entity types a non-conformity is allowed to open a quality block against
// (section 9): reuses Phase 1's lot_blocks for raw material, Phase 5's
// finished_goods_quality_blocks for finished goods and pallets - never a
// third, independent block system.
export const QMS_BLOCKABLE_ENTITY_TYPES = ['RAW_MATERIAL_LOT', 'FINISHED_GOOD_LOT', 'PALLET'] as const;
export type QmsBlockableEntityType = (typeof QMS_BLOCKABLE_ENTITY_TYPES)[number];

export const ROOT_CAUSE_METHODS = ['5_POURQUOI', 'ISHIKAWA', 'PARETO', 'ANALYSE_SIMPLE', 'AUTRE'] as const;
export type RootCauseMethod = (typeof ROOT_CAUSE_METHODS)[number];

export const CAPA_TYPES = ['CORRECTIVE', 'PREVENTIVE', 'CORRECTIVE_PREVENTIVE'] as const;
export type CapaType = (typeof CAPA_TYPES)[number];

export const CAPA_STATUSES = ['OUVERTE', 'EN_COURS', 'EN_VERIFICATION', 'CLOTUREE', 'ANNULEE'] as const;
export type CapaStatus = (typeof CAPA_STATUSES)[number];

export const CAPA_ACTION_TYPES = [
  'CORRECTION',
  'ACTION_CORRECTIVE',
  'ACTION_PREVENTIVE',
  'VERIFICATION',
] as const;
export type CapaActionType = (typeof CAPA_ACTION_TYPES)[number];

export const CAPA_ACTION_STATUSES = ['OUVERTE', 'EN_COURS', 'TERMINEE', 'ANNULEE'] as const;
export type CapaActionStatus = (typeof CAPA_ACTION_STATUSES)[number];

export const CUSTOMER_COMPLAINT_TYPES = [
  'QUALITE',
  'POIDS',
  'SERTISSAGE',
  'BOITE_DEFORMEE',
  'MARQUAGE',
  'ODEUR',
  'GOUT',
  'CORPS_ETRANGER',
  'QUANTITE',
  'DOCUMENTATION',
  'AUTRE',
] as const;
export type CustomerComplaintType = (typeof CUSTOMER_COMPLAINT_TYPES)[number];

export const CUSTOMER_COMPLAINT_STATUSES = [
  'OUVERTE',
  'EN_ANALYSE',
  'ACTION_REQUISE',
  'CLOTUREE',
  'ANNULEE',
] as const;
export type CustomerComplaintStatus = (typeof CUSTOMER_COMPLAINT_STATUSES)[number];

export const SUPPLIER_INCIDENT_STATUSES = ['OUVERTE', 'EN_ANALYSE', 'CLOTUREE', 'ANNULEE'] as const;
export type SupplierIncidentStatus = (typeof SUPPLIER_INCIDENT_STATUSES)[number];

export const AUDIT_TYPES = [
  'INTERNE',
  'CLIENT',
  'CERTIFICATION',
  'AUTORITE',
  'FOURNISSEUR',
  'HYGIENE',
  'PROCESS',
  'AUTRE',
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AUDIT_STATUSES = ['PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_RESPONSE_RESULTS = ['CONFORME', 'NON_CONFORME', 'OBSERVATION', 'NON_APPLICABLE'] as const;
export type AuditResponseResult = (typeof AUDIT_RESPONSE_RESULTS)[number];

export const AUDIT_FINDING_TYPES = ['NON_CONFORMITE', 'OBSERVATION', 'POINT_FORT'] as const;
export type AuditFindingType = (typeof AUDIT_FINDING_TYPES)[number];

export const AUDIT_FINDING_STATUSES = ['OUVERTE', 'ACTION_REQUISE', 'CLOTUREE', 'ANNULEE'] as const;
export type AuditFindingStatus = (typeof AUDIT_FINDING_STATUSES)[number];

export const QUALITY_DOCUMENT_TYPES = [
  'PROCEDURE',
  'INSTRUCTION',
  'FORMULAIRE',
  'PLAN',
  'SPECIFICATION',
  'MANUEL',
  'POLITIQUE',
  'ENREGISTREMENT_MODELE',
  'AUTRE',
] as const;
export type QualityDocumentType = (typeof QUALITY_DOCUMENT_TYPES)[number];

// Shared by quality_documents.status (cached, recomputed) and
// quality_document_revisions.status (section 28): an obsolete revision is
// never exposed as the document's current status.
export const QUALITY_DOCUMENT_STATUSES = [
  'BROUILLON',
  'EN_REVISION',
  'APPROUVE',
  'EN_VIGUEUR',
  'OBSOLETE',
  'ANNULE',
] as const;
export type QualityDocumentStatus = (typeof QUALITY_DOCUMENT_STATUSES)[number];

export const DOCUMENT_ACKNOWLEDGMENT_STATUSES = ['ASSIGNEE', 'ACQUITTEE', 'ANNULEE'] as const;
export type DocumentAcknowledgmentStatus = (typeof DOCUMENT_ACKNOWLEDGMENT_STATUSES)[number];

export const RECALL_EVENT_TYPES = ['EXERCICE_TRACABILITE', 'RETRAIT', 'RAPPEL'] as const;
export type RecallEventType = (typeof RECALL_EVENT_TYPES)[number];

export const RECALL_STATUSES = ['OUVERT', 'EN_COURS', 'CLOTURE', 'ANNULE'] as const;
export type RecallStatus = (typeof RECALL_STATUSES)[number];

// A recall/exercise always starts from one of these two identities (sections
// 33-34): every other affected entity is derived by traceability from here.
export const RECALL_TARGET_ENTITY_TYPES = ['RAW_MATERIAL_LOT', 'FINISHED_GOOD_LOT'] as const;
export type RecallTargetEntityType = (typeof RECALL_TARGET_ENTITY_TYPES)[number];

export const RECALL_AFFECTED_ENTITY_TYPES = [
  'RAW_MATERIAL_LOT',
  'PRODUCTION_RUN',
  'STERILIZATION_CYCLE',
  'FINISHED_GOOD_LOT',
  'PALLET',
  'SHIPMENT',
  'CUSTOMER',
] as const;
export type RecallAffectedEntityType = (typeof RECALL_AFFECTED_ENTITY_TYPES)[number];

export const RECALL_IMPACT_TYPES = ['ORIGINE', 'AFFECTE'] as const;
export type RecallImpactType = (typeof RECALL_IMPACT_TYPES)[number];

export const RECALL_AFFECTED_ENTITY_STATUSES = ['IDENTIFIE', 'EN_TRAITEMENT', 'TRAITE'] as const;
export type RecallAffectedEntityStatus = (typeof RECALL_AFFECTED_ENTITY_STATUSES)[number];

/** An action (CAPA action, audit finding, document acknowledgment...) with a
 * due date is EN_RETARD when it is still open past that date - never a
 * status a user selects (section 44), always this comparison. */
export function isOverdue(dueAt: Date | string | null, isStillOpen: boolean): boolean {
  if (dueAt === null || !isStillOpen) {
    return false;
  }
  return new Date(dueAt).getTime() < Date.now();
}

// --- Phase 7: maintenance / CMMS layer --------------------------------------

// Equipment criticality (section 9): business importance of the ASSET. Kept
// deliberately distinct from equipment status and from failure severity -
// merging any of these would hide real information (a FAIBLE-criticality
// machine can still have a CRITIQUE failure).
export const EQUIPMENT_CRITICALITIES = ['FAIBLE', 'MOYENNE', 'HAUTE', 'CRITIQUE'] as const;
export type EquipmentCriticality = (typeof EQUIPMENT_CRITICALITIES)[number];

// Equipment operational status (section 12): distinct from work-order
// status - an equipment can be EN_PANNE while its work order is still
// OUVERT, or EN_MAINTENANCE while the work order is EN_COURS.
export const EQUIPMENT_STATUSES = [
  'EN_SERVICE',
  'EN_PANNE',
  'EN_MAINTENANCE',
  'HORS_SERVICE',
  'EN_ATTENTE_PIECE',
  'INACTIF',
] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

// Failure severity (section 9): how bad THIS event is, a distinct concept
// from equipment.criticality (how important the asset is).
export const FAILURE_SEVERITIES = ['FAIBLE', 'MOYENNE', 'HAUTE', 'CRITIQUE'] as const;
export type FailureSeverity = (typeof FAILURE_SEVERITIES)[number];

export const FAILURE_REPORT_STATUSES = ['DECLAREE', 'PRISE_EN_CHARGE', 'RESOLUE', 'ANNULEE'] as const;
export type FailureReportStatus = (typeof FAILURE_REPORT_STATUSES)[number];

// A failure's own lifecycle (section 66: FAILURE REPORT is the observed
// event, distinct from the work order that authorizes repairing it) - driven
// by the maintenance workflow itself (services/failures.ts), never a free
// dropdown: reporting a failure is DECLAREE, opening a work order for it is
// PRISE_EN_CHARGE, the work order finishing is RESOLUE.
export const FAILURE_REPORT_ALLOWED_TRANSITIONS: Readonly<
  Record<FailureReportStatus, readonly FailureReportStatus[]>
> = {
  DECLAREE: ['PRISE_EN_CHARGE', 'ANNULEE'],
  PRISE_EN_CHARGE: ['RESOLUE', 'ANNULEE'],
  RESOLUE: [],
  ANNULEE: [],
};

// One table for every work-order type (section 22): configuration, not a
// hardcoded split.
export const WORK_ORDER_TYPES = [
  'CORRECTIVE',
  'PREVENTIVE',
  'INSPECTION',
  'REGLAGE',
  'AMELIORATION',
  'URGENCE',
] as const;
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

export const WORK_ORDER_PRIORITIES = ['BASSE', 'NORMALE', 'HAUTE', 'URGENTE'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const WORK_ORDER_STATUSES = [
  'OUVERT',
  'PLANIFIE',
  'EN_COURS',
  'EN_ATTENTE_PIECE',
  'EN_ATTENTE_PRODUCTION',
  'TERMINE',
  'ANNULE',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_VERIFICATION_RESULTS = ['CONFORME', 'NON_CONFORME'] as const;
export type WorkOrderVerificationResult = (typeof WORK_ORDER_VERIFICATION_RESULTS)[number];

// Work order status workflow (section 21), the same "server validates every
// transition" discipline as NONCONFORMITY_ALLOWED_TRANSITIONS: a work order
// cannot jump straight from OUVERT to TERMINE without ever being worked.
export const WORK_ORDER_ALLOWED_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  OUVERT: ['PLANIFIE', 'EN_COURS', 'ANNULE'],
  PLANIFIE: ['EN_COURS', 'ANNULE'],
  EN_COURS: ['EN_ATTENTE_PIECE', 'EN_ATTENTE_PRODUCTION', 'TERMINE', 'ANNULE'],
  EN_ATTENTE_PIECE: ['EN_COURS', 'ANNULE'],
  EN_ATTENTE_PRODUCTION: ['EN_COURS', 'ANNULE'],
  TERMINE: [],
  ANNULE: [],
};

export const WORK_ORDER_PRIMARY_NEXT_STATUS: Readonly<Partial<Record<WorkOrderStatus, WorkOrderStatus>>> = {
  OUVERT: 'PLANIFIE',
  PLANIFIE: 'EN_COURS',
  EN_COURS: 'TERMINE',
  EN_ATTENTE_PIECE: 'EN_COURS',
  EN_ATTENTE_PRODUCTION: 'EN_COURS',
};

// "Important" work order (section 52's "close important work orders"
// reserved to RESPONSABLE_MAINTENANCE): equipment whose criticality is
// HAUTE/CRITIQUE, or an URGENCE-type work order - closing anything else
// only needs workorder:manage. Centralized here so the route, the service
// gate and any future screen read the exact same rule.
export function workOrderClosureRequiresApproval(
  equipmentCriticality: EquipmentCriticality,
  workOrderType: WorkOrderType,
): boolean {
  return equipmentCriticality === 'HAUTE' || equipmentCriticality === 'CRITIQUE' || workOrderType === 'URGENCE';
}

// Preventive frequency (section 26): OPERATING_HOURS/CUSTOM plans have no
// automatic next-due calculation (no operating-hours meter integration in
// Phase 7 - section 28) and are scheduled manually instead of faking data.
export const PREVENTIVE_FREQUENCY_TYPES = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'OPERATING_HOURS',
  'CUSTOM',
] as const;
export type PreventiveFrequencyType = (typeof PREVENTIVE_FREQUENCY_TYPES)[number];

// Calendar-based frequencies only - the ones that get an automatic
// frequency_interval_days and therefore an automatic next-due date.
export const PREVENTIVE_FREQUENCY_INTERVAL_DAYS: Readonly<Partial<Record<PreventiveFrequencyType, number>>> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
  QUARTERLY: 91,
  SEMIANNUAL: 182,
  ANNUAL: 365,
};

export const PREVENTIVE_TASK_STATUSES = ['PLANIFIEE', 'TERMINEE', 'ANNULEE'] as const;
export type PreventiveTaskStatus = (typeof PREVENTIVE_TASK_STATUSES)[number];

// Spare part stock ledger (section 38): its own movement vocabulary, never
// shared with Phase 1's raw-material MOVEMENT_TYPES.
export const SPARE_PART_MOVEMENT_TYPES = [
  'RECEPTION',
  'SORTIE_INTERVENTION',
  'TRANSFERT',
  'RETOUR',
  'AJUSTEMENT',
] as const;
export type SparePartMovementType = (typeof SPARE_PART_MOVEMENT_TYPES)[number];

// --- Phase 8: ingredients and production consumables ------------------------

// Controlled units (section 7): weight and volume are never assumed
// interchangeable (1 g is never treated as 1 mL) - a lot, a movement and a
// consumption always carry their own unit, compared only against
// quantities already expressed in that same unit.
export const INGREDIENT_UNITS = ['L', 'KG', 'G', 'ML', 'UNITE'] as const;
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];

// Ingredient lot quality status (section 9): its own truth, not a forced
// fit into Phase 1's raw-material lot_blocks (hardwired to
// raw_material_lot_id) or Phase 5's finished_goods_quality_blocks
// (hardwired to Lot PF/pallet) - neither is polymorphic, so this mirrors
// the same "own status column" choice Phase 5 already made for finished
// goods quality.
export const INGREDIENT_QUALITY_STATUSES = ['LIBERE', 'BLOQUE', 'A_VERIFIER', 'REJETE'] as const;
export type IngredientQualityStatus = (typeof INGREDIENT_QUALITY_STATUSES)[number];

// Ingredient stock ledger (section 12). RECUPERATION/REUTILISATION are
// deliberately absent - see 033_ingredient_stock.sql for why recovered
// material is modeled through its own dedicated tables instead.
export const INGREDIENT_MOVEMENT_TYPES = [
  'RECEPTION',
  'TRANSFERT',
  'ALIMENTATION_CUVE',
  'CONSOMMATION',
  'PERTE',
  'AJUSTEMENT',
  'RETOUR',
] as const;
export type IngredientMovementType = (typeof INGREDIENT_MOVEMENT_TYPES)[number];

// A blocked/rejected/under-review ingredient lot may never be moved into a
// tank or consumed by a Run (section 66); PERTE/AJUSTEMENT/RETOUR stay
// available since they are administrative corrections that may need to
// apply even to a blocked lot (e.g. writing it off entirely).
const INGREDIENT_MOVEMENTS_BLOCKED_BY_QUALITY: readonly IngredientMovementType[] = [
  'TRANSFERT',
  'ALIMENTATION_CUVE',
  'CONSOMMATION',
];
export function isIngredientMovementBlockedByQuality(movementType: IngredientMovementType): boolean {
  return INGREDIENT_MOVEMENTS_BLOCKED_BY_QUALITY.includes(movementType);
}

export const TANK_BATCH_STATUSES = ['OUVERT', 'CLOTURE'] as const;
export type TankBatchStatus = (typeof TANK_BATCH_STATUSES)[number];

// Recovered-batch status (section 27): DISPONIBLE/BLOQUE/ELIMINE are the
// only values ever stored (a person's decision); UTILISE_PARTIELLEMENT,
// EPUISE and EXPIRE are always computed (recovered_batch_status view,
// 038_ingredient_views.sql) from remaining quantity and reuse_deadline -
// this const covers every value the *effective* status can take, stored or
// derived, for the type system and the UI's label lookup.
export const RECOVERED_BATCH_STATUSES = [
  'DISPONIBLE',
  'UTILISE_PARTIELLEMENT',
  'EPUISE',
  'EXPIRE',
  'BLOQUE',
  'ELIMINE',
] as const;
export type RecoveredBatchStatus = (typeof RECOVERED_BATCH_STATUSES)[number];

// The subset an operator/QUALITE may actually set on
// recovered_ingredient_batches.status (section 28: nobody can type EXPIRE
// away by hand).
export const RECOVERED_BATCH_MANUAL_STATUSES = ['DISPONIBLE', 'BLOQUE', 'ELIMINE'] as const;
export type RecoveredBatchManualStatus = (typeof RECOVERED_BATCH_MANUAL_STATUSES)[number];

export const PROCESS_UTILITY_TYPES = ['EAU', 'VAPEUR', 'AUTRE'] as const;
export type ProcessUtilityType = (typeof PROCESS_UTILITY_TYPES)[number];

// Actual vs. standard comparison (section 41): overconsumption is never
// automatically treated as a food-safety non-conformity, only flagged as an
// efficiency signal.
export const STANDARD_COMPARISON_STATUSES = [
  'CONFORME',
  'A_SURVEILLER',
  'HORS_STANDARD',
  'STANDARD_NON_DEFINI',
] as const;
export type StandardComparisonStatus = (typeof STANDARD_COMPARISON_STATUSES)[number];

/**
 * Consumption per 1 000 cans (section 17): quantity / cans * 1000, computed
 * wherever it is shown, never typed by hand. Returns null when no cans have
 * been produced yet rather than dividing by zero.
 */
export function consumptionPer1000Units(quantity: number, unitsProduced: number): number | null {
  if (unitsProduced <= 0) {
    return null;
  }
  return (quantity / unitsProduced) * 1000;
}

/**
 * Compares an actual consumption/1000 against a standard's band (section
 * 41). A standard with no min/max still yields CONFORME at the target and
 * A_SURVEILLER outside a ±10% tolerance of it, HORS_STANDARD beyond a
 * defined min/max - never a fabricated pass/fail when the standard itself
 * only defines a target.
 */
export function compareToStandard(
  actualPer1000: number,
  standard: Readonly<{ targetPer1000: number; minPer1000: number | null; maxPer1000: number | null }> | null,
): StandardComparisonStatus {
  if (standard === null) {
    return 'STANDARD_NON_DEFINI';
  }
  if (standard.minPer1000 !== null && actualPer1000 < standard.minPer1000) {
    return 'HORS_STANDARD';
  }
  if (standard.maxPer1000 !== null && actualPer1000 > standard.maxPer1000) {
    return 'HORS_STANDARD';
  }
  const tolerance = standard.targetPer1000 * 0.1;
  if (Math.abs(actualPer1000 - standard.targetPer1000) > tolerance) {
    return 'A_SURVEILLER';
  }
  return 'CONFORME';
}
