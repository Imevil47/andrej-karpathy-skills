import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import {
  WORK_ORDER_ALLOWED_TRANSITIONS,
  workOrderClosureRequiresApproval,
  type EquipmentCriticality,
  type WorkOrderPriority,
  type WorkOrderStatus,
  type WorkOrderType,
  type WorkOrderVerificationResult,
} from '../domain/types.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { requireEquipment, setEquipmentStatus } from './masterdata.ts';
import { markFailureTakenInChargeWithClient, requireFailureReport, resolveFailureWithClient } from './failures.ts';

// WORK ORDER is the authorized maintenance job (section 66) - a failure
// report is the observed event it may be raised against, an intervention is
// the actual execution recorded against it. A work order may carry several
// interventions, never forced into a 1:1 relationship (section 34).

export type WorkOrder = Readonly<{
  id: string;
  workOrderCode: string;
  equipmentId: string;
  workOrderType: WorkOrderType;
  status: WorkOrderStatus;
  failureReportId: string | null;
}>;

export async function requireWorkOrder(client: DatabaseClient, id: string): Promise<WorkOrder> {
  const result = await client.query<{
    id: string;
    work_order_code: string;
    equipment_id: string;
    work_order_type: WorkOrderType;
    status: WorkOrderStatus;
    failure_report_id: string | null;
  }>(
    `SELECT id, work_order_code, equipment_id, work_order_type, status, failure_report_id
       FROM maintenance_work_orders WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Ordre de travail', id);
  }
  return {
    id: row.id,
    workOrderCode: row.work_order_code,
    equipmentId: row.equipment_id,
    workOrderType: row.work_order_type,
    status: row.status,
    failureReportId: row.failure_report_id,
  };
}

export type CreateWorkOrderInput = Readonly<{
  equipmentId: string;
  failureReportId: string | null;
  workOrderType: WorkOrderType;
  priority: WorkOrderPriority;
  title: string;
  description: string | null;
  assignedTo: string | null;
  dueAt: Date | null;
}>;

export async function createWorkOrder(
  pool: pg.Pool,
  input: CreateWorkOrderInput,
  actorId: string,
): Promise<WorkOrder> {
  return withTransaction(pool, async (client) => {
    const equipment = await requireEquipment(client, input.equipmentId);
    if (input.failureReportId !== null) {
      const failure = await requireFailureReport(client, input.failureReportId);
      if (failure.equipmentId !== input.equipmentId) {
        throw validationError("La panne référencée ne concerne pas cet équipement.", {
          failureReportId: input.failureReportId,
          equipmentId: input.equipmentId,
        });
      }
      await markFailureTakenInChargeWithClient(client, input.failureReportId, actorId);
    }

    const workOrderCode = await nextOperationalCode(client, 'OT', new Date());
    const inserted = await client.query<{ id: string; status: WorkOrderStatus }>(
      `INSERT INTO maintenance_work_orders (work_order_code, failure_report_id, equipment_id,
                                            work_order_type, priority, title, description,
                                            requested_by, assigned_to, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, status`,
      [
        workOrderCode,
        input.failureReportId,
        input.equipmentId,
        input.workOrderType,
        input.priority,
        input.title,
        input.description,
        actorId,
        input.assignedTo,
        input.dueAt,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'ordre de travail n'a pas pu être créé.");
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'WORKORDER_CREATION',
      entityType: 'maintenance_work_orders',
      entityId: row.id,
      oldValues: null,
      newValues: {
        workOrderCode,
        equipmentCode: equipment.code,
        workOrderType: input.workOrderType,
        priority: input.priority,
        failureReportId: input.failureReportId,
      },
      context: null,
    });

    return {
      id: row.id,
      workOrderCode,
      equipmentId: input.equipmentId,
      workOrderType: input.workOrderType,
      status: row.status,
      failureReportId: input.failureReportId,
    };
  });
}

function assertWorkOrderTransition(from: WorkOrderStatus, to: WorkOrderStatus): void {
  if (!WORK_ORDER_ALLOWED_TRANSITIONS[from].includes(to)) {
    throw conflictError(`Transition de statut d'ordre de travail invalide : ${from} -> ${to}.`, { from, to });
  }
}

const EQUIPMENT_STATUS_ON_ENTER: Readonly<Partial<Record<WorkOrderStatus, Parameters<typeof setEquipmentStatus>[2]>>> = {
  EN_COURS: 'EN_MAINTENANCE',
  EN_ATTENTE_PIECE: 'EN_ATTENTE_PIECE',
};

/**
 * Composable status transition, used directly by createIntervention (section
 * 46's rapid flow: starting an intervention starts its work order) and
 * exposed to routes through updateWorkOrderStatus below. TERMINE is
 * deliberately excluded here - completing a work order has its own closure
 * gate (completeWorkOrder) and cannot be reached through a plain status flip.
 */
export async function transitionWorkOrderStatusWithClient(
  client: DatabaseClient,
  id: string,
  newStatus: Exclude<WorkOrderStatus, 'TERMINE'>,
  actorId: string,
): Promise<WorkOrder> {
  const workOrder = await requireWorkOrder(client, id);
  if (workOrder.status === newStatus) {
    return workOrder;
  }
  assertWorkOrderTransition(workOrder.status, newStatus);
  await client.query('UPDATE maintenance_work_orders SET status = $2, updated_at = now() WHERE id = $1', [
    id,
    newStatus,
  ]);
  const equipmentStatus = EQUIPMENT_STATUS_ON_ENTER[newStatus];
  if (equipmentStatus) {
    await setEquipmentStatus(client, workOrder.equipmentId, equipmentStatus);
  }
  await recordAudit(client, {
    userId: actorId,
    action: 'WORKORDER_STATUS_CHANGE',
    entityType: 'maintenance_work_orders',
    entityId: id,
    oldValues: { status: workOrder.status },
    newValues: { status: newStatus },
    context: null,
  });
  return { ...workOrder, status: newStatus };
}

export async function updateWorkOrderStatus(
  pool: pg.Pool,
  id: string,
  newStatus: Exclude<WorkOrderStatus, 'TERMINE'>,
  actorId: string,
): Promise<WorkOrder> {
  return withTransaction(pool, (client) => transitionWorkOrderStatusWithClient(client, id, newStatus, actorId));
}

export type WorkOrderClosureContext = Readonly<{
  equipmentCriticality: EquipmentCriticality;
  workOrderType: WorkOrderType;
  requiresApproval: boolean;
}>;

/** Read by the route before deciding whether workorder:manage suffices or
 * workorder:approve is required (section 52's "close important work
 * orders") - the condition depends on equipment criticality, a runtime
 * fact services don't gate on directly in this codebase (routes hold the
 * session and call requirePermission). */
export async function getWorkOrderClosureContext(pool: pg.Pool, id: string): Promise<WorkOrderClosureContext> {
  const result = await pool.query<{ work_order_type: WorkOrderType; criticality: EquipmentCriticality }>(
    `SELECT wo.work_order_type, e.criticality
       FROM maintenance_work_orders wo
       JOIN equipment e ON e.id = wo.equipment_id
      WHERE wo.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Ordre de travail', id);
  }
  return {
    equipmentCriticality: row.criticality,
    workOrderType: row.work_order_type,
    requiresApproval: workOrderClosureRequiresApproval(row.criticality, row.work_order_type),
  };
}

export type CompleteWorkOrderInput = Readonly<{
  verificationResult: WorkOrderVerificationResult | null;
}>;

/**
 * Closure gate (section 15/45): an intervention must exist with a
 * documented action, and for HAUTE/CRITIQUE equipment (or an URGENCE work
 * order) a verification result is mandatory - a technician finishing the
 * repair is not the same fact as the equipment being released for
 * production. A NON_CONFORME verification still closes THIS job (the work
 * done is a fact) but does not return the equipment to service or resolve
 * the failure - that needs a follow-up work order.
 */
export async function completeWorkOrder(
  pool: pg.Pool,
  id: string,
  input: CompleteWorkOrderInput,
  actorId: string,
): Promise<WorkOrder> {
  return withTransaction(pool, async (client) => {
    const workOrder = await requireWorkOrder(client, id);
    assertWorkOrderTransition(workOrder.status, 'TERMINE');

    const interventions = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM maintenance_interventions
        WHERE work_order_id = $1 AND action_performed IS NOT NULL AND action_performed <> ''`,
      [id],
    );
    if (Number(interventions.rows[0]?.count ?? '0') === 0) {
      throw conflictError(
        "Au moins une intervention avec une action réalisée documentée est requise pour clôturer cet ordre de travail.",
        { workOrderId: id },
      );
    }

    const equipment = await requireEquipment(client, workOrder.equipmentId);
    const requiresApproval = workOrderClosureRequiresApproval(equipment.criticality, workOrder.workOrderType);
    if (requiresApproval && input.verificationResult === null) {
      throw validationError(
        "Un résultat de vérification (Conforme / Non conforme) est requis pour clôturer cet ordre de travail sur un équipement à criticité haute/critique ou une intervention urgente.",
        { workOrderId: id, equipmentCriticality: equipment.criticality },
      );
    }

    await client.query(
      `UPDATE maintenance_work_orders
          SET status = 'TERMINE', closed_at = now(), closed_by = $2,
              restored_at = now(), restored_by = $2, verification_result = $3,
              updated_at = now()
        WHERE id = $1`,
      [id, actorId, input.verificationResult],
    );

    const restoredToService = input.verificationResult !== 'NON_CONFORME';
    if (restoredToService) {
      await setEquipmentStatus(client, workOrder.equipmentId, 'EN_SERVICE');
      if (workOrder.failureReportId !== null) {
        const diagnosis = await client.query<{ failure_mode_id: string | null; failure_cause_id: string | null }>(
          `SELECT failure_mode_id, failure_cause_id FROM maintenance_interventions
            WHERE work_order_id = $1 AND (failure_mode_id IS NOT NULL OR failure_cause_id IS NOT NULL)
            ORDER BY started_at DESC LIMIT 1`,
          [id],
        );
        await resolveFailureWithClient(
          client,
          workOrder.failureReportId,
          diagnosis.rows[0]?.failure_mode_id ?? null,
          diagnosis.rows[0]?.failure_cause_id ?? null,
          actorId,
        );
      }
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'WORKORDER_TERMINE',
      entityType: 'maintenance_work_orders',
      entityId: id,
      oldValues: { status: workOrder.status },
      newValues: { status: 'TERMINE', verificationResult: input.verificationResult, restoredToService },
      context: null,
    });

    return { ...workOrder, status: 'TERMINE' };
  });
}

export type WorkOrderListRow = Readonly<{
  id: string;
  workOrderCode: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  productionLineCode: string | null;
  workOrderType: WorkOrderType;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  title: string;
  requestedAt: Date;
  dueAt: Date | null;
  assignedToName: string | null;
  closedAt: Date | null;
}>;

export type WorkOrderFilters = Readonly<{
  equipmentId: string | null;
  productionLineId: string | null;
  workOrderType: WorkOrderType | null;
  priority: WorkOrderPriority | null;
  status: WorkOrderStatus | null;
  assignedTo: string | null;
  limit: number;
}>;

export async function listWorkOrders(pool: pg.Pool, filters: WorkOrderFilters): Promise<readonly WorkOrderListRow[]> {
  const result = await pool.query<WorkOrderListRow>(
    `SELECT wo.id AS "id", wo.work_order_code AS "workOrderCode", wo.equipment_id AS "equipmentId",
            e.code AS "equipmentCode", e.name AS "equipmentName", pl.code AS "productionLineCode",
            wo.work_order_type AS "workOrderType", wo.priority AS "priority", wo.status AS "status",
            wo.title AS "title", wo.requested_at AS "requestedAt", wo.due_at AS "dueAt",
            u.full_name AS "assignedToName", wo.closed_at AS "closedAt"
       FROM maintenance_work_orders wo
       JOIN equipment e ON e.id = wo.equipment_id
       LEFT JOIN production_lines pl ON pl.id = e.production_line_id
       LEFT JOIN users u ON u.id = wo.assigned_to
      WHERE ($1::uuid IS NULL OR wo.equipment_id = $1)
        AND ($2::uuid IS NULL OR e.production_line_id = $2)
        AND ($3::text IS NULL OR wo.work_order_type = $3)
        AND ($4::text IS NULL OR wo.priority = $4)
        AND ($5::text IS NULL OR wo.status = $5)
        AND ($6::uuid IS NULL OR wo.assigned_to = $6)
      ORDER BY wo.requested_at DESC
      LIMIT $7`,
    [
      filters.equipmentId,
      filters.productionLineId,
      filters.workOrderType,
      filters.priority,
      filters.status,
      filters.assignedTo,
      filters.limit,
    ],
  );
  return result.rows;
}

export type WorkOrderDetail = WorkOrderListRow &
  Readonly<{
    description: string | null;
    failureReportId: string | null;
    failureCode: string | null;
    requestedByName: string;
    restoredAt: Date | null;
    restoredByName: string | null;
    verificationResult: WorkOrderVerificationResult | null;
    closedByName: string | null;
  }>;

export async function getWorkOrderDetail(pool: pg.Pool, id: string): Promise<WorkOrderDetail> {
  const result = await pool.query<WorkOrderDetail>(
    `SELECT wo.id AS "id", wo.work_order_code AS "workOrderCode", wo.equipment_id AS "equipmentId",
            e.code AS "equipmentCode", e.name AS "equipmentName", pl.code AS "productionLineCode",
            wo.work_order_type AS "workOrderType", wo.priority AS "priority", wo.status AS "status",
            wo.title AS "title", wo.description AS "description", wo.requested_at AS "requestedAt",
            ru.full_name AS "requestedByName", wo.due_at AS "dueAt",
            au.full_name AS "assignedToName", wo.failure_report_id AS "failureReportId",
            fr.failure_code AS "failureCode", wo.restored_at AS "restoredAt",
            resu.full_name AS "restoredByName", wo.verification_result AS "verificationResult",
            wo.closed_at AS "closedAt", cu.full_name AS "closedByName"
       FROM maintenance_work_orders wo
       JOIN equipment e ON e.id = wo.equipment_id
       LEFT JOIN production_lines pl ON pl.id = e.production_line_id
       JOIN users ru ON ru.id = wo.requested_by
       LEFT JOIN users au ON au.id = wo.assigned_to
       LEFT JOIN failure_reports fr ON fr.id = wo.failure_report_id
       LEFT JOIN users resu ON resu.id = wo.restored_by
       LEFT JOIN users cu ON cu.id = wo.closed_by
      WHERE wo.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Ordre de travail', id);
  }
  return row;
}
