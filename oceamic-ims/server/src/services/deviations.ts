import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';

// Process deviation: a documented departure from expected process
// (section 37), with lightweight corrective actions (section 38). Full CAPA
// is explicitly out of scope for Phase 4.

export type CreateDeviationInput = Readonly<{
  productionRunId: string | null;
  sterilizationCycleId: string | null;
  processStage: string;
  detectedAt: Date;
  deviationType: string;
  description: string;
  severity: string;
}>;

export async function createDeviation(
  pool: pg.Pool,
  input: CreateDeviationInput,
  actorId: string,
): Promise<Readonly<{ id: string; deviationCode: string }>> {
  return withTransaction(pool, async (client) => {
    if (input.productionRunId === null && input.sterilizationCycleId === null) {
      throw validationError('Une déviation doit être rattachée à un Run ou à un cycle de stérilisation.', {});
    }
    const deviationCode = await nextOperationalCode(client, 'DEV', input.detectedAt);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO process_deviations (deviation_code, production_run_id, sterilization_cycle_id,
                                       process_stage, detected_at, deviation_type, description,
                                       severity, detected_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        deviationCode,
        input.productionRunId,
        input.sterilizationCycleId,
        input.processStage,
        input.detectedAt,
        input.deviationType,
        input.description,
        input.severity,
        actorId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La déviation n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'DEVIATION_CREATION',
      entityType: 'process_deviations',
      entityId: id,
      oldValues: null,
      newValues: { deviationCode, severity: input.severity, deviationType: input.deviationType },
      context: null,
    });
    return { id, deviationCode };
  });
}

async function requireDeviation(
  client: DatabaseClient,
  id: string,
): Promise<Readonly<{ id: string; deviationCode: string; status: string }>> {
  const result = await client.query<{ id: string; deviation_code: string; status: string }>(
    'SELECT id, deviation_code, status FROM process_deviations WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Déviation', id);
  }
  return { id: row.id, deviationCode: row.deviation_code, status: row.status };
}

export async function updateDeviationStatus(
  pool: pg.Pool,
  deviationId: string,
  status: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const deviation = await requireDeviation(client, deviationId);
    if (deviation.status === 'CLOTUREE' || deviation.status === 'ANNULEE') {
      throw conflictError(`La déviation ${deviation.deviationCode} est déjà clôturée ou annulée.`, {
        deviationId,
        status: deviation.status,
      });
    }
    await client.query('UPDATE process_deviations SET status = $2, updated_at = now() WHERE id = $1', [
      deviationId,
      status,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'DEVIATION_CHANGEMENT_STATUT',
      entityType: 'process_deviations',
      entityId: deviationId,
      oldValues: { status: deviation.status },
      newValues: { status },
      context: null,
    });
  });
}

export type CreateCorrectiveActionInput = Readonly<{
  actionDescription: string;
  responsibleUserId: string | null;
  dueAt: Date | null;
}>;

export async function createCorrectiveAction(
  pool: pg.Pool,
  deviationId: string,
  input: CreateCorrectiveActionInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const deviation = await requireDeviation(client, deviationId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO process_corrective_actions (process_deviation_id, action_description,
                                               responsible_user_id, due_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [deviation.id, input.actionDescription, input.responsibleUserId, input.dueAt],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'action corrective n'a pas pu être enregistrée.");
    }
    // A deviation with an action underway is being worked, not merely open.
    await client.query(
      "UPDATE process_deviations SET status = 'ACTION_REQUISE', updated_at = now() WHERE id = $1 AND status IN ('OUVERTE', 'EN_ANALYSE')",
      [deviation.id],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'CORRECTIVE_ACTION_CREATION',
      entityType: 'process_corrective_actions',
      entityId: id,
      oldValues: null,
      newValues: { processDeviationId: deviation.id, actionDescription: input.actionDescription },
      context: null,
    });
    return { id };
  });
}

export type CompleteCorrectiveActionInput = Readonly<{ verificationNotes: string | null }>;

export async function completeCorrectiveAction(
  pool: pg.Pool,
  actionId: string,
  input: CompleteCorrectiveActionInput,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const updated = await client.query<{ id: string; process_deviation_id: string; status: string }>(
      `UPDATE process_corrective_actions
          SET status = 'TERMINEE', completed_at = now(), verification_notes = $2, updated_at = now()
        WHERE id = $1 AND status <> 'TERMINEE'
        RETURNING id, process_deviation_id, status`,
      [actionId, input.verificationNotes],
    );
    const row = updated.rows[0];
    if (!row) {
      throw notFoundError('Action corrective', actionId);
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'CORRECTIVE_ACTION_CLOTURE',
      entityType: 'process_corrective_actions',
      entityId: row.id,
      oldValues: { status: 'EN_COURS' },
      newValues: { status: 'TERMINEE' },
      context: { processDeviationId: row.process_deviation_id },
    });
  });
}
