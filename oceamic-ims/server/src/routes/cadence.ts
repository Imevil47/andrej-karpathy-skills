import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { CONTROL_ROUND_STATUSES, MEASUREMENT_UNITS, RUN_LINE_ACTIVITIES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  cancelControlRound,
  closeControlRound,
  closeLineControl,
  correctCadenceControl,
  openLineControl,
  recordEmployeeCadenceControl,
  startControlRound,
} from '../services/cadence.ts';
import {
  cadenceHistory,
  controlRoundDetail,
  listControlRounds,
  runLineCadenceSummary,
} from '../services/cadenceQueries.ts';

const startRoundSchema = z.object({ notes: z.string().trim().min(1).nullable() });

const openLineSchema = z.object({ productionRunLineId: uuidSchema });

const quantitySchema = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, 'Quantité invalide.')
  .refine((value) => Number(value) >= 0, 'La quantité ne peut pas être négative.');

const recordCadenceSchema = z.object({
  employeeNumber: requiredTextSchema,
  quantityCompleted: quantitySchema,
  measurementUnit: z.enum(MEASUREMENT_UNITS),
  measurementDurationSeconds: z.number().int().positive(),
  controlledAt: z.coerce.date(),
  confirmCrossLine: z.boolean(),
});

const correctionSchema = z.object({
  correctedQuantity: quantitySchema.nullable(),
  correctedDurationSeconds: z.number().int().positive().nullable(),
  reason: requiredTextSchema,
});

const historyFiltersSchema = z.object({
  run: uuidSchema.nullish(),
  produit: uuidSchema.nullish(),
  ligne: uuidSchema.nullish(),
  employee: uuidSchema.nullish(),
  activite: z.enum(RUN_LINE_ACTIVITIES).nullish(),
  du: z.iso.date().nullish(),
  au: z.iso.date().nullish(),
  limite: limitSchema.nullish(),
});

export async function registerCadenceRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/cadence/control-rounds', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({
        run: uuidSchema.nullish(),
        statut: z.enum(CONTROL_ROUND_STATUSES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listControlRounds(pool, {
      runId: query.run ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/cadence/control-rounds/:id', async (request) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return controlRoundDetail(pool, id);
  });

  app.post('/api/production/runs/:id/tours-controle', async (request, reply) => {
    const user = requirePermission(request, 'cadence:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = startRoundSchema.parse(request.body);
    reply.status(201);
    return startControlRound(pool, id, input.notes, user.id);
  });

  app.post('/api/cadence/control-rounds/:id/cloture', async (request) => {
    const user = requirePermission(request, 'cadence:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return closeControlRound(pool, id, user.id);
  });

  app.post('/api/cadence/control-rounds/:id/annulation', async (request) => {
    const user = requirePermission(request, 'cadence:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelControlRound(pool, id, reason, user.id);
    return { status: 'ok' };
  });

  app.post('/api/cadence/control-rounds/:id/lignes', async (request, reply) => {
    const user = requirePermission(request, 'cadence:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = openLineSchema.parse(request.body);
    reply.status(201);
    return openLineControl(pool, id, input.productionRunLineId, user.id);
  });

  app.post('/api/cadence/line-controls/:id/cloture', async (request) => {
    const user = requirePermission(request, 'cadence:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return closeLineControl(pool, id, user.id);
  });

  app.post('/api/cadence/line-controls/:id/employes', async (request, reply) => {
    const user = requirePermission(request, 'cadence:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = recordCadenceSchema.parse(request.body);
    reply.status(201);
    return recordEmployeeCadenceControl(pool, id, input, user.id);
  });

  app.post('/api/cadence/controles/:id/correction', async (request, reply) => {
    const user = requirePermission(request, 'cadence:control');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = correctionSchema.parse(request.body);
    reply.status(201);
    return correctCadenceControl(
      pool,
      id,
      input.correctedQuantity,
      input.correctedDurationSeconds,
      input.reason,
      user.id,
    );
  });

  app.get('/api/production/runs/:id/lignes/resume', async (request) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return runLineCadenceSummary(pool, id);
  });

  app.get('/api/cadence', async (request) => {
    requirePermission(request, 'production:read');
    const query = historyFiltersSchema.parse(request.query);
    return cadenceHistory(pool, {
      runId: query.run ?? null,
      productId: query.produit ?? null,
      productionRunLineId: query.ligne ?? null,
      employeeId: query.employee ?? null,
      activityType: query.activite ?? null,
      dateFrom: query.du ?? null,
      dateTo: query.au ?? null,
      limit: query.limite ?? 200,
    });
  });
}
