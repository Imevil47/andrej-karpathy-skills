import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type {
  BalanceStatus,
  OutputType,
  RunLineActivity,
  RunStatus,
} from '../domain/types.ts';
import { requiresDifferenceJustification, runAcceptsEntries } from '../domain/types.ts';
import type { QuantityKg } from '../domain/quantity.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { refreshLotStatus, requireLot } from './lots.ts';
import { createStockMovement, reverseStockMovement } from './stock.ts';

// A production run is a transformation context. It never holds a quantity and
// never duplicates raw material identity: quantities come from the consumption
// and output ledgers, lots come from raw_material_lots.

export type ProductionRun = Readonly<{
  id: string;
  runCode: string;
  status: RunStatus;
  productId: string;
  speciesId: string;
}>;

type RunRow = {
  id: string;
  run_code: string;
  status: RunStatus;
  product_id: string;
  species_id: string;
};

export async function requireRun(
  client: DatabaseClient,
  runId: string,
): Promise<ProductionRun> {
  const result = await client.query<RunRow>(
    'SELECT id, run_code, status, product_id, species_id FROM production_runs WHERE id = $1',
    [runId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Ordre de production', runId);
  }
  return {
    id: row.id,
    runCode: row.run_code,
    status: row.status,
    productId: row.product_id,
    speciesId: row.species_id,
  };
}

/**
 * A closed or cancelled run no longer accepts material entries. Corrections of
 * already validated records stay possible, through the reversal services.
 */
function assertRunAcceptsEntries(run: ProductionRun): void {
  if (!runAcceptsEntries(run.status)) {
    throw conflictError(
      `L'ordre de production ${run.runCode} est ${run.status === 'TERMINE' ? 'terminé' : 'annulé'} : aucune nouvelle saisie n'est possible.`,
      { runId: run.id, status: run.status },
    );
  }
}

export type RunLineInput = Readonly<{
  productionLineId: string;
  activityType: RunLineActivity;
}>;

export type CreateRunInput = Readonly<{
  productionDate: string;
  productId: string;
  format: string | null;
  piecesPerCan: number | null;
  responsibleUserId: string | null;
  lines: readonly RunLineInput[];
  notes: string | null;
}>;

/**
 * Creates a production run. The species is derived from the product: the
 * operator never selects a raw material family that could contradict the
 * product reference. Raw material is not selected here — consumption is a
 * separate physical event.
 */
export async function createRun(
  pool: pg.Pool,
  input: CreateRunInput,
  actorId: string,
): Promise<ProductionRun> {
  return withTransaction(pool, async (client) => {
    const product = await client.query<{
      id: string;
      species_id: string;
      format: string | null;
      pieces_per_can: number | null;
      is_active: boolean;
      code: string;
    }>(
      'SELECT id, species_id, format, pieces_per_can, is_active, code FROM products WHERE id = $1',
      [input.productId],
    );
    const productRow = product.rows[0];
    if (!productRow) {
      throw notFoundError('Produit', input.productId);
    }
    if (!productRow.is_active) {
      throw validationError(`Le produit ${productRow.code} est désactivé.`, {
        productId: input.productId,
      });
    }

    const runCode = await nextOperationalCode(client, 'RUN', new Date(input.productionDate));
    const inserted = await client.query<RunRow>(
      `INSERT INTO production_runs (run_code, production_date, species_id, product_id, format,
                                    pieces_per_can, status, responsible_user_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'PLANIFIE', $7, $8, $9)
       RETURNING id, run_code, status, product_id, species_id`,
      [
        runCode,
        input.productionDate,
        productRow.species_id,
        productRow.id,
        // Format and pieces per can default to the product reference so the
        // operator never retypes what master data already knows.
        input.format ?? productRow.format,
        input.piecesPerCan ?? productRow.pieces_per_can,
        input.responsibleUserId,
        input.notes,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'ordre de production n'a pas pu être créé.");
    }

    for (const line of input.lines) {
      await client.query(
        `INSERT INTO production_run_lines (production_run_id, production_line_id, activity_type,
                                           is_active_for_run, created_by)
         VALUES ($1, $2, $3, TRUE, $4)`,
        [row.id, line.productionLineId, line.activityType, actorId],
      );
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'PRODUCTION_RUN_CREATION',
      entityType: 'production_runs',
      entityId: row.id,
      oldValues: null,
      newValues: {
        runCode,
        productionDate: input.productionDate,
        productId: input.productId,
        lines: input.lines.length,
      },
      context: null,
    });

    return {
      id: row.id,
      runCode: row.run_code,
      status: row.status,
      productId: row.product_id,
      speciesId: row.species_id,
    };
  });
}

export async function startRun(
  pool: pg.Pool,
  runId: string,
  actorId: string,
): Promise<{ status: RunStatus }> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, runId);
    if (run.status !== 'PLANIFIE' && run.status !== 'SUSPENDU') {
      throw conflictError(
        `L'ordre de production ${run.runCode} ne peut pas être démarré depuis son statut actuel.`,
        { runId, status: run.status },
      );
    }
    await client.query(
      `UPDATE production_runs
          SET status = 'EN_COURS',
              started_at = COALESCE(started_at, now()),
              updated_at = now()
        WHERE id = $1`,
      [runId],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'PRODUCTION_RUN_DEMARRAGE',
      entityType: 'production_runs',
      entityId: runId,
      oldValues: { status: run.status },
      newValues: { status: 'EN_COURS' },
      context: { runCode: run.runCode },
    });
    return { status: 'EN_COURS' };
  });
}

export type MaterialBalance = Readonly<{
  inputKg: QuantityKg;
  usefulKg: QuantityKg;
  byProductKg: QuantityKg;
  reworkKg: QuantityKg;
  reclassifiedKg: QuantityKg;
  realLossKg: QuantityKg;
  otherKg: QuantityKg;
  accountedKg: QuantityKg;
  differenceKg: QuantityKg;
  differencePercent: string | null;
  balanceStatus: BalanceStatus;
  yieldPercent: string | null;
}>;

type BalanceRow = {
  input_kg: string;
  useful_kg: string;
  by_product_kg: string;
  rework_kg: string;
  reclassified_kg: string;
  real_loss_kg: string;
  other_kg: string;
  accounted_kg: string;
  difference_kg: string;
  difference_percent: string | null;
  balance_status: BalanceStatus;
  yield_percent: string | null;
};

/** Material balance and yield, always read from the database views. */
export async function materialBalance(
  client: DatabaseClient | pg.Pool,
  runId: string,
): Promise<MaterialBalance> {
  const result = await client.query<BalanceRow>(
    `SELECT b.input_kg, b.useful_kg, b.by_product_kg, b.rework_kg, b.reclassified_kg,
            b.real_loss_kg, b.other_kg, b.accounted_kg, b.difference_kg, b.difference_percent,
            b.balance_status, y.yield_percent
       FROM production_run_material_balance b
       JOIN production_run_yield y ON y.production_run_id = b.production_run_id
      WHERE b.production_run_id = $1`,
    [runId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Ordre de production', runId);
  }
  return {
    inputKg: row.input_kg,
    usefulKg: row.useful_kg,
    byProductKg: row.by_product_kg,
    reworkKg: row.rework_kg,
    reclassifiedKg: row.reclassified_kg,
    realLossKg: row.real_loss_kg,
    otherKg: row.other_kg,
    accountedKg: row.accounted_kg,
    differenceKg: row.difference_kg,
    differencePercent: row.difference_percent,
    balanceStatus: row.balance_status,
    yieldPercent: row.yield_percent,
  };
}

export type ConsumptionInput = Readonly<{
  rawMaterialLotId: string;
  sourceLocationId: string;
  quantityKg: QuantityKg;
  consumedAt: Date;
  notes: string | null;
}>;

/**
 * Consumes raw material into a run, in one transaction:
 * run and lot validation, quality block check, stock availability under lock,
 * consumption record, stock movement, audit. Any failure rolls everything back.
 *
 * Availability, quality blocking and concurrency protection are NOT
 * reimplemented here: they belong to the Phase 1 stock engine, which this
 * service calls with the CONSOMMATION movement type.
 */
export async function consumeRawMaterial(
  pool: pg.Pool,
  runId: string,
  input: ConsumptionInput,
  actorId: string,
): Promise<{ id: string; movementCode: string }> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, runId);
    assertRunAcceptsEntries(run);
    const lot = await requireLot(client, input.rawMaterialLotId);

    const movement = await createStockMovement(
      client,
      {
        lotId: lot.id,
        movementType: 'CONSOMMATION',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: null,
        quantityKg: input.quantityKg,
        referenceType: 'PRODUCTION',
        referenceId: run.id,
        reason: null,
        notes: input.notes,
        occurredAt: input.consumedAt,
        reversesMovementId: null,
      },
      actorId,
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO production_run_materials (production_run_id, raw_material_lot_id,
                                             source_location_id, quantity_kg, consumed_at,
                                             stock_movement_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        run.id,
        lot.id,
        input.sourceLocationId,
        input.quantityKg,
        input.consumedAt,
        movement.id,
        actorId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La consommation de matière première n'a pas pu être enregistrée.");
    }

    await refreshLotStatus(client, lot.id);

    await recordAudit(client, {
      userId: actorId,
      action: 'PRODUCTION_CONSOMMATION',
      entityType: 'production_run_materials',
      entityId: id,
      oldValues: null,
      newValues: {
        runCode: run.runCode,
        lotCode: lot.lotCode,
        quantityKg: input.quantityKg,
        sourceLocationId: input.sourceLocationId,
      },
      context: { movementCode: movement.movementCode },
    });

    return { id, movementCode: movement.movementCode };
  });
}

/**
 * Corrects a validated consumption. The original record is never edited: it is
 * cancelled by a reversal movement that gives the stock back, and an optional
 * replacement records the quantity that should have been consumed.
 */
export async function correctConsumption(
  pool: pg.Pool,
  consumptionId: string,
  correctedQuantityKg: QuantityKg | null,
  reason: string,
  actorId: string,
): Promise<{ cancelledId: string; replacementId: string | null }> {
  return withTransaction(pool, async (client) => {
    const original = await client.query<{
      id: string;
      production_run_id: string;
      raw_material_lot_id: string;
      source_location_id: string;
      quantity_kg: string;
      consumed_at: Date;
      stock_movement_id: string;
      status: string;
    }>(
      `SELECT id, production_run_id, raw_material_lot_id, source_location_id, quantity_kg,
              consumed_at, stock_movement_id, status
         FROM production_run_materials
        WHERE id = $1`,
      [consumptionId],
    );
    const row = original.rows[0];
    if (!row) {
      throw notFoundError('Consommation de matière première', consumptionId);
    }
    if (row.status !== 'VALIDE') {
      throw conflictError('Cette consommation a déjà été annulée.', { consumptionId });
    }

    const run = await requireRun(client, row.production_run_id);
    const reversal = await reverseStockMovement(client, row.stock_movement_id, reason, actorId);

    await client.query(
      `UPDATE production_run_materials
          SET status = 'ANNULE',
              cancelled_at = now(),
              cancelled_by = $2,
              cancellation_reason = $3,
              reversal_stock_movement_id = $4
        WHERE id = $1`,
      [row.id, actorId, reason, reversal.id],
    );

    let replacementId: string | null = null;
    if (correctedQuantityKg !== null) {
      const replacement = await consumeRawMaterialInTransaction(
        client,
        run,
        {
          rawMaterialLotId: row.raw_material_lot_id,
          sourceLocationId: row.source_location_id,
          quantityKg: correctedQuantityKg,
          consumedAt: row.consumed_at,
          notes: `Correction de la consommation du ${row.consumed_at.toISOString()}`,
        },
        actorId,
      );
      replacementId = replacement.id;
      await client.query('UPDATE production_run_materials SET replaces_id = $2 WHERE id = $1', [
        replacementId,
        row.id,
      ]);
    }

    await refreshLotStatus(client, row.raw_material_lot_id);

    await recordAudit(client, {
      userId: actorId,
      action: 'PRODUCTION_CONSOMMATION_CORRECTION',
      entityType: 'production_run_materials',
      entityId: row.id,
      oldValues: { quantityKg: row.quantity_kg, status: 'VALIDE' },
      newValues: { quantityKg: correctedQuantityKg, status: 'ANNULE', reason },
      context: { runCode: run.runCode, replacementId, reversalMovementId: reversal.id },
    });

    return { cancelledId: row.id, replacementId };
  });
}

/** Consumption step reused by the correction flow, inside an open transaction. */
async function consumeRawMaterialInTransaction(
  client: DatabaseClient,
  run: ProductionRun,
  input: ConsumptionInput,
  actorId: string,
): Promise<{ id: string }> {
  const movement = await createStockMovement(
    client,
    {
      lotId: input.rawMaterialLotId,
      movementType: 'CONSOMMATION',
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: null,
      quantityKg: input.quantityKg,
      referenceType: 'PRODUCTION',
      referenceId: run.id,
      reason: null,
      notes: input.notes,
      occurredAt: input.consumedAt,
      reversesMovementId: null,
    },
    actorId,
  );

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO production_run_materials (production_run_id, raw_material_lot_id,
                                           source_location_id, quantity_kg, consumed_at,
                                           stock_movement_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      run.id,
      input.rawMaterialLotId,
      input.sourceLocationId,
      input.quantityKg,
      input.consumedAt,
      movement.id,
      actorId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("La consommation corrigée n'a pas pu être enregistrée.");
  }
  return { id };
}

export type OutputInput = Readonly<{
  outputType: OutputType;
  quantityKg: QuantityKg;
  occurredAt: Date;
  productionLineId: string | null;
  destinationStageId: string | null;
  destinationLocationId: string | null;
  lossReasonId: string | null;
  reasonText: string | null;
  notes: string | null;
}>;

/**
 * Records a material disposition of the run: useful output, by-product,
 * rework, reclassification or real loss. These are internal production flow
 * events: they do not create inventory movements, because the material is not
 * held as controlled stock at these stages.
 */
export async function recordOutput(
  pool: pg.Pool,
  runId: string,
  input: OutputInput,
  actorId: string,
): Promise<{ id: string; balance: MaterialBalance }> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, runId);
    assertRunAcceptsEntries(run);

    if (input.outputType === 'PERTE_REELLE' && !input.lossReasonId && !input.reasonText) {
      throw validationError('Une perte réelle doit être motivée.', { runId });
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO production_outputs (production_run_id, output_type, quantity_kg, occurred_at,
                                       production_line_id, destination_stage_id,
                                       destination_location_id, loss_reason_id, reason_text,
                                       notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        run.id,
        input.outputType,
        input.quantityKg,
        input.occurredAt,
        input.productionLineId,
        input.destinationStageId,
        input.destinationLocationId,
        input.lossReasonId,
        input.reasonText,
        input.notes,
        actorId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La sortie de production n'a pas pu être enregistrée.");
    }

    await recordAudit(client, {
      userId: actorId,
      action:
        input.outputType === 'SORTIE_UTILE' || input.outputType === 'AUTRE'
          ? 'PRODUCTION_SORTIE'
          : 'PRODUCTION_PERTE',
      entityType: 'production_outputs',
      entityId: id,
      oldValues: null,
      newValues: {
        runCode: run.runCode,
        outputType: input.outputType,
        quantityKg: input.quantityKg,
        lossReasonId: input.lossReasonId,
      },
      context: null,
    });

    return { id, balance: await materialBalance(client, run.id) };
  });
}

/** Cancels a validated output or loss. The original row stays in history. */
export async function cancelOutput(
  pool: pg.Pool,
  outputId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const updated = await client.query<{
      production_run_id: string;
      output_type: string;
      quantity_kg: string;
    }>(
      `UPDATE production_outputs
          SET status = 'ANNULE',
              cancelled_at = now(),
              cancelled_by = $2,
              cancellation_reason = $3
        WHERE id = $1 AND status = 'VALIDE'
        RETURNING production_run_id, output_type, quantity_kg`,
      [outputId, actorId, reason],
    );
    const row = updated.rows[0];
    if (!row) {
      throw conflictError('Cette sortie a déjà été annulée ou est introuvable.', { outputId });
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'PRODUCTION_SORTIE_CORRECTION',
      entityType: 'production_outputs',
      entityId: outputId,
      oldValues: { status: 'VALIDE', quantityKg: row.quantity_kg, outputType: row.output_type },
      newValues: { status: 'ANNULE', reason },
      context: { runId: row.production_run_id },
    });
  });
}

/** Records the justification of an out-of-tolerance material difference. */
export async function justifyMaterialDifference(
  pool: pg.Pool,
  runId: string,
  justification: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const run = await requireRun(client, runId);
    const balance = await materialBalance(client, runId);
    await client.query(
      `UPDATE production_runs
          SET difference_justification = $2, justified_by = $3, justified_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [runId, justification, actorId],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'PRODUCTION_ECART_JUSTIFICATION',
      entityType: 'production_runs',
      entityId: runId,
      oldValues: null,
      newValues: { justification },
      context: {
        runCode: run.runCode,
        differenceKg: balance.differenceKg,
        differencePercent: balance.differencePercent,
      },
    });
  });
}

/**
 * Closes a run. A run never closes blindly: it must have consumed material,
 * and an out-of-tolerance material difference must have been justified first.
 */
export async function finishRun(
  pool: pg.Pool,
  runId: string,
  actorId: string,
): Promise<{ status: RunStatus; balance: MaterialBalance }> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, runId);
    if (run.status === 'TERMINE') {
      throw conflictError(`L'ordre de production ${run.runCode} est déjà terminé.`, { runId });
    }
    if (run.status === 'ANNULE') {
      throw conflictError(`L'ordre de production ${run.runCode} est annulé.`, { runId });
    }

    const balance = await materialBalance(client, runId);
    if (balance.inputKg === '0.000') {
      throw conflictError(
        "Impossible de terminer l'ordre de production : aucune matière première consommée.",
        { runId },
      );
    }

    const justification = await client.query<{ difference_justification: string | null }>(
      'SELECT difference_justification FROM production_runs WHERE id = $1',
      [runId],
    );
    const alreadyJustified = justification.rows[0]?.difference_justification !== null;

    if (requiresDifferenceJustification(balance.balanceStatus) && !alreadyJustified) {
      throw conflictError(
        `Écart matière à justifier : ${balance.differenceKg} kg (${balance.differencePercent ?? '-'} %). Justifiez l'écart avant de terminer l'ordre de production.`,
        {
          runId,
          differenceKg: balance.differenceKg,
          differencePercent: balance.differencePercent,
        },
      );
    }

    await client.query(
      `UPDATE production_runs
          SET status = 'TERMINE',
              started_at = COALESCE(started_at, now()),
              ended_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [runId],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'PRODUCTION_RUN_CLOTURE',
      entityType: 'production_runs',
      entityId: runId,
      oldValues: { status: run.status },
      newValues: { status: 'TERMINE' },
      context: {
        runCode: run.runCode,
        inputKg: balance.inputKg,
        usefulKg: balance.usefulKg,
        differenceKg: balance.differenceKg,
        yieldPercent: balance.yieldPercent,
      },
    });

    return { status: 'TERMINE', balance };
  });
}

/**
 * Cancels a run. Validated stock movements are never erased: every consumption
 * still standing is reversed, so the raw material returns to its location.
 */
export async function cancelRun(
  pool: pg.Pool,
  runId: string,
  reason: string,
  actorId: string,
): Promise<{ reversedConsumptions: number }> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, runId);
    if (run.status === 'ANNULE') {
      throw conflictError(`L'ordre de production ${run.runCode} est déjà annulé.`, { runId });
    }

    const consumptions = await client.query<{ id: string; stock_movement_id: string }>(
      `SELECT id, stock_movement_id FROM production_run_materials
        WHERE production_run_id = $1 AND status = 'VALIDE'`,
      [runId],
    );

    for (const consumption of consumptions.rows) {
      const reversal = await reverseStockMovement(
        client,
        consumption.stock_movement_id,
        `Annulation de l'ordre de production ${run.runCode} : ${reason}`,
        actorId,
      );
      await client.query(
        `UPDATE production_run_materials
            SET status = 'ANNULE', cancelled_at = now(), cancelled_by = $2,
                cancellation_reason = $3, reversal_stock_movement_id = $4
          WHERE id = $1`,
        [consumption.id, actorId, reason, reversal.id],
      );
    }

    await client.query(
      `UPDATE production_outputs
          SET status = 'ANNULE', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3
        WHERE production_run_id = $1 AND status = 'VALIDE'`,
      [runId, actorId, reason],
    );

    await client.query(
      `UPDATE production_runs
          SET status = 'ANNULE', cancellation_reason = $2, updated_at = now()
        WHERE id = $1`,
      [runId, reason],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'PRODUCTION_RUN_ANNULATION',
      entityType: 'production_runs',
      entityId: runId,
      oldValues: { status: run.status },
      newValues: { status: 'ANNULE', reason },
      context: { runCode: run.runCode, reversedConsumptions: consumptions.rows.length },
    });

    return { reversedConsumptions: consumptions.rows.length };
  });
}
