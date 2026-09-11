import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  cancelRun,
  consumeRawMaterial,
  correctConsumption,
  createRun,
  finishRun,
  justifyMaterialDifference,
  materialBalance,
  recordOutput,
  startRun,
} from '../src/services/production.ts';
import { listRuns, lotProductionUsage, runDetail } from '../src/services/productionQueries.ts';
import { decideQuality } from '../src/services/quality.ts';
import { registerReception } from '../src/services/receptions.ts';
import { createTestContext, stockAt, type TestContext } from './support/context.ts';

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

async function newRun(): Promise<string> {
  const run = await createRun(
    context.pool,
    {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: context.fixtures.productSardineId,
      format: null,
      piecesPerCan: null,
      responsibleUserId: context.fixtures.users.PRODUCTION,
      lines: [
        { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
      ],
      notes: null,
    },
    context.fixtures.users.PRODUCTION,
  );
  await startRun(context.pool, run.id, context.fixtures.users.PRODUCTION);
  return run.id;
}

async function consume(runId: string, lotId: string, quantityKg: string) {
  return consumeRawMaterial(
    context.pool,
    runId,
    {
      rawMaterialLotId: lotId,
      sourceLocationId: context.fixtures.oceamic2Id,
      quantityKg,
      consumedAt: new Date(),
      notes: null,
    },
    context.fixtures.users.PRODUCTION,
  );
}

async function output(runId: string, outputType: string, quantityKg: string) {
  return recordOutput(
    context.pool,
    runId,
    {
      outputType: outputType as 'SORTIE_UTILE',
      quantityKg,
      occurredAt: new Date(),
      productionLineId: null,
      destinationStageId: null,
      destinationLocationId: null,
      lossReasonId: outputType === 'PERTE_REELLE' ? context.fixtures.lossReasonId : null,
      reasonText: null,
      notes: null,
    },
    context.fixtures.users.PRODUCTION,
  );
}

describe('Production', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it("crée un ordre de production avec un code lisible et unique", async () => {
    const first = await newRun();
    const second = await newRun();
    const runs = await listRuns(context.pool, {
      productionDateFrom: null,
      productionDateTo: null,
      speciesId: null,
      productId: null,
      status: null,
      limit: 100,
    });
    const codes = runs.map((run) => run.runCode);
    assert.notEqual(first, second);
    assert.equal(new Set(codes).size, codes.length, 'les codes de Run sont uniques');
    assert.match(codes[0] ?? '', /^RUN-\d{8}-\d{3}$/);
  });

  it("l'espèce du Run est dérivée du produit et n'est pas saisie", async () => {
    const runId = await newRun();
    const detail = await runDetail(context.pool, runId);
    assert.equal(detail.run.speciesCode, 'SARDINE');
    assert.equal(detail.run.productCode, 'SPSA-HO');
  });

  it('un Run consomme plusieurs lots et additionne son entrée matière', async () => {
    const runId = await newRun();
    const lotA = await receive('3000.000');
    const lotB = await receive('2500.000');
    const lotC = await receive('500.000');

    await consume(runId, lotA, '3000.000');
    await consume(runId, lotB, '2500.000');
    await consume(runId, lotC, '500.000');

    const balance = await materialBalance(context.pool, runId);
    assert.equal(balance.inputKg, '6000.000');

    const detail = await runDetail(context.pool, runId);
    assert.equal(detail.consumptions.length, 3, 'chaque lot source reste visible individuellement');
  });

  it('un lot alimente plusieurs Runs et son stock diminue une seule fois', async () => {
    const lotId = await receive('10000.000');
    const firstRun = await newRun();
    const secondRun = await newRun();

    await consume(firstRun, lotId, '3500.000');
    await consume(secondRun, lotId, '2000.000');

    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '4500.000');

    const usage = await lotProductionUsage(context.pool, lotId);
    assert.equal(usage.length, 2);
    assert.deepEqual(
      usage.map((row) => row.consumedKg).sort(),
      ['2000.000', '3500.000'],
    );
  });

  it('la consommation diminue le stock du lot', async () => {
    const runId = await newRun();
    const lotId = await receive('5000.000');
    await consume(runId, lotId, '2000.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '3000.000');
  });

  it('un lot bloqué par la Qualité ne peut pas être consommé', async () => {
    const runId = await newRun();
    const lotId = await receive('5000.000');
    await decideQuality(
      context.pool,
      {
        rawMaterialLotId: lotId,
        inspectionId: null,
        decisionType: 'BLOQUE',
        reason: 'Histamine hors limite',
        notes: null,
      },
      context.fixtures.users.QUALITE,
    );

    await assert.rejects(consume(runId, lotId, '1000.000'), (error: Error) => {
      assert.match(error.message, /Opération impossible/);
      assert.match(error.message, /bloqué par le service Qualité/);
      return true;
    });

    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '5000.000');
    const balance = await materialBalance(context.pool, runId);
    assert.equal(balance.inputKg, '0.000');
  });

  it('une consommation supérieure au stock disponible est refusée', async () => {
    const runId = await newRun();
    const lotId = await receive('1000.000');
    await assert.rejects(consume(runId, lotId, '1500.000'), /Stock insuffisant/);

    const balance = await materialBalance(context.pool, runId);
    assert.equal(balance.inputKg, '0.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '1000.000');
  });

  it('deux consommations concurrentes ne peuvent pas créer de stock négatif', async () => {
    const lotId = await receive('1000.000');
    const runId = await newRun();
    const results = await Promise.allSettled([
      consume(runId, lotId, '700.000'),
      consume(runId, lotId, '700.000'),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '300.000');
  });

  it('calcule le bilan matière, l écart et le rendement', async () => {
    const runId = await newRun();
    const lotId = await receive('10000.000');
    await consume(runId, lotId, '10000.000');

    await output(runId, 'SORTIE_UTILE', '6100.000');
    await output(runId, 'SOUS_PRODUIT', '2500.000');
    await output(runId, 'REWORK', '800.000');
    await output(runId, 'PERTE_REELLE', '500.000');

    const balance = await materialBalance(context.pool, runId);
    assert.equal(balance.inputKg, '10000.000');
    assert.equal(balance.usefulKg, '6100.000');
    assert.equal(balance.byProductKg, '2500.000');
    assert.equal(balance.reworkKg, '800.000');
    assert.equal(balance.realLossKg, '500.000');
    assert.equal(balance.accountedKg, '9900.000');
    assert.equal(balance.differenceKg, '100.000');
    assert.equal(balance.differencePercent, '1.00');
    assert.equal(balance.balanceStatus, 'ECART_A_JUSTIFIER');
    // Seule la sortie utile compte au numérateur du rendement.
    assert.equal(balance.yieldPercent, '61.00');
  });

  it("n'inclut pas les sous-produits, le rework ni les pertes dans le rendement", async () => {
    const runId = await newRun();
    const lotId = await receive('1000.000');
    await consume(runId, lotId, '1000.000');
    await output(runId, 'SOUS_PRODUIT', '400.000');
    await output(runId, 'PERTE_REELLE', '100.000');

    const balance = await materialBalance(context.pool, runId);
    assert.equal(balance.usefulKg, '0.000');
    assert.equal(balance.yieldPercent, '0.00');
  });

  it("refuse de terminer un Run dont l'écart matière n'est pas justifié", async () => {
    const runId = await newRun();
    const lotId = await receive('10000.000');
    await consume(runId, lotId, '10000.000');
    await output(runId, 'SORTIE_UTILE', '6000.000');

    await assert.rejects(
      finishRun(context.pool, runId, context.fixtures.users.PRODUCTION),
      /Écart matière à justifier/,
    );

    await justifyMaterialDifference(
      context.pool,
      runId,
      'Pesée de sortie incomplète, contrôle programmé',
      context.fixtures.users.PRODUCTION,
    );
    const finished = await finishRun(context.pool, runId, context.fixtures.users.PRODUCTION);
    assert.equal(finished.status, 'TERMINE');
  });

  it("refuse de terminer un Run sans matière consommée", async () => {
    const runId = await newRun();
    await assert.rejects(
      finishRun(context.pool, runId, context.fixtures.users.PRODUCTION),
      /aucune matière première consommée/,
    );
  });

  it("un Run terminé n'accepte plus de saisie", async () => {
    const runId = await newRun();
    const lotId = await receive('1000.000');
    await consume(runId, lotId, '1000.000');
    await output(runId, 'SORTIE_UTILE', '1000.000');
    await finishRun(context.pool, runId, context.fixtures.users.PRODUCTION);

    await assert.rejects(consume(runId, lotId, '10.000'), /terminé/);
    await assert.rejects(output(runId, 'SORTIE_UTILE', '10.000'), /terminé/);
  });

  it('corrige une consommation validée par annulation et remplacement', async () => {
    const runId = await newRun();
    const lotId = await receive('5000.000');
    const consumption = await consume(runId, lotId, '2000.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '3000.000');

    const correction = await correctConsumption(
      context.pool,
      consumption.id,
      '1800.000',
      'Erreur de pesée',
      context.fixtures.users.PRODUCTION,
    );
    assert.notEqual(correction.replacementId, null);

    // La consommation effective est de 1 800 kg, sans écrasement de l'original.
    const balance = await materialBalance(context.pool, runId);
    assert.equal(balance.inputKg, '1800.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '3200.000');

    const detail = await runDetail(context.pool, runId);
    assert.equal(detail.consumptions.length, 2, "l'historique conserve la ligne annulée");
    assert.deepEqual(
      detail.consumptions.map((row) => row.status).sort(),
      ['ANNULE', 'VALIDE'],
    );

    const audit = await context.pool.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'PRODUCTION_CONSOMMATION_CORRECTION'",
    );
    assert.ok(audit.rows.length >= 1, 'la correction est auditée');
  });

  it("l'annulation d'un Run restitue le stock consommé et conserve l'historique", async () => {
    const runId = await newRun();
    const lotId = await receive('4000.000');
    await consume(runId, lotId, '1500.000');
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '2500.000');

    const cancelled = await cancelRun(
      context.pool,
      runId,
      'Arrêt de production',
      context.fixtures.users.PRODUCTION,
    );
    assert.equal(cancelled.reversedConsumptions, 1);
    assert.equal(await stockAt(context.pool, lotId, context.fixtures.oceamic2Id), '4000.000');

    const detail = await runDetail(context.pool, runId);
    assert.equal(detail.run.status, 'ANNULE');
    assert.equal(detail.consumptions.length, 1, 'le Run annulé reste dans l historique');
    assert.equal(detail.run.cancellationReason, 'Arrêt de production');
  });

  it('une perte réelle doit être motivée', async () => {
    const runId = await newRun();
    await assert.rejects(
      recordOutput(
        context.pool,
        runId,
        {
          outputType: 'PERTE_REELLE',
          quantityKg: '10.000',
          occurredAt: new Date(),
          productionLineId: null,
          destinationStageId: null,
          destinationLocationId: null,
          lossReasonId: null,
          reasonText: null,
          notes: null,
        },
        context.fixtures.users.PRODUCTION,
      ),
      /motivée/,
    );
  });
});
