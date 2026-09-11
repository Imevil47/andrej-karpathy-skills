import type pg from 'pg';

// Cross-cutting Maintenance read models: home KPIs, equipment history,
// MTTR and repeated-failure analysis. Mirrors qmsQueries.ts's shape
// (single home-summary query, focused counts, no decorative charts -
// section 48).

export type MaintenanceHomeSummary = Readonly<{
  openFailures: number;
  equipmentDown: number;
  workOrdersInProgress: number;
  preventiveOverdue: number;
  interventionsToday: number;
  partsBelowMinimum: number;
}>;

export async function maintenanceHomeSummary(pool: pg.Pool): Promise<MaintenanceHomeSummary> {
  const result = await pool.query<{
    open_failures: string;
    equipment_down: string;
    work_orders_in_progress: string;
    preventive_overdue: string;
    interventions_today: string;
    parts_below_minimum: string;
  }>(
    `SELECT
        (SELECT COUNT(*) FROM failure_reports
          WHERE status IN ('DECLAREE', 'PRISE_EN_CHARGE'))::text AS open_failures,
        (SELECT COUNT(*) FROM equipment WHERE status = 'EN_PANNE')::text AS equipment_down,
        (SELECT COUNT(*) FROM maintenance_work_orders WHERE status = 'EN_COURS')::text AS work_orders_in_progress,
        (SELECT COUNT(*) FROM preventive_task_status WHERE is_overdue)::text AS preventive_overdue,
        (SELECT COUNT(*) FROM maintenance_interventions
          WHERE started_at::date = CURRENT_DATE)::text AS interventions_today,
        (SELECT COUNT(*) FROM spare_part_stock WHERE below_minimum)::text AS parts_below_minimum`,
  );
  const row = result.rows[0];
  return {
    openFailures: Number(row?.open_failures ?? '0'),
    equipmentDown: Number(row?.equipment_down ?? '0'),
    workOrdersInProgress: Number(row?.work_orders_in_progress ?? '0'),
    preventiveOverdue: Number(row?.preventive_overdue ?? '0'),
    interventionsToday: Number(row?.interventions_today ?? '0'),
    partsBelowMinimum: Number(row?.parts_below_minimum ?? '0'),
  };
}

export type EquipmentActiveFailure = Readonly<{
  equipmentId: string;
  failureReportId: string;
  failureCode: string;
  severity: string;
  status: string;
  reportedAt: Date;
}>;

/** Section 47: active failure visibility, joined directly from
 * equipment/line/run pages - never requiring a visit to Maintenance. */
export async function activeFailuresForEquipmentIds(
  pool: pg.Pool,
  equipmentIds: readonly string[],
): Promise<readonly EquipmentActiveFailure[]> {
  if (equipmentIds.length === 0) {
    return [];
  }
  const result = await pool.query<EquipmentActiveFailure>(
    `SELECT equipment_id AS "equipmentId", failure_report_id AS "failureReportId",
            failure_code AS "failureCode", severity AS "severity", status AS "status",
            reported_at AS "reportedAt"
       FROM equipment_active_failure
      WHERE equipment_id = ANY($1::uuid[])`,
    [equipmentIds],
  );
  return result.rows;
}

export type EquipmentMttr = Readonly<{
  completedCorrectiveCount: number;
  totalDurationSeconds: number;
  mttrSeconds: number;
}>;

/** MTTR (section 51) - null means "Données insuffisantes" (no completed
 * corrective history yet), never a misleading zero average. */
export async function equipmentMttr(pool: pg.Pool, equipmentId: string): Promise<EquipmentMttr | null> {
  const result = await pool.query<{ completed_corrective_count: number; total_duration_seconds: number }>(
    `SELECT completed_corrective_count, total_duration_seconds
       FROM equipment_mttr WHERE equipment_id = $1`,
    [equipmentId],
  );
  const row = result.rows[0];
  if (!row || row.completed_corrective_count === 0) {
    return null;
  }
  return {
    completedCorrectiveCount: row.completed_corrective_count,
    totalDurationSeconds: row.total_duration_seconds,
    mttrSeconds: Math.round(row.total_duration_seconds / row.completed_corrective_count),
  };
}

export type RepeatedFailureGroup = Readonly<{
  failureModeCode: string | null;
  failureCauseCode: string | null;
  occurrenceCount: number;
  lastReportedAt: Date;
}>;

/**
 * Groups an equipment's failures over a sliding window by mode/cause
 * (section 44/acceptance scenario 4) - a plain GROUP BY, no AI diagnosis
 * required. Only groups with more than one occurrence are worth surfacing.
 */
export async function repeatedFailureAnalysis(
  pool: pg.Pool,
  equipmentId: string,
  sinceDays: number,
): Promise<readonly RepeatedFailureGroup[]> {
  const result = await pool.query<{
    failure_mode_code: string | null;
    failure_cause_code: string | null;
    occurrence_count: string;
    last_reported_at: Date;
  }>(
    `SELECT fm.code AS failure_mode_code, fc.code AS failure_cause_code,
            COUNT(*)::text AS occurrence_count, MAX(fr.reported_at) AS last_reported_at
       FROM failure_reports fr
       LEFT JOIN failure_modes fm ON fm.id = fr.failure_mode_id
       LEFT JOIN failure_causes fc ON fc.id = fr.failure_cause_id
      WHERE fr.equipment_id = $1
        AND fr.reported_at >= now() - ($2 || ' days')::interval
        AND fr.status <> 'ANNULEE'
      GROUP BY fm.code, fc.code
     HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC`,
    [equipmentId, sinceDays],
  );
  return result.rows.map((row) => ({
    failureModeCode: row.failure_mode_code,
    failureCauseCode: row.failure_cause_code,
    occurrenceCount: Number(row.occurrence_count),
    lastReportedAt: row.last_reported_at,
  }));
}

export type PartUsageRow = Readonly<{
  id: string;
  sparePartCode: string;
  sparePartName: string;
  quantity: string;
  interventionId: string;
  workOrderCode: string;
  occurredAt: Date;
}>;

/** Parts used on a given equipment's work orders - one of the equipment
 * history tabs (section 33). */
export async function listPartUsageForEquipment(pool: pg.Pool, equipmentId: string): Promise<readonly PartUsageRow[]> {
  const result = await pool.query<PartUsageRow>(
    `SELECT u.id AS "id", sp.part_code AS "sparePartCode", sp.name AS "sparePartName",
            u.quantity AS "quantity", u.intervention_id AS "interventionId",
            wo.work_order_code AS "workOrderCode", u.created_at AS "occurredAt"
       FROM maintenance_part_usage u
       JOIN spare_parts sp ON sp.id = u.spare_part_id
       JOIN maintenance_interventions mi ON mi.id = u.intervention_id
       JOIN maintenance_work_orders wo ON wo.id = mi.work_order_id
      WHERE wo.equipment_id = $1
      ORDER BY u.created_at DESC`,
    [equipmentId],
  );
  return result.rows;
}
