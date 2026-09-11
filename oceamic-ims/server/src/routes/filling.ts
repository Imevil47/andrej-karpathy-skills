import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { FILLING_OPERATION_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  cancelFillingOperation,
  closeFillingOperation,
  correctWeightSample,
  createFillingOperation,
  recordWeightSample,
  startWeightControl,
} from '../services/filling.ts';
import { listFillingOperations, listWeightControls, weightControlDetail } from '../services/processQueries.ts';

const weightGramsSchema = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, 'Poids invalide.')
  .refine((value) => Number(value) > 0, 'Le poids doit être strictement positif.');

export async function registerFillingRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/filling-operations', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({
        run: uuidSchema.nullish(),
        statut: z.enum(FILLING_OPERATION_STATUSES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listFillingOperations(pool, {
      runId: query.run ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.post('/api/production/runs/:id/remplissage', async (request, reply) => {
    const user = requirePermission(request, 'filling:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        productionLineId: uuidSchema.nullable(),
        format: z.string().trim().min(1).nullable(),
        piecesPerCan: z.number().int().positive().nullable(),
        fillingMediumId: uuidSchema.nullable(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createFillingOperation(pool, { productionRunId: id, ...input }, user.id);
  });

  app.post('/api/filling-operations/:id/cloture', async (request) => {
    const user = requirePermission(request, 'filling:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await closeFillingOperation(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/filling-operations/:id/annulation', async (request) => {
    const user = requirePermission(request, 'filling:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelFillingOperation(pool, id, reason, user.id);
    return { status: 'ok' };
  });

  app.post('/api/filling-operations/:id/controles-poids', async (request, reply) => {
    const user = requirePermission(request, 'weight:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({ sampleSize: z.number().int().positive(), controlledAt: z.coerce.date() })
      .parse(request.body);
    reply.status(201);
    return startWeightControl(pool, id, input, user.id);
  });

  app.get('/api/filling-weight-controls', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({
        run: uuidSchema.nullish(),
        operation: uuidSchema.nullish(),
        statut: z.enum(['CONFORME', 'A_CORRIGER', 'NON_CONFORME', 'INCOMPLET']).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listWeightControls(pool, {
      runId: query.run ?? null,
      fillingOperationId: query.operation ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 200,
    });
  });

  app.get('/api/filling-weight-controls/:id', async (request, reply) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await weightControlDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Contrôle poids introuvable.' };
    }
    return detail;
  });

  app.post('/api/filling-weight-controls/:id/echantillons', async (request, reply) => {
    const user = requirePermission(request, 'weight:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({ sampleNumber: z.number().int().positive(), measuredWeightG: weightGramsSchema })
      .parse(request.body);
    reply.status(201);
    return recordWeightSample(pool, id, input, user.id);
  });

  app.post('/api/filling-weight-samples/:id/correction', async (request, reply) => {
    const user = requirePermission(request, 'weight:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({ correctedWeightG: weightGramsSchema.nullable(), reason: requiredTextSchema })
      .parse(request.body);
    reply.status(201);
    return correctWeightSample(pool, id, input.correctedWeightG, input.reason, user.id);
  });
}
