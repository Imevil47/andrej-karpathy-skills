import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { PREVENTIVE_FREQUENCY_TYPES, PREVENTIVE_TASK_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  cancelPreventiveTask,
  completePreventiveTask,
  createMaintenancePlan,
  getMaintenancePlanDetail,
  listChecklistResponses,
  listMaintenancePlans,
  listPreventiveTasks,
} from '../services/maintenancePlans.ts';

export async function registerMaintenancePlanRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/maintenance-plans', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { equipement } = z.object({ equipement: uuidSchema.nullish() }).parse(request.query);
    return listMaintenancePlans(pool, equipement ?? null);
  });

  app.get('/api/maintenance-plans/:id', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return getMaintenancePlanDetail(pool, id);
  });

  // Section 26: creating a plan schedules its first occurrence in the same
  // transaction (services/maintenancePlans.ts) - a plan is never left
  // without a next due date.
  app.post('/api/maintenance-plans', async (request, reply) => {
    const user = requirePermission(request, 'preventive:manage');
    const input = z
      .object({
        equipmentId: uuidSchema,
        name: requiredTextSchema,
        frequencyType: z.enum(PREVENTIVE_FREQUENCY_TYPES),
        checklistLabels: z.array(requiredTextSchema).default([]),
        firstDueAt: z.coerce.date(),
      })
      .parse(request.body);
    reply.status(201);
    return createMaintenancePlan(pool, input, user.id);
  });

  app.get('/api/preventive-tasks', async (request) => {
    requirePermission(request, 'maintenance:read');
    const query = z
      .object({
        equipement: uuidSchema.nullish(),
        statut: z.enum(PREVENTIVE_TASK_STATUSES).nullish(),
        avantLe: z.coerce.date().nullish(),
        enRetardUniquement: z.enum(['true', 'false']).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listPreventiveTasks(pool, {
      equipmentId: query.equipement ?? null,
      status: query.statut ?? null,
      dueBefore: query.avantLe ?? null,
      overdueOnly: query.enRetardUniquement === 'true',
      limit: query.limite ?? 200,
    });
  });

  app.get('/api/preventive-tasks/:id/checklist', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listChecklistResponses(pool, id);
  });

  // Section 30/46: the technician's checklist completion - no long admin
  // form, one call closes the task, records responses and generates the
  // next occurrence for calendar-based frequencies.
  app.post('/api/preventive-tasks/:id/completion', async (request) => {
    const user = requirePermission(request, 'preventive:complete');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        completedAt: z.coerce.date().nullish(),
        notes: z.string().trim().min(1).nullish().transform((value) => value ?? null),
        checklistResponses: z
          .array(
            z.object({
              checklistItemId: uuidSchema,
              completed: z.boolean(),
              comment: z.string().trim().min(1).nullish().transform((value) => value ?? null),
            }),
          )
          .default([]),
      })
      .parse(request.body);
    return completePreventiveTask(
      pool,
      id,
      { completedAt: input.completedAt ?? new Date(), notes: input.notes, checklistResponses: input.checklistResponses },
      user.id,
    );
  });

  app.post('/api/preventive-tasks/:id/annulation', async (request) => {
    const user = requirePermission(request, 'preventive:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await cancelPreventiveTask(pool, id, user.id);
    return { id };
  });
}
