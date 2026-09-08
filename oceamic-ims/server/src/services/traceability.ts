import type pg from 'pg';
import { notFoundError } from '../errors.ts';
import { listMovements, type MovementRow } from './stockQueries.ts';

export type LotIdentityRow = Readonly<{
  id: string;
  lotCode: string;
  status: string;
  origin: string | null;
  tideNumber: string | null;
  captureDate: string | null;
  initialReceptionDate: string | null;
  notes: string | null;
  speciesCode: string;
  speciesName: string;
  supplierName: string | null;
  vesselName: string | null;
  parentLotId: string | null;
  parentLotCode: string | null;
  createdByName: string;
  createdAt: Date;
  totalStockKg: string;
  isBlocked: boolean;
}>;

export type LotStockRow = Readonly<{
  locationCode: string;
  locationName: string;
  stockType: string;
  physicalQuantityKg: string;
  blockedQuantityKg: string;
  availableQuantityKg: string;
}>;

export type LotReceptionRow = Readonly<{
  receptionCode: string;
  receivedAt: Date;
  quantityKg: string;
  receptionType: string;
  truckRegistration: string | null;
  tideNumber: string | null;
  documentReference: string | null;
  destinationLocationCode: string;
  supplierName: string | null;
  vesselName: string | null;
}>;

export type LotInspectionRow = Readonly<{
  inspectionCode: string;
  inspectedAt: Date;
  inspectionType: string;
  temperatureC: string | null;
  histaminePpm: string | null;
  abvt: string | null;
  qualityGrade: string | null;
  sizeGrade: string | null;
  result: string;
  notes: string | null;
  inspectorName: string;
}>;

export type LotDecisionRow = Readonly<{
  decisionType: string;
  reason: string;
  decidedAt: Date;
  notes: string | null;
  decidedByName: string;
  inspectionCode: string | null;
}>;

export type LotBlockRow = Readonly<{
  status: string;
  blockedAt: Date;
  reason: string;
  releasedAt: Date | null;
  releaseReason: string | null;
  blockedByName: string;
  releasedByName: string | null;
}>;

export type LotSubcontractingRow = Readonly<{
  operationCode: string;
  sentAt: Date;
  sourceType: string;
  quantitySentKg: string;
  status: string;
  subcontractorName: string;
  resultsKg: string;
  differenceKg: string;
}>;

export type LotChildRow = Readonly<{
  id: string;
  lotCode: string;
  status: string;
  stockKg: string;
}>;

export type LotRunUsageRow = Readonly<{
  runId: string;
  runCode: string;
  productionDate: string;
  runStatus: string;
  productCode: string;
  productName: string;
  consumedKg: string;
}>;

export type LotSituation = Readonly<{
  lot: LotIdentityRow;
  stockByLocation: readonly LotStockRow[];
  receptions: readonly LotReceptionRow[];
  movements: readonly MovementRow[];
  inspections: readonly LotInspectionRow[];
  decisions: readonly LotDecisionRow[];
  blocks: readonly LotBlockRow[];
  subcontracting: readonly LotSubcontractingRow[];
  children: readonly LotChildRow[];
  productionRuns: readonly LotRunUsageRow[];
}>;

/**
 * "Situation du lot": the single traceability screen of Phase 1. Everything
 * known about one lot is assembled here so operators never have to jump
 * between disconnected pages.
 */
export async function lotSituation(pool: pg.Pool, lotId: string): Promise<LotSituation> {
  const identity = await pool.query<LotIdentityRow>(
    `SELECT l.id                      AS "id",
            l.lot_code                AS "lotCode",
            l.status                  AS "status",
            l.origin                  AS "origin",
            l.tide_number             AS "tideNumber",
            l.capture_date            AS "captureDate",
            l.initial_reception_date  AS "initialReceptionDate",
            l.notes                   AS "notes",
            l.created_at              AS "createdAt",
            sp.code                   AS "speciesCode",
            sp.name                   AS "speciesName",
            sup.name                  AS "supplierName",
            v.name                    AS "vesselName",
            parent.id                 AS "parentLotId",
            parent.lot_code           AS "parentLotCode",
            u.full_name               AS "createdByName",
            COALESCE(stock.quantity_kg, 0)::numeric(14,3) AS "totalStockKg",
            EXISTS (SELECT 1 FROM blocked_lots b WHERE b.raw_material_lot_id = l.id) AS "isBlocked"
       FROM raw_material_lots l
       JOIN species sp ON sp.id = l.species_id
       JOIN users u ON u.id = l.created_by
       LEFT JOIN suppliers sup ON sup.id = l.supplier_id
       LEFT JOIN vessels v ON v.id = l.vessel_id
       LEFT JOIN raw_material_lots parent ON parent.id = l.parent_lot_id
       LEFT JOIN current_stock_by_lot stock ON stock.raw_material_lot_id = l.id
      WHERE l.id = $1`,
    [lotId],
  );
  const lot = identity.rows[0];
  if (!lot) {
    throw notFoundError('Lot matière première', lotId);
  }

  const [
    stockByLocation,
    receptions,
    inspections,
    decisions,
    blocks,
    subcontracting,
    children,
    productionRuns,
  ] = await Promise.all([
      pool.query<LotStockRow>(
        `SELECT loc.code            AS "locationCode",
                loc.name            AS "locationName",
                loc.stock_type      AS "stockType",
                s.physical_quantity_kg  AS "physicalQuantityKg",
                s.blocked_quantity_kg   AS "blockedQuantityKg",
                s.available_quantity_kg AS "availableQuantityKg"
           FROM available_stock s
           JOIN locations loc ON loc.id = s.location_id
          WHERE s.raw_material_lot_id = $1
          ORDER BY loc.code`,
        [lotId],
      ),
      pool.query<LotReceptionRow>(
        `SELECT r.reception_code   AS "receptionCode",
                r.received_at      AS "receivedAt",
                r.quantity_kg      AS "quantityKg",
                r.reception_type   AS "receptionType",
                r.truck_registration AS "truckRegistration",
                r.tide_number      AS "tideNumber",
                r.document_reference AS "documentReference",
                loc.code           AS "destinationLocationCode",
                sup.name           AS "supplierName",
                v.name             AS "vesselName"
           FROM raw_material_receptions r
           JOIN locations loc ON loc.id = r.destination_location_id
           LEFT JOIN suppliers sup ON sup.id = r.supplier_id
           LEFT JOIN vessels v ON v.id = r.vessel_id
          WHERE r.raw_material_lot_id = $1
          ORDER BY r.received_at DESC`,
        [lotId],
      ),
      pool.query<LotInspectionRow>(
        `SELECT i.inspection_code AS "inspectionCode",
                i.inspected_at    AS "inspectedAt",
                i.inspection_type AS "inspectionType",
                i.temperature_c   AS "temperatureC",
                i.histamine_ppm   AS "histaminePpm",
                i.abvt            AS "abvt",
                i.quality_grade   AS "qualityGrade",
                i.size_grade      AS "sizeGrade",
                i.result          AS "result",
                i.notes           AS "notes",
                u.full_name       AS "inspectorName"
           FROM quality_inspections i
           JOIN users u ON u.id = i.inspector_id
          WHERE i.raw_material_lot_id = $1
          ORDER BY i.inspected_at DESC`,
        [lotId],
      ),
      pool.query<LotDecisionRow>(
        `SELECT d.decision_type AS "decisionType",
                d.reason        AS "reason",
                d.decided_at    AS "decidedAt",
                d.notes         AS "notes",
                u.full_name     AS "decidedByName",
                i.inspection_code AS "inspectionCode"
           FROM quality_decisions d
           JOIN users u ON u.id = d.decided_by
           LEFT JOIN quality_inspections i ON i.id = d.inspection_id
          WHERE d.raw_material_lot_id = $1
          ORDER BY d.decided_at DESC`,
        [lotId],
      ),
      pool.query<LotBlockRow>(
        `SELECT b.status        AS "status",
                b.blocked_at    AS "blockedAt",
                b.reason        AS "reason",
                b.released_at   AS "releasedAt",
                b.release_reason AS "releaseReason",
                blocker.full_name AS "blockedByName",
                releaser.full_name AS "releasedByName"
           FROM lot_blocks b
           JOIN users blocker ON blocker.id = b.blocked_by
           LEFT JOIN users releaser ON releaser.id = b.released_by
          WHERE b.raw_material_lot_id = $1
          ORDER BY b.blocked_at DESC`,
        [lotId],
      ),
      pool.query<LotSubcontractingRow>(
        `SELECT o.operation_code   AS "operationCode",
                o.sent_at          AS "sentAt",
                o.source_type      AS "sourceType",
                o.quantity_sent_kg AS "quantitySentKg",
                o.status           AS "status",
                sc.name            AS "subcontractorName",
                bal.results_kg     AS "resultsKg",
                bal.difference_kg  AS "differenceKg"
           FROM subcontracting_operations o
           JOIN subcontractors sc ON sc.id = o.subcontractor_id
           JOIN subcontracting_material_balance bal ON bal.subcontracting_operation_id = o.id
          WHERE o.source_lot_id = $1
          ORDER BY o.sent_at DESC`,
        [lotId],
      ),
      pool.query<LotChildRow>(
        `SELECT c.id       AS "id",
                c.lot_code AS "lotCode",
                c.status   AS "status",
                COALESCE(stock.quantity_kg, 0)::numeric(14,3) AS "stockKg"
           FROM raw_material_lots c
           LEFT JOIN current_stock_by_lot stock ON stock.raw_material_lot_id = c.id
          WHERE c.parent_lot_id = $1
          ORDER BY c.lot_code`,
        [lotId],
      ),
      // Forward traceability: every production run that consumed this lot.
      pool.query<LotRunUsageRow>(
        `SELECT production_run_id AS "runId",
                run_code          AS "runCode",
                production_date   AS "productionDate",
                run_status        AS "runStatus",
                product_code      AS "productCode",
                product_name      AS "productName",
                consumed_kg       AS "consumedKg"
           FROM lot_production_usage
          WHERE raw_material_lot_id = $1
          ORDER BY production_date DESC, run_code DESC`,
        [lotId],
      ),
    ]);

  const movements = await listMovements(pool, {
    lotId,
    locationId: null,
    movementType: null,
    limit: 200,
  });

  return {
    lot,
    stockByLocation: stockByLocation.rows,
    receptions: receptions.rows,
    movements,
    inspections: inspections.rows,
    decisions: decisions.rows,
    blocks: blocks.rows,
    subcontracting: subcontracting.rows,
    children: children.rows,
    productionRuns: productionRuns.rows,
  };
}

export type SearchHit = Readonly<{
  kind: 'LOT' | 'RECEPTION' | 'SOUS_TRAITANCE' | 'MOUVEMENT' | 'RUN';
  label: string;
  detail: string;
  lotId: string;
}>;

/**
 * Global search. Every hit resolves to a lot, so the operator always lands on
 * "Situation du lot".
 */
export async function search(pool: pg.Pool, term: string): Promise<readonly SearchHit[]> {
  const result = await pool.query<SearchHit>(
    `SELECT 'LOT'::text AS kind, l.lot_code AS label,
            sp.code || ' - ' || COALESCE(sup.name, 'Fournisseur inconnu') AS detail,
            l.id AS "lotId"
       FROM raw_material_lots l
       JOIN species sp ON sp.id = l.species_id
       LEFT JOIN suppliers sup ON sup.id = l.supplier_id
      WHERE l.lot_code ILIKE '%' || $1 || '%'
         OR COALESCE(sup.name, '') ILIKE '%' || $1 || '%'
     UNION ALL
     SELECT 'RECEPTION', r.reception_code,
            'Camion ' || COALESCE(r.truck_registration, '-') || ' - ' || r.quantity_kg || ' kg',
            r.raw_material_lot_id
       FROM raw_material_receptions r
      WHERE r.reception_code ILIKE '%' || $1 || '%'
         OR COALESCE(r.truck_registration, '') ILIKE '%' || $1 || '%'
     UNION ALL
     SELECT 'SOUS_TRAITANCE', o.operation_code, sc.name, o.source_lot_id
       FROM subcontracting_operations o
       JOIN subcontractors sc ON sc.id = o.subcontractor_id
      WHERE (o.operation_code ILIKE '%' || $1 || '%' OR sc.name ILIKE '%' || $1 || '%')
        AND o.source_lot_id IS NOT NULL
     UNION ALL
     SELECT 'MOUVEMENT', m.movement_code, m.movement_type, m.raw_material_lot_id
       FROM stock_movements m
      WHERE m.movement_code ILIKE '%' || $1 || '%'
     UNION ALL
     SELECT 'RUN', u.run_code, u.product_name, u.raw_material_lot_id
       FROM lot_production_usage u
      WHERE u.run_code ILIKE '%' || $1 || '%'
      LIMIT 50`,
    [term],
  );
  return result.rows;
}
