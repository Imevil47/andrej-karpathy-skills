import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestContext, globalStock, stockAt, type TestContext } from './support/context.ts';

// The seven Phase 1 acceptance scenarios, played through the HTTP API exactly
// as the operational UI does.

let context: TestContext;
let stockCookie: string;
let qualityCookie: string;

type ReceptionResponse = { lotId: string; lotCode: string; receptionCode: string };

async function receive(lotCode: string, quantityKg: string): Promise<ReceptionResponse> {
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
      tideNumber: 'MAREE-01',
      truckRegistration: '12345-A-6',
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
  return response.json() as ReceptionResponse;
}

describe("Scénarios d'acceptation Phase 1", () => {
  before(async () => {
    context = await createTestContext();
    stockCookie = await context.login('stock');
    qualityCookie = await context.login('qualite');
  });
  after(async () => {
    await context.close();
  });

  it('1. réception de 5 000 kg de sardine sur OCEAMIC 2', async () => {
    const reception = await receive('LOT-MP-001', '5000.000');

    assert.equal(reception.lotCode, 'LOT-MP-001');
    assert.match(reception.receptionCode, /^REC-\d{8}-\d{3}$/);
    assert.equal(
      await stockAt(context.pool, reception.lotId, context.fixtures.oceamic2Id),
      '5000.000',
    );

    const movements = await context.pool.query(
      "SELECT movement_type FROM stock_movements WHERE raw_material_lot_id = $1",
      [reception.lotId],
    );
    assert.deepEqual(
      movements.rows.map((row) => (row as { movement_type: string }).movement_type),
      ['RECEPTION'],
    );
  });

  it('2. transfert de 2 000 kg vers DAMSA sans duplication de quantité', async () => {
    const reception = await receive('LOT-MP-002', '5000.000');
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/stock/transfers',
      headers: { cookie: stockCookie },
      payload: {
        lotId: reception.lotId,
        sourceLocationId: context.fixtures.oceamic2Id,
        destinationLocationId: context.fixtures.damsaId,
        quantityKg: '2000.000',
        occurredAt: new Date().toISOString(),
        notes: null,
      },
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(await stockAt(context.pool, reception.lotId, context.fixtures.oceamic2Id), '3000.000');
    assert.equal(await stockAt(context.pool, reception.lotId, context.fixtures.damsaId), '2000.000');
    assert.equal(await globalStock(context.pool, reception.lotId), '5000.000');
  });

  it('3. transfert de 4 000 kg refusé quand 3 000 kg sont disponibles', async () => {
    const reception = await receive('LOT-MP-003', '3000.000');
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/stock/transfers',
      headers: { cookie: stockCookie },
      payload: {
        lotId: reception.lotId,
        sourceLocationId: context.fixtures.oceamic2Id,
        destinationLocationId: context.fixtures.damsaId,
        quantityKg: '4000.000',
        occurredAt: new Date().toISOString(),
        notes: null,
      },
    });

    assert.equal(response.statusCode, 409);
    const body = response.json() as { code: string; message: string };
    assert.equal(body.code, 'STOCK_INSUFFISANT');
    assert.equal(
      body.message,
      'Stock insuffisant.\nDisponible : 3 000,000 kg\nDemandé : 4 000,000 kg',
    );
    assert.equal(await stockAt(context.pool, reception.lotId, context.fixtures.oceamic2Id), '3000.000');
    assert.equal(await stockAt(context.pool, reception.lotId, context.fixtures.damsaId), '0.000');
  });

  it('4. blocage qualité: le stock physique reste, les opérations interdites sont refusées', async () => {
    const reception = await receive('LOT-MP-004', '5000.000');
    const blocked = await context.app.inject({
      method: 'POST',
      url: '/api/quality/decisions',
      headers: { cookie: qualityCookie },
      payload: {
        rawMaterialLotId: reception.lotId,
        inspectionId: null,
        decisionType: 'BLOQUE',
        reason: 'Histamine hors limite',
        notes: null,
      },
    });
    assert.equal(blocked.statusCode, 201, blocked.body);
    assert.equal(await globalStock(context.pool, reception.lotId), '5000.000');

    const refused = await context.app.inject({
      method: 'POST',
      url: '/api/subcontracting',
      headers: { cookie: stockCookie },
      payload: {
        sentAt: new Date().toISOString(),
        subcontractorId: context.fixtures.sarmaSubcontractorId,
        sourceType: 'STOCK_EXISTANT',
        sourceLotId: reception.lotId,
        sourceLocationId: context.fixtures.oceamic2Id,
        supplierId: null,
        speciesId: null,
        newLotCode: null,
        quantitySentKg: '1000.000',
        incomingQuality: null,
        incomingSizeGrade: null,
        notes: null,
      },
    });

    assert.equal(refused.statusCode, 409);
    const body = refused.json() as { code: string; message: string };
    assert.equal(body.code, 'LOT_BLOQUE');
    assert.equal(
      body.message,
      'Opération impossible.\nCe lot est bloqué par le service Qualité.',
    );
  });

  it("5. libération qualité: le blocage est clôturé et l'historique conservé", async () => {
    const reception = await receive('LOT-MP-005', '2000.000');
    await context.app.inject({
      method: 'POST',
      url: '/api/quality/decisions',
      headers: { cookie: qualityCookie },
      payload: {
        rawMaterialLotId: reception.lotId,
        inspectionId: null,
        decisionType: 'BLOQUE',
        reason: 'Contrôle à confirmer',
        notes: null,
      },
    });

    const inspection = await context.app.inject({
      method: 'POST',
      url: '/api/quality/inspections',
      headers: { cookie: qualityCookie },
      payload: {
        rawMaterialLotId: reception.lotId,
        inspectedAt: new Date().toISOString(),
        inspectionType: 'RECONTROLE',
        processStage: 'STOCKAGE',
        locationId: context.fixtures.oceamic2Id,
        temperatureC: '2.00',
        histaminePpm: '20.00',
        abvt: null,
        qualityGrade: 'A',
        sizeGrade: null,
        result: 'CONFORME',
        notes: null,
      },
    });
    assert.equal(inspection.statusCode, 201, inspection.body);

    const released = await context.app.inject({
      method: 'POST',
      url: '/api/quality/decisions',
      headers: { cookie: qualityCookie },
      payload: {
        rawMaterialLotId: reception.lotId,
        inspectionId: (inspection.json() as { id: string }).id,
        decisionType: 'LIBERE',
        reason: 'Recontrôle conforme',
        notes: null,
      },
    });
    assert.equal(released.statusCode, 201, released.body);

    const situation = await context.app.inject({
      method: 'GET',
      url: `/api/lots/${reception.lotId}/situation`,
      headers: { cookie: qualityCookie },
    });
    const payload = situation.json() as {
      lot: { isBlocked: boolean; status: string };
      blocks: readonly { status: string; releaseReason: string | null }[];
      inspections: readonly unknown[];
      decisions: readonly { decisionType: string }[];
    };

    assert.equal(payload.lot.isBlocked, false);
    assert.equal(payload.lot.status, 'ACTIF');
    assert.equal(payload.blocks.length, 1);
    assert.equal(payload.blocks[0]?.status, 'LEVE');
    assert.equal(payload.blocks[0]?.releaseReason, 'Recontrôle conforme');
    assert.equal(payload.inspections.length, 1);
    assert.deepEqual(
      payload.decisions.map((decision) => decision.decisionType).sort(),
      ['BLOQUE', 'LIBERE'],
    );
  });

  it('6. sous-traitance depuis le stock existant avec plusieurs résultats', async () => {
    const reception = await receive('LOT-MP-006', '10000.000');
    const operation = await context.app.inject({
      method: 'POST',
      url: '/api/subcontracting',
      headers: { cookie: stockCookie },
      payload: {
        sentAt: new Date().toISOString(),
        subcontractorId: context.fixtures.sarmaSubcontractorId,
        sourceType: 'STOCK_EXISTANT',
        sourceLotId: reception.lotId,
        sourceLocationId: context.fixtures.oceamic2Id,
        supplierId: null,
        speciesId: null,
        newLotCode: null,
        quantitySentKg: '4000.000',
        incomingQuality: 'A',
        incomingSizeGrade: null,
        notes: null,
      },
    });
    assert.equal(operation.statusCode, 201, operation.body);
    const operationId = (operation.json() as { id: string }).id;

    assert.equal(await stockAt(context.pool, reception.lotId, context.fixtures.oceamic2Id), '6000.000');
    assert.equal(
      await stockAt(context.pool, reception.lotId, context.fixtures.sarmaLocationId),
      '4000.000',
    );

    const results: readonly Readonly<{
      resultType: 'PRODUIT' | 'PERTE';
      quantityKg: string;
      destinationLocationId: string | null;
      resultLotMode: 'MEME_LOT' | 'NOUVEAU_LOT';
    }>[] = [
      {
        resultType: 'PRODUIT',
        quantityKg: '2500.000',
        destinationLocationId: context.fixtures.oceamic2Id,
        resultLotMode: 'NOUVEAU_LOT',
      },
      {
        resultType: 'PRODUIT',
        quantityKg: '1000.000',
        destinationLocationId: context.fixtures.damsaId,
        resultLotMode: 'NOUVEAU_LOT',
      },
      {
        resultType: 'PERTE',
        quantityKg: '500.000',
        destinationLocationId: null,
        resultLotMode: 'MEME_LOT',
      },
    ];

    for (const result of results) {
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/subcontracting/${operationId}/results`,
        headers: { cookie: stockCookie },
        payload: {
          ...result,
          newLotCode: null,
          outgoingQuality: null,
          outgoingSizeGrade: null,
          qualityStatus: null,
        },
      });
      assert.equal(response.statusCode, 201, response.body);
    }

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/subcontracting/${operationId}`,
      headers: { cookie: stockCookie },
    });
    const payload = detail.json() as {
      operation: { quantitySentKg: string; resultsKg: string; differenceKg: string };
      results: readonly unknown[];
    };

    assert.equal(payload.operation.quantitySentKg, '4000.000');
    assert.equal(payload.operation.resultsKg, '4000.000');
    assert.equal(payload.operation.differenceKg, '0.000');
    assert.equal(payload.results.length, 3);
    assert.equal(await stockAt(context.pool, reception.lotId, context.fixtures.sarmaLocationId), '0.000');
  });

  it('7. sous-traitance directe fournisseur sans réduire le stock OCEAMIC', async () => {
    const existing = await receive('LOT-MP-007', '5000.000');
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/subcontracting',
      headers: { cookie: stockCookie },
      payload: {
        sentAt: new Date().toISOString(),
        subcontractorId: context.fixtures.sarmaSubcontractorId,
        sourceType: 'FOURNISSEUR',
        sourceLotId: null,
        sourceLocationId: null,
        supplierId: context.fixtures.supplierId,
        speciesId: context.fixtures.speciesSardineId,
        newLotCode: 'LOT-MP-007-ST',
        quantitySentKg: '8000.000',
        incomingQuality: null,
        incomingSizeGrade: null,
        notes: 'Livraison directe fournisseur',
      },
    });

    assert.equal(response.statusCode, 201, response.body);
    const created = response.json() as { lotId: string; operationCode: string };

    assert.equal(await stockAt(context.pool, existing.lotId, context.fixtures.oceamic2Id), '5000.000');
    assert.equal(await stockAt(context.pool, created.lotId, context.fixtures.oceamic2Id), '0.000');
    assert.equal(
      await stockAt(context.pool, created.lotId, context.fixtures.sarmaLocationId),
      '8000.000',
    );

    // La marchandise est bien classée en stock externe et reste traçable.
    const external = await context.pool.query<{ quantity_kg: string }>(
      `SELECT quantity_kg FROM external_stock_summary WHERE location_code = 'SARMA'`,
    );
    assert.equal(external.rows[0]?.quantity_kg, '8000.000');

    const audit = await context.pool.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'SOUS_TRAITANCE_ENVOI'",
    );
    assert.ok(audit.rows.length >= 1);
  });
});
