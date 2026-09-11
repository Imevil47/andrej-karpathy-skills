import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { DECISION_TYPES, INSPECTION_RESULTS, INSPECTION_TYPES, PROCESS_STAGES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { decimalSchema, limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import { decideQuality, listBlockedLots, listInspections, recordInspection } from '../services/quality.ts';

const inspectionSchema = z.object({
  rawMaterialLotId: uuidSchema,
  inspectedAt: z.coerce.date(),
  inspectionType: z.enum(INSPECTION_TYPES),
  processStage: z.enum(PROCESS_STAGES),
  locationId: uuidSchema.nullable(),
  temperatureC: decimalSchema,
  histaminePpm: decimalSchema,
  abvt: decimalSchema,
  qualityGrade: z.string().trim().min(1).nullable(),
  sizeGrade: z.string().trim().min(1).nullable(),
  result: z.enum(INSPECTION_RESULTS),
  notes: z.string().trim().min(1).nullable(),
});

const decisionSchema = z.object({
  rawMaterialLotId: uuidSchema,
  inspectionId: uuidSchema.nullable(),
  decisionType: z.enum(DECISION_TYPES),
  reason: requiredTextSchema,
  notes: z.string().trim().min(1).nullable(),
});

export async function registerQualityRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/quality/inspections', async (request) => {
    requirePermission(request, 'quality:read');
    const query = z
      .object({ lot: uuidSchema.nullish(), limite: limitSchema.nullish() })
      .parse(request.query);
    return listInspections(pool, query.lot ?? null, query.limite ?? 100);
  });

  app.get('/api/quality/blocked-lots', async (request) => {
    requirePermission(request, 'quality:read');
    return listBlockedLots(pool);
  });

  app.post('/api/quality/inspections', async (request, reply) => {
    const user = requirePermission(request, 'quality:inspect');
    const input = inspectionSchema.parse(request.body);
    reply.status(201);
    return recordInspection(pool, input, user.id);
  });

  // Blocking and releasing are both quality decisions. Releasing additionally
  // requires the dedicated permission, which the STOCK role never holds.
  app.post('/api/quality/decisions', async (request, reply) => {
    const input = decisionSchema.parse(request.body);
    const user =
      input.decisionType === 'LIBERE'
        ? requirePermission(request, 'quality:release')
        : requirePermission(request, 'quality:decide');
    reply.status(201);
    return decideQuality(pool, input, user.id);
  });
}
