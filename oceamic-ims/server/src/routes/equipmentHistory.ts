import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { uuidSchema } from '../http/schemas.ts';
import { listFailureReports } from '../services/failures.ts';
import { listWorkOrders } from '../services/workOrders.ts';
import { listPreventiveTasks } from '../services/maintenancePlans.ts';
import {
  activeFailuresForEquipmentIds,
  equipmentMttr,
  listPartUsageForEquipment,
  repeatedFailureAnalysis,
} from '../services/maintenanceQueries.ts';

/**
 * Equipment history (section 33): one of the most important Phase 7
 * screens - failures, work orders, preventive tasks and parts used, all
 * scoped to one equipment. Composed from the existing list services rather
 * than a new bespoke query, so it can never drift from what the
 * Pannes/Ordres de travail/Préventif screens themselves show.
 */
export async function registerEquipmentHistoryRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/equipment/:id/historique', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const [failures, workOrders, preventiveTasks, partUsage] = await Promise.all([
      listFailureReports(pool, { equipmentId: id, status: null, limit: 200 }),
      listWorkOrders(pool, {
        equipmentId: id,
        productionLineId: null,
        workOrderType: null,
        priority: null,
        status: null,
        assignedTo: null,
        limit: 200,
      }),
      listPreventiveTasks(pool, { equipmentId: id, status: null, dueBefore: null, overdueOnly: false, limit: 200 }),
      listPartUsageForEquipment(pool, id),
    ]);
    return { failures, workOrders, preventiveTasks, partUsage };
  });

  app.get('/api/equipment/:id/mttr', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return equipmentMttr(pool, id);
  });

  app.get('/api/equipment/:id/pannes-repetees', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { jours } = z.object({ jours: z.coerce.number().int().positive().nullish() }).parse(request.query);
    return repeatedFailureAnalysis(pool, id, jours ?? 30);
  });

  // Section 47: active failure visibility on equipment/line/run pages -
  // accepts a comma-separated id list so a line/run screen can batch-check
  // several equipment at once.
  app.get('/api/equipment/pannes-actives', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { ids } = z.object({ ids: z.string().trim().min(1) }).parse(request.query);
    const equipmentIds = ids.split(',').map((value) => value.trim());
    return activeFailuresForEquipmentIds(pool, equipmentIds);
  });
}
