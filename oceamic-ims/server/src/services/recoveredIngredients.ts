import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { IngredientUnit, RecoveredBatchManualStatus } from '../domain/types.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { requireIngredient } from './ingredients.ts';
import { requireProductionRunExists } from './ingredientConsumption.ts';

// RECOVERED INGREDIENT BATCH is a genuinely new material identity born from
// a Production Run's process (section 66), never a reversal of the
// consumption that sent the original material to the filling line - see
// 033_ingredient_stock.sql's note.

export type ReusePolicy = Readonly<{ maxReuseHours: number; allowMixing: boolean }>;

/**
 * The centralized reuse-age policy (section 25/26): read from exactly one
 * place, never hardcoded per screen. A specific ingredient_type_id override
 * wins over the global (ingredient_type_id IS NULL) default; the default
 * value seeded for Phase 8 is 48 hours (OCEAMIC's current 2-day rule).
 */
export async function getReusePolicy(client: DatabaseClient, ingredientTypeId: string): Promise<ReusePolicy> {
  const result = await client.query<{ max_reuse_hours: number; allow_mixing: boolean }>(
    `SELECT max_reuse_hours, allow_mixing FROM ingredient_reuse_policies
      WHERE is_active AND (ingredient_type_id = $1 OR ingredient_type_id IS NULL)
      ORDER BY ingredient_type_id NULLS LAST
      LIMIT 1`,
    [ingredientTypeId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Aucune politique de réutilisation configurée (ni spécifique, ni globale).");
  }
  return { maxReuseHours: row.max_reuse_hours, allowMixing: row.allow_mixing };
}

export type RecoveredBatch = Readonly<{
  id: string;
  recoveryCode: string;
  ingredientId: string;
  quantity: string;
  unit: IngredientUnit;
  reuseDeadline: Date;
  status: RecoveredBatchManualStatus;
}>;

export async function requireRecoveredBatch(client: DatabaseClient, id: string): Promise<RecoveredBatch> {
  const result = await client.query<{
    id: string;
    recovery_code: string;
    ingredient_id: string;
    quantity: string;
    unit: IngredientUnit;
    reuse_deadline: Date;
    status: RecoveredBatchManualStatus;
  }>(
    'SELECT id, recovery_code, ingredient_id, quantity, unit, reuse_deadline, status FROM recovered_ingredient_batches WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Lot de récupération', id);
  }
  return {
    id: row.id,
    recoveryCode: row.recovery_code,
    ingredientId: row.ingredient_id,
    quantity: row.quantity,
    unit: row.unit,
    reuseDeadline: row.reuse_deadline,
    status: row.status,
  };
}

export type CreateRecoveredBatchInput = Readonly<{
  ingredientId: string;
  sourceProductionRunId: string;
  sourceFillingOperationId: string | null;
  recoveredAt: Date;
  quantity: string;
  unit: IngredientUnit;
  storageLocationId: string | null;
  containerId: string | null;
  notes: string | null;
}>;

/** Records a recovery event (section 24) and calculates its reuse deadline
 * automatically (section 26): recoveredAt + the configured maximum reuse
 * period, never left to a user to compute by hand. */
export async function createRecoveredBatch(
  pool: pg.Pool,
  input: CreateRecoveredBatchInput,
  actorId: string,
): Promise<RecoveredBatch> {
  return withTransaction(pool, async (client) => {
    const ingredient = await requireIngredient(client, input.ingredientId);
    if (!ingredient.isRecoverable) {
      throw validationError(`L'ingrédient ${ingredient.name} n'est pas configuré comme récupérable.`, {
        ingredientId: input.ingredientId,
      });
    }
    await requireProductionRunExists(client, input.sourceProductionRunId);
    const policy = await getReusePolicy(client, ingredient.ingredientTypeId);
    const reuseDeadline = new Date(input.recoveredAt.getTime() + policy.maxReuseHours * 60 * 60 * 1000);

    const recoveryCode = await nextOperationalCode(client, 'RCI', input.recoveredAt);
    const inserted = await client.query<{ id: string; status: RecoveredBatchManualStatus }>(
      `INSERT INTO recovered_ingredient_batches
           (recovery_code, ingredient_id, source_production_run_id, source_filling_operation_id, recovered_at,
            quantity, unit, storage_location_id, container_id, reuse_deadline, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, status`,
      [
        recoveryCode,
        input.ingredientId,
        input.sourceProductionRunId,
        input.sourceFillingOperationId,
        input.recoveredAt,
        input.quantity,
        input.unit,
        input.storageLocationId,
        input.containerId,
        reuseDeadline,
        input.notes,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("La récupération n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'RECOVERED_BATCH_CREATION',
      entityType: 'recovered_ingredient_batches',
      entityId: row.id,
      oldValues: null,
      newValues: { recoveryCode, ...input, reuseDeadline },
      context: null,
    });
    return {
      id: row.id,
      recoveryCode,
      ingredientId: input.ingredientId,
      quantity: input.quantity,
      unit: input.unit,
      reuseDeadline,
      status: row.status,
    };
  });
}

export type ReuseRecoveredBatchInput = Readonly<{
  recoveredBatchId: string;
  destinationProductionRunId: string;
  destinationFillingOperationId: string | null;
  quantity: string;
  unit: IngredientUnit;
  reusedAt: Date;
}>;

/**
 * Reuses (partially or fully) a recovered batch (section 29/30). Rejects
 * expired material outright (section 28) - an operator can never bypass
 * the deadline by simply not checking it, the effective status is always
 * read from recovered_batch_status right before the decision.
 */
export async function reuseRecoveredBatch(pool: pg.Pool, input: ReuseRecoveredBatchInput, actorId: string): Promise<{ id: string }> {
  return withTransaction(pool, async (client) => {
    const batch = await requireRecoveredBatch(client, input.recoveredBatchId);
    await requireProductionRunExists(client, input.destinationProductionRunId);

    const status = await client.query<{ effective_status: string; remaining_quantity: string }>(
      'SELECT effective_status, remaining_quantity FROM recovered_batch_status WHERE recovered_batch_id = $1',
      [input.recoveredBatchId],
    );
    const effectiveStatus = status.rows[0]?.effective_status;
    const remaining = status.rows[0]?.remaining_quantity ?? '0';

    if (effectiveStatus === 'EXPIRE') {
      throw conflictError(
        'Réutilisation impossible.\nCette huile récupérée a dépassé la durée maximale autorisée.',
        { recoveredBatchId: input.recoveredBatchId },
      );
    }
    if (effectiveStatus === 'BLOQUE' || effectiveStatus === 'ELIMINE' || effectiveStatus === 'EPUISE') {
      throw conflictError(`Ce lot de récupération n'est pas disponible à la réutilisation (statut : ${effectiveStatus}).`, {
        recoveredBatchId: input.recoveredBatchId,
      });
    }
    if (Number(remaining) < Number(input.quantity)) {
      throw conflictError(
        `Quantité récupérée insuffisante.\nRestant : ${remaining} ${batch.unit}\nDemandé : ${input.quantity} ${input.unit}`,
        { recoveredBatchId: input.recoveredBatchId },
      );
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO recovered_ingredient_reuse
           (recovered_batch_id, destination_production_run_id, destination_filling_operation_id, quantity, unit,
            reused_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        input.recoveredBatchId,
        input.destinationProductionRunId,
        input.destinationFillingOperationId,
        input.quantity,
        input.unit,
        input.reusedAt,
        actorId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La réutilisation n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'RECOVERED_BATCH_REUTILISATION',
      entityType: 'recovered_ingredient_reuse',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: { recoveryCode: batch.recoveryCode },
    });
    return { id };
  });
}

/** BLOQUE/ELIMINE are the only manual overrides an operator/QUALITE can set
 * (section 27); DISPONIBLE/UTILISE_PARTIELLEMENT/EPUISE/EXPIRE stay purely
 * computed. */
export async function setRecoveredBatchManualStatus(
  pool: pg.Pool,
  id: string,
  status: RecoveredBatchManualStatus,
  reason: string,
  actorId: string,
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const batch = await requireRecoveredBatch(client, id);
    if (batch.status === status) {
      return;
    }
    await client.query('UPDATE recovered_ingredient_batches SET status = $2 WHERE id = $1', [id, status]);
    await recordAudit(client, {
      userId: actorId,
      action: 'RECOVERED_BATCH_STATUT',
      entityType: 'recovered_ingredient_batches',
      entityId: id,
      oldValues: { status: batch.status },
      newValues: { status, reason },
      context: null,
    });
  });
}

export type RecoveredBatchRow = Readonly<{
  id: string;
  recoveryCode: string;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  sourceProductionRunId: string;
  sourceRunCode: string;
  recoveredAt: Date;
  quantity: string;
  reusedQuantity: string;
  remainingQuantity: string;
  unit: string;
  storageLocationCode: string | null;
  reuseDeadline: Date;
  isExpired: boolean;
  effectiveStatus: string;
}>;

export async function listRecoveredBatches(
  pool: pg.Pool,
  filters: Readonly<{ ingredientId: string | null; availableOnly: boolean }>,
): Promise<readonly RecoveredBatchRow[]> {
  const result = await pool.query<RecoveredBatchRow>(
    `SELECT b.id AS "id", b.recovery_code AS "recoveryCode", b.ingredient_id AS "ingredientId",
            i.ingredient_code AS "ingredientCode", i.name AS "ingredientName",
            b.source_production_run_id AS "sourceProductionRunId", r.run_code AS "sourceRunCode",
            b.recovered_at AS "recoveredAt", b.quantity::text AS "quantity",
            s.reused_quantity::text AS "reusedQuantity", s.remaining_quantity::text AS "remainingQuantity",
            b.unit AS "unit", loc.code AS "storageLocationCode", b.reuse_deadline AS "reuseDeadline",
            s.is_expired AS "isExpired", s.effective_status AS "effectiveStatus"
       FROM recovered_ingredient_batches b
       JOIN ingredients i ON i.id = b.ingredient_id
       JOIN production_runs r ON r.id = b.source_production_run_id
       LEFT JOIN locations loc ON loc.id = b.storage_location_id
       JOIN recovered_batch_status s ON s.recovered_batch_id = b.id
      WHERE ($1::uuid IS NULL OR b.ingredient_id = $1)
        AND ($2::boolean IS FALSE OR s.effective_status IN ('DISPONIBLE', 'UTILISE_PARTIELLEMENT'))
      ORDER BY b.recovered_at DESC`,
    [filters.ingredientId, filters.availableOnly],
  );
  return result.rows;
}

export type RecoveredBatchReuseRow = Readonly<{
  id: string;
  destinationRunCode: string;
  quantity: string;
  unit: string;
  reusedAt: Date;
}>;

export async function listRecoveredBatchReuses(pool: pg.Pool, recoveredBatchId: string): Promise<readonly RecoveredBatchReuseRow[]> {
  const result = await pool.query<RecoveredBatchReuseRow>(
    `SELECT u.id AS "id", r.run_code AS "destinationRunCode", u.quantity::text AS "quantity", u.unit AS "unit",
            u.reused_at AS "reusedAt"
       FROM recovered_ingredient_reuse u
       JOIN production_runs r ON r.id = u.destination_production_run_id
      WHERE u.recovered_batch_id = $1
      ORDER BY u.reused_at`,
    [recoveredBatchId],
  );
  return result.rows;
}
