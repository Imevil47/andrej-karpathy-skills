import type pg from 'pg';

// Read-only Phase 5 queries: packaging, Finished Goods Lots, pallets, PF
// stock, shipments, and forward/backward traceability. Every calculated
// figure is read from the migration 017 views, never recomputed here -
// the same discipline as Phase 4's processQueries.ts.

export type PackagingBatchRow = Readonly<{
  id: string;
  batchCode: string;
  productionRunId: string;
  runCode: string;
  productCode: string;
  productName: string;
  format: string | null;
  startedAt: string;
  endedAt: string | null;
  status: string;
  finishedGoodLotCount: number;
}>;

const PACKAGING_BATCH_QUERY = `
  SELECT b.id AS "id", b.batch_code AS "batchCode", b.production_run_id AS "productionRunId",
         r.run_code AS "runCode", p.code AS "productCode", p.name AS "productName",
         b.format AS "format", b.started_at AS "startedAt", b.ended_at AS "endedAt",
         b.status AS "status",
         COALESCE(lots.count, 0)::integer AS "finishedGoodLotCount"
    FROM packaging_batches b
    JOIN production_runs r ON r.id = b.production_run_id
    JOIN products p ON p.id = b.product_id
    LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM finished_good_lots fgl WHERE fgl.packaging_batch_id = b.id
    ) lots ON TRUE`;

export async function listPackagingBatches(
  pool: pg.Pool,
  filters: Readonly<{ runId: string | null; status: string | null; limit: number }>,
): Promise<readonly PackagingBatchRow[]> {
  const result = await pool.query<PackagingBatchRow>(
    `${PACKAGING_BATCH_QUERY}
      WHERE ($1::uuid IS NULL OR b.production_run_id = $1)
        AND ($2::text IS NULL OR b.status = $2)
      ORDER BY b.started_at DESC
      LIMIT $3`,
    [filters.runId, filters.status, filters.limit],
  );
  return result.rows;
}

export type PackagingOutputRow = Readonly<{
  id: string;
  finishedGoodLotId: string;
  lotCode: string;
  quantityCans: number;
  quantityCartons: number;
  unitsPerCarton: number;
  occurredAt: string;
  notes: string | null;
}>;

export type PackagingLabelCheckRow = Readonly<{
  id: string;
  finishedGoodLotId: string;
  lotCode: string;
  checkedAt: string;
  productCorrect: boolean;
  lotCorrect: boolean;
  dateCorrect: boolean;
  labelCorrect: boolean;
  result: string;
  checkedByName: string;
  notes: string | null;
}>;

export async function packagingBatchDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{
  batch: PackagingBatchRow;
  outputs: readonly PackagingOutputRow[];
  labelChecks: readonly PackagingLabelCheckRow[];
}> | null> {
  const batchResult = await pool.query<PackagingBatchRow>(`${PACKAGING_BATCH_QUERY} WHERE b.id = $1`, [id]);
  const batch = batchResult.rows[0];
  if (!batch) {
    return null;
  }
  const [outputs, labelChecks] = await Promise.all([
    pool.query<PackagingOutputRow>(
      `SELECT o.id AS "id", o.finished_good_lot_id AS "finishedGoodLotId", fgl.lot_code AS "lotCode",
              o.quantity_cans AS "quantityCans", o.quantity_cartons AS "quantityCartons",
              o.units_per_carton AS "unitsPerCarton", o.occurred_at AS "occurredAt", o.notes AS "notes"
         FROM packaging_outputs o
         JOIN finished_good_lots fgl ON fgl.id = o.finished_good_lot_id
        WHERE o.packaging_batch_id = $1
        ORDER BY o.occurred_at`,
      [id],
    ),
    pool.query<PackagingLabelCheckRow>(
      `SELECT c.id AS "id", c.finished_good_lot_id AS "finishedGoodLotId", fgl.lot_code AS "lotCode",
              c.checked_at AS "checkedAt", c.product_correct AS "productCorrect",
              c.lot_correct AS "lotCorrect", c.date_correct AS "dateCorrect",
              c.label_correct AS "labelCorrect", c.result AS "result", u.full_name AS "checkedByName",
              c.notes AS "notes"
         FROM packaging_label_checks c
         JOIN finished_good_lots fgl ON fgl.id = c.finished_good_lot_id
         JOIN users u ON u.id = c.checked_by
        WHERE c.packaging_batch_id = $1
        ORDER BY c.checked_at`,
      [id],
    ),
  ]);
  return { batch, outputs: outputs.rows, labelChecks: labelChecks.rows };
}

export type FinishedGoodLotRow = Readonly<{
  id: string;
  lotCode: string;
  packagingBatchId: string;
  batchCode: string;
  productionRunId: string;
  runCode: string;
  productCode: string;
  productName: string;
  format: string | null;
  piecesPerCan: number | null;
  productionDate: string;
  bestBeforeDate: string | null;
  qualityStatus: string;
  commercialStatus: string | null;
  physicalCartons: number;
  physicalUnits: number;
  blockedCartons: number;
  reservedCartons: number;
  availableCartons: number;
}>;

const FINISHED_GOOD_LOT_QUERY = `
  SELECT fgl.id AS "id", fgl.lot_code AS "lotCode", fgl.packaging_batch_id AS "packagingBatchId",
         b.batch_code AS "batchCode", fgl.production_run_id AS "productionRunId", r.run_code AS "runCode",
         p.code AS "productCode", p.name AS "productName", fgl.format AS "format",
         fgl.pieces_per_can AS "piecesPerCan", fgl.production_date AS "productionDate",
         fgl.best_before_date AS "bestBeforeDate", fgl.quality_status AS "qualityStatus",
         fgl.commercial_status AS "commercialStatus",
         COALESCE(sum.physical_cartons, 0)::integer AS "physicalCartons",
         COALESCE(sum.physical_units, 0)::integer AS "physicalUnits",
         COALESCE(sum.blocked_cartons, 0)::integer AS "blockedCartons",
         COALESCE(sum.reserved_cartons, 0)::integer AS "reservedCartons",
         (COALESCE(sum.physical_cartons, 0) - COALESCE(sum.blocked_cartons, 0)
           - COALESCE(sum.reserved_cartons, 0))::integer AS "availableCartons"
    FROM finished_good_lots fgl
    JOIN packaging_batches b ON b.id = fgl.packaging_batch_id
    JOIN production_runs r ON r.id = fgl.production_run_id
    JOIN products p ON p.id = fgl.product_id
    LEFT JOIN finished_good_lot_stock_summary sum ON sum.finished_good_lot_id = fgl.id`;

export async function listFinishedGoodLots(
  pool: pg.Pool,
  filters: Readonly<{
    search: string | null;
    productionRunId: string | null;
    qualityStatus: string | null;
    limit: number;
  }>,
): Promise<readonly FinishedGoodLotRow[]> {
  const result = await pool.query<FinishedGoodLotRow>(
    `${FINISHED_GOOD_LOT_QUERY}
      WHERE ($1::text IS NULL OR fgl.lot_code ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR fgl.production_run_id = $2)
        AND ($3::text IS NULL OR fgl.quality_status = $3)
      ORDER BY fgl.production_date DESC, fgl.lot_code DESC
      LIMIT $4`,
    [filters.search, filters.productionRunId, filters.qualityStatus, filters.limit],
  );
  return result.rows;
}

export type FinishedGoodLotSourceRow = Readonly<{
  sterilizationCycleId: string;
  cycleCode: string;
  productionRunId: string;
  runCode: string;
  quantityUnits: number | null;
}>;

export type FinishedGoodLotPalletRow = Readonly<{
  palletId: string;
  palletCode: string;
  status: string;
  qualityStatus: string;
  quantityCartons: number;
  quantityUnits: number;
  locationCode: string | null;
}>;

export type FinishedGoodLotShipmentRow = Readonly<{
  shipmentId: string;
  shipmentCode: string;
  status: string;
  customerName: string;
  containerNumber: string | null;
  palletCode: string;
  quantityCartons: number;
  shippedAt: string | null;
}>;

export type FgQualityDecisionRow = Readonly<{
  decisionType: string;
  reason: string;
  decidedAt: string;
  decidedByName: string;
  notes: string | null;
}>;

export type FgQualityBlockRow = Readonly<{
  status: string;
  blockedAt: string;
  reason: string;
  releasedAt: string | null;
  releaseReason: string | null;
}>;

export type FinishedGoodLotSituation = Readonly<{
  lot: FinishedGoodLotRow;
  sources: readonly FinishedGoodLotSourceRow[];
  pallets: readonly FinishedGoodLotPalletRow[];
  shipments: readonly FinishedGoodLotShipmentRow[];
  decisions: readonly FgQualityDecisionRow[];
  blocks: readonly FgQualityBlockRow[];
}>;

/**
 * "Situation du lot PF": the Phase 5 counterpart of Phase 1's lotSituation,
 * assembling everything known about one Lot PF - origin, pallets, stock,
 * shipments and quality - on one screen.
 */
export async function finishedGoodLotSituation(
  pool: pg.Pool,
  id: string,
): Promise<FinishedGoodLotSituation | null> {
  const lotResult = await pool.query<FinishedGoodLotRow>(`${FINISHED_GOOD_LOT_QUERY} WHERE fgl.id = $1`, [
    id,
  ]);
  const lot = lotResult.rows[0];
  if (!lot) {
    return null;
  }

  const [sources, pallets, shipments, decisions, blocks] = await Promise.all([
    pool.query<FinishedGoodLotSourceRow>(
      `SELECT s.sterilization_cycle_id AS "sterilizationCycleId", cy.cycle_code AS "cycleCode",
              s.production_run_id AS "productionRunId", r.run_code AS "runCode",
              s.quantity_units AS "quantityUnits"
         FROM finished_good_lot_sources s
         JOIN sterilization_cycles cy ON cy.id = s.sterilization_cycle_id
         JOIN production_runs r ON r.id = s.production_run_id
        WHERE s.finished_good_lot_id = $1
        ORDER BY cy.started_at`,
      [id],
    ),
    pool.query<FinishedGoodLotPalletRow>(
      `SELECT pc.pallet_id AS "palletId", p.pallet_code AS "palletCode", p.status AS "status",
              p.quality_status AS "qualityStatus", pc.quantity_cartons AS "quantityCartons",
              pc.quantity_units AS "quantityUnits", loc.code AS "locationCode"
         FROM pallet_contents pc
         JOIN pallets p ON p.id = pc.pallet_id
         LEFT JOIN pallet_stock_balance bal ON bal.pallet_id = p.id
         LEFT JOIN locations loc ON loc.id = bal.location_id
        WHERE pc.finished_good_lot_id = $1
        ORDER BY p.pallet_code`,
      [id],
    ),
    pool.query<FinishedGoodLotShipmentRow>(
      `SELECT sh.id AS "shipmentId", sh.shipment_code AS "shipmentCode", sh.status AS "status",
              c.name AS "customerName", sh.container_number AS "containerNumber",
              p.pallet_code AS "palletCode", sl.quantity_cartons AS "quantityCartons",
              sh.shipped_at AS "shippedAt"
         FROM shipment_lines sl
         JOIN shipments sh ON sh.id = sl.shipment_id
         JOIN customers c ON c.id = sh.customer_id
         JOIN pallets p ON p.id = sl.pallet_id
         JOIN pallet_contents pc ON pc.pallet_id = p.id AND pc.finished_good_lot_id = $1
        ORDER BY sh.planned_date DESC`,
      [id],
    ),
    pool.query<FgQualityDecisionRow>(
      `SELECT d.decision_type AS "decisionType", d.reason AS "reason", d.decided_at AS "decidedAt",
              u.full_name AS "decidedByName", d.notes AS "notes"
         FROM finished_goods_quality_decisions d
         JOIN users u ON u.id = d.decided_by
        WHERE d.entity_type = 'FINISHED_GOOD_LOT' AND d.entity_id = $1
        ORDER BY d.decided_at DESC`,
      [id],
    ),
    pool.query<FgQualityBlockRow>(
      `SELECT status AS "status", blocked_at AS "blockedAt", reason AS "reason",
              released_at AS "releasedAt", release_reason AS "releaseReason"
         FROM finished_goods_quality_blocks
        WHERE entity_type = 'FINISHED_GOOD_LOT' AND entity_id = $1
        ORDER BY blocked_at DESC`,
      [id],
    ),
  ]);

  return {
    lot,
    sources: sources.rows,
    pallets: pallets.rows,
    shipments: shipments.rows,
    decisions: decisions.rows,
    blocks: blocks.rows,
  };
}

export type PalletRow = Readonly<{
  id: string;
  palletCode: string;
  status: string;
  qualityStatus: string;
  locationId: string | null;
  locationCode: string | null;
  quantityCartons: number;
  quantityUnits: number;
  isReserved: boolean;
  reservedForShipmentId: string | null;
  lotCodes: readonly string[];
}>;

const PALLET_QUERY = `
  SELECT s.pallet_id AS "id", s.pallet_code AS "palletCode", s.status AS "status",
         s.quality_status AS "qualityStatus", s.location_id AS "locationId", s.location_code AS "locationCode",
         s.quantity_cartons::integer AS "quantityCartons", s.quantity_units::integer AS "quantityUnits",
         s.is_reserved AS "isReserved", s.reserved_for_shipment_id AS "reservedForShipmentId",
         COALESCE(lots.lot_codes, ARRAY[]::text[]) AS "lotCodes"
    FROM pallet_summary s
    LEFT JOIN LATERAL (
          SELECT array_agg(fgl.lot_code ORDER BY fgl.lot_code) AS lot_codes
            FROM pallet_contents pc
            JOIN finished_good_lots fgl ON fgl.id = pc.finished_good_lot_id
           WHERE pc.pallet_id = s.pallet_id
    ) lots ON TRUE`;

export async function listPallets(
  pool: pg.Pool,
  filters: Readonly<{
    search: string | null;
    status: string | null;
    qualityStatus: string | null;
    locationId: string | null;
    limit: number;
  }>,
): Promise<readonly PalletRow[]> {
  const result = await pool.query<PalletRow>(
    `${PALLET_QUERY}
      WHERE ($1::text IS NULL OR s.pallet_code ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR s.status = $2)
        AND ($3::text IS NULL OR s.quality_status = $3)
        AND ($4::uuid IS NULL OR s.location_id = $4)
      ORDER BY s.pallet_code DESC
      LIMIT $5`,
    [filters.search, filters.status, filters.qualityStatus, filters.locationId, filters.limit],
  );
  return result.rows;
}

export type PalletContentRow = Readonly<{
  finishedGoodLotId: string;
  lotCode: string;
  productCode: string;
  productName: string;
  quantityCartons: number;
  quantityUnits: number;
}>;

export type PalletMovementRow = Readonly<{
  movementCode: string;
  occurredAt: string;
  movementType: string;
  sourceLocationCode: string | null;
  destinationLocationCode: string | null;
  quantityCartons: number;
  quantityUnits: number;
  reason: string | null;
}>;

export type PalletSituation = Readonly<{
  pallet: PalletRow;
  contents: readonly PalletContentRow[];
  movements: readonly PalletMovementRow[];
  decisions: readonly FgQualityDecisionRow[];
  blocks: readonly FgQualityBlockRow[];
  shipments: readonly FinishedGoodLotShipmentRow[];
}>;

export async function palletSituation(pool: pg.Pool, id: string): Promise<PalletSituation | null> {
  const palletResult = await pool.query<PalletRow>(`${PALLET_QUERY} WHERE s.pallet_id = $1`, [id]);
  const pallet = palletResult.rows[0];
  if (!pallet) {
    return null;
  }

  const [contents, movements, decisions, blocks, shipments] = await Promise.all([
    pool.query<PalletContentRow>(
      `SELECT pc.finished_good_lot_id AS "finishedGoodLotId", fgl.lot_code AS "lotCode",
              p.code AS "productCode", p.name AS "productName",
              pc.quantity_cartons AS "quantityCartons", pc.quantity_units AS "quantityUnits"
         FROM pallet_contents pc
         JOIN finished_good_lots fgl ON fgl.id = pc.finished_good_lot_id
         JOIN products p ON p.id = fgl.product_id
        WHERE pc.pallet_id = $1
        ORDER BY fgl.lot_code`,
      [id],
    ),
    pool.query<PalletMovementRow>(
      `SELECT m.movement_code AS "movementCode", m.occurred_at AS "occurredAt",
              m.movement_type AS "movementType", src.code AS "sourceLocationCode",
              dst.code AS "destinationLocationCode", m.quantity_cartons::integer AS "quantityCartons",
              m.quantity_units::integer AS "quantityUnits", m.reason AS "reason"
         FROM finished_goods_stock_movements m
         LEFT JOIN locations src ON src.id = m.source_location_id
         LEFT JOIN locations dst ON dst.id = m.destination_location_id
        WHERE m.pallet_id = $1
        ORDER BY m.occurred_at DESC`,
      [id],
    ),
    pool.query<FgQualityDecisionRow>(
      `SELECT d.decision_type AS "decisionType", d.reason AS "reason", d.decided_at AS "decidedAt",
              u.full_name AS "decidedByName", d.notes AS "notes"
         FROM finished_goods_quality_decisions d
         JOIN users u ON u.id = d.decided_by
        WHERE d.entity_type = 'PALLET' AND d.entity_id = $1
        ORDER BY d.decided_at DESC`,
      [id],
    ),
    pool.query<FgQualityBlockRow>(
      `SELECT status AS "status", blocked_at AS "blockedAt", reason AS "reason",
              released_at AS "releasedAt", release_reason AS "releaseReason"
         FROM finished_goods_quality_blocks
        WHERE entity_type = 'PALLET' AND entity_id = $1
        ORDER BY blocked_at DESC`,
      [id],
    ),
    pool.query<FinishedGoodLotShipmentRow>(
      `SELECT sh.id AS "shipmentId", sh.shipment_code AS "shipmentCode", sh.status AS "status",
              c.name AS "customerName", sh.container_number AS "containerNumber",
              p.pallet_code AS "palletCode", sl.quantity_cartons AS "quantityCartons",
              sh.shipped_at AS "shippedAt"
         FROM shipment_lines sl
         JOIN shipments sh ON sh.id = sl.shipment_id
         JOIN customers c ON c.id = sh.customer_id
         JOIN pallets p ON p.id = sl.pallet_id
        WHERE sl.pallet_id = $1
        ORDER BY sh.planned_date DESC`,
      [id],
    ),
  ]);

  return {
    pallet,
    contents: contents.rows,
    movements: movements.rows,
    decisions: decisions.rows,
    blocks: blocks.rows,
    shipments: shipments.rows,
  };
}

export type FgStockSummaryCards = Readonly<{
  totalCartons: number;
  availableCartons: number;
  blockedCartons: number;
  reservedCartons: number;
}>;

export async function fgStockSummaryCards(pool: pg.Pool): Promise<FgStockSummaryCards> {
  const result = await pool.query<{
    total: string;
    blocked: string;
    reserved: string;
  }>(
    `SELECT COALESCE(SUM(physical_cartons), 0)::text AS total,
            COALESCE(SUM(blocked_cartons), 0)::text AS blocked,
            COALESCE(SUM(reserved_cartons), 0)::text AS reserved
       FROM finished_good_lot_stock_summary`,
  );
  const row = result.rows[0];
  const total = Number(row?.total ?? '0');
  const blocked = Number(row?.blocked ?? '0');
  const reserved = Number(row?.reserved ?? '0');
  return {
    totalCartons: total,
    blockedCartons: blocked,
    reservedCartons: reserved,
    availableCartons: total - blocked - reserved,
  };
}

export type FgStockByLocationRow = Readonly<{
  locationId: string;
  locationCode: string;
  productCode: string;
  quantityCartons: number;
  quantityUnits: number;
}>;

export async function fgStockByLocation(pool: pg.Pool): Promise<readonly FgStockByLocationRow[]> {
  const result = await pool.query<FgStockByLocationRow>(
    `SELECT location_id AS "locationId", location_code AS "locationCode", product_code AS "productCode",
            quantity_cartons::integer AS "quantityCartons", quantity_units::integer AS "quantityUnits"
       FROM fg_stock_by_location
      ORDER BY location_code, product_code`,
  );
  return result.rows;
}

export type ShipmentRow = Readonly<{
  id: string;
  shipmentCode: string;
  plannedDate: string;
  shippedAt: string | null;
  customerName: string;
  destination: string;
  containerNumber: string | null;
  status: string;
  palletCount: number;
}>;

const SHIPMENT_QUERY = `
  SELECT sh.id AS "id", sh.shipment_code AS "shipmentCode", sh.planned_date AS "plannedDate",
         sh.shipped_at AS "shippedAt", c.name AS "customerName", sh.destination AS "destination",
         sh.container_number AS "containerNumber", sh.status AS "status",
         COALESCE(lines.count, 0)::integer AS "palletCount"
    FROM shipments sh
    JOIN customers c ON c.id = sh.customer_id
    LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM shipment_lines sl WHERE sl.shipment_id = sh.id
    ) lines ON TRUE`;

export async function listShipments(
  pool: pg.Pool,
  filters: Readonly<{
    search: string | null;
    customerId: string | null;
    status: string | null;
    limit: number;
  }>,
): Promise<readonly ShipmentRow[]> {
  const result = await pool.query<ShipmentRow>(
    `${SHIPMENT_QUERY}
      WHERE ($1::text IS NULL OR sh.shipment_code ILIKE '%' || $1 || '%'
             OR sh.container_number ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR sh.customer_id = $2)
        AND ($3::text IS NULL OR sh.status = $3)
      ORDER BY sh.planned_date DESC
      LIMIT $4`,
    [filters.search, filters.customerId, filters.status, filters.limit],
  );
  return result.rows;
}

export type ShipmentLineRow = Readonly<{
  palletId: string;
  palletCode: string;
  lotCode: string | null;
  quantityCartons: number;
  quantityUnits: number;
  qualityStatus: string;
  reservationStatus: string | null;
}>;

export type ShipmentDetail = Readonly<{
  shipment: ShipmentRow & {
    containerNumber: string | null;
    sealNumber: string | null;
    vehicleRegistration: string | null;
    targetTemperatureC: string | null;
    gensetRequired: boolean | null;
    cancellationReason: string | null;
    notes: string | null;
  };
  lines: readonly ShipmentLineRow[];
}>;

export async function shipmentDetail(pool: pg.Pool, id: string): Promise<ShipmentDetail | null> {
  const shipmentResult = await pool.query<ShipmentDetail['shipment']>(
    `SELECT sh.id AS "id", sh.shipment_code AS "shipmentCode", sh.planned_date AS "plannedDate",
            sh.shipped_at AS "shippedAt", c.name AS "customerName", sh.destination AS "destination",
            sh.container_number AS "containerNumber", sh.status AS "status",
            COALESCE(lines.count, 0)::integer AS "palletCount",
            sh.seal_number AS "sealNumber", sh.vehicle_registration AS "vehicleRegistration",
            sh.target_temperature_c::text AS "targetTemperatureC", sh.genset_required AS "gensetRequired",
            sh.cancellation_reason AS "cancellationReason", sh.notes AS "notes"
       FROM shipments sh
       JOIN customers c ON c.id = sh.customer_id
       LEFT JOIN LATERAL (
             SELECT COUNT(*) AS count FROM shipment_lines sl WHERE sl.shipment_id = sh.id
       ) lines ON TRUE
      WHERE sh.id = $1`,
    [id],
  );
  const shipment = shipmentResult.rows[0];
  if (!shipment) {
    return null;
  }

  const lines = await pool.query<ShipmentLineRow>(
    `SELECT sl.pallet_id AS "palletId", p.pallet_code AS "palletCode", fgl.lot_code AS "lotCode",
            sl.quantity_cartons::integer AS "quantityCartons", sl.quantity_units::integer AS "quantityUnits",
            p.quality_status AS "qualityStatus", r.status AS "reservationStatus"
       FROM shipment_lines sl
       JOIN pallets p ON p.id = sl.pallet_id
       LEFT JOIN finished_good_lots fgl ON fgl.id = sl.finished_good_lot_id
       LEFT JOIN stock_reservations r ON r.shipment_id = sl.shipment_id AND r.pallet_id = sl.pallet_id
      WHERE sl.shipment_id = $1
      ORDER BY p.pallet_code`,
    [id],
  );

  return { shipment, lines: lines.rows };
}

// --- Forward / backward traceability (sections 32-34) -----------------------

export type ForwardTraceabilityRow = Readonly<{
  rawMaterialLotId: string;
  rawMaterialLotCode: string;
  productionRunId: string;
  runCode: string;
  sterilizationCycleId: string;
  cycleCode: string;
  finishedGoodLotId: string;
  finishedGoodLotCode: string;
  palletId: string | null;
  palletCode: string | null;
  quantityCartons: number | null;
  shipmentId: string | null;
  shipmentCode: string | null;
  customerId: string | null;
  customerName: string | null;
  shippedAt: string | null;
}>;

/**
 * Forward traceability (section 32): Lot MP -> Runs -> Cycles -> Lots PF ->
 * Pallets -> Shipments -> Customer. Used to answer "if this raw-material lot
 * has a problem, which customers are affected" (section 63), and reused by
 * Phase 6's recall impact analysis (section 33).
 */
export async function forwardTraceabilityFromRawMaterialLot(
  pool: pg.Pool,
  rawMaterialLotId: string,
): Promise<readonly ForwardTraceabilityRow[]> {
  const result = await pool.query<ForwardTraceabilityRow>(
    `SELECT DISTINCT lot.id AS "rawMaterialLotId", lot.lot_code AS "rawMaterialLotCode",
            r.id AS "productionRunId", r.run_code AS "runCode",
            cy.id AS "sterilizationCycleId", cy.cycle_code AS "cycleCode",
            fgl.id AS "finishedGoodLotId", fgl.lot_code AS "finishedGoodLotCode",
            pal.id AS "palletId", pal.pallet_code AS "palletCode",
            pc.quantity_cartons::integer AS "quantityCartons",
            sh.id AS "shipmentId", sh.shipment_code AS "shipmentCode",
            c.id AS "customerId", c.name AS "customerName", sh.shipped_at AS "shippedAt"
       FROM raw_material_lots lot
       JOIN production_run_materials m ON m.raw_material_lot_id = lot.id
       JOIN production_runs r ON r.id = m.production_run_id
       JOIN finished_good_lot_sources src ON src.production_run_id = r.id
       JOIN sterilization_cycles cy ON cy.id = src.sterilization_cycle_id
       JOIN finished_good_lots fgl ON fgl.id = src.finished_good_lot_id
       LEFT JOIN pallet_contents pc ON pc.finished_good_lot_id = fgl.id
       LEFT JOIN pallets pal ON pal.id = pc.pallet_id
       LEFT JOIN shipment_lines sl ON sl.pallet_id = pal.id
       LEFT JOIN shipments sh ON sh.id = sl.shipment_id
       LEFT JOIN customers c ON c.id = sh.customer_id
      WHERE lot.id = $1
      ORDER BY r.run_code, fgl.lot_code, pal.pallet_code`,
    [rawMaterialLotId],
  );
  return result.rows;
}

export type FinishedGoodLotTraceabilityRow = Readonly<{
  finishedGoodLotId: string;
  finishedGoodLotCode: string;
  productionRunId: string;
  runCode: string;
  sterilizationCycleId: string;
  cycleCode: string;
  palletId: string | null;
  palletCode: string | null;
  quantityCartons: number | null;
  shipmentId: string | null;
  shipmentCode: string | null;
  customerId: string | null;
  customerName: string | null;
  shippedAt: string | null;
}>;

/**
 * Symmetric to forwardTraceabilityFromRawMaterialLot, anchored on a Lot PF
 * instead of a raw-material lot (section 34): upstream Run(s)/cycle(s) and
 * downstream pallets/shipments/customers in one query, reused by the recall
 * impact analysis when the recall target is a Lot PF (section 34/38).
 */
export async function traceabilityFromFinishedGoodLot(
  pool: pg.Pool,
  finishedGoodLotId: string,
): Promise<readonly FinishedGoodLotTraceabilityRow[]> {
  const result = await pool.query<FinishedGoodLotTraceabilityRow>(
    `SELECT DISTINCT fgl.id AS "finishedGoodLotId", fgl.lot_code AS "finishedGoodLotCode",
            r.id AS "productionRunId", r.run_code AS "runCode",
            cy.id AS "sterilizationCycleId", cy.cycle_code AS "cycleCode",
            pal.id AS "palletId", pal.pallet_code AS "palletCode",
            pc.quantity_cartons::integer AS "quantityCartons",
            sh.id AS "shipmentId", sh.shipment_code AS "shipmentCode",
            c.id AS "customerId", c.name AS "customerName", sh.shipped_at AS "shippedAt"
       FROM finished_good_lots fgl
       JOIN finished_good_lot_sources src ON src.finished_good_lot_id = fgl.id
       JOIN production_runs r ON r.id = src.production_run_id
       JOIN sterilization_cycles cy ON cy.id = src.sterilization_cycle_id
       LEFT JOIN pallet_contents pc ON pc.finished_good_lot_id = fgl.id
       LEFT JOIN pallets pal ON pal.id = pc.pallet_id
       LEFT JOIN shipment_lines sl ON sl.pallet_id = pal.id
       LEFT JOIN shipments sh ON sh.id = sl.shipment_id
       LEFT JOIN customers c ON c.id = sh.customer_id
      WHERE fgl.id = $1
      ORDER BY r.run_code, pal.pallet_code`,
    [finishedGoodLotId],
  );
  return result.rows;
}

export type BackwardTraceabilityRow = Readonly<{
  shipmentId: string;
  shipmentCode: string;
  containerNumber: string | null;
  customerName: string;
  palletId: string;
  palletCode: string;
  finishedGoodLotId: string;
  finishedGoodLotCode: string;
  productionRunId: string;
  runCode: string;
  sterilizationCycleId: string;
  cycleCode: string;
  rawMaterialLotId: string;
  rawMaterialLotCode: string;
  supplierName: string | null;
  vesselName: string | null;
}>;

/**
 * Backward traceability (section 33): Shipment/Container -> Pallets -> Lots
 * PF -> Sterilization -> Runs -> Lots MP -> Supplier/Vessel/Reception.
 */
export async function backwardTraceabilityFromShipment(
  pool: pg.Pool,
  shipmentId: string,
): Promise<readonly BackwardTraceabilityRow[]> {
  const result = await pool.query<BackwardTraceabilityRow>(
    `SELECT DISTINCT sh.id AS "shipmentId", sh.shipment_code AS "shipmentCode",
            sh.container_number AS "containerNumber", c.name AS "customerName",
            pal.id AS "palletId", pal.pallet_code AS "palletCode",
            fgl.id AS "finishedGoodLotId", fgl.lot_code AS "finishedGoodLotCode",
            r.id AS "productionRunId", r.run_code AS "runCode",
            cy.id AS "sterilizationCycleId", cy.cycle_code AS "cycleCode",
            lot.id AS "rawMaterialLotId", lot.lot_code AS "rawMaterialLotCode",
            sup.name AS "supplierName", v.name AS "vesselName"
       FROM shipments sh
       JOIN customers c ON c.id = sh.customer_id
       JOIN shipment_lines sl ON sl.shipment_id = sh.id
       JOIN pallets pal ON pal.id = sl.pallet_id
       JOIN pallet_contents pc ON pc.pallet_id = pal.id
       JOIN finished_good_lots fgl ON fgl.id = pc.finished_good_lot_id
       JOIN finished_good_lot_sources src ON src.finished_good_lot_id = fgl.id
       JOIN sterilization_cycles cy ON cy.id = src.sterilization_cycle_id
       JOIN production_runs r ON r.id = src.production_run_id
       JOIN production_run_materials m ON m.production_run_id = r.id
       JOIN raw_material_lots lot ON lot.id = m.raw_material_lot_id
       LEFT JOIN suppliers sup ON sup.id = lot.supplier_id
       LEFT JOIN vessels v ON v.id = lot.vessel_id
      WHERE sh.id = $1
      ORDER BY pal.pallet_code, fgl.lot_code, lot.lot_code`,
    [shipmentId],
  );
  return result.rows;
}

export async function backwardTraceabilityFromContainer(
  pool: pg.Pool,
  containerNumber: string,
): Promise<readonly BackwardTraceabilityRow[]> {
  const shipment = await pool.query<{ id: string }>(
    'SELECT id FROM shipments WHERE container_number = $1',
    [containerNumber],
  );
  const shipmentId = shipment.rows[0]?.id;
  if (!shipmentId) {
    return [];
  }
  return backwardTraceabilityFromShipment(pool, shipmentId);
}

export type Phase5HomeSummary = Readonly<{
  availableCartons: number;
  blockedFinishedGoodLots: number;
  shipmentsInPreparation: number;
  palletsToLoad: number;
}>;

export async function phase5HomeSummary(pool: pg.Pool): Promise<Phase5HomeSummary> {
  const [stock, result] = await Promise.all([
    fgStockSummaryCards(pool),
    pool.query<{ blocked_lots: string; shipments_in_prep: string; pallets_to_load: string }>(
      `SELECT
          (SELECT COUNT(*) FROM finished_good_lots WHERE quality_status = 'BLOQUE')::text AS blocked_lots,
          (SELECT COUNT(*) FROM shipments
            WHERE status IN ('PLANIFIEE', 'EN_PREPARATION'))::text AS shipments_in_prep,
          (SELECT COUNT(*) FROM pallets WHERE status = 'EN_STOCK')::text AS pallets_to_load`,
    ),
  ]);
  const row = result.rows[0];
  return {
    availableCartons: stock.availableCartons,
    blockedFinishedGoodLots: Number(row?.blocked_lots ?? '0'),
    shipmentsInPreparation: Number(row?.shipments_in_prep ?? '0'),
    palletsToLoad: Number(row?.pallets_to_load ?? '0'),
  };
}
