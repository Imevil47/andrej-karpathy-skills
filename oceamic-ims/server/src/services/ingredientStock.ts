import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { isIngredientMovementBlockedByQuality, type IngredientMovementType, type IngredientUnit } from '../domain/types.ts';
import { conflictError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { assertIngredientLotAvailableForUse, requireIngredientLot } from './ingredients.ts';

// The ingredient stock ledger (section 12/13): current stock is never a
// stored, editable total, always SUM() over this table
// (current_ingredient_stock_by_lot[_location], 038_ingredient_views.sql) -
// the same discipline as Phase 1's stock_movements.

/**
 * Serialises every concurrent operation touching the same LOT + EMPLACEMENT,
 * mirroring services/stock.ts's lockLotLocation - a stock check and the
 * movement it authorises can never be interleaved with a concurrent one.
 */
async function lockIngredientLotLocation(client: DatabaseClient, lotId: string, locationId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ingredient:${lotId}:${locationId}`]);
}

export async function ingredientLotStockAt(client: DatabaseClient, lotId: string, locationId: string): Promise<string> {
  const result = await client.query<{ quantity: string }>(
    `SELECT COALESCE((SELECT quantity FROM current_ingredient_stock_by_lot_location
                       WHERE ingredient_lot_id = $1 AND location_id = $2), 0)::numeric(14,3) AS quantity`,
    [lotId, locationId],
  );
  return result.rows[0]?.quantity ?? '0.000';
}

export async function ingredientLotTotalStock(pool: pg.Pool, lotId: string): Promise<string> {
  const result = await pool.query<{ quantity: string }>(
    `SELECT COALESCE((SELECT quantity FROM current_ingredient_stock_by_lot WHERE ingredient_lot_id = $1), 0)::numeric(14,3)
            AS quantity`,
    [lotId],
  );
  return result.rows[0]?.quantity ?? '0.000';
}

export type IngredientStockMovement = Readonly<{
  id: string;
  movementCode: string;
  ingredientLotId: string | null;
  tankBatchId: string | null;
  movementType: IngredientMovementType;
}>;

export type CreateIngredientMovementInput = Readonly<{
  ingredientLotId: string | null;
  tankBatchId: string | null;
  movementType: IngredientMovementType;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantity: string;
  unit: IngredientUnit;
  occurredAt: Date;
  referenceType: string | null;
  referenceId: string | null;
  lossReasonId: string | null;
  reason: string | null;
}>;

/**
 * Single entry point of the ingredient ledger (section 12) - every
 * quantity change (reception, transfer, feeding a cuve, consumption, loss,
 * adjustment, return) goes through here, inside the caller's transaction.
 * Exactly one of ingredientLotId/tankBatchId is expected, matching the
 * ingredient_movements_lot_xor_tank_batch constraint.
 */
export async function createIngredientStockMovement(
  client: DatabaseClient,
  input: CreateIngredientMovementInput,
  actorId: string,
): Promise<IngredientStockMovement> {
  if (Number(input.quantity) <= 0) {
    throw validationError('La quantité doit être strictement positive.', { quantity: input.quantity });
  }
  if (input.sourceLocationId === null && input.destinationLocationId === null) {
    throw validationError(
      'Un mouvement doit avoir un emplacement source ou un emplacement de destination.',
      { movementType: input.movementType },
    );
  }
  if ((input.ingredientLotId === null) === (input.tankBatchId === null)) {
    throw new Error('Un mouvement ingrédient doit concerner exactement un lot ou un lot de cuve.');
  }
  if (input.movementType === 'PERTE' && input.sourceLocationId === null) {
    throw validationError('Une perte doit indiquer un emplacement source.', {});
  }

  if (input.sourceLocationId !== null) {
    if (input.ingredientLotId !== null) {
      const lot = await requireIngredientLot(client, input.ingredientLotId);
      if (isIngredientMovementBlockedByQuality(input.movementType)) {
        assertIngredientLotAvailableForUse(lot);
      }
      await lockIngredientLotLocation(client, input.ingredientLotId, input.sourceLocationId);
      const available = await ingredientLotStockAt(client, input.ingredientLotId, input.sourceLocationId);
      if (Number(available) < Number(input.quantity)) {
        throw conflictError(
          `Stock insuffisant.\nDisponible : ${available} ${input.unit}\nDemandé : ${input.quantity} ${input.unit}`,
          { ingredientLotId: input.ingredientLotId, locationId: input.sourceLocationId },
        );
      }
    } else if (input.tankBatchId !== null) {
      const stock = await client.query<{ remaining_quantity: string }>(
        'SELECT remaining_quantity FROM tank_batch_stock WHERE tank_batch_id = $1',
        [input.tankBatchId],
      );
      const remaining = stock.rows[0]?.remaining_quantity ?? '0';
      if (Number(remaining) < Number(input.quantity)) {
        throw conflictError(
          `Stock de cuve insuffisant.\nDisponible : ${remaining} ${input.unit}\nDemandé : ${input.quantity} ${input.unit}`,
          { tankBatchId: input.tankBatchId },
        );
      }
    }
  }

  const movementCode = await nextOperationalCode(client, 'MVI', input.occurredAt);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO ingredient_stock_movements (movement_code, ingredient_lot_id, tank_batch_id, movement_type,
                                             source_location_id, destination_location_id, quantity, unit,
                                             occurred_at, reference_type, reference_id, loss_reason_id, reason,
                                             created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      movementCode,
      input.ingredientLotId,
      input.tankBatchId,
      input.movementType,
      input.sourceLocationId,
      input.destinationLocationId,
      input.quantity,
      input.unit,
      input.occurredAt,
      input.referenceType,
      input.referenceId,
      input.lossReasonId,
      input.reason,
      actorId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("Le mouvement ingrédient n'a pas pu être enregistré.");
  }

  await recordAudit(client, {
    userId: actorId,
    action: `INGREDIENT_${input.movementType}`,
    entityType: 'ingredient_stock_movements',
    entityId: id,
    oldValues: null,
    newValues: { ...input },
    context: null,
  });

  return { id, movementCode, ingredientLotId: input.ingredientLotId, tankBatchId: input.tankBatchId, movementType: input.movementType };
}

export type ReceiveIngredientLotInput = Readonly<{
  ingredientLotId: string;
  destinationLocationId: string;
  quantity: string;
  unit: IngredientUnit;
  occurredAt: Date;
}>;

export async function receiveIngredientLot(pool: pg.Pool, input: ReceiveIngredientLotInput, actorId: string) {
  return withTransaction(pool, (client) =>
    createIngredientStockMovement(
      client,
      {
        ingredientLotId: input.ingredientLotId,
        tankBatchId: null,
        movementType: 'RECEPTION',
        sourceLocationId: null,
        destinationLocationId: input.destinationLocationId,
        quantity: input.quantity,
        unit: input.unit,
        occurredAt: input.occurredAt,
        referenceType: null,
        referenceId: null,
        lossReasonId: null,
        reason: null,
      },
      actorId,
    ),
  );
}

export type TransferIngredientLotInput = Readonly<{
  ingredientLotId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  quantity: string;
  unit: IngredientUnit;
  occurredAt: Date;
}>;

export async function transferIngredientLot(pool: pg.Pool, input: TransferIngredientLotInput, actorId: string) {
  return withTransaction(pool, (client) =>
    createIngredientStockMovement(
      client,
      {
        ingredientLotId: input.ingredientLotId,
        tankBatchId: null,
        movementType: 'TRANSFERT',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        quantity: input.quantity,
        unit: input.unit,
        occurredAt: input.occurredAt,
        referenceType: null,
        referenceId: null,
        lossReasonId: null,
        reason: null,
      },
      actorId,
    ),
  );
}

export type LoseIngredientLotInput = Readonly<{
  ingredientLotId: string;
  sourceLocationId: string;
  quantity: string;
  unit: IngredientUnit;
  occurredAt: Date;
  lossReasonId: string;
  reason: string | null;
}>;

/** A loss is always its own PERTE movement (section 34), never hidden
 * inside an adjustment. */
export async function loseIngredientLot(pool: pg.Pool, input: LoseIngredientLotInput, actorId: string) {
  return withTransaction(pool, (client) =>
    createIngredientStockMovement(
      client,
      {
        ingredientLotId: input.ingredientLotId,
        tankBatchId: null,
        movementType: 'PERTE',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: null,
        quantity: input.quantity,
        unit: input.unit,
        occurredAt: input.occurredAt,
        referenceType: null,
        referenceId: null,
        lossReasonId: input.lossReasonId,
        reason: input.reason,
      },
      actorId,
    ),
  );
}

export type LoseFromTankBatchInput = Readonly<{
  tankBatchId: string;
  sourceLocationId: string;
  quantity: string;
  unit: IngredientUnit;
  occurredAt: Date;
  lossReasonId: string;
  reason: string | null;
  productionRunId: string | null;
}>;

/** A loss drawn directly from a tank batch (section 34) - e.g. oil spilled
 * from a cuve during a Run's process, distinct from a lot-level loss above.
 * Optionally tied to the Run whose process caused it (referenceType/
 * referenceId) so the material balance (services/ingredientQueries.ts)
 * picks it up - never hidden inside an adjustment. */
export async function loseFromTankBatch(pool: pg.Pool, input: LoseFromTankBatchInput, actorId: string) {
  return withTransaction(pool, (client) =>
    createIngredientStockMovement(
      client,
      {
        ingredientLotId: null,
        tankBatchId: input.tankBatchId,
        movementType: 'PERTE',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: null,
        quantity: input.quantity,
        unit: input.unit,
        occurredAt: input.occurredAt,
        referenceType: input.productionRunId ? 'PRODUCTION_RUN' : null,
        referenceId: input.productionRunId,
        lossReasonId: input.lossReasonId,
        reason: input.reason,
      },
      actorId,
    ),
  );
}

export type AdjustIngredientLotInput = Readonly<{
  ingredientLotId: string;
  locationId: string;
  quantity: string;
  unit: IngredientUnit;
  direction: 'AUGMENTATION' | 'DIMINUTION';
  occurredAt: Date;
  reason: string;
}>;

/** ADMIN-only correction of the ledger (ingredient:adjust), mirroring
 * stock:adjust's reservation to ADMIN for raw material - never available to
 * STOCK or PRODUCTION on their own. */
export async function adjustIngredientLot(pool: pg.Pool, input: AdjustIngredientLotInput, actorId: string) {
  return withTransaction(pool, (client) =>
    createIngredientStockMovement(
      client,
      {
        ingredientLotId: input.ingredientLotId,
        tankBatchId: null,
        movementType: 'AJUSTEMENT',
        sourceLocationId: input.direction === 'DIMINUTION' ? input.locationId : null,
        destinationLocationId: input.direction === 'AUGMENTATION' ? input.locationId : null,
        quantity: input.quantity,
        unit: input.unit,
        occurredAt: input.occurredAt,
        referenceType: null,
        referenceId: null,
        lossReasonId: null,
        reason: input.reason,
      },
      actorId,
    ),
  );
}

export type IngredientStockRow = Readonly<{
  ingredientLotId: string;
  lotCode: string;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  locationId: string;
  locationCode: string;
  quantity: string;
  unit: string;
}>;

export async function listIngredientStock(
  pool: pg.Pool,
  filters: Readonly<{ ingredientId: string | null; locationId: string | null }>,
): Promise<readonly IngredientStockRow[]> {
  const result = await pool.query<IngredientStockRow>(
    `SELECT s.ingredient_lot_id AS "ingredientLotId", l.lot_code AS "lotCode", l.ingredient_id AS "ingredientId",
            i.ingredient_code AS "ingredientCode", i.name AS "ingredientName",
            s.location_id AS "locationId", loc.code AS "locationCode",
            s.quantity::text AS "quantity", i.default_unit AS "unit"
       FROM current_ingredient_stock_by_lot_location s
       JOIN ingredient_lots l ON l.id = s.ingredient_lot_id
       JOIN ingredients i ON i.id = l.ingredient_id
       JOIN locations loc ON loc.id = s.location_id
      WHERE ($1::uuid IS NULL OR l.ingredient_id = $1)
        AND ($2::uuid IS NULL OR s.location_id = $2)
      ORDER BY i.ingredient_code, l.lot_code, loc.code`,
    [filters.ingredientId, filters.locationId],
  );
  return result.rows;
}

export type IngredientMovementRow = Readonly<{
  id: string;
  movementCode: string;
  ingredientLotId: string | null;
  lotCode: string | null;
  tankBatchId: string | null;
  tankBatchCode: string | null;
  movementType: IngredientMovementType;
  sourceLocationCode: string | null;
  destinationLocationCode: string | null;
  quantity: string;
  unit: string;
  occurredAt: Date;
  reason: string | null;
  createdByName: string;
}>;

export async function listIngredientMovements(
  pool: pg.Pool,
  filters: Readonly<{ ingredientLotId: string | null; tankBatchId: string | null; limit: number }>,
): Promise<readonly IngredientMovementRow[]> {
  const result = await pool.query<IngredientMovementRow>(
    `SELECT m.id AS "id", m.movement_code AS "movementCode", m.ingredient_lot_id AS "ingredientLotId",
            l.lot_code AS "lotCode", m.tank_batch_id AS "tankBatchId", tb.batch_code AS "tankBatchCode",
            m.movement_type AS "movementType", sl.code AS "sourceLocationCode", dl.code AS "destinationLocationCode",
            m.quantity::text AS "quantity", m.unit AS "unit", m.occurred_at AS "occurredAt",
            m.reason AS "reason", u.full_name AS "createdByName"
       FROM ingredient_stock_movements m
       LEFT JOIN ingredient_lots l ON l.id = m.ingredient_lot_id
       LEFT JOIN tank_batches tb ON tb.id = m.tank_batch_id
       LEFT JOIN locations sl ON sl.id = m.source_location_id
       LEFT JOIN locations dl ON dl.id = m.destination_location_id
       JOIN users u ON u.id = m.created_by
      WHERE ($1::uuid IS NULL OR m.ingredient_lot_id = $1)
        AND ($2::uuid IS NULL OR m.tank_batch_id = $2)
      ORDER BY m.occurred_at DESC
      LIMIT $3`,
    [filters.ingredientLotId, filters.tankBatchId, filters.limit],
  );
  return result.rows;
}
