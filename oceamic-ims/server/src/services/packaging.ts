import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { requireRun } from './production.ts';
import { inheritUpstreamHold } from './finishedGoodsQuality.ts';

// Packaging batch: the packaging process event (section 62), never merged
// with the Finished Goods Lot identity it produces.

export type PackagingBatch = Readonly<{
  id: string;
  batchCode: string;
  productionRunId: string;
  productId: string;
  format: string | null;
  status: string;
}>;

async function requirePackagingBatch(
  client: DatabaseClient,
  id: string,
): Promise<PackagingBatch> {
  const result = await client.query<{
    id: string;
    batch_code: string;
    production_run_id: string;
    product_id: string;
    format: string | null;
    status: string;
  }>(
    `SELECT id, batch_code, production_run_id, product_id, format, status
       FROM packaging_batches WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Lot d\'emballage', id);
  }
  return {
    id: row.id,
    batchCode: row.batch_code,
    productionRunId: row.production_run_id,
    productId: row.product_id,
    format: row.format,
    status: row.status,
  };
}

function assertBatchOpen(batch: PackagingBatch): void {
  if (batch.status !== 'PLANIFIE' && batch.status !== 'EN_COURS') {
    throw conflictError(
      `Le lot d'emballage ${batch.batchCode} n'accepte plus de saisie (statut : ${batch.status}).`,
      { packagingBatchId: batch.id, status: batch.status },
    );
  }
}

export type CreatePackagingBatchInput = Readonly<{
  productionRunId: string;
  sterilizationCycleId: string | null;
  format: string | null;
  responsibleUserId: string | null;
  notes: string | null;
}>;

export async function createPackagingBatch(
  pool: pg.Pool,
  input: CreatePackagingBatchInput,
  actorId: string,
): Promise<PackagingBatch> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, input.productionRunId);
    const batchCode = await nextOperationalCode(client, 'EMB', new Date());
    const inserted = await client.query<{ id: string; status: string }>(
      `INSERT INTO packaging_batches (batch_code, production_run_id, sterilization_cycle_id,
                                      product_id, format, status, responsible_user_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, 'EN_COURS', $6, $7, $8)
       RETURNING id, status`,
      [
        batchCode,
        run.id,
        input.sterilizationCycleId,
        run.productId,
        input.format,
        input.responsibleUserId,
        input.notes,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Le lot d'emballage n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'PACKAGING_BATCH_CREATION',
      entityType: 'packaging_batches',
      entityId: row.id,
      oldValues: null,
      newValues: { batchCode, runCode: run.runCode },
      context: null,
    });
    return {
      id: row.id,
      batchCode,
      productionRunId: run.id,
      productId: run.productId,
      format: input.format,
      status: row.status,
    };
  });
}

export async function closePackagingBatch(
  pool: pg.Pool,
  id: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const batch = await requirePackagingBatch(client, id);
    assertBatchOpen(batch);
    await client.query(
      "UPDATE packaging_batches SET status = 'TERMINE', ended_at = now(), updated_at = now() WHERE id = $1",
      [batch.id],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'PACKAGING_BATCH_CLOTURE',
      entityType: 'packaging_batches',
      entityId: batch.id,
      oldValues: { status: batch.status },
      newValues: { status: 'TERMINE' },
      context: null,
    });
  });
}

export async function cancelPackagingBatch(
  pool: pg.Pool,
  id: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const batch = await requirePackagingBatch(client, id);
    assertBatchOpen(batch);
    await client.query(
      "UPDATE packaging_batches SET status = 'ANNULE', ended_at = now(), notes = COALESCE(notes || ' — ', '') || $2, updated_at = now() WHERE id = $1",
      [batch.id, `Annulé : ${reason}`],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'PACKAGING_BATCH_ANNULATION',
      entityType: 'packaging_batches',
      entityId: batch.id,
      oldValues: { status: batch.status },
      newValues: { status: 'ANNULE', reason },
      context: null,
    });
  });
}

export type FinishedGoodLotSourceInput = Readonly<{
  sterilizationCycleId: string;
  productionRunId: string;
  quantityUnits: number | null;
}>;

export type CreateFinishedGoodLotInput = Readonly<{
  packagingBatchId: string;
  format: string | null;
  piecesPerCan: number | null;
  productionDate: string;
  bestBeforeDate: string | null;
  notes: string | null;
  sources: readonly FinishedGoodLotSourceInput[];
}>;

/**
 * Creates a Finished Goods Lot (section 5). quality_status is never
 * automatically LIBERE (section 19): it starts A_VERIFIER, unless the
 * sourcing Run(s) carry an unresolved upstream hold, in which case it starts
 * BLOQUE outright (section 19's inheritance requirement).
 */
export async function createFinishedGoodLot(
  pool: pg.Pool,
  input: CreateFinishedGoodLotInput,
  actorId: string,
): Promise<Readonly<{ id: string; lotCode: string; qualityStatus: string }>> {
  return withTransaction(pool, async (client) => {
    if (input.sources.length === 0) {
      throw validationError('Un Lot PF doit être rattaché à au moins un cycle de stérilisation.', {});
    }
    const batch = await requirePackagingBatch(client, input.packagingBatchId);

    const lotCode = await nextOperationalCode(client, 'PF', new Date());
    const inserted = await client.query<{ id: string; quality_status: string }>(
      `INSERT INTO finished_good_lots (lot_code, packaging_batch_id, production_run_id, product_id,
                                       format, pieces_per_can, production_date, best_before_date, notes,
                                       created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, quality_status`,
      [
        lotCode,
        batch.id,
        batch.productionRunId,
        batch.productId,
        input.format ?? batch.format,
        input.piecesPerCan,
        input.productionDate,
        input.bestBeforeDate,
        input.notes,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Le Lot PF n'a pas pu être créé.");
    }

    for (const source of input.sources) {
      await client.query(
        `INSERT INTO finished_good_lot_sources (finished_good_lot_id, sterilization_cycle_id,
                                                 production_run_id, quantity_units)
         VALUES ($1, $2, $3, $4)`,
        [row.id, source.sterilizationCycleId, source.productionRunId, source.quantityUnits],
      );
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'FINISHED_GOOD_LOT_CREATION',
      entityType: 'finished_good_lots',
      entityId: row.id,
      oldValues: null,
      newValues: { lotCode, packagingBatchId: batch.id, sourceCount: input.sources.length },
      context: null,
    });

    const qualityStatus = await inheritUpstreamHold(client, row.id, actorId);

    return { id: row.id, lotCode, qualityStatus: qualityStatus ?? row.quality_status };
  });
}

export type RecordPackagingOutputInput = Readonly<{
  finishedGoodLotId: string;
  quantityCans: number;
  quantityCartons: number;
  unitsPerCarton: number;
  occurredAt: Date;
  notes: string | null;
}>;

export async function recordPackagingOutput(
  pool: pg.Pool,
  packagingBatchId: string,
  input: RecordPackagingOutputInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const batch = await requirePackagingBatch(client, packagingBatchId);
    assertBatchOpen(batch);

    const lot = await client.query('SELECT id FROM finished_good_lots WHERE id = $1', [
      input.finishedGoodLotId,
    ]);
    if (lot.rows.length === 0) {
      throw notFoundError('Lot PF', input.finishedGoodLotId);
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO packaging_outputs (packaging_batch_id, finished_good_lot_id, quantity_cans,
                                      quantity_cartons, units_per_carton, occurred_at, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        batch.id,
        input.finishedGoodLotId,
        input.quantityCans,
        input.quantityCartons,
        input.unitsPerCarton,
        input.occurredAt,
        input.notes,
        actorId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La sortie d'emballage n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'PACKAGING_OUTPUT_CREATION',
      entityType: 'packaging_outputs',
      entityId: id,
      oldValues: null,
      newValues: {
        packagingBatchId,
        finishedGoodLotId: input.finishedGoodLotId,
        quantityCans: input.quantityCans,
        quantityCartons: input.quantityCartons,
      },
      context: null,
    });
    return { id };
  });
}

export type RecordLabelCheckInput = Readonly<{
  finishedGoodLotId: string;
  productCorrect: boolean;
  lotCorrect: boolean;
  dateCorrect: boolean;
  labelCorrect: boolean;
  notes: string | null;
}>;

export async function recordLabelCheck(
  pool: pg.Pool,
  packagingBatchId: string,
  input: RecordLabelCheckInput,
  actorId: string,
): Promise<Readonly<{ id: string; result: string }>> {
  return withTransaction(pool, async (client) => {
    const batch = await requirePackagingBatch(client, packagingBatchId);
    const inserted = await client.query<{ id: string; result: string }>(
      `INSERT INTO packaging_label_checks (packaging_batch_id, finished_good_lot_id, product_correct,
                                           lot_correct, date_correct, label_correct, checked_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, result`,
      [
        batch.id,
        input.finishedGoodLotId,
        input.productCorrect,
        input.lotCorrect,
        input.dateCorrect,
        input.labelCorrect,
        actorId,
        input.notes,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Le contrôle d'étiquette n'a pas pu être enregistré.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'PACKAGING_LABEL_CHECK_CREATION',
      entityType: 'packaging_label_checks',
      entityId: row.id,
      oldValues: null,
      newValues: { finishedGoodLotId: input.finishedGoodLotId, result: row.result },
      context: null,
    });
    return { id: row.id, result: row.result };
  });
}

export { requirePackagingBatch };
