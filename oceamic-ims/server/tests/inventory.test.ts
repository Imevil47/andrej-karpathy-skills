import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { withTransaction } from '../src/db/pool.ts';
import { registerReception } from '../src/services/receptions.ts';
import { transferStock } from '../src/services/stock.ts';
import { createTestContext, globalStock, stockAt, type TestContext } from './support/context.ts';

let context: TestContext;

async function receive(quantityKg: string, locationId: string): Promise<string> {
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
      truckRegistration: '12345-A-6',
      quantityKg,
      destinationLocationId: locationId,
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

describe('Inventaire', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it('une réception augmente le stock de l emplacement de destination', async () => {
    const lotId = await receive('5000.000', context.fixtures.oceamic2Id);
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '5000.000');
    assert.equal(await globalStock(context.pool, lotId), '5000.000');
  });

  it('un transfert diminue la source et augmente la destination sans dupliquer la quantité', async () => {
    const lotId = await receive('5000.000', context.fixtures.oceamic2Id);
    await withTransaction(context.pool, (client) =>
      transferStock(
        client,
        {
          lotId,
          sourceLocationId: context.fixtures.oceamic2Id,
          destinationLocationId: context.fixtures.damsaId,
          quantityKg: '2000.000',
          occurredAt: new Date(),
          notes: null,
        },
        context.fixtures.users.STOCK,
      ),
    );

    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '3000.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.damsaId), '2000.000');
    assert.equal(await globalStock(context.pool, lotId), '5000.000');
  });

  it('un transfert ne peut pas rendre le stock négatif', async () => {
    const lotId = await receive('3000.000', context.fixtures.oceamic2Id);
    await assert.rejects(
      withTransaction(context.pool, (client) =>
        transferStock(
          client,
          {
            lotId,
            sourceLocationId: context.fixtures.oceamic2Id,
            destinationLocationId: context.fixtures.damsaId,
            quantityKg: '4000.000',
            occurredAt: new Date(),
            notes: null,
          },
          context.fixtures.users.STOCK,
        ),
      ),
      (error: Error) => {
        assert.match(error.message, /Stock insuffisant/);
        assert.match(error.message, /Disponible : 3 000,000 kg/);
        assert.match(error.message, /Demandé : 4 000,000 kg/);
        return true;
      },
    );

    // Aucun mouvement partiel ne doit subsister.
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '3000.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.damsaId), '0.000');
  });

  it("refuse un transfert dont la source et la destination sont identiques", async () => {
    const lotId = await receive('1000.000', context.fixtures.oceamic2Id);
    await assert.rejects(
      withTransaction(context.pool, (client) =>
        transferStock(
          client,
          {
            lotId,
            sourceLocationId: context.fixtures.oceamic2Id,
            destinationLocationId: context.fixtures.oceamic2Id,
            quantityKg: '10.000',
            occurredAt: new Date(),
            notes: null,
          },
          context.fixtures.users.STOCK,
        ),
      ),
      /doivent être différents/,
    );
  });

  it('refuse une quantité nulle ou négative', async () => {
    const lotId = await receive('1000.000', context.fixtures.oceamic2Id);
    for (const quantityKg of ['0.000', '-5.000']) {
      await assert.rejects(
        withTransaction(context.pool, (client) =>
          transferStock(
            client,
            {
              lotId,
              sourceLocationId: context.fixtures.oceamic2Id,
              destinationLocationId: context.fixtures.damsaId,
              quantityKg,
              occurredAt: new Date(),
              notes: null,
            },
            context.fixtures.users.STOCK,
          ),
        ),
        /quantité/i,
      );
    }
  });

  it("classe le stock en interne ou externe d'après l'emplacement, sans saisie manuelle", async () => {
    const lotId = await receive('1000.000', context.fixtures.oceamic2Id);
    await withTransaction(context.pool, (client) =>
      transferStock(
        client,
        {
          lotId,
          sourceLocationId: context.fixtures.oceamic2Id,
          destinationLocationId: context.fixtures.damsaId,
          quantityKg: '400.000',
          occurredAt: new Date(),
          notes: null,
        },
        context.fixtures.users.STOCK,
      ),
    );

    const internal = await context.pool.query<{ quantity_kg: string }>(
      `SELECT COALESCE(SUM(s.quantity_kg), 0)::numeric(14,3) AS quantity_kg
         FROM current_stock_by_lot_location s
         JOIN locations l ON l.id = s.location_id
        WHERE s.raw_material_lot_id = $1 AND l.stock_type = 'INTERNE'`,
      [lotId],
    );
    const external = await context.pool.query<{ quantity_kg: string }>(
      `SELECT COALESCE(SUM(s.quantity_kg), 0)::numeric(14,3) AS quantity_kg
         FROM current_stock_by_lot_location s
         JOIN locations l ON l.id = s.location_id
        WHERE s.raw_material_lot_id = $1 AND l.stock_type = 'EXTERNE'`,
      [lotId],
    );

    assert.equal(internal.rows[0]?.quantity_kg, '600.000');
    assert.equal(external.rows[0]?.quantity_kg, '400.000');
    assert.equal(await globalStock(context.pool, lotId), '1000.000');
  });

  it('empêche deux transferts concurrents de créer du stock négatif', async () => {
    const lotId = await receive('1000.000', context.fixtures.oceamic2Id);
    const transfer = () =>
      withTransaction(context.pool, (client) =>
        transferStock(
          client,
          {
            lotId,
            sourceLocationId: context.fixtures.oceamic2Id,
            destinationLocationId: context.fixtures.damsaId,
            quantityKg: '700.000',
            occurredAt: new Date(),
            notes: null,
          },
          context.fixtures.users.STOCK,
        ),
      );

    const results = await Promise.allSettled([transfer(), transfer()]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'un seul transfert doit aboutir');
    assert.equal(rejected.length, 1);
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '300.000');
    assert.equal(await globalStock(context.pool, lotId), '1000.000');
  });
});
