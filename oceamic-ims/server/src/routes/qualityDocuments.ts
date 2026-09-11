import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { QUALITY_DOCUMENT_STATUSES, QUALITY_DOCUMENT_TYPES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  acknowledgeDocument,
  activateRevision,
  approveRevision,
  assignAcknowledgment,
  cancelRevision,
  createQualityDocument,
  createRevision,
  submitRevisionForReview,
} from '../services/qualityDocuments.ts';
import { listAcknowledgments, listQualityDocuments, qualityDocumentDetail } from '../services/qmsQueries.ts';

export async function registerQualityDocumentRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/quality-documents', async (request) => {
    requirePermission(request, 'qms:read');
    const query = z
      .object({
        recherche: z.string().trim().min(1).nullish(),
        statut: z.enum(QUALITY_DOCUMENT_STATUSES).nullish(),
        type: z.enum(QUALITY_DOCUMENT_TYPES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listQualityDocuments(pool, {
      search: query.recherche ?? null,
      status: query.statut ?? null,
      documentType: query.type ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/quality-documents/:id', async (request, reply) => {
    requirePermission(request, 'qms:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await qualityDocumentDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Document qualité introuvable.' };
    }
    return detail;
  });

  app.get('/api/document-revisions/:id/acquittements', async (request) => {
    requirePermission(request, 'qms:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listAcknowledgments(pool, id);
  });

  app.post('/api/quality-documents', async (request, reply) => {
    const user = requirePermission(request, 'document:manage');
    const input = z
      .object({
        documentCode: requiredTextSchema,
        title: requiredTextSchema,
        documentType: z.enum(QUALITY_DOCUMENT_TYPES),
        department: z.string().trim().min(1).nullable(),
        ownerUserId: uuidSchema,
        changeSummary: requiredTextSchema,
      })
      .parse(request.body);
    reply.status(201);
    return createQualityDocument(pool, input, user.id);
  });

  app.post('/api/quality-documents/:id/revisions', async (request, reply) => {
    const user = requirePermission(request, 'document:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        changeSummary: requiredTextSchema,
        fileReference: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createRevision(pool, id, input, user.id);
  });

  app.post('/api/document-revisions/:id/soumission', async (request) => {
    const user = requirePermission(request, 'document:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await submitRevisionForReview(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/document-revisions/:id/approbation', async (request) => {
    const user = requirePermission(request, 'document:approve');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await approveRevision(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/document-revisions/:id/mise-en-vigueur', async (request) => {
    const user = requirePermission(request, 'document:approve');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await activateRevision(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/document-revisions/:id/annulation', async (request) => {
    const user = requirePermission(request, 'document:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelRevision(pool, id, reason, user.id);
    return { status: 'ok' };
  });

  app.post('/api/document-revisions/:id/acquittements', async (request, reply) => {
    const user = requirePermission(request, 'document:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { userId } = z.object({ userId: uuidSchema }).parse(request.body);
    reply.status(201);
    return assignAcknowledgment(pool, id, userId, user.id);
  });

  app.post('/api/acknowledgments/:id/confirmation', async (request) => {
    const user = requirePermission(request, 'qms:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await acknowledgeDocument(pool, id, user.id);
    return { status: 'ok' };
  });
}
