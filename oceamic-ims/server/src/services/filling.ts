import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { requireRun } from './production.ts';

// Filling operation: the production filling context (section 6). Always
// attached to an existing Run - there is no disconnected downstream process.

export type FillingOperation = Readonly<{
  id: string;
  operationCode: string;
  productionRunId: string;
  productId: string;
  format: string | null;
  piecesPerCan: number | null;
  status: string;
}>;

async function requireFillingOperation(
  client: DatabaseClient,
  id: string,
): Promise<FillingOperation> {
  const result = await client.query<{
    id: string;
    operation_code: string;
    production_run_id: string;
    product_id: string;
    format: string | null;
    pieces_per_can: number | null;
    status: string;
  }>(
    `SELECT id, operation_code, production_run_id, product_id, format, pieces_per_can, status
       FROM filling_operations WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Opération de remplissage', id);
  }
  return {
    id: row.id,
    operationCode: row.operation_code,
    productionRunId: row.production_run_id,
    productId: row.product_id,
    format: row.format,
    piecesPerCan: row.pieces_per_can,
    status: row.status,
  };
}

function assertFillingOperationOpen(operation: FillingOperation): void {
  if (operation.status !== 'EN_COURS') {
    throw conflictError(
      `L'opération de remplissage ${operation.operationCode} est ${operation.status === 'TERMINE' ? 'terminée' : operation.status === 'ANNULE' ? 'annulée' : 'planifiée'} : aucune nouvelle saisie n'est possible.`,
      { fillingOperationId: operation.id, status: operation.status },
    );
  }
}

export type CreateFillingOperationInput = Readonly<{
  productionRunId: string;
  productionLineId: string | null;
  format: string | null;
  piecesPerCan: number | null;
  fillingMediumId: string | null;
  notes: string | null;
}>;

/** Starts a filling operation directly EN_COURS: the controller begins filling as they create it. */
export async function createFillingOperation(
  pool: pg.Pool,
  input: CreateFillingOperationInput,
  actorId: string,
): Promise<FillingOperation> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, input.productionRunId);
    const operationCode = await nextOperationalCode(client, 'RMP', new Date());
    const inserted = await client.query<{ id: string; status: string }>(
      `INSERT INTO filling_operations (operation_code, production_run_id, production_line_id,
                                       product_id, format, pieces_per_can, filling_medium_id,
                                       status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_COURS', $8, $9)
       RETURNING id, status`,
      [
        operationCode,
        run.id,
        input.productionLineId,
        run.productId,
        input.format,
        input.piecesPerCan,
        input.fillingMediumId,
        input.notes,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'opération de remplissage n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'FILLING_OPERATION_CREATION',
      entityType: 'filling_operations',
      entityId: row.id,
      oldValues: null,
      newValues: { operationCode, runCode: run.runCode },
      context: null,
    });
    return {
      id: row.id,
      operationCode,
      productionRunId: run.id,
      productId: run.productId,
      format: input.format,
      piecesPerCan: input.piecesPerCan,
      status: row.status,
    };
  });
}

export async function closeFillingOperation(
  pool: pg.Pool,
  id: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const operation = await requireFillingOperation(client, id);
    assertFillingOperationOpen(operation);
    await client.query(
      "UPDATE filling_operations SET status = 'TERMINE', ended_at = now(), updated_at = now() WHERE id = $1",
      [operation.id],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'FILLING_OPERATION_CLOTURE',
      entityType: 'filling_operations',
      entityId: operation.id,
      oldValues: { status: 'EN_COURS' },
      newValues: { status: 'TERMINE' },
      context: null,
    });
  });
}

export async function cancelFillingOperation(
  pool: pg.Pool,
  id: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const operation = await requireFillingOperation(client, id);
    assertFillingOperationOpen(operation);
    await client.query(
      "UPDATE filling_operations SET status = 'ANNULE', ended_at = now(), notes = COALESCE(notes || ' — ', '') || $2, updated_at = now() WHERE id = $1",
      [operation.id, `Annulée : ${reason}`],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'FILLING_OPERATION_ANNULATION',
      entityType: 'filling_operations',
      entityId: operation.id,
      oldValues: { status: 'EN_COURS' },
      newValues: { status: 'ANNULE', reason },
      context: null,
    });
  });
}

export type MatchedFillingSpec = Readonly<{
  id: string;
  minWeightG: string;
  maxWeightG: string;
  targetNetWeightG: string | null;
}> | null;

/**
 * Selects the most specific active filling specification for a product
 * (section 8). Matching dimensions, most to least specific: format, pieces
 * per can - a NULL dimension on the spec matches anything, exactly the
 * deterministic scoring rule used for cadence standards in Phase 3. Ties
 * break on the most recently created specification.
 */
export async function findMatchingFillingSpec(
  client: DatabaseClient,
  context: Readonly<{
    productId: string;
    format: string | null;
    piecesPerCan: number | null;
    atDate: Date;
  }>,
): Promise<MatchedFillingSpec> {
  const result = await client.query<{
    id: string;
    min_weight_g: string;
    max_weight_g: string;
    target_net_weight_g: string | null;
  }>(
    `SELECT id, min_weight_g::text, max_weight_g::text, target_net_weight_g::text
       FROM product_filling_specs
      WHERE is_active = TRUE
        AND product_id = $1
        AND (format IS NULL OR format = $2)
        AND (pieces_per_can IS NULL OR pieces_per_can = $3)
        AND (valid_from IS NULL OR valid_from <= $4::date)
        AND (valid_to IS NULL OR valid_to >= $4::date)
      ORDER BY
        (CASE WHEN format IS NOT NULL THEN 2 ELSE 0 END
         + CASE WHEN pieces_per_can IS NOT NULL THEN 1 ELSE 0 END) DESC,
        created_at DESC
      LIMIT 1`,
    [context.productId, context.format, context.piecesPerCan, context.atDate],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        minWeightG: row.min_weight_g,
        maxWeightG: row.max_weight_g,
        targetNetWeightG: row.target_net_weight_g,
      }
    : null;
}

export type StartWeightControlInput = Readonly<{
  sampleSize: number;
  controlledAt: Date;
}>;

export type WeightControlSummary = Readonly<{
  sampleSize: number;
  sampleCount: number;
  averageWeightG: string | null;
  minMeasuredWeightG: string | null;
  maxMeasuredWeightG: string | null;
  underweightCount: number;
  conformeCount: number;
  overweightCount: number;
  underweightPercent: string | null;
  conformePercent: string | null;
  overweightPercent: string | null;
  controlStatus: string;
}>;

async function weightControlSummary(
  client: DatabaseClient,
  weightControlId: string,
): Promise<WeightControlSummary> {
  const result = await client.query<{
    sample_size: number;
    sample_count: number;
    average_weight_g: string | null;
    min_measured_weight_g: string | null;
    max_measured_weight_g: string | null;
    underweight_count: number;
    conforme_count: number;
    overweight_count: number;
    underweight_percent: string | null;
    conforme_percent: string | null;
    overweight_percent: string | null;
    control_status: string;
  }>(
    `SELECT sample_size, sample_count, average_weight_g::text AS average_weight_g,
            min_measured_weight_g::text AS min_measured_weight_g,
            max_measured_weight_g::text AS max_measured_weight_g,
            underweight_count, conforme_count, overweight_count,
            underweight_percent::text AS underweight_percent,
            conforme_percent::text AS conforme_percent,
            overweight_percent::text AS overweight_percent, control_status
       FROM filling_weight_control_summary WHERE weight_control_id = $1`,
    [weightControlId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Contrôle poids', weightControlId);
  }
  return {
    sampleSize: row.sample_size,
    sampleCount: row.sample_count,
    averageWeightG: row.average_weight_g,
    minMeasuredWeightG: row.min_measured_weight_g,
    maxMeasuredWeightG: row.max_measured_weight_g,
    underweightCount: row.underweight_count,
    conformeCount: row.conforme_count,
    overweightCount: row.overweight_count,
    underweightPercent: row.underweight_percent,
    conformePercent: row.conforme_percent,
    overweightPercent: row.overweight_percent,
    controlStatus: row.control_status,
  };
}

/**
 * Opens a weight control (section 9). A matching filling specification is
 * required: without configured limits there is nothing to classify a sample
 * against, and section 8 forbids inventing a threshold.
 */
export async function startWeightControl(
  pool: pg.Pool,
  fillingOperationId: string,
  input: StartWeightControlInput,
  actorId: string,
): Promise<Readonly<{ id: string; controlCode: string; summary: WeightControlSummary }>> {
  return withTransaction(pool, async (client) => {
    const operation = await requireFillingOperation(client, fillingOperationId);
    assertFillingOperationOpen(operation);

    const spec = await findMatchingFillingSpec(client, {
      productId: operation.productId,
      format: operation.format,
      piecesPerCan: operation.piecesPerCan,
      atDate: input.controlledAt,
    });
    if (!spec) {
      throw validationError(
        "Aucune spécification de remplissage active pour ce produit : le contrôle poids ne peut pas être ouvert sans poids min/max configurés.",
        { fillingOperationId },
      );
    }

    const controlCode = await nextOperationalCode(client, 'CP', input.controlledAt);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO filling_weight_controls (control_code, filling_operation_id, production_run_id,
                                            controlled_at, controller_user_id, sample_size,
                                            specification_id, min_weight_g_snapshot,
                                            max_weight_g_snapshot, target_net_weight_g_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        controlCode,
        operation.id,
        operation.productionRunId,
        input.controlledAt,
        actorId,
        input.sampleSize,
        spec.id,
        spec.minWeightG,
        spec.maxWeightG,
        spec.targetNetWeightG,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le contrôle poids n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'WEIGHT_CONTROL_CREATION',
      entityType: 'filling_weight_controls',
      entityId: id,
      oldValues: null,
      newValues: { controlCode, fillingOperationId, sampleSize: input.sampleSize },
      context: { minWeightG: spec.minWeightG, maxWeightG: spec.maxWeightG },
    });
    const summary = await weightControlSummary(client, id);
    return { id, controlCode, summary };
  });
}

export type RecordSampleInput = Readonly<{ sampleNumber: number; measuredWeightG: string }>;

export type RecordSampleResult = Readonly<{
  id: string;
  status: string;
  deviationG: string;
  summary: WeightControlSummary;
}>;

/** Records one measured can (section 10/12): status is always DB-derived, never typed. */
export async function recordWeightSample(
  pool: pg.Pool,
  weightControlId: string,
  input: RecordSampleInput,
  actorId: string,
): Promise<RecordSampleResult> {
  return withTransaction(pool, async (client) => {
    const control = await client.query<{
      id: string;
      min_weight_g_snapshot: string | null;
      max_weight_g_snapshot: string | null;
    }>(
      'SELECT id, min_weight_g_snapshot, max_weight_g_snapshot FROM filling_weight_controls WHERE id = $1',
      [weightControlId],
    );
    const row = control.rows[0];
    if (!row) {
      throw notFoundError('Contrôle poids', weightControlId);
    }
    if (row.min_weight_g_snapshot === null || row.max_weight_g_snapshot === null) {
      throw validationError('Ce contrôle poids ne possède aucune limite de poids.', {
        weightControlId,
      });
    }

    const duplicate = await client.query(
      "SELECT id FROM filling_weight_samples WHERE weight_control_id = $1 AND sample_number = $2 AND record_status = 'VALIDE'",
      [weightControlId, input.sampleNumber],
    );
    if (duplicate.rows.length > 0) {
      throw conflictError(`La boîte n°${input.sampleNumber} est déjà enregistrée pour ce contrôle.`, {
        weightControlId,
        sampleNumber: input.sampleNumber,
      });
    }

    const inserted = await client.query<{ id: string; status: string; deviation_g: string }>(
      `INSERT INTO filling_weight_samples (weight_control_id, sample_number, measured_weight_g,
                                           min_weight_g, max_weight_g, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status, deviation_g::text`,
      [
        weightControlId,
        input.sampleNumber,
        input.measuredWeightG,
        row.min_weight_g_snapshot,
        row.max_weight_g_snapshot,
        actorId,
      ],
    );
    const sample = inserted.rows[0];
    if (!sample) {
      throw new Error("La pesée n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'WEIGHT_SAMPLE_CREATION',
      entityType: 'filling_weight_samples',
      entityId: sample.id,
      oldValues: null,
      newValues: {
        weightControlId,
        sampleNumber: input.sampleNumber,
        measuredWeightG: input.measuredWeightG,
        status: sample.status,
      },
      context: null,
    });
    const summary = await weightControlSummary(client, weightControlId);
    return { id: sample.id, status: sample.status, deviationG: sample.deviation_g, summary };
  });
}

/**
 * Corrects a validated sample: reversal-and-replace (section 58), exactly the
 * pattern used for Phase 2 consumption and Phase 3 cadence controls.
 */
export async function correctWeightSample(
  pool: pg.Pool,
  sampleId: string,
  correctedWeightG: string | null,
  reason: string,
  actorId: string,
): Promise<Readonly<{ cancelledId: string; replacementId: string | null }>> {
  return withTransaction(pool, async (client) => {
    const original = await client.query<{
      id: string;
      weight_control_id: string;
      sample_number: number;
      min_weight_g: string;
      max_weight_g: string;
      record_status: string;
    }>(
      `SELECT id, weight_control_id, sample_number, min_weight_g, max_weight_g, record_status
         FROM filling_weight_samples WHERE id = $1`,
      [sampleId],
    );
    const row = original.rows[0];
    if (!row) {
      throw notFoundError('Pesée', sampleId);
    }
    if (row.record_status !== 'VALIDE') {
      throw conflictError('Cette pesée a déjà été annulée.', { sampleId });
    }

    await client.query(
      `UPDATE filling_weight_samples
          SET record_status = 'ANNULE', cancelled_at = now(), cancelled_by = $2,
              cancellation_reason = $3
        WHERE id = $1`,
      [row.id, actorId, reason],
    );

    let replacementId: string | null = null;
    if (correctedWeightG !== null) {
      const replacement = await client.query<{ id: string }>(
        `INSERT INTO filling_weight_samples (weight_control_id, sample_number, measured_weight_g,
                                             min_weight_g, max_weight_g, replaces_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          row.weight_control_id,
          row.sample_number,
          correctedWeightG,
          row.min_weight_g,
          row.max_weight_g,
          row.id,
          actorId,
        ],
      );
      replacementId = replacement.rows[0]?.id ?? null;
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'WEIGHT_SAMPLE_CORRECTION',
      entityType: 'filling_weight_samples',
      entityId: row.id,
      oldValues: { recordStatus: 'VALIDE' },
      newValues: { recordStatus: 'ANNULE', reason },
      context: { replacementId },
    });

    return { cancelledId: row.id, replacementId };
  });
}
