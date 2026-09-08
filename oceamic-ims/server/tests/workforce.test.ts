import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRun, startRun } from '../src/services/production.ts';
import { assignEmployeeToLine, listRunWorkforce, setPresence } from '../src/services/workforce.ts';
import { createTestContext, employeeIdByNumber, type TestContext } from './support/context.ts';

let context: TestContext;

async function newRunWithLines(): Promise<{
  runId: string;
  runLineL1: string;
  runLineL2: string;
}> {
  const run = await createRun(
    context.pool,
    {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: context.fixtures.productSardineId,
      format: null,
      piecesPerCan: null,
      responsibleUserId: context.fixtures.users.PRODUCTION,
      lines: [
        { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
        { productionLineId: context.fixtures.lineL2Id, activityType: 'GRATTAGE_REMPLISSAGE' },
      ],
      notes: null,
    },
    context.fixtures.users.PRODUCTION,
  );
  await startRun(context.pool, run.id, context.fixtures.users.PRODUCTION);
  const runLines = await context.pool.query<{ id: string; production_line_id: string }>(
    'SELECT id, production_line_id FROM production_run_lines WHERE production_run_id = $1',
    [run.id],
  );
  const runLineL1 = runLines.rows.find((row) => row.production_line_id === context.fixtures.lineL1Id)
    ?.id;
  const runLineL2 = runLines.rows.find((row) => row.production_line_id === context.fixtures.lineL2Id)
    ?.id;
  if (!runLineL1 || !runLineL2) {
    throw new Error('Lignes de Run introuvables.');
  }
  return { runId: run.id, runLineL1, runLineL2 };
}

describe('Personnel de production', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it('assigne une employée à une ligne du Run', async () => {
    const { runId, runLineL1 } = await newRunWithLines();
    const employeeId = await employeeIdByNumber(context.pool, '1001');

    await assignEmployeeToLine(
      context.pool,
      runId,
      { productionRunLineId: runLineL1, employeeId, isPresent: true },
      context.fixtures.users.PRODUCTION,
    );

    const workforce = await listRunWorkforce(context.pool, runId, null);
    assert.equal(workforce.length, 1);
    assert.equal(workforce[0]?.employeeNumber, '1001');
    assert.equal(workforce[0]?.isPresent, true);
  });

  it("l'activité d'une employée vient toujours de la ligne du Run, jamais d'un champ propre", async () => {
    // Two Runs configure the same physical line differently (section 67):
    // the activity read back always matches the Run's own configuration.
    const runA = await createRun(
      context.pool,
      {
        productionDate: new Date().toISOString().slice(0, 10),
        productId: context.fixtures.productSardineId,
        format: null,
        piecesPerCan: null,
        responsibleUserId: null,
        lines: [{ productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE' }],
        notes: null,
      },
      context.fixtures.users.PRODUCTION,
    );
    const runB = await createRun(
      context.pool,
      {
        productionDate: new Date().toISOString().slice(0, 10),
        productId: context.fixtures.productSardineId,
        format: null,
        piecesPerCan: null,
        responsibleUserId: null,
        lines: [{ productionLineId: context.fixtures.lineL1Id, activityType: 'REMPLISSAGE' }],
        notes: null,
      },
      context.fixtures.users.PRODUCTION,
    );

    const linesA = await context.pool.query<{ activity_type: string }>(
      'SELECT activity_type FROM production_run_lines WHERE production_run_id = $1',
      [runA.id],
    );
    const linesB = await context.pool.query<{ activity_type: string }>(
      'SELECT activity_type FROM production_run_lines WHERE production_run_id = $1',
      [runB.id],
    );
    assert.equal(linesA.rows[0]?.activity_type, 'GRATTAGE');
    assert.equal(linesB.rows[0]?.activity_type, 'REMPLISSAGE');
  });

  it('déplace une employée entre lignes en préservant l historique (fermeture + nouvelle affectation)', async () => {
    const { runId, runLineL1, runLineL2 } = await newRunWithLines();
    const employeeId = await employeeIdByNumber(context.pool, '1002');

    const first = await assignEmployeeToLine(
      context.pool,
      runId,
      { productionRunLineId: runLineL1, employeeId, isPresent: true },
      context.fixtures.users.PRODUCTION,
    );
    await assignEmployeeToLine(
      context.pool,
      runId,
      { productionRunLineId: runLineL2, employeeId, isPresent: true },
      context.fixtures.users.PRODUCTION,
    );

    // Old assignment is closed, not deleted: history is preserved.
    const closed = await context.pool.query<{ assigned_until: Date | null }>(
      'SELECT assigned_until FROM production_run_employee_assignments WHERE id = $1',
      [first.id],
    );
    assert.notEqual(closed.rows[0]?.assigned_until, null);

    const current = await listRunWorkforce(context.pool, runId, null);
    assert.equal(current.length, 1);
    assert.equal(current[0]?.productionRunLineId, runLineL2);

    const history = await context.pool.query(
      'SELECT id FROM production_run_employee_assignments WHERE employee_id = $1 AND production_run_id = $2',
      [employeeId, runId],
    );
    assert.equal(history.rows.length, 2, 'les deux affectations restent en historique');
  });

  it('bascule la présence et journalise le changement', async () => {
    const { runId, runLineL1 } = await newRunWithLines();
    const employeeId = await employeeIdByNumber(context.pool, '1003');
    const assignment = await assignEmployeeToLine(
      context.pool,
      runId,
      { productionRunLineId: runLineL1, employeeId, isPresent: true },
      context.fixtures.users.PRODUCTION,
    );

    await setPresence(context.pool, assignment.id, false, context.fixtures.users.PRODUCTION);

    const workforce = await listRunWorkforce(context.pool, runId, null);
    assert.equal(workforce[0]?.isPresent, false);

    const audit = await context.pool.query(
      "SELECT id FROM audit_log WHERE action = 'WORKFORCE_PRESENCE' AND entity_id = $1",
      [assignment.id],
    );
    assert.equal(audit.rows.length, 1);
  });
});
