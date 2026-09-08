import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestContext, type TestContext } from './support/context.ts';

// Phase 5 business rules (sections 48-53) and the six acceptance scenarios
// (sections 54-59), played through the HTTP API exactly as the interface does.

let context: TestContext;
let productionCookie: string;
let qualiteCookie: string;
let stockCookie: string;

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

async function newCycle(runId: string): Promise<string> {
  const response = await context.app.inject({
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
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

async function newPackagingBatch(runId: string, cycleId: string): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/packaging-batches',
    headers: { cookie: productionCookie },
    payload: {
      productionRunId: runId,
      sterilizationCycleId: cycleId,
      format: 'CLUB',
      responsibleUserId: null,
      notes: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

async function newFinishedGoodLot(
  batchId: string,
  runId: string,
  cycleId: string,
): Promise<Readonly<{ id: string; lotCode: string; qualityStatus: string }>> {
  const response = await context.app.inject({
    method: 'POST',
    url: `/api/packaging-batches/${batchId}/lots-pf`,
    headers: { cookie: productionCookie },
    payload: {
      format: 'CLUB',
      piecesPerCan: 4,
      productionDate: new Date().toISOString().slice(0, 10),
      bestBeforeDate: null,
      notes: null,
      sources: [{ sterilizationCycleId: cycleId, productionRunId: runId, quantityUnits: 480 }],
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string; lotCode: string; qualityStatus: string };
}

async function newPallet(
  lotId: string,
  quantityCartons: number,
  quantityUnits: number,
): Promise<Readonly<{ id: string; palletCode: string }>> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/pallets',
    headers: { cookie: productionCookie },
    payload: {
      destinationLocationId: context.fixtures.stockPfALocationId,
      occurredAt: new Date().toISOString(),
      notes: null,
      contents: [{ finishedGoodLotId: lotId, quantityCartons, quantityUnits }],
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string; palletCode: string };
}

async function releaseFgQuality(entityType: 'FINISHED_GOOD_LOT' | 'PALLET', entityId: string): Promise<void> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/fg-quality/decisions',
    headers: { cookie: qualiteCookie },
    payload: {
      entityType,
      entityId,
      decisionType: 'ACCEPTE',
      reason: 'Conforme (test).',
      notes: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function receiveAndConsume(runId: string, lotCode: string): Promise<string> {
  const reception = await context.app.inject({
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
      quantityKg: '2000.000',
      destinationLocationId: context.fixtures.oceamic2Id,
      receptionType: 'FOURNISSEUR',
      externalSourceLocationId: null,
      documentReference: null,
      notes: null,
      quickInspection: null,
    },
  });
  assert.equal(reception.statusCode, 201, reception.body);
  const lotId = (reception.json() as { lotId: string }).lotId;

  const consumption = await context.app.inject({
    method: 'POST',
    url: `/api/production/runs/${runId}/consommations`,
    headers: { cookie: productionCookie },
    payload: {
      rawMaterialLotId: lotId,
      sourceLocationId: context.fixtures.oceamic2Id,
      quantityKg: '2000.000',
      consumedAt: new Date().toISOString(),
      notes: null,
    },
  });
  assert.equal(consumption.statusCode, 201, consumption.body);
  return lotId;
}

async function newShipment(containerNumber: string): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/shipments',
    headers: { cookie: stockCookie },
    payload: {
      customerId: context.fixtures.customerId,
      plannedDate: new Date().toISOString().slice(0, 10),
      destination: 'Port de test',
      containerNumber,
      sealNumber: null,
      vehicleRegistration: null,
      targetTemperatureC: null,
      gensetRequired: null,
      notes: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

describe('Phase 5 — règles métier et scénarios d’acceptation', () => {
  before(async () => {
    context = await createTestContext();
    productionCookie = await context.login('production');
    qualiteCookie = await context.login('qualite');
    stockCookie = await context.login('stock');
  });
  after(async () => {
    await context.close();
  });

  it('un Lot PF hérite du blocage actif du Run source (jamais LIBERE automatiquement)', async () => {
    const runId = await newRun();
    const cycleId = await newCycle(runId);

    // A CCP decision "RETENU" opens an active hold on the Run.
    const ccp = await context.app.inject({
      method: 'POST',
      url: `/api/sterilization-cycles/${cycleId}/ccp`,
      headers: { cookie: qualiteCookie },
      payload: {
        controlledAt: new Date().toISOString(),
        ccpType: 'F0_MINIMUM',
        result: 'NON_CONFORME',
        decision: 'RETENU',
        notes: null,
      },
    });
    assert.equal(ccp.statusCode, 201, ccp.body);

    const batchId = await newPackagingBatch(runId, cycleId);
    const lot = await newFinishedGoodLot(batchId, runId, cycleId);
    assert.equal(lot.qualityStatus, 'BLOQUE');

    const situation = await context.app.inject({
      method: 'GET',
      url: `/api/finished-good-lots/${lot.id}/situation`,
      headers: { cookie: productionCookie },
    });
    const payload = situation.json() as { lot: { qualityStatus: string }; blocks: readonly { status: string }[] };
    assert.equal(payload.lot.qualityStatus, 'BLOQUE');
    assert.equal(payload.blocks[0]?.status, 'ACTIF');
  });

  it('une palette ne peut pas porter deux fois le même Lot PF', async () => {
    const runId = await newRun();
    const cycleId = await newCycle(runId);
    const batchId = await newPackagingBatch(runId, cycleId);
    const lot = await newFinishedGoodLot(batchId, runId, cycleId);

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/pallets',
      headers: { cookie: productionCookie },
      payload: {
        destinationLocationId: context.fixtures.stockPfALocationId,
        occurredAt: new Date().toISOString(),
        notes: null,
        contents: [
          { finishedGoodLotId: lot.id, quantityCartons: 10, quantityUnits: 120 },
          { finishedGoodLotId: lot.id, quantityCartons: 5, quantityUnits: 60 },
        ],
      },
    });
    assert.equal(response.statusCode, 400, response.body);
  });

  it('une palette déjà affectée à une expédition ne peut pas être chargée une seconde fois', async () => {
    const runId = await newRun();
    const cycleId = await newCycle(runId);
    const batchId = await newPackagingBatch(runId, cycleId);
    const lot = await newFinishedGoodLot(batchId, runId, cycleId);
    const pallet = await newPallet(lot.id, 60, 720);

    const shipmentOne = await newShipment('CONT-DBL-1');
    const shipmentTwo = await newShipment('CONT-DBL-2');

    const first = await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentOne}/palettes`,
      headers: { cookie: stockCookie },
      payload: { palletId: pallet.id },
    });
    assert.equal(first.statusCode, 201, first.body);

    const second = await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentTwo}/palettes`,
      headers: { cookie: stockCookie },
      payload: { palletId: pallet.id },
    });
    assert.equal(second.statusCode, 409, second.body);
    assert.match((second.json() as { message: string }).message, /déjà affectée à une expédition/);
  });

  it('une palette bloquée par la Qualité empêche la confirmation de l’expédition, sans aucun mouvement de stock', async () => {
    const runId = await newRun();
    const cycleId = await newCycle(runId);
    const batchId = await newPackagingBatch(runId, cycleId);
    const lot = await newFinishedGoodLot(batchId, runId, cycleId);
    const pallet = await newPallet(lot.id, 60, 720);
    await releaseFgQuality('FINISHED_GOOD_LOT', lot.id);
    await releaseFgQuality('PALLET', pallet.id);

    const shipmentId = await newShipment('CONT-BLOQUE');
    await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/palettes`,
      headers: { cookie: stockCookie },
      payload: { palletId: pallet.id },
    });

    const block = await context.app.inject({
      method: 'POST',
      url: '/api/fg-quality/decisions',
      headers: { cookie: qualiteCookie },
      payload: {
        entityType: 'PALLET',
        entityId: pallet.id,
        decisionType: 'BLOQUE',
        reason: 'Anomalie détectée (test).',
        notes: null,
      },
    });
    assert.equal(block.statusCode, 201, block.body);

    const movementsBefore = await context.pool.query(
      'SELECT COUNT(*)::int AS count FROM finished_goods_stock_movements WHERE pallet_id = $1',
      [pallet.id],
    );

    const confirmation = await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/confirmation`,
      headers: { cookie: stockCookie },
    });
    assert.equal(confirmation.statusCode, 409, confirmation.body);
    assert.match((confirmation.json() as { message: string }).message, /Expédition impossible/);
    assert.match((confirmation.json() as { message: string }).message, /bloquée par le service Qualité/);

    const movementsAfter = await context.pool.query(
      'SELECT COUNT(*)::int AS count FROM finished_goods_stock_movements WHERE pallet_id = $1',
      [pallet.id],
    );
    assert.equal(movementsAfter.rows[0]?.count, movementsBefore.rows[0]?.count);

    const shipment = await context.pool.query('SELECT status FROM shipments WHERE id = $1', [shipmentId]);
    assert.equal(shipment.rows[0]?.status, 'EN_PREPARATION');
  });

  it('la confirmation d’expédition est une seule transaction : mouvements, palettes et réservations cohérents', async () => {
    const runId = await newRun();
    const cycleId = await newCycle(runId);
    const batchId = await newPackagingBatch(runId, cycleId);
    const lot = await newFinishedGoodLot(batchId, runId, cycleId);
    const palletOne = await newPallet(lot.id, 60, 720);
    const palletTwo = await newPallet(lot.id, 40, 480);
    await releaseFgQuality('FINISHED_GOOD_LOT', lot.id);
    await releaseFgQuality('PALLET', palletOne.id);
    await releaseFgQuality('PALLET', palletTwo.id);

    // Available cartons for the Lot PF track physical minus reserved as
    // pallets get loaded (the pallet-granularity equivalent of the
    // 100 -> reserve 60 -> 40 available rule: two pallets totalling 100
    // cartons, only 40 remain available once the 60-carton pallet is
    // reserved).
    const beforeReservation = await context.app.inject({
      method: 'GET',
      url: `/api/finished-good-lots/${lot.id}/situation`,
      headers: { cookie: stockCookie },
    });
    assert.equal((beforeReservation.json() as { lot: { availableCartons: number } }).lot.availableCartons, 100);

    const shipmentId = await newShipment('CONT-TX');
    await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/palettes`,
      headers: { cookie: stockCookie },
      payload: { palletId: palletOne.id },
    });

    const afterReservation = await context.app.inject({
      method: 'GET',
      url: `/api/finished-good-lots/${lot.id}/situation`,
      headers: { cookie: stockCookie },
    });
    assert.equal((afterReservation.json() as { lot: { availableCartons: number } }).lot.availableCartons, 40);

    // Attempting to also reserve the second pallet onto another shipment must
    // still succeed here (it is a different, unreserved pallet) - reservation
    // safety is about the SAME pallet, verified in the double-booking test.
    await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/palettes`,
      headers: { cookie: stockCookie },
      payload: { palletId: palletTwo.id },
    });

    const confirmation = await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/confirmation`,
      headers: { cookie: stockCookie },
    });
    assert.equal(confirmation.statusCode, 200, confirmation.body);

    const shipment = await context.pool.query<{ status: string; shipped_at: Date | null }>(
      'SELECT status, shipped_at FROM shipments WHERE id = $1',
      [shipmentId],
    );
    assert.equal(shipment.rows[0]?.status, 'EXPEDIEE');
    assert.ok(shipment.rows[0]?.shipped_at);

    const pallets = await context.pool.query<{ status: string }>(
      'SELECT status FROM pallets WHERE id = ANY($1)',
      [[palletOne.id, palletTwo.id]],
    );
    assert.ok(pallets.rows.every((row) => row.status === 'EXPEDIEE'));

    const reservations = await context.pool.query<{ status: string }>(
      'SELECT status FROM stock_reservations WHERE shipment_id = $1',
      [shipmentId],
    );
    assert.ok(reservations.rows.every((row) => row.status === 'CONSOMMEE'));

    const movements = await context.pool.query<{ movement_type: string }>(
      "SELECT movement_type FROM finished_goods_stock_movements WHERE reference_type = 'EXPEDITION' AND reference_id = $1",
      [shipmentId],
    );
    assert.equal(movements.rows.length, 2);
    assert.ok(movements.rows.every((row) => row.movement_type === 'EXPEDITION'));
  });

  it('scénario complet : Lot PF -> palettes -> stock PF -> expédition -> traçabilité avant/arrière (sections 54-59)', async () => {
    const runId = await newRun();
    const rawMaterialLotId = await receiveAndConsume(runId, 'LOT-MP-PHASE5');
    const cycleId = await newCycle(runId);
    const batchId = await newPackagingBatch(runId, cycleId);
    const lot = await newFinishedGoodLot(batchId, runId, cycleId);

    const output = await context.app.inject({
      method: 'POST',
      url: `/api/packaging-batches/${batchId}/sorties`,
      headers: { cookie: productionCookie },
      payload: {
        finishedGoodLotId: lot.id,
        quantityCans: 12000,
        quantityCartons: 1000,
        unitsPerCarton: 12,
        occurredAt: new Date().toISOString(),
        notes: null,
      },
    });
    assert.equal(output.statusCode, 201, output.body);

    const palletOne = await newPallet(lot.id, 60, 720);
    const palletTwo = await newPallet(lot.id, 60, 720);

    // Physical stock of this specific Lot PF (not the location-wide total,
    // which accumulates across every test sharing this context) reflects
    // both pallets as soon as they enter Stock PF A.
    const situationAfterPalletizing = await context.app.inject({
      method: 'GET',
      url: `/api/finished-good-lots/${lot.id}/situation`,
      headers: { cookie: stockCookie },
    });
    const lotStock = (situationAfterPalletizing.json() as { lot: { physicalCartons: number } }).lot;
    assert.equal(lotStock.physicalCartons, 120);

    await releaseFgQuality('FINISHED_GOOD_LOT', lot.id);
    await releaseFgQuality('PALLET', palletOne.id);
    await releaseFgQuality('PALLET', palletTwo.id);

    const shipmentId = await newShipment('CONT-ACCEPT');
    await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/palettes`,
      headers: { cookie: stockCookie },
      payload: { palletId: palletOne.id },
    });
    await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/palettes`,
      headers: { cookie: stockCookie },
      payload: { palletId: palletTwo.id },
    });
    const confirmation = await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/confirmation`,
      headers: { cookie: stockCookie },
    });
    assert.equal(confirmation.statusCode, 200, confirmation.body);

    // Backward traceability from the container: pallets -> Lot PF ->
    // sterilization -> Run.
    const backward = await context.app.inject({
      method: 'GET',
      url: '/api/conteneurs/CONT-ACCEPT/traceability-arriere',
      headers: { cookie: qualiteCookie },
    });
    assert.equal(backward.statusCode, 200, backward.body);
    const backwardRows = backward.json() as readonly {
      palletCode: string;
      finishedGoodLotCode: string;
      runCode: string;
    }[];
    assert.equal(backwardRows.length, 2);
    assert.ok(backwardRows.every((row) => row.finishedGoodLotCode === lot.lotCode));

    const backwardByShipment = await context.app.inject({
      method: 'GET',
      url: `/api/shipments/${shipmentId}/traceability-arriere`,
      headers: { cookie: qualiteCookie },
    });
    assert.equal((backwardByShipment.json() as readonly unknown[]).length, 2);

    const shipmentDetail = await context.app.inject({
      method: 'GET',
      url: `/api/shipments/${shipmentId}`,
      headers: { cookie: stockCookie },
    });
    const detail = shipmentDetail.json() as { shipment: { status: string }; lines: readonly unknown[] };
    assert.equal(detail.shipment.status, 'EXPEDIEE');
    assert.equal(detail.lines.length, 2);

    // Forward traceability (section 32) from the raw-material lot: if this
    // lot has a problem, both pallets and the customer must be found.
    const forward = await context.app.inject({
      method: 'GET',
      url: `/api/lots/${rawMaterialLotId}/traceability-avant`,
      headers: { cookie: qualiteCookie },
    });
    assert.equal(forward.statusCode, 200, forward.body);
    const forwardRows = forward.json() as readonly { palletCode: string; customerName: string | null }[];
    assert.equal(forwardRows.length, 2);
    assert.ok(forwardRows.every((row) => row.customerName === 'Client Test'));
  });
});
