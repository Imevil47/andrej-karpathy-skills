import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import {
  NONCONFORMITY_LINK_RELATIONSHIPS,
  NONCONFORMITY_STATUSES,
  QMS_BLOCKABLE_ENTITY_TYPES,
  QMS_ENTITY_TYPES,
  QMS_PRIORITIES,
  QMS_SEVERITIES,
  ROOT_CAUSE_METHODS,
} from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  addNonconformityLink,
  createNonconformity,
  openNcrQualityBlock,
  recordInvestigation,
  recordRootCauseAnalysis,
  updateNonconformityOwner,
  updateNonconformitySeverity,
  updateNonconformityStatus,
  validateRootCause,
} from '../services/nonconformities.ts';
import { listNonconformities, nonconformityDetail, repeatNonconformitiesByCategory } from '../services/qmsQueries.ts';

const linkInputSchema = z.object({
  entityType: z.enum(QMS_ENTITY_TYPES),
  entityId: uuidSchema,
  relationshipType: z.enum(NONCONFORMITY_LINK_RELATIONSHIPS),
});

export async function registerNonconformityRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/nonconformities', async (request) => {
    requirePermission(request, 'qms:read');
    const query = z
      .object({
        recherche: z.string().trim().min(1).nullish(),
        categorie: uuidSchema.nullish(),
        gravite: z.enum(QMS_SEVERITIES).nullish(),
        statut: z.enum(NONCONFORMITY_STATUSES).nullish(),
        responsable: uuidSchema.nullish(),
        source: z.enum(QMS_ENTITY_TYPES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listNonconformities(pool, {
      search: query.recherche ?? null,
      categoryId: query.categorie ?? null,
      severity: query.gravite ?? null,
      status: query.statut ?? null,
      ownerUserId: query.responsable ?? null,
      sourceType: query.source ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/nonconformities/repetitions', async (request) => {
    requirePermission(request, 'qms:read');
    const { jours } = z.object({ jours: z.coerce.number().int().positive().nullish() }).parse(request.query);
    return repeatNonconformitiesByCategory(pool, jours ?? 180);
  });

  app.get('/api/nonconformities/:id', async (request, reply) => {
    requirePermission(request, 'qms:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await nonconformityDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Non-conformité introuvable.' };
    }
    return detail;
  });

  app.post('/api/nonconformities', async (request, reply) => {
    const user = requirePermission(request, 'ncr:manage');
    const input = z
      .object({
        detectedAt: z.coerce.date(),
        sourceType: z.enum(QMS_ENTITY_TYPES).nullable(),
        sourceId: uuidSchema.nullable(),
        categoryId: uuidSchema,
        title: requiredTextSchema,
        description: requiredTextSchema,
        severity: z.enum(QMS_SEVERITIES),
        priority: z.enum(QMS_PRIORITIES),
        ownerUserId: uuidSchema.nullable(),
        dueAt: z.coerce.date().nullable(),
        qualityBlockRequired: z.boolean(),
        links: z.array(linkInputSchema),
        confirmSeverityPriority: z.boolean().nullish(),
      })
      .refine((value) => (value.sourceType === null) === (value.sourceId === null), {
        message: 'sourceType et sourceId doivent être renseignés ensemble.',
      })
      .parse(request.body);
    reply.status(201);
    return createNonconformity(
      pool,
      { ...input, confirmSeverityPriority: input.confirmSeverityPriority ?? false, detectedBy: user.id },
      user.id,
    );
  });

  app.post('/api/nonconformities/:id/liens', async (request, reply) => {
    const user = requirePermission(request, 'ncr:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = linkInputSchema.parse(request.body);
    reply.status(201);
    await addNonconformityLink(pool, id, input, user.id);
    return { status: 'ok' };
  });

  app.post('/api/nonconformities/:id/gravite', async (request) => {
    const user = requirePermission(request, 'ncr:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { severity, confirmSeverityPriority } = z
      .object({ severity: z.enum(QMS_SEVERITIES), confirmSeverityPriority: z.boolean().nullish() })
      .parse(request.body);
    await updateNonconformitySeverity(pool, id, severity, confirmSeverityPriority ?? false, user.id);
    return { status: 'ok' };
  });

  app.post('/api/nonconformities/:id/responsable', async (request) => {
    const user = requirePermission(request, 'ncr:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { ownerUserId } = z.object({ ownerUserId: uuidSchema.nullable() }).parse(request.body);
    await updateNonconformityOwner(pool, id, ownerUserId, user.id);
    return { status: 'ok' };
  });

  app.post('/api/nonconformities/:id/statut', async (request) => {
    const user = requirePermission(request, 'ncr:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({ status: z.enum(NONCONFORMITY_STATUSES), reason: z.string().trim().min(1).nullable() })
      .parse(request.body);
    await updateNonconformityStatus(pool, id, input.status, input.reason, user.id);
    return { status: 'ok' };
  });

  app.post('/api/nonconformities/:id/investigation', async (request, reply) => {
    const user = requirePermission(request, 'ncr:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        startedAt: z.coerce.date(),
        completedAt: z.coerce.date().nullable(),
        investigatorUserId: uuidSchema,
        facts: requiredTextSchema,
        immediateCorrection: z.string().trim().min(1).nullable(),
        impactAssessment: z.string().trim().min(1).nullable(),
        rootCauseRequired: z.boolean(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return recordInvestigation(pool, id, input, user.id);
  });

  app.post('/api/nonconformities/:id/cause-racine', async (request, reply) => {
    const user = requirePermission(request, 'ncr:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        method: z.enum(ROOT_CAUSE_METHODS),
        analysisText: requiredTextSchema,
        rootCause: requiredTextSchema,
      })
      .parse(request.body);
    reply.status(201);
    return recordRootCauseAnalysis(pool, id, input, user.id);
  });

  app.post('/api/root-cause-analyses/:id/validation', async (request) => {
    const user = requirePermission(request, 'ncr:approve');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await validateRootCause(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/nonconformities/:id/blocage', async (request, reply) => {
    const user = requirePermission(request, 'ncr:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        entityType: z.enum(QMS_BLOCKABLE_ENTITY_TYPES),
        entityId: uuidSchema,
        reason: requiredTextSchema,
      })
      .parse(request.body);
    reply.status(201);
    await openNcrQualityBlock(pool, id, input.entityType, input.entityId, input.reason, user.id);
    return { status: 'ok' };
  });
}
