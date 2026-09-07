import type pg from 'pg';
import type { StockType } from '../domain/types.ts';

export type StockSituationFilters = Readonly<{
  lotSearch: string | null;
  speciesId: string | null;
  locationId: string | null;
  stockType: StockType | null;
  onlyBlocked: boolean;
}>;

export type StockSituationRow = Readonly<{
  lotId: string;
  lotCode: string;
  speciesCode: string;
  speciesName: string;
  sizeGrade: string | null;
  qualityGrade: string | null;
  locationId: string;
  locationCode: string;
  locationName: string;
  stockType: StockType;
  physicalQuantityKg: string;
  availableQuantityKg: string;
  isBlocked: boolean;
}>;

/**
 * Stock situation. The quantities always come from the database views: the
 * inventory calculation is never duplicated in the client or in JavaScript.
 * The last known size/quality grade comes from the most recent inspection of
 * the lot, so the operator sees what the quality department observed.
 */
export async function stockSituation(
  pool: pg.Pool,
  filters: StockSituationFilters,
): Promise<readonly StockSituationRow[]> {
  const result = await pool.query<StockSituationRow>(
    `SELECT s.raw_material_lot_id       AS "lotId",
            lot.lot_code                AS "lotCode",
            sp.code                     AS "speciesCode",
            sp.name                     AS "speciesName",
            last_inspection.size_grade  AS "sizeGrade",
            last_inspection.quality_grade AS "qualityGrade",
            loc.id                      AS "locationId",
            loc.code                    AS "locationCode",
            loc.name                    AS "locationName",
            loc.stock_type              AS "stockType",
            s.physical_quantity_kg      AS "physicalQuantityKg",
            s.available_quantity_kg     AS "availableQuantityKg",
            s.is_blocked                AS "isBlocked"
       FROM available_stock s
       JOIN raw_material_lots lot ON lot.id = s.raw_material_lot_id
       JOIN species sp ON sp.id = lot.species_id
       JOIN locations loc ON loc.id = s.location_id
       LEFT JOIN LATERAL (
            SELECT i.size_grade, i.quality_grade
              FROM quality_inspections i
             WHERE i.raw_material_lot_id = lot.id
             ORDER BY i.inspected_at DESC
             LIMIT 1
       ) last_inspection ON TRUE
      WHERE ($1::text IS NULL OR lot.lot_code ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR lot.species_id = $2)
        AND ($3::uuid IS NULL OR loc.id = $3)
        AND ($4::text IS NULL OR loc.stock_type = $4)
        AND ($5::boolean IS FALSE OR s.is_blocked IS TRUE)
      ORDER BY lot.lot_code, loc.code`,
    [
      filters.lotSearch,
      filters.speciesId,
      filters.locationId,
      filters.stockType,
      filters.onlyBlocked,
    ],
  );
  return result.rows;
}

export type MovementListFilters = Readonly<{
  lotId: string | null;
  locationId: string | null;
  movementType: string | null;
  limit: number;
}>;

export type MovementRow = Readonly<{
  id: string;
  movementCode: string;
  occurredAt: Date;
  movementType: string;
  quantityKg: string;
  referenceType: string;
  reason: string | null;
  notes: string | null;
  lotId: string;
  lotCode: string;
  sourceLocationCode: string | null;
  destinationLocationCode: string | null;
  createdByName: string;
  reversedByCode: string | null;
  isReversal: boolean;
}>;

export async function listMovements(
  pool: pg.Pool,
  filters: MovementListFilters,
): Promise<readonly MovementRow[]> {
  const result = await pool.query<MovementRow>(
    `SELECT m.id                  AS "id",
            m.movement_code       AS "movementCode",
            m.occurred_at         AS "occurredAt",
            m.movement_type       AS "movementType",
            m.quantity_kg         AS "quantityKg",
            m.reference_type      AS "referenceType",
            m.reason              AS "reason",
            m.notes               AS "notes",
            lot.id                AS "lotId",
            lot.lot_code          AS "lotCode",
            src.code              AS "sourceLocationCode",
            dst.code              AS "destinationLocationCode",
            u.full_name           AS "createdByName",
            reversal.movement_code AS "reversedByCode",
            m.reverses_movement_id IS NOT NULL AS "isReversal"
       FROM stock_movements m
       JOIN raw_material_lots lot ON lot.id = m.raw_material_lot_id
       JOIN users u ON u.id = m.created_by
       LEFT JOIN locations src ON src.id = m.source_location_id
       LEFT JOIN locations dst ON dst.id = m.destination_location_id
       LEFT JOIN stock_movements reversal ON reversal.reverses_movement_id = m.id
      WHERE ($1::uuid IS NULL OR m.raw_material_lot_id = $1)
        AND ($2::uuid IS NULL OR m.source_location_id = $2 OR m.destination_location_id = $2)
        AND ($3::text IS NULL OR m.movement_type = $3)
      ORDER BY m.occurred_at DESC, m.movement_code DESC
      LIMIT $4`,
    [filters.lotId, filters.locationId, filters.movementType, filters.limit],
  );
  return result.rows;
}

export type LocationStockRow = Readonly<{
  locationCode: string;
  locationName: string;
  stockType: StockType;
  quantityKg: string;
}>;

export type StockSummary = Readonly<{
  internalKg: string;
  externalKg: string;
  totalKg: string;
  byLocation: readonly LocationStockRow[];
}>;

export async function stockSummary(pool: pg.Pool): Promise<StockSummary> {
  const totals = await pool.query<{ internal_kg: string; external_kg: string; total_kg: string }>(
    `SELECT COALESCE((SELECT SUM(quantity_kg) FROM internal_stock_summary), 0)::numeric(14,3) AS internal_kg,
            COALESCE((SELECT SUM(quantity_kg) FROM external_stock_summary), 0)::numeric(14,3) AS external_kg,
            COALESCE((SELECT SUM(quantity_kg) FROM current_stock_by_lot), 0)::numeric(14,3) AS total_kg`,
  );
  const byLocation = await pool.query<LocationStockRow>(
    `SELECT l.code AS "locationCode",
            l.name AS "locationName",
            l.stock_type AS "stockType",
            SUM(s.quantity_kg)::numeric(14,3) AS "quantityKg"
       FROM current_stock_by_lot_location s
       JOIN locations l ON l.id = s.location_id
      GROUP BY l.code, l.name, l.stock_type
      ORDER BY l.stock_type, l.code`,
  );
  const row = totals.rows[0];
  return {
    internalKg: row?.internal_kg ?? '0.000',
    externalKg: row?.external_kg ?? '0.000',
    totalKg: row?.total_kg ?? '0.000',
    byLocation: byLocation.rows,
  };
}
