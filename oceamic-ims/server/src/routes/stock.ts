import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { withTransaction } from '../db/pool.ts';
import { MOVEMENT_TYPES, STOCK_TYPES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, quantityKgSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import { adjustStock, registerLoss, reverseStockMovement, transferStock } from '../services/stock.ts';
import { listMovements, stockSituation, stockSummary } from '../services/stockQueries.ts';

const situationSchema = z.object({
  lot: z.string().trim().min(1).nullish(),
  espece: uuidSchema.nullish(),
  emplacement: uuidSchema.nullish(),
  typeStock: z.enum(STOCK_TYPES).nullish(),
  bloques: z.enum(['true', 'false']).nullish(),
});

const movementsSchema = z.object({
  lot: uuidSchema.nullish(),
  emplacement: uuidSchema.nullish(),
  type: z.enum(MOVEMENT_TYPES).nullish(),
  limite: limitSchema.nullish(),
});

const transferSchema = z.object({
  lotId: uuidSchema,
  sourceLocationId: uuidSchema,
  destinationLocationId: uuidSchema,
  quantityKg: quantityKgSchema,
  occurredAt: z.coerce.date(),
  notes: z.string().trim().min(1).nullable(),
});

const lossSchema = z.object({
  lotId: uuidSchema,
  sourceLocationId: uuidSchema,
  quantityKg: quantityKgSchema,
  reason: requiredTextSchema,
  occurredAt: z.coerce.date(),
  notes: z.string().trim().min(1).nullable(),
});

const adjustmentSchema = z
  .object({
    lotId: uuidSchema,
    sourceLocationId: uuidSchema.nullable(),
    destinationLocationId: uuidSchema.nullable(),
    quantityKg: quantityKgSchema,
    reason: requiredTextSchema,
    occurredAt: z.coerce.date(),
    notes: z.string().trim().min(1).nullable(),
  })
  .refine(
    (value) => value.sourceLocationId !== null || value.destinationLocationId !== null,
    'Un ajustement doit préciser un emplacement source ou de destination.',
  );

export async function registerStockRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/stock/situation', async (request) => {
    requirePermission(request, 'stock:read');
    const query = situationSchema.parse(request.query);
    return stockSituation(pool, {
      lotSearch: query.lot ?? null,
      speciesId: query.espece ?? null,
      locationId: query.emplacement ?? null,
      stockType: query.typeStock ?? null,
      onlyBlocked: query.bloques === 'true',
    });
  });

  app.get('/api/stock/summary', async (request) => {
    requirePermission(request, 'stock:read');
    return stockSummary(pool);
  });

  app.get('/api/stock/movements', async (request) => {
    requirePermission(request, 'stock:read');
    const query = movementsSchema.parse(request.query);
    return listMovements(pool, {
      lotId: query.lot ?? null,
      locationId: query.emplacement ?? null,
      movementType: query.type ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.post('/api/stock/transfers', async (request, reply) => {
    const user = requirePermission(request, 'stock:transfer');
    const input = transferSchema.parse(request.body);
    const movement = await withTransaction(pool, (client) => transferStock(client, input, user.id));
    reply.status(201);
    return movement;
  });

  app.post('/api/stock/losses', async (request, reply) => {
    const user = requirePermission(request, 'stock:loss');
    const input = lossSchema.parse(request.body);
    const movement = await withTransaction(pool, (client) => registerLoss(client, input, user.id));
    reply.status(201);
    return movement;
  });

  app.post('/api/stock/adjustments', async (request, reply) => {
    const user = requirePermission(request, 'stock:adjust');
    const input = adjustmentSchema.parse(request.body);
    const movement = await withTransaction(pool, (client) => adjustStock(client, input, user.id));
    reply.status(201);
    return movement;
  });

  app.post('/api/stock/movements/:id/reversal', async (request, reply) => {
    const user = requirePermission(request, 'stock:reverse');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    const movement = await withTransaction(pool, (client) =>
      reverseStockMovement(client, id, reason, user.id),
    );
    reply.status(201);
    return movement;
  });
}
