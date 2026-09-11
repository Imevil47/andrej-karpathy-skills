import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { INSPECTION_RESULTS, RECEPTION_TYPES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import {
  decimalSchema,
  limitSchema,
  quantityKgSchema,
  uuidSchema,
} from '../http/schemas.ts';
import { countReceptionsToday, listReceptions, registerReception } from '../services/receptions.ts';

const lotSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('NOUVEAU'),
    lotCode: z.string().trim().min(1).nullable(),
    speciesId: uuidSchema,
    origin: z.string().trim().min(1).nullable(),
    captureDate: z.iso.date().nullable(),
    notes: z.string().trim().min(1).nullable(),
  }),
  z.object({ mode: z.literal('EXISTANT'), lotId: uuidSchema }),
]);

const quickInspectionSchema = z.object({
  temperatureC: decimalSchema,
  qualityGrade: z.string().trim().min(1).nullable(),
  sizeGrade: z.string().trim().min(1).nullable(),
  result: z.enum(INSPECTION_RESULTS),
  notes: z.string().trim().min(1).nullable(),
});

const receptionSchema = z.object({
  receivedAt: z.coerce.date(),
  lot: lotSchema,
  supplierId: uuidSchema.nullable(),
  vesselId: uuidSchema.nullable(),
  tideNumber: z.string().trim().min(1).nullable(),
  truckRegistration: z.string().trim().min(1).nullable(),
  quantityKg: quantityKgSchema,
  destinationLocationId: uuidSchema,
  receptionType: z.enum(RECEPTION_TYPES),
  externalSourceLocationId: uuidSchema.nullable(),
  documentReference: z.string().trim().min(1).nullable(),
  notes: z.string().trim().min(1).nullable(),
  quickInspection: quickInspectionSchema.nullable(),
});

const listSchema = z.object({
  recherche: z.string().trim().min(1).nullish(),
  du: z.iso.date().nullish(),
  au: z.iso.date().nullish(),
  limite: limitSchema.nullish(),
});

export async function registerReceptionRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/receptions', async (request) => {
    requirePermission(request, 'stock:read');
    const query = listSchema.parse(request.query);
    return listReceptions(pool, {
      search: query.recherche ?? null,
      fromDate: query.du ?? null,
      toDate: query.au ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/receptions/today-count', async (request) => {
    requirePermission(request, 'stock:read');
    return { count: await countReceptionsToday(pool) };
  });

  app.post('/api/receptions', async (request, reply) => {
    const user = requirePermission(request, 'reception:create');
    const input = receptionSchema.parse(request.body);
    reply.status(201);
    return registerReception(pool, input, user.id);
  });
}
