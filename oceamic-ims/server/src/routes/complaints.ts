import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { CUSTOMER_COMPLAINT_STATUSES, CUSTOMER_COMPLAINT_TYPES, QMS_SEVERITIES, SUPPLIER_INCIDENT_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, uuidSchema } from '../http/schemas.ts';
import {
  createComplaint,
  createNonconformityFromComplaint,
  linkComplaintToCapa,
  updateComplaintStatus,
} from '../services/complaints.ts';
import { complaintDetail, listComplaints, listSupplierIncidents, supplierPerformance } from '../services/qmsQueries.ts';
import { createSupplierIncident, updateSupplierIncidentStatus } from '../services/supplierIncidents.ts';

export async function registerComplaintRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/complaints', async (request) => {
    requirePermission(request, 'qms:read');
    const query = z
      .object({
        recherche: z.string().trim().min(1).nullish(),
        statut: z.enum(CUSTOMER_COMPLAINT_STATUSES).nullish(),
        client: uuidSchema.nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listComplaints(pool, {
      search: query.recherche ?? null,
      status: query.statut ?? null,
      customerId: query.client ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/complaints/:id', async (request, reply) => {
    requirePermission(request, 'qms:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await complaintDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Réclamation introuvable.' };
    }
    return detail;
  });

  app.post('/api/complaints', async (request, reply) => {
    const user = requirePermission(request, 'complaint:manage');
    const input = z
      .object({
        receivedAt: z.coerce.date(),
        customerId: uuidSchema,
        shipmentId: uuidSchema.nullable(),
        finishedGoodLotId: uuidSchema.nullable(),
        palletId: uuidSchema.nullable(),
        complaintType: z.enum(CUSTOMER_COMPLAINT_TYPES),
        description: z.string().trim().min(1),
        severity: z.enum(QMS_SEVERITIES),
        ownerUserId: uuidSchema.nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createComplaint(pool, input, user.id);
  });

  app.post('/api/complaints/:id/statut', async (request) => {
    const user = requirePermission(request, 'complaint:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { status } = z.object({ status: z.enum(CUSTOMER_COMPLAINT_STATUSES) }).parse(request.body);
    await updateComplaintStatus(pool, id, status, user.id);
    return { status: 'ok' };
  });

  app.post('/api/complaints/:id/non-conformite', async (request, reply) => {
    const user = requirePermission(request, 'complaint:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        detectedAt: z.coerce.date(),
        categoryId: uuidSchema,
        title: z.string().trim().min(1),
        description: z.string().trim().min(1),
        severity: z.enum(QMS_SEVERITIES),
        ownerUserId: uuidSchema.nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createNonconformityFromComplaint(pool, id, input, user.id);
  });

  app.post('/api/complaints/:id/capa', async (request) => {
    const user = requirePermission(request, 'complaint:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { capaId } = z.object({ capaId: uuidSchema }).parse(request.body);
    await linkComplaintToCapa(pool, id, capaId, user.id);
    return { status: 'ok' };
  });

  app.get('/api/supplier-incidents', async (request) => {
    requirePermission(request, 'qms:read');
    const query = z
      .object({
        fournisseur: uuidSchema.nullish(),
        statut: z.enum(SUPPLIER_INCIDENT_STATUSES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listSupplierIncidents(pool, {
      supplierId: query.fournisseur ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/suppliers/performance', async (request) => {
    requirePermission(request, 'qms:read');
    const { jours } = z.object({ jours: z.coerce.number().int().positive().nullish() }).parse(request.query);
    return supplierPerformance(pool, jours ?? 365);
  });

  app.post('/api/supplier-incidents', async (request, reply) => {
    const user = requirePermission(request, 'supplierincident:manage');
    const input = z
      .object({
        supplierId: uuidSchema,
        rawMaterialLotId: uuidSchema.nullable(),
        receptionId: uuidSchema.nullable(),
        detectedAt: z.coerce.date(),
        category: z.string().trim().min(1),
        description: z.string().trim().min(1),
        severity: z.enum(QMS_SEVERITIES),
      })
      .parse(request.body);
    reply.status(201);
    return createSupplierIncident(pool, input, user.id);
  });

  app.post('/api/supplier-incidents/:id/statut', async (request) => {
    const user = requirePermission(request, 'supplierincident:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { status } = z.object({ status: z.enum(SUPPLIER_INCIDENT_STATUSES) }).parse(request.body);
    await updateSupplierIncidentStatus(pool, id, status, user.id);
    return { status: 'ok' };
  });
}
