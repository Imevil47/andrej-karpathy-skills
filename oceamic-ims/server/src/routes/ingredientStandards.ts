import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { requirePermission } from '../http/context.ts';
import { uuidSchema } from '../http/schemas.ts';
import { createIngredientConsumptionStandard, listIngredientConsumptionStandards } from '../services/ingredientStandards.ts';

const targetSchema = z.string().regex(/^\d{1,7}(\.\d{1,3})?$/, 'Valeur invalide.');

export async function registerIngredientStandardRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/ingredient-consumption-standards', async (request) => {
    requirePermission(request, 'ingredient:read');
    const { ingredient } = z.object({ ingredient: uuidSchema.nullish() }).parse(request.query);
    return listIngredientConsumptionStandards(pool, ingredient ?? null);
  });

  // Section 59: standards are configuration, ADMIN/RESPONSABLE only.
  app.post('/api/ingredient-consumption-standards', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        ingredientId: uuidSchema,
        productId: uuidSchema.nullish().transform((value) => value ?? null),
        format: z.string().trim().min(1).nullish().transform((value) => value ?? null),
        fillingMediumId: uuidSchema.nullish().transform((value) => value ?? null),
        targetPer1000Units: targetSchema,
        minPer1000Units: targetSchema.nullish().transform((value) => value ?? null),
        maxPer1000Units: targetSchema.nullish().transform((value) => value ?? null),
        validFrom: z.iso.date(),
        validTo: z.iso.date().nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createIngredientConsumptionStandard(pool, input, user.id);
  });
}
