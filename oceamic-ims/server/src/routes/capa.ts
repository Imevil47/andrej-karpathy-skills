import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { CAPA_ACTION_TYPES, CAPA_STATUSES, CAPA_TYPES, QMS_PRIORITIES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  addCapaAction,
  cancelCapa,
  cancelCapaAction,
  closeCapa,
  completeCapaAction,
  createCapa,
  recordEffectivenessCheck,
} from '../services/capa.ts';
import { capaDetail, listCapaRecords } from '../services/qmsQueries.ts';

export async function registerCapaRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/capa', async (request) => {
    requirePermission(request, 'qms:read');
    const query = z
      .object({
        recherche: z.string().trim().min(1).nullish(),
        statut: z.enum(CAPA_STATUSES).nullish(),
        responsable: uuidSchema.nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listCapaRecords(pool, {
      search: query.recherche ?? null,
      status: query.statut ?? null,
      ownerUserId: query.responsable ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/capa/:id', async (request, reply) => {
    requirePermission(request, 'qms:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await capaDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'CAPA introuvable.' };
    }
    return detail;
  });

  app.post('/api/capa', async (request, reply) => {
    const user = requirePermission(request, 'capa:manage');
    const input = z
      .object({
        sourceNonconformityId: uuidSchema.nullable(),
        title: requiredTextSchema,
        description: requiredTextSchema,
        capaType: z.enum(CAPA_TYPES),
        priority: z.enum(QMS_PRIORITIES),
        ownerUserId: uuidSchema,
        openedAt: z.coerce.date(),
        dueAt: z.coerce.date().nullable(),
        effectivenessRequired: z.boolean(),
      })
      .parse(request.body);
    reply.status(201);
    return createCapa(pool, input, user.id);
  });

  app.post('/api/capa/:id/actions', async (request, reply) => {
    const user = requirePermission(request, 'capa:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        actionType: z.enum(CAPA_ACTION_TYPES),
        description: requiredTextSchema,
        responsibleUserId: uuidSchema,
        plannedDate: z.iso.date().nullable(),
        dueDate: z.iso.date().nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return addCapaAction(pool, id, input, user.id);
  });

  app.post('/api/capa-actions/:id/completion', async (request) => {
    const user = requirePermission(request, 'action:complete');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { evidence } = z.object({ evidence: z.string().trim().min(1).nullable() }).parse(request.body);
    await completeCapaAction(pool, id, evidence, user.id);
    return { status: 'ok' };
  });

  app.post('/api/capa-actions/:id/annulation', async (request) => {
    const user = requirePermission(request, 'capa:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await cancelCapaAction(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/capa/:id/efficacite', async (request, reply) => {
    const user = requirePermission(request, 'capa:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        checkedAt: z.coerce.date(),
        method: requiredTextSchema,
        result: requiredTextSchema,
        effective: z.boolean(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return recordEffectivenessCheck(pool, id, input, user.id);
  });

  app.post('/api/capa/:id/cloture', async (request) => {
    const user = requirePermission(request, 'capa:approve');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await closeCapa(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/capa/:id/annulation', async (request) => {
    const user = requirePermission(request, 'capa:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelCapa(pool, id, reason, user.id);
    return { status: 'ok' };
  });
}
