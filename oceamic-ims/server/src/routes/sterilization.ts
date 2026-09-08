import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { CCP_DECISIONS, CCP_RESULTS, MEASUREMENT_SOURCE_TYPES, STERILIZATION_CYCLE_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { decimalSchema, limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import { listSterilizationCycles, sterilizationCycleDetail } from '../services/processQueries.ts';
import {
  addCycleLoad,
  beginSterilizationCycle,
  cancelSterilizationCycle,
  closeSterilizationCycle,
  correctCcpControl,
  correctSterilizationMeasurement,
  createSterilizationCycle,
  endCoolingEvent,
  recordCcpControl,
  recordCoolingMeasurement,
  recordSterilizationMeasurement,
  startCoolingEvent,
} from '../services/sterilization.ts';

const loadSchema = z.object({
  productionRunId: uuidSchema,
  quantityUnits: z.number().int().positive().nullable(),
  basketReference: z.string().trim().min(1).nullable(),
  notes: z.string().trim().min(1).nullable(),
});

const measurementSchema = z.object({
  measuredAt: z.coerce.date(),
  temperatureC: decimalSchema,
  pressureBar: decimalSchema,
  f0Value: decimalSchema,
  phase: z.string().trim().min(1).nullable(),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPES),
});

const ccpSchema = z.object({
  controlledAt: z.coerce.date(),
  ccpType: requiredTextSchema,
  result: z.enum(CCP_RESULTS),
  decision: z.enum(CCP_DECISIONS),
  notes: z.string().trim().min(1).nullable(),
});

export async function registerSterilizationRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/sterilization-cycles', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({
        autoclave: uuidSchema.nullish(),
        run: uuidSchema.nullish(),
        statut: z.enum(STERILIZATION_CYCLE_STATUSES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listSterilizationCycles(pool, {
      autoclaveId: query.autoclave ?? null,
      runId: query.run ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/sterilization-cycles/:id', async (request, reply) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await sterilizationCycleDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Cycle de stérilisation introuvable.' };
    }
    return detail;
  });

  app.post('/api/sterilization-cycles', async (request, reply) => {
    const user = requirePermission(request, 'sterilization:operate');
    const input = z
      .object({
        autoclaveId: uuidSchema,
        sterilizationProgramId: uuidSchema,
        startedAt: z.coerce.date(),
        operatorUserId: uuidSchema.nullable(),
        notes: z.string().trim().min(1).nullable(),
        loads: z.array(loadSchema).min(1),
      })
      .parse(request.body);
    reply.status(201);
    return createSterilizationCycle(pool, input, user.id);
  });

  app.post('/api/sterilization-cycles/:id/chargements', async (request, reply) => {
    const user = requirePermission(request, 'sterilization:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = loadSchema.parse(request.body);
    reply.status(201);
    return addCycleLoad(pool, id, input, user.id);
  });

  app.post('/api/sterilization-cycles/:id/demarrage', async (request) => {
    const user = requirePermission(request, 'sterilization:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await beginSterilizationCycle(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/sterilization-cycles/:id/mesures', async (request, reply) => {
    const user = requirePermission(request, 'sterilization:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = measurementSchema.parse(request.body);
    reply.status(201);
    return recordSterilizationMeasurement(pool, id, input, user.id);
  });

  app.post('/api/sterilization-measurements/:id/correction', async (request, reply) => {
    const user = requirePermission(request, 'sterilization:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({ corrected: measurementSchema.nullable(), reason: requiredTextSchema })
      .parse(request.body);
    reply.status(201);
    return correctSterilizationMeasurement(pool, id, input.corrected, input.reason, user.id);
  });

  app.post('/api/sterilization-cycles/:id/ccp', async (request, reply) => {
    const user = requirePermission(request, 'ccp:validate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = ccpSchema.parse(request.body);
    reply.status(201);
    return recordCcpControl(pool, id, input, user.id);
  });

  app.post('/api/ccp-controls/:id/correction', async (request, reply) => {
    const user = requirePermission(request, 'ccp:validate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z.object({ corrected: ccpSchema.nullable(), reason: requiredTextSchema }).parse(request.body);
    reply.status(201);
    return correctCcpControl(pool, id, input.corrected, input.reason, user.id);
  });

  app.post('/api/sterilization-cycles/:id/cloture', async (request) => {
    const user = requirePermission(request, 'sterilization:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return closeSterilizationCycle(pool, id, user.id);
  });

  app.post('/api/sterilization-cycles/:id/annulation', async (request) => {
    const user = requirePermission(request, 'sterilization:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelSterilizationCycle(pool, id, reason, user.id);
    return { status: 'ok' };
  });

  app.post('/api/sterilization-cycles/:id/refroidissement', async (request, reply) => {
    const user = requirePermission(request, 'sterilization:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        startedAt: z.coerce.date(),
        coolingMethod: z.string().trim().min(1).nullable(),
        waterTemperatureC: decimalSchema,
      })
      .parse(request.body);
    reply.status(201);
    return startCoolingEvent(pool, id, input, user.id);
  });

  app.post('/api/cooling-events/:id/cloture', async (request) => {
    const user = requirePermission(request, 'sterilization:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        endedAt: z.coerce.date(),
        finalProductTemperatureC: decimalSchema,
        result: z.enum(['CONFORME', 'NON_CONFORME', 'A_VERIFIER']).nullable(),
      })
      .parse(request.body);
    await endCoolingEvent(pool, id, input, user.id);
    return { status: 'ok' };
  });

  app.post('/api/cooling-events/:id/mesures', async (request, reply) => {
    const user = requirePermission(request, 'sterilization:operate');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        measuredAt: z.coerce.date(),
        parameter: requiredTextSchema,
        value: z.string().regex(/^-?\d{1,8}(\.\d{1,3})?$/, 'Valeur invalide.'),
        unit: requiredTextSchema,
        status: z.enum(['CONFORME', 'NON_CONFORME', 'A_VERIFIER']).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return recordCoolingMeasurement(pool, id, input, user.id);
  });
}
