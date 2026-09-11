import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import {
  FAILURE_REPORT_ALLOWED_TRANSITIONS,
  type FailureReportStatus,
  type FailureSeverity,
} from '../domain/types.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { requireEquipment, setEquipmentStatus } from './masterdata.ts';
import { endDowntimeWithClient, startDowntimeWithClient } from './downtime.ts';

// FAILURE REPORT is the observed breakdown/event (section 66), distinct from
// the work order that later authorizes repairing it - workOrders.ts creates
// work orders that reference a failure_report_id, never the other way
// around.

export type FailureReport = Readonly<{
  id: string;
  failureCode: string;
  equipmentId: string;
  status: FailureReportStatus;
  downtimeEventId: string | null;
}>;

export async function requireFailureReport(client: DatabaseClient, id: string): Promise<FailureReport> {
  const result = await client.query<{
    id: string;
    failure_code: string;
    equipment_id: string;
    status: FailureReportStatus;
    downtime_event_id: string | null;
  }>(
    `SELECT id, failure_code, equipment_id, status, downtime_event_id
       FROM failure_reports WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Panne', id);
  }
  return {
    id: row.id,
    failureCode: row.failure_code,
    equipmentId: row.equipment_id,
    status: row.status,
    downtimeEventId: row.downtime_event_id,
  };
}

function assertFailureTransition(from: FailureReportStatus, to: FailureReportStatus): void {
  if (!FAILURE_REPORT_ALLOWED_TRANSITIONS[from].includes(to)) {
    throw conflictError(`Transition de statut de panne invalide : ${from} -> ${to}.`, { from, to });
  }
}

export type CreateFailureReportInput = Readonly<{
  equipmentId: string;
  severity: FailureSeverity;
  description: string;
  productionRunId: string | null;
  productionRunLineId: string | null;
  stopsProduction: boolean;
  reportedAt: Date;
}>;

/**
 * Declares a breakdown (section 10 / acceptance scenario 1). When it stops
 * production, this opens a real downtime event through the exact same
 * services/downtime.ts logic Phase 3 uses - never a duplicated record - in
 * the same transaction, so the failure and its downtime can never disagree
 * about whether production actually stopped.
 */
export async function createFailureReport(
  pool: pg.Pool,
  input: CreateFailureReportInput,
  actorId: string,
): Promise<FailureReport> {
  return withTransaction(pool, async (client) => {
    const equipment = await requireEquipment(client, input.equipmentId);

    if (input.stopsProduction && input.productionRunId === null) {
      throw validationError(
        "L'ordre de production est requis lorsque la panne arrête la production.",
        { equipmentId: input.equipmentId },
      );
    }

    let downtimeEventId: string | null = null;
    if (input.stopsProduction && input.productionRunId !== null) {
      const category = await client.query<{ id: string }>(
        "SELECT id FROM downtime_categories WHERE code = 'PANNE_MACHINE'",
      );
      const categoryId = category.rows[0]?.id;
      if (!categoryId) {
        throw new Error("La catégorie d'arrêt PANNE_MACHINE est introuvable.");
      }
      const downtime = await startDowntimeWithClient(
        client,
        input.productionRunId,
        {
          productionRunLineId: input.productionRunLineId,
          downtimeCategoryId: categoryId,
          reasonText: input.description,
          planned: false,
          startedAt: input.reportedAt,
        },
        actorId,
      );
      downtimeEventId = downtime.id;
    }

    const failureCode = await nextOperationalCode(client, 'PAN', input.reportedAt);
    const inserted = await client.query<{ id: string; status: FailureReportStatus }>(
      `INSERT INTO failure_reports (failure_code, equipment_id, production_run_id,
                                    production_run_line_id, downtime_event_id, severity,
                                    description, reported_by, reported_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, status`,
      [
        failureCode,
        input.equipmentId,
        input.productionRunId,
        input.productionRunLineId,
        downtimeEventId,
        input.severity,
        input.description,
        actorId,
        input.reportedAt,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("La panne n'a pas pu être enregistrée.");
    }

    await setEquipmentStatus(client, input.equipmentId, 'EN_PANNE');

    await recordAudit(client, {
      userId: actorId,
      action: 'FAILURE_DECLAREE',
      entityType: 'failure_reports',
      entityId: row.id,
      oldValues: null,
      newValues: {
        failureCode,
        equipmentCode: equipment.code,
        severity: input.severity,
        downtimeEventId,
      },
      context: null,
    });

    return {
      id: row.id,
      failureCode,
      equipmentId: input.equipmentId,
      status: row.status,
      downtimeEventId,
    };
  });
}

/** Called by workOrders.ts when a work order is opened against this failure
 * (DECLAREE -> PRISE_EN_CHARGE), always within the caller's own transaction. */
export async function markFailureTakenInChargeWithClient(
  client: DatabaseClient,
  failureReportId: string,
  actorId: string,
): Promise<void> {
  const failure = await requireFailureReport(client, failureReportId);
  if (failure.status === 'PRISE_EN_CHARGE') {
    return;
  }
  assertFailureTransition(failure.status, 'PRISE_EN_CHARGE');
  await client.query("UPDATE failure_reports SET status = 'PRISE_EN_CHARGE', updated_at = now() WHERE id = $1", [
    failureReportId,
  ]);
  await recordAudit(client, {
    userId: actorId,
    action: 'FAILURE_PRISE_EN_CHARGE',
    entityType: 'failure_reports',
    entityId: failureReportId,
    oldValues: { status: failure.status },
    newValues: { status: 'PRISE_EN_CHARGE' },
    context: null,
  });
}

/** Called by workOrders.ts when the work order resolving this failure is
 * completed and the equipment is returned to service - copies the
 * intervention's diagnosed mode/cause onto the failure for repeated-failure
 * analysis (section 44), always within the caller's own transaction. */
export async function resolveFailureWithClient(
  client: DatabaseClient,
  failureReportId: string,
  failureModeId: string | null,
  failureCauseId: string | null,
  actorId: string,
): Promise<void> {
  const failure = await requireFailureReport(client, failureReportId);
  assertFailureTransition(failure.status, 'RESOLUE');
  await client.query(
    `UPDATE failure_reports
        SET status = 'RESOLUE', resolved_at = now(), failure_mode_id = COALESCE($2, failure_mode_id),
            failure_cause_id = COALESCE($3, failure_cause_id), updated_at = now()
      WHERE id = $1`,
    [failureReportId, failureModeId, failureCauseId],
  );
  if (failure.downtimeEventId !== null) {
    const downtime = await client.query<{ ended_at: Date | null }>(
      'SELECT ended_at FROM downtime_events WHERE id = $1',
      [failure.downtimeEventId],
    );
    if (downtime.rows[0] && downtime.rows[0].ended_at === null) {
      await endDowntimeWithClient(client, failure.downtimeEventId, new Date(), actorId);
    }
  }
  await recordAudit(client, {
    userId: actorId,
    action: 'FAILURE_RESOLUE',
    entityType: 'failure_reports',
    entityId: failureReportId,
    oldValues: { status: failure.status },
    newValues: { status: 'RESOLUE', failureModeId, failureCauseId },
    context: null,
  });
}

export async function cancelFailureReport(pool: pg.Pool, id: string, actorId: string): Promise<void> {
  return withTransaction(pool, async (client) => {
    const failure = await requireFailureReport(client, id);
    assertFailureTransition(failure.status, 'ANNULEE');
    await client.query("UPDATE failure_reports SET status = 'ANNULEE', updated_at = now() WHERE id = $1", [id]);
    await recordAudit(client, {
      userId: actorId,
      action: 'FAILURE_ANNULEE',
      entityType: 'failure_reports',
      entityId: id,
      oldValues: { status: failure.status },
      newValues: { status: 'ANNULEE' },
      context: null,
    });
  });
}

export type FailureReportListRow = Readonly<{
  id: string;
  failureCode: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  severity: FailureSeverity;
  status: FailureReportStatus;
  description: string;
  reportedAt: Date;
  reportedByName: string;
  resolvedAt: Date | null;
  failureModeCode: string | null;
  failureCauseCode: string | null;
}>;

export type FailureReportFilters = Readonly<{
  equipmentId: string | null;
  status: FailureReportStatus | null;
  limit: number;
}>;

export async function listFailureReports(
  pool: pg.Pool,
  filters: FailureReportFilters,
): Promise<readonly FailureReportListRow[]> {
  const result = await pool.query<FailureReportListRow>(
    `SELECT fr.id AS "id", fr.failure_code AS "failureCode", fr.equipment_id AS "equipmentId",
            e.code AS "equipmentCode", e.name AS "equipmentName", fr.severity AS "severity",
            fr.status AS "status", fr.description AS "description", fr.reported_at AS "reportedAt",
            u.full_name AS "reportedByName", fr.resolved_at AS "resolvedAt",
            fm.code AS "failureModeCode", fc.code AS "failureCauseCode"
       FROM failure_reports fr
       JOIN equipment e ON e.id = fr.equipment_id
       JOIN users u ON u.id = fr.reported_by
       LEFT JOIN failure_modes fm ON fm.id = fr.failure_mode_id
       LEFT JOIN failure_causes fc ON fc.id = fr.failure_cause_id
      WHERE ($1::uuid IS NULL OR fr.equipment_id = $1)
        AND ($2::text IS NULL OR fr.status = $2)
      ORDER BY fr.reported_at DESC
      LIMIT $3`,
    [filters.equipmentId, filters.status, filters.limit],
  );
  return result.rows;
}

export async function getFailureReportDetail(pool: pg.Pool, id: string): Promise<FailureReportListRow> {
  const result = await pool.query<FailureReportListRow>(
    `SELECT fr.id AS "id", fr.failure_code AS "failureCode", fr.equipment_id AS "equipmentId",
            e.code AS "equipmentCode", e.name AS "equipmentName", fr.severity AS "severity",
            fr.status AS "status", fr.description AS "description", fr.reported_at AS "reportedAt",
            u.full_name AS "reportedByName", fr.resolved_at AS "resolvedAt",
            fm.code AS "failureModeCode", fc.code AS "failureCauseCode"
       FROM failure_reports fr
       JOIN equipment e ON e.id = fr.equipment_id
       JOIN users u ON u.id = fr.reported_by
       LEFT JOIN failure_modes fm ON fm.id = fr.failure_mode_id
       LEFT JOIN failure_causes fc ON fc.id = fr.failure_cause_id
      WHERE fr.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Panne', id);
  }
  return row;
}
