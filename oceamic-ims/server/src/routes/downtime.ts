import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, uuidSchema } from '../http/schemas.ts';
import { endDowntime, listDowntimeEvents, startDowntime } from '../services/downtime.ts';

const startSchema = z.object({
  productionRunLineId: uuidSchema.nullable(),
  downtimeCategoryId: uuidSchema,
  reasonText: z.string().trim().min(1).nullable(),
  planned: z.boolean(),
  startedAt: z.coerce.date(),
});

export async function registerDowntimeRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/downtime', async (request) => {
    requirePermission(request, 'production:read');
    const query = z
      .object({
        run: uuidSchema.nullish(),
        ligne: uuidSchema.nullish(),
        categorie: uuidSchema.nullish(),
        enCours: z.enum(['true', 'false']).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listDowntimeEvents(pool, {
      runId: query.run ?? null,
      runLineId: query.ligne ?? null,
      categoryId: query.categorie ?? null,
      activeOnly: query.enCours === 'true',
      limit: query.limite ?? 200,
    });
  });

  app.post('/api/production/runs/:id/arrets', async (request, reply) => {
    const user = requirePermission(request, 'downtime:record');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = startSchema.parse(request.body);
    reply.status(201);
    return startDowntime(pool, id, input, user.id);
  });

  app.post('/api/downtime/:id/cloture', async (request, reply) => {
    const user = requirePermission(request, 'downtime:record');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { endedAt } = z.object({ endedAt: z.coerce.date() }).parse(request.body);
    reply.status(201);
    return endDowntime(pool, id, endedAt, user.id);
  });
}
