import type pg from 'pg';

// Read-only queries for Phase 4: filling, seaming, marking, sterilization,
// CCP, deviations and cooling. Every calculated figure is read from the
// migration 012 views, never recomputed here.

export type FillingOperationRow = Readonly<{
  id: string;
  operationCode: string;
  productionRunId: string;
  runCode: string;
  productId: string;
  productCode: string;
  productName: string;
  lineCode: string | null;
  format: string | null;
  piecesPerCan: number | null;
  fillingMediumName: string | null;
  startedAt: string;
  endedAt: string | null;
  status: string;
  lastControlAt: string | null;
  lastControlStatus: string | null;
}>;

export async function listFillingOperations(
  pool: pg.Pool,
  filters: Readonly<{ runId: string | null; status: string | null; limit: number }>,
): Promise<readonly FillingOperationRow[]> {
  const result = await pool.query<FillingOperationRow>(
    `SELECT fo.id AS "id", fo.operation_code AS "operationCode",
            fo.production_run_id AS "productionRunId", r.run_code AS "runCode",
            fo.product_id AS "productId", p.code AS "productCode", p.name AS "productName",
            l.code AS "lineCode", fo.format AS "format", fo.pieces_per_can AS "piecesPerCan",
            fm.name AS "fillingMediumName", fo.started_at AS "startedAt", fo.ended_at AS "endedAt",
            fo.status AS "status",
            last_wc.controlled_at AS "lastControlAt", last_wc.control_status AS "lastControlStatus"
       FROM filling_operations fo
       JOIN production_runs r ON r.id = fo.production_run_id
       JOIN products p ON p.id = fo.product_id
       LEFT JOIN production_lines l ON l.id = fo.production_line_id
       LEFT JOIN filling_media fm ON fm.id = fo.filling_medium_id
       LEFT JOIN LATERAL (
             SELECT wc.controlled_at, sum.control_status
               FROM filling_weight_controls wc
               JOIN filling_weight_control_summary sum ON sum.weight_control_id = wc.id
              WHERE wc.filling_operation_id = fo.id
              ORDER BY wc.controlled_at DESC LIMIT 1
       ) last_wc ON TRUE
      WHERE ($1::uuid IS NULL OR fo.production_run_id = $1)
        AND ($2::text IS NULL OR fo.status = $2)
      ORDER BY fo.started_at DESC
      LIMIT $3`,
    [filters.runId, filters.status, filters.limit],
  );
  return result.rows;
}

export type WeightControlRow = Readonly<{
  id: string;
  controlCode: string;
  fillingOperationId: string;
  productionRunId: string;
  runCode: string;
  productCode: string;
  format: string | null;
  controlledAt: string;
  controllerName: string;
  sampleSize: number;
  sampleCount: number;
  minWeightGSnapshot: string | null;
  maxWeightGSnapshot: string | null;
  averageWeightG: string | null;
  underweightCount: number;
  conformeCount: number;
  overweightCount: number;
  controlStatus: string;
}>;

const WEIGHT_CONTROL_QUERY = `
  SELECT wc.id AS "id", wc.control_code AS "controlCode",
         wc.filling_operation_id AS "fillingOperationId", wc.production_run_id AS "productionRunId",
         r.run_code AS "runCode", p.code AS "productCode", fo.format AS "format",
         wc.controlled_at AS "controlledAt", u.full_name AS "controllerName",
         wc.sample_size AS "sampleSize", sum.sample_count AS "sampleCount",
         wc.min_weight_g_snapshot::text AS "minWeightGSnapshot",
         wc.max_weight_g_snapshot::text AS "maxWeightGSnapshot",
         sum.average_weight_g::text AS "averageWeightG", sum.underweight_count AS "underweightCount",
         sum.conforme_count AS "conformeCount", sum.overweight_count AS "overweightCount",
         sum.control_status AS "controlStatus"
    FROM filling_weight_controls wc
    JOIN filling_operations fo ON fo.id = wc.filling_operation_id
    JOIN production_runs r ON r.id = wc.production_run_id
    JOIN products p ON p.id = fo.product_id
    JOIN users u ON u.id = wc.controller_user_id
    JOIN filling_weight_control_summary sum ON sum.weight_control_id = wc.id`;

export async function listWeightControls(
  pool: pg.Pool,
  filters: Readonly<{
    runId: string | null;
    fillingOperationId: string | null;
    status: string | null;
    limit: number;
  }>,
): Promise<readonly WeightControlRow[]> {
  const result = await pool.query<WeightControlRow>(
    `${WEIGHT_CONTROL_QUERY}
      WHERE ($1::uuid IS NULL OR wc.production_run_id = $1)
        AND ($2::uuid IS NULL OR wc.filling_operation_id = $2)
        AND ($3::text IS NULL OR sum.control_status = $3)
      ORDER BY wc.controlled_at DESC
      LIMIT $4`,
    [filters.runId, filters.fillingOperationId, filters.status, filters.limit],
  );
  return result.rows;
}

export type WeightSampleRow = Readonly<{
  id: string;
  sampleNumber: number;
  measuredWeightG: string;
  status: string;
  deviationG: string;
  recordStatus: string;
  cancellationReason: string | null;
}>;

export async function weightControlDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{ control: WeightControlRow; samples: readonly WeightSampleRow[] }> | null> {
  const controlResult = await pool.query<WeightControlRow>(`${WEIGHT_CONTROL_QUERY} WHERE wc.id = $1`, [
    id,
  ]);
  const control = controlResult.rows[0];
  if (!control) {
    return null;
  }
  const samples = await pool.query<WeightSampleRow>(
    `SELECT id AS "id", sample_number AS "sampleNumber", measured_weight_g::text AS "measuredWeightG",
            status AS "status", deviation_g::text AS "deviationG", record_status AS "recordStatus",
            cancellation_reason AS "cancellationReason"
       FROM filling_weight_samples
      WHERE weight_control_id = $1
      ORDER BY sample_number, created_at`,
    [id],
  );
  return { control, samples: samples.rows };
}

export type SeamingOperationRow = Readonly<{
  id: string;
  operationCode: string;
  productionRunId: string;
  runCode: string;
  machineCode: string | null;
  startedAt: string;
  endedAt: string | null;
  status: string;
  lastControlAt: string | null;
  lastControlResult: string | null;
}>;

export async function listSeamingOperations(
  pool: pg.Pool,
  filters: Readonly<{ runId: string | null; status: string | null; limit: number }>,
): Promise<readonly SeamingOperationRow[]> {
  const result = await pool.query<SeamingOperationRow>(
    `SELECT so.id AS "id", so.operation_code AS "operationCode",
            so.production_run_id AS "productionRunId", r.run_code AS "runCode",
            eq.code AS "machineCode", so.started_at AS "startedAt", so.ended_at AS "endedAt",
            so.status AS "status",
            last_sc.controlled_at AS "lastControlAt", last_sc.result AS "lastControlResult"
       FROM seaming_operations so
       JOIN production_runs r ON r.id = so.production_run_id
       LEFT JOIN equipment eq ON eq.id = so.machine_id
       LEFT JOIN LATERAL (
             SELECT sc.controlled_at, res.result
               FROM seaming_controls sc
               JOIN seaming_control_result res ON res.seaming_control_id = sc.id
              WHERE sc.seaming_operation_id = so.id
              ORDER BY sc.controlled_at DESC LIMIT 1
       ) last_sc ON TRUE
      WHERE ($1::uuid IS NULL OR so.production_run_id = $1)
        AND ($2::text IS NULL OR so.status = $2)
      ORDER BY so.started_at DESC
      LIMIT $3`,
    [filters.runId, filters.status, filters.limit],
  );
  return result.rows;
}

export type SeamingControlRow = Readonly<{
  id: string;
  seamingOperationId: string;
  productionRunId: string;
  runCode: string;
  machineCode: string | null;
  controlledAt: string;
  controllerName: string;
  measurementCount: number;
  nonConformeCount: number;
  result: string;
}>;

const SEAMING_CONTROL_QUERY = `
  SELECT sc.id AS "id", sc.seaming_operation_id AS "seamingOperationId",
         sc.production_run_id AS "productionRunId", r.run_code AS "runCode",
         eq.code AS "machineCode", sc.controlled_at AS "controlledAt", u.full_name AS "controllerName",
         res.measurement_count AS "measurementCount", res.non_conforme_count AS "nonConformeCount",
         res.result AS "result"
    FROM seaming_controls sc
    JOIN production_runs r ON r.id = sc.production_run_id
    JOIN users u ON u.id = sc.controller_user_id
    LEFT JOIN equipment eq ON eq.id = sc.machine_id
    JOIN seaming_control_result res ON res.seaming_control_id = sc.id`;

export async function listSeamingControls(
  pool: pg.Pool,
  filters: Readonly<{ runId: string | null; seamingOperationId: string | null; limit: number }>,
): Promise<readonly SeamingControlRow[]> {
  const result = await pool.query<SeamingControlRow>(
    `${SEAMING_CONTROL_QUERY}
      WHERE ($1::uuid IS NULL OR sc.production_run_id = $1)
        AND ($2::uuid IS NULL OR sc.seaming_operation_id = $2)
      ORDER BY sc.controlled_at DESC
      LIMIT $3`,
    [filters.runId, filters.seamingOperationId, filters.limit],
  );
  return result.rows;
}

export type SeamingMeasurementRow = Readonly<{
  id: string;
  parameterName: string;
  sampleNumber: number | null;
  measuredValue: string;
  unit: string;
  minValueSnapshot: string | null;
  maxValueSnapshot: string | null;
  status: string | null;
  recordStatus: string;
}>;

export async function seamingControlDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{
  control: SeamingControlRow;
  measurements: readonly SeamingMeasurementRow[];
}> | null> {
  const controlResult = await pool.query<SeamingControlRow>(
    `${SEAMING_CONTROL_QUERY} WHERE sc.id = $1`,
    [id],
  );
  const control = controlResult.rows[0];
  if (!control) {
    return null;
  }
  const measurements = await pool.query<SeamingMeasurementRow>(
    `SELECT m.id AS "id", sp.name AS "parameterName", m.sample_number AS "sampleNumber",
            m.measured_value::text AS "measuredValue", m.unit AS "unit",
            m.min_value_snapshot::text AS "minValueSnapshot",
            m.max_value_snapshot::text AS "maxValueSnapshot", m.status AS "status",
            m.record_status AS "recordStatus"
       FROM seaming_measurements m
       JOIN seaming_parameters sp ON sp.id = m.seaming_parameter_id
      WHERE m.seaming_control_id = $1
      ORDER BY m.created_at`,
    [id],
  );
  return { control, measurements: measurements.rows };
}

export type MarkingEventRow = Readonly<{
  id: string;
  productionRunId: string;
  runCode: string;
  markedAt: string;
  markingCode: string;
  lotCodePrinted: string | null;
  machineCode: string | null;
  status: string;
  verifiedByName: string | null;
  verifiedAt: string | null;
}>;

export async function listMarkingEvents(
  pool: pg.Pool,
  filters: Readonly<{ runId: string | null; status: string | null; limit: number }>,
): Promise<readonly MarkingEventRow[]> {
  const result = await pool.query<MarkingEventRow>(
    `SELECT me.id AS "id", me.production_run_id AS "productionRunId", r.run_code AS "runCode",
            me.marked_at AS "markedAt", me.marking_code AS "markingCode",
            me.lot_code_printed AS "lotCodePrinted", eq.code AS "machineCode", me.status AS "status",
            u.full_name AS "verifiedByName", me.verified_at AS "verifiedAt"
       FROM marking_events me
       JOIN production_runs r ON r.id = me.production_run_id
       LEFT JOIN equipment eq ON eq.id = me.machine_id
       LEFT JOIN users u ON u.id = me.verified_by
      WHERE ($1::uuid IS NULL OR me.production_run_id = $1)
        AND ($2::text IS NULL OR me.status = $2)
      ORDER BY me.marked_at DESC
      LIMIT $3`,
    [filters.runId, filters.status, filters.limit],
  );
  return result.rows;
}

export type SterilizationCycleRow = Readonly<{
  id: string;
  cycleCode: string;
  autoclaveCode: string;
  programCode: string;
  programName: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  measurementCount: number;
  maxF0Value: string | null;
  openDeviationCount: number;
  latestCcpResult: string | null;
  latestCcpDecision: string | null;
  runCodes: readonly string[];
}>;

const STERILIZATION_CYCLE_QUERY = `
  SELECT cy.id AS "id", cy.cycle_code AS "cycleCode", ac.code AS "autoclaveCode",
         pr.code AS "programCode", pr.name AS "programName", cy.started_at AS "startedAt",
         cy.ended_at AS "endedAt", cy.status AS "status",
         sum.measurement_count AS "measurementCount", sum.max_f0_value::text AS "maxF0Value",
         sum.open_deviation_count AS "openDeviationCount",
         ccp.latest_result AS "latestCcpResult", ccp.latest_decision AS "latestCcpDecision",
         COALESCE(loads.run_codes, ARRAY[]::text[]) AS "runCodes"
    FROM sterilization_cycles cy
    JOIN equipment ac ON ac.id = cy.autoclave_id
    JOIN sterilization_programs pr ON pr.id = cy.sterilization_program_id
    JOIN sterilization_cycle_summary sum ON sum.sterilization_cycle_id = cy.id
    LEFT JOIN sterilization_cycle_ccp_status ccp ON ccp.sterilization_cycle_id = cy.id
    LEFT JOIN LATERAL (
          SELECT array_agg(r.run_code ORDER BY r.run_code) AS run_codes
            FROM sterilization_cycle_loads scl
            JOIN production_runs r ON r.id = scl.production_run_id
           WHERE scl.sterilization_cycle_id = cy.id
    ) loads ON TRUE`;

export async function listSterilizationCycles(
  pool: pg.Pool,
  filters: Readonly<{
    autoclaveId: string | null;
    runId: string | null;
    status: string | null;
    limit: number;
  }>,
): Promise<readonly SterilizationCycleRow[]> {
  const result = await pool.query<SterilizationCycleRow>(
    `${STERILIZATION_CYCLE_QUERY}
      WHERE ($1::uuid IS NULL OR cy.autoclave_id = $1)
        AND ($2::text IS NULL OR cy.status = $2)
        AND ($3::uuid IS NULL OR EXISTS (
              SELECT 1 FROM sterilization_cycle_loads scl2
               WHERE scl2.sterilization_cycle_id = cy.id AND scl2.production_run_id = $3))
      ORDER BY cy.started_at DESC
      LIMIT $4`,
    [filters.autoclaveId, filters.status, filters.runId, filters.limit],
  );
  return result.rows;
}

export type CycleLoadRow = Readonly<{
  id: string;
  productionRunId: string;
  runCode: string;
  quantityUnits: number | null;
  basketReference: string | null;
}>;

export type CycleMeasurementRow = Readonly<{
  id: string;
  measuredAt: string;
  temperatureC: string | null;
  pressureBar: string | null;
  f0Value: string | null;
  phase: string | null;
  sourceType: string;
  recordStatus: string;
}>;

export type CcpControlRow = Readonly<{
  id: string;
  controlledAt: string;
  ccpType: string;
  result: string;
  decision: string;
  controllerName: string;
  notes: string | null;
  recordStatus: string;
}>;

export type CoolingEventRow = Readonly<{
  id: string;
  startedAt: string;
  endedAt: string | null;
  coolingMethod: string | null;
  waterTemperatureC: string | null;
  finalProductTemperatureC: string | null;
  result: string | null;
}>;

export type CycleDeviationRow = Readonly<{
  id: string;
  deviationCode: string;
  severity: string;
  status: string;
  description: string;
}>;

export async function sterilizationCycleDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{
  cycle: SterilizationCycleRow;
  loads: readonly CycleLoadRow[];
  measurements: readonly CycleMeasurementRow[];
  ccpControls: readonly CcpControlRow[];
  cooling: readonly CoolingEventRow[];
  deviations: readonly CycleDeviationRow[];
}> | null> {
  const cycleResult = await pool.query<SterilizationCycleRow>(
    `${STERILIZATION_CYCLE_QUERY} WHERE cy.id = $1`,
    [id],
  );
  const cycle = cycleResult.rows[0];
  if (!cycle) {
    return null;
  }
  const [loads, measurements, ccpControls, cooling, deviations] = await Promise.all([
    pool.query<CycleLoadRow>(
      `SELECT scl.id AS "id", scl.production_run_id AS "productionRunId", r.run_code AS "runCode",
              scl.quantity_units AS "quantityUnits", scl.basket_reference AS "basketReference"
         FROM sterilization_cycle_loads scl
         JOIN production_runs r ON r.id = scl.production_run_id
        WHERE scl.sterilization_cycle_id = $1
        ORDER BY r.run_code`,
      [id],
    ),
    pool.query<CycleMeasurementRow>(
      `SELECT id AS "id", measured_at AS "measuredAt", temperature_c::text AS "temperatureC",
              pressure_bar::text AS "pressureBar", f0_value::text AS "f0Value", phase AS "phase",
              source_type AS "sourceType", record_status AS "recordStatus"
         FROM sterilization_measurements
        WHERE sterilization_cycle_id = $1
        ORDER BY measured_at`,
      [id],
    ),
    pool.query<CcpControlRow>(
      `SELECT c.id AS "id", c.controlled_at AS "controlledAt", c.ccp_type AS "ccpType",
              c.result AS "result", c.decision AS "decision", u.full_name AS "controllerName",
              c.notes AS "notes", c.record_status AS "recordStatus"
         FROM ccp_controls c
         JOIN users u ON u.id = c.controller_user_id
        WHERE c.sterilization_cycle_id = $1
        ORDER BY c.controlled_at`,
      [id],
    ),
    pool.query<CoolingEventRow>(
      `SELECT id AS "id", started_at AS "startedAt", ended_at AS "endedAt",
              cooling_method AS "coolingMethod", water_temperature_c::text AS "waterTemperatureC",
              final_product_temperature_c::text AS "finalProductTemperatureC", result AS "result"
         FROM cooling_events
        WHERE sterilization_cycle_id = $1
        ORDER BY started_at`,
      [id],
    ),
    pool.query<CycleDeviationRow>(
      `SELECT id AS "id", deviation_code AS "deviationCode", severity AS "severity",
              status AS "status", description AS "description"
         FROM process_deviations
        WHERE sterilization_cycle_id = $1
        ORDER BY detected_at DESC`,
      [id],
    ),
  ]);
  return {
    cycle,
    loads: loads.rows,
    measurements: measurements.rows,
    ccpControls: ccpControls.rows,
    cooling: cooling.rows,
    deviations: deviations.rows,
  };
}

export type DeviationRow = Readonly<{
  id: string;
  deviationCode: string;
  productionRunId: string | null;
  runCode: string | null;
  sterilizationCycleId: string | null;
  cycleCode: string | null;
  processStage: string;
  detectedAt: string;
  deviationType: string;
  description: string;
  severity: string;
  status: string;
  detectedByName: string;
  openActionCount: number;
}>;

export async function listDeviations(
  pool: pg.Pool,
  filters: Readonly<{
    runId: string | null;
    sterilizationCycleId: string | null;
    status: string | null;
    limit: number;
  }>,
): Promise<readonly DeviationRow[]> {
  const result = await pool.query<DeviationRow>(
    `SELECT d.id AS "id", d.deviation_code AS "deviationCode",
            d.production_run_id AS "productionRunId", r.run_code AS "runCode",
            d.sterilization_cycle_id AS "sterilizationCycleId", cy.cycle_code AS "cycleCode",
            d.process_stage AS "processStage", d.detected_at AS "detectedAt",
            d.deviation_type AS "deviationType", d.description AS "description",
            d.severity AS "severity", d.status AS "status", u.full_name AS "detectedByName",
            COALESCE(actions.open_count, 0)::integer AS "openActionCount"
       FROM process_deviations d
       LEFT JOIN production_runs r ON r.id = d.production_run_id
       LEFT JOIN sterilization_cycles cy ON cy.id = d.sterilization_cycle_id
       JOIN users u ON u.id = d.detected_by
       LEFT JOIN LATERAL (
             SELECT COUNT(*) AS open_count FROM process_corrective_actions a
              WHERE a.process_deviation_id = d.id AND a.status NOT IN ('TERMINEE', 'ANNULEE')
       ) actions ON TRUE
      WHERE ($1::uuid IS NULL OR d.production_run_id = $1)
        AND ($2::uuid IS NULL OR d.sterilization_cycle_id = $2)
        AND ($3::text IS NULL OR d.status = $3)
      ORDER BY d.detected_at DESC
      LIMIT $4`,
    [filters.runId, filters.sterilizationCycleId, filters.status, filters.limit],
  );
  return result.rows;
}

export type CorrectiveActionRow = Readonly<{
  id: string;
  actionDescription: string;
  responsibleName: string | null;
  dueAt: string | null;
  completedAt: string | null;
  verificationNotes: string | null;
  status: string;
}>;

export async function deviationDetail(
  pool: pg.Pool,
  id: string,
): Promise<Readonly<{ deviation: DeviationRow; actions: readonly CorrectiveActionRow[] }> | null> {
  const direct = await pool.query<DeviationRow>(
    `SELECT d.id AS "id", d.deviation_code AS "deviationCode",
            d.production_run_id AS "productionRunId", r.run_code AS "runCode",
            d.sterilization_cycle_id AS "sterilizationCycleId", cy.cycle_code AS "cycleCode",
            d.process_stage AS "processStage", d.detected_at AS "detectedAt",
            d.deviation_type AS "deviationType", d.description AS "description",
            d.severity AS "severity", d.status AS "status", u.full_name AS "detectedByName",
            0::integer AS "openActionCount"
       FROM process_deviations d
       LEFT JOIN production_runs r ON r.id = d.production_run_id
       LEFT JOIN sterilization_cycles cy ON cy.id = d.sterilization_cycle_id
       JOIN users u ON u.id = d.detected_by
      WHERE d.id = $1`,
    [id],
  );
  const deviation = direct.rows[0];
  if (!deviation) {
    return null;
  }
  const actions = await pool.query<CorrectiveActionRow>(
    `SELECT a.id AS "id", a.action_description AS "actionDescription", u.full_name AS "responsibleName",
            a.due_at AS "dueAt", a.completed_at AS "completedAt", a.verification_notes AS "verificationNotes",
            a.status AS "status"
       FROM process_corrective_actions a
       LEFT JOIN users u ON u.id = a.responsible_user_id
      WHERE a.process_deviation_id = $1
      ORDER BY a.created_at`,
    [id],
  );
  return { deviation, actions: actions.rows };
}

export type RunHoldRow = Readonly<{
  id: string;
  productionRunId: string;
  runCode: string;
  heldAt: string;
  heldByName: string;
  reason: string;
  status: string;
  releasedAt: string | null;
  releasedByName: string | null;
  releaseReason: string | null;
}>;

export async function listRunHolds(
  pool: pg.Pool,
  filters: Readonly<{ runId: string | null; activeOnly: boolean; limit: number }>,
): Promise<readonly RunHoldRow[]> {
  const result = await pool.query<RunHoldRow>(
    `SELECT h.id AS "id", h.production_run_id AS "productionRunId", r.run_code AS "runCode",
            h.held_at AS "heldAt", u1.full_name AS "heldByName", h.reason AS "reason",
            h.status AS "status", h.released_at AS "releasedAt", u2.full_name AS "releasedByName",
            h.release_reason AS "releaseReason"
       FROM production_run_holds h
       JOIN production_runs r ON r.id = h.production_run_id
       JOIN users u1 ON u1.id = h.held_by
       LEFT JOIN users u2 ON u2.id = h.released_by
      WHERE ($1::uuid IS NULL OR h.production_run_id = $1)
        AND ($2::boolean IS FALSE OR h.status = 'ACTIF')
      ORDER BY h.held_at DESC
      LIMIT $3`,
    [filters.runId, filters.activeOnly, filters.limit],
  );
  return result.rows;
}

// --- Process overview and genealogy (sections 44/46/70/74) -----------------

export type RunProcessOverview = Readonly<{
  fillingStatus: string | null;
  seamingStatus: string | null;
  markingStatus: string | null;
  sterilizationStatus: string | null;
  coolingStatus: string | null;
  hasActiveHold: boolean;
}>;

/**
 * One row per stage, latest state only - the simple operational overview
 * requested by section 46, not a BPMN diagram. Each stage reads its own
 * latest record for the Run; sterilization goes through the load relation
 * since a cycle never carries a direct Run column (section 29).
 */
export async function runProcessOverview(pool: pg.Pool, runId: string): Promise<RunProcessOverview> {
  const result = await pool.query<{
    filling_status: string | null;
    seaming_status: string | null;
    marking_status: string | null;
    sterilization_status: string | null;
    cooling_status: string | null;
    has_active_hold: boolean;
  }>(
    `SELECT
        (SELECT status FROM filling_operations WHERE production_run_id = $1
          ORDER BY started_at DESC LIMIT 1) AS filling_status,
        (SELECT status FROM seaming_operations WHERE production_run_id = $1
          ORDER BY started_at DESC LIMIT 1) AS seaming_status,
        (SELECT status FROM marking_events WHERE production_run_id = $1
          ORDER BY marked_at DESC LIMIT 1) AS marking_status,
        (SELECT cy.status FROM sterilization_cycle_loads scl
           JOIN sterilization_cycles cy ON cy.id = scl.sterilization_cycle_id
          WHERE scl.production_run_id = $1
          ORDER BY cy.started_at DESC LIMIT 1) AS sterilization_status,
        (SELECT co.result FROM sterilization_cycle_loads scl
           JOIN cooling_events co ON co.sterilization_cycle_id = scl.sterilization_cycle_id
          WHERE scl.production_run_id = $1
          ORDER BY co.started_at DESC LIMIT 1) AS cooling_status,
        EXISTS (SELECT 1 FROM production_run_holds WHERE production_run_id = $1 AND status = 'ACTIF')
            AS has_active_hold`,
    [runId],
  );
  const row = result.rows[0];
  return {
    fillingStatus: row?.filling_status ?? null,
    seamingStatus: row?.seaming_status ?? null,
    markingStatus: row?.marking_status ?? null,
    sterilizationStatus: row?.sterilization_status ?? null,
    coolingStatus: row?.cooling_status ?? null,
    hasActiveHold: row?.has_active_hold ?? false,
  };
}

/**
 * Full downstream genealogy of a Run (sections 70/74): every filling
 * operation, weight control, seaming control, marking event and
 * sterilization cycle traceable back to it, without any manual linkage - the
 * caller already has the Run id, everything else follows the foreign keys.
 */
export async function runProcessGenealogy(
  pool: pg.Pool,
  runId: string,
): Promise<
  Readonly<{
    fillingOperations: readonly FillingOperationRow[];
    weightControls: readonly WeightControlRow[];
    seamingOperations: readonly SeamingOperationRow[];
    seamingControls: readonly SeamingControlRow[];
    markingEvents: readonly MarkingEventRow[];
    sterilizationCycles: readonly SterilizationCycleRow[];
    deviations: readonly DeviationRow[];
  }>
> {
  const [
    fillingOperations,
    weightControls,
    seamingOperations,
    seamingControls,
    markingEvents,
    sterilizationCycles,
    deviations,
  ] = await Promise.all([
    listFillingOperations(pool, { runId, status: null, limit: 100 }),
    listWeightControls(pool, { runId, fillingOperationId: null, status: null, limit: 100 }),
    listSeamingOperations(pool, { runId, status: null, limit: 100 }),
    listSeamingControls(pool, { runId, seamingOperationId: null, limit: 100 }),
    listMarkingEvents(pool, { runId, status: null, limit: 100 }),
    listSterilizationCycles(pool, { autoclaveId: null, runId, status: null, limit: 100 }),
    listDeviations(pool, { runId, sterilizationCycleId: null, status: null, limit: 100 }),
  ]);
  return {
    fillingOperations,
    weightControls,
    seamingOperations,
    seamingControls,
    markingEvents,
    sterilizationCycles,
    deviations,
  };
}

export type Phase4HomeSummary = Readonly<{
  weightControlsToCorrect: number;
  activeSterilizationCycles: number;
  ccpToVerify: number;
  openDeviations: number;
}>;

export async function phase4HomeSummary(pool: pg.Pool): Promise<Phase4HomeSummary> {
  const result = await pool.query<{
    weight_to_correct: string;
    active_cycles: string;
    ccp_to_verify: string;
    open_deviations: string;
  }>(
    `SELECT
        (SELECT COUNT(*) FROM filling_weight_control_summary
          WHERE control_status IN ('NON_CONFORME', 'A_CORRIGER'))::text AS weight_to_correct,
        (SELECT COUNT(*) FROM sterilization_cycles
          WHERE status IN ('EN_CHARGEMENT', 'EN_COURS', 'A_VERIFIER'))::text AS active_cycles,
        (SELECT COUNT(*) FROM sterilization_cycles cy
           JOIN sterilization_cycle_ccp_status ccp ON ccp.sterilization_cycle_id = cy.id
          WHERE cy.status <> 'ANNULE'
            AND (ccp.ccp_control_count = 0 OR ccp.latest_result = 'A_VERIFIER'))::text AS ccp_to_verify,
        (SELECT COUNT(*) FROM process_deviations
          WHERE status NOT IN ('CLOTUREE', 'ANNULEE'))::text AS open_deviations`,
  );
  const row = result.rows[0];
  return {
    weightControlsToCorrect: Number(row?.weight_to_correct ?? '0'),
    activeSterilizationCycles: Number(row?.active_cycles ?? '0'),
    ccpToVerify: Number(row?.ccp_to_verify ?? '0'),
    openDeviations: Number(row?.open_deviations ?? '0'),
  };
}
