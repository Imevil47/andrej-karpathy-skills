import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { registerReception } from '../src/services/receptions.ts';
import {
  addSubcontractingResult,
  listSubcontractingOperations,
  sendToSubcontractor,
} from '../src/services/subcontracting.ts';
import { createTestContext, globalStock, stockAt, type TestContext } from './support/context.ts';

let context: TestContext;

async function receive(quantityKg: string): Promise<string> {
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
      quantityKg,
      destinationLocationId: context.fixtures.oceamic2Id,
      receptionType: 'FOURNISSEUR',
      externalSourceLocationId: null,
      documentReference: null,
      notes: null,
      quickInspection: null,
    },
    context.fixtures.users.STOCK,
  );
  return reception.lotId;
}

describe('Sous-traitance', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it('sur stock existant, la quantité quitte OCEAMIC 2 et arrive chez le sous-traitant', async () => {
    const lotId = await receive('10000.000');
    await sendToSubcontractor(
      context.pool,
      {
        sentAt: new Date(),
        subcontractorId: context.fixtures.sarmaSubcontractorId,
        sourceType: 'STOCK_EXISTANT',
        sourceLotId: lotId,
        sourceLocationId: context.fixtures.oceamic2Id,
        supplierId: null,
        speciesId: null,
        newLotCode: null,
        quantitySentKg: '4000.000',
        incomingQuality: 'A',
        incomingSizeGrade: null,
        notes: null,
      },
      context.fixtures.users.STOCK,
    );

    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '6000.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.sarmaLocationId), '4000.000');
    assert.equal(await globalStock(context.pool, lotId), '10000.000');
  });

  it("en mode fournisseur, aucun stock OCEAMIC existant n'est diminué", async () => {
    const existingLotId = await receive('5000.000');
    const operation = await sendToSubcontractor(
      context.pool,
      {
        sentAt: new Date(),
        subcontractorId: context.fixtures.sarmaSubcontractorId,
        sourceType: 'FOURNISSEUR',
        sourceLotId: null,
        sourceLocationId: null,
        supplierId: context.fixtures.supplierId,
        speciesId: context.fixtures.speciesSardineId,
        newLotCode: null,
        quantitySentKg: '8000.000',
        incomingQuality: null,
        incomingSizeGrade: null,
        notes: null,
      },
      context.fixtures.users.STOCK,
    );

    // Le stock existant est intact.
    assert.equal(await stockAt(context.pool, existingLotId, context.fixtures.oceamic2Id), '5000.000');
    // La marchandise appartient à OCEAMIC et apparaît en stock externe chez le sous-traitant.
    assert.equal(
      await stockAt(context.pool, operation.lotId, context.fixtures.sarmaLocationId),
      '8000.000',
    );
    assert.equal(await stockAt(context.pool, operation.lotId, context.fixtures.oceamic2Id), '0.000');
  });

  it('accepte plusieurs résultats et calcule le bilan matière', async () => {
    const lotId = await receive('10000.000');
    const operation = await sendToSubcontractor(
      context.pool,
      {
        sentAt: new Date(),
        subcontractorId: context.fixtures.sarmaSubcontractorId,
        sourceType: 'STOCK_EXISTANT',
        sourceLotId: lotId,
        sourceLocationId: context.fixtures.oceamic2Id,
        supplierId: null,
        speciesId: null,
        newLotCode: null,
        quantitySentKg: '4000.000',
        incomingQuality: null,
        incomingSizeGrade: null,
        notes: null,
      },
      context.fixtures.users.STOCK,
    );

    await addSubcontractingResult(
      context.pool,
      operation.id,
      {
        resultType: 'PRODUIT',
        resultLotMode: 'NOUVEAU_LOT',
        newLotCode: null,
        quantityKg: '2500.000',
        outgoingQuality: 'A',
        outgoingSizeGrade: 'CALIBRE-2',
        destinationLocationId: context.fixtures.oceamic2Id,
        qualityStatus: null,
      },
      context.fixtures.users.STOCK,
    );
    await addSubcontractingResult(
      context.pool,
      operation.id,
      {
        resultType: 'PRODUIT',
        resultLotMode: 'NOUVEAU_LOT',
        newLotCode: null,
        quantityKg: '1000.000',
        outgoingQuality: 'B',
        outgoingSizeGrade: 'CALIBRE-3',
        destinationLocationId: context.fixtures.damsaId,
        qualityStatus: null,
      },
      context.fixtures.users.STOCK,
    );
    const lastResult = await addSubcontractingResult(
      context.pool,
      operation.id,
      {
        resultType: 'PERTE',
        resultLotMode: 'MEME_LOT',
        newLotCode: null,
        quantityKg: '500.000',
        outgoingQuality: null,
        outgoingSizeGrade: null,
        destinationLocationId: null,
        qualityStatus: null,
      },
      context.fixtures.users.STOCK,
    );

    assert.equal(lastResult.differenceKg, '0.000');

    const operations = await listSubcontractingOperations(context.pool, null);
    const row = operations.find((entry) => (entry as { id: string }).id === operation.id) as {
      resultsKg: string;
      differenceKg: string;
    };
    assert.equal(row.resultsKg, '4000.000');
    assert.equal(row.differenceKg, '0.000');

    // Chaque résultat a sa propre destination, sans quantité dupliquée.
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.sarmaLocationId), '0.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '6000.000');
  });

  it('refuse un résultat supérieur à la quantité présente chez le sous-traitant', async () => {
    const lotId = await receive('2000.000');
    const operation = await sendToSubcontractor(
      context.pool,
      {
        sentAt: new Date(),
        subcontractorId: context.fixtures.sarmaSubcontractorId,
        sourceType: 'STOCK_EXISTANT',
        sourceLotId: lotId,
        sourceLocationId: context.fixtures.oceamic2Id,
        supplierId: null,
        speciesId: null,
        newLotCode: null,
        quantitySentKg: '1000.000',
        incomingQuality: null,
        incomingSizeGrade: null,
        notes: null,
      },
      context.fixtures.users.STOCK,
    );

    await assert.rejects(
      addSubcontractingResult(
        context.pool,
        operation.id,
        {
          resultType: 'PRODUIT',
          resultLotMode: 'MEME_LOT',
          newLotCode: null,
          quantityKg: '1500.000',
          outgoingQuality: null,
          outgoingSizeGrade: null,
          destinationLocationId: context.fixtures.oceamic2Id,
          qualityStatus: null,
        },
        context.fixtures.users.STOCK,
      ),
      /Stock insuffisant/,
    );

    const results = await context.pool.query(
      'SELECT id FROM subcontracting_results WHERE subcontracting_operation_id = $1',
      [operation.id],
    );
    assert.equal(results.rows.length, 0, 'aucun résultat partiel ne doit être enregistré');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.sarmaLocationId), '1000.000');
  });
});
