import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import {
  AUDIT_FINDING_STATUSES,
  AUDIT_FINDING_TYPES,
  AUDIT_RESPONSE_RESULTS,
  AUDIT_STATUSES,
  AUDIT_TYPES,
  QMS_SEVERITIES,
} from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  cancelAudit,
  completeAudit,
  createAudit,
  createAuditFinding,
  createNonconformityFromFinding,
  recordAuditResponse,
  startAudit,
  updateAuditFindingStatus,
} from '../services/audits.ts';
import { auditDetail, listAudits } from '../services/qmsQueries.ts';

export async function registerAuditRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/audits', async (request) => {
    requirePermission(request, 'qms:read');
    const query = z
      .object({
        statut: z.enum(AUDIT_STATUSES).nullish(),
        type: z.enum(AUDIT_TYPES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listAudits(pool, {
      status: query.statut ?? null,
      auditType: query.type ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/audits/:id', async (request, reply) => {
    requirePermission(request, 'qms:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await auditDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Audit introuvable.' };
    }
    return detail;
  });

  app.post('/api/audits', async (request, reply) => {
    const user = requirePermission(request, 'audit:plan');
    const input = z
      .object({
        auditType: z.enum(AUDIT_TYPES),
        title: requiredTextSchema,
        auditChecklistId: uuidSchema.nullable(),
        plannedDate: z.iso.date(),
        scope: requiredTextSchema,
        leadAuditorUserId: uuidSchema,
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createAudit(pool, input, user.id);
  });

  app.post('/api/audits/:id/demarrage', async (request) => {
    const user = requirePermission(request, 'audit:conduct');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await startAudit(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/audits/:id/cloture', async (request) => {
    const user = requirePermission(request, 'audit:conduct');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await completeAudit(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/audits/:id/annulation', async (request) => {
    const user = requirePermission(request, 'audit:plan');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelAudit(pool, id, reason, user.id);
    return { status: 'ok' };
  });

  app.post('/api/audits/:id/reponses', async (request, reply) => {
    const user = requirePermission(request, 'audit:conduct');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        checklistItemId: uuidSchema,
        result: z.enum(AUDIT_RESPONSE_RESULTS),
        observation: z.string().trim().min(1).nullable(),
        evidenceReference: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return recordAuditResponse(pool, id, input, user.id);
  });

  app.post('/api/audits/:id/constats', async (request, reply) => {
    const user = requirePermission(request, 'audit:conduct');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        findingType: z.enum(AUDIT_FINDING_TYPES),
        description: requiredTextSchema,
        severity: z.enum(QMS_SEVERITIES),
        ownerUserId: uuidSchema.nullable(),
        dueAt: z.coerce.date().nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createAuditFinding(pool, id, input, user.id);
  });

  app.post('/api/audit-findings/:id/statut', async (request) => {
    const user = requirePermission(request, 'audit:conduct');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { status } = z.object({ status: z.enum(AUDIT_FINDING_STATUSES) }).parse(request.body);
    await updateAuditFindingStatus(pool, id, status, user.id);
    return { status: 'ok' };
  });

  app.post('/api/audit-findings/:id/non-conformite', async (request, reply) => {
    const user = requirePermission(request, 'audit:conduct');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        detectedAt: z.coerce.date(),
        categoryId: uuidSchema,
        title: requiredTextSchema,
        severity: z.enum(QMS_SEVERITIES),
        ownerUserId: uuidSchema.nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createNonconformityFromFinding(pool, id, input, user.id);
  });
}
