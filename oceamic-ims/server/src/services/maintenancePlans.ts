import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { PREVENTIVE_FREQUENCY_INTERVAL_DAYS, type PreventiveFrequencyType, type PreventiveTaskStatus } from '../domain/types.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { requireEquipment } from './masterdata.ts';

// PREVENTIVE PLAN is the recurring requirement, PREVENTIVE TASK is one
// scheduled occurrence of it (section 66) - never collapsed into one table.

export type MaintenancePlan = Readonly<{
  id: string;
  planCode: string;
  equipmentId: string;
  frequencyType: PreventiveFrequencyType;
  frequencyIntervalDays: number | null;
}>;

async function requireMaintenancePlan(client: DatabaseClient, id: string): Promise<MaintenancePlan> {
  const result = await client.query<{
    id: string;
    plan_code: string;
    equipment_id: string;
    frequency_type: PreventiveFrequencyType;
    frequency_interval_days: number | null;
  }>(
    `SELECT id, plan_code, equipment_id, frequency_type, frequency_interval_days
       FROM maintenance_plans WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Plan de maintenance préventive', id);
  }
  return {
    id: row.id,
    planCode: row.plan_code,
    equipmentId: row.equipment_id,
    frequencyType: row.frequency_type,
    frequencyIntervalDays: row.frequency_interval_days,
  };
}

export type CreateMaintenancePlanInput = Readonly<{
  equipmentId: string;
  name: string;
  frequencyType: PreventiveFrequencyType;
  checklistLabels: readonly string[];
  firstDueAt: Date;
}>;

export async function createMaintenancePlan(
  pool: pg.Pool,
  input: CreateMaintenancePlanInput,
  actorId: string,
): Promise<MaintenancePlan> {
  return withTransaction(pool, async (client) => {
    const equipment = await requireEquipment(client, input.equipmentId);
    // Calendar-based frequencies get an automatic interval; OPERATING_HOURS
    // and CUSTOM stay NULL - Phase 7 has no operating-hours meter
    // integration, so those plans are scheduled manually rather than have
    // the system fake a next-due date (section 28).
    const frequencyIntervalDays = PREVENTIVE_FREQUENCY_INTERVAL_DAYS[input.frequencyType] ?? null;

    const planCode = await nextOperationalCode(client, 'MP', new Date());
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO maintenance_plans (plan_code, equipment_id, name, frequency_type,
                                      frequency_interval_days, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [planCode, input.equipmentId, input.name, input.frequencyType, frequencyIntervalDays, actorId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le plan de maintenance préventive n'a pas pu être créé.");
    }

    for (const [index, label] of input.checklistLabels.entries()) {
      await client.query(
        `INSERT INTO maintenance_plan_checklist_items (maintenance_plan_id, display_order, label)
         VALUES ($1, $2, $3)`,
        [id, index + 1, label],
      );
    }

    await client.query(
      `INSERT INTO preventive_tasks (maintenance_plan_id, due_at) VALUES ($1, $2)`,
      [id, input.firstDueAt],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'MAINTENANCE_PLAN_CREATION',
      entityType: 'maintenance_plans',
      entityId: id,
      oldValues: null,
      newValues: {
        planCode,
        equipmentCode: equipment.code,
        frequencyType: input.frequencyType,
        firstDueAt: input.firstDueAt,
      },
      context: null,
    });

    return { id, planCode, equipmentId: input.equipmentId, frequencyType: input.frequencyType, frequencyIntervalDays };
  });
}

export type PreventiveTask = Readonly<{
  id: string;
  maintenancePlanId: string;
  dueAt: Date;
  status: PreventiveTaskStatus;
}>;

async function requirePreventiveTask(client: DatabaseClient, id: string): Promise<PreventiveTask> {
  const result = await client.query<{
    id: string;
    maintenance_plan_id: string;
    due_at: Date;
    status: PreventiveTaskStatus;
  }>('SELECT id, maintenance_plan_id, due_at, status FROM preventive_tasks WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Tâche préventive', id);
  }
  return { id: row.id, maintenancePlanId: row.maintenance_plan_id, dueAt: row.due_at, status: row.status };
}

export type CompletePreventiveTaskInput = Readonly<{
  completedAt: Date;
  notes: string | null;
  checklistResponses: readonly Readonly<{ checklistItemId: string; completed: boolean; comment: string | null }>[];
}>;

/**
 * Completing a task never leaves the plan without its next occurrence
 * (section 27): for calendar-based frequencies, a new PLANIFIEE task is
 * generated from this one's due date + the plan's fixed interval, so
 * "en retard" detection (preventive_task_status view) always has something
 * to compare against. OPERATING_HOURS/CUSTOM plans generate nothing
 * automatically - their next occurrence is scheduled by hand.
 */
export async function completePreventiveTask(
  pool: pg.Pool,
  id: string,
  input: CompletePreventiveTaskInput,
  actorId: string,
): Promise<PreventiveTask> {
  return withTransaction(pool, async (client) => {
    const task = await requirePreventiveTask(client, id);
    if (task.status !== 'PLANIFIEE') {
      throw conflictError(`Cette tâche préventive n'est plus planifiée (statut ${task.status}).`, { id });
    }
    const plan = await requireMaintenancePlan(client, task.maintenancePlanId);

    await client.query(
      `UPDATE preventive_tasks
          SET status = 'TERMINEE', completed_at = $2, completed_by = $3, notes = COALESCE($4, notes),
              updated_at = now()
        WHERE id = $1`,
      [id, input.completedAt, actorId, input.notes],
    );

    for (const response of input.checklistResponses) {
      await client.query(
        `INSERT INTO preventive_task_checklist_responses
             (preventive_task_id, checklist_item_id, completed, comment, responded_by, responded_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (preventive_task_id, checklist_item_id)
         DO UPDATE SET completed = EXCLUDED.completed, comment = EXCLUDED.comment,
                       responded_by = EXCLUDED.responded_by, responded_at = EXCLUDED.responded_at`,
        [id, response.checklistItemId, response.completed, response.comment, actorId, input.completedAt],
      );
    }

    let nextTaskId: string | null = null;
    if (plan.frequencyIntervalDays !== null) {
      const nextDue = await client.query<{ id: string }>(
        `INSERT INTO preventive_tasks (maintenance_plan_id, due_at)
         VALUES ($1, $2::timestamptz + ($3 || ' days')::interval) RETURNING id`,
        [plan.id, task.dueAt, plan.frequencyIntervalDays],
      );
      nextTaskId = nextDue.rows[0]?.id ?? null;
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'PREVENTIVE_TASK_TERMINEE',
      entityType: 'preventive_tasks',
      entityId: id,
      oldValues: { status: 'PLANIFIEE' },
      newValues: { status: 'TERMINEE', completedAt: input.completedAt, nextTaskId },
      context: { maintenancePlanId: plan.id },
    });

    return { ...task, status: 'TERMINEE' };
  });
}

export async function cancelPreventiveTask(pool: pg.Pool, id: string, actorId: string): Promise<void> {
  return withTransaction(pool, async (client) => {
    const task = await requirePreventiveTask(client, id);
    if (task.status !== 'PLANIFIEE') {
      throw conflictError(`Cette tâche préventive n'est plus planifiée (statut ${task.status}).`, { id });
    }
    await client.query("UPDATE preventive_tasks SET status = 'ANNULEE', updated_at = now() WHERE id = $1", [id]);
    await recordAudit(client, {
      userId: actorId,
      action: 'PREVENTIVE_TASK_ANNULEE',
      entityType: 'preventive_tasks',
      entityId: id,
      oldValues: { status: 'PLANIFIEE' },
      newValues: { status: 'ANNULEE' },
      context: null,
    });
  });
}

export type MaintenancePlanRow = Readonly<{
  id: string;
  planCode: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  name: string;
  frequencyType: PreventiveFrequencyType;
  frequencyIntervalDays: number | null;
  isActive: boolean;
}>;

export async function listMaintenancePlans(pool: pg.Pool, equipmentId: string | null): Promise<readonly MaintenancePlanRow[]> {
  const result = await pool.query<MaintenancePlanRow>(
    `SELECT mp.id AS "id", mp.plan_code AS "planCode", mp.equipment_id AS "equipmentId",
            e.code AS "equipmentCode", e.name AS "equipmentName", mp.name AS "name",
            mp.frequency_type AS "frequencyType", mp.frequency_interval_days AS "frequencyIntervalDays",
            mp.is_active AS "isActive"
       FROM maintenance_plans mp
       JOIN equipment e ON e.id = mp.equipment_id
      WHERE ($1::uuid IS NULL OR mp.equipment_id = $1)
      ORDER BY e.code, mp.name`,
    [equipmentId],
  );
  return result.rows;
}

export type ChecklistItemRow = Readonly<{ id: string; displayOrder: number; label: string }>;

export type MaintenancePlanDetail = MaintenancePlanRow & Readonly<{ checklistItems: readonly ChecklistItemRow[] }>;

export async function getMaintenancePlanDetail(pool: pg.Pool, id: string): Promise<MaintenancePlanDetail> {
  const plans = await listMaintenancePlans(pool, null);
  const plan = plans.find((p) => p.id === id);
  if (!plan) {
    throw notFoundError('Plan de maintenance préventive', id);
  }
  const items = await pool.query<ChecklistItemRow>(
    `SELECT id AS "id", display_order AS "displayOrder", label AS "label"
       FROM maintenance_plan_checklist_items
      WHERE maintenance_plan_id = $1 AND is_active
      ORDER BY display_order`,
    [id],
  );
  return { ...plan, checklistItems: items.rows };
}

export type PreventiveTaskRow = Readonly<{
  id: string;
  maintenancePlanId: string;
  planName: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  dueAt: Date;
  status: PreventiveTaskStatus;
  isOverdue: boolean;
  completedAt: Date | null;
  technicianUserId: string | null;
}>;

export type PreventiveTaskFilters = Readonly<{
  equipmentId: string | null;
  status: PreventiveTaskStatus | null;
  dueBefore: Date | null;
  overdueOnly: boolean;
  limit: number;
}>;

export async function listPreventiveTasks(
  pool: pg.Pool,
  filters: PreventiveTaskFilters,
): Promise<readonly PreventiveTaskRow[]> {
  const result = await pool.query<PreventiveTaskRow>(
    `SELECT pt.id AS "id", pt.maintenance_plan_id AS "maintenancePlanId", mp.name AS "planName",
            mp.equipment_id AS "equipmentId", e.code AS "equipmentCode", e.name AS "equipmentName",
            pt.due_at AS "dueAt", pt.status AS "status", s.is_overdue AS "isOverdue",
            pt.completed_at AS "completedAt", pt.technician_user_id AS "technicianUserId"
       FROM preventive_tasks pt
       JOIN maintenance_plans mp ON mp.id = pt.maintenance_plan_id
       JOIN equipment e ON e.id = mp.equipment_id
       JOIN preventive_task_status s ON s.preventive_task_id = pt.id
      WHERE ($1::uuid IS NULL OR mp.equipment_id = $1)
        AND ($2::text IS NULL OR pt.status = $2)
        AND ($3::timestamptz IS NULL OR pt.due_at <= $3)
        AND ($4::boolean IS FALSE OR s.is_overdue IS TRUE)
      ORDER BY pt.due_at ASC
      LIMIT $5`,
    [filters.equipmentId, filters.status, filters.dueBefore, filters.overdueOnly, filters.limit],
  );
  return result.rows;
}

export async function listChecklistResponses(
  pool: pg.Pool,
  preventiveTaskId: string,
): Promise<readonly Readonly<{ checklistItemId: string; label: string; completed: boolean; comment: string | null }>[]> {
  const result = await pool.query<{ checklistItemId: string; label: string; completed: boolean; comment: string | null }>(
    `SELECT i.id AS "checklistItemId", i.label AS "label",
            COALESCE(r.completed, FALSE) AS "completed", r.comment AS "comment"
       FROM maintenance_plan_checklist_items i
       JOIN preventive_tasks t ON t.maintenance_plan_id = i.maintenance_plan_id
       LEFT JOIN preventive_task_checklist_responses r
              ON r.checklist_item_id = i.id AND r.preventive_task_id = t.id
      WHERE t.id = $1 AND i.is_active
      ORDER BY i.display_order`,
    [preventiveTaskId],
  );
  return result.rows;
}
