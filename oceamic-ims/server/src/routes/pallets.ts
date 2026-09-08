import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { FG_DECISION_TYPES, FG_ENTITY_TYPES, PALLET_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import { decideFgQuality } from '../services/finishedGoodsQuality.ts';
import { fgStockByLocation, fgStockSummaryCards, listPallets, palletSituation } from '../services/fgQueries.ts';
import {
  adjustPalletStock,
  blockPalletLogistics,
  returnPallet,
  transferPallet,
} from '../services/fgStock.ts';
import { cancelPallet, createPallet } from '../services/pallets.ts';

export async function registerPalletRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/fg-stock/summary', async (request) => {
    requirePermission(request, 'stock:read');
    return fgStockSummaryCards(pool);
  });

  app.get('/api/fg-stock/by-location', async (request) => {
    requirePermission(request, 'stock:read');
    return fgStockByLocation(pool);
  });

  app.get('/api/pallets', async (request) => {
    requirePermission(request, 'stock:read');
    const query = z
      .object({
        recherche: z.string().trim().min(1).nullish(),
        statut: z.enum(PALLET_STATUSES).nullish(),
        statutQualite: z.string().nullish(),
        emplacement: uuidSchema.nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listPallets(pool, {
      search: query.recherche ?? null,
      status: query.statut ?? null,
      qualityStatus: query.statutQualite ?? null,
      locationId: query.emplacement ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/pallets/:id/situation', async (request, reply) => {
    requirePermission(request, 'stock:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const situation = await palletSituation(pool, id);
    if (situation === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Palette introuvable.' };
    }
    return situation;
  });

  app.post('/api/pallets', async (request, reply) => {
    const user = requirePermission(request, 'packaging:manage');
    const input = z
      .object({
        destinationLocationId: uuidSchema,
        occurredAt: z.coerce.date(),
        notes: z.string().trim().min(1).nullable(),
        contents: z
          .array(
            z.object({
              finishedGoodLotId: uuidSchema,
              quantityCartons: z.number().int().positive(),
              quantityUnits: z.number().int().positive(),
            }),
          )
          .min(1),
      })
      .parse(request.body);
    reply.status(201);
    return createPallet(pool, input, user.id);
  });

  app.post('/api/pallets/:id/annulation', async (request) => {
    const user = requirePermission(request, 'packaging:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelPallet(pool, id, reason, user.id);
    return { status: 'ok' };
  });

  app.post('/api/pallets/:id/transfert', async (request, reply) => {
    const user = requirePermission(request, 'fgstock:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        sourceLocationId: uuidSchema,
        destinationLocationId: uuidSchema,
        occurredAt: z.coerce.date(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return transferPallet(pool, { palletId: id, ...input }, user.id);
  });

  app.post('/api/pallets/:id/ajustement', async (request, reply) => {
    const user = requirePermission(request, 'fgstock:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        sourceLocationId: uuidSchema.nullable(),
        destinationLocationId: uuidSchema.nullable(),
        quantityCartons: z.number().int().positive(),
        quantityUnits: z.number().int().positive(),
        reason: requiredTextSchema,
        occurredAt: z.coerce.date(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return adjustPalletStock(pool, { palletId: id, ...input }, user.id);
  });

  app.post('/api/pallets/:id/blocage-logistique', async (request, reply) => {
    const user = requirePermission(request, 'fgstock:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        sourceLocationId: uuidSchema,
        destinationLocationId: uuidSchema,
        reason: requiredTextSchema,
        occurredAt: z.coerce.date(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return blockPalletLogistics(pool, { palletId: id, ...input }, user.id);
  });

  app.post('/api/pallets/:id/retour', async (request, reply) => {
    const user = requirePermission(request, 'fgstock:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        destinationLocationId: uuidSchema,
        quantityCartons: z.number().int().positive(),
        quantityUnits: z.number().int().positive(),
        reason: requiredTextSchema,
        occurredAt: z.coerce.date(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return returnPallet(pool, { palletId: id, ...input }, user.id);
  });

  // Polymorphic Finished Goods quality decision, shared by Lots PF and
  // pallets (section 20).
  app.post('/api/fg-quality/decisions', async (request, reply) => {
    const user = requirePermission(request, 'fgquality:decide');
    const input = z
      .object({
        entityType: z.enum(FG_ENTITY_TYPES),
        entityId: uuidSchema,
        decisionType: z.enum(FG_DECISION_TYPES),
        reason: requiredTextSchema,
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return decideFgQuality(pool, input, user.id);
  });
}
