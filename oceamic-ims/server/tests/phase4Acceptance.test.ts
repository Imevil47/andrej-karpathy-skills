import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestContext, type TestContext } from './support/context.ts';

// The four Phase 4 acceptance scenarios (sections 71-74), played through the
// HTTP API exactly as the interface does.

let context: TestContext;
let productionCookie: string;
let qualiteCookie: string;

async function newRun(): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/production/runs',
    headers: { cookie: productionCookie },
    payload: {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: context.fixtures.productSardineId,
      format: 'CLUB',
      piecesPerCan: null,
      responsibleUserId: null,
      lines: [{ productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' }],
      notes: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const runId = (response.json() as { id: string }).id;
  await context.app.inject({
    method: 'POST',
    url: `/api/production/runs/${runId}/demarrage`,
    headers: { cookie: productionCookie },
  });
  return runId;
}

describe('Phase 4 — scénarios d’acceptation', () => {
  before(async () => {
    context = await createTestContext();
    productionCookie = await context.login('production');
    qualiteCookie = await context.login('qualite');
  });
  after(async () => {
    await context.close();
  });

  it('scénario remplissage/poids : 20 échantillons -> 2 sous-poids, 17 conformes, 1 surpoids, contrôle signalé', async () => {
    const runId = await newRun();
    const filling = await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${runId}/remplissage`,
      headers: { cookie: productionCookie },
      payload: {
        productionLineId: context.fixtures.lineL1Id,
        format: 'CLUB',
        piecesPerCan: null,
        fillingMediumId: context.fixtures.fillingMediumId,
        notes: null,
      },
    });
    assert.equal(filling.statusCode, 201, filling.body);
    const fillingId = (filling.json() as { id: string }).id;

    const control = await context.app.inject({
      method: 'POST',
      url: `/api/filling-operations/${fillingId}/controles-poids`,
      headers: { cookie: qualiteCookie },
      payload: { sampleSize: 20, controlledAt: new Date().toISOString() },
    });
    assert.equal(control.statusCode, 201, control.body);
    const controlId = (control.json() as { id: string }).id;

    const weights = [
      118, 119, 121, 122, 123, 124, 125, 125, 126, 126, 127, 127, 128, 128, 129, 129, 124, 123, 122, 132,
    ];
    let lastSummary: { underweightCount: number; conformeCount: number; overweightCount: number; controlStatus: string } | undefined;
    for (const [index, weight] of weights.entries()) {
      const sample = await context.app.inject({
        method: 'POST',
        url: `/api/filling-weight-controls/${controlId}/echantillons`,
        headers: { cookie: qualiteCookie },
        payload: { sampleNumber: index + 1, measuredWeightG: weight.toFixed(2) },
      });
      assert.equal(sample.statusCode, 201, sample.body);
      lastSummary = (sample.json() as { summary: typeof lastSummary }).summary;
    }

    assert.equal(lastSummary?.underweightCount, 2);
    assert.equal(lastSummary?.conformeCount, 17);
    assert.equal(lastSummary?.overweightCount, 1);
    assert.equal(lastSummary?.controlStatus, 'NON_CONFORME');
  });

  it('scénario sertissage : une mesure hors spécification rend le contrôle NON CONFORME, mesure conservée', async () => {
    const runId = await newRun();
    const seaming = await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${runId}/sertissage`,
      headers: { cookie: productionCookie },
      payload: {
        fillingOperationId: null,
        machineId: context.fixtures.sertisseuse1Id,
        productionLineId: context.fixtures.lineL1Id,
        notes: null,
      },
    });
    assert.equal(seaming.statusCode, 201, seaming.body);
    const seamingId = (seaming.json() as { id: string }).id;

    const control = await context.app.inject({
      method: 'POST',
      url: `/api/seaming-operations/${seamingId}/controles`,
      headers: { cookie: qualiteCookie },
      payload: { machineId: context.fixtures.sertisseuse1Id, controlledAt: new Date().toISOString(), notes: null },
    });
    assert.equal(control.statusCode, 201, control.body);
    const controlId = (control.json() as { id: string }).id;

    const measurement = await context.app.inject({
      method: 'POST',
      url: `/api/seaming-controls/${controlId}/mesures`,
      headers: { cookie: qualiteCookie },
      payload: {
        seamingParameterId: context.fixtures.seamingParameterEpaisseurId,
        sampleNumber: 1,
        measuredValue: '0.130',
        unit: 'MM',
        productId: context.fixtures.productSardineId,
        format: 'CLUB',
      },
    });
    assert.equal(measurement.statusCode, 201, measurement.body);
    assert.equal((measurement.json() as { status: string }).status, 'NON_CONFORME');
    assert.equal((measurement.json() as { summary: { result: string } }).summary.result, 'NON_CONFORME');

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/seaming-controls/${controlId}`,
      headers: { cookie: qualiteCookie },
    });
    const payload = detail.json() as { measurements: readonly { measuredValue: string }[] };
    assert.equal(payload.measurements[0]?.measuredValue, '0.130');
  });

  it('scénario stérilisation : programme, mesures et décision CCP enregistrés ; sans CCP, cycle à vérifier', async () => {
    const runId = await newRun();
    const cycle = await context.app.inject({
      method: 'POST',
      url: '/api/sterilization-cycles',
      headers: { cookie: productionCookie },
      payload: {
        autoclaveId: context.fixtures.autoclave1Id,
        sterilizationProgramId: context.fixtures.sterilizationProgramId,
        startedAt: new Date().toISOString(),
        operatorUserId: null,
        notes: null,
        loads: [{ productionRunId: runId, quantityUnits: 480, basketReference: 'A1', notes: null }],
      },
    });
    assert.equal(cycle.statusCode, 201, cycle.body);
    const cycleId = (cycle.json() as { id: string; cycleCode: string }).id;

    await context.app.inject({
      method: 'POST',
      url: `/api/sterilization-cycles/${cycleId}/demarrage`,
      headers: { cookie: productionCookie },
    });
    await context.app.inject({
      method: 'POST',
      url: `/api/sterilization-cycles/${cycleId}/mesures`,
      headers: { cookie: productionCookie },
      payload: {
        measuredAt: new Date().toISOString(),
        temperatureC: '121.10',
        pressureBar: '1.80',
        f0Value: '8.30',
        phase: 'PALIER',
        sourceType: 'MANUEL',
      },
    });

    // Without a CCP decision yet, closing must never release the material
    // silently: the cycle is flagged, not TERMINE.
    const closedWithoutCcp = await context.app.inject({
      method: 'POST',
      url: `/api/sterilization-cycles/${cycleId}/cloture`,
      headers: { cookie: productionCookie },
    });
    assert.equal((closedWithoutCcp.json() as { status: string }).status, 'A_VERIFIER');

    // The CCP decision resumes the cycle's ability to close normally after a
    // fresh measurement pass, matching the "à vérifier -> recontrôlé" flow.
    await context.app.inject({
      method: 'POST',
      url: `/api/sterilization-cycles/${cycleId}/ccp`,
      headers: { cookie: qualiteCookie },
      payload: {
        controlledAt: new Date().toISOString(),
        ccpType: 'F0_MINIMUM',
        result: 'CONFORME',
        decision: 'LIBERE',
        notes: null,
      },
    });
    const closedWithCcp = await context.app.inject({
      method: 'POST',
      url: `/api/sterilization-cycles/${cycleId}/cloture`,
      headers: { cookie: productionCookie },
    });
    assert.equal((closedWithCcp.json() as { status: string }).status, 'TERMINE');

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/sterilization-cycles/${cycleId}`,
      headers: { cookie: productionCookie },
    });
    const payload = detail.json() as {
      cycle: { programCode: string; runCodes: readonly string[] };
      measurements: readonly unknown[];
      ccpControls: readonly { decision: string }[];
    };
    assert.equal(payload.cycle.programCode, 'STE-TEST');
    assert.equal(payload.measurements.length, 1);
    assert.equal(payload.ccpControls[0]?.decision, 'LIBERE');
  });

  it('scénario traçabilité : depuis le Run, tout le process est visible ; depuis le cycle, le Run source est retrouvé', async () => {
    const runId = await newRun();
    await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${runId}/remplissage`,
      headers: { cookie: productionCookie },
      payload: {
        productionLineId: context.fixtures.lineL1Id,
        format: 'CLUB',
        piecesPerCan: null,
        fillingMediumId: context.fixtures.fillingMediumId,
        notes: null,
      },
    });
    const cycle = await context.app.inject({
      method: 'POST',
      url: '/api/sterilization-cycles',
      headers: { cookie: productionCookie },
      payload: {
        autoclaveId: context.fixtures.autoclave1Id,
        sterilizationProgramId: context.fixtures.sterilizationProgramId,
        startedAt: new Date().toISOString(),
        operatorUserId: null,
        notes: null,
        loads: [{ productionRunId: runId, quantityUnits: null, basketReference: null, notes: null }],
      },
    });
    const cycleId = (cycle.json() as { id: string }).id;

    const genealogy = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${runId}/genealogie`,
      headers: { cookie: productionCookie },
    });
    const payload = genealogy.json() as {
      fillingOperations: readonly unknown[];
      sterilizationCycles: readonly { id: string }[];
    };
    assert.equal(payload.fillingOperations.length, 1);
    assert.equal(payload.sterilizationCycles.length, 1);
    assert.equal(payload.sterilizationCycles[0]?.id, cycleId);

    const cycleDetail = await context.app.inject({
      method: 'GET',
      url: `/api/sterilization-cycles/${cycleId}`,
      headers: { cookie: productionCookie },
    });
    const cyclePayload = cycleDetail.json() as { loads: readonly { productionRunId: string }[] };
    assert.equal(cyclePayload.loads[0]?.productionRunId, runId);
  });
});
