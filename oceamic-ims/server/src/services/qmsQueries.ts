import type pg from 'pg';

// Read-only Phase 6 queries: non-conformities, CAPA, complaints, supplier
// incidents, audits, quality documents, recall. Every calculated figure
// (overdue, closure eligibility) is read from the migration 025 views or a
// direct date comparison, never recomputed ad hoc per screen.

// A small, deliberately partial lookup: only the entity types a QMS link
// realistically points at need a human-readable label here. Anything else
// falls back to its raw id in the caller.
const ENTITY_LABEL_LOOKUP: Readonly<Record<string, Readonly<{ table: string; column: string }>>> = {
  RAW_MATERIAL_LOT: { table: 'raw_material_lots', column: 'lot_code' },
  RECEPTION: { table: 'raw_material_receptions', column: 'reception_code' },
  PRODUCTION_RUN: { table: 'production_runs', column: 'run_code' },
  FILLING_WEIGHT_CONTROL: { table: 'filling_weight_controls', column: 'control_code' },
  STERILIZATION_CYCLE: { table: 'sterilization_cycles', column: 'cycle_code' },
  PROCESS_DEVIATION: { table: 'process_deviations', column: 'deviation_code' },
  FINISHED_GOOD_LOT: { table: 'finished_good_lots', column: 'lot_code' },
  PALLET: { table: 'pallets', column: 'pallet_code' },
  SHIPMENT: { table: 'shipments', column: 'shipment_code' },
  SUPPLIER: { table: 'suppliers', column: 'name' },
  CUSTOMER: { table: 'customers', column: 'name' },
  EQUIPMENT: { table: 'equipment', column: 'name' },
  AUDIT: { table: 'audits', column: 'audit_code' },
  AUDIT_FINDING: { table: 'audit_findings', column: 'finding_code' },
  CUSTOMER_COMPLAINT: { table: 'customer_complaints', column: 'complaint_code' },
  SUPPLIER_QUALITY_INCIDENT: { table: 'supplier_quality_incidents', column: 'incident_code' },
  // Phase 7 (section 63's seaming-defect scenario): a non-conformity can
  // point back at the failure/work order investigated alongside it.
  FAILURE_REPORT: { table: 'failure_reports', column: 'failure_code' },
  MAINTENANCE_WORK_ORDER: { table: 'maintenance_work_orders', column: 'work_order_code' },
  // Phase 8 (section 54): an ingredient lot incident can raise an NCR the
  // same way a raw-material lot does.
  INGREDIENT_LOT: { table: 'ingredient_lots', column: 'lot_code' },
};

async function resolveEntityLabel(pool: pg.Pool, entityType: string, entityId: string): Promise<string | null> {
  const target = ENTITY_LABEL_LOOKUP[entityType];
  if (!target) {
    return null;
  }
  const result = await pool.query<{ label: string }>(
    `SELECT ${target.column} AS label FROM ${target.table} WHERE id = $1`,
    [entityId],
  );
  return result.rows[0]?.label ?? null;
}

// --- Non-conformities --------------------------------------------------------

export type NonconformityRow = Readonly<{
  id: string;
  nonconformityCode: string;
  detectedAt: string;
  sourceType: string | null;
  sourceId: string | null;
  categoryName: string;
  severity: string;
  priority: string;
  status: string;
  ownerName: string | null;
  dueAt: string | null;
  isOverdue: boolean;
}>;

const NONCONFORMITY_QUERY = `
  SELECT n.id AS "id", n.nonconformity_code AS "nonconformityCode", n.detected_at AS "detectedAt",
         n.source_type AS "sourceType", n.source_id AS "sourceId", cat.name AS "categoryName",
         n.severity AS "severity", n.priority AS "priority", n.status AS "status",
         owner.full_name AS "ownerName", n.due_at AS "dueAt",
         (n.due_at IS NOT NULL AND n.due_at < now()
          AND n.status NOT IN ('CLOTUREE', 'ANNULEE')) AS "isOverdue"
    FROM nonconformities n
    JOIN nonconformity_categories cat ON cat.id = n.category_id
    LEFT JOIN users owner ON owner.id = n.owner_user_id`;

export async function listNonconformities(
  pool: pg.Pool,
  filters: Readonly<{
    search: string | null;
    categoryId: string | null;
    severity: string | null;
    status: string | null;
    ownerUserId: string | null;
    sourceType: string | null;
    limit: number;
  }>,
): Promise<readonly NonconformityRow[]> {
  const result = await pool.query<NonconformityRow>(
    `${NONCONFORMITY_QUERY}
      WHERE ($1::text IS NULL OR n.nonconformity_code ILIKE '%' || $1 || '%' OR n.title ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR n.category_id = $2)
        AND ($3::text IS NULL OR n.severity = $3)
        AND ($4::text IS NULL OR n.status = $4)
        AND ($5::uuid IS NULL OR n.owner_user_id = $5)
        AND ($6::text IS NULL OR n.source_type = $6)
      ORDER BY n.detected_at DESC
      LIMIT $7`,
    [
      filters.search,
      filters.categoryId,
      filters.severity,
      filters.status,
      filters.ownerUserId,
      filters.sourceType,
      filters.limit,
    ],
  );
  return result.rows;
}

export type NonconformityDetail = Readonly<{
  id: string;
  nonconformityCode: string;
  detectedAt: string;
  title: string;
  description: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  categoryId: string;
  categoryName: string;
  severity: string;
  priority: string;
  status: string;
  detectedByName: string;
  ownerName: string | null;
  ownerUserId: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  qualityBlockRequired: boolean;
  blockEntityType: string | null;
  blockEntityId: string | null;
  blockReferenceId: string | null;
}>;

export type NonconformityLinkRow = Readonly<{
  entityType: string;
  entityId: string;
  relationshipType: string;
  label: string | null;
}>;

export type NonconformityInvestigationRow = Readonly<{
  id: string;
  startedAt: string;
  completedAt: string | null;
  investigatorName: string;
  facts: string;
  immediateCorrection: string | null;
  impactAssessment: string | null;
  rootCauseRequired: boolean;
  notes: string | null;
}>;

export type RootCauseRow = Readonly<{
  id: string;
  method: string;
  analysisText: string;
  rootCause: string;
  validatedByName: string | null;
  validatedAt: string | null;
}>;

export type LinkedCapaRow = Readonly<{ id: string; capaCode: string; capaType: string; status: string }>;

export async function nonconformityDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{
  nonconformity: NonconformityDetail;
  links: readonly NonconformityLinkRow[];
  investigations: readonly NonconformityInvestigationRow[];
  rootCauses: readonly RootCauseRow[];
  capas: readonly LinkedCapaRow[];
}> | null> {
  const ncrResult = await pool.query<NonconformityDetail>(
    `SELECT n.id AS "id", n.nonconformity_code AS "nonconformityCode", n.detected_at AS "detectedAt",
            n.title AS "title", n.description AS "description", n.source_type AS "sourceType",
            n.source_id AS "sourceId", NULL::text AS "sourceLabel",
            n.category_id AS "categoryId", cat.name AS "categoryName", n.severity AS "severity",
            n.priority AS "priority", n.status AS "status", detector.full_name AS "detectedByName",
            owner.full_name AS "ownerName", n.owner_user_id AS "ownerUserId", n.due_at AS "dueAt",
            (n.due_at IS NOT NULL AND n.due_at < now()
             AND n.status NOT IN ('CLOTUREE', 'ANNULEE')) AS "isOverdue",
            n.quality_block_required AS "qualityBlockRequired", n.block_entity_type AS "blockEntityType",
            n.block_entity_id AS "blockEntityId", n.block_reference_id AS "blockReferenceId"
       FROM nonconformities n
       JOIN nonconformity_categories cat ON cat.id = n.category_id
       JOIN users detector ON detector.id = n.detected_by
       LEFT JOIN users owner ON owner.id = n.owner_user_id
      WHERE n.id = $1`,
    [id],
  );
  const row = ncrResult.rows[0];
  if (!row) {
    return null;
  }
  const sourceLabel =
    row.sourceType !== null && row.sourceId !== null
      ? await resolveEntityLabel(pool, row.sourceType, row.sourceId)
      : null;
  const nonconformity: NonconformityDetail = { ...row, sourceLabel };

  const [linksResult, investigations, rootCauses, capas] = await Promise.all([
    pool.query<{ entity_type: string; entity_id: string; relationship_type: string }>(
      `SELECT entity_type, entity_id, relationship_type FROM nonconformity_links
        WHERE nonconformity_id = $1 ORDER BY created_at`,
      [id],
    ),
    pool.query<NonconformityInvestigationRow>(
      `SELECT i.id AS "id", i.started_at AS "startedAt", i.completed_at AS "completedAt",
              u.full_name AS "investigatorName", i.facts AS "facts",
              i.immediate_correction AS "immediateCorrection", i.impact_assessment AS "impactAssessment",
              i.root_cause_required AS "rootCauseRequired", i.notes AS "notes"
         FROM nonconformity_investigations i
         JOIN users u ON u.id = i.investigator_user_id
        WHERE i.nonconformity_id = $1
        ORDER BY i.started_at DESC`,
      [id],
    ),
    pool.query<RootCauseRow>(
      `SELECT r.id AS "id", r.method AS "method", r.analysis_text AS "analysisText",
              r.root_cause AS "rootCause", validator.full_name AS "validatedByName",
              r.validated_at AS "validatedAt"
         FROM root_cause_analyses r
         LEFT JOIN users validator ON validator.id = r.validated_by
        WHERE r.nonconformity_id = $1
        ORDER BY r.created_at DESC`,
      [id],
    ),
    pool.query<LinkedCapaRow>(
      `SELECT id AS "id", capa_code AS "capaCode", capa_type AS "capaType", status AS "status"
         FROM capa_records WHERE source_nonconformity_id = $1 ORDER BY opened_at DESC`,
      [id],
    ),
  ]);

  const links: NonconformityLinkRow[] = await Promise.all(
    linksResult.rows.map(async (row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      relationshipType: row.relationship_type,
      label: await resolveEntityLabel(pool, row.entity_type, row.entity_id),
    })),
  );

  return {
    nonconformity,
    links,
    investigations: investigations.rows,
    rootCauses: rootCauses.rows,
    capas: capas.rows,
  };
}

export type RepeatCategoryRow = Readonly<{ categoryId: string; categoryName: string; count: number }>;

/** Repeat non-conformities grouped by category (section 48) - a proper FK,
 * never free text - over a sliding window (default 180 days). */
export async function repeatNonconformitiesByCategory(
  pool: pg.Pool,
  sinceDays: number,
): Promise<readonly RepeatCategoryRow[]> {
  const result = await pool.query<RepeatCategoryRow>(
    `SELECT cat.id AS "categoryId", cat.name AS "categoryName", COUNT(*)::integer AS "count"
       FROM nonconformities n
       JOIN nonconformity_categories cat ON cat.id = n.category_id
      WHERE n.detected_at >= now() - ($1 || ' days')::interval
      GROUP BY cat.id, cat.name
     HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC`,
    [sinceDays],
  );
  return result.rows;
}

// --- CAPA ---------------------------------------------------------------------

export type CapaRow = Readonly<{
  id: string;
  capaCode: string;
  sourceNonconformityCode: string | null;
  ownerName: string;
  openedAt: string;
  dueAt: string | null;
  isOverdue: boolean;
  totalActions: number;
  openActions: number;
  effectivenessRequired: boolean;
  latestEffective: boolean | null;
  status: string;
}>;

const CAPA_QUERY = `
  SELECT c.id AS "id", c.capa_code AS "capaCode", ncr.nonconformity_code AS "sourceNonconformityCode",
         owner.full_name AS "ownerName", c.opened_at AS "openedAt", c.due_at AS "dueAt",
         (c.due_at IS NOT NULL AND c.due_at < now()
          AND c.status NOT IN ('CLOTUREE', 'ANNULEE')) AS "isOverdue",
         COALESCE(s.total_actions, 0) AS "totalActions", COALESCE(s.open_actions, 0) AS "openActions",
         c.effectiveness_required AS "effectivenessRequired", s.latest_effective AS "latestEffective",
         c.status AS "status"
    FROM capa_records c
    JOIN users owner ON owner.id = c.owner_user_id
    LEFT JOIN nonconformities ncr ON ncr.id = c.source_nonconformity_id
    LEFT JOIN capa_summary s ON s.capa_id = c.id`;

export async function listCapaRecords(
  pool: pg.Pool,
  filters: Readonly<{ search: string | null; status: string | null; ownerUserId: string | null; limit: number }>,
): Promise<readonly CapaRow[]> {
  const result = await pool.query<CapaRow>(
    `${CAPA_QUERY}
      WHERE ($1::text IS NULL OR c.capa_code ILIKE '%' || $1 || '%' OR c.title ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR c.status = $2)
        AND ($3::uuid IS NULL OR c.owner_user_id = $3)
      ORDER BY c.opened_at DESC
      LIMIT $4`,
    [filters.search, filters.status, filters.ownerUserId, filters.limit],
  );
  return result.rows;
}

export type CapaActionRow = Readonly<{
  id: string;
  actionType: string;
  description: string;
  responsibleName: string;
  plannedDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  status: string;
  isOverdue: boolean;
  completionEvidence: string | null;
}>;

export type CapaEffectivenessCheckRow = Readonly<{
  id: string;
  checkedAt: string;
  checkedByName: string;
  method: string;
  result: string;
  effective: boolean;
  notes: string | null;
}>;

export async function capaDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{
  capa: CapaRow & { title: string; description: string; capaType: string; priority: string; canClose: boolean };
  actions: readonly CapaActionRow[];
  effectivenessChecks: readonly CapaEffectivenessCheckRow[];
}> | null> {
  const capaResult = await pool.query<CapaRow & { title: string; description: string; capaType: string; priority: string; canClose: boolean }>(
    `SELECT c.id AS "id", c.capa_code AS "capaCode", ncr.nonconformity_code AS "sourceNonconformityCode",
            owner.full_name AS "ownerName", c.opened_at AS "openedAt", c.due_at AS "dueAt",
            (c.due_at IS NOT NULL AND c.due_at < now()
             AND c.status NOT IN ('CLOTUREE', 'ANNULEE')) AS "isOverdue",
            COALESCE(s.total_actions, 0) AS "totalActions", COALESCE(s.open_actions, 0) AS "openActions",
            c.effectiveness_required AS "effectivenessRequired", s.latest_effective AS "latestEffective",
            c.status AS "status", c.title AS "title", c.description AS "description",
            c.capa_type AS "capaType", c.priority AS "priority", COALESCE(s.can_close, FALSE) AS "canClose"
       FROM capa_records c
       JOIN users owner ON owner.id = c.owner_user_id
       LEFT JOIN nonconformities ncr ON ncr.id = c.source_nonconformity_id
       LEFT JOIN capa_summary s ON s.capa_id = c.id
      WHERE c.id = $1`,
    [id],
  );
  const capa = capaResult.rows[0];
  if (!capa) {
    return null;
  }
  const [actions, effectivenessChecks] = await Promise.all([
    pool.query<CapaActionRow>(
      `SELECT a.id AS "id", a.action_type AS "actionType", a.description AS "description",
              u.full_name AS "responsibleName", a.planned_date AS "plannedDate", a.due_date AS "dueDate",
              a.completed_at AS "completedAt", a.status AS "status",
              (a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE
               AND a.status NOT IN ('TERMINEE', 'ANNULEE')) AS "isOverdue",
              a.completion_evidence AS "completionEvidence"
         FROM capa_actions a
         JOIN users u ON u.id = a.responsible_user_id
        WHERE a.capa_id = $1
        ORDER BY a.created_at`,
      [id],
    ),
    pool.query<CapaEffectivenessCheckRow>(
      `SELECT ec.id AS "id", ec.checked_at AS "checkedAt", u.full_name AS "checkedByName",
              ec.method AS "method", ec.result AS "result", ec.effective AS "effective", ec.notes AS "notes"
         FROM capa_effectiveness_checks ec
         JOIN users u ON u.id = ec.checked_by
        WHERE ec.capa_id = $1
        ORDER BY ec.checked_at DESC`,
      [id],
    ),
  ]);
  return { capa, actions: actions.rows, effectivenessChecks: effectivenessChecks.rows };
}

// --- Complaints -----------------------------------------------------------

export type ComplaintRow = Readonly<{
  id: string;
  complaintCode: string;
  receivedAt: string;
  customerName: string;
  shipmentCode: string | null;
  finishedGoodLotCode: string | null;
  complaintType: string;
  severity: string;
  status: string;
  ownerName: string | null;
  resultingNonconformityId: string | null;
  resultingCapaId: string | null;
}>;

const COMPLAINT_QUERY = `
  SELECT cp.id AS "id", cp.complaint_code AS "complaintCode", cp.received_at AS "receivedAt",
         c.name AS "customerName", sh.shipment_code AS "shipmentCode", fgl.lot_code AS "finishedGoodLotCode",
         cp.complaint_type AS "complaintType", cp.severity AS "severity", cp.status AS "status",
         owner.full_name AS "ownerName", cp.resulting_nonconformity_id AS "resultingNonconformityId",
         cp.resulting_capa_id AS "resultingCapaId"
    FROM customer_complaints cp
    JOIN customers c ON c.id = cp.customer_id
    LEFT JOIN shipments sh ON sh.id = cp.shipment_id
    LEFT JOIN finished_good_lots fgl ON fgl.id = cp.finished_good_lot_id
    LEFT JOIN users owner ON owner.id = cp.owner_user_id`;

export async function listComplaints(
  pool: pg.Pool,
  filters: Readonly<{ search: string | null; status: string | null; customerId: string | null; limit: number }>,
): Promise<readonly ComplaintRow[]> {
  const result = await pool.query<ComplaintRow>(
    `${COMPLAINT_QUERY}
      WHERE ($1::text IS NULL OR cp.complaint_code ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR cp.status = $2)
        AND ($3::uuid IS NULL OR cp.customer_id = $3)
      ORDER BY cp.received_at DESC
      LIMIT $4`,
    [filters.search, filters.status, filters.customerId, filters.limit],
  );
  return result.rows;
}

export type ComplaintTraceabilityRow = Readonly<{
  palletCode: string;
  finishedGoodLotCode: string;
  runCode: string;
  cycleCode: string;
  rawMaterialLotCode: string;
  supplierName: string | null;
}>;

export async function complaintDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{ complaint: ComplaintRow; traceability: readonly ComplaintTraceabilityRow[] }> | null> {
  const result = await pool.query<ComplaintRow>(`${COMPLAINT_QUERY} WHERE cp.id = $1`, [id]);
  const complaint = result.rows[0];
  if (!complaint) {
    return null;
  }

  // Section 17: Customer -> Shipment -> Pallets -> Lot PF -> Sterilization ->
  // Run -> Raw Material Lots, recovered without asking Quality to
  // reconstruct it manually.
  const traceability = complaint.shipmentCode
    ? await pool.query<ComplaintTraceabilityRow>(
        `SELECT DISTINCT pal.pallet_code AS "palletCode", fgl.lot_code AS "finishedGoodLotCode",
                r.run_code AS "runCode", cy.cycle_code AS "cycleCode", lot.lot_code AS "rawMaterialLotCode",
                sup.name AS "supplierName"
           FROM customer_complaints cp
           JOIN shipment_lines sl ON sl.shipment_id = cp.shipment_id
           JOIN pallets pal ON pal.id = sl.pallet_id
           JOIN pallet_contents pc ON pc.pallet_id = pal.id
           JOIN finished_good_lots fgl ON fgl.id = pc.finished_good_lot_id
           JOIN finished_good_lot_sources src ON src.finished_good_lot_id = fgl.id
           JOIN sterilization_cycles cy ON cy.id = src.sterilization_cycle_id
           JOIN production_runs r ON r.id = src.production_run_id
           JOIN production_run_materials m ON m.production_run_id = r.id
           JOIN raw_material_lots lot ON lot.id = m.raw_material_lot_id
           LEFT JOIN suppliers sup ON sup.id = lot.supplier_id
          WHERE cp.id = $1
          ORDER BY pal.pallet_code, fgl.lot_code`,
        [id],
      )
    : { rows: [] };

  return { complaint, traceability: traceability.rows };
}

// --- Supplier incidents ------------------------------------------------------

export type SupplierIncidentRow = Readonly<{
  id: string;
  incidentCode: string;
  supplierName: string;
  rawMaterialLotCode: string | null;
  detectedAt: string;
  category: string;
  severity: string;
  status: string;
}>;

export async function listSupplierIncidents(
  pool: pg.Pool,
  filters: Readonly<{ supplierId: string | null; status: string | null; limit: number }>,
): Promise<readonly SupplierIncidentRow[]> {
  const result = await pool.query<SupplierIncidentRow>(
    `SELECT i.id AS "id", i.incident_code AS "incidentCode", sup.name AS "supplierName",
            lot.lot_code AS "rawMaterialLotCode", i.detected_at AS "detectedAt", i.category AS "category",
            i.severity AS "severity", i.status AS "status"
       FROM supplier_quality_incidents i
       JOIN suppliers sup ON sup.id = i.supplier_id
       LEFT JOIN raw_material_lots lot ON lot.id = i.raw_material_lot_id
      WHERE ($1::uuid IS NULL OR i.supplier_id = $1)
        AND ($2::text IS NULL OR i.status = $2)
      ORDER BY i.detected_at DESC
      LIMIT $3`,
    [filters.supplierId, filters.status, filters.limit],
  );
  return result.rows;
}

export type SupplierPerformanceRow = Readonly<{
  supplierId: string;
  supplierName: string;
  incidentCount: number;
  blockedLotCount: number;
  receptionCount: number;
}>;

/**
 * Supplier performance foundation (section 20): plain counts, no scoring
 * engine - incidents, blocked lots and receptions over a sliding window.
 */
export async function supplierPerformance(pool: pg.Pool, sinceDays: number): Promise<readonly SupplierPerformanceRow[]> {
  const result = await pool.query<SupplierPerformanceRow>(
    `SELECT sup.id AS "supplierId", sup.name AS "supplierName",
            COALESCE(inc.count, 0)::integer AS "incidentCount",
            COALESCE(blocked.count, 0)::integer AS "blockedLotCount",
            COALESCE(rec.count, 0)::integer AS "receptionCount"
       FROM suppliers sup
       LEFT JOIN LATERAL (
             SELECT COUNT(*) AS count FROM supplier_quality_incidents i
              WHERE i.supplier_id = sup.id AND i.detected_at >= now() - ($1 || ' days')::interval
       ) inc ON TRUE
       LEFT JOIN LATERAL (
             SELECT COUNT(DISTINCT lot.id) AS count
               FROM raw_material_lots lot
               JOIN blocked_lots bl ON bl.raw_material_lot_id = lot.id
              WHERE lot.supplier_id = sup.id
       ) blocked ON TRUE
       LEFT JOIN LATERAL (
             SELECT COUNT(*) AS count FROM raw_material_receptions r
              WHERE r.supplier_id = sup.id AND r.received_at >= now() - ($1 || ' days')::interval
       ) rec ON TRUE
      WHERE sup.is_active
      ORDER BY sup.name`,
    [sinceDays],
  );
  return result.rows;
}

// --- Audits -------------------------------------------------------------------

export type AuditRow = Readonly<{
  id: string;
  auditCode: string;
  auditType: string;
  title: string;
  plannedDate: string;
  scope: string;
  leadAuditorName: string;
  status: string;
  findingCount: number;
  openFindingCount: number;
}>;

const AUDIT_QUERY = `
  SELECT a.id AS "id", a.audit_code AS "auditCode", a.audit_type AS "auditType", a.title AS "title",
         a.planned_date AS "plannedDate", a.scope AS "scope", u.full_name AS "leadAuditorName",
         a.status AS "status", COALESCE(p.finding_count, 0) AS "findingCount",
         COALESCE(p.open_finding_count, 0) AS "openFindingCount"
    FROM audits a
    JOIN users u ON u.id = a.lead_auditor_user_id
    LEFT JOIN audit_progress p ON p.audit_id = a.id`;

export async function listAudits(
  pool: pg.Pool,
  filters: Readonly<{ status: string | null; auditType: string | null; limit: number }>,
): Promise<readonly AuditRow[]> {
  const result = await pool.query<AuditRow>(
    `${AUDIT_QUERY}
      WHERE ($1::text IS NULL OR a.status = $1)
        AND ($2::text IS NULL OR a.audit_type = $2)
      ORDER BY a.planned_date DESC
      LIMIT $3`,
    [filters.status, filters.auditType, filters.limit],
  );
  return result.rows;
}

export type AuditChecklistItemResponseRow = Readonly<{
  itemId: string;
  displayOrder: number;
  question: string;
  expectedReference: string | null;
  result: string | null;
  observation: string | null;
  evidenceReference: string | null;
  respondedByName: string | null;
  respondedAt: string | null;
}>;

export type AuditFindingRow = Readonly<{
  id: string;
  findingCode: string;
  findingType: string;
  description: string;
  severity: string;
  ownerName: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  status: string;
  resultingNonconformityId: string | null;
}>;

export async function auditDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{
  audit: AuditRow;
  checklistItems: readonly AuditChecklistItemResponseRow[];
  findings: readonly AuditFindingRow[];
}> | null> {
  const result = await pool.query<AuditRow>(`${AUDIT_QUERY} WHERE a.id = $1`, [id]);
  const audit = result.rows[0];
  if (!audit) {
    return null;
  }
  const [checklistItems, findings] = await Promise.all([
    pool.query<AuditChecklistItemResponseRow>(
      `SELECT i.id AS "itemId", i.display_order AS "displayOrder", i.question AS "question",
              i.expected_reference AS "expectedReference", r.result AS "result",
              r.observation AS "observation", r.evidence_reference AS "evidenceReference",
              u.full_name AS "respondedByName", r.responded_at AS "respondedAt"
         FROM audits a
         JOIN audit_checklist_items i ON i.audit_checklist_id = a.audit_checklist_id AND i.is_active
         LEFT JOIN audit_responses r ON r.audit_id = a.id AND r.checklist_item_id = i.id
         LEFT JOIN users u ON u.id = r.responded_by
        WHERE a.id = $1
        ORDER BY i.display_order`,
      [id],
    ),
    pool.query<AuditFindingRow>(
      `SELECT f.id AS "id", f.finding_code AS "findingCode", f.finding_type AS "findingType",
              f.description AS "description", f.severity AS "severity", u.full_name AS "ownerName",
              f.due_at AS "dueAt",
              (f.due_at IS NOT NULL AND f.due_at < now() AND f.status NOT IN ('CLOTUREE', 'ANNULEE')) AS "isOverdue",
              f.status AS "status", f.resulting_nonconformity_id AS "resultingNonconformityId"
         FROM audit_findings f
         LEFT JOIN users u ON u.id = f.owner_user_id
        WHERE f.audit_id = $1
        ORDER BY f.created_at`,
      [id],
    ),
  ]);
  return { audit, checklistItems: checklistItems.rows, findings: findings.rows };
}

// --- Quality documents --------------------------------------------------------

export type QualityDocumentRow = Readonly<{
  id: string;
  documentCode: string;
  title: string;
  documentType: string;
  currentRevisionNumber: number | null;
  effectiveDate: string | null;
  ownerName: string;
  status: string;
}>;

const QUALITY_DOCUMENT_QUERY = `
  SELECT d.id AS "id", d.document_code AS "documentCode", d.title AS "title",
         d.document_type AS "documentType", rev.revision_number AS "currentRevisionNumber",
         rev.effective_date AS "effectiveDate", u.full_name AS "ownerName", d.status AS "status"
    FROM quality_documents d
    JOIN users u ON u.id = d.owner_user_id
    LEFT JOIN quality_document_revisions rev ON rev.id = d.current_revision_id`;

export async function listQualityDocuments(
  pool: pg.Pool,
  filters: Readonly<{ search: string | null; status: string | null; documentType: string | null; limit: number }>,
): Promise<readonly QualityDocumentRow[]> {
  const result = await pool.query<QualityDocumentRow>(
    `${QUALITY_DOCUMENT_QUERY}
      WHERE ($1::text IS NULL OR d.document_code ILIKE '%' || $1 || '%' OR d.title ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR d.status = $2)
        AND ($3::text IS NULL OR d.document_type = $3)
      ORDER BY d.document_code
      LIMIT $4`,
    [filters.search, filters.status, filters.documentType, filters.limit],
  );
  return result.rows;
}

export type QualityDocumentRevisionRow = Readonly<{
  id: string;
  revisionNumber: number;
  status: string;
  effectiveDate: string | null;
  changeSummary: string;
  fileReference: string | null;
  createdByName: string;
  createdAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
}>;

export async function qualityDocumentDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{ document: QualityDocumentRow; revisions: readonly QualityDocumentRevisionRow[] }> | null> {
  const result = await pool.query<QualityDocumentRow>(`${QUALITY_DOCUMENT_QUERY} WHERE d.id = $1`, [id]);
  const document = result.rows[0];
  if (!document) {
    return null;
  }
  const revisions = await pool.query<QualityDocumentRevisionRow>(
    `SELECT r.id AS "id", r.revision_number AS "revisionNumber", r.status AS "status",
            r.effective_date AS "effectiveDate", r.change_summary AS "changeSummary",
            r.file_reference AS "fileReference", creator.full_name AS "createdByName",
            r.created_at AS "createdAt", approver.full_name AS "approvedByName", r.approved_at AS "approvedAt"
       FROM quality_document_revisions r
       JOIN users creator ON creator.id = r.created_by
       LEFT JOIN users approver ON approver.id = r.approved_by
      WHERE r.quality_document_id = $1
      ORDER BY r.revision_number DESC`,
    [id],
  );
  return { document, revisions: revisions.rows };
}

export type AcknowledgmentRow = Readonly<{
  id: string;
  userName: string;
  assignedAt: string;
  acknowledgedAt: string | null;
  status: string;
}>;

export async function listAcknowledgments(pool: pg.Pool, revisionId: string): Promise<readonly AcknowledgmentRow[]> {
  const result = await pool.query<AcknowledgmentRow>(
    `SELECT a.id AS "id", u.full_name AS "userName", a.assigned_at AS "assignedAt",
            a.acknowledged_at AS "acknowledgedAt", a.status AS "status"
       FROM document_acknowledgments a
       JOIN users u ON u.id = a.user_id
      WHERE a.document_revision_id = $1
      ORDER BY a.assigned_at DESC`,
    [revisionId],
  );
  return result.rows;
}

// --- Recall / withdrawal -------------------------------------------------------

export type RecallEventRow = Readonly<{
  id: string;
  recallCode: string;
  eventType: string;
  targetEntityType: string;
  targetEntityId: string;
  targetLabel: string | null;
  openedAt: string;
  closedAt: string | null;
  severity: string;
  status: string;
  initiatedByName: string;
  affectedCount: number;
}>;

const RECALL_EVENT_QUERY = `
  SELECT r.id AS "id", r.recall_code AS "recallCode", r.event_type AS "eventType",
         r.target_entity_type AS "targetEntityType", r.target_entity_id AS "targetEntityId",
         COALESCE(mp.lot_code, pf.lot_code) AS "targetLabel",
         r.opened_at AS "openedAt", r.closed_at AS "closedAt", r.severity AS "severity",
         r.status AS "status", u.full_name AS "initiatedByName",
         COALESCE(affected.count, 0)::integer AS "affectedCount"
    FROM recall_events r
    JOIN users u ON u.id = r.initiated_by
    LEFT JOIN raw_material_lots mp ON mp.id = r.target_entity_id AND r.target_entity_type = 'RAW_MATERIAL_LOT'
    LEFT JOIN finished_good_lots pf ON pf.id = r.target_entity_id AND r.target_entity_type = 'FINISHED_GOOD_LOT'
    LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM recall_affected_entities e WHERE e.recall_event_id = r.id
    ) affected ON TRUE`;

export async function listRecallEvents(
  pool: pg.Pool,
  filters: Readonly<{ status: string | null; eventType: string | null; limit: number }>,
): Promise<readonly RecallEventRow[]> {
  const result = await pool.query<RecallEventRow>(
    `${RECALL_EVENT_QUERY}
      WHERE ($1::text IS NULL OR r.status = $1)
        AND ($2::text IS NULL OR r.event_type = $2)
      ORDER BY r.opened_at DESC
      LIMIT $3`,
    [filters.status, filters.eventType, filters.limit],
  );
  return result.rows;
}

export type RecallAffectedEntityRow = Readonly<{
  id: string;
  entityType: string;
  entityId: string;
  label: string | null;
  impactType: string;
  quantity: string | null;
  status: string;
}>;

export async function recallEventDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{ event: RecallEventRow; affected: readonly RecallAffectedEntityRow[] }> | null> {
  const result = await pool.query<RecallEventRow>(`${RECALL_EVENT_QUERY} WHERE r.id = $1`, [id]);
  const event = result.rows[0];
  if (!event) {
    return null;
  }
  const affectedResult = await pool.query<{
    id: string;
    entity_type: string;
    entity_id: string;
    impact_type: string;
    quantity: string | null;
    status: string;
  }>(
    `SELECT id, entity_type, entity_id, impact_type, quantity, status
       FROM recall_affected_entities WHERE recall_event_id = $1
      ORDER BY impact_type, entity_type`,
    [id],
  );
  const affected: RecallAffectedEntityRow[] = await Promise.all(
    affectedResult.rows.map(async (row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      label: await resolveEntityLabel(pool, row.entity_type, row.entity_id),
      impactType: row.impact_type,
      quantity: row.quantity,
      status: row.status,
    })),
  );
  return { event, affected };
}

// --- QMS home summary and metrics --------------------------------------------

export type QmsHomeSummary = Readonly<{
  openNonconformities: number;
  overdueCapa: number;
  blockedLots: number;
  openComplaints: number;
  upcomingAudits: number;
  overdueActions: number;
}>;

/** Section 37: five focused counts, no decorative charts. */
export async function qmsHomeSummary(pool: pg.Pool): Promise<QmsHomeSummary> {
  const result = await pool.query<{
    open_ncr: string;
    overdue_capa: string;
    blocked_raw: string;
    blocked_fg: string;
    open_complaints: string;
    upcoming_audits: string;
    overdue_actions: string;
  }>(
    `SELECT
        (SELECT COUNT(*) FROM nonconformities
          WHERE status NOT IN ('CLOTUREE', 'ANNULEE'))::text AS open_ncr,
        (SELECT COUNT(*) FROM capa_records c
           JOIN capa_summary s ON s.capa_id = c.id
          WHERE c.status NOT IN ('CLOTUREE', 'ANNULEE')
            AND c.due_at IS NOT NULL AND c.due_at < now())::text AS overdue_capa,
        (SELECT COUNT(*) FROM blocked_lots)::text AS blocked_raw,
        (SELECT COUNT(*) FROM finished_goods_quality_blocks WHERE status = 'ACTIF')::text AS blocked_fg,
        (SELECT COUNT(*) FROM customer_complaints
          WHERE status NOT IN ('CLOTUREE', 'ANNULEE'))::text AS open_complaints,
        (SELECT COUNT(*) FROM audits
          WHERE status = 'PLANIFIE' AND planned_date <= CURRENT_DATE + 14)::text AS upcoming_audits,
        (SELECT COUNT(*) FROM capa_actions
          WHERE status NOT IN ('TERMINEE', 'ANNULEE') AND due_date IS NOT NULL
            AND due_date < CURRENT_DATE)::text AS overdue_actions`,
  );
  const row = result.rows[0];
  return {
    openNonconformities: Number(row?.open_ncr ?? '0'),
    overdueCapa: Number(row?.overdue_capa ?? '0'),
    blockedLots: Number(row?.blocked_raw ?? '0') + Number(row?.blocked_fg ?? '0'),
    openComplaints: Number(row?.open_complaints ?? '0'),
    upcomingAudits: Number(row?.upcoming_audits ?? '0'),
    overdueActions: Number(row?.overdue_actions ?? '0'),
  };
}

export type QmsMetrics = Readonly<{
  ncrOpened: number;
  ncrClosed: number;
  averageClosureDays: number | null;
  capaOverdue: number;
  complaintCount: number;
  auditFindingCount: number;
  supplierIncidentCount: number;
}>;

/** Section 47: basic KPIs over a sliding window, no predictive analytics. */
export async function qmsMetrics(pool: pg.Pool, sinceDays: number): Promise<QmsMetrics> {
  const result = await pool.query<{
    ncr_opened: string;
    ncr_closed: string;
    avg_closure_days: string | null;
    capa_overdue: string;
    complaint_count: string;
    audit_finding_count: string;
    supplier_incident_count: string;
  }>(
    `SELECT
        (SELECT COUNT(*) FROM nonconformities
          WHERE detected_at >= now() - ($1 || ' days')::interval)::text AS ncr_opened,
        (SELECT COUNT(*) FROM nonconformities
          WHERE status = 'CLOTUREE' AND updated_at >= now() - ($1 || ' days')::interval)::text AS ncr_closed,
        (SELECT AVG(EXTRACT(EPOCH FROM (updated_at - detected_at)) / 86400.0) FROM nonconformities
          WHERE status = 'CLOTUREE' AND updated_at >= now() - ($1 || ' days')::interval)::text AS avg_closure_days,
        (SELECT COUNT(*) FROM capa_records
          WHERE status NOT IN ('CLOTUREE', 'ANNULEE') AND due_at IS NOT NULL AND due_at < now())::text AS capa_overdue,
        (SELECT COUNT(*) FROM customer_complaints
          WHERE received_at >= now() - ($1 || ' days')::interval)::text AS complaint_count,
        (SELECT COUNT(*) FROM audit_findings f
           JOIN audits a ON a.id = f.audit_id
          WHERE a.planned_date >= CURRENT_DATE - ($1 || ' days')::interval)::text AS audit_finding_count,
        (SELECT COUNT(*) FROM supplier_quality_incidents
          WHERE detected_at >= now() - ($1 || ' days')::interval)::text AS supplier_incident_count`,
    [sinceDays],
  );
  const row = result.rows[0];
  return {
    ncrOpened: Number(row?.ncr_opened ?? '0'),
    ncrClosed: Number(row?.ncr_closed ?? '0'),
    averageClosureDays: row?.avg_closure_days ? Math.round(Number(row.avg_closure_days) * 10) / 10 : null,
    capaOverdue: Number(row?.capa_overdue ?? '0'),
    complaintCount: Number(row?.complaint_count ?? '0'),
    auditFindingCount: Number(row?.audit_finding_count ?? '0'),
    supplierIncidentCount: Number(row?.supplier_incident_count ?? '0'),
  };
}
