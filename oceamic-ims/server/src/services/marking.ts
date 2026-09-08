import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { requireRun } from './production.ts';

// Marking event: traceable coding before sterilization (section 25).

export type CreateMarkingEventInput = Readonly<{
  productionRunId: string;
  seamingOperationId: string | null;
  markedAt: Date;
  markingCode: string;
  lotCodePrinted: string | null;
  machineId: string | null;
  notes: string | null;
}>;

export async function createMarkingEvent(
  pool: pg.Pool,
  input: CreateMarkingEventInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, input.productionRunId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO marking_events (production_run_id, seaming_operation_id, marked_at, marking_code,
                                   lot_code_printed, machine_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        run.id,
        input.seamingOperationId,
        input.markedAt,
        input.markingCode,
        input.lotCodePrinted,
        input.machineId,
        input.notes,
        actorId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le marquage n'a pas pu être enregistré.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MARKING_EVENT_CREATION',
      entityType: 'marking_events',
      entityId: id,
      oldValues: null,
      newValues: { runCode: run.runCode, markingCode: input.markingCode },
      context: null,
    });
    return { id };
  });
}

export type VerifyMarkingEventInput = Readonly<{
  checks: readonly Readonly<{ itemId: string; passed: boolean; notes: string | null }>[];
}>;

/**
 * Records the operational verification (section 26): a configurable set of
 * check items, each pass/fail, plus the overall status - VERIFIE only when
 * every recorded check passed, NON_CONFORME as soon as one failed.
 */
export async function verifyMarkingEvent(
  pool: pg.Pool,
  markingEventId: string,
  input: VerifyMarkingEventInput,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const event = await requireMarkingEvent(client, markingEventId);
    if (event.status !== 'A_VERIFIER') {
      throw conflictError('Ce marquage a déjà été vérifié.', { markingEventId });
    }
    if (input.checks.length === 0) {
      throw validationError('Au moins un point de vérification est requis.', { markingEventId });
    }

    for (const check of input.checks) {
      await client.query(
        `INSERT INTO marking_event_checks (marking_event_id, marking_verification_item_id, passed, notes)
         VALUES ($1, $2, $3, $4)`,
        [markingEventId, check.itemId, check.passed, check.notes],
      );
    }

    const overallStatus = input.checks.every((check) => check.passed) ? 'VERIFIE' : 'NON_CONFORME';
    await client.query(
      `UPDATE marking_events
          SET status = $2, verified_by = $3, verified_at = now()
        WHERE id = $1`,
      [markingEventId, overallStatus, actorId],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'MARKING_EVENT_VERIFICATION',
      entityType: 'marking_events',
      entityId: markingEventId,
      oldValues: { status: 'A_VERIFIER' },
      newValues: { status: overallStatus },
      context: { checkCount: input.checks.length },
    });
  });
}

async function requireMarkingEvent(
  client: DatabaseClient,
  id: string,
): Promise<Readonly<{ id: string; status: string }>> {
  const result = await client.query<{ id: string; status: string }>(
    'SELECT id, status FROM marking_events WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Marquage', id);
  }
  return row;
}
