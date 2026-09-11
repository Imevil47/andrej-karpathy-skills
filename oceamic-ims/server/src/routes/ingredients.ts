import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { INGREDIENT_QUALITY_STATUSES, INGREDIENT_UNITS } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import {
  createIngredient,
  createIngredientLot,
  createIngredientType,
  getIngredientLotDetail,
  listIngredientLots,
  listIngredients,
  listIngredientTypes,
  updateIngredientLotQualityStatus,
} from '../services/ingredients.ts';
import {
  adjustIngredientLot,
  ingredientLotTotalStock,
  listIngredientMovements,
  listIngredientStock,
  loseIngredientLot,
  receiveIngredientLot,
  transferIngredientLot,
} from '../services/ingredientStock.ts';

const quantitySchema = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, 'Quantité invalide.')
  .refine((value) => Number(value) > 0, 'La quantité doit être strictement positive.');

const includeInactiveSchema = z.object({
  inactifs: z.enum(['true', 'false']).nullish(),
});

export async function registerIngredientRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  // --- Master data: ingredient types, ingredients -----------------------

  app.get('/api/ingredient-types', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listIngredientTypes(pool, inactifs === 'true');
  });

  app.post('/api/ingredient-types', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z.object({ code: requiredTextSchema, name: requiredTextSchema }).parse(request.body);
    reply.status(201);
    return createIngredientType(pool, input, user.id);
  });

  app.get('/api/ingredients', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listIngredients(pool, inactifs === 'true');
  });

  app.post('/api/ingredients', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        ingredientCode: requiredTextSchema,
        name: requiredTextSchema,
        ingredientTypeId: uuidSchema,
        defaultUnit: z.enum(INGREDIENT_UNITS),
        fillingMediumId: uuidSchema.nullish().transform((value) => value ?? null),
        requiresLotTraceability: z.boolean().default(true),
        isRecoverable: z.boolean().default(false),
      })
      .parse(request.body);
    reply.status(201);
    return createIngredient(pool, input, user.id);
  });

  // --- Ingredient lots -----------------------------------------------------

  app.get('/api/ingredient-lots', async (request) => {
    requirePermission(request, 'ingredient:read');
    const query = z
      .object({ ingredient: uuidSchema.nullish(), statut: z.enum(INGREDIENT_QUALITY_STATUSES).nullish() })
      .parse(request.query);
    return listIngredientLots(pool, { ingredientId: query.ingredient ?? null, qualityStatus: query.statut ?? null });
  });

  app.get('/api/ingredient-lots/:id', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return getIngredientLotDetail(pool, id);
  });

  app.get('/api/ingredient-lots/:id/stock', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return { quantity: await ingredientLotTotalStock(pool, id) };
  });

  app.get('/api/ingredient-lots/:id/mouvements', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return listIngredientMovements(pool, { ingredientLotId: id, tankBatchId: null, limit: 200 });
  });

  // Section 8: a supplier batch. Reception (STOCK) opens with the lot
  // itself, then a RECEPTION movement (below) puts the quantity into stock.
  app.post('/api/ingredient-lots', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:reception');
    const input = z
      .object({
        lotCode: requiredTextSchema,
        ingredientId: uuidSchema,
        supplierId: uuidSchema.nullish().transform((value) => value ?? null),
        supplierLotCode: z.string().trim().min(1).nullish().transform((value) => value ?? null),
        receivedAt: z.coerce.date().nullish().transform((value) => value ?? null),
        manufactureDate: z.iso.date().nullish().transform((value) => value ?? null),
        expiryDate: z.iso.date().nullish().transform((value) => value ?? null),
        notes: z.string().trim().min(1).nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createIngredientLot(pool, input, user.id);
  });

  app.post('/api/ingredient-lots/:id/qualite', async (request) => {
    const user = requirePermission(request, 'ingredient:quality');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z.object({ status: z.enum(INGREDIENT_QUALITY_STATUSES), reason: requiredTextSchema }).parse(request.body);
    await updateIngredientLotQualityStatus(pool, id, input.status, input.reason, user.id);
    return { id };
  });

  // --- Stock and movements -------------------------------------------------

  app.get('/api/ingredient-stock', async (request) => {
    requirePermission(request, 'ingredient:read');
    const query = z.object({ ingredient: uuidSchema.nullish(), emplacement: uuidSchema.nullish() }).parse(request.query);
    return listIngredientStock(pool, { ingredientId: query.ingredient ?? null, locationId: query.emplacement ?? null });
  });

  app.post('/api/ingredient-lots/:id/reception', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:reception');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        destinationLocationId: uuidSchema,
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        occurredAt: z.coerce.date().nullish(),
      })
      .parse(request.body);
    reply.status(201);
    return receiveIngredientLot(
      pool,
      { ingredientLotId: id, destinationLocationId: input.destinationLocationId, quantity: input.quantity, unit: input.unit, occurredAt: input.occurredAt ?? new Date() },
      user.id,
    );
  });

  app.post('/api/ingredient-lots/:id/transfert', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:transfer');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        sourceLocationId: uuidSchema,
        destinationLocationId: uuidSchema,
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        occurredAt: z.coerce.date().nullish(),
      })
      .parse(request.body);
    reply.status(201);
    return transferIngredientLot(
      pool,
      { ingredientLotId: id, ...input, occurredAt: input.occurredAt ?? new Date() },
      user.id,
    );
  });

  app.post('/api/ingredient-lots/:id/perte', async (request, reply) => {
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
      })
      .parse(request.body);
    reply.status(201);
    return loseIngredientLot(
      pool,
      { ingredientLotId: id, ...input, occurredAt: input.occurredAt ?? new Date() },
      user.id,
    );
  });

  app.post('/api/ingredient-lots/:id/ajustement', async (request, reply) => {
    const user = requirePermission(request, 'ingredient:adjust');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        locationId: uuidSchema,
        quantity: quantitySchema,
        unit: z.enum(INGREDIENT_UNITS),
        direction: z.enum(['AUGMENTATION', 'DIMINUTION']),
        occurredAt: z.coerce.date().nullish(),
        reason: requiredTextSchema,
      })
      .parse(request.body);
    reply.status(201);
    return adjustIngredientLot(
      pool,
      { ingredientLotId: id, ...input, occurredAt: input.occurredAt ?? new Date() },
      user.id,
    );
  });

  app.get('/api/ingredient-loss-reasons', async (request) => {
    requirePermission(request, 'ingredient:read');
    const result = await pool.query('SELECT id, code, name FROM ingredient_loss_reasons WHERE is_active ORDER BY code');
    return result.rows;
  });

  app.post('/api/ingredient-loss-reasons', async (request, reply) => {
    requirePermission(request, 'masterdata:write');
    const input = z.object({ code: requiredTextSchema, name: requiredTextSchema }).parse(request.body);
    reply.status(201);
    const result = await pool.query<{ id: string }>(
      'INSERT INTO ingredient_loss_reasons (code, name) VALUES ($1, $2) RETURNING id',
      [input.code.toUpperCase(), input.name],
    );
    return { id: result.rows[0]?.id };
  });
}
