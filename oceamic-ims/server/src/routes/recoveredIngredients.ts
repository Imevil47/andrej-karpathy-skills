import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { INGREDIENT_UNITS, RECOVERED_BATCH_MANUAL_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  createRecoveredBatch,
  listRecoveredBatchReuses,
  listRecoveredBatches,
  reuseRecoveredBatch,
  setRecoveredBatchManualStatus,
} from '../services/recoveredIngredients.ts';

const quantitySchema = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, 'Quantité invalide.')
  .refine((value) => Number(value) > 0, 'La quantité doit être strictement positive.');

/**
 * Recovered material (sections 24-32) - its own routes, distinct from the
 * general ingredient stock ledger (services/ingredientStock.ts) per the
 * domain-separation decision documented in 033_ingredient_stock.sql.
 */
export async function registerRecoveredIngredientRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/recovered-ingredients', async (request) => {
    requirePermission(request, 'ingredient:read');
    const query = z
      .object({ ingredient: uuidSchema.nullish(), disponiblesUniquement: z.enum(['true', 'false']).nullish() })
      .parse(request.query);
    return listRecoveredBatches(pool, { ingredientId: query.ingredient ?? null, availableOnly: query.disponiblesUniquement === 'true' });
  });

  app.get('/api/recovered-ingredients/:id/reutilisations', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listRecoveredBatchReuses(pool, id);
  });

  // Section 50: recovery entry - the deadline is always calculated, never
  // typed by the operator.
  app.post('/api/recovered-ingredients', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:consume');
    const input = z
      .object({
        ingredientId: uuidSchema,
        sourceProductionRunId: uuidSchema,
        sourceFillingOperationId: uuidSchema.nullish().transform((value) => value ?? null),
        recoveredAt: z.coerce.date().nullish(),
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        storageLocationId: uuidSchema.nullish().transform((value) => value ?? null),
        containerId: uuidSchema.nullish().transform((value) => value ?? null),
        notes: z.string().trim().min(1).nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createRecoveredBatch(pool, { ...input, recoveredAt: input.recoveredAt ?? new Date() }, user.id);
  });

  // Section 52: reuse - only non-expired, non-blocked batches are accepted;
  // the service re-checks the effective status right before committing.
  app.post('/api/recovered-ingredients/:id/reutilisation', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:consume');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        destinationProductionRunId: uuidSchema,
        destinationFillingOperationId: uuidSchema.nullish().transform((value) => value ?? null),
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        reusedAt: z.coerce.date().nullish(),
      })
      .parse(request.body);
    reply.status(201);
    return reuseRecoveredBatch(
      pool,
      { recoveredBatchId: id, ...input, reusedAt: input.reusedAt ?? new Date() },
      user.id,
    );
  });

  app.post('/api/recovered-ingredients/:id/statut', async (request) => {
    const user = requirePermission(request, 'ingredient:quality');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z.object({ status: z.enum(RECOVERED_BATCH_MANUAL_STATUSES), reason: requiredTextSchema }).parse(request.body);
    await setRecoveredBatchManualStatus(pool, id, input.status, input.reason, user.id);
    return { id };
  });

  app.get('/api/ingredient-containers', async (request) => {
    requirePermission(request, 'ingredient:read');
    const result = await pool.query('SELECT id, container_code, container_type, capacity FROM ingredient_containers WHERE is_active ORDER BY container_code');
    return result.rows;
  });

  app.post('/api/ingredient-containers', async (request, reply) => {
    requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        containerCode: requiredTextSchema,
        containerType: requiredTextSchema,
        capacity: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    const result = await pool.query<{ id: string }>(
      'INSERT INTO ingredient_containers (container_code, container_type, capacity) VALUES ($1, $2, $3) RETURNING id',
      [input.containerCode.toUpperCase(), input.containerType, input.capacity],
    );
    return { id: result.rows[0]?.id };
  });
}
