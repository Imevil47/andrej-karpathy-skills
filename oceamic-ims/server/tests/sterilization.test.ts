import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createCorrectiveAction, createDeviation } from '../src/services/deviations.ts';
import { createRun, startRun } from '../src/services/production.ts';
import { listDeviations, listRunHolds, sterilizationCycleDetail } from '../src/services/processQueries.ts';
import {
  beginSterilizationCycle,
  closeSterilizationCycle,
  createSterilizationCycle,
  recordCcpControl,
  recordSterilizationMeasurement,
  releaseRunHold,
} from '../src/services/sterilization.ts';
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

async function newCycle(runId: string) {
  return createSterilizationCycle(
    context.pool,
    {
      autoclaveId: context.fixtures.autoclave1Id,
      sterilizationProgramId: context.fixtures.sterilizationProgramId,
      startedAt: new Date(),
      operatorUserId: context.fixtures.users.PRODUCTION,
      notes: null,
      loads: [{ productionRunId: runId, quantityUnits: 480, basketReference: 'A1', notes: null }],
    },
    context.fixtures.users.PRODUCTION,
  );
}

describe('Stérilisation, CCP et déviations', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it('un cycle est rattaché à un autoclave et à un Run via son chargement', async () => {
    const runId = await newRun();
    const cycle = await newCycle(runId);
    const detail = await sterilizationCycleDetail(context.pool, cycle.id);
    assert.equal(detail?.cycle.autoclaveCode, 'AUTOCLAVE-1');
    assert.deepEqual(detail?.loads.map((load) => load.productionRunId), [runId]);
  });

  it("un cycle exige un programme de stérilisation existant", async () => {
    const runId = await newRun();
    await assert.rejects(
      createSterilizationCycle(
        context.pool,
        {
          autoclaveId: context.fixtures.autoclave1Id,
          sterilizationProgramId: '00000000-0000-0000-0000-000000000000',
          startedAt: new Date(),
          operatorUserId: null,
          notes: null,
          loads: [{ productionRunId: runId, quantityUnits: null, basketReference: null, notes: null }],
        },
        context.fixtures.users.PRODUCTION,
      ),
    );
  });

  it("la base refuse qu'un cycle se termine avant d'avoir commencé", async () => {
    const runId = await newRun();
    const cycle = await newCycle(runId);
    await assert.rejects(
      context.pool.query(
        'UPDATE sterilization_cycles SET ended_at = started_at - interval \'1 hour\' WHERE id = $1',
        [cycle.id],
      ),
    );
  });

  it('un cycle incomplet (aucune donnée CCP) ne peut pas être clôturé normalement', async () => {
    const runId = await newRun();
    const cycle = await newCycle(runId);
    await beginSterilizationCycle(context.pool, cycle.id, context.fixtures.users.PRODUCTION);
    await recordSterilizationMeasurement(
      context.pool,
      cycle.id,
      {
        measuredAt: new Date(),
        temperatureC: '121.10',
        pressureBar: '1.80',
        f0Value: null,
        phase: 'PALIER',
        sourceType: 'MANUEL',
      },
      context.fixtures.users.PRODUCTION,
    );
    const result = await closeSterilizationCycle(context.pool, cycle.id, context.fixtures.users.PRODUCTION);
    assert.equal(result.status, 'A_VERIFIER');
    assert.equal(result.message, 'Cycle incomplet.\nDes données CCP obligatoires sont manquantes.');
  });

  it('un cycle complet avec CCP conforme se termine TERMINE et conserve ses données CCP', async () => {
    const runId = await newRun();
    const cycle = await newCycle(runId);
    await beginSterilizationCycle(context.pool, cycle.id, context.fixtures.users.PRODUCTION);
    await recordSterilizationMeasurement(
      context.pool,
      cycle.id,
      {
        measuredAt: new Date(),
        temperatureC: '121.10',
        pressureBar: '1.80',
        f0Value: '8.50',
        phase: 'PALIER',
        sourceType: 'MANUEL',
      },
      context.fixtures.users.PRODUCTION,
    );
    await recordCcpControl(
      context.pool,
      cycle.id,
      { controlledAt: new Date(), ccpType: 'F0_MINIMUM', result: 'CONFORME', decision: 'LIBERE', notes: null },
      context.fixtures.users.QUALITE,
    );
    const result = await closeSterilizationCycle(context.pool, cycle.id, context.fixtures.users.PRODUCTION);
    assert.equal(result.status, 'TERMINE');

    const detail = await sterilizationCycleDetail(context.pool, cycle.id);
    assert.equal(detail?.ccpControls.length, 1);
    assert.equal(detail?.ccpControls[0]?.decision, 'LIBERE');
  });

  it('une décision CCP RETENU ouvre une retenue sur chaque Run chargé, et le cycle se ferme BLOQUE', async () => {
    const runId = await newRun();
    const cycle = await newCycle(runId);
    await beginSterilizationCycle(context.pool, cycle.id, context.fixtures.users.PRODUCTION);
    await recordSterilizationMeasurement(
      context.pool,
      cycle.id,
      {
        measuredAt: new Date(),
        temperatureC: '118.00',
        pressureBar: '1.70',
        f0Value: '4.00',
        phase: 'PALIER',
        sourceType: 'MANUEL',
      },
      context.fixtures.users.PRODUCTION,
    );
    const ccp = await recordCcpControl(
      context.pool,
      cycle.id,
      {
        controlledAt: new Date(),
        ccpType: 'F0_MINIMUM',
        result: 'NON_CONFORME',
        decision: 'RETENU',
        notes: 'F0 mesuré sous le minimum requis.',
      },
      context.fixtures.users.QUALITE,
    );
    assert.deepEqual(ccp.heldRunIds, [runId]);

    const holds = await listRunHolds(context.pool, { runId, activeOnly: true, limit: 10 });
    assert.equal(holds.length, 1);
    assert.equal(holds[0]?.status, 'ACTIF');

    const result = await closeSterilizationCycle(context.pool, cycle.id, context.fixtures.users.PRODUCTION);
    assert.equal(result.status, 'BLOQUE');

    await releaseRunHold(context.pool, holds[0]!.id, 'Recontrôle effectué, F0 conforme', context.fixtures.users.QUALITE);
    const afterRelease = await listRunHolds(context.pool, { runId, activeOnly: true, limit: 10 });
    assert.equal(afterRelease.length, 0);
  });

  it('une déviation ouverte sur un cycle reste visible tant que non clôturée, avec ses actions correctives', async () => {
    const runId = await newRun();
    const cycle = await newCycle(runId);
    const deviation = await createDeviation(
      context.pool,
      {
        productionRunId: null,
        sterilizationCycleId: cycle.id,
        processStage: 'STERILISATION',
        detectedAt: new Date(),
        deviationType: 'ECART_TEMPERATURE',
        description: 'Température sous la consigne pendant 3 minutes.',
        severity: 'MAJEURE',
      },
      context.fixtures.users.QUALITE,
    );
    await createCorrectiveAction(
      context.pool,
      deviation.id,
      { actionDescription: 'Vérifier le capteur de température', responsibleUserId: null, dueAt: null },
      context.fixtures.users.QUALITE,
    );

    const open = await listDeviations(context.pool, {
      runId: null,
      sterilizationCycleId: cycle.id,
      status: null,
      limit: 10,
    });
    assert.equal(open.length, 1);
    assert.equal(open[0]?.status, 'ACTION_REQUISE');
    assert.equal(open[0]?.openActionCount, 1);
  });
});
