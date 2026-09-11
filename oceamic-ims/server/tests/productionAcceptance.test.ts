import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestContext, stockAt, type TestContext } from './support/context.ts';

// The eight Phase 2 acceptance scenarios, played through the HTTP API exactly
// as the production interface does.

let context: TestContext;
let productionCookie: string;
let stockCookie: string;
let qualityCookie: string;

async function receive(lotCode: string, quantityKg: string): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/receptions',
    headers: { cookie: stockCookie },
    payload: {
      receivedAt: new Date().toISOString(),
      lot: {
        mode: 'NOUVEAU',
        lotCode,
        speciesId: context.fixtures.speciesSardineId,
        origin: null,
        captureDate: null,
        notes: null,
      },
      supplierId: context.fixtures.supplierId,
      vesselId: null,
      tideNumber: null,
      truckRegistration: null,
      quantityKg,
      destinationLocationId: context.fixtures.oceamic2Id,
      receptionType: 'FOURNISSEUR',
      externalSourceLocationId: null,
      documentReference: null,
      notes: null,
      quickInspection: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { lotId: string }).lotId;
}

async function createRun(): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/production/runs',
    headers: { cookie: productionCookie },
    payload: {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: context.fixtures.productSardineId,
      format: null,
      piecesPerCan: null,
      responsibleUserId: null,
      lines: [
        { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE' },
        { productionLineId: context.fixtures.lineL2Id, activityType: 'REMPLISSAGE' },
      ],
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

async function consume(runId: string, lotId: string, quantityKg: string) {
  return context.app.inject({
    method: 'POST',
    url: `/api/production/runs/${runId}/consommations`,
    headers: { cookie: productionCookie },
    payload: {
      rawMaterialLotId: lotId,
      sourceLocationId: context.fixtures.oceamic2Id,
      quantityKg,
      consumedAt: new Date().toISOString(),
      notes: null,
    },
  });
}

async function balanceOf(runId: string) {
  const response = await context.app.inject({
    method: 'GET',
    url: `/api/production/runs/${runId}/bilan`,
    headers: { cookie: productionCookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as {
    inputKg: string;
    usefulKg: string;
    accountedKg: string;
    differenceKg: string;
    differencePercent: string | null;
    balanceStatus: string;
    yieldPercent: string | null;
  };
}

describe("Scénarios d'acceptation Phase 2", () => {
  before(async () => {
    context = await createTestContext();
    productionCookie = await context.login('production');
    stockCookie = await context.login('stock');
    qualityCookie = await context.login('qualite');
  });
  after(async () => {
    await context.close();
  });

  it('1. Run simple : 5 000 kg consommés, stock diminué, traçabilité établie', async () => {
    const runId = await createRun();
    const lotId = await receive('LOT-A-1', '5000.000');

    const response = await consume(runId, lotId, '5000.000');
    assert.equal(response.statusCode, 201, response.body);

    const balance = await balanceOf(runId);
    assert.equal(balance.inputKg, '5000.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '0.000');

    const situation = await context.app.inject({
      method: 'GET',
      url: `/api/lots/${lotId}/situation`,
      headers: { cookie: productionCookie },
    });
    const payload = situation.json() as {
      productionRuns: readonly { runCode: string; consumedKg: string }[];
    };
    assert.equal(payload.productionRuns.length, 1);
    assert.equal(payload.productionRuns[0]?.consumedKg, '5000.000');
  });

  it('2. Run multi-lots : entrée MP = 6 000 kg, chaque lot reste visible', async () => {
    const runId = await createRun();
    const lotA = await receive('LOT-A-2', '3000.000');
    const lotB = await receive('LOT-B-2', '2500.000');
    const lotC = await receive('LOT-C-2', '500.000');

    for (const [lotId, quantity] of [
      [lotA, '3000.000'],
      [lotB, '2500.000'],
      [lotC, '500.000'],
    ] as const) {
      const response = await consume(runId, lotId, quantity);
      assert.equal(response.statusCode, 201, response.body);
    }

    assert.equal((await balanceOf(runId)).inputKg, '6000.000');

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${runId}`,
      headers: { cookie: productionCookie },
    });
    const payload = detail.json() as { consumptions: readonly { lotCode: string }[] };
    assert.deepEqual(
      payload.consumptions.map((row) => row.lotCode).sort(),
      ['LOT-A-2', 'LOT-B-2', 'LOT-C-2'],
    );
  });

  it('3. Un lot utilisé par plusieurs Runs : stock restant 4 500 kg', async () => {
    const lotId = await receive('LOT-A-3', '10000.000');
    const firstRun = await createRun();
    const secondRun = await createRun();

    assert.equal((await consume(firstRun, lotId, '3500.000')).statusCode, 201);
    assert.equal((await consume(secondRun, lotId, '2000.000')).statusCode, 201);

    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '4500.000');

    const situation = await context.app.inject({
      method: 'GET',
      url: `/api/lots/${lotId}/situation`,
      headers: { cookie: qualityCookie },
    });
    const payload = situation.json() as {
      productionRuns: readonly { runCode: string; consumedKg: string }[];
    };
    assert.equal(payload.productionRuns.length, 2);
    assert.deepEqual(payload.productionRuns.map((row) => row.consumedKg).sort(), [
      '2000.000',
      '3500.000',
    ]);
  });

  it('4. Bilan matière : écart de 100 kg signalé comme à justifier', async () => {
    const runId = await createRun();
    const lotId = await receive('LOT-A-4', '10000.000');
    await consume(runId, lotId, '10000.000');

    const outputs = [
      { outputType: 'SORTIE_UTILE', quantityKg: '6100.000', lossReasonId: null },
      { outputType: 'SOUS_PRODUIT', quantityKg: '2500.000', lossReasonId: context.fixtures.byProductReasonId },
      { outputType: 'REWORK', quantityKg: '800.000', lossReasonId: null },
      { outputType: 'PERTE_REELLE', quantityKg: '500.000', lossReasonId: context.fixtures.lossReasonId },
    ];
    for (const entry of outputs) {
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/production/runs/${runId}/sorties`,
        headers: { cookie: productionCookie },
        payload: {
          ...entry,
          occurredAt: new Date().toISOString(),
          productionLineId: null,
          destinationStageId: null,
          destinationLocationId: null,
          reasonText: null,
          notes: null,
        },
      });
      assert.equal(response.statusCode, 201, response.body);
    }

    const balance = await balanceOf(runId);
    assert.equal(balance.accountedKg, '9900.000');
    assert.equal(balance.differenceKg, '100.000');
    assert.equal(balance.balanceStatus, 'ECART_A_JUSTIFIER');
  });

  it('5. Rendement matière = 61,00 % sur 6 100 kg de sortie utile', async () => {
    const runId = await createRun();
    const lotId = await receive('LOT-A-5', '10000.000');
    await consume(runId, lotId, '10000.000');

    await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${runId}/sorties`,
      headers: { cookie: productionCookie },
      payload: {
        outputType: 'SORTIE_UTILE',
        quantityKg: '6100.000',
        occurredAt: new Date().toISOString(),
        productionLineId: null,
        destinationStageId: null,
        destinationLocationId: null,
        lossReasonId: null,
        reasonText: null,
        notes: null,
      },
    });

    const balance = await balanceOf(runId);
    assert.equal(balance.usefulKg, '6100.000');
    assert.equal(balance.yieldPercent, '61.00');
  });

  it('6. Lot bloqué : la consommation est refusée, aucun mouvement créé', async () => {
    const runId = await createRun();
    const lotId = await receive('LOT-B-6', '5000.000');

    const blocked = await context.app.inject({
      method: 'POST',
      url: '/api/quality/decisions',
      headers: { cookie: qualityCookie },
      payload: {
        rawMaterialLotId: lotId,
        inspectionId: null,
        decisionType: 'BLOQUE',
        reason: 'Contrôle non conforme',
        notes: null,
      },
    });
    assert.equal(blocked.statusCode, 201, blocked.body);

    const response = await consume(runId, lotId, '1000.000');
    assert.equal(response.statusCode, 409);
    const body = response.json() as { code: string; message: string };
    assert.equal(body.code, 'LOT_BLOQUE');
    assert.equal(
      body.message,
      'Opération impossible.\nCe lot est bloqué par le service Qualité.',
    );

    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '5000.000');
    const movements = await context.pool.query(
      `SELECT id FROM stock_movements
        WHERE raw_material_lot_id = $1 AND movement_type = 'CONSOMMATION'`,
      [lotId],
    );
    assert.equal(movements.rows.length, 0, 'aucun mouvement de consommation créé');
    assert.equal((await balanceOf(runId)).inputKg, '0.000');
  });

  it('7. Sortie vers remplissage de 4 850 kg enregistrée une seule fois', async () => {
    const runId = await createRun();
    const lotId = await receive('LOT-A-7', '8000.000');
    await consume(runId, lotId, '8000.000');

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${runId}/sorties`,
      headers: { cookie: productionCookie },
      payload: {
        outputType: 'SORTIE_UTILE',
        quantityKg: '4850.000',
        occurredAt: new Date().toISOString(),
        productionLineId: context.fixtures.lineL2Id,
        destinationStageId: context.fixtures.fillingStageId,
        destinationLocationId: null,
        lossReasonId: null,
        reasonText: null,
        notes: 'Sortie vers remplissage',
      },
    });
    assert.equal(response.statusCode, 201, response.body);

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${runId}`,
      headers: { cookie: productionCookie },
    });
    const payload = detail.json() as {
      outputs: readonly { quantityKg: string; stageCode: string | null; outputType: string }[];
    };
    const filling = payload.outputs.filter((row) => row.stageCode === 'REMPLISSAGE');
    assert.equal(filling.length, 1, 'la quantité est enregistrée une seule fois');
    assert.equal(filling[0]?.quantityKg, '4850.000');

    // La sortie est immédiatement disponible dans le bilan matière, sans total
    // ressaisi ailleurs.
    const balance = await balanceOf(runId);
    assert.equal(balance.usefulKg, '4850.000');
  });

  it('8. Correction : 2 000 kg annulés et remplacés par 1 800 kg', async () => {
    const runId = await createRun();
    const lotId = await receive('LOT-A-8', '5000.000');
    const consumption = await consume(runId, lotId, '2000.000');
    const consumptionId = (consumption.json() as { id: string }).id;

    const correction = await context.app.inject({
      method: 'POST',
      url: `/api/production/consommations/${consumptionId}/correction`,
      headers: { cookie: productionCookie },
      payload: { correctedQuantityKg: '1800.000', reason: 'Erreur de pesée' },
    });
    assert.equal(correction.statusCode, 201, correction.body);

    const balance = await balanceOf(runId);
    assert.equal(balance.inputKg, '1800.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '3200.000');

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${runId}`,
      headers: { cookie: productionCookie },
    });
    const payload = detail.json() as {
      consumptions: readonly { quantityKg: string; status: string }[];
    };
    assert.equal(payload.consumptions.length, 2, "l'original n'est pas écrasé");
    const cancelled = payload.consumptions.find((row) => row.status === 'ANNULE');
    const active = payload.consumptions.find((row) => row.status === 'VALIDE');
    assert.equal(cancelled?.quantityKg, '2000.000');
    assert.equal(active?.quantityKg, '1800.000');

    const audit = await context.pool.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'PRODUCTION_CONSOMMATION_CORRECTION'",
    );
    assert.ok(audit.rows.length >= 1);
  });
});
