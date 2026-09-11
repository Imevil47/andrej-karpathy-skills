import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { IngredientUnit, TankBatchStatus } from '../domain/types.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { createIngredientStockMovement } from './ingredientStock.ts';

// TANK is a physical vessel, TANK BATCH a traceable content event (section
// 75) - never fused. A tank is never permanently bound to one ingredient
// (section 20): ingredient_type_id is only the usual/expected product.

export type IngredientTank = Readonly<{
  id: string;
  tankCode: string;
  name: string;
  ingredientTypeId: string | null;
  capacityLiters: string | null;
  locationId: string | null;
  isActive: boolean;
}>;

export async function requireTank(client: DatabaseClient, id: string): Promise<IngredientTank> {
  const result = await client.query<{
    id: string;
    tank_code: string;
    name: string;
    ingredient_type_id: string | null;
    capacity_liters: string | null;
    location_id: string | null;
    is_active: boolean;
  }>('SELECT id, tank_code, name, ingredient_type_id, capacity_liters, location_id, is_active FROM ingredient_tanks WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Cuve', id);
  }
  return {
    id: row.id,
    tankCode: row.tank_code,
    name: row.name,
    ingredientTypeId: row.ingredient_type_id,
    capacityLiters: row.capacity_liters,
    locationId: row.location_id,
    isActive: row.is_active,
  };
}

export type IngredientTankRow = IngredientTank & Readonly<{ ingredientTypeName: string | null; locationCode: string | null }>;

export async function listTanks(pool: pg.Pool, includeInactive: boolean): Promise<readonly IngredientTankRow[]> {
  const result = await pool.query<IngredientTankRow>(
    `SELECT t.id AS "id", t.tank_code AS "tankCode", t.name AS "name", t.ingredient_type_id AS "ingredientTypeId",
            it.name AS "ingredientTypeName", t.capacity_liters AS "capacityLiters", t.location_id AS "locationId",
            l.code AS "locationCode", t.is_active AS "isActive"
       FROM ingredient_tanks t
       LEFT JOIN ingredient_types it ON it.id = t.ingredient_type_id
       LEFT JOIN locations l ON l.id = t.location_id
      WHERE ($1::boolean IS TRUE OR t.is_active IS TRUE)
      ORDER BY t.tank_code`,
    [includeInactive],
  );
  return result.rows;
}

export type CreateTankInput = Readonly<{
  tankCode: string;
  name: string;
  ingredientTypeId: string | null;
  capacityLiters: string | null;
  locationId: string | null;
}>;

export async function createTank(pool: pg.Pool, input: CreateTankInput, actorId: string): Promise<{ id: string }> {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM ingredient_tanks WHERE tank_code = $1', [input.tankCode]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`La cuve ${input.tankCode} existe déjà.`, { tankCode: input.tankCode });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ingredient_tanks (tank_code, name, ingredient_type_id, capacity_liters, location_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.tankCode.toUpperCase(), input.name, input.ingredientTypeId, input.capacityLiters, input.locationId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La cuve n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'ingredient_tanks',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type TankBatch = Readonly<{ id: string; batchCode: string; tankId: string; status: TankBatchStatus }>;

export async function requireTankBatch(client: DatabaseClient, id: string): Promise<TankBatch> {
  const result = await client.query<{ id: string; batch_code: string; tank_id: string; status: TankBatchStatus }>(
    'SELECT id, batch_code, tank_id, status FROM tank_batches WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Lot de cuve', id);
  }
  return { id: row.id, batchCode: row.batch_code, tankId: row.tank_id, status: row.status };
}

/** Opens a new tank batch (section 21). Starting a batch is deliberately
 * separate from feeding it (addTankBatchInput below): a tank can be opened
 * empty and then receive one or several lots over time. */
export async function openTankBatch(pool: pg.Pool, tankId: string, startedAt: Date, actorId: string): Promise<TankBatch> {
  return withTransaction(pool, async (client) => {
    const tank = await requireTank(client, tankId);
    const batchCode = await nextOperationalCode(client, 'CB', startedAt);
    const inserted = await client.query<{ id: string; status: TankBatchStatus }>(
      `INSERT INTO tank_batches (batch_code, tank_id, started_at, created_by) VALUES ($1, $2, $3, $4)
       RETURNING id, status`,
      [batchCode, tankId, startedAt, actorId],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Le lot de cuve n'a pas pu être ouvert.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'TANK_BATCH_OUVERTURE',
      entityType: 'tank_batches',
      entityId: row.id,
      oldValues: null,
      newValues: { tankCode: tank.tankCode, batchCode },
      context: null,
    });
    return { id: row.id, batchCode, tankId, status: row.status };
  });
}

export type AddTankBatchInputInput = Readonly<{
  tankBatchId: string;
  ingredientLotId: string;
  sourceLocationId: string;
  quantity: string;
  unit: IngredientUnit;
  addedAt: Date;
}>;

/**
 * Feeds one ingredient lot into a tank batch (section 21/22). Creates the
 * ALIMENTATION_CUVE ledger movement and the genealogy row in the same
 * transaction, so a tank batch's declared inputs can never disagree with
 * the stock actually withdrawn - mixing two lots is two calls to this
 * function, both preserved, never collapsed into an untraceable blend.
 */
export async function addTankBatchInput(pool: pg.Pool, input: AddTankBatchInputInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const batch = await requireTankBatch(client, input.tankBatchId);
    if (batch.status !== 'OUVERT') {
      throw conflictError(`Le lot de cuve ${batch.batchCode} n'est plus ouvert.`, { tankBatchId: input.tankBatchId });
    }
    const tank = await requireTank(client, batch.tankId);

    const movement = await createIngredientStockMovement(
      client,
      {
        ingredientLotId: input.ingredientLotId,
        tankBatchId: null,
        movementType: 'ALIMENTATION_CUVE',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: tank.locationId,
        quantity: input.quantity,
        unit: input.unit,
        occurredAt: input.addedAt,
        referenceType: 'TANK_BATCH',
        referenceId: input.tankBatchId,
        lossReasonId: null,
        reason: null,
      },
      actorId,
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tank_batch_inputs (tank_batch_id, ingredient_lot_id, quantity, unit, added_at,
                                      ingredient_stock_movement_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.tankBatchId, input.ingredientLotId, input.quantity, input.unit, input.addedAt, movement.id, actorId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'alimentation de la cuve n'a pas pu être enregistrée.");
    }
    return { id, movementId: movement.id };
  });
}

export async function closeTankBatch(pool: pg.Pool, tankBatchId: string, closedAt: Date, actorId: string): Promise<void> {
  return withTransaction(pool, async (client) => {
    const batch = await requireTankBatch(client, tankBatchId);
    if (batch.status !== 'OUVERT') {
      throw conflictError(`Le lot de cuve ${batch.batchCode} est déjà clôturé.`, { tankBatchId });
    }
    await client.query("UPDATE tank_batches SET status = 'CLOTURE', closed_at = $2, updated_at = now() WHERE id = $1", [
      tankBatchId,
      closedAt,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'TANK_BATCH_CLOTURE',
      entityType: 'tank_batches',
      entityId: tankBatchId,
      oldValues: { status: 'OUVERT' },
      newValues: { status: 'CLOTURE' },
      context: null,
    });
  });
}

export type RecordTankMeasurementInput = Readonly<{
  tankId: string;
  measuredAt: Date;
  quantity: string;
  unit: IngredientUnit;
  measurementMethod: string | null;
}>;

/** A physical measurement (section 45) - never overwrites the
 * movement-derived theoretical stock, kept as its own record. */
export async function recordTankMeasurement(pool: pg.Pool, input: RecordTankMeasurementInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    await requireTank(client, input.tankId);
    if (Number(input.quantity) < 0) {
      throw validationError('La quantité mesurée ne peut pas être négative.', { quantity: input.quantity });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tank_measurements (tank_id, measured_at, quantity, unit, measurement_method, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.tankId, input.measuredAt, input.quantity, input.unit, input.measurementMethod, actorId],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'TANK_MEASUREMENT',
      entityType: 'tank_measurements',
      entityId: inserted.rows[0]?.id ?? null,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id: inserted.rows[0]?.id };
  });
}

export type TankBatchRow = Readonly<{
  id: string;
  batchCode: string;
  tankId: string;
  tankCode: string;
  status: TankBatchStatus;
  startedAt: Date;
  closedAt: Date | null;
  totalInputQuantity: string;
  remainingQuantity: string;
}>;

export async function listTankBatches(pool: pg.Pool, tankId: string | null): Promise<readonly TankBatchRow[]> {
  const result = await pool.query<TankBatchRow>(
    `SELECT tb.id AS "id", tb.batch_code AS "batchCode", tb.tank_id AS "tankId", t.tank_code AS "tankCode",
            tb.status AS "status", tb.started_at AS "startedAt", tb.closed_at AS "closedAt",
            COALESCE(s.total_input_quantity, 0)::text AS "totalInputQuantity",
            COALESCE(s.remaining_quantity, 0)::text AS "remainingQuantity"
       FROM tank_batches tb
       JOIN ingredient_tanks t ON t.id = tb.tank_id
       LEFT JOIN tank_batch_stock s ON s.tank_batch_id = tb.id
      WHERE ($1::uuid IS NULL OR tb.tank_id = $1)
      ORDER BY tb.started_at DESC`,
    [tankId],
  );
  return result.rows;
}

export type TankBatchInputRow = Readonly<{
  id: string;
  ingredientLotId: string;
  lotCode: string;
  quantity: string;
  unit: string;
  addedAt: Date;
}>;

export async function listTankBatchInputs(pool: pg.Pool, tankBatchId: string): Promise<readonly TankBatchInputRow[]> {
  const result = await pool.query<TankBatchInputRow>(
    `SELECT i.id AS "id", i.ingredient_lot_id AS "ingredientLotId", l.lot_code AS "lotCode",
            i.quantity::text AS "quantity", i.unit AS "unit", i.added_at AS "addedAt"
       FROM tank_batch_inputs i
       JOIN ingredient_lots l ON l.id = i.ingredient_lot_id
      WHERE i.tank_batch_id = $1
      ORDER BY i.added_at`,
    [tankBatchId],
  );
  return result.rows;
}

export type TankMeasurementRow = Readonly<{ id: string; measuredAt: Date; quantity: string; unit: string; measurementMethod: string | null }>;

export async function listTankMeasurements(pool: pg.Pool, tankId: string): Promise<readonly TankMeasurementRow[]> {
  const result = await pool.query<TankMeasurementRow>(
    `SELECT id AS "id", measured_at AS "measuredAt", quantity::text AS "quantity", unit AS "unit",
            measurement_method AS "measurementMethod"
       FROM tank_measurements WHERE tank_id = $1 ORDER BY measured_at DESC`,
    [tankId],
  );
  return result.rows;
}
