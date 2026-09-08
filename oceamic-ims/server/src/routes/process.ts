import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { uuidSchema } from '../http/schemas.ts';
import { runProcessGenealogy, runProcessOverview } from '../services/processQueries.ts';

/**
 * Process overview (section 46) and full downstream genealogy (sections
 * 44/70/74) of a Run: filling through cooling, in one call, without the
 * caller manually chasing foreign keys across every Phase 4 table.
 */
export async function registerProcessRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/production/runs/:id/vue-process', async (request) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return runProcessOverview(pool, id);
  });

  app.get('/api/production/runs/:id/genealogie', async (request) => {
    requirePermission(request, 'production:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return runProcessGenealogy(pool, id);
  });
}
