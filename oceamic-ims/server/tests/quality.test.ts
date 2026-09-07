import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { withTransaction } from '../src/db/pool.ts';
import { decideQuality, recordInspection } from '../src/services/quality.ts';
import { registerReception } from '../src/services/receptions.ts';
import { transferStock } from '../src/services/stock.ts';
import { sendToSubcontractor } from '../src/services/subcontracting.ts';
import { createTestContext, globalStock, stockAt, type TestContext } from './support/context.ts';

let context: TestContext;

async function receiveAndBlock(quantityKg: string): Promise<string> {
  const reception = await registerReception(
    context.pool,
    {
      receivedAt: new Date(),
      lot: {
        mode: 'NOUVEAU',
        lotCode: null,
        speciesId: context.fixtures.speciesThonId,
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

  await decideQuality(
    context.pool,
    {
      rawMaterialLotId: reception.lotId,
      inspectionId: null,
      decisionType: 'BLOQUE',
      reason: 'Histamine hors limite',
      notes: null,
    },
    context.fixtures.users.QUALITE,
  );

  return reception.lotId;
}

describe('Qualité', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it('un lot bloqué conserve son stock physique mais devient indisponible', async () => {
    const lotId = await receiveAndBlock('5000.000');

    assert.equal(await globalStock(context.pool, lotId), '5000.000');
    const availability = await context.pool.query<{
      physical_quantity_kg: string;
      blocked_quantity_kg: string;
      available_quantity_kg: string;
    }>(
      `SELECT physical_quantity_kg, blocked_quantity_kg, available_quantity_kg
         FROM available_stock WHERE raw_material_lot_id = $1`,
      [lotId],
    );
    assert.equal(availability.rows[0]?.physical_quantity_kg, '5000.000');
    assert.equal(availability.rows[0]?.blocked_quantity_kg, '5000.000');
    assert.equal(availability.rows[0]?.available_quantity_kg, '0.000');
  });

  it('un lot bloqué ne peut pas partir en sous-traitance', async () => {
    const lotId = await receiveAndBlock('5000.000');
    await assert.rejects(
      sendToSubcontractor(
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
      ),
      (error: Error) => {
        assert.match(error.message, /Opération impossible/);
        assert.match(error.message, /bloqué par le service Qualité/);
        return true;
      },
    );
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.sarmaLocationId), '0.000');
  });

  it('un transfert entre emplacements de stockage reste possible sur un lot bloqué', async () => {
    const lotId = await receiveAndBlock('5000.000');
    await withTransaction(context.pool, (client) =>
      transferStock(
        client,
        {
          lotId,
          sourceLocationId: context.fixtures.oceamic2Id,
          destinationLocationId: context.fixtures.damsaId,
          quantityKg: '1000.000',
          occurredAt: new Date(),
          notes: null,
        },
        context.fixtures.users.STOCK,
      ),
    );
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.damsaId), '1000.000');
  });

  it("la libération clôture le blocage actif sans effacer l'historique des contrôles", async () => {
    const lotId = await receiveAndBlock('5000.000');
    const inspection = await recordInspection(
      context.pool,
      {
        rawMaterialLotId: lotId,
        inspectedAt: new Date(),
        inspectionType: 'RECONTROLE',
        processStage: 'STOCKAGE',
        locationId: context.fixtures.oceamic2Id,
        temperatureC: '1.50',
        histaminePpm: '35.00',
        abvt: null,
        qualityGrade: 'B',
        sizeGrade: null,
        result: 'CONFORME',
        notes: 'Recontrôle conforme',
      },
      context.fixtures.users.QUALITE,
    );

    await decideQuality(
      context.pool,
      {
        rawMaterialLotId: lotId,
        inspectionId: inspection.id,
        decisionType: 'LIBERE',
        reason: 'Recontrôle conforme',
        notes: null,
      },
      context.fixtures.users.QUALITE,
    );

    const blocks = await context.pool.query<{
      status: string;
      released_at: Date | null;
      release_reason: string | null;
      reason: string;
    }>(
      'SELECT status, released_at, release_reason, reason FROM lot_blocks WHERE raw_material_lot_id = $1',
      [lotId],
    );
    assert.equal(blocks.rows.length, 1, "l'historique du blocage est conservé");
    assert.equal(blocks.rows[0]?.status, 'LEVE');
    assert.equal(blocks.rows[0]?.reason, 'Histamine hors limite');
    assert.equal(blocks.rows[0]?.release_reason, 'Recontrôle conforme');
    assert.notEqual(blocks.rows[0]?.released_at, null);

    // Les mesures historiques ne sont pas modifiées par la décision.
    const inspections = await context.pool.query<{ result: string; histamine_ppm: string | null }>(
      'SELECT result, histamine_ppm FROM quality_inspections WHERE raw_material_lot_id = $1',
      [lotId],
    );
    assert.equal(inspections.rows.length, 1);
    assert.equal(inspections.rows[0]?.histamine_ppm, '35.00');

    // Le lot redevient opérationnel.
    const lot = await context.pool.query<{ status: string }>(
      'SELECT status FROM raw_material_lots WHERE id = $1',
      [lotId],
    );
    assert.equal(lot.rows[0]?.status, 'ACTIF');
  });

  it("le rôle STOCK ne peut pas libérer un lot, le rôle QUALITE le peut", async () => {
    const lotId = await receiveAndBlock('1000.000');
    const stockCookie = await context.login('stock');
    const qualityCookie = await context.login('qualite');

    const refused = await context.app.inject({
      method: 'POST',
      url: '/api/quality/decisions',
      headers: { cookie: stockCookie },
      payload: {
        rawMaterialLotId: lotId,
        inspectionId: null,
        decisionType: 'LIBERE',
        reason: 'Tentative non autorisée',
        notes: null,
      },
    });
    assert.equal(refused.statusCode, 403);
    assert.match(refused.json().message as string, /droits/i);

    const accepted = await context.app.inject({
      method: 'POST',
      url: '/api/quality/decisions',
      headers: { cookie: qualityCookie },
      payload: {
        rawMaterialLotId: lotId,
        inspectionId: null,
        decisionType: 'LIBERE',
        reason: 'Décision qualité',
        notes: null,
      },
    });
    assert.equal(accepted.statusCode, 201);

    const remaining = await context.pool.query(
      "SELECT id FROM lot_blocks WHERE raw_material_lot_id = $1 AND status = 'ACTIF'",
      [lotId],
    );
    assert.equal(remaining.rows.length, 0);
  });

  it('refuse un second blocage actif sur le même lot', async () => {
    const lotId = await receiveAndBlock('1000.000');
    await assert.rejects(
      decideQuality(
        context.pool,
        {
          rawMaterialLotId: lotId,
          inspectionId: null,
          decisionType: 'BLOQUE',
          reason: 'Second blocage',
          notes: null,
        },
        context.fixtures.users.QUALITE,
      ),
      /déjà bloqué/,
    );
  });
});
