import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  adjustSparePartStock,
  createSparePart,
  listSparePartMovements,
  listSpareParts,
  receiveSparePartStock,
} from '../services/spareParts.ts';

const quantitySchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Quantité invalide.')
  .refine((value) => Number(value) > 0, 'La quantité doit être strictement positive.');

const deltaSchema = z
  .string()
  .regex(/^-?\d{1,8}(\.\d{1,2})?$/, 'Valeur numérique invalide.');

export async function registerSparePartRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/spare-parts', async (request) => {
    requirePermission(request, 'maintenance:read');
    const query = z
      .object({
        inactifs: z.enum(['true', 'false']).nullish(),
        sousMinimum: z.enum(['true', 'false']).nullish(),
      })
      .parse(request.query);
    return listSpareParts(pool, query.inactifs === 'true', query.sousMinimum === 'true');
  });

  app.get('/api/spare-parts/:id/mouvements', async (request) => {
    requirePermission(request, 'maintenance:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listSparePartMovements(pool, id);
  });

  app.post('/api/spare-parts', async (request, reply) => {
    const user = requirePermission(request, 'equipment:manage');
    const input = z
      .object({
        partCode: requiredTextSchema,
        name: requiredTextSchema,
        description: z.string().trim().min(1).nullish().transform((value) => value ?? null),
        unit: requiredTextSchema.default('PIECE'),
        minimumStock: quantitySchema.or(z.literal('0')).default('0'),
        locationId: uuidSchema.nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createSparePart(pool, input, user.id);
  });

  // RECEPTION / RETOUR: stock entering the shelf (section 38).
  app.post('/api/spare-parts/:id/reception', async (request, reply) => {
    const user = requirePermission(request, 'sparepart:consume');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        movementType: z.enum(['RECEPTION', 'RETOUR']),
        quantity: quantitySchema,
        reason: z.string().trim().min(1).nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    await receiveSparePartStock(pool, id, input.movementType, input.quantity, input.reason, user.id);
    return { id };
  });

  // Section 40: a manual correction, RESPONSABLE_MAINTENANCE-only.
  app.post('/api/spare-parts/:id/ajustement', async (request, reply) => {
    const user = requirePermission(request, 'sparepart:adjust');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z.object({ quantityDelta: deltaSchema, reason: requiredTextSchema }).parse(request.body);
    reply.status(201);
    await adjustSparePartStock(pool, id, input.quantityDelta, input.reason, user.id);
    return { id };
  });
}
