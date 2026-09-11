import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { transitionWorkOrderStatusWithClient, requireWorkOrder } from './workOrders.ts';

// INTERVENTION is the actual execution of a work order (section 66) - a
// work order may carry several. duration_seconds is a generated column
// (mirroring downtime_events, 028_maintenance_work_orders.sql), never typed
// by hand.

export type Intervention = Readonly<{
  id: string;
  workOrderId: string;
  technicianUserId: string;
  startedAt: Date;
  endedAt: Date | null;
  actionPerformed: string | null;
}>;

export async function requireIntervention(client: DatabaseClient, id: string): Promise<Intervention> {
  const result = await client.query<{
    id: string;
    work_order_id: string;
    technician_user_id: string;
    started_at: Date;
    ended_at: Date | null;
    action_performed: string | null;
  }>(
    `SELECT id, work_order_id, technician_user_id, started_at, ended_at, action_performed
       FROM maintenance_interventions WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Intervention', id);
  }
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    technicianUserId: row.technician_user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    actionPerformed: row.action_performed,
  };
}

/**
 * Starting work on a job starts the job (section 46's rapid flow): a
 * technician opening an intervention on an OUVERT/PLANIFIE work order
 * transitions it to EN_COURS in the same transaction, rather than requiring
 * a separate administrative status change first.
 */
export async function startIntervention(
  pool: pg.Pool,
  workOrderId: string,
  startedAt: Date,
  actorId: string,
): Promise<Intervention> {
  return withTransaction(pool, async (client) => {
    const workOrder = await requireWorkOrder(client, workOrderId);
    if (workOrder.status === 'OUVERT' || workOrder.status === 'PLANIFIE') {
      await transitionWorkOrderStatusWithClient(client, workOrderId, 'EN_COURS', actorId);
    } else if (workOrder.status !== 'EN_COURS' && workOrder.status !== 'EN_ATTENTE_PIECE') {
      throw conflictError(
        `L'ordre de travail ${workOrder.workOrderCode} n'accepte plus de nouvelle intervention (statut ${workOrder.status}).`,
        { workOrderId },
      );
    }

    const inserted = await client.query<{ id: string; started_at: Date }>(
      `INSERT INTO maintenance_interventions (work_order_id, technician_user_id, started_at)
       VALUES ($1, $2, $3) RETURNING id, started_at`,
      [workOrderId, actorId, startedAt],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'intervention n'a pas pu être démarrée.");
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'INTERVENTION_DEMARRAGE',
      entityType: 'maintenance_interventions',
      entityId: row.id,
      oldValues: null,
      newValues: { workOrderId, startedAt },
      context: null,
    });

    return {
      id: row.id,
      workOrderId,
      technicianUserId: actorId,
      startedAt: row.started_at,
      endedAt: null,
      actionPerformed: null,
    };
  });
}

export type UpdateInterventionInput = Readonly<{
  diagnostic: string | null;
  actionPerformed: string | null;
  failureModeId: string | null;
  failureCauseId: string | null;
}>;

/** Diagnostic / action réalisée / cause - captured progressively while the
 * intervention is still open (section 46), never after it has ended. */
export async function updateIntervention(
  pool: pg.Pool,
  id: string,
  input: UpdateInterventionInput,
  actorId: string,
): Promise<Intervention> {
  return withTransaction(pool, async (client) => {
    const intervention = await requireIntervention(client, id);
    if (intervention.endedAt !== null) {
      throw conflictError('Cette intervention est déjà terminée, elle ne peut plus être modifiée.', { id });
    }
    await client.query(
      `UPDATE maintenance_interventions
          SET diagnostic = COALESCE($2, diagnostic),
              action_performed = COALESCE($3, action_performed),
              failure_mode_id = COALESCE($4, failure_mode_id),
              failure_cause_id = COALESCE($5, failure_cause_id),
              updated_at = now()
        WHERE id = $1`,
      [id, input.diagnostic, input.actionPerformed, input.failureModeId, input.failureCauseId],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'INTERVENTION_MISE_A_JOUR',
      entityType: 'maintenance_interventions',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    const updated = await requireIntervention(client, id);
    return updated;
  });
}

/**
 * Ends an open intervention - requires action_performed to already be
 * documented (either from an earlier updateIntervention call or passed
 * here), the same "no work order closes without a documented action"
 * discipline applied at the intervention level (section 45/46).
 */
export async function endIntervention(
  pool: pg.Pool,
  id: string,
  endedAt: Date,
  actionPerformed: string | null,
  actorId: string,
): Promise<Intervention> {
  return withTransaction(pool, async (client) => {
    const intervention = await requireIntervention(client, id);
    if (intervention.endedAt !== null) {
      throw conflictError('Cette intervention est déjà terminée.', { id });
    }
    if (endedAt < intervention.startedAt) {
      throw validationError("L'heure de fin ne peut pas précéder l'heure de début.", {
        id,
        startedAt: intervention.startedAt,
        endedAt,
      });
    }
    const finalAction = actionPerformed ?? intervention.actionPerformed;
    if (finalAction === null || finalAction.trim() === '') {
      throw validationError("L'action réalisée doit être documentée avant de terminer l'intervention.", { id });
    }
    await client.query(
      `UPDATE maintenance_interventions
          SET ended_at = $2, action_performed = $3, updated_at = now()
        WHERE id = $1`,
      [id, endedAt, finalAction],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'INTERVENTION_CLOTURE',
      entityType: 'maintenance_interventions',
      entityId: id,
      oldValues: { endedAt: null },
      newValues: { endedAt },
      context: null,
    });
    return await requireIntervention(client, id);
  });
}

export type InterventionListRow = Readonly<{
  id: string;
  workOrderId: string;
  technicianName: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  diagnostic: string | null;
  actionPerformed: string | null;
  failureModeCode: string | null;
  failureCauseCode: string | null;
}>;

export async function listInterventionsForWorkOrder(
  pool: pg.Pool,
  workOrderId: string,
): Promise<readonly InterventionListRow[]> {
  const result = await pool.query<InterventionListRow>(
    `SELECT mi.id AS "id", mi.work_order_id AS "workOrderId", u.full_name AS "technicianName",
            mi.started_at AS "startedAt", mi.ended_at AS "endedAt",
            mi.duration_seconds AS "durationSeconds", mi.diagnostic AS "diagnostic",
            mi.action_performed AS "actionPerformed", fm.code AS "failureModeCode",
            fc.code AS "failureCauseCode"
       FROM maintenance_interventions mi
       JOIN users u ON u.id = mi.technician_user_id
       LEFT JOIN failure_modes fm ON fm.id = mi.failure_mode_id
       LEFT JOIN failure_causes fc ON fc.id = mi.failure_cause_id
      WHERE mi.work_order_id = $1
      ORDER BY mi.started_at DESC`,
    [workOrderId],
  );
  return result.rows;
}
