import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestContext, type TestContext } from './support/context.ts';

// Phase 8 — Ingrédients : lots traçables, cuves, consommation, huile
// récupérée et bilan matière. Played through the HTTP API, mirroring the
// phase7.test.ts pattern. Covers sections 60-66's explicit test list and
// the material-balance acceptance scenario (sections 37-39/72).

let context: TestContext;
let stockCookie: string;
let productionCookie: string;
let qualiteCookie: string;

async function newActiveRun(): Promise<{ id: string }> {
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
  const id = (response.json() as { id: string }).id;
  await context.app.inject({
    method: 'POST',
    url: `/api/production/runs/${id}/demarrage`,
    headers: { cookie: productionCookie },
  });
  return { id };
}

async function newIngredientLot(lotCode: string): Promise<{ id: string; lotCode: string }> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/ingredient-lots',
    headers: { cookie: stockCookie },
    payload: {
      lotCode,
      ingredientId: context.fixtures.ingredientHuileId,
      supplierId: context.fixtures.supplierId,
      supplierLotCode: null,
      receivedAt: null,
      manufactureDate: null,
      expiryDate: null,
      notes: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string; lotCode: string };
}

async function receive(lotId: string, quantity: string): Promise<void> {
  const response = await context.app.inject({
    method: 'POST',
    url: `/api/ingredient-lots/${lotId}/reception`,
    headers: { cookie: stockCookie },
    payload: {
      destinationLocationId: context.fixtures.ingredientLocationId,
      quantity,
      unit: 'L',
      occurredAt: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function stockOf(lotId: string): Promise<string> {
  const response = await context.app.inject({
    method: 'GET',
    url: `/api/ingredient-lots/${lotId}/stock`,
    headers: { cookie: stockCookie },
  });
  assert.equal(response.statusCode, 200);
  return (response.json() as { quantity: string }).quantity;
}

async function openTankBatch(): Promise<{ id: string; batchCode: string }> {
  const response = await context.app.inject({
    method: 'POST',
    url: `/api/ingredient-tanks/${context.fixtures.ingredientTankId}/lots`,
    headers: { cookie: stockCookie },
    payload: {},
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string; batchCode: string };
}

async function feedTankBatch(tankBatchId: string, ingredientLotId: string, quantity: string): Promise<void> {
  const response = await context.app.inject({
    method: 'POST',
    url: `/api/tank-batches/${tankBatchId}/entrees`,
    headers: { cookie: stockCookie },
    payload: {
      ingredientLotId,
      sourceLocationId: context.fixtures.ingredientLocationId,
      quantity,
      unit: 'L',
      addedAt: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function consumeFromTank(runId: string, tankBatchId: string, quantity: string): Promise<void> {
  const response = await context.app.inject({
    method: 'POST',
    url: `/api/production/runs/${runId}/ingredients/consommation-cuve`,
    headers: { cookie: productionCookie },
    payload: { fillingOperationId: null, tankBatchId, quantity, unit: 'L', consumedAt: null },
  });
  assert.equal(response.statusCode, 201, response.body);
}

/** Minimal, direct packaging-output row so the can-count source of truth
 * (packaging_outputs) is real, without re-running Phase 5's own sterilization/
 * packaging pipeline tests. */
async function insertPackagingOutput(runId: string, quantityCans: number): Promise<void> {
  const batch = await context.pool.query<{ id: string }>(
    `INSERT INTO packaging_batches (batch_code, production_run_id, product_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [`PKG-TEST-${Date.now()}`, runId, context.fixtures.productSardineId, context.fixtures.users.ADMIN],
  );
  const packagingBatchId = batch.rows[0]?.id;
  const lot = await context.pool.query<{ id: string }>(
    `INSERT INTO finished_good_lots (lot_code, packaging_batch_id, production_run_id, product_id, production_date, created_by)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, $5) RETURNING id`,
    [`LOTPF-TEST-${Date.now()}`, packagingBatchId, runId, context.fixtures.productSardineId, context.fixtures.users.ADMIN],
  );
  await context.pool.query(
    `INSERT INTO packaging_outputs (packaging_batch_id, finished_good_lot_id, quantity_cans, quantity_cartons, units_per_carton, created_by)
     VALUES ($1, $2, $3, 1, $4, $5)`,
    [packagingBatchId, lot.rows[0]?.id, quantityCans, quantityCans, context.fixtures.users.ADMIN],
  );
}

describe('Phase 8 — Ingrédients : stock, cuves, consommation, récupération', () => {
  before(async () => {
    context = await createTestContext();
    stockCookie = await context.login('stock');
    productionCookie = await context.login('production');
    qualiteCookie = await context.login('qualite');
  });
  after(async () => {
    await context.close();
  });

  it('la réception alimente le stock et la consommation le diminue, jamais sous zéro (section 60)', async () => {
    const lot = await newIngredientLot('ING-TEST-001');
    await receive(lot.id, '100.000');
    assert.equal(await stockOf(lot.id), '100.000');

    const run = await newActiveRun();
    const consumption = await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${run.id}/ingredients/consommation-directe`,
      headers: { cookie: productionCookie },
      payload: {
        fillingOperationId: null,
        ingredientLotId: lot.id,
        sourceLocationId: context.fixtures.ingredientLocationId,
        quantity: '40.000',
        unit: 'L',
        consumedAt: null,
      },
    });
    assert.equal(consumption.statusCode, 201, consumption.body);
    assert.equal(await stockOf(lot.id), '60.000');

    const overdraft = await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${run.id}/ingredients/consommation-directe`,
      headers: { cookie: productionCookie },
      payload: {
        fillingOperationId: null,
        ingredientLotId: lot.id,
        sourceLocationId: context.fixtures.ingredientLocationId,
        quantity: '1000.000',
        unit: 'L',
        consumedAt: null,
      },
    });
    assert.equal(overdraft.statusCode, 409, overdraft.body);
    assert.match(overdraft.json<{ message: string }>().message, /Stock insuffisant/);
    assert.equal(await stockOf(lot.id), '60.000');
  });

  it('un lot ingrédient bloqué par la Qualité ne peut plus être consommé (section 66)', async () => {
    const lot = await newIngredientLot('ING-TEST-002');
    await receive(lot.id, '50.000');

    const block = await context.app.inject({
      method: 'POST',
      url: `/api/ingredient-lots/${lot.id}/qualite`,
      headers: { cookie: qualiteCookie },
      payload: { status: 'BLOQUE', reason: 'Contrôle en attente (test).' },
    });
    assert.equal(block.statusCode, 200, block.body);

    const run = await newActiveRun();
    const consumption = await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${run.id}/ingredients/consommation-directe`,
      headers: { cookie: productionCookie },
      payload: {
        fillingOperationId: null,
        ingredientLotId: lot.id,
        sourceLocationId: context.fixtures.ingredientLocationId,
        quantity: '10.000',
        unit: 'L',
        consumedAt: null,
      },
    });
    assert.equal(consumption.statusCode, 409, consumption.body);
    assert.match(consumption.json<{ message: string }>().message, /disponible à l'utilisation/);
  });

  it("une cuve alimentée par deux lots préserve la généalogie complète des deux lots, jamais fusionnée (sections 61/68)", async () => {
    const lotA = await newIngredientLot('ING-TEST-MIX-A');
    await receive(lotA.id, '60.000');
    const lotB = await newIngredientLot('ING-TEST-MIX-B');
    await receive(lotB.id, '40.000');

    const batch = await openTankBatch();
    await feedTankBatch(batch.id, lotA.id, '60.000');
    await feedTankBatch(batch.id, lotB.id, '40.000');

    const genealogy = await context.app.inject({
      method: 'GET',
      url: `/api/tank-batches/${batch.id}/genealogie`,
      headers: { cookie: stockCookie },
    });
    assert.equal(genealogy.statusCode, 200);
    const rows = genealogy.json<readonly { lotCode: string; quantity: string }[]>();
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.lotCode).sort(),
      ['ING-TEST-MIX-A', 'ING-TEST-MIX-B'],
    );

    const run = await newActiveRun();
    await consumeFromTank(run.id, batch.id, '30.000');

    const batches = await context.app.inject({
      method: 'GET',
      url: `/api/tank-batches?tank=${context.fixtures.ingredientTankId}`,
      headers: { cookie: stockCookie },
    });
    const batchRow = batches
      .json<readonly { id: string; totalInputQuantity: string; remainingQuantity: string }[]>()
      .find((row) => row.id === batch.id);
    assert.equal(batchRow?.totalInputQuantity, '100.000');
    assert.equal(batchRow?.remainingQuantity, '70.000');
  });

  it('la consommation par 1000 boîtes est calculée à partir des sorties de conditionnement réelles, jamais saisie (sections 17/62)', async () => {
    const lot = await newIngredientLot('ING-TEST-1000');
    await receive(lot.id, '200.000');
    const batch = await openTankBatch();
    await feedTankBatch(batch.id, lot.id, '200.000');

    const run = await newActiveRun();
    await consumeFromTank(run.id, batch.id, '50.000');

    const beforePackaging = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${run.id}/ingredients/${context.fixtures.ingredientHuileId}/consommation-1000`,
      headers: { cookie: productionCookie },
    });
    const before = beforePackaging.json<{ totalCans: number; per1000: number | null }>();
    assert.equal(before.totalCans, 0);
    assert.equal(before.per1000, null);

    await insertPackagingOutput(run.id, 2000);

    const afterPackaging = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${run.id}/ingredients/${context.fixtures.ingredientHuileId}/consommation-1000`,
      headers: { cookie: productionCookie },
    });
    const after = afterPackaging.json<{ totalQuantity: number; totalCans: number; per1000: number | null }>();
    assert.equal(after.totalQuantity, 50);
    assert.equal(after.totalCans, 2000);
    assert.equal(after.per1000, 25);
  });

  it('une huile récupérée calcule automatiquement sa date limite de réutilisation à partir de la politique configurée, jamais saisie (sections 24/26)', async () => {
    const run = await newActiveRun();
    const recoveredAt = new Date();
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/recovered-ingredients',
      headers: { cookie: productionCookie },
      payload: {
        ingredientId: context.fixtures.ingredientHuileId,
        sourceProductionRunId: run.id,
        sourceFillingOperationId: null,
        recoveredAt: recoveredAt.toISOString(),
        quantity: '15.000',
        unit: 'L',
        storageLocationId: context.fixtures.tankLocationId,
        containerId: null,
        notes: null,
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    const batch = response.json<{ reuseDeadline: string }>();
    const expectedDeadline = recoveredAt.getTime() + 48 * 60 * 60 * 1000;
    assert.ok(Math.abs(new Date(batch.reuseDeadline).getTime() - expectedDeadline) < 5000);
  });

  it("une huile récupérée expirée refuse la réutilisation avec le message exact (sections 28/63)", async () => {
    const run = await newActiveRun();
    const expiredRecoveredAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/recovered-ingredients',
      headers: { cookie: productionCookie },
      payload: {
        ingredientId: context.fixtures.ingredientHuileId,
        sourceProductionRunId: run.id,
        sourceFillingOperationId: null,
        recoveredAt: expiredRecoveredAt.toISOString(),
        quantity: '20.000',
        unit: 'L',
        storageLocationId: context.fixtures.tankLocationId,
        containerId: null,
        notes: null,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const { id: recoveredBatchId } = created.json<{ id: string }>();

    const destinationRun = await newActiveRun();
    const reuse = await context.app.inject({
      method: 'POST',
      url: `/api/recovered-ingredients/${recoveredBatchId}/reutilisation`,
      headers: { cookie: productionCookie },
      payload: {
        destinationProductionRunId: destinationRun.id,
        destinationFillingOperationId: null,
        quantity: '5.000',
        unit: 'L',
        reusedAt: null,
      },
    });
    assert.equal(reuse.statusCode, 409, reuse.body);
    assert.equal(
      reuse.json<{ message: string }>().message,
      'Réutilisation impossible.\nCette huile récupérée a dépassé la durée maximale autorisée.',
    );
  });

  it('la réutilisation partielle laisse le reste disponible ; une fois épuisée, plus rien ne peut être réutilisé (sections 30/64)', async () => {
    const sourceRun = await newActiveRun();
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/recovered-ingredients',
      headers: { cookie: productionCookie },
      payload: {
        ingredientId: context.fixtures.ingredientHuileId,
        sourceProductionRunId: sourceRun.id,
        sourceFillingOperationId: null,
        recoveredAt: new Date().toISOString(),
        quantity: '50.000',
        unit: 'L',
        storageLocationId: context.fixtures.tankLocationId,
        containerId: null,
        notes: null,
      },
    });
    const { id: recoveredBatchId } = created.json<{ id: string }>();

    const destinationRun = await newActiveRun();
    const firstReuse = await context.app.inject({
      method: 'POST',
      url: `/api/recovered-ingredients/${recoveredBatchId}/reutilisation`,
      headers: { cookie: productionCookie },
      payload: { destinationProductionRunId: destinationRun.id, destinationFillingOperationId: null, quantity: '20.000', unit: 'L', reusedAt: null },
    });
    assert.equal(firstReuse.statusCode, 201, firstReuse.body);

    const afterFirst = await context.app.inject({
      method: 'GET',
      url: `/api/recovered-ingredients?ingredient=${context.fixtures.ingredientHuileId}`,
      headers: { cookie: productionCookie },
    });
    const afterFirstRow = afterFirst
      .json<readonly { id: string; remainingQuantity: string; effectiveStatus: string }[]>()
      .find((row) => row.id === recoveredBatchId);
    assert.equal(afterFirstRow?.remainingQuantity, '30.000');
    assert.equal(afterFirstRow?.effectiveStatus, 'UTILISE_PARTIELLEMENT');

    const secondReuse = await context.app.inject({
      method: 'POST',
      url: `/api/recovered-ingredients/${recoveredBatchId}/reutilisation`,
      headers: { cookie: productionCookie },
      payload: { destinationProductionRunId: destinationRun.id, destinationFillingOperationId: null, quantity: '30.000', unit: 'L', reusedAt: null },
    });
    assert.equal(secondReuse.statusCode, 201, secondReuse.body);

    const afterSecond = await context.app.inject({
      method: 'GET',
      url: `/api/recovered-ingredients?ingredient=${context.fixtures.ingredientHuileId}`,
      headers: { cookie: productionCookie },
    });
    const afterSecondRow = afterSecond
      .json<readonly { id: string; remainingQuantity: string; effectiveStatus: string }[]>()
      .find((row) => row.id === recoveredBatchId);
    assert.equal(afterSecondRow?.remainingQuantity, '0.000');
    assert.equal(afterSecondRow?.effectiveStatus, 'EPUISE');

    const thirdReuse = await context.app.inject({
      method: 'POST',
      url: `/api/recovered-ingredients/${recoveredBatchId}/reutilisation`,
      headers: { cookie: productionCookie },
      payload: { destinationProductionRunId: destinationRun.id, destinationFillingOperationId: null, quantity: '1.000', unit: 'L', reusedAt: null },
    });
    assert.equal(thirdReuse.statusCode, 409, thirdReuse.body);
  });

  it("un lot de récupération bloqué par la Qualité n'est plus disponible à la réutilisation (section 27)", async () => {
    const sourceRun = await newActiveRun();
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/recovered-ingredients',
      headers: { cookie: productionCookie },
      payload: {
        ingredientId: context.fixtures.ingredientHuileId,
        sourceProductionRunId: sourceRun.id,
        sourceFillingOperationId: null,
        recoveredAt: new Date().toISOString(),
        quantity: '10.000',
        unit: 'L',
        storageLocationId: context.fixtures.tankLocationId,
        containerId: null,
        notes: null,
      },
    });
    const { id: recoveredBatchId } = created.json<{ id: string }>();

    const block = await context.app.inject({
      method: 'POST',
      url: `/api/recovered-ingredients/${recoveredBatchId}/statut`,
      headers: { cookie: qualiteCookie },
      payload: { status: 'BLOQUE', reason: 'Suspicion de contamination (test).' },
    });
    assert.equal(block.statusCode, 200, block.body);

    const destinationRun = await newActiveRun();
    const reuse = await context.app.inject({
      method: 'POST',
      url: `/api/recovered-ingredients/${recoveredBatchId}/reutilisation`,
      headers: { cookie: productionCookie },
      payload: { destinationProductionRunId: destinationRun.id, destinationFillingOperationId: null, quantity: '1.000', unit: 'L', reusedAt: null },
    });
    assert.equal(reuse.statusCode, 409, reuse.body);
  });

  it("le bilan matière d'un Run signale un écart à justifier, jamais forcé à zéro ni converti en perte (sections 37-39/72)", async () => {
    const lot = await newIngredientLot('ING-TEST-BILAN');
    await receive(lot.id, '500.000');
    const batch = await openTankBatch();
    await feedTankBatch(batch.id, lot.id, '500.000');

    const run = await newActiveRun();
    await consumeFromTank(run.id, batch.id, '430.000');

    const recovery = await context.app.inject({
      method: 'POST',
      url: '/api/recovered-ingredients',
      headers: { cookie: productionCookie },
      payload: {
        ingredientId: context.fixtures.ingredientHuileId,
        sourceProductionRunId: run.id,
        sourceFillingOperationId: null,
        recoveredAt: new Date().toISOString(),
        quantity: '55.000',
        unit: 'L',
        storageLocationId: context.fixtures.tankLocationId,
        containerId: null,
        notes: null,
      },
    });
    assert.equal(recovery.statusCode, 201, recovery.body);

    const loss = await context.app.inject({
      method: 'POST',
      url: `/api/tank-batches/${batch.id}/perte`,
      headers: { cookie: stockCookie },
      payload: {
        sourceLocationId: context.fixtures.tankLocationId,
        quantity: '10.000',
        unit: 'L',
        occurredAt: null,
        lossReasonId: context.fixtures.ingredientLossReasonId,
        reason: 'Déversement (test).',
        productionRunId: run.id,
      },
    });
    assert.equal(loss.statusCode, 201, loss.body);

    const ingredientsView = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${run.id}/ingredients`,
      headers: { cookie: productionCookie },
    });
    assert.equal(ingredientsView.statusCode, 200);
    const { balance } = ingredientsView.json<{
      balance: readonly Readonly<{
        ingredientId: string;
        suppliedQuantity: number;
        consumedQuantity: number;
        recoveredQuantity: number;
        lossQuantity: number;
        difference: number;
        toleranceExceeded: boolean;
      }>[];
    }>();
    const row = balance.find((entry) => entry.ingredientId === context.fixtures.ingredientHuileId);
    assert.equal(row?.suppliedQuantity, 500);
    assert.equal(row?.consumedQuantity, 430);
    assert.equal(row?.recoveredQuantity, 55);
    assert.equal(row?.lossQuantity, 10);
    assert.equal(row?.difference, 5);
    // 5 L is within 2% of the 430 L consumed (8.6 L) - flagged as "à
    // justifier" in the UI, but not beyond the ordinary measurement
    // tolerance.
    assert.equal(row?.toleranceExceeded, false);
  });

  it('la comparaison au standard de consommation distingue "aucun standard" de "aucune donnée réelle", jamais confondus (sections 40/41)', async () => {
    const run = await newActiveRun();
    const noStandard = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${run.id}/ingredients/${context.fixtures.ingredientHuileId}/standard`,
      headers: { cookie: productionCookie },
    });
    assert.equal(noStandard.statusCode, 200);
    const beforeStandard = noStandard.json<{ status: string | null }>();
    assert.equal(beforeStandard.status, null);

    const standard = await context.app.inject({
      method: 'POST',
      url: '/api/ingredient-consumption-standards',
      headers: { cookie: await context.login('admin') },
      payload: {
        ingredientId: context.fixtures.ingredientHuileId,
        productId: null,
        format: null,
        fillingMediumId: null,
        targetPer1000Units: '25.000',
        minPer1000Units: '22.500',
        maxPer1000Units: '27.500',
        validFrom: new Date().toISOString().slice(0, 10),
        validTo: null,
      },
    });
    assert.equal(standard.statusCode, 201, standard.body);

    const lot = await newIngredientLot('ING-TEST-STD');
    await receive(lot.id, '100.000');
    const batch = await openTankBatch();
    await feedTankBatch(batch.id, lot.id, '100.000');
    await consumeFromTank(run.id, batch.id, '50.000');
    await insertPackagingOutput(run.id, 2000);

    const afterStandard = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${run.id}/ingredients/${context.fixtures.ingredientHuileId}/standard`,
      headers: { cookie: productionCookie },
    });
    const after = afterStandard.json<{ actualPer1000: number; status: string }>();
    assert.equal(after.actualPer1000, 25);
    assert.equal(after.status, 'CONFORME');
  });
});
