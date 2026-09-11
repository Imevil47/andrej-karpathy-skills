import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { FAILURE_REPORT_STATUSES, FAILURE_SEVERITIES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  cancelFailureReport,
  createFailureReport,
  getFailureReportDetail,
  listFailureReports,
} from '../services/failures.ts';

export async function registerFailureRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  // Failure modes / causes: configurable maintenance master data (section
  // 46 - "cause non déterminée" is a real row, never a forced fake pick).
  app.get('/api/failure-modes', async (request) => {
    requirePermission(request, 'maintenance:read');
    const result = await pool.query('SELECT id, code, name FROM failure_modes WHERE is_active ORDER BY code');
    return result.rows;
  });

  app.post('/api/failure-modes', async (request, reply) => {
    requirePermission(request, 'equipment:manage');
    const input = z.object({ code: requiredTextSchema, name: requiredTextSchema }).parse(request.body);
    reply.status(201);
    const result = await pool.query<{ id: string }>(
      'INSERT INTO failure_modes (code, name) VALUES ($1, $2) RETURNING id',
      [input.code.toUpperCase(), input.name],
    );
    return { id: result.rows[0]?.id };
  });

  app.get('/api/failure-causes', async (request) => {
    requirePermission(request, 'maintenance:read');
    const result = await pool.query('SELECT id, code, name FROM failure_causes WHERE is_active ORDER BY code');
    return result.rows;
  });

  app.post('/api/failure-causes', async (request, reply) => {
    requirePermission(request, 'equipment:manage');
    const input = z.object({ code: requiredTextSchema, name: requiredTextSchema }).parse(request.body);
    reply.status(201);
    const result = await pool.query<{ id: string }>(
      'INSERT INTO failure_causes (code, name) VALUES ($1, $2) RETURNING id',
      [input.code.toUpperCase(), input.name],
    );
    return { id: result.rows[0]?.id };
  });

  app.get('/api/failures', async (request) => {
    requirePermission(request, 'maintenance:read');
    const query = z
      .object({
        equipement: uuidSchema.nullish(),
        statut: z.enum(FAILURE_REPORT_STATUSES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listFailureReports(pool, {
      equipmentId: query.equipement ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 200,
    });
  });

  app.get('/api/failures/:id', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return getFailureReportDetail(pool, id);
  });

  // Section 10 / acceptance scenario 1: report a breakdown, optionally
  // stopping production - a genuine downtime event is opened in the same
  // transaction when it does (services/failures.ts).
  app.post('/api/failures', async (request, reply) => {
    const user = requirePermission(request, 'failure:report');
    const input = z
      .object({
        equipmentId: uuidSchema,
        severity: z.enum(FAILURE_SEVERITIES),
        description: requiredTextSchema,
        productionRunId: uuidSchema.nullish().transform((value) => value ?? null),
        productionRunLineId: uuidSchema.nullish().transform((value) => value ?? null),
        stopsProduction: z.boolean(),
        reportedAt: z.coerce.date().nullish(),
      })
      .transform((value) => ({ ...value, reportedAt: value.reportedAt ?? new Date() }))
      .parse(request.body);
    reply.status(201);
    return createFailureReport(pool, input, user.id);
  });

  app.post('/api/failures/:id/annulation', async (request) => {
    const user = requirePermission(request, 'failure:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await cancelFailureReport(pool, id, user.id);
    return { id };
  });
}
