import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { cadenceHomeSummary } from '../services/cadenceQueries.ts';
import { listUsers } from '../services/auth.ts';
import { phase5HomeSummary } from '../services/fgQueries.ts';
import { phase4HomeSummary } from '../services/processQueries.ts';
import { productionHomeSummary } from '../services/productionQueries.ts';
import { countReceptionsToday } from '../services/receptions.ts';
import { qmsHomeSummary, qmsMetrics } from '../services/qmsQueries.ts';
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

    const [summary, receptionsToday, blocked, subcontracting, production, cadence, phase4, phase5] =
      await Promise.all([
        stockSummary(pool),
        countReceptionsToday(pool),
        pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM blocked_lots'),
        pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM subcontracting_operations WHERE status = 'EN_COURS'",
        ),
        productionHomeSummary(pool),
        cadenceHomeSummary(pool),
        phase4HomeSummary(pool),
        phase5HomeSummary(pool),
      ]);

    return {
      internalStockKg: summary.internalKg,
      externalStockKg: summary.externalKg,
      totalStockKg: summary.totalKg,
      blockedLots: Number(blocked.rows[0]?.count ?? '0'),
      receptionsToday,
      subcontractingInProgress: Number(subcontracting.rows[0]?.count ?? '0'),
      runsInProgress: production.runsInProgress,
      consumedTodayKg: production.consumedTodayKg,
      runsWithDifferenceToJustify: production.runsWithDifferenceToJustify,
      controlRoundsToday: cadence.controlRoundsToday,
      incompleteControlRounds: cadence.incompleteControlRounds,
      activeDowntimeCount: cadence.activeDowntimeCount,
      weightControlsToCorrect: phase4.weightControlsToCorrect,
      activeSterilizationCycles: phase4.activeSterilizationCycles,
      ccpToVerify: phase4.ccpToVerify,
      openDeviations: phase4.openDeviations,
      byLocation: summary.byLocation,
      fgAvailableCartons: phase5.availableCartons,
      fgBlockedFinishedGoodLots: phase5.blockedFinishedGoodLots,
      shipmentsInPreparation: phase5.shipmentsInPreparation,
      palletsToLoad: phase5.palletsToLoad,
    };
  });

  // Section 37: a focused "Qualité - Vue d'ensemble" summary, separate from
  // the operational Accueil above - no decorative charts.
  app.get('/api/qms/home-summary', async (request) => {
    requirePermission(request, 'qms:read');
    return qmsHomeSummary(pool);
  });

  // Section 47: basic KPIs over a sliding window (default 90 days).
  app.get('/api/qms/metrics', async (request) => {
    requirePermission(request, 'qms:read');
    const { jours } = z.object({ jours: z.coerce.number().int().positive().nullish() }).parse(request.query);
    return qmsMetrics(pool, jours ?? 90);
  });

  // QMS screens assign an owner/responsible/lead auditor by user (sections
  // 12/21/26): unlike every earlier phase's optional responsibleUserId, a
  // CAPA's owner and an audit's lead auditor are required, so QUALITE/
  // RESPONSABLE_QUALITE need a way to list active users - `/api/users`
  // itself stays users:manage/ADMIN-only for account administration.
  app.get('/api/qms/users', async (request) => {
    requirePermission(request, 'qms:read');
    const users = await listUsers(pool);
    return users.filter((user) => user.isActive).map((user) => ({ id: user.id, fullName: user.fullName, role: user.role }));
  });
}
