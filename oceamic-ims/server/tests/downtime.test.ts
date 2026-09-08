import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRun, startRun } from '../src/services/production.ts';
import { endDowntime, listDowntimeEvents, runDowntimeSummary, startDowntime } from '../src/services/downtime.ts';
import { createTestContext, type TestContext } from './support/context.ts';

let context: TestContext;

async function activeRun(): Promise<{ runId: string; runLineId: string }> {
  const run = await createRun(
    context.pool,
    {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: context.fixtures.productSardineId,
      format: null,
      piecesPerCan: null,
      responsibleUserId: null,
      lines: [{ productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' }],
      notes: null,
    },
    context.fixtures.users.PRODUCTION,
  );
  await startRun(context.pool, run.id, context.fixtures.users.PRODUCTION);
  const runLine = await context.pool.query<{ id: string }>(
    'SELECT id FROM production_run_lines WHERE production_run_id = $1',
    [run.id],
  );
  return { runId: run.id, runLineId: runLine.rows[0]?.id ?? '' };
}

describe('Arrêts de production', () => {
  before(async () => {
    context = await createTestContext();
  });
  after(async () => {
    await context.close();
  });

  it("démarrer un arrêt crée un événement actif (ended_at = NULL)", async () => {
    const { runId } = await activeRun();
    const event = await startDowntime(
      context.pool,
      runId,
      {
        productionRunLineId: null,
        downtimeCategoryId: context.fixtures.downtimeCategoryId,
        reasonText: null,
        planned: false,
        startedAt: new Date(),
      },
      context.fixtures.users.PRODUCTION,
    );
    assert.equal(event.endedAt, null);

    const active = await listDowntimeEvents(context.pool, {
      runId,
      runLineId: null,
      categoryId: null,
      activeOnly: true,
      limit: 10,
    });
    assert.equal(active.length, 1);
  });

  it('terminer un arrêt calcule automatiquement la durée', async () => {
    const { runId } = await activeRun();
    const start = new Date(Date.now() - 27 * 60 * 1000);
    const event = await startDowntime(
      context.pool,
      runId,
      {
        productionRunLineId: null,
        downtimeCategoryId: context.fixtures.downtimeCategoryId,
        reasonText: 'Bourrage',
        planned: false,
        startedAt: start,
      },
      context.fixtures.users.PRODUCTION,
    );

    const closed = await endDowntime(context.pool, event.id, new Date(), context.fixtures.users.PRODUCTION);
    assert.equal(closed.durationSeconds, 27 * 60);

    const summary = await runDowntimeSummary(context.pool, runId);
    assert.equal(summary.totalDowntimeSeconds, 27 * 60);
    assert.equal(summary.activeDowntimeCount, 0);
    assert.equal(summary.closedDowntimeCount, 1);
  });

  it("l'heure de fin ne peut pas précéder l'heure de début", async () => {
    const { runId } = await activeRun();
    const start = new Date();
    const event = await startDowntime(
      context.pool,
      runId,
      {
        productionRunLineId: null,
        downtimeCategoryId: context.fixtures.downtimeCategoryId,
        reasonText: null,
        planned: false,
        startedAt: start,
      },
      context.fixtures.users.PRODUCTION,
    );

    await assert.rejects(
      endDowntime(
        context.pool,
        event.id,
        new Date(start.getTime() - 60_000),
        context.fixtures.users.PRODUCTION,
      ),
      /ne peut pas précéder/,
    );
  });

  it('supporte un arrêt au niveau du Run entier (sans ligne)', async () => {
    const { runId } = await activeRun();
    const event = await startDowntime(
      context.pool,
      runId,
      {
        productionRunLineId: null,
        downtimeCategoryId: context.fixtures.downtimeCategoryId,
        reasonText: 'Coupure générale',
        planned: false,
        startedAt: new Date(),
      },
      context.fixtures.users.PRODUCTION,
    );
    assert.equal(event.productionRunLineId, null);
  });

  it('supporte un arrêt limité à une ligne', async () => {
    const { runId, runLineId } = await activeRun();
    const event = await startDowntime(
      context.pool,
      runId,
      {
        productionRunLineId: runLineId,
        downtimeCategoryId: context.fixtures.downtimeCategoryId,
        reasonText: null,
        planned: true,
        startedAt: new Date(),
      },
      context.fixtures.users.PRODUCTION,
    );
    assert.equal(event.productionRunLineId, runLineId);

    const scoped = await listDowntimeEvents(context.pool, {
      runId: null,
      runLineId,
      categoryId: null,
      activeOnly: false,
      limit: 10,
    });
    assert.equal(scoped.length, 1);
  });

  it("l'historique des arrêts reste consultable après clôture", async () => {
    const { runId } = await activeRun();
    const event = await startDowntime(
      context.pool,
      runId,
      {
        productionRunLineId: null,
        downtimeCategoryId: context.fixtures.downtimeCategoryId,
        reasonText: 'Nettoyage programmé',
        planned: true,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
      context.fixtures.users.PRODUCTION,
    );
    await endDowntime(context.pool, event.id, new Date(), context.fixtures.users.PRODUCTION);

    const history = await listDowntimeEvents(context.pool, {
      runId,
      runLineId: null,
      categoryId: null,
      activeOnly: false,
      limit: 10,
    });
    assert.equal(history.length, 1);
    assert.notEqual(history[0]?.durationSeconds, null);
  });

  it('refuse de terminer un arrêt déjà terminé', async () => {
    const { runId } = await activeRun();
    const event = await startDowntime(
      context.pool,
      runId,
      {
        productionRunLineId: null,
        downtimeCategoryId: context.fixtures.downtimeCategoryId,
        reasonText: null,
        planned: false,
        startedAt: new Date(),
      },
      context.fixtures.users.PRODUCTION,
    );
    await endDowntime(context.pool, event.id, new Date(), context.fixtures.users.PRODUCTION);

    await assert.rejects(
      endDowntime(context.pool, event.id, new Date(), context.fixtures.users.PRODUCTION),
      /déjà terminé/,
    );
  });
});
