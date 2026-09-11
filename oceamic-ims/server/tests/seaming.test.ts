import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRun, startRun } from '../src/services/production.ts';
import { seamingControlDetail } from '../src/services/processQueries.ts';
import {
  correctSeamingMeasurement,
  createSeamingControl,
  createSeamingOperation,
  recordSeamingMeasurement,
} from '../src/services/seaming.ts';
import { createTestContext, type TestContext } from './support/context.ts';

let context: TestContext;

async function newRun(): Promise<string> {
  const run = await createRun(
    context.pool,
    {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: context.fixtures.productSardineId,
      format: 'CLUB',
      piecesPerCan: null,
      responsibleUserId: null,
      lines: [{ productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' }],
      notes: null,
    },
    context.fixtures.users.PRODUCTION,
  );
  await startRun(context.pool, run.id, context.fixtures.users.PRODUCTION);
  return run.id;
}

async function newSeamingOperation(runId: string): Promise<string> {
  const operation = await createSeamingOperation(
    context.pool,
    {
      productionRunId: runId,
      fillingOperationId: null,
      machineId: context.fixtures.sertisseuse1Id,
      productionLineId: context.fixtures.lineL1Id,
      notes: null,
    },
    context.fixtures.users.PRODUCTION,
  );
  return operation.id;
}

describe('Sertissage', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it('une opération de sertissage est rattachée au Run', async () => {
    const runId = await newRun();
    const operationId = await newSeamingOperation(runId);
    const row = await context.pool.query(
      'SELECT production_run_id FROM seaming_operations WHERE id = $1',
      [operationId],
    );
    assert.equal(row.rows[0]?.production_run_id, runId);
  });

  it('une mesure est rattachée à un contrôle et compare à la spécification correspondante', async () => {
    const runId = await newRun();
    const operationId = await newSeamingOperation(runId);
    const control = await createSeamingControl(
      context.pool,
      operationId,
      { machineId: context.fixtures.sertisseuse1Id, controlledAt: new Date(), notes: null },
      context.fixtures.users.QUALITE,
    );
    const result = await recordSeamingMeasurement(
      context.pool,
      control.id,
      {
        seamingParameterId: context.fixtures.seamingParameterEpaisseurId,
        sampleNumber: 1,
        measuredValue: '0.100',
        unit: 'MM',
        productId: context.fixtures.productSardineId,
        format: 'CLUB',
      },
      context.fixtures.users.QUALITE,
    );
    assert.equal(result.status, 'CONFORME');
    assert.equal(result.summary.result, 'CONFORME');
  });

  it('une mesure hors spécification (0.115 hors 0.090-0.110) rend le contrôle NON_CONFORME', async () => {
    const runId = await newRun();
    const operationId = await newSeamingOperation(runId);
    const control = await createSeamingControl(
      context.pool,
      operationId,
      { machineId: context.fixtures.sertisseuse1Id, controlledAt: new Date(), notes: null },
      context.fixtures.users.QUALITE,
    );
    const result = await recordSeamingMeasurement(
      context.pool,
      control.id,
      {
        seamingParameterId: context.fixtures.seamingParameterEpaisseurId,
        sampleNumber: 1,
        measuredValue: '0.115',
        unit: 'MM',
        productId: context.fixtures.productSardineId,
        format: 'CLUB',
      },
      context.fixtures.users.QUALITE,
    );
    assert.equal(result.status, 'NON_CONFORME');
    assert.equal(result.summary.result, 'NON_CONFORME');

    const detail = await seamingControlDetail(context.pool, control.id);
    assert.equal(detail?.measurements[0]?.measuredValue, '0.115');
  });

  it('une mesure validée est corrigée par annulation et remplacement', async () => {
    const runId = await newRun();
    const operationId = await newSeamingOperation(runId);
    const control = await createSeamingControl(
      context.pool,
      operationId,
      { machineId: context.fixtures.sertisseuse1Id, controlledAt: new Date(), notes: null },
      context.fixtures.users.QUALITE,
    );
    const original = await recordSeamingMeasurement(
      context.pool,
      control.id,
      {
        seamingParameterId: context.fixtures.seamingParameterEpaisseurId,
        sampleNumber: 1,
        measuredValue: '0.115',
        unit: 'MM',
        productId: context.fixtures.productSardineId,
        format: 'CLUB',
      },
      context.fixtures.users.QUALITE,
    );
    const correction = await correctSeamingMeasurement(
      context.pool,
      original.id,
      '0.100',
      'Erreur de lecture',
      context.fixtures.users.QUALITE,
    );
    assert.ok(correction.replacementId);
    const detail = await seamingControlDetail(context.pool, control.id);
    const replacement = detail?.measurements.find((m) => m.id === correction.replacementId);
    assert.equal(replacement?.status, 'CONFORME');
    assert.equal(detail?.control.result, 'CONFORME');
  });

  // Runs last: it mutates the shared fixture's seaming specification, which
  // would otherwise change the classification every other test in this file
  // relies on.
  it("l'historique conserve la spécification appliquée au moment de la mesure", async () => {
    const runId = await newRun();
    const operationId = await newSeamingOperation(runId);
    const control = await createSeamingControl(
      context.pool,
      operationId,
      { machineId: context.fixtures.sertisseuse1Id, controlledAt: new Date(), notes: null },
      context.fixtures.users.QUALITE,
    );
    await recordSeamingMeasurement(
      context.pool,
      control.id,
      {
        seamingParameterId: context.fixtures.seamingParameterEpaisseurId,
        sampleNumber: 1,
        measuredValue: '0.100',
        unit: 'MM',
        productId: context.fixtures.productSardineId,
        format: 'CLUB',
      },
      context.fixtures.users.QUALITE,
    );

    await context.pool.query(
      'UPDATE seaming_specifications SET min_value = 0.200, max_value = 0.300 WHERE id = $1',
      [context.fixtures.seamingSpecEpaisseurId],
    );

    const detail = await seamingControlDetail(context.pool, control.id);
    assert.equal(detail?.measurements[0]?.minValueSnapshot, '0.090');
    assert.equal(detail?.measurements[0]?.maxValueSnapshot, '0.110');
    assert.equal(detail?.measurements[0]?.status, 'CONFORME');
  });
});
