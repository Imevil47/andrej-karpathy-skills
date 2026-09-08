import type pg from 'pg';
import type { BalanceStatus, OutputType, RunLineActivity, RunStatus } from '../domain/types.ts';
import { notFoundError } from '../errors.ts';

// Read side of the production module. Every quantity comes from the database
// views: no formula is ever duplicated in a route or in the interface.

export type RunListFilters = Readonly<{
  productionDateFrom: string | null;
  productionDateTo: string | null;
  speciesId: string | null;
  productId: string | null;
  status: RunStatus | null;
  limit: number;
}>;

export type RunSummaryRow = Readonly<{
  id: string;
  runCode: string;
  productionDate: string;
  startedAt: Date | null;
  endedAt: Date | null;
  status: RunStatus;
  speciesCode: string;
  productCode: string;
  productName: string;
  format: string | null;
  piecesPerCan: number | null;
  responsibleName: string | null;
  inputKg: string;
  usefulKg: string;
  byProductKg: string;
  reworkKg: string;
  reclassifiedKg: string;
  realLossKg: string;
  accountedKg: string;
  differenceKg: string;
  differencePercent: string | null;
  balanceStatus: BalanceStatus;
  yieldPercent: string | null;
  isJustified: boolean;
}>;

// Shared projection of a run and its calculated material balance.
const RUN_SUMMARY_COLUMNS = `
         r.id                    AS "id",
         r.run_code              AS "runCode",
         r.production_date       AS "productionDate",
         r.started_at            AS "startedAt",
         r.ended_at              AS "endedAt",
         r.status                AS "status",
         sp.code                 AS "speciesCode",
         p.code                  AS "productCode",
         p.name                  AS "productName",
         r.format                AS "format",
         r.pieces_per_can        AS "piecesPerCan",
         u.full_name             AS "responsibleName",
         b.input_kg              AS "inputKg",
         b.useful_kg             AS "usefulKg",
         b.by_product_kg         AS "byProductKg",
         b.rework_kg             AS "reworkKg",
         b.reclassified_kg       AS "reclassifiedKg",
         b.real_loss_kg          AS "realLossKg",
         b.accounted_kg          AS "accountedKg",
         b.difference_kg         AS "differenceKg",
         b.difference_percent    AS "differencePercent",
         b.balance_status        AS "balanceStatus",
         y.yield_percent         AS "yieldPercent",
         r.difference_justification IS NOT NULL AS "isJustified"`;

const RUN_SUMMARY_FROM = `
    FROM production_runs r
    JOIN species sp ON sp.id = r.species_id
    JOIN products p ON p.id = r.product_id
    JOIN production_run_material_balance b ON b.production_run_id = r.id
    JOIN production_run_yield y ON y.production_run_id = r.id
    LEFT JOIN users u ON u.id = r.responsible_user_id`;

export async function listRuns(
  pool: pg.Pool,
  filters: RunListFilters,
): Promise<readonly RunSummaryRow[]> {
  const result = await pool.query<RunSummaryRow>(
    `SELECT ${RUN_SUMMARY_COLUMNS} ${RUN_SUMMARY_FROM}
      WHERE ($1::date IS NULL OR r.production_date >= $1)
        AND ($2::date IS NULL OR r.production_date <= $2)
        AND ($3::uuid IS NULL OR r.species_id = $3)
        AND ($4::uuid IS NULL OR r.product_id = $4)
        AND ($5::text IS NULL OR r.status = $5)
      ORDER BY r.production_date DESC, r.run_code DESC
      LIMIT $6`,
    [
      filters.productionDateFrom,
      filters.productionDateTo,
      filters.speciesId,
      filters.productId,
      filters.status,
      filters.limit,
    ],
  );
  return result.rows;
}

export type RunConsumptionRow = Readonly<{
  id: string;
  consumedAt: Date;
  lotId: string;
  lotCode: string;
  speciesCode: string;
  sizeGrade: string | null;
  locationCode: string;
  quantityKg: string;
  status: string;
  movementCode: string;
  createdByName: string;
  cancellationReason: string | null;
}>;

export type RunLineRow = Readonly<{
  id: string;
  lineCode: string;
  lineName: string;
  area: string | null;
  activityType: RunLineActivity;
  isActiveForRun: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  notes: string | null;
}>;

export type RunOutputRow = Readonly<{
  id: string;
  outputType: OutputType;
  quantityKg: string;
  occurredAt: Date;
  lineCode: string | null;
  stageCode: string | null;
  destinationLocationCode: string | null;
  lossReasonName: string | null;
  reasonText: string | null;
  notes: string | null;
  status: string;
  createdByName: string;
  cancellationReason: string | null;
}>;

export type RunDetail = Readonly<{
  run: RunSummaryRow & {
    notes: string | null;
    differenceJustification: string | null;
    justifiedByName: string | null;
    justifiedAt: Date | null;
    cancellationReason: string | null;
  };
  consumptions: readonly RunConsumptionRow[];
  lines: readonly RunLineRow[];
  outputs: readonly RunOutputRow[];
}>;

/**
 * "Situation du Run": everything about one run, assembled once for the tabbed
 * detail screen.
 */
export async function runDetail(pool: pg.Pool, runId: string): Promise<RunDetail> {
  const runResult = await pool.query<RunDetail['run']>(
    `SELECT ${RUN_SUMMARY_COLUMNS},
            r.notes                    AS "notes",
            r.difference_justification AS "differenceJustification",
            j.full_name                AS "justifiedByName",
            r.justified_at             AS "justifiedAt",
            r.cancellation_reason      AS "cancellationReason"
       ${RUN_SUMMARY_FROM}
       LEFT JOIN users j ON j.id = r.justified_by
      WHERE r.id = $1`,
    [runId],
  );
  const run = runResult.rows[0];
  if (!run) {
    throw notFoundError('Ordre de production', runId);
  }

  const [consumptions, lines, outputs] = await Promise.all([
    pool.query<RunConsumptionRow>(
      `SELECT m.id             AS "id",
              m.consumed_at    AS "consumedAt",
              lot.id           AS "lotId",
              lot.lot_code     AS "lotCode",
              sp.code          AS "speciesCode",
              last_inspection.size_grade AS "sizeGrade",
              loc.code         AS "locationCode",
              m.quantity_kg    AS "quantityKg",
              m.status         AS "status",
              mv.movement_code AS "movementCode",
              u.full_name      AS "createdByName",
              m.cancellation_reason AS "cancellationReason"
         FROM production_run_materials m
         JOIN raw_material_lots lot ON lot.id = m.raw_material_lot_id
         JOIN species sp ON sp.id = lot.species_id
         JOIN locations loc ON loc.id = m.source_location_id
         JOIN stock_movements mv ON mv.id = m.stock_movement_id
         JOIN users u ON u.id = m.created_by
         LEFT JOIN LATERAL (
              SELECT i.size_grade
                FROM quality_inspections i
               WHERE i.raw_material_lot_id = lot.id
               ORDER BY i.inspected_at DESC
               LIMIT 1
         ) last_inspection ON TRUE
        WHERE m.production_run_id = $1
        ORDER BY m.consumed_at, m.created_at`,
      [runId],
    ),
    pool.query<RunLineRow>(
      `SELECT rl.id                AS "id",
              l.code               AS "lineCode",
              l.name               AS "lineName",
              l.area               AS "area",
              rl.activity_type     AS "activityType",
              rl.is_active_for_run AS "isActiveForRun",
              rl.started_at        AS "startedAt",
              rl.ended_at          AS "endedAt",
              rl.notes             AS "notes"
         FROM production_run_lines rl
         JOIN production_lines l ON l.id = rl.production_line_id
        WHERE rl.production_run_id = $1
        ORDER BY l.display_order, l.code`,
      [runId],
    ),
    pool.query<RunOutputRow>(
      `SELECT o.id                  AS "id",
              o.output_type         AS "outputType",
              o.quantity_kg         AS "quantityKg",
              o.occurred_at         AS "occurredAt",
              l.code                AS "lineCode",
              st.code               AS "stageCode",
              loc.code              AS "destinationLocationCode",
              lr.name               AS "lossReasonName",
              o.reason_text         AS "reasonText",
              o.notes               AS "notes",
              o.status              AS "status",
              u.full_name           AS "createdByName",
              o.cancellation_reason AS "cancellationReason"
         FROM production_outputs o
         JOIN users u ON u.id = o.created_by
         LEFT JOIN production_lines l ON l.id = o.production_line_id
         LEFT JOIN production_stages st ON st.id = o.destination_stage_id
         LEFT JOIN locations loc ON loc.id = o.destination_location_id
         LEFT JOIN production_loss_reasons lr ON lr.id = o.loss_reason_id
        WHERE o.production_run_id = $1
        ORDER BY o.occurred_at, o.created_at`,
      [runId],
    ),
  ]);

  return {
    run,
    consumptions: consumptions.rows,
    lines: lines.rows,
    outputs: outputs.rows,
  };
}

export type LotRunUsageRow = Readonly<{
  runId: string;
  runCode: string;
  productionDate: string;
  runStatus: RunStatus;
  productCode: string;
  productName: string;
  consumedKg: string;
}>;

/** Forward traceability: every run that consumed a raw material lot. */
export async function lotProductionUsage(
  pool: pg.Pool,
  lotId: string,
): Promise<readonly LotRunUsageRow[]> {
  const result = await pool.query<LotRunUsageRow>(
    `SELECT production_run_id AS "runId",
            run_code          AS "runCode",
            production_date   AS "productionDate",
            run_status        AS "runStatus",
            product_code      AS "productCode",
            product_name      AS "productName",
            consumed_kg       AS "consumedKg"
       FROM lot_production_usage
      WHERE raw_material_lot_id = $1
      ORDER BY production_date DESC, run_code DESC`,
    [lotId],
  );
  return result.rows;
}

export type ProductionHomeSummary = Readonly<{
  runsInProgress: number;
  consumedTodayKg: string;
  runsWithDifferenceToJustify: number;
}>;

export async function productionHomeSummary(pool: pg.Pool): Promise<ProductionHomeSummary> {
  const result = await pool.query<{
    runs_in_progress: string;
    consumed_today_kg: string;
    runs_to_justify: string;
  }>(
    `SELECT (SELECT COUNT(*) FROM production_runs WHERE status = 'EN_COURS')::text
              AS runs_in_progress,
            (SELECT COALESCE(SUM(quantity_kg), 0)::numeric(14,3)
               FROM production_run_materials
              WHERE status = 'VALIDE' AND consumed_at >= date_trunc('day', now()))::text
              AS consumed_today_kg,
            (SELECT COUNT(*)
               FROM production_run_material_balance b
               JOIN production_runs r ON r.id = b.production_run_id
              WHERE b.balance_status = 'ECART_A_JUSTIFIER'
                AND r.status <> 'ANNULE'
                AND r.difference_justification IS NULL)::text
              AS runs_to_justify`,
  );
  const row = result.rows[0];
  return {
    runsInProgress: Number(row?.runs_in_progress ?? '0'),
    consumedTodayKg: row?.consumed_today_kg ?? '0.000',
    runsWithDifferenceToJustify: Number(row?.runs_to_justify ?? '0'),
  };
}
