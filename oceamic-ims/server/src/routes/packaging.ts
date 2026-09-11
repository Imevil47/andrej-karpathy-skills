import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { PACKAGING_BATCH_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  finishedGoodLotSituation,
  listFinishedGoodLots,
  listPackagingBatches,
  packagingBatchDetail,
} from '../services/fgQueries.ts';
import {
  cancelPackagingBatch,
  closePackagingBatch,
  createFinishedGoodLot,
  createPackagingBatch,
  recordLabelCheck,
  recordPackagingOutput,
} from '../services/packaging.ts';

export async function registerPackagingRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/packaging-batches', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({
        run: uuidSchema.nullish(),
        statut: z.enum(PACKAGING_BATCH_STATUSES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listPackagingBatches(pool, {
      runId: query.run ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/packaging-batches/:id', async (request, reply) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await packagingBatchDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: "Lot d'emballage introuvable." };
    }
    return detail;
  });

  app.post('/api/packaging-batches', async (request, reply) => {
    const user = requirePermission(request, 'packaging:manage');
    const input = z
      .object({
        productionRunId: uuidSchema,
        sterilizationCycleId: uuidSchema.nullable(),
        format: z.string().trim().min(1).nullable(),
        responsibleUserId: uuidSchema.nullable(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createPackagingBatch(pool, input, user.id);
  });

  app.post('/api/packaging-batches/:id/cloture', async (request) => {
    const user = requirePermission(request, 'packaging:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await closePackagingBatch(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/packaging-batches/:id/annulation', async (request) => {
    const user = requirePermission(request, 'packaging:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelPackagingBatch(pool, id, reason, user.id);
    return { status: 'ok' };
  });

  app.post('/api/packaging-batches/:id/lots-pf', async (request, reply) => {
    const user = requirePermission(request, 'packaging:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        format: z.string().trim().min(1).nullable(),
        piecesPerCan: z.number().int().positive().nullable(),
        productionDate: z.iso.date(),
        bestBeforeDate: z.iso.date().nullable(),
        notes: z.string().trim().min(1).nullable(),
        sources: z
          .array(
            z.object({
              sterilizationCycleId: uuidSchema,
              productionRunId: uuidSchema,
              quantityUnits: z.number().int().positive().nullable(),
            }),
          )
          .min(1),
      })
      .parse(request.body);
    reply.status(201);
    return createFinishedGoodLot(pool, { packagingBatchId: id, ...input }, user.id);
  });

  app.post('/api/packaging-batches/:id/sorties', async (request, reply) => {
    const user = requirePermission(request, 'packaging:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        finishedGoodLotId: uuidSchema,
        quantityCans: z.number().int().positive(),
        quantityCartons: z.number().int().positive(),
        unitsPerCarton: z.number().int().positive(),
        occurredAt: z.coerce.date(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return recordPackagingOutput(pool, id, input, user.id);
  });

  app.post('/api/packaging-batches/:id/controles-etiquette', async (request, reply) => {
    const user = requirePermission(request, 'packaging:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        finishedGoodLotId: uuidSchema,
        productCorrect: z.boolean(),
        lotCorrect: z.boolean(),
        dateCorrect: z.boolean(),
        labelCorrect: z.boolean(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return recordLabelCheck(pool, id, input, user.id);
  });

  app.get('/api/finished-good-lots', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({
        recherche: z.string().trim().min(1).nullish(),
        run: uuidSchema.nullish(),
        statutQualite: z.string().nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listFinishedGoodLots(pool, {
      search: query.recherche ?? null,
      productionRunId: query.run ?? null,
      qualityStatus: query.statutQualite ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/finished-good-lots/:id/situation', async (request, reply) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const situation = await finishedGoodLotSituation(pool, id);
    if (situation === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Lot PF introuvable.' };
    }
    return situation;
  });
}
