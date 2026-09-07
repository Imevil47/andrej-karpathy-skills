import type { FastifyInstance } from 'fastify';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { countReceptionsToday } from '../services/receptions.ts';
import { stockSummary } from '../services/stockQueries.ts';

/**
 * Lightweight operational summary of the home page. No analytics, no charts:
 * only the five figures a shift needs at a glance.
 */
export async function registerHomeRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/home/summary', async (request) => {
    requirePermission(request, 'stock:read');

    const [summary, receptionsToday, blocked, subcontracting] = await Promise.all([
      stockSummary(pool),
      countReceptionsToday(pool),
      pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM blocked_lots'),
      pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM subcontracting_operations WHERE status = 'EN_COURS'",
      ),
    ]);

    return {
      internalStockKg: summary.internalKg,
      externalStockKg: summary.externalKg,
      totalStockKg: summary.totalKg,
      blockedLots: Number(blocked.rows[0]?.count ?? '0'),
      receptionsToday,
      subcontractingInProgress: Number(subcontracting.rows[0]?.count ?? '0'),
      byLocation: summary.byLocation,
    };
  });
}
