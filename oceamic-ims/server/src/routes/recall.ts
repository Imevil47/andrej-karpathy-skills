import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import {
  QMS_SEVERITIES,
  RECALL_AFFECTED_ENTITY_STATUSES,
  RECALL_EVENT_TYPES,
  RECALL_STATUSES,
  RECALL_TARGET_ENTITY_TYPES,
} from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  closeRecallEvent,
  createRecallEvent,
  massBalanceForFinishedGoodLot,
  refreshRecallImpact,
  updateAffectedEntityStatus,
  updateRecallEventStatus,
} from '../services/recall.ts';
import { listRecallEvents, recallEventDetail } from '../services/qmsQueries.ts';

export async function registerRecallRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/recall-events', async (request) => {
    requirePermission(request, 'qms:read');
    const query = z
      .object({
        statut: z.enum(RECALL_STATUSES).nullish(),
        type: z.enum(RECALL_EVENT_TYPES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listRecallEvents(pool, {
      status: query.statut ?? null,
      eventType: query.type ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/recall-events/:id', async (request, reply) => {
    requirePermission(request, 'qms:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await recallEventDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Retrait / rappel introuvable.' };
    }
    return detail;
  });

  app.get('/api/finished-good-lots/:id/bilan-matiere', async (request) => {
    requirePermission(request, 'qms:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return massBalanceForFinishedGoodLot(pool, id);
  });

  app.post('/api/recall-events', async (request, reply) => {
    const input = z
      .object({
        eventType: z.enum(RECALL_EVENT_TYPES),
        targetEntityType: z.enum(RECALL_TARGET_ENTITY_TYPES),
        targetEntityId: uuidSchema,
        reason: requiredTextSchema,
        severity: z.enum(QMS_SEVERITIES),
        scopeDescription: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    // A mock traceability exercise stays QUALITE's routine work; a real
    // withdrawal/recall requires RESPONSABLE_QUALITE's authority
    // (section 53/54).
    const user =
      input.eventType === 'EXERCICE_TRACABILITE'
        ? requirePermission(request, 'recall:exercise')
        : requirePermission(request, 'recall:manage');
    reply.status(201);
    return createRecallEvent(pool, input, user.id);
  });

  app.post('/api/recall-events/:id/actualisation', async (request) => {
    const user = requirePermission(request, 'recall:exercise');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const added = await refreshRecallImpact(pool, id, user.id);
    return { status: 'ok', added };
  });

  app.post('/api/recall-events/:id/statut', async (request) => {
    const user = requirePermission(request, 'recall:exercise');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { status } = z.object({ status: z.enum(RECALL_STATUSES) }).parse(request.body);
    await updateRecallEventStatus(pool, id, status, user.id);
    return { status: 'ok' };
  });

  app.post('/api/recall-events/:id/cloture', async (request) => {
    const user = requirePermission(request, 'recall:exercise');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { observations } = z.object({ observations: requiredTextSchema }).parse(request.body);
    await closeRecallEvent(pool, id, observations, user.id);
    return { status: 'ok' };
  });

  app.post('/api/recall-affected-entities/:id/statut', async (request) => {
    const user = requirePermission(request, 'recall:exercise');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { status } = z.object({ status: z.enum(RECALL_AFFECTED_ENTITY_STATUSES) }).parse(request.body);
    await updateAffectedEntityStatus(pool, id, status, user.id);
    return { status: 'ok' };
  });
}
