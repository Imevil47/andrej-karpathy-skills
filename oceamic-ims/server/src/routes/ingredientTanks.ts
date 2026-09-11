import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { INGREDIENT_UNITS } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  addTankBatchInput,
  closeTankBatch,
  createTank,
  listTankBatches,
  listTankBatchInputs,
  listTankMeasurements,
  listTanks,
  openTankBatch,
  recordTankMeasurement,
} from '../services/ingredientTanks.ts';
import { getTankBatchGenealogy } from '../services/ingredientConsumption.ts';
import { listIngredientMovements, loseFromTankBatch } from '../services/ingredientStock.ts';

const quantitySchema = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, 'Quantité invalide.')
  .refine((value) => Number(value) > 0, 'La quantité doit être strictement positive.');

export async function registerIngredientTankRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/ingredient-tanks', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { inactifs } = z.object({ inactifs: z.enum(['true', 'false']).nullish() }).parse(request.query);
    return listTanks(pool, inactifs === 'true');
  });

  app.post('/api/ingredient-tanks', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        tankCode: requiredTextSchema,
        name: requiredTextSchema,
        ingredientTypeId: uuidSchema.nullish().transform((value) => value ?? null),
        capacityLiters: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).nullish().transform((value) => value ?? null),
        locationId: uuidSchema.nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createTank(pool, input, user.id);
  });

  app.get('/api/ingredient-tanks/:id/mesures', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listTankMeasurements(pool, id);
  });

  app.post('/api/ingredient-tanks/:id/mesures', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:transfer');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        measuredAt: z.coerce.date().nullish(),
        quantity: z.string().regex(/^\d{1,10}(\.\d{1,3})?$/, 'Quantité invalide.'),
        unit: z.enum(INGREDIENT_UNITS),
        measurementMethod: z.string().trim().min(1).nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return recordTankMeasurement(
      pool,
      { tankId: id, measuredAt: input.measuredAt ?? new Date(), quantity: input.quantity, unit: input.unit, measurementMethod: input.measurementMethod },
      user.id,
    );
  });

  // --- Tank batches (section 21): genealogy of what a cuve actually holds --

  app.get('/api/tank-batches', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { tank } = z.object({ tank: uuidSchema.nullish() }).parse(request.query);
    return listTankBatches(pool, tank ?? null);
  });

  app.get('/api/tank-batches/:id/entrees', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listTankBatchInputs(pool, id);
  });

  app.get('/api/tank-batches/:id/genealogie', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return getTankBatchGenealogy(pool, id);
  });

  app.get('/api/tank-batches/:id/mouvements', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listIngredientMovements(pool, { ingredientLotId: null, tankBatchId: id, limit: 200 });
  });

  app.post('/api/ingredient-tanks/:id/lots', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:transfer');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z.object({ startedAt: z.coerce.date().nullish() }).parse(request.body);
    reply.status(201);
    return openTankBatch(pool, id, input.startedAt ?? new Date(), user.id);
  });

  app.post('/api/tank-batches/:id/entrees', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:transfer');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        ingredientLotId: uuidSchema,
        sourceLocationId: uuidSchema,
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        addedAt: z.coerce.date().nullish(),
      })
      .parse(request.body);
    reply.status(201);
    return addTankBatchInput(
      pool,
      { tankBatchId: id, ingredientLotId: input.ingredientLotId, sourceLocationId: input.sourceLocationId, quantity: input.quantity, unit: input.unit, addedAt: input.addedAt ?? new Date() },
      user.id,
    );
  });

  // Section 34: a loss drawn directly from a cuve (e.g. spillage during a
  // Run's process), distinct from a lot-level loss - always its own PERTE
  // movement, never hidden inside an adjustment.
  app.post('/api/tank-batches/:id/perte', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:transfer');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        sourceLocationId: uuidSchema,
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        occurredAt: z.coerce.date().nullish(),
        lossReasonId: uuidSchema,
        reason: z.string().trim().min(1).nullish().transform((value) => value ?? null),
        productionRunId: uuidSchema.nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return loseFromTankBatch(
      pool,
      { tankBatchId: id, ...input, occurredAt: input.occurredAt ?? new Date() },
      user.id,
    );
  });

  app.post('/api/tank-batches/:id/cloture', async (request) => {
    const user = requirePermission(request, 'ingredient:transfer');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z.object({ closedAt: z.coerce.date().nullish() }).parse(request.body);
    await closeTankBatch(pool, id, input.closedAt ?? new Date(), user.id);
    return { id };
  });
}
