import type pg from 'pg';
import type { DatabaseClient } from '../db/pool.ts';
import type { LotStatus } from '../domain/types.ts';
import type { QuantityKg } from '../domain/quantity.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { createStockMovement } from './stock.ts';

export type LotIdentityInput = Readonly<{
  lotCode: string | null;
  speciesId: string;
  supplierId: string | null;
  vesselId: string | null;
  origin: string | null;
  tideNumber: string | null;
  captureDate: string | null;
  initialReceptionDate: string | null;
  parentLotId: string | null;
  notes: string | null;
}>;

export type RawMaterialLot = Readonly<{
  id: string;
  lotCode: string;
  speciesId: string;
  status: LotStatus;
}>;

type LotRow = { id: string; lot_code: string; species_id: string; status: LotStatus };

export async function createLot(
  client: DatabaseClient,
  input: LotIdentityInput,
  actorId: string,
): Promise<RawMaterialLot> {
  const lotCode =
    input.lotCode === null || input.lotCode.trim() === ''
      ? await nextOperationalCode(client, 'LOT', new Date())
      : input.lotCode.trim().toUpperCase();

  const duplicate = await client.query<{ id: string }>(
    'SELECT id FROM raw_material_lots WHERE lot_code = $1',
    [lotCode],
  );
  if (duplicate.rows.length > 0) {
    throw conflictError(`Le code lot ${lotCode} existe déjà.`, { lotCode });
  }

  const inserted = await client.query<LotRow>(
    `INSERT INTO raw_material_lots (lot_code, species_id, supplier_id, vessel_id, origin,
                                    tide_number, capture_date, initial_reception_date,
                                    parent_lot_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, lot_code, species_id, status`,
    [
      lotCode,
      input.speciesId,
      input.supplierId,
      input.vesselId,
      input.origin,
      input.tideNumber,
      input.captureDate,
      input.initialReceptionDate,
      input.parentLotId,
      input.notes,
      actorId,
    ],
  );

  const row = inserted.rows[0];
  if (!row) {
    throw new Error("Le lot n'a pas pu être créé.");
  }

  await recordAudit(client, {
    userId: actorId,
    action: 'LOT_CREATION',
    entityType: 'raw_material_lots',
    entityId: row.id,
    oldValues: null,
    newValues: { lotCode: row.lot_code, speciesId: input.speciesId, parentLotId: input.parentLotId },
    context: null,
  });

  return { id: row.id, lotCode: row.lot_code, speciesId: row.species_id, status: row.status };
}

export async function requireLot(client: DatabaseClient, lotId: string): Promise<RawMaterialLot> {
  const result = await client.query<LotRow>(
    'SELECT id, lot_code, species_id, status FROM raw_material_lots WHERE id = $1',
    [lotId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Lot matière première', lotId);
  }
  return { id: row.id, lotCode: row.lot_code, speciesId: row.species_id, status: row.status };
}

/**
 * Recomputes the cached operational status of a lot. The status is never an
 * independent truth: quality blocking comes from lot_blocks and quantities come
 * from the movement ledger. This function only mirrors them onto the lot so
 * that lists and filters stay fast.
 */
export async function refreshLotStatus(client: DatabaseClient, lotId: string): Promise<LotStatus> {
  const result = await client.query<{ status: LotStatus }>(
    `WITH facts AS (
        SELECT EXISTS (SELECT 1 FROM blocked_lots b WHERE b.raw_material_lot_id = $1) AS is_blocked,
               EXISTS (SELECT 1 FROM raw_material_lots c WHERE c.parent_lot_id = $1) AS has_children,
               EXISTS (SELECT 1 FROM stock_movements m WHERE m.raw_material_lot_id = $1) AS has_movements,
               COALESCE((SELECT quantity_kg FROM current_stock_by_lot WHERE raw_material_lot_id = $1), 0) AS stock_kg
     )
     UPDATE raw_material_lots l
        SET status = CASE
                       WHEN facts.is_blocked THEN 'BLOQUE'
                       WHEN facts.has_children AND facts.stock_kg <= 0 THEN 'FRACTIONNE'
                       WHEN facts.has_movements AND facts.stock_kg <= 0 THEN 'EPUISE'
                       ELSE 'ACTIF'
                     END,
            updated_at = now()
       FROM facts
      WHERE l.id = $1
      RETURNING l.status`,
    [lotId],
  );
  const status = result.rows[0]?.status;
  if (!status) {
    throw notFoundError('Lot matière première', lotId);
  }
  return status;
}

export type FractionLotInput = Readonly<{
  parentLotId: string;
  locationId: string;
  quantityKg: QuantityKg;
  childLotCode: string | null;
  notes: string | null;
}>;

/**
 * Splits a quantity of a parent lot into a new child lot at the same location.
 * The quantity is not duplicated: it leaves the parent and enters the child
 * through two movements of the same ledger.
 */
export async function fractionLot(
  client: DatabaseClient,
  input: FractionLotInput,
  actorId: string,
): Promise<RawMaterialLot> {
  const parent = await client.query<{
    id: string;
    lot_code: string;
    species_id: string;
    supplier_id: string | null;
    vessel_id: string | null;
    origin: string | null;
    tide_number: string | null;
    capture_date: string | null;
    initial_reception_date: string | null;
  }>(
    `SELECT id, lot_code, species_id, supplier_id, vessel_id, origin, tide_number,
            capture_date, initial_reception_date
       FROM raw_material_lots WHERE id = $1`,
    [input.parentLotId],
  );
  const parentRow = parent.rows[0];
  if (!parentRow) {
    throw notFoundError('Lot matière première', input.parentLotId);
  }

  const child = await createLot(
    client,
    {
      lotCode: input.childLotCode,
      speciesId: parentRow.species_id,
      supplierId: parentRow.supplier_id,
      vesselId: parentRow.vessel_id,
      origin: parentRow.origin,
      tideNumber: parentRow.tide_number,
      captureDate: parentRow.capture_date,
      initialReceptionDate: parentRow.initial_reception_date,
      parentLotId: parentRow.id,
      notes: input.notes,
    },
    actorId,
  );

  const occurredAt = new Date();
  await createStockMovement(
    client,
    {
      lotId: parentRow.id,
      movementType: 'FRACTIONNEMENT',
      sourceLocationId: input.locationId,
      destinationLocationId: null,
      quantityKg: input.quantityKg,
      referenceType: 'FRACTIONNEMENT',
      referenceId: child.id,
      reason: `Fractionnement vers ${child.lotCode}`,
      notes: input.notes,
      occurredAt,
      reversesMovementId: null,
    },
    actorId,
  );
  await createStockMovement(
    client,
    {
      lotId: child.id,
      movementType: 'FRACTIONNEMENT',
      sourceLocationId: null,
      destinationLocationId: input.locationId,
      quantityKg: input.quantityKg,
      referenceType: 'FRACTIONNEMENT',
      referenceId: parentRow.id,
      reason: `Fractionnement depuis ${parentRow.lot_code}`,
      notes: input.notes,
      occurredAt,
      reversesMovementId: null,
    },
    actorId,
  );

  await refreshLotStatus(client, parentRow.id);
  await refreshLotStatus(client, child.id);

  await recordAudit(client, {
    userId: actorId,
    action: 'LOT_FRACTIONNEMENT',
    entityType: 'raw_material_lots',
    entityId: child.id,
    oldValues: null,
    newValues: {
      parentLotCode: parentRow.lot_code,
      childLotCode: child.lotCode,
      quantityKg: input.quantityKg,
      locationId: input.locationId,
    },
    context: null,
  });

  return child;
}

export type LotListFilters = Readonly<{
  search: string | null;
  speciesId: string | null;
  status: LotStatus | null;
  limit: number;
}>;

export type LotListRow = Readonly<{
  id: string;
  lotCode: string;
  speciesCode: string;
  supplierName: string | null;
  vesselName: string | null;
  status: LotStatus;
  initialReceptionDate: string | null;
  parentLotCode: string | null;
  stockKg: string;
  isBlocked: boolean;
}>;

export async function listLots(
  pool: pg.Pool,
  filters: LotListFilters,
): Promise<readonly LotListRow[]> {
  if (filters.limit <= 0 || filters.limit > 500) {
    throw validationError('La limite doit être comprise entre 1 et 500.', { limit: filters.limit });
  }
  const result = await pool.query<LotListRow>(
    `SELECT l.id                AS "id",
            l.lot_code          AS "lotCode",
            sp.code             AS "speciesCode",
            sup.name            AS "supplierName",
            v.name              AS "vesselName",
            l.status            AS "status",
            l.initial_reception_date AS "initialReceptionDate",
            parent.lot_code     AS "parentLotCode",
            COALESCE(stock.quantity_kg, 0)::numeric(14,3) AS "stockKg",
            EXISTS (SELECT 1 FROM blocked_lots b WHERE b.raw_material_lot_id = l.id) AS "isBlocked"
       FROM raw_material_lots l
       JOIN species sp ON sp.id = l.species_id
       LEFT JOIN suppliers sup ON sup.id = l.supplier_id
       LEFT JOIN vessels v ON v.id = l.vessel_id
       LEFT JOIN raw_material_lots parent ON parent.id = l.parent_lot_id
       LEFT JOIN current_stock_by_lot stock ON stock.raw_material_lot_id = l.id
      WHERE ($1::text IS NULL OR l.lot_code ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR l.species_id = $2)
        AND ($3::text IS NULL OR l.status = $3)
      ORDER BY l.created_at DESC
      LIMIT $4`,
    [filters.search, filters.speciesId, filters.status, filters.limit],
  );
  return result.rows;
}
