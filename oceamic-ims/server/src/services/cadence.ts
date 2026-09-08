import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, confirmationRequiredError, notFoundError, validationError } from '../errors.ts';
import { performanceStatus, type PerformanceStatus } from '../domain/types.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { requireRun } from './production.ts';
import { presentEmployeeCount, requireActiveEmployeeByNumber, requireRunLine } from './workforce.ts';

// Control round: one controller pass through the production floor for a Run.
// Everything the controller must not retype — Run, product, species, line
// activity, employee name, matched standard, timestamp — is looked up here
// from existing Run/master data, never re-entered (section 48).

export type ControlRound = Readonly<{
  id: string;
  roundCode: string;
  productionRunId: string;
  status: string;
}>;

async function requireControlRound(
  client: DatabaseClient,
  roundId: string,
): Promise<ControlRound> {
  const result = await client.query<{
    id: string;
    round_code: string;
    production_run_id: string;
    status: string;
  }>(
    'SELECT id, round_code, production_run_id, status FROM control_rounds WHERE id = $1',
    [roundId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Tour de contrôle', roundId);
  }
  return {
    id: row.id,
    roundCode: row.round_code,
    productionRunId: row.production_run_id,
    status: row.status,
  };
}

function assertRoundOpen(round: ControlRound): void {
  if (round.status !== 'EN_COURS') {
    throw conflictError(
      `Le tour de contrôle ${round.roundCode} est ${round.status === 'TERMINE' ? 'terminé' : 'annulé'} : aucune nouvelle saisie n'est possible.`,
      { roundId: round.id, status: round.status },
    );
  }
}

/** Starts a new control round for a Run. */
export async function startControlRound(
  pool: pg.Pool,
  runId: string,
  notes: string | null,
  actorId: string,
): Promise<ControlRound> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, runId);
    const roundCode = await nextOperationalCode(client, 'CTRL', new Date());
    const inserted = await client.query<{ id: string; round_code: string; status: string }>(
      `INSERT INTO control_rounds (round_code, production_run_id, controller_user_id, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, round_code, status`,
      [roundCode, run.id, actorId, notes],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Le tour de contrôle n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'CONTROL_ROUND_CREATION',
      entityType: 'control_rounds',
      entityId: row.id,
      oldValues: null,
      newValues: { roundCode, runCode: run.runCode },
      context: null,
    });
    return { id: row.id, roundCode: row.round_code, productionRunId: run.id, status: row.status };
  });
}

export type RoundSummary = Readonly<{
  linesVisited: number;
  linesCompleted: number;
  employeesExpected: number;
  employeesControlled: number;
  coveragePercent: string | null;
}>;

async function roundSummary(client: DatabaseClient, roundId: string): Promise<RoundSummary> {
  const result = await client.query<{
    lines_visited: string;
    lines_completed: string;
    employees_expected: string;
    employees_controlled: string;
    coverage_percent: string | null;
  }>(
    `SELECT lines_visited::text, lines_completed::text, employees_expected::text,
            employees_controlled::text, coverage_percent::text
       FROM control_round_summary WHERE control_round_id = $1`,
    [roundId],
  );
  const row = result.rows[0];
  return {
    linesVisited: Number(row?.lines_visited ?? '0'),
    linesCompleted: Number(row?.lines_completed ?? '0'),
    employeesExpected: Number(row?.employees_expected ?? '0'),
    employeesControlled: Number(row?.employees_controlled ?? '0'),
    coveragePercent: row?.coverage_percent ?? null,
  };
}

/**
 * Closes a control round. Coverage may be incomplete: the round still closes
 * (section 47) so a shift is never blocked, but the incomplete result is
 * preserved and returned so the interface can warn before the operator
 * confirms. Coverage never marks the underlying production quality
 * non-conforming (section 28): this is a workforce-control concept only.
 */
export async function closeControlRound(
  pool: pg.Pool,
  roundId: string,
  actorId: string,
): Promise<{ status: string; summary: RoundSummary }> {
  return withTransaction(pool, async (client) => {
    const round = await requireControlRound(client, roundId);
    assertRoundOpen(round);
    await client.query(
      "UPDATE control_rounds SET status = 'TERMINE', ended_at = now() WHERE id = $1",
      [round.id],
    );
    const summary = await roundSummary(client, round.id);
    await recordAudit(client, {
      userId: actorId,
      action: 'CONTROL_ROUND_CLOTURE',
      entityType: 'control_rounds',
      entityId: round.id,
      oldValues: { status: 'EN_COURS' },
      newValues: { status: 'TERMINE' },
      context: { ...summary },
    });
    return { status: 'TERMINE', summary };
  });
}

export async function cancelControlRound(
  pool: pg.Pool,
  roundId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const round = await requireControlRound(client, roundId);
    assertRoundOpen(round);
    await client.query(
      "UPDATE control_rounds SET status = 'ANNULE', ended_at = now(), notes = COALESCE(notes || ' — ', '') || $2 WHERE id = $1",
      [round.id, `Annulé : ${reason}`],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'CONTROL_ROUND_ANNULATION',
      entityType: 'control_rounds',
      entityId: round.id,
      oldValues: { status: 'EN_COURS' },
      newValues: { status: 'ANNULE', reason },
      context: null,
    });
  });
}

/**
 * Opens (or resumes) a line inside a round. Reselecting an already-visited
 * line returns its existing line control instead of creating a duplicate
 * (unique constraint on control_round_id + production_run_line_id).
 * expected_employee_count is snapshotted here from current presence, so a
 * later attendance change never rewrites an already-open coverage figure.
 */
export async function openLineControl(
  pool: pg.Pool,
  roundId: string,
  runLineId: string,
  actorId: string,
): Promise<{ id: string; expectedEmployeeCount: number }> {
  return withTransaction(pool, async (client) => {
    const round = await requireControlRound(client, roundId);
    assertRoundOpen(round);
    const runLine = await requireRunLine(client, round.productionRunId, runLineId);
    if (!runLine.isActiveForRun || runLine.activityType === 'INACTIVE') {
      throw validationError(`La ligne ${runLine.lineName} n'est pas active pour ce Run.`, {
        runLineId,
      });
    }

    const existing = await client.query<{ id: string; expected_employee_count: number }>(
      'SELECT id, expected_employee_count FROM line_controls WHERE control_round_id = $1 AND production_run_line_id = $2',
      [round.id, runLineId],
    );
    const found = existing.rows[0];
    if (found) {
      return { id: found.id, expectedEmployeeCount: found.expected_employee_count };
    }

    const expected = await presentEmployeeCount(client, runLineId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO line_controls (control_round_id, production_run_id, production_run_line_id,
                                  activity_type, expected_employee_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [round.id, round.productionRunId, runLineId, runLine.activityType, expected, actorId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le contrôle de ligne n'a pas pu être créé.");
    }
    return { id, expectedEmployeeCount: expected };
  });
}

export type LineControlCoverage = Readonly<{
  expectedEmployeeCount: number;
  controlledEmployeeCount: number;
  coveragePercent: string | null;
  coverageStatus: string;
}>;

async function lineControlCoverage(
  client: DatabaseClient,
  lineControlId: string,
): Promise<LineControlCoverage> {
  const result = await client.query<{
    expected_employee_count: number;
    controlled_employee_count: number;
    coverage_percent: string | null;
    coverage_status: string;
  }>(
    `SELECT expected_employee_count, controlled_employee_count, coverage_percent::text, coverage_status
       FROM line_control_coverage WHERE line_control_id = $1`,
    [lineControlId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Contrôle de ligne', lineControlId);
  }
  return {
    expectedEmployeeCount: row.expected_employee_count,
    controlledEmployeeCount: row.controlled_employee_count,
    coveragePercent: row.coverage_percent,
    coverageStatus: row.coverage_status,
  };
}

/** Finalizes one line's pass. Incomplete coverage does not block closure. */
export async function closeLineControl(
  pool: pg.Pool,
  lineControlId: string,
  actorId: string,
): Promise<LineControlCoverage> {
  return withTransaction(pool, async (client) => {
    const updated = await client.query<{ id: string }>(
      "UPDATE line_controls SET status = 'TERMINE' WHERE id = $1 AND status = 'EN_COURS' RETURNING id",
      [lineControlId],
    );
    if (!updated.rows[0]) {
      const existing = await client.query('SELECT id FROM line_controls WHERE id = $1', [
        lineControlId,
      ]);
      if (existing.rows.length === 0) {
        throw notFoundError('Contrôle de ligne', lineControlId);
      }
      throw conflictError('Ce contrôle de ligne est déjà terminé.', { lineControlId });
    }
    const coverage = await lineControlCoverage(client, lineControlId);
    await recordAudit(client, {
      userId: actorId,
      action: 'LINE_CONTROL_CLOTURE',
      entityType: 'line_controls',
      entityId: lineControlId,
      oldValues: null,
      newValues: { status: 'TERMINE' },
      context: { ...coverage },
    });
    return coverage;
  });
}

export type MatchedStandard = Readonly<{
  id: string;
  standardCadence: string;
}> | null;

/**
 * Selects the most specific active standard for the given context. Matching
 * dimensions, from most to least specific: product, species, format, pieces
 * per can — a standard scoped to a dimension the context doesn't share never
 * matches (a NULL dimension on the standard matches anything). Ties are
 * broken deterministically by the most recently created standard: never a
 * silent/random pick (section 17).
 *
 * size_grade is intentionally never supplied here: see the note on
 * cadence_standards in the migration. A standard scoped to a size grade is
 * therefore structurally excluded from every Phase 3 match.
 */
async function findMatchingStandard(
  client: DatabaseClient,
  context: Readonly<{
    speciesId: string;
    productId: string;
    activityType: string;
    format: string | null;
    piecesPerCan: number | null;
    measurementUnit: string;
    atDate: Date;
  }>,
): Promise<MatchedStandard> {
  const result = await client.query<{ id: string; standard_cadence: string }>(
    `SELECT id, standard_cadence::text
       FROM cadence_standards
      WHERE is_active = TRUE
        AND activity_type = $1
        AND measurement_unit = $2
        AND size_grade IS NULL
        AND (species_id IS NULL OR species_id = $3)
        AND (product_id IS NULL OR product_id = $4)
        AND (format IS NULL OR format = $5)
        AND (pieces_per_can IS NULL OR pieces_per_can = $6)
        AND (valid_from IS NULL OR valid_from <= $7::date)
        AND (valid_to IS NULL OR valid_to >= $7::date)
      ORDER BY
        (CASE WHEN product_id IS NOT NULL THEN 8 ELSE 0 END
         + CASE WHEN species_id IS NOT NULL THEN 4 ELSE 0 END
         + CASE WHEN format IS NOT NULL THEN 2 ELSE 0 END
         + CASE WHEN pieces_per_can IS NOT NULL THEN 1 ELSE 0 END) DESC,
        created_at DESC
      LIMIT 1`,
    [
      context.activityType,
      context.measurementUnit,
      context.speciesId,
      context.productId,
      context.format,
      context.piecesPerCan,
      context.atDate,
    ],
  );
  const row = result.rows[0];
  return row ? { id: row.id, standardCadence: row.standard_cadence } : null;
}

export type RecordCadenceInput = Readonly<{
  employeeNumber: string;
  quantityCompleted: string;
  measurementUnit: string;
  measurementDurationSeconds: number;
  controlledAt: Date;
  /** Explicit acknowledgement of the cross-line warning (section 22). */
  confirmCrossLine: boolean;
}>;

export type CadenceControlResult = Readonly<{
  id: string;
  employeeName: string;
  cadencePerHour: string;
  performancePercent: string | null;
  /**
   * CONFORME / A_SURVEILLER / SOUS_STANDARD, or null when no standard applied
   * ("Standard non défini", section 20). Computed here, once, so the
   * interface never re-implements the threshold rule (section 19).
   */
  performanceStatus: PerformanceStatus | null;
  coverage: LineControlCoverage;
}>;

/**
 * Records one employee's measured performance on an already-open line
 * control. Duplicate protection: a hard rejection when the same matricule is
 * already recorded on this exact line control (section 21 / acceptance
 * scenario 5); a confirmable warning when it is recorded on a *different*
 * line within the same round (section 22) — never a silent accept, never a
 * permanent block.
 */
export async function recordEmployeeCadenceControl(
  pool: pg.Pool,
  lineControlId: string,
  input: RecordCadenceInput,
  actorId: string,
): Promise<CadenceControlResult> {
  return withTransaction(pool, async (client) => {
    const lineControl = await client.query<{
      id: string;
      control_round_id: string;
      production_run_id: string;
      production_run_line_id: string;
      activity_type: string;
      status: string;
    }>(
      `SELECT id, control_round_id, production_run_id, production_run_line_id, activity_type, status
         FROM line_controls WHERE id = $1`,
      [lineControlId],
    );
    const line = lineControl.rows[0];
    if (!line) {
      throw notFoundError('Contrôle de ligne', lineControlId);
    }
    const round = await requireControlRound(client, line.control_round_id);
    assertRoundOpen(round);

    const employee = await requireActiveEmployeeByNumber(client, input.employeeNumber);
    if (!employee.isActive) {
      throw validationError(`Le matricule ${input.employeeNumber} est désactivé.`, {
        employeeNumber: input.employeeNumber,
      });
    }

    const duplicate = await client.query(
      "SELECT id FROM employee_cadence_controls WHERE line_control_id = $1 AND employee_id = $2 AND status = 'VALIDE'",
      [lineControlId, employee.id],
    );
    if (duplicate.rows.length > 0) {
      throw conflictError(
        'Ce matricule est déjà enregistré pour cette ligne dans ce tour de contrôle.',
        { employeeNumber: input.employeeNumber, lineControlId },
      );
    }

    if (!input.confirmCrossLine) {
      const crossLine = await client.query<{ line_code: string }>(
        `SELECT l.code AS line_code
           FROM employee_cadence_controls ecc
           JOIN production_run_lines rl ON rl.id = ecc.production_run_line_id
           JOIN production_lines l ON l.id = rl.production_line_id
          WHERE ecc.employee_id = $1
            AND ecc.status = 'VALIDE'
            AND ecc.line_control_id IN (SELECT id FROM line_controls WHERE control_round_id = $2)
            AND ecc.production_run_line_id <> $3
          LIMIT 1`,
        [employee.id, round.id, line.production_run_line_id],
      );
      const other = crossLine.rows[0];
      if (other) {
        throw confirmationRequiredError(
          `Attention.\nLe matricule ${input.employeeNumber} est déjà enregistré sur la ligne ${other.line_code} pour ce tour.`,
          { employeeNumber: input.employeeNumber, otherLineCode: other.line_code },
        );
      }
    }

    const run = await requireRun(client, line.production_run_id);
    const standard = await findMatchingStandard(client, {
      speciesId: run.speciesId,
      productId: run.productId,
      activityType: line.activity_type,
      format: null,
      piecesPerCan: null,
      measurementUnit: input.measurementUnit,
      atDate: input.controlledAt,
    });

    const inserted = await client.query<{
      id: string;
      cadence_per_hour: string;
      performance_percent: string | null;
    }>(
      `INSERT INTO employee_cadence_controls (line_control_id, production_run_id,
                                              production_run_line_id, employee_id, controlled_at,
                                              quantity_completed, measurement_unit,
                                              measurement_duration_seconds, cadence_standard_id,
                                              standard_cadence_snapshot, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, cadence_per_hour::text, performance_percent::text`,
      [
        lineControlId,
        line.production_run_id,
        line.production_run_line_id,
        employee.id,
        input.controlledAt,
        input.quantityCompleted,
        input.measurementUnit,
        input.measurementDurationSeconds,
        standard?.id ?? null,
        standard?.standardCadence ?? null,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Le contrôle de cadence n'a pas pu être enregistré.");
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'CADENCE_CONTROLE',
      entityType: 'employee_cadence_controls',
      entityId: row.id,
      oldValues: null,
      newValues: {
        employeeNumber: employee.employeeNumber,
        quantityCompleted: input.quantityCompleted,
        measurementDurationSeconds: input.measurementDurationSeconds,
        cadencePerHour: row.cadence_per_hour,
        performancePercent: row.performance_percent,
      },
      context: { runCode: run.runCode, lineControlId },
    });

    const coverage = await lineControlCoverage(client, lineControlId);
    return {
      id: row.id,
      employeeName: employee.displayName,
      cadencePerHour: row.cadence_per_hour,
      performancePercent: row.performance_percent,
      performanceStatus: performanceStatus(
        row.performance_percent === null ? null : Number(row.performance_percent),
      ),
      coverage,
    };
  });
}

/**
 * Corrects a validated cadence control: reversal-and-replace, exactly the
 * Phase 2 consumption correction policy. The original row is cancelled, never
 * edited, and a replacement is created if a corrected measurement is given.
 */
export async function correctCadenceControl(
  pool: pg.Pool,
  controlId: string,
  correctedQuantity: string | null,
  correctedDurationSeconds: number | null,
  reason: string,
  actorId: string,
): Promise<{ cancelledId: string; replacementId: string | null }> {
  return withTransaction(pool, async (client) => {
    const original = await client.query<{
      id: string;
      line_control_id: string;
      production_run_id: string;
      production_run_line_id: string;
      employee_id: string;
      controlled_at: Date;
      measurement_unit: string;
      cadence_standard_id: string | null;
      standard_cadence_snapshot: string | null;
      status: string;
    }>(
      `SELECT id, line_control_id, production_run_id, production_run_line_id, employee_id,
              controlled_at, measurement_unit, cadence_standard_id, standard_cadence_snapshot, status
         FROM employee_cadence_controls WHERE id = $1`,
      [controlId],
    );
    const row = original.rows[0];
    if (!row) {
      throw notFoundError('Contrôle de cadence', controlId);
    }
    if (row.status !== 'VALIDE') {
      throw conflictError('Ce contrôle de cadence a déjà été annulé.', { controlId });
    }

    await client.query(
      `UPDATE employee_cadence_controls
          SET status = 'ANNULE', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3
        WHERE id = $1`,
      [row.id, actorId, reason],
    );

    let replacementId: string | null = null;
    if (correctedQuantity !== null && correctedDurationSeconds !== null) {
      const replacement = await client.query<{ id: string }>(
        `INSERT INTO employee_cadence_controls (line_control_id, production_run_id,
                                                production_run_line_id, employee_id, controlled_at,
                                                quantity_completed, measurement_unit,
                                                measurement_duration_seconds, cadence_standard_id,
                                                standard_cadence_snapshot, replaces_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          row.line_control_id,
          row.production_run_id,
          row.production_run_line_id,
          row.employee_id,
          row.controlled_at,
          correctedQuantity,
          row.measurement_unit,
          correctedDurationSeconds,
          row.cadence_standard_id,
          row.standard_cadence_snapshot,
          row.id,
          `Correction du contrôle du ${row.controlled_at.toISOString()}`,
          actorId,
        ],
      );
      replacementId = replacement.rows[0]?.id ?? null;
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'CADENCE_CONTROLE_CORRECTION',
      entityType: 'employee_cadence_controls',
      entityId: row.id,
      oldValues: { status: 'VALIDE' },
      newValues: { status: 'ANNULE', reason },
      context: { replacementId },
    });

    return { cancelledId: row.id, replacementId };
  });
}
