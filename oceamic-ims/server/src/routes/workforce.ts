import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { uuidSchema } from '../http/schemas.ts';
import { assignEmployeeToLine, listRunWorkforce, setPresence } from '../services/workforce.ts';

const assignSchema = z.object({
  productionRunLineId: uuidSchema,
  employeeId: uuidSchema,
  isPresent: z.boolean(),
});

export async function registerWorkforceRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/production/runs/:id/personnel', async (request) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { ligne } = z.object({ ligne: uuidSchema.nullish() }).parse(request.query);
    return listRunWorkforce(pool, id, ligne ?? null);
  });

  app.post('/api/production/runs/:id/personnel', async (request, reply) => {
    const user = requirePermission(request, 'workforce:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = assignSchema.parse(request.body);
    reply.status(201);
    return assignEmployeeToLine(pool, id, input, user.id);
  });

  app.post('/api/production/personnel/:assignmentId/presence', async (request) => {
    const user = requirePermission(request, 'workforce:manage');
    const { assignmentId } = z.object({ assignmentId: uuidSchema }).parse(request.params);
    const { isPresent } = z.object({ isPresent: z.boolean() }).parse(request.body);
    await setPresence(pool, assignmentId, isPresent, user.id);
    return { status: 'ok' };
  });
}
