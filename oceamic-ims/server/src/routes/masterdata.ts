import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { LOCATION_TYPES, STOCK_TYPES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import { listUsers } from '../services/auth.ts';
import {
  createLocation,
  createLossReason,
  createProduct,
  createProductionLine,
  createSpecies,
  createSubcontractor,
  createSupplier,
  createVessel,
  listLocations,
  listLossReasons,
  listProductionLines,
  listProductionStages,
  listProducts,
  listSpecies,
  listSubcontractors,
  listSuppliers,
  listVessels,
  setActivation,
} from '../services/masterdata.ts';

const includeInactiveSchema = z.object({
  inactifs: z
    .enum(['true', 'false'])
    .nullish()
    .transform((value) => value === 'true'),
});

const activationSchema = z.object({
  target: z.enum([
    'species',
    'suppliers',
    'vessels',
    'locations',
    'subcontractors',
    'products',
    'production_lines',
    'production_loss_reasons',
  ]),
  id: uuidSchema,
});

export async function registerMasterDataRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/species', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listSpecies(pool, inactifs);
  });

  app.get('/api/suppliers', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listSuppliers(pool, inactifs);
  });

  app.get('/api/vessels', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listVessels(pool, inactifs);
  });

  app.get('/api/locations', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listLocations(pool, inactifs);
  });

  app.get('/api/subcontractors', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listSubcontractors(pool, inactifs);
  });

  app.get('/api/products', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listProducts(pool, inactifs);
  });

  app.get('/api/production-lines', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listProductionLines(pool, inactifs);
  });

  app.get('/api/production-stages', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listProductionStages(pool, inactifs);
  });

  app.get('/api/production-loss-reasons', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listLossReasons(pool, inactifs);
  });

  app.post('/api/products', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        speciesId: uuidSchema,
        productFamily: z.string().trim().min(1).nullable(),
        format: z.string().trim().min(1).nullable(),
        piecesPerCan: z.number().int().positive().nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createProduct(pool, input, user.id);
  });

  app.post('/api/production-lines', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        area: z.string().trim().min(1).nullable(),
        displayOrder: z.number().int().min(0),
      })
      .parse(request.body);
    reply.status(201);
    return createProductionLine(pool, input, user.id);
  });

  app.post('/api/production-loss-reasons', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        outputType: z.enum(['PERTE_REELLE', 'SOUS_PRODUIT', 'REWORK', 'RECLASSEMENT']),
      })
      .parse(request.body);
    reply.status(201);
    return createLossReason(pool, input, user.id);
  });

  app.get('/api/users', async (request) => {
    requirePermission(request, 'users:manage');
    return listUsers(pool);
  });

  app.post('/api/species', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({ code: requiredTextSchema, name: requiredTextSchema })
      .parse(request.body);
    reply.status(201);
    return createSpecies(pool, input, user.id);
  });

  app.post('/api/suppliers', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        country: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createSupplier(pool, input, user.id);
  });

  app.post('/api/vessels', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        registration: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createVessel(pool, input, user.id);
  });

  app.post('/api/locations', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        stockType: z.enum(STOCK_TYPES),
        locationType: z.enum(LOCATION_TYPES),
        canReceive: z.boolean(),
        canStore: z.boolean(),
      })
      .parse(request.body);
    reply.status(201);
    return createLocation(pool, input, user.id);
  });

  app.post('/api/subcontractors', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        locationId: uuidSchema,
      })
      .parse(request.body);
    reply.status(201);
    return createSubcontractor(pool, input, user.id);
  });

  app.post('/api/masterdata/:target/:id/activation', async (request) => {
    const user = requirePermission(request, 'masterdata:write');
    const { target, id } = activationSchema.parse(request.params);
    const { isActive } = z.object({ isActive: z.boolean() }).parse(request.body);
    await setActivation(pool, target, id, isActive, user.id);
    return { status: 'ok' };
  });
}
