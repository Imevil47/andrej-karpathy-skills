import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { registerReception } from '../src/services/receptions.ts';
import { sendToSubcontractor } from '../src/services/subcontracting.ts';
import { createTestContext, stockAt, type TestContext } from './support/context.ts';

let context: TestContext;

describe('Intégrité transactionnelle', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it("une réception qui échoue ne laisse ni lot, ni réception, ni mouvement", async () => {
    const inexistantLocationId = '00000000-0000-0000-0000-000000000000';
    const lotsBefore = await context.pool.query('SELECT id FROM raw_material_lots');

    await assert.rejects(
      registerReception(
        context.pool,
        {
          receivedAt: new Date(),
          lot: {
            mode: 'NOUVEAU',
            lotCode: 'LOT-ECHEC-001',
            speciesId: context.fixtures.speciesSardineId,
            origin: null,
            captureDate: null,
            notes: null,
          },
          supplierId: context.fixtures.supplierId,
          vesselId: null,
          tideNumber: null,
          truckRegistration: null,
          quantityKg: '1000.000',
          destinationLocationId: inexistantLocationId,
          receptionType: 'FOURNISSEUR',
          externalSourceLocationId: null,
          documentReference: null,
          notes: null,
          quickInspection: null,
        },
        context.fixtures.users.STOCK,
      ),
    );

    const lotsAfter = await context.pool.query(
      "SELECT id FROM raw_material_lots WHERE lot_code = 'LOT-ECHEC-001'",
    );
    const receptions = await context.pool.query('SELECT id FROM raw_material_receptions');
    const movements = await context.pool.query('SELECT id FROM stock_movements');

    assert.equal(lotsAfter.rows.length, 0, 'aucun lot orphelin');
    assert.equal(receptions.rows.length, 0, 'aucune réception orpheline');
    assert.equal(movements.rows.length, 0, 'aucun mouvement orphelin');
    assert.equal(lotsBefore.rows.length, 0);
  });

  it("une sous-traitance qui échoue ne laisse ni opération, ni mouvement", async () => {
    const reception = await registerReception(
      context.pool,
      {
        receivedAt: new Date(),
        lot: {
          mode: 'NOUVEAU',
          lotCode: null,
          speciesId: context.fixtures.speciesSardineId,
          origin: null,
          captureDate: null,
          notes: null,
        },
        supplierId: context.fixtures.supplierId,
        vesselId: null,
        tideNumber: null,
        truckRegistration: null,
        quantityKg: '1000.000',
        destinationLocationId: context.fixtures.oceamic2Id,
        receptionType: 'FOURNISSEUR',
        externalSourceLocationId: null,
        documentReference: null,
        notes: null,
        quickInspection: null,
      },
      context.fixtures.users.STOCK,
    );

    await assert.rejects(
      sendToSubcontractor(
        context.pool,
        {
          sentAt: new Date(),
          subcontractorId: context.fixtures.sarmaSubcontractorId,
          sourceType: 'STOCK_EXISTANT',
          sourceLotId: reception.lotId,
          sourceLocationId: context.fixtures.oceamic2Id,
          supplierId: null,
          speciesId: null,
          newLotCode: null,
          quantitySentKg: '5000.000',
          incomingQuality: null,
          incomingSizeGrade: null,
          notes: null,
        },
        context.fixtures.users.STOCK,
      ),
      /Stock insuffisant/,
    );

    const operations = await context.pool.query('SELECT id FROM subcontracting_operations');
    assert.equal(operations.rows.length, 0, 'aucune opération orpheline');
    assert.equal(
      await stockAt(context.pool, reception.lotId, context.fixtures.oceamic2Id),
      '1000.000',
    );
    assert.equal(await stockAt(context.pool, reception.lotId, context.fixtures.sarmaLocationId), '0.000');
  });

  it("chaque opération sensible laisse une trace d'audit", async () => {
    const audit = await context.pool.query<{ action: string }>(
      'SELECT DISTINCT action FROM audit_log ORDER BY action',
    );
    const actions = audit.rows.map((row) => row.action);
    assert.ok(actions.includes('RECEPTION_CREATION'));
    assert.ok(actions.includes('LOT_CREATION'));
  });
});
