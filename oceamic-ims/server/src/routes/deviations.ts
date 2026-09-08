import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { DEVIATION_SEVERITIES, DEVIATION_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  completeCorrectiveAction,
  createCorrectiveAction,
  createDeviation,
  updateDeviationStatus,
} from '../services/deviations.ts';
import { deviationDetail, listDeviations, listRunHolds } from '../services/processQueries.ts';
import { releaseRunHold } from '../services/sterilization.ts';

export async function registerDeviationRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/deviations', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({
        run: uuidSchema.nullish(),
        cycle: uuidSchema.nullish(),
        statut: z.enum(DEVIATION_STATUSES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listDeviations(pool, {
      runId: query.run ?? null,
      sterilizationCycleId: query.cycle ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/deviations/:id', async (request, reply) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await deviationDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Déviation introuvable.' };
    }
    return detail;
  });

  app.post('/api/deviations', async (request, reply) => {
    const user = requirePermission(request, 'deviation:manage');
    const input = z
      .object({
        productionRunId: uuidSchema.nullable(),
        sterilizationCycleId: uuidSchema.nullable(),
        processStage: requiredTextSchema,
        detectedAt: z.coerce.date(),
        deviationType: requiredTextSchema,
        description: requiredTextSchema,
        severity: z.enum(DEVIATION_SEVERITIES),
      })
      .parse(request.body);
    reply.status(201);
    return createDeviation(pool, input, user.id);
  });

  app.post('/api/deviations/:id/statut', async (request) => {
    const user = requirePermission(request, 'deviation:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { status } = z.object({ status: z.enum(DEVIATION_STATUSES) }).parse(request.body);
    await updateDeviationStatus(pool, id, status, user.id);
    return { status: 'ok' };
  });

  app.post('/api/deviations/:id/actions', async (request, reply) => {
    const user = requirePermission(request, 'deviation:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        actionDescription: requiredTextSchema,
        responsibleUserId: uuidSchema.nullable(),
        dueAt: z.coerce.date().nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createCorrectiveAction(pool, id, input, user.id);
  });

  app.post('/api/corrective-actions/:id/cloture', async (request) => {
    const user = requirePermission(request, 'deviation:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { verificationNotes } = z
      .object({ verificationNotes: z.string().trim().min(1).nullable() })
      .parse(request.body);
    await completeCorrectiveAction(pool, id, { verificationNotes }, user.id);
    return { status: 'ok' };
  });

  app.get('/api/production-run-holds', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({
        run: uuidSchema.nullish(),
        actifs: z
          .enum(['true', 'false'])
          .nullish()
          .transform((value) => value !== 'false'),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listRunHolds(pool, {
      runId: query.run ?? null,
      activeOnly: query.actifs,
      limit: query.limite ?? 100,
    });
  });

  app.post('/api/production-run-holds/:id/levee', async (request) => {
    const user = requirePermission(request, 'quality:release');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await releaseRunHold(pool, id, reason, user.id);
    return { status: 'ok' };
  });
}
