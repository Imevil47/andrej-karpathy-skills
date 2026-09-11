import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { withTransaction } from '../db/pool.ts';
import { LOT_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, quantityKgSchema, uuidSchema } from '../http/schemas.ts';
import { createLot, fractionLot, listLots, refreshLotStatus } from '../services/lots.ts';

const listSchema = z.object({
  recherche: z.string().trim().min(1).nullish(),
  espece: uuidSchema.nullish(),
  statut: z.enum(LOT_STATUSES).nullish(),
  limite: limitSchema.nullish(),
});

const createSchema = z.object({
  lotCode: z.string().trim().min(1).nullable(),
  speciesId: uuidSchema,
  supplierId: uuidSchema.nullable(),
  vesselId: uuidSchema.nullable(),
  origin: z.string().trim().min(1).nullable(),
  tideNumber: z.string().trim().min(1).nullable(),
  captureDate: z.iso.date().nullable(),
  notes: z.string().trim().min(1).nullable(),
});

const fractionSchema = z.object({
  locationId: uuidSchema,
  quantityKg: quantityKgSchema,
  childLotCode: z.string().trim().min(1).nullable(),
  notes: z.string().trim().min(1).nullable(),
});

export async function registerLotRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/lots', async (request) => {
    requirePermission(request, 'stock:read');
    const query = listSchema.parse(request.query);
    return listLots(pool, {
      search: query.recherche ?? null,
      speciesId: query.espece ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.post('/api/lots', async (request, reply) => {
    const user = requirePermission(request, 'reception:create');
    const input = createSchema.parse(request.body);
    const lot = await withTransaction(pool, (client) =>
      createLot(
        client,
        { ...input, initialReceptionDate: null, parentLotId: null },
        user.id,
      ),
    );
    reply.status(201);
    return lot;
  });

  app.post('/api/lots/:id/fractionnement', async (request, reply) => {
    const user = requirePermission(request, 'stock:transfer');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = fractionSchema.parse(request.body);
    const child = await withTransaction(pool, (client) =>
      fractionLot(client, { ...input, parentLotId: id }, user.id),
    );
    reply.status(201);
    return child;
  });

  app.post('/api/lots/:id/refresh-status', async (request) => {
    const user = requirePermission(request, 'stock:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const status = await withTransaction(pool, (client) => refreshLotStatus(client, id));
    return { status, refreshedBy: user.username };
  });
}
