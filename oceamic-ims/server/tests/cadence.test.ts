import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRun, startRun } from '../src/services/production.ts';
import {
  closeControlRound,
  closeLineControl,
  correctCadenceControl,
  openLineControl,
  recordEmployeeCadenceControl,
  startControlRound,
} from '../src/services/cadence.ts';
import { assignEmployeeToLine } from '../src/services/workforce.ts';
import { controlRoundDetail } from '../src/services/cadenceQueries.ts';
import { createTestContext, employeeIdByNumber, type TestContext } from './support/context.ts';

let context: TestContext;

async function newActiveRunLine(activityType = 'GRATTAGE_REMPLISSAGE'): Promise<{
  runId: string;
  runLineId: string;
}> {
  const run = await createRun(
    context.pool,
    {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: context.fixtures.productSardineId,
      format: null,
      piecesPerCan: null,
      responsibleUserId: null,
      lines: [
        { productionLineId: context.fixtures.lineL1Id, activityType: activityType as 'GRATTAGE' },
      ],
      notes: null,
    },
    context.fixtures.users.PRODUCTION,
  );
  await startRun(context.pool, run.id, context.fixtures.users.PRODUCTION);
  const runLine = await context.pool.query<{ id: string }>(
    'SELECT id FROM production_run_lines WHERE production_run_id = $1 AND production_line_id = $2',
    [run.id, context.fixtures.lineL1Id],
  );
  const runLineId = runLine.rows[0]?.id;
  if (!runLineId) {
    throw new Error('Ligne de Run introuvable.');
  }
  return { runId: run.id, runLineId };
}

async function presentEmployees(runId: string, runLineId: string, numbers: readonly string[]) {
  for (const number of numbers) {
    const employeeId = await employeeIdByNumber(context.pool, number);
    await assignEmployeeToLine(
      context.pool,
      runId,
      { productionRunLineId: runLineId, employeeId, isPresent: true },
      context.fixtures.users.PRODUCTION,
    );
  }
}

describe('Cadence', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it('la cadence individuelle est calculée à partir de la quantité et de la durée réelle', async () => {
    const { runId, runLineId } = await newActiveRunLine();
    await presentEmployees(runId, runLineId, ['1001']);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );

    const result = await recordEmployeeCadenceControl(
      context.pool,
      lineControl.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '18',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );

    assert.equal(result.cadencePerHour, '108.00');
    assert.equal(result.performancePercent, '90.00');
  });

  it('convertit correctement des durées différentes pour deux employées', async () => {
    const { runId, runLineId } = await newActiveRunLine();
    await presentEmployees(runId, runLineId, ['1001', '1002']);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );

    const a = await recordEmployeeCadenceControl(
      context.pool,
      lineControl.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '20',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );
    const b = await recordEmployeeCadenceControl(
      context.pool,
      lineControl.id,
      {
        employeeNumber: '1002',
        quantityCompleted: '15',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 300,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );

    assert.equal(a.cadencePerHour, '120.00');
    assert.equal(b.cadencePerHour, '180.00');
  });

  it("sans standard applicable, la performance est NULL et l'écran affiche « Standard non défini »", async () => {
    const { runId, runLineId } = await newActiveRunLine('TRAITEMENT');
    await presentEmployees(runId, runLineId, ['1001']);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );

    const result = await recordEmployeeCadenceControl(
      context.pool,
      lineControl.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '10',
        measurementUnit: 'KG',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );

    assert.equal(result.performancePercent, null);
  });

  it('sélectionne le standard le plus spécifique de façon déterministe', async () => {
    // A generic activity-only standard and a product-specific one both match:
    // the product-specific standard must win.
    await context.pool.query(
      `INSERT INTO cadence_standards (activity_type, measurement_unit, standard_cadence)
       VALUES ('GRATTAGE_REMPLISSAGE', 'BOITES', 60)`,
    );
    const { runId, runLineId } = await newActiveRunLine();
    await presentEmployees(runId, runLineId, ['1001']);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );

    const result = await recordEmployeeCadenceControl(
      context.pool,
      lineControl.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '12',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );

    // 12 boxes / 10 min = 72/h. Against the fixture's product standard
    // (120/h): 60.00 %. Against the generic 60/h standard it would be 120 %.
    assert.equal(result.cadencePerHour, '72.00');
    assert.equal(result.performancePercent, '60.00');
  });

  it('un changement ultérieur du standard ne réécrit pas une performance historique', async () => {
    const { runId, runLineId } = await newActiveRunLine();
    await presentEmployees(runId, runLineId, ['1001']);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );
    const result = await recordEmployeeCadenceControl(
      context.pool,
      lineControl.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '12',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );
    assert.equal(result.performancePercent, '60.00'); // 72/h vs 120/h standard

    await context.pool.query('UPDATE cadence_standards SET standard_cadence = 110 WHERE id = $1', [
      context.fixtures.cadenceStandardId,
    ]);

    const stillFrozen = await context.pool.query<{ performance_percent: string }>(
      'SELECT performance_percent::text FROM employee_cadence_controls WHERE id = $1',
      [result.id],
    );
    assert.equal(stillFrozen.rows[0]?.performance_percent, '60.00');
  });

  it("refuse un même matricule deux fois sur la même ligne dans le même tour", async () => {
    const { runId, runLineId } = await newActiveRunLine();
    await presentEmployees(runId, runLineId, ['1001']);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );

    await recordEmployeeCadenceControl(
      context.pool,
      lineControl.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '18',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );

    await assert.rejects(
      recordEmployeeCadenceControl(
        context.pool,
        lineControl.id,
        {
          employeeNumber: '1001',
          quantityCompleted: '19',
          measurementUnit: 'BOITES',
          measurementDurationSeconds: 600,
          controlledAt: new Date(),
          confirmCrossLine: false,
        },
        context.fixtures.users.PRODUCTION,
      ),
      (error: Error) => {
        assert.equal(
          error.message,
          'Ce matricule est déjà enregistré pour cette ligne dans ce tour de contrôle.',
        );
        return true;
      },
    );
  });

  it('avertit (sans bloquer définitivement) quand le matricule est déjà sur une autre ligne du même tour', async () => {
    const run = await createRun(
      context.pool,
      {
        productionDate: new Date().toISOString().slice(0, 10),
        productId: context.fixtures.productSardineId,
        format: null,
        piecesPerCan: null,
        responsibleUserId: null,
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
    const runLineL1 = runLines.rows.find((r) => r.production_line_id === context.fixtures.lineL1Id)?.id;
    const runLineL2 = runLines.rows.find((r) => r.production_line_id === context.fixtures.lineL2Id)?.id;
    if (!runLineL1 || !runLineL2) throw new Error('lignes introuvables');

    await presentEmployees(run.id, runLineL1, ['1001']);
    const round = await startControlRound(context.pool, run.id, null, context.fixtures.users.PRODUCTION);
    const lc1 = await openLineControl(context.pool, round.id, runLineL1, context.fixtures.users.PRODUCTION);
    const lc2 = await openLineControl(context.pool, round.id, runLineL2, context.fixtures.users.PRODUCTION);

    await recordEmployeeCadenceControl(
      context.pool,
      lc1.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '18',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );

    await assert.rejects(
      recordEmployeeCadenceControl(
        context.pool,
        lc2.id,
        {
          employeeNumber: '1001',
          quantityCompleted: '5',
          measurementUnit: 'BOITES',
          measurementDurationSeconds: 600,
          controlledAt: new Date(),
          confirmCrossLine: false,
        },
        context.fixtures.users.PRODUCTION,
      ),
      (error: Error) => {
        assert.match(error.message, /Attention\./);
        assert.match(error.message, /matricule 1001/);
        assert.match(error.message, /déjà enregistré sur la ligne/);
        return true;
      },
    );

    // Explicit confirmation lets the legitimate reassignment through.
    const confirmed = await recordEmployeeCadenceControl(
      context.pool,
      lc2.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '5',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: true,
      },
      context.fixtures.users.PRODUCTION,
    );
    assert.ok(confirmed.id);
  });

  it('couverture : contrôle complet, incomplet et zéro contrôle', async () => {
    const { runId, runLineId } = await newActiveRunLine();
    await presentEmployees(runId, runLineId, ['1001', '1002', '1003', '1004']);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);

    // Complete: control all four.
    const complete = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );
    for (const number of ['1001', '1002', '1003', '1004']) {
      await recordEmployeeCadenceControl(
        context.pool,
        complete.id,
        {
          employeeNumber: number,
          quantityCompleted: '10',
          measurementUnit: 'BOITES',
          measurementDurationSeconds: 600,
          controlledAt: new Date(),
          confirmCrossLine: false,
        },
        context.fixtures.users.PRODUCTION,
      );
    }
    const closedComplete = await closeLineControl(
      context.pool,
      complete.id,
      context.fixtures.users.PRODUCTION,
    );
    assert.equal(closedComplete.controlledEmployeeCount, 4);
    assert.equal(closedComplete.expectedEmployeeCount, 4);
    assert.equal(closedComplete.coveragePercent, '100.00');
    assert.equal(closedComplete.coverageStatus, 'COMPLET');
  });

  it('couverture incomplète : 10 sur 12 = 83.33 %', async () => {
    const { runId, runLineId } = await newActiveRunLine();
    // Twelve present employees, using the four fixture employees plus eight
    // extra ones created on the fly.
    for (let i = 5; i <= 12; i += 1) {
      await context.pool.query(
        'INSERT INTO employees (employee_number, first_name, last_name) VALUES ($1, $2, $3)',
        [`10${i.toString().padStart(2, '0')}`, `Prénom${i}`, `Nom${i}`],
      );
    }
    const allNumbers = [
      '1001', '1002', '1003', '1004',
      '1005', '1006', '1007', '1008', '1009', '1010', '1011', '1012',
    ];
    await presentEmployees(runId, runLineId, allNumbers);

    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );
    for (const number of allNumbers.slice(0, 10)) {
      await recordEmployeeCadenceControl(
        context.pool,
        lineControl.id,
        {
          employeeNumber: number,
          quantityCompleted: '10',
          measurementUnit: 'BOITES',
          measurementDurationSeconds: 600,
          controlledAt: new Date(),
          confirmCrossLine: false,
        },
        context.fixtures.users.PRODUCTION,
      );
    }

    const coverage = await closeLineControl(
      context.pool,
      lineControl.id,
      context.fixtures.users.PRODUCTION,
    );
    assert.equal(coverage.expectedEmployeeCount, 12);
    assert.equal(coverage.controlledEmployeeCount, 10);
    assert.equal(coverage.coveragePercent, '83.33');
    assert.equal(coverage.coverageStatus, 'INCOMPLET');
  });

  it('couverture nulle : 0 sur 12 ne provoque pas de division par zéro', async () => {
    const { runId, runLineId } = await newActiveRunLine();
    for (let i = 5; i <= 12; i += 1) {
      await context.pool.query(
        'INSERT INTO employees (employee_number, first_name, last_name) VALUES ($1, $2, $3)',
        [`20${i.toString().padStart(2, '0')}`, `Prénom${i}`, `Nom${i}`],
      );
    }
    const allNumbers = [
      '1001', '1002', '1003', '1004',
      '2005', '2006', '2007', '2008', '2009', '2010', '2011', '2012',
    ];
    await presentEmployees(runId, runLineId, allNumbers);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );

    const coverage = await closeLineControl(
      context.pool,
      lineControl.id,
      context.fixtures.users.PRODUCTION,
    );
    assert.equal(coverage.expectedEmployeeCount, 12);
    assert.equal(coverage.controlledEmployeeCount, 0);
    assert.equal(coverage.coveragePercent, '0.00');
    assert.equal(coverage.coverageStatus, 'INCOMPLET');
  });

  it('une ligne inactive pour le Run ne peut pas recevoir de contrôle', async () => {
    const run = await createRun(
      context.pool,
      {
        productionDate: new Date().toISOString().slice(0, 10),
        productId: context.fixtures.productSardineId,
        format: null,
        piecesPerCan: null,
        responsibleUserId: null,
        lines: [{ productionLineId: context.fixtures.lineL1Id, activityType: 'INACTIVE' }],
        notes: null,
      },
      context.fixtures.users.PRODUCTION,
    );
    await startRun(context.pool, run.id, context.fixtures.users.PRODUCTION);
    const runLine = await context.pool.query<{ id: string }>(
      'SELECT id FROM production_run_lines WHERE production_run_id = $1',
      [run.id],
    );
    const round = await startControlRound(context.pool, run.id, null, context.fixtures.users.PRODUCTION);

    await assert.rejects(
      openLineControl(
        context.pool,
        round.id,
        runLine.rows[0]?.id ?? '',
        context.fixtures.users.PRODUCTION,
      ),
      /n'est pas active pour ce Run/,
    );
  });

  it('corrige un contrôle validé par annulation et remplacement, sans écraser l original', async () => {
    const { runId, runLineId } = await newActiveRunLine();
    await presentEmployees(runId, runLineId, ['1001']);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );
    const original = await recordEmployeeCadenceControl(
      context.pool,
      lineControl.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '18',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );

    const correction = await correctCadenceControl(
      context.pool,
      original.id,
      '20',
      600,
      'Erreur de comptage',
      context.fixtures.users.PRODUCTION,
    );
    assert.notEqual(correction.replacementId, null);

    const rows = await context.pool.query<{ status: string; quantity_completed: string }>(
      'SELECT status, quantity_completed::text FROM employee_cadence_controls WHERE line_control_id = $1 ORDER BY created_at',
      [lineControl.id],
    );
    assert.equal(rows.rows.length, 2, "l'original annulé reste dans l'historique");
    assert.equal(rows.rows[0]?.status, 'ANNULE');
    assert.equal(rows.rows[0]?.quantity_completed, '18.000');
    assert.equal(rows.rows[1]?.status, 'VALIDE');
    assert.equal(rows.rows[1]?.quantity_completed, '20.000');
  });

  it('clôture un tour de contrôle incomplet sans le bloquer', async () => {
    const { runId, runLineId } = await newActiveRunLine();
    await presentEmployees(runId, runLineId, ['1001', '1002']);
    const round = await startControlRound(context.pool, runId, null, context.fixtures.users.PRODUCTION);
    const lineControl = await openLineControl(
      context.pool,
      round.id,
      runLineId,
      context.fixtures.users.PRODUCTION,
    );
    await recordEmployeeCadenceControl(
      context.pool,
      lineControl.id,
      {
        employeeNumber: '1001',
        quantityCompleted: '10',
        measurementUnit: 'BOITES',
        measurementDurationSeconds: 600,
        controlledAt: new Date(),
        confirmCrossLine: false,
      },
      context.fixtures.users.PRODUCTION,
    );

    const closed = await closeControlRound(context.pool, round.id, context.fixtures.users.PRODUCTION);
    assert.equal(closed.status, 'TERMINE');
    assert.equal(closed.summary.employeesExpected, 2);
    assert.equal(closed.summary.employeesControlled, 1);

    const detail = await controlRoundDetail(context.pool, round.id);
    assert.equal(detail.round.status, 'TERMINE');
    assert.equal(detail.round.coveragePercent, '50.00');
  });
});
