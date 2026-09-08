import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { requireRun } from './production.ts';

// Seaming operation: the seaming production context (section 20). Seaming
// control: a quality inspection of the seam (section 22), structurally
// separate from the operation itself.

export type SeamingOperation = Readonly<{
  id: string;
  operationCode: string;
  productionRunId: string;
  status: string;
}>;

async function requireSeamingOperation(
  client: DatabaseClient,
  id: string,
): Promise<SeamingOperation> {
  const result = await client.query<{
    id: string;
    operation_code: string;
    production_run_id: string;
    status: string;
  }>(
    'SELECT id, operation_code, production_run_id, status FROM seaming_operations WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Opération de sertissage', id);
  }
  return { id: row.id, operationCode: row.operation_code, productionRunId: row.production_run_id, status: row.status };
}

function assertSeamingOperationOpen(operation: SeamingOperation): void {
  if (operation.status !== 'EN_COURS') {
    throw conflictError(
      `L'opération de sertissage ${operation.operationCode} n'est pas en cours : aucune nouvelle saisie n'est possible.`,
      { seamingOperationId: operation.id, status: operation.status },
    );
  }
}

export type CreateSeamingOperationInput = Readonly<{
  productionRunId: string;
  fillingOperationId: string | null;
  machineId: string | null;
  productionLineId: string | null;
  notes: string | null;
}>;

export async function createSeamingOperation(
  pool: pg.Pool,
  input: CreateSeamingOperationInput,
  actorId: string,
): Promise<SeamingOperation> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, input.productionRunId);
    const operationCode = await nextOperationalCode(client, 'SRT', new Date());
    const inserted = await client.query<{ id: string; status: string }>(
      `INSERT INTO seaming_operations (operation_code, production_run_id, filling_operation_id,
                                       machine_id, production_line_id, status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, 'EN_COURS', $6, $7)
       RETURNING id, status`,
      [
        operationCode,
        run.id,
        input.fillingOperationId,
        input.machineId,
        input.productionLineId,
        input.notes,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'opération de sertissage n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'SEAMING_OPERATION_CREATION',
      entityType: 'seaming_operations',
      entityId: row.id,
      oldValues: null,
      newValues: { operationCode, runCode: run.runCode },
      context: null,
    });
    return { id: row.id, operationCode, productionRunId: run.id, status: row.status };
  });
}

export async function closeSeamingOperation(
  pool: pg.Pool,
  id: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const operation = await requireSeamingOperation(client, id);
    assertSeamingOperationOpen(operation);
    await client.query(
      "UPDATE seaming_operations SET status = 'TERMINE', ended_at = now() WHERE id = $1",
      [operation.id],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'SEAMING_OPERATION_CLOTURE',
      entityType: 'seaming_operations',
      entityId: operation.id,
      oldValues: { status: 'EN_COURS' },
      newValues: { status: 'TERMINE' },
      context: null,
    });
  });
}

export type MatchedSeamingSpec = Readonly<{
  id: string;
  minValue: string | null;
  maxValue: string | null;
  targetValue: string | null;
  unit: string;
}> | null;

/**
 * Selects the most specific active seaming specification for a parameter
 * (section 24). Same deterministic scoring rule as filling specs and cadence
 * standards: product (2) + format (1), NULL on the spec matches anything, ties
 * broken by the most recently created specification.
 */
async function findMatchingSeamingSpec(
  client: DatabaseClient,
  context: Readonly<{
    seamingParameterId: string;
    productId: string | null;
    format: string | null;
    atDate: Date;
  }>,
): Promise<MatchedSeamingSpec> {
  const result = await client.query<{
    id: string;
    min_value: string | null;
    max_value: string | null;
    target_value: string | null;
    unit: string;
  }>(
    `SELECT id, min_value::text, max_value::text, target_value::text, unit
       FROM seaming_specifications
      WHERE is_active = TRUE
        AND seaming_parameter_id = $1
        AND (product_id IS NULL OR product_id = $2)
        AND (format IS NULL OR format = $3)
        AND (valid_from IS NULL OR valid_from <= $4::date)
        AND (valid_to IS NULL OR valid_to >= $4::date)
      ORDER BY
        (CASE WHEN product_id IS NOT NULL THEN 2 ELSE 0 END
         + CASE WHEN format IS NOT NULL THEN 1 ELSE 0 END) DESC,
        created_at DESC
      LIMIT 1`,
    [context.seamingParameterId, context.productId, context.format, context.atDate],
  );
  const row = result.rows[0];
  return row
    ? { id: row.id, minValue: row.min_value, maxValue: row.max_value, targetValue: row.target_value, unit: row.unit }
    : null;
}

export type SeamingControlSummary = Readonly<{
  measurementCount: number;
  nonConformeCount: number;
  result: string;
}>;

async function seamingControlResult(
  client: DatabaseClient,
  seamingControlId: string,
): Promise<SeamingControlSummary> {
  const result = await client.query<{
    measurement_count: number;
    non_conforme_count: number;
    result: string;
  }>(
    `SELECT measurement_count, non_conforme_count, result
       FROM seaming_control_result WHERE seaming_control_id = $1`,
    [seamingControlId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Contrôle sertissage', seamingControlId);
  }
  return {
    measurementCount: row.measurement_count,
    nonConformeCount: row.non_conforme_count,
    result: row.result,
  };
}

export type CreateSeamingControlInput = Readonly<{
  machineId: string | null;
  controlledAt: Date;
  notes: string | null;
}>;

export async function createSeamingControl(
  pool: pg.Pool,
  seamingOperationId: string,
  input: CreateSeamingControlInput,
  actorId: string,
): Promise<Readonly<{ id: string; summary: SeamingControlSummary }>> {
  return withTransaction(pool, async (client) => {
    const operation = await requireSeamingOperation(client, seamingOperationId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO seaming_controls (seaming_operation_id, production_run_id, controlled_at,
                                     controller_user_id, machine_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [operation.id, operation.productionRunId, input.controlledAt, actorId, input.machineId, input.notes],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le contrôle sertissage n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'SEAMING_CONTROL_CREATION',
      entityType: 'seaming_controls',
      entityId: id,
      oldValues: null,
      newValues: { seamingOperationId },
      context: null,
    });
    const summary = await seamingControlResult(client, id);
    return { id, summary };
  });
}

export type RecordMeasurementInput = Readonly<{
  seamingParameterId: string;
  sampleNumber: number | null;
  measuredValue: string;
  unit: string;
  productId: string | null;
  format: string | null;
}>;

export type RecordMeasurementResult = Readonly<{
  id: string;
  status: string | null;
  summary: SeamingControlSummary;
}>;

/**
 * Records one seaming measurement (section 23). Out-of-range becomes
 * NON_CONFORME automatically (section 16's "never select status manually"
 * applies identically here) - never typed by the controller.
 */
export async function recordSeamingMeasurement(
  pool: pg.Pool,
  seamingControlId: string,
  input: RecordMeasurementInput,
  actorId: string,
): Promise<RecordMeasurementResult> {
  return withTransaction(pool, async (client) => {
    const control = await client.query('SELECT id, controlled_at FROM seaming_controls WHERE id = $1', [
      seamingControlId,
    ]);
    const controlRow = control.rows[0] as { id: string; controlled_at: Date } | undefined;
    if (!controlRow) {
      throw notFoundError('Contrôle sertissage', seamingControlId);
    }

    const spec = await findMatchingSeamingSpec(client, {
      seamingParameterId: input.seamingParameterId,
      productId: input.productId,
      format: input.format,
      atDate: controlRow.controlled_at,
    });

    const inserted = await client.query<{ id: string; status: string | null }>(
      `INSERT INTO seaming_measurements (seaming_control_id, seaming_parameter_id, sample_number,
                                         measured_value, unit, specification_id, min_value_snapshot,
                                         max_value_snapshot, target_value_snapshot, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, status`,
      [
        seamingControlId,
        input.seamingParameterId,
        input.sampleNumber,
        input.measuredValue,
        input.unit,
        spec?.id ?? null,
        spec?.minValue ?? null,
        spec?.maxValue ?? null,
        spec?.targetValue ?? null,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("La mesure de sertissage n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'SEAMING_MEASUREMENT_CREATION',
      entityType: 'seaming_measurements',
      entityId: row.id,
      oldValues: null,
      newValues: { seamingControlId, measuredValue: input.measuredValue, status: row.status },
      context: null,
    });
    const summary = await seamingControlResult(client, seamingControlId);
    return { id: row.id, status: row.status, summary };
  });
}

/** Corrects a validated measurement: reversal-and-replace (section 58). */
export async function correctSeamingMeasurement(
  pool: pg.Pool,
  measurementId: string,
  correctedValue: string | null,
  reason: string,
  actorId: string,
): Promise<Readonly<{ cancelledId: string; replacementId: string | null }>> {
  return withTransaction(pool, async (client) => {
    const original = await client.query<{
      id: string;
      seaming_control_id: string;
      seaming_parameter_id: string;
      sample_number: number | null;
      unit: string;
      specification_id: string | null;
      min_value_snapshot: string | null;
      max_value_snapshot: string | null;
      target_value_snapshot: string | null;
      record_status: string;
    }>(
      `SELECT id, seaming_control_id, seaming_parameter_id, sample_number, unit, specification_id,
              min_value_snapshot, max_value_snapshot, target_value_snapshot, record_status
         FROM seaming_measurements WHERE id = $1`,
      [measurementId],
    );
    const row = original.rows[0];
    if (!row) {
      throw notFoundError('Mesure de sertissage', measurementId);
    }
    if (row.record_status !== 'VALIDE') {
      throw conflictError('Cette mesure a déjà été annulée.', { measurementId });
    }

    await client.query(
      `UPDATE seaming_measurements
          SET record_status = 'ANNULE', cancelled_at = now(), cancelled_by = $2,
              cancellation_reason = $3
        WHERE id = $1`,
      [row.id, actorId, reason],
    );

    let replacementId: string | null = null;
    if (correctedValue !== null) {
      const replacement = await client.query<{ id: string }>(
        `INSERT INTO seaming_measurements (seaming_control_id, seaming_parameter_id, sample_number,
                                           measured_value, unit, specification_id, min_value_snapshot,
                                           max_value_snapshot, target_value_snapshot, replaces_id,
                                           created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          row.seaming_control_id,
          row.seaming_parameter_id,
          row.sample_number,
          correctedValue,
          row.unit,
          row.specification_id,
          row.min_value_snapshot,
          row.max_value_snapshot,
          row.target_value_snapshot,
          row.id,
          actorId,
        ],
      );
      replacementId = replacement.rows[0]?.id ?? null;
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'SEAMING_MEASUREMENT_CORRECTION',
      entityType: 'seaming_measurements',
      entityId: row.id,
      oldValues: { recordStatus: 'VALIDE' },
      newValues: { recordStatus: 'ANNULE', reason },
      context: { replacementId },
    });

    return { cancelledId: row.id, replacementId };
  });
}
