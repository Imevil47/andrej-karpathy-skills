import type pg from 'pg';
import { performanceStatus, type PerformanceStatus } from '../domain/types.ts';
import { notFoundError } from '../errors.ts';

// Read side of the workforce cadence module. Every figure comes from the
// database views: coverage, cadence and performance are never recomputed in
// a route or in the interface.

export type ControlRoundRow = Readonly<{
  id: string;
  roundCode: string;
  productionRunId: string;
  runCode: string;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  controllerName: string;
  linesVisited: number;
  linesCompleted: number;
  employeesExpected: number;
  employeesControlled: number;
  coveragePercent: string | null;
}>;

const CONTROL_ROUND_QUERY = `
  SELECT cr.id                  AS "id",
         cr.round_code          AS "roundCode",
         cr.production_run_id   AS "productionRunId",
         r.run_code             AS "runCode",
         cr.started_at          AS "startedAt",
         cr.ended_at            AS "endedAt",
         cr.status              AS "status",
         u.full_name            AS "controllerName",
         COALESCE(s.lines_visited, 0)          AS "linesVisited",
         COALESCE(s.lines_completed, 0)        AS "linesCompleted",
         COALESCE(s.employees_expected, 0)     AS "employeesExpected",
         COALESCE(s.employees_controlled, 0)   AS "employeesControlled",
         s.coverage_percent::text              AS "coveragePercent"
    FROM control_rounds cr
    JOIN production_runs r ON r.id = cr.production_run_id
    JOIN users u ON u.id = cr.controller_user_id
    LEFT JOIN control_round_summary s ON s.control_round_id = cr.id`;

export type ControlRoundListFilters = Readonly<{
  runId: string | null;
  status: string | null;
  limit: number;
}>;

export async function listControlRounds(
  pool: pg.Pool,
  filters: ControlRoundListFilters,
): Promise<readonly ControlRoundRow[]> {
  const result = await pool.query<ControlRoundRow>(
    `${CONTROL_ROUND_QUERY}
      WHERE ($1::uuid IS NULL OR cr.production_run_id = $1)
        AND ($2::text IS NULL OR cr.status = $2)
      ORDER BY cr.started_at DESC
      LIMIT $3`,
    [filters.runId, filters.status, filters.limit],
  );
  return result.rows;
}

export type LineControlRow = Readonly<{
  id: string;
  productionRunLineId: string;
  lineCode: string;
  lineName: string;
  activityType: string;
  controlledAt: Date;
  status: string;
  expectedEmployeeCount: number;
  controlledEmployeeCount: number;
  coveragePercent: string | null;
  coverageStatus: string;
  lineCadencePerHour: string | null;
}>;

export type EmployeeControlRow = Readonly<{
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  controlledAt: Date;
  quantityCompleted: string;
  measurementUnit: string;
  measurementDurationSeconds: number;
  cadencePerHour: string;
  standardCadenceSnapshot: string | null;
  performancePercent: string | null;
  performanceStatus: PerformanceStatus | null;
  status: string;
  cancellationReason: string | null;
}>;

export type ControlRoundDetail = Readonly<{
  round: ControlRoundRow;
  lines: readonly LineControlRow[];
  employeeControls: readonly EmployeeControlRow[];
}>;

export async function controlRoundDetail(
  pool: pg.Pool,
  roundId: string,
): Promise<ControlRoundDetail> {
  const roundResult = await pool.query<ControlRoundRow>(`${CONTROL_ROUND_QUERY} WHERE cr.id = $1`, [
    roundId,
  ]);
  const round = roundResult.rows[0];
  if (!round) {
    throw notFoundError('Tour de contrôle', roundId);
  }

  const [lines, employeeControls] = await Promise.all([
    pool.query<LineControlRow>(
      `SELECT lc.id                       AS "id",
              rl.id                       AS "productionRunLineId",
              l.code                      AS "lineCode",
              l.name                      AS "lineName",
              lc.activity_type            AS "activityType",
              lc.controlled_at            AS "controlledAt",
              lc.status                   AS "status",
              cov.expected_employee_count AS "expectedEmployeeCount",
              cov.controlled_employee_count AS "controlledEmployeeCount",
              cov.coverage_percent::text  AS "coveragePercent",
              cov.coverage_status         AS "coverageStatus",
              cad.line_cadence_per_hour::text AS "lineCadencePerHour"
         FROM line_controls lc
         JOIN production_run_lines rl ON rl.id = lc.production_run_line_id
         JOIN production_lines l ON l.id = rl.production_line_id
         JOIN line_control_coverage cov ON cov.line_control_id = lc.id
         JOIN line_control_cadence cad ON cad.line_control_id = lc.id
        WHERE lc.control_round_id = $1
        ORDER BY l.display_order, l.code`,
      [roundId],
    ),
    pool.query<Omit<EmployeeControlRow, 'performanceStatus'>>(
      `SELECT ecc.id                            AS "id",
              ecc.employee_id                    AS "employeeId",
              e.employee_number                  AS "employeeNumber",
              COALESCE(e.display_name, e.first_name || ' ' || e.last_name) AS "employeeName",
              ecc.controlled_at                  AS "controlledAt",
              ecc.quantity_completed::text        AS "quantityCompleted",
              ecc.measurement_unit                AS "measurementUnit",
              ecc.measurement_duration_seconds    AS "measurementDurationSeconds",
              ecc.cadence_per_hour::text          AS "cadencePerHour",
              ecc.standard_cadence_snapshot::text AS "standardCadenceSnapshot",
              ecc.performance_percent::text       AS "performancePercent",
              ecc.status                          AS "status",
              ecc.cancellation_reason             AS "cancellationReason"
         FROM employee_cadence_controls ecc
         JOIN line_controls lc ON lc.id = ecc.line_control_id
         JOIN employees e ON e.id = ecc.employee_id
        WHERE lc.control_round_id = $1
        ORDER BY ecc.controlled_at`,
      [roundId],
    ),
  ]);

  return {
    round,
    lines: lines.rows,
    employeeControls: employeeControls.rows.map((row) => ({
      ...row,
      performanceStatus: performanceStatus(
        row.performancePercent === null ? null : Number(row.performancePercent),
      ),
    })),
  };
}

export type CadenceHistoryRow = Readonly<{
  id: string;
  controlledAt: Date;
  runCode: string;
  productionDate: string;
  productCode: string;
  productName: string;
  speciesCode: string;
  lineCode: string;
  lineName: string;
  activityType: string;
  employeeNumber: string;
  employeeName: string;
  quantityCompleted: string;
  measurementUnit: string;
  measurementDurationSeconds: number;
  cadencePerHour: string;
  standardCadenceSnapshot: string | null;
  performancePercent: string | null;
  performanceStatus: PerformanceStatus | null;
}>;

export type CadenceHistoryFilters = Readonly<{
  runId: string | null;
  productId: string | null;
  productionRunLineId: string | null;
  employeeId: string | null;
  activityType: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  limit: number;
}>;

/**
 * Shared history feed behind the Cadence page, "Historique employée" and
 * "Historique ligne": one query, one formula, three presentations.
 */
export async function cadenceHistory(
  pool: pg.Pool,
  filters: CadenceHistoryFilters,
): Promise<readonly CadenceHistoryRow[]> {
  const result = await pool.query<Omit<CadenceHistoryRow, 'performanceStatus'>>(
    `SELECT id                          AS "id",
            controlled_at               AS "controlledAt",
            run_code                    AS "runCode",
            production_date             AS "productionDate",
            product_code                AS "productCode",
            product_name                AS "productName",
            species_code                AS "speciesCode",
            line_code                   AS "lineCode",
            line_name                   AS "lineName",
            activity_type               AS "activityType",
            employee_number             AS "employeeNumber",
            employee_name               AS "employeeName",
            quantity_completed::text    AS "quantityCompleted",
            measurement_unit            AS "measurementUnit",
            measurement_duration_seconds AS "measurementDurationSeconds",
            cadence_per_hour::text      AS "cadencePerHour",
            standard_cadence_snapshot::text AS "standardCadenceSnapshot",
            performance_percent::text   AS "performancePercent"
       FROM employee_cadence_history
      WHERE ($1::uuid IS NULL OR production_run_id = $1)
        AND ($2::uuid IS NULL OR production_run_line_id = $2)
        AND ($3::uuid IS NULL OR employee_id = $3)
        AND ($4::text IS NULL OR activity_type = $4)
        AND ($5::date IS NULL OR production_date >= $5)
        AND ($6::date IS NULL OR production_date <= $6)
        AND ($7::uuid IS NULL OR production_run_id IN (
              SELECT id FROM production_runs WHERE product_id = $7
        ))
      ORDER BY controlled_at DESC
      LIMIT $8`,
    [
      filters.runId,
      filters.productionRunLineId,
      filters.employeeId,
      filters.activityType,
      filters.dateFrom,
      filters.dateTo,
      filters.productId,
      filters.limit,
    ],
  );
  return result.rows.map((row) => ({
    ...row,
    performanceStatus: performanceStatus(
      row.performancePercent === null ? null : Number(row.performancePercent),
    ),
  }));
}

export type CadenceHomeSummary = Readonly<{
  controlRoundsToday: number;
  incompleteControlRounds: number;
  activeDowntimeCount: number;
}>;

export async function cadenceHomeSummary(pool: pg.Pool): Promise<CadenceHomeSummary> {
  const result = await pool.query<{
    rounds_today: string;
    incomplete_rounds: string;
    active_downtime: string;
  }>(
    `SELECT (SELECT COUNT(*) FROM control_rounds
              WHERE started_at >= date_trunc('day', now()))::text AS rounds_today,
            (SELECT COUNT(*) FROM control_rounds cr
               JOIN control_round_summary s ON s.control_round_id = cr.id
              WHERE cr.status = 'TERMINE'
                AND s.coverage_percent IS NOT NULL
                AND s.coverage_percent < 100)::text AS incomplete_rounds,
            (SELECT COUNT(*) FROM downtime_events WHERE ended_at IS NULL)::text AS active_downtime`,
  );
  const row = result.rows[0];
  return {
    controlRoundsToday: Number(row?.rounds_today ?? '0'),
    incompleteControlRounds: Number(row?.incomplete_rounds ?? '0'),
    activeDowntimeCount: Number(row?.active_downtime ?? '0'),
  };
}

export type RunLineCadenceSummaryRow = Readonly<{
  productionRunLineId: string;
  presentCount: number;
  lastControlledAt: Date | null;
  lastCoveragePercent: string | null;
  lastCoverageStatus: string | null;
  lineCadencePerHour: string | null;
  performancePercent: string | null;
  performanceStatus: PerformanceStatus | null;
  downtimeTodaySeconds: number;
  activeDowntime: boolean;
}>;

/**
 * Per-line-of-the-Run supervision summary (section 44): present headcount,
 * the most recent line control's coverage and cadence, and today's downtime.
 * Kept as its own endpoint rather than folded into the Phase 2 Run detail
 * payload, so Phase 2's response shape is never touched by Phase 3.
 */
export async function runLineCadenceSummary(
  pool: pg.Pool,
  runId: string,
): Promise<readonly RunLineCadenceSummaryRow[]> {
  const result = await pool.query<Omit<RunLineCadenceSummaryRow, 'performanceStatus'>>(
    `SELECT rl.id AS "productionRunLineId",
            COALESCE(present.count, 0) AS "presentCount",
            last_lc.controlled_at AS "lastControlledAt",
            cov.coverage_percent::text AS "lastCoveragePercent",
            cov.coverage_status AS "lastCoverageStatus",
            cad.line_cadence_per_hour::text AS "lineCadencePerHour",
            CASE
                WHEN std.standard_cadence IS NULL OR std.standard_cadence = 0 THEN NULL
                ELSE round(cad.line_cadence_per_hour / std.standard_cadence * 100, 2)::text
            END AS "performancePercent",
            COALESCE(dt.today_seconds, 0) AS "downtimeTodaySeconds",
            COALESCE(dt.active, FALSE) AS "activeDowntime"
       FROM production_run_lines rl
       LEFT JOIN LATERAL (
            SELECT COUNT(*)::integer AS count
              FROM production_run_employee_assignments a
             WHERE a.production_run_line_id = rl.id AND a.assigned_until IS NULL AND a.is_present = TRUE
       ) present ON TRUE
       LEFT JOIN LATERAL (
            SELECT lc.id, lc.controlled_at
              FROM line_controls lc
             WHERE lc.production_run_line_id = rl.id
             ORDER BY lc.controlled_at DESC
             LIMIT 1
       ) last_lc ON TRUE
       LEFT JOIN line_control_coverage cov ON cov.line_control_id = last_lc.id
       LEFT JOIN line_control_cadence cad ON cad.line_control_id = last_lc.id
       LEFT JOIN LATERAL (
            SELECT cs.standard_cadence
              FROM cadence_standards cs
              JOIN production_runs r ON r.id = rl.production_run_id
             WHERE cs.is_active = TRUE
               AND cs.activity_type = rl.activity_type
               AND cs.size_grade IS NULL
               AND (cs.species_id IS NULL OR cs.species_id = r.species_id)
               AND (cs.product_id IS NULL OR cs.product_id = r.product_id)
               AND (cs.format IS NULL OR cs.format = r.format)
               AND (cs.pieces_per_can IS NULL OR cs.pieces_per_can = r.pieces_per_can)
               AND (cs.valid_from IS NULL OR cs.valid_from <= CURRENT_DATE)
               AND (cs.valid_to IS NULL OR cs.valid_to >= CURRENT_DATE)
               AND cad.line_cadence_per_hour IS NOT NULL
             ORDER BY
               (CASE WHEN cs.product_id IS NOT NULL THEN 8 ELSE 0 END
                + CASE WHEN cs.species_id IS NOT NULL THEN 4 ELSE 0 END
                + CASE WHEN cs.format IS NOT NULL THEN 2 ELSE 0 END
                + CASE WHEN cs.pieces_per_can IS NOT NULL THEN 1 ELSE 0 END) DESC,
               cs.created_at DESC
             LIMIT 1
       ) std ON TRUE
       LEFT JOIN LATERAL (
            SELECT SUM(d.duration_seconds) FILTER (WHERE d.ended_at IS NOT NULL)::integer AS today_seconds,
                   BOOL_OR(d.ended_at IS NULL) AS active
              FROM downtime_events d
             WHERE d.production_run_line_id = rl.id
               AND d.started_at >= date_trunc('day', now())
       ) dt ON TRUE
      WHERE rl.production_run_id = $1
      ORDER BY rl.id`,
    [runId],
  );
  return result.rows.map((row) => ({
    ...row,
    performanceStatus: performanceStatus(
      row.performancePercent === null ? null : Number(row.performancePercent),
    ),
  }));
}
