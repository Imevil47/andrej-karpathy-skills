import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPES,
  WORK_ORDER_VERIFICATION_RESULTS,
} from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  completeWorkOrder,
  createWorkOrder,
  getWorkOrderClosureContext,
  getWorkOrderDetail,
  listWorkOrders,
  updateWorkOrderStatus,
} from '../services/workOrders.ts';
import { endIntervention, listInterventionsForWorkOrder, startIntervention, updateIntervention } from '../services/interventions.ts';
import { recordPartUsage } from '../services/spareParts.ts';

const nonTerminalStatusSchema = z.enum(
  WORK_ORDER_STATUSES.filter((status) => status !== 'TERMINE') as [string, ...string[]],
);

const positiveQuantitySchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Quantité invalide.')
  .refine((value) => Number(value) > 0, 'La quantité doit être strictement positive.');

export async function registerWorkOrderRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/work-orders', async (request) => {
    requirePermission(request, 'maintenance:read');
    const query = z
      .object({
        equipement: uuidSchema.nullish(),
        ligne: uuidSchema.nullish(),
        type: z.enum(WORK_ORDER_TYPES).nullish(),
        priorite: z.enum(WORK_ORDER_PRIORITIES).nullish(),
        statut: z.enum(WORK_ORDER_STATUSES).nullish(),
        assigneA: uuidSchema.nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listWorkOrders(pool, {
      equipmentId: query.equipement ?? null,
      productionLineId: query.ligne ?? null,
      workOrderType: query.type ?? null,
      priority: query.priorite ?? null,
      status: query.statut ?? null,
      assignedTo: query.assigneA ?? null,
      limit: query.limite ?? 200,
    });
  });

  app.get('/api/work-orders/:id', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return getWorkOrderDetail(pool, id);
  });

  // Section 21/23: authorized job creation, optionally against a failure
  // (which the service transitions DECLAREE -> PRISE_EN_CHARGE) or a
  // preventive task.
  app.post('/api/work-orders', async (request, reply) => {
    const user = requirePermission(request, 'workorder:manage');
    const input = z
      .object({
        equipmentId: uuidSchema,
        failureReportId: uuidSchema.nullish().transform((value) => value ?? null),
        workOrderType: z.enum(WORK_ORDER_TYPES),
        priority: z.enum(WORK_ORDER_PRIORITIES),
        title: requiredTextSchema,
        description: z.string().trim().min(1).nullish().transform((value) => value ?? null),
        assignedTo: uuidSchema.nullish().transform((value) => value ?? null),
        dueAt: z.coerce.date().nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createWorkOrder(pool, input, user.id);
  });

  // Section 21: every other transition (OUVERT..EN_ATTENTE_PRODUCTION,
  // ANNULE) - TERMINE is deliberately excluded, it goes through the
  // dedicated closure endpoint below with its approval gate.
  app.post('/api/work-orders/:id/statut', async (request) => {
    const user = requirePermission(request, 'workorder:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { statut } = z.object({ statut: nonTerminalStatusSchema }).parse(request.body);
    return updateWorkOrderStatus(pool, id, statut as Exclude<(typeof WORK_ORDER_STATUSES)[number], 'TERMINE'>, user.id);
  });

  // Section 52: closing an "important" work order (HAUTE/CRITIQUE equipment,
  // or an URGENCE work order) needs workorder:approve; any other closure
  // only needs workorder:manage - the condition depends on the equipment's
  // criticality, read here before deciding which permission to require.
  app.post('/api/work-orders/:id/cloture', async (request) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const context = await getWorkOrderClosureContext(pool, id);
    const user = requirePermission(request, context.requiresApproval ? 'workorder:approve' : 'workorder:manage');
    const input = z
      .object({ verificationResult: z.enum(WORK_ORDER_VERIFICATION_RESULTS).nullish().transform((value) => value ?? null) })
      .parse(request.body);
    return completeWorkOrder(pool, id, input, user.id);
  });

  // --- Interventions (section 46's rapid technician flow) -------------------

  app.get('/api/work-orders/:id/interventions', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listInterventionsForWorkOrder(pool, id);
  });

  app.post('/api/work-orders/:id/interventions', async (request, reply) => {
    const user = requirePermission(request, 'intervention:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { startedAt } = z.object({ startedAt: z.coerce.date().nullish() }).parse(request.body);
    reply.status(201);
    return startIntervention(pool, id, startedAt ?? new Date(), user.id);
  });

  app.patch('/api/interventions/:id', async (request) => {
    const user = requirePermission(request, 'intervention:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        diagnostic: z.string().trim().min(1).nullish().transform((value) => value ?? null),
        actionPerformed: z.string().trim().min(1).nullish().transform((value) => value ?? null),
        failureModeId: uuidSchema.nullish().transform((value) => value ?? null),
        failureCauseId: uuidSchema.nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    return updateIntervention(pool, id, input, user.id);
  });

  app.post('/api/interventions/:id/cloture', async (request) => {
    const user = requirePermission(request, 'intervention:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        endedAt: z.coerce.date().nullish(),
        actionPerformed: z.string().trim().min(1).nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    return endIntervention(pool, id, input.endedAt ?? new Date(), input.actionPerformed, user.id);
  });

  // Section 39/46: "Pièces utilisées" - one spare part usage per call, each
  // producing exactly one stock movement (services/spareParts.ts).
  app.post('/api/interventions/:id/pieces', async (request, reply) => {
    const user = requirePermission(request, 'sparepart:consume');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z.object({ sparePartId: uuidSchema, quantity: positiveQuantitySchema }).parse(request.body);
    reply.status(201);
    await recordPartUsage(pool, id, input.sparePartId, input.quantity, user.id);
    return { interventionId: id, sparePartId: input.sparePartId };
  });
}
