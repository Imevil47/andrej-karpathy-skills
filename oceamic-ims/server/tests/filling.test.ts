import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  correctWeightSample,
  createFillingOperation,
  recordWeightSample,
  startWeightControl,
} from '../src/services/filling.ts';
import { createRun, startRun } from '../src/services/production.ts';
import { weightControlDetail } from '../src/services/processQueries.ts';
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

async function newFillingOperation(): Promise<string> {
  const runId = await newRun();
  const operation = await createFillingOperation(
    context.pool,
    {
      productionRunId: runId,
      productionLineId: context.fixtures.lineL1Id,
      format: 'CLUB',
      piecesPerCan: null,
      fillingMediumId: context.fixtures.fillingMediumId,
      notes: null,
    },
    context.fixtures.users.PRODUCTION,
  );
  return operation.id;
}

describe('Remplissage et contrôle poids', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it('un remplissage est toujours rattaché à un Run existant', async () => {
    const operationId = await newFillingOperation();
    const operation = await context.pool.query(
      'SELECT production_run_id FROM filling_operations WHERE id = $1',
      [operationId],
    );
    assert.ok(operation.rows[0]?.production_run_id);
  });

  it('classe automatiquement chaque pesée : sous-poids, conforme, surpoids (min 120 / max 130)', async () => {
    const operationId = await newFillingOperation();
    const control = await startWeightControl(
      context.pool,
      operationId,
      { sampleSize: 3, controlledAt: new Date() },
      context.fixtures.users.QUALITE,
    );
    const underweight = await recordWeightSample(
      context.pool,
      control.id,
      { sampleNumber: 1, measuredWeightG: '119' },
      context.fixtures.users.QUALITE,
    );
    assert.equal(underweight.status, 'SOUS_POIDS');
    const conforme = await recordWeightSample(
      context.pool,
      control.id,
      { sampleNumber: 2, measuredWeightG: '125' },
      context.fixtures.users.QUALITE,
    );
    assert.equal(conforme.status, 'CONFORME');
    const overweight = await recordWeightSample(
      context.pool,
      control.id,
      { sampleNumber: 3, measuredWeightG: '131' },
      context.fixtures.users.QUALITE,
    );
    assert.equal(overweight.status, 'SURPOIDS');
  });

  it('un contrôle à 20 boîtes calcule correctement moyenne, min, max et les répartitions', async () => {
    const operationId = await newFillingOperation();
    const control = await startWeightControl(
      context.pool,
      operationId,
      { sampleSize: 20, controlledAt: new Date() },
      context.fixtures.users.QUALITE,
    );
    const weights = [
      118, 119, 121, 122, 123, 124, 125, 125, 126, 126, 127, 127, 128, 128, 129, 129, 124, 123, 122, 132,
    ];
    let last;
    for (const [index, weight] of weights.entries()) {
      last = await recordWeightSample(
        context.pool,
        control.id,
        { sampleNumber: index + 1, measuredWeightG: weight.toFixed(2) },
        context.fixtures.users.QUALITE,
      );
    }
    assert.equal(last?.summary.sampleCount, 20);
    assert.equal(last?.summary.underweightCount, 2);
    assert.equal(last?.summary.conformeCount, 17);
    assert.equal(last?.summary.overweightCount, 1);
    assert.equal(last?.summary.controlStatus, 'NON_CONFORME');
  });

  it("un contrôle incomplet (18 échantillons sur 20) n'est jamais silencieusement complété", async () => {
    const operationId = await newFillingOperation();
    const control = await startWeightControl(
      context.pool,
      operationId,
      { sampleSize: 20, controlledAt: new Date() },
      context.fixtures.users.QUALITE,
    );
    let last;
    for (let index = 0; index < 18; index += 1) {
      last = await recordWeightSample(
        context.pool,
        control.id,
        { sampleNumber: index + 1, measuredWeightG: '125' },
        context.fixtures.users.QUALITE,
      );
    }
    assert.equal(last?.summary.sampleCount, 18);
    assert.equal(last?.summary.controlStatus, 'INCOMPLET');
  });

  it('une boîte déjà enregistrée pour ce contrôle est rejetée', async () => {
    const operationId = await newFillingOperation();
    const control = await startWeightControl(
      context.pool,
      operationId,
      { sampleSize: 2, controlledAt: new Date() },
      context.fixtures.users.QUALITE,
    );
    await recordWeightSample(
      context.pool,
      control.id,
      { sampleNumber: 1, measuredWeightG: '125' },
      context.fixtures.users.QUALITE,
    );
    await assert.rejects(
      recordWeightSample(
        context.pool,
        control.id,
        { sampleNumber: 1, measuredWeightG: '126' },
        context.fixtures.users.QUALITE,
      ),
      /déjà enregistrée/,
    );
  });

  it('une pesée validée est corrigée par annulation et remplacement, jamais réécrite', async () => {
    const operationId = await newFillingOperation();
    const control = await startWeightControl(
      context.pool,
      operationId,
      { sampleSize: 1, controlledAt: new Date() },
      context.fixtures.users.QUALITE,
    );
    const original = await recordWeightSample(
      context.pool,
      control.id,
      { sampleNumber: 1, measuredWeightG: '119' },
      context.fixtures.users.QUALITE,
    );
    assert.equal(original.status, 'SOUS_POIDS');

    const correction = await correctWeightSample(
      context.pool,
      original.id,
      '125',
      'Erreur de lecture de la balance',
      context.fixtures.users.QUALITE,
    );
    assert.equal(correction.cancelledId, original.id);
    assert.ok(correction.replacementId);

    const detail = await weightControlDetail(context.pool, control.id);
    const cancelled = detail?.samples.find((sample) => sample.id === original.id);
    const replacement = detail?.samples.find((sample) => sample.id === correction.replacementId);
    assert.equal(cancelled?.recordStatus, 'ANNULE');
    assert.equal(replacement?.status, 'CONFORME');
    assert.equal(detail?.control.sampleCount, 1);
  });

  // Runs last: it mutates the shared fixture's filling specification, which
  // would otherwise change the classification every other test in this file
  // relies on.
  it('la spécification appliquée reste figée même après un changement ultérieur', async () => {
    const operationId = await newFillingOperation();
    const control = await startWeightControl(
      context.pool,
      operationId,
      { sampleSize: 1, controlledAt: new Date() },
      context.fixtures.users.QUALITE,
    );
    await recordWeightSample(
      context.pool,
      control.id,
      { sampleNumber: 1, measuredWeightG: '125' },
      context.fixtures.users.QUALITE,
    );

    // The specification changes: 130 / 140 instead of 120 / 130.
    await context.pool.query(
      'UPDATE product_filling_specs SET min_weight_g = 130, max_weight_g = 140 WHERE id = $1',
      [context.fixtures.fillingSpecId],
    );

    const detail = await weightControlDetail(context.pool, control.id);
    assert.equal(detail?.control.minWeightGSnapshot, '120.00');
    assert.equal(detail?.control.maxWeightGSnapshot, '130.00');
    assert.equal(detail?.samples[0]?.status, 'CONFORME');
  });
});
