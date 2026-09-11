import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { OUTPUT_TYPES, RUN_LINE_ACTIVITIES, RUN_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, quantityKgSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  cancelOutput,
  cancelRun,
  consumeRawMaterial,
  correctConsumption,
  createRun,
  finishRun,
  justifyMaterialDifference,
  materialBalance,
  recordOutput,
  startRun,
} from '../services/production.ts';
import { listRuns, runDetail } from '../services/productionQueries.ts';

const listSchema = z.object({
  du: z.iso.date().nullish(),
  au: z.iso.date().nullish(),
  espece: uuidSchema.nullish(),
  produit: uuidSchema.nullish(),
  statut: z.enum(RUN_STATUSES).nullish(),
  limite: limitSchema.nullish(),
});

const createRunSchema = z.object({
  productionDate: z.iso.date(),
  productId: uuidSchema,
  format: z.string().trim().min(1).nullable(),
  piecesPerCan: z.number().int().positive().nullable(),
  responsibleUserId: uuidSchema.nullable(),
  lines: z.array(
    z.object({
      productionLineId: uuidSchema,
      activityType: z.enum(RUN_LINE_ACTIVITIES),
    }),
  ),
  notes: z.string().trim().min(1).nullable(),
});

const consumptionSchema = z.object({
  rawMaterialLotId: uuidSchema,
  sourceLocationId: uuidSchema,
  quantityKg: quantityKgSchema,
  consumedAt: z.coerce.date(),
  notes: z.string().trim().min(1).nullable(),
});

const correctionSchema = z.object({
  correctedQuantityKg: quantityKgSchema.nullable(),
  reason: requiredTextSchema,
});

const outputSchema = z.object({
  outputType: z.enum(OUTPUT_TYPES),
  quantityKg: quantityKgSchema,
  occurredAt: z.coerce.date(),
  productionLineId: uuidSchema.nullable(),
  destinationStageId: uuidSchema.nullable(),
  destinationLocationId: uuidSchema.nullable(),
  lossReasonId: uuidSchema.nullable(),
  reasonText: z.string().trim().min(1).nullable(),
  notes: z.string().trim().min(1).nullable(),
});

const idParamSchema = z.object({ id: uuidSchema });

export async function registerProductionRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/production/runs', async (request) => {
    requirePermission(request, 'production:read');
    const query = listSchema.parse(request.query);
    return listRuns(pool, {
      productionDateFrom: query.du ?? null,
      productionDateTo: query.au ?? null,
      speciesId: query.espece ?? null,
      productId: query.produit ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/production/runs/:id', async (request) => {
    requirePermission(request, 'production:read');
    const { id } = idParamSchema.parse(request.params);
    return runDetail(pool, id);
  });

  app.get('/api/production/runs/:id/bilan', async (request) => {
    requirePermission(request, 'production:read');
    const { id } = idParamSchema.parse(request.params);
    return materialBalance(pool, id);
  });

  app.post('/api/production/runs', async (request, reply) => {
    const user = requirePermission(request, 'production:run');
    const input = createRunSchema.parse(request.body);
    reply.status(201);
    return createRun(pool, input, user.id);
  });

  app.post('/api/production/runs/:id/demarrage', async (request) => {
    const user = requirePermission(request, 'production:run');
    const { id } = idParamSchema.parse(request.params);
    return startRun(pool, id, user.id);
  });

  app.post('/api/production/runs/:id/cloture', async (request) => {
    const user = requirePermission(request, 'production:run');
    const { id } = idParamSchema.parse(request.params);
    return finishRun(pool, id, user.id);
  });

  app.post('/api/production/runs/:id/annulation', async (request) => {
    const user = requirePermission(request, 'production:run');
    const { id } = idParamSchema.parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    return cancelRun(pool, id, reason, user.id);
  });

  app.post('/api/production/runs/:id/justification-ecart', async (request) => {
    const user = requirePermission(request, 'production:run');
    const { id } = idParamSchema.parse(request.params);
    const { justification } = z
      .object({ justification: requiredTextSchema })
      .parse(request.body);
    await justifyMaterialDifference(pool, id, justification, user.id);
    return { status: 'ok' };
  });

  // Raw material consumption reuses the Phase 1 stock engine: availability,
  // quality blocking and concurrency protection are enforced there.
  app.post('/api/production/runs/:id/consommations', async (request, reply) => {
    const user = requirePermission(request, 'production:material');
    const { id } = idParamSchema.parse(request.params);
    const input = consumptionSchema.parse(request.body);
    reply.status(201);
    return consumeRawMaterial(pool, id, input, user.id);
  });

  app.post('/api/production/consommations/:id/correction', async (request, reply) => {
    const user = requirePermission(request, 'production:correct');
    const { id } = idParamSchema.parse(request.params);
    const input = correctionSchema.parse(request.body);
    reply.status(201);
    return correctConsumption(pool, id, input.correctedQuantityKg, input.reason, user.id);
  });

  app.post('/api/production/runs/:id/sorties', async (request, reply) => {
    const user = requirePermission(request, 'production:output');
    const { id } = idParamSchema.parse(request.params);
    const input = outputSchema.parse(request.body);
    reply.status(201);
    return recordOutput(pool, id, input, user.id);
  });

  app.post('/api/production/sorties/:id/annulation', async (request) => {
    const user = requirePermission(request, 'production:correct');
    const { id } = idParamSchema.parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelOutput(pool, id, reason, user.id);
    return { status: 'ok' };
  });
}
