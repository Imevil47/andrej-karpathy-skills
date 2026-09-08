import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { requireRun } from './production.ts';

// Run workforce: who is expected/present on which Run line. An employee's
// activity is never stored here — it is always read through
// production_run_line_id, which carries the Run's own activity configuration
// (section 4: the same person may combine GRATTAGE + REMPLISSAGE on one line,
// or lines may be split by activity, entirely as the Run is configured).

async function requireActiveEmployee(
  client: DatabaseClient,
  employeeId: string,
): Promise<{ id: string; employeeNumber: string; displayName: string }> {
  const result = await client.query<{
    id: string;
    employee_number: string;
    display_name: string;
  }>(
    `SELECT id, employee_number,
            COALESCE(display_name, first_name || ' ' || last_name) AS display_name
       FROM employees
      WHERE id = $1`,
    [employeeId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Employée', employeeId);
  }
  return { id: row.id, employeeNumber: row.employee_number, displayName: row.display_name };
}

async function requireActiveEmployeeByNumber(
  client: DatabaseClient,
  employeeNumber: string,
): Promise<{ id: string; employeeNumber: string; displayName: string; isActive: boolean }> {
  const result = await client.query<{
    id: string;
    employee_number: string;
    display_name: string;
    is_active: boolean;
  }>(
    `SELECT id, employee_number,
            COALESCE(display_name, first_name || ' ' || last_name) AS display_name, is_active
       FROM employees
      WHERE upper(employee_number) = upper($1)`,
    [employeeNumber],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Matricule', employeeNumber);
  }
  return {
    id: row.id,
    employeeNumber: row.employee_number,
    displayName: row.display_name,
    isActive: row.is_active,
  };
}

async function requireRunLine(
  client: DatabaseClient,
  runId: string,
  runLineId: string,
): Promise<{ id: string; activityType: string; lineName: string; isActiveForRun: boolean }> {
  const result = await client.query<{
    id: string;
    activity_type: string;
    line_name: string;
    is_active_for_run: boolean;
  }>(
    `SELECT rl.id, rl.activity_type, l.name AS line_name, rl.is_active_for_run
       FROM production_run_lines rl
       JOIN production_lines l ON l.id = rl.production_line_id
      WHERE rl.id = $1 AND rl.production_run_id = $2`,
    [runLineId, runId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Ligne du Run', runLineId);
  }
  return {
    id: row.id,
    activityType: row.activity_type,
    lineName: row.line_name,
    isActiveForRun: row.is_active_for_run,
  };
}

export type AssignEmployeeInput = Readonly<{
  productionRunLineId: string;
  employeeId: string;
  isPresent: boolean;
}>;

/**
 * Assigns an employee to a Run line. If the employee already has an open
 * assignment elsewhere on this Run, it is closed first: history is preserved,
 * never overwritten (section 50). A single call therefore covers both the
 * first assignment and a later reassignment between lines.
 */
export async function assignEmployeeToLine(
  pool: pg.Pool,
  runId: string,
  input: AssignEmployeeInput,
  actorId: string,
): Promise<{ id: string }> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, runId);
    const runLine = await requireRunLine(client, run.id, input.productionRunLineId);
    if (!runLine.isActiveForRun || runLine.activityType === 'INACTIVE') {
      throw validationError(`La ligne ${runLine.lineName} n'est pas active pour ce Run.`, {
        runLineId: input.productionRunLineId,
      });
    }
    const employee = await requireActiveEmployee(client, input.employeeId);

    const open = await client.query<{ id: string; production_run_line_id: string }>(
      `SELECT id, production_run_line_id FROM production_run_employee_assignments
        WHERE production_run_id = $1 AND employee_id = $2 AND assigned_until IS NULL`,
      [run.id, employee.id],
    );
    const previous = open.rows[0];
    if (previous && previous.production_run_line_id === runLine.id) {
      // Already assigned to this exact line: nothing to close or reopen.
      return { id: previous.id };
    }
    if (previous) {
      await client.query(
        'UPDATE production_run_employee_assignments SET assigned_until = now(), updated_at = now() WHERE id = $1',
        [previous.id],
      );
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO production_run_employee_assignments (production_run_id, production_run_line_id,
                                                         employee_id, is_present, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [run.id, runLine.id, employee.id, input.isPresent, actorId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'affectation n'a pas pu être enregistrée.");
    }

    await recordAudit(client, {
      userId: actorId,
      action: previous ? 'WORKFORCE_REAFFECTATION' : 'WORKFORCE_AFFECTATION',
      entityType: 'production_run_employee_assignments',
      entityId: id,
      oldValues: previous ? { productionRunLineId: previous.production_run_line_id } : null,
      newValues: {
        runCode: run.runCode,
        employeeNumber: employee.employeeNumber,
        productionRunLineId: runLine.id,
      },
      context: null,
    });

    return { id };
  });
}

/**
 * Toggles presence on an existing assignment. Presence is current state, not
 * a ledger, but every meaningful change is audited (section 27).
 */
export async function setPresence(
  pool: pg.Pool,
  assignmentId: string,
  isPresent: boolean,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const updated = await client.query<{
      is_present: boolean;
      employee_id: string;
      production_run_id: string;
    }>(
      `UPDATE production_run_employee_assignments
          SET is_present = $2, updated_at = now()
        WHERE id = $1 AND assigned_until IS NULL
        RETURNING is_present, employee_id, production_run_id`,
      [assignmentId, isPresent],
    );
    const row = updated.rows[0];
    if (!row) {
      throw notFoundError('Affectation', assignmentId);
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'WORKFORCE_PRESENCE',
      entityType: 'production_run_employee_assignments',
      entityId: assignmentId,
      oldValues: null,
      newValues: { isPresent },
      context: { employeeId: row.employee_id, runId: row.production_run_id },
    });
  });
}

export type RunWorkforceRow = Readonly<{
  assignmentId: string;
  productionRunLineId: string;
  lineCode: string;
  lineName: string;
  activityType: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  isPresent: boolean;
  assignedFrom: Date;
}>;

/** Current (open) workforce of a Run, optionally scoped to one line. */
export async function listRunWorkforce(
  pool: pg.Pool,
  runId: string,
  runLineId: string | null,
): Promise<readonly RunWorkforceRow[]> {
  const result = await pool.query<RunWorkforceRow>(
    `SELECT a.id AS "assignmentId",
            rl.id AS "productionRunLineId",
            l.code AS "lineCode",
            l.name AS "lineName",
            rl.activity_type AS "activityType",
            e.id AS "employeeId",
            e.employee_number AS "employeeNumber",
            COALESCE(e.display_name, e.first_name || ' ' || e.last_name) AS "employeeName",
            a.is_present AS "isPresent",
            a.assigned_from AS "assignedFrom"
       FROM production_run_employee_assignments a
       JOIN production_run_lines rl ON rl.id = a.production_run_line_id
       JOIN production_lines l ON l.id = rl.production_line_id
       JOIN employees e ON e.id = a.employee_id
      WHERE a.production_run_id = $1
        AND a.assigned_until IS NULL
        AND ($2::uuid IS NULL OR a.production_run_line_id = $2)
      ORDER BY l.display_order, l.code, e.employee_number`,
    [runId, runLineId],
  );
  return result.rows;
}

/** Snapshot count used when opening a line for control (section 8 and 11). */
export async function presentEmployeeCount(
  client: DatabaseClient,
  runLineId: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM production_run_employee_assignments
      WHERE production_run_line_id = $1 AND assigned_until IS NULL AND is_present = TRUE`,
    [runLineId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

export { requireActiveEmployeeByNumber, requireRunLine };
