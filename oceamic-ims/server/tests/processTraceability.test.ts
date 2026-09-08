import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createFillingOperation, recordWeightSample, startWeightControl } from '../src/services/filling.ts';
import { createMarkingEvent } from '../src/services/marking.ts';
import { createRun, startRun } from '../src/services/production.ts';
import { runProcessGenealogy, runProcessOverview } from '../src/services/processQueries.ts';
import { createSeamingControl, createSeamingOperation, recordSeamingMeasurement } from '../src/services/seaming.ts';
import { createSterilizationCycle } from '../src/services/sterilization.ts';
import { createTestContext, type TestContext } from './support/context.ts';

let context: TestContext;

describe('Traçabilité du process', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it('la généalogie complète du Run est retrouvée sans liaison manuelle', async () => {
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

    const filling = await createFillingOperation(
      context.pool,
      {
        productionRunId: run.id,
        productionLineId: context.fixtures.lineL1Id,
        format: 'CLUB',
        piecesPerCan: null,
        fillingMediumId: context.fixtures.fillingMediumId,
        notes: null,
      },
      context.fixtures.users.PRODUCTION,
    );
    const weightControl = await startWeightControl(
      context.pool,
      filling.id,
      { sampleSize: 1, controlledAt: new Date() },
      context.fixtures.users.QUALITE,
    );
    await recordWeightSample(
      context.pool,
      weightControl.id,
      { sampleNumber: 1, measuredWeightG: '125' },
      context.fixtures.users.QUALITE,
    );

    const seaming = await createSeamingOperation(
      context.pool,
      {
        productionRunId: run.id,
        fillingOperationId: filling.id,
        machineId: context.fixtures.sertisseuse1Id,
        productionLineId: context.fixtures.lineL1Id,
        notes: null,
      },
      context.fixtures.users.PRODUCTION,
    );
    const seamingControl = await createSeamingControl(
      context.pool,
      seaming.id,
      { machineId: context.fixtures.sertisseuse1Id, controlledAt: new Date(), notes: null },
      context.fixtures.users.QUALITE,
    );
    await recordSeamingMeasurement(
      context.pool,
      seamingControl.id,
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

    await createMarkingEvent(
      context.pool,
      {
        productionRunId: run.id,
        seamingOperationId: seaming.id,
        markedAt: new Date(),
        markingCode: 'MARQ-001',
        lotCodePrinted: null,
        machineId: null,
        notes: null,
      },
      context.fixtures.users.PRODUCTION,
    );

    const cycle = await createSterilizationCycle(
      context.pool,
      {
        autoclaveId: context.fixtures.autoclave1Id,
        sterilizationProgramId: context.fixtures.sterilizationProgramId,
        startedAt: new Date(),
        operatorUserId: null,
        notes: null,
        loads: [{ productionRunId: run.id, quantityUnits: null, basketReference: null, notes: null }],
      },
      context.fixtures.users.PRODUCTION,
    );

    const genealogy = await runProcessGenealogy(context.pool, run.id);
    assert.equal(genealogy.fillingOperations.length, 1);
    assert.equal(genealogy.weightControls.length, 1);
    assert.equal(genealogy.seamingOperations.length, 1);
    assert.equal(genealogy.seamingControls.length, 1);
    assert.equal(genealogy.markingEvents.length, 1);
    assert.equal(genealogy.sterilizationCycles.length, 1);
    assert.equal(genealogy.sterilizationCycles[0]?.id, cycle.id);

    const overview = await runProcessOverview(context.pool, run.id);
    assert.equal(overview.fillingStatus, 'EN_COURS');
    assert.equal(overview.seamingStatus, 'EN_COURS');
    assert.equal(overview.markingStatus, 'A_VERIFIER');
    assert.equal(overview.sterilizationStatus, 'EN_CHARGEMENT');
    assert.equal(overview.hasActiveHold, false);
  });
});
