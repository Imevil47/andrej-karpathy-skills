import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import { createMarkingEvent, verifyMarkingEvent } from '../services/marking.ts';
import { listMarkingEvents, listSeamingControls, listSeamingOperations, seamingControlDetail } from '../services/processQueries.ts';
import {
  closeSeamingOperation,
  correctSeamingMeasurement,
  createSeamingControl,
  createSeamingOperation,
  recordSeamingMeasurement,
} from '../services/seaming.ts';

const measuredValueSchema = z
  .string()
  .regex(/^-?\d{1,8}(\.\d{1,3})?$/, 'Valeur mesurée invalide.');

export async function registerSeamingRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/seaming-operations', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({ run: uuidSchema.nullish(), statut: z.string().nullish(), limite: limitSchema.nullish() })
      .parse(request.query);
    return listSeamingOperations(pool, {
      runId: query.run ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.post('/api/production/runs/:id/sertissage', async (request, reply) => {
    const user = requirePermission(request, 'seaming:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        fillingOperationId: uuidSchema.nullable(),
        machineId: uuidSchema.nullable(),
        productionLineId: uuidSchema.nullable(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createSeamingOperation(pool, { productionRunId: id, ...input }, user.id);
  });

  app.post('/api/seaming-operations/:id/cloture', async (request) => {
    const user = requirePermission(request, 'seaming:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await closeSeamingOperation(pool, id, user.id);
    return { status: 'ok' };
  });

  app.get('/api/seaming-controls', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({ run: uuidSchema.nullish(), operation: uuidSchema.nullish(), limite: limitSchema.nullish() })
      .parse(request.query);
    return listSeamingControls(pool, {
      runId: query.run ?? null,
      seamingOperationId: query.operation ?? null,
      limit: query.limite ?? 200,
    });
  });

  app.get('/api/seaming-controls/:id', async (request, reply) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await seamingControlDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Contrôle sertissage introuvable.' };
    }
    return detail;
  });

  app.post('/api/seaming-operations/:id/controles', async (request, reply) => {
    const user = requirePermission(request, 'seaming:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        machineId: uuidSchema.nullable(),
        controlledAt: z.coerce.date(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createSeamingControl(pool, id, input, user.id);
  });

  app.post('/api/seaming-controls/:id/mesures', async (request, reply) => {
    const user = requirePermission(request, 'seaming:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        seamingParameterId: uuidSchema,
        sampleNumber: z.number().int().positive().nullable(),
        measuredValue: measuredValueSchema,
        unit: requiredTextSchema,
        productId: uuidSchema.nullable(),
        format: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return recordSeamingMeasurement(pool, id, input, user.id);
  });

  app.post('/api/seaming-measurements/:id/correction', async (request, reply) => {
    const user = requirePermission(request, 'seaming:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({ correctedValue: measuredValueSchema.nullable(), reason: requiredTextSchema })
      .parse(request.body);
    reply.status(201);
    return correctSeamingMeasurement(pool, id, input.correctedValue, input.reason, user.id);
  });

  app.get('/api/marking-events', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({ run: uuidSchema.nullish(), statut: z.string().nullish(), limite: limitSchema.nullish() })
      .parse(request.query);
    return listMarkingEvents(pool, {
      runId: query.run ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.post('/api/production/runs/:id/marquage', async (request, reply) => {
    const user = requirePermission(request, 'marking:record');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        seamingOperationId: uuidSchema.nullable(),
        markedAt: z.coerce.date(),
        markingCode: requiredTextSchema,
        lotCodePrinted: z.string().trim().min(1).nullable(),
        machineId: uuidSchema.nullable(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createMarkingEvent(pool, { productionRunId: id, ...input }, user.id);
  });

  app.post('/api/marking-events/:id/verification', async (request) => {
    const user = requirePermission(request, 'marking:verify');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        checks: z
          .array(
            z.object({
              itemId: uuidSchema,
              passed: z.boolean(),
              notes: z.string().trim().min(1).nullable(),
            }),
          )
          .min(1),
      })
      .parse(request.body);
    await verifyMarkingEvent(pool, id, { checks: input.checks }, user.id);
    return { status: 'ok' };
  });
}
