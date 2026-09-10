import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { consumptionPer1000Units, type IngredientUnit, type ProcessUtilityType } from '../domain/types.ts';
import { notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { createIngredientStockMovement } from './ingredientStock.ts';
import { requireTankBatch } from './ingredientTanks.ts';

// RUN INGREDIENT CONSUMPTION is material consumed by production (section
// 75) - never a second, manually re-typed total (section 15): every row is
// created together with the CONSOMMATION ingredient_stock_movement it
// represents, in the same transaction.

export type RecordDirectConsumptionInput = Readonly<{
  productionRunId: string;
  fillingOperationId: string | null;
  ingredientLotId: string;
  sourceLocationId: string;
  quantity: string;
  unit: IngredientUnit;
  consumedAt: Date;
}>;

export async function recordDirectIngredientConsumption(
  pool: pg.Pool,
  input: RecordDirectConsumptionInput,
  actorId: string,
): Promise<{ id: string }> {
  return withTransaction(pool, async (client) => {
    await requireProductionRunExists(client, input.productionRunId);
    const movement = await createIngredientStockMovement(
      client,
      {
        ingredientLotId: input.ingredientLotId,
        tankBatchId: null,
        movementType: 'CONSOMMATION',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: null,
        quantity: input.quantity,
        unit: input.unit,
        occurredAt: input.consumedAt,
        referenceType: 'PRODUCTION_RUN',
        referenceId: input.productionRunId,
        lossReasonId: null,
        reason: null,
      },
      actorId,
    );
    return insertConsumptionRow(client, {
      productionRunId: input.productionRunId,
      fillingOperationId: input.fillingOperationId,
      ingredientLotId: input.ingredientLotId,
      tankBatchId: null,
      sourceLocationId: input.sourceLocationId,
      quantity: input.quantity,
      unit: input.unit,
      consumedAt: input.consumedAt,
      movementId: movement.id,
      actorId,
    });
  });
}

export type RecordTankConsumptionInput = Readonly<{
  productionRunId: string;
  fillingOperationId: string | null;
  tankBatchId: string;
  quantity: string;
  unit: IngredientUnit;
  consumedAt: Date;
}>;

/**
 * Consumption drawn from a tank (section 23): the consumption row points at
 * the tank batch, never at a single lot invented for the occasion. Run ->
 * tank batch -> ingredient lots is resolved at read time via
 * tank_batch_inputs (getTankBatchGenealogy below) - exact per-litre
 * attribution between the lots that fed a mixed batch is not physically
 * measurable, so it is never fabricated (section 68).
 */
export async function recordTankIngredientConsumption(
  pool: pg.Pool,
  input: RecordTankConsumptionInput,
  actorId: string,
): Promise<{ id: string }> {
  return withTransaction(pool, async (client) => {
    await requireProductionRunExists(client, input.productionRunId);
    const batch = await requireTankBatch(client, input.tankBatchId);
    const tank = await client.query<{ location_id: string | null }>(
      'SELECT location_id FROM ingredient_tanks WHERE id = $1',
      [batch.tankId],
    );
    const movement = await createIngredientStockMovement(
      client,
      {
        ingredientLotId: null,
        tankBatchId: input.tankBatchId,
        movementType: 'CONSOMMATION',
        sourceLocationId: tank.rows[0]?.location_id ?? null,
        destinationLocationId: null,
        quantity: input.quantity,
        unit: input.unit,
        occurredAt: input.consumedAt,
        referenceType: 'PRODUCTION_RUN',
        referenceId: input.productionRunId,
        lossReasonId: null,
        reason: null,
      },
      actorId,
    );
    return insertConsumptionRow(client, {
      productionRunId: input.productionRunId,
      fillingOperationId: input.fillingOperationId,
      ingredientLotId: null,
      tankBatchId: input.tankBatchId,
      sourceLocationId: tank.rows[0]?.location_id ?? null,
      quantity: input.quantity,
      unit: input.unit,
      consumedAt: input.consumedAt,
      movementId: movement.id,
      actorId,
    });
  });
}

async function insertConsumptionRow(
  client: DatabaseClient,
  input: Readonly<{
    productionRunId: string;
    fillingOperationId: string | null;
    ingredientLotId: string | null;
    tankBatchId: string | null;
    sourceLocationId: string | null;
    quantity: string;
    unit: IngredientUnit;
    consumedAt: Date;
    movementId: string;
    actorId: string;
  }>,
): Promise<{ id: string }> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO production_run_ingredient_consumptions
         (production_run_id, filling_operation_id, ingredient_lot_id, tank_batch_id, source_location_id,
          quantity, unit, consumed_at, ingredient_stock_movement_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      input.productionRunId,
      input.fillingOperationId,
      input.ingredientLotId,
      input.tankBatchId,
      input.sourceLocationId,
      input.quantity,
      input.unit,
      input.consumedAt,
      input.movementId,
      input.actorId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("La consommation d'ingrédient n'a pas pu être enregistrée.");
  }
  await recordAudit(client, {
    userId: input.actorId,
    action: 'RUN_INGREDIENT_CONSOMMATION',
    entityType: 'production_run_ingredient_consumptions',
    entityId: id,
    oldValues: null,
    newValues: { ...input, movementId: undefined },
    context: null,
  });
  return { id };
}

export type RunIngredientConsumptionRow = Readonly<{
  id: string;
  productionRunId: string;
  fillingOperationId: string | null;
  ingredientLotId: string | null;
  lotCode: string | null;
  tankBatchId: string | null;
  tankBatchCode: string | null;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  quantity: string;
  unit: string;
  consumedAt: Date;
}>;

export async function listRunIngredientConsumptions(pool: pg.Pool, runId: string): Promise<readonly RunIngredientConsumptionRow[]> {
  const result = await pool.query<RunIngredientConsumptionRow>(
    `SELECT c.id AS "id", c.production_run_id AS "productionRunId", c.filling_operation_id AS "fillingOperationId",
            c.ingredient_lot_id AS "ingredientLotId", l.lot_code AS "lotCode",
            c.tank_batch_id AS "tankBatchId", tb.batch_code AS "tankBatchCode",
            i.id AS "ingredientId", i.ingredient_code AS "ingredientCode", i.name AS "ingredientName",
            c.quantity::text AS "quantity", c.unit AS "unit", c.consumed_at AS "consumedAt"
       FROM production_run_ingredient_consumptions c
       LEFT JOIN ingredient_lots l ON l.id = c.ingredient_lot_id
       LEFT JOIN tank_batches tb ON tb.id = c.tank_batch_id
       JOIN ingredients i ON i.id = COALESCE(
              l.ingredient_id,
              (SELECT il.ingredient_id FROM tank_batch_inputs tbi
                 JOIN ingredient_lots il ON il.id = tbi.ingredient_lot_id
                WHERE tbi.tank_batch_id = c.tank_batch_id LIMIT 1)
       )
      WHERE c.production_run_id = $1
      ORDER BY c.consumed_at`,
    [runId],
  );
  return result.rows;
}

/** Run -> tank batch -> ingredient lots (section 23/31/61): the full,
 * transparent list of lots that fed a tank batch a Run drew from - never a
 * fabricated single "the" lot when the batch was mixed. */
export async function getTankBatchGenealogy(
  pool: pg.Pool,
  tankBatchId: string,
): Promise<readonly Readonly<{ ingredientLotId: string; lotCode: string; quantity: string; unit: string }>[]> {
  const result = await pool.query<{ ingredientLotId: string; lotCode: string; quantity: string; unit: string }>(
    `SELECT tbi.ingredient_lot_id AS "ingredientLotId", l.lot_code AS "lotCode",
            tbi.quantity::text AS "quantity", tbi.unit AS "unit"
       FROM tank_batch_inputs tbi
       JOIN ingredient_lots l ON l.id = tbi.ingredient_lot_id
      WHERE tbi.tank_batch_id = $1
      ORDER BY tbi.added_at`,
    [tankBatchId],
  );
  return result.rows;
}

export type CansProducedByRun = Readonly<{ totalCans: number }>;

/** The source of can count for section 17/18's KPI: the same validated
 * packaging_outputs the Finished Goods module already relies on, never a
 * second manually typed total. */
export async function cansProducedByRun(pool: pg.Pool, runId: string): Promise<number> {
  const result = await pool.query<{ total_cans: string }>(
    `SELECT COALESCE(SUM(po.quantity_cans), 0)::text AS total_cans
       FROM packaging_outputs po
       JOIN packaging_batches pb ON pb.id = po.packaging_batch_id
      WHERE pb.production_run_id = $1`,
    [runId],
  );
  return Number(result.rows[0]?.total_cans ?? '0');
}

export type IngredientConsumptionPer1000 = Readonly<{
  ingredientId: string;
  totalQuantity: number;
  totalCans: number;
  per1000: number | null;
}>;

export async function ingredientConsumptionPer1000ForRun(
  pool: pg.Pool,
  runId: string,
  ingredientId: string,
): Promise<IngredientConsumptionPer1000> {
  const rows = await listRunIngredientConsumptions(pool, runId);
  const totalQuantity = rows
    .filter((row) => row.ingredientId === ingredientId)
    .reduce((sum, row) => sum + Number(row.quantity), 0);
  const totalCans = await cansProducedByRun(pool, runId);
  return { ingredientId, totalQuantity, totalCans, per1000: consumptionPer1000Units(totalQuantity, totalCans) };
}

export type RecordUtilityConsumptionInput = Readonly<{
  productionRunId: string;
  utilityType: ProcessUtilityType;
  quantity: string;
  unit: IngredientUnit;
  occurredAt: Date;
  notes: string | null;
}>;

export async function recordProcessUtilityConsumption(
  pool: pg.Pool,
  input: RecordUtilityConsumptionInput,
  actorId: string,
): Promise<{ id: string }> {
  if (Number(input.quantity) <= 0) {
    throw validationError('La quantité doit être strictement positive.', { quantity: input.quantity });
  }
  return withTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO process_utility_consumptions (production_run_id, utility_type, quantity, unit, occurred_at, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.productionRunId, input.utilityType, input.quantity, input.unit, input.occurredAt, input.notes, actorId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La consommation d'utilité n'a pas pu être enregistrée.");
    }
    return { id };
  });
}

export type ProcessUtilityConsumptionRow = Readonly<{
  id: string;
  utilityType: ProcessUtilityType;
  quantity: string;
  unit: string;
  occurredAt: Date;
  notes: string | null;
}>;

export async function listProcessUtilityConsumptions(pool: pg.Pool, runId: string): Promise<readonly ProcessUtilityConsumptionRow[]> {
  const result = await pool.query<ProcessUtilityConsumptionRow>(
    `SELECT id AS "id", utility_type AS "utilityType", quantity::text AS "quantity", unit AS "unit",
            occurred_at AS "occurredAt", notes AS "notes"
       FROM process_utility_consumptions WHERE production_run_id = $1 ORDER BY occurred_at`,
    [runId],
  );
  return result.rows;
}

export async function requireProductionRunExists(client: DatabaseClient, id: string): Promise<void> {
  const result = await client.query('SELECT id FROM production_runs WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    throw notFoundError('Ordre de production', id);
  }
}
