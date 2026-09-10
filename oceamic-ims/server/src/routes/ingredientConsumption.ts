import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { INGREDIENT_UNITS, PROCESS_UTILITY_TYPES } from '../domain/types.ts';
import { notFoundError } from '../errors.ts';
import { requirePermission } from '../http/context.ts';
import { uuidSchema } from '../http/schemas.ts';
import {
  cansProducedByRun,
  ingredientConsumptionPer1000ForRun,
  listProcessUtilityConsumptions,
  listRunIngredientConsumptions,
  recordDirectIngredientConsumption,
  recordProcessUtilityConsumption,
  recordTankIngredientConsumption,
} from '../services/ingredientConsumption.ts';
import { ingredientTraceabilityForRun, runIngredientMaterialBalance } from '../services/ingredientQueries.ts';
import { compareConsumptionToStandard } from '../services/ingredientStandards.ts';

const quantitySchema = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, 'Quantité invalide.')
  .refine((value) => Number(value) > 0, 'La quantité doit être strictement positive.');

export async function registerIngredientConsumptionRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/production/runs/:id/ingredients', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const [consumptions, balance, cans, traceability] = await Promise.all([
      listRunIngredientConsumptions(pool, id),
      runIngredientMaterialBalance(pool, id),
      cansProducedByRun(pool, id),
      ingredientTraceabilityForRun(pool, id),
    ]);
    return { consumptions, balance, cansProduced: cans, traceability };
  });

  app.get('/api/production/runs/:id/ingredients/:ingredientId/consommation-1000', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id, ingredientId } = z.object({ id: uuidSchema, ingredientId: uuidSchema }).parse(request.params);
    return ingredientConsumptionPer1000ForRun(pool, id, ingredientId);
  });

  // Section 40/41: actual consumption/1000 cans against the configured
  // standard - overconsumption is flagged, never auto-treated as a
  // food-safety non-conformity, and a missing standard is its own status
  // (STANDARD_NON_DEFINI), never fabricated.
  app.get('/api/production/runs/:id/ingredients/:ingredientId/standard', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id, ingredientId } = z.object({ id: uuidSchema, ingredientId: uuidSchema }).parse(request.params);
    const run = await pool.query<{ product_id: string; format: string | null; production_date: string }>(
      'SELECT product_id, format, production_date::text AS production_date FROM production_runs WHERE id = $1',
      [id],
    );
    const row = run.rows[0];
    if (!row) {
      throw notFoundError('Ordre de production', id);
    }
    const consumption = await ingredientConsumptionPer1000ForRun(pool, id, ingredientId);
    return compareConsumptionToStandard(pool, {
      ingredientId,
      productId: row.product_id,
      format: row.format,
      atDate: row.production_date,
      quantity: consumption.totalQuantity,
      unitsProduced: consumption.totalCans,
    });
  });

  // Rapid consumption entry (section 49): direct-lot or tank-sourced.
  app.post('/api/production/runs/:id/ingredients/consommation-directe', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:consume');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        fillingOperationId: uuidSchema.nullish().transform((value) => value ?? null),
        ingredientLotId: uuidSchema,
        sourceLocationId: uuidSchema,
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        consumedAt: z.coerce.date().nullish(),
      })
      .parse(request.body);
    reply.status(201);
    return recordDirectIngredientConsumption(
      pool,
      { productionRunId: id, fillingOperationId: input.fillingOperationId, ingredientLotId: input.ingredientLotId, sourceLocationId: input.sourceLocationId, quantity: input.quantity, unit: input.unit, consumedAt: input.consumedAt ?? new Date() },
      user.id,
    );
  });

  app.post('/api/production/runs/:id/ingredients/consommation-cuve', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:consume');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        fillingOperationId: uuidSchema.nullish().transform((value) => value ?? null),
        tankBatchId: uuidSchema,
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        consumedAt: z.coerce.date().nullish(),
      })
      .parse(request.body);
    reply.status(201);
    return recordTankIngredientConsumption(
      pool,
      { productionRunId: id, fillingOperationId: input.fillingOperationId, tankBatchId: input.tankBatchId, quantity: input.quantity, unit: input.unit, consumedAt: input.consumedAt ?? new Date() },
      user.id,
    );
  });

  app.get('/api/production/runs/:id/utilites', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listProcessUtilityConsumptions(pool, id);
  });

  app.post('/api/production/runs/:id/utilites', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:consume');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        utilityType: z.enum(PROCESS_UTILITY_TYPES),
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        occurredAt: z.coerce.date().nullish(),
        notes: z.string().trim().min(1).nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return recordProcessUtilityConsumption(
      pool,
      { productionRunId: id, utilityType: input.utilityType, quantity: input.quantity, unit: input.unit, occurredAt: input.occurredAt ?? new Date(), notes: input.notes },
      user.id,
    );
  });
}
