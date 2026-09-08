import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import {
  CADENCE_ACTIVITIES,
  EQUIPMENT_TYPES,
  LOCATION_STOCK_DOMAINS,
  LOCATION_TYPES,
  MEASUREMENT_UNITS,
  STOCK_TYPES,
} from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { decimalSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import { listUsers } from '../services/auth.ts';
import {
  createCadenceStandard,
  createCustomer,
  createDowntimeCategory,
  createEmployee,
  createEquipment,
  createFillingMedium,
  createFillingSpec,
  createLocation,
  createLossReason,
  createMarkingVerificationItem,
  createProduct,
  createProductionLine,
  createSeamingParameter,
  createSeamingSpec,
  createSpecies,
  createSterilizationProgram,
  createSubcontractor,
  createSupplier,
  createVessel,
  listCadenceStandards,
  listCustomers,
  listDowntimeCategories,
  listEmployees,
  listEquipment,
  listFillingMedia,
  listFillingSpecs,
  listLocations,
  listLossReasons,
  listMarkingVerificationItems,
  listProductionLines,
  listProductionStages,
  listProducts,
  listSeamingParameters,
  listSeamingSpecs,
  listSpecies,
  listSterilizationPrograms,
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
    'employees',
    'cadence_standards',
    'downtime_categories',
    'equipment',
    'filling_media',
    'product_filling_specs',
    'seaming_parameters',
    'seaming_specifications',
    'sterilization_programs',
    'marking_verification_items',
    'customers',
  ]),
  id: uuidSchema,
});

const weightGramsSchema = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, 'Poids invalide.')
  .refine((value) => Number(value) > 0, 'Le poids doit être strictement positif.');

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
        stockDomain: z.enum(LOCATION_STOCK_DOMAINS),
      })
      .parse(request.body);
    reply.status(201);
    return createLocation(pool, input, user.id);
  });

  app.get('/api/customers', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listCustomers(pool, inactifs);
  });

  app.post('/api/customers', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        country: z.string().trim().min(1).nullable(),
        city: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createCustomer(pool, input, user.id);
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

  app.get('/api/employees', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listEmployees(pool, inactifs);
  });

  app.post('/api/employees', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        employeeNumber: requiredTextSchema,
        firstName: requiredTextSchema,
        lastName: requiredTextSchema,
        displayName: z
          .string()
          .trim()
          .min(1)
          .nullish()
          .transform((value) => value ?? null),
        department: z
          .string()
          .trim()
          .min(1)
          .nullish()
          .transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createEmployee(pool, input, user.id);
  });

  app.get('/api/downtime-categories', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listDowntimeCategories(pool, inactifs);
  });

  app.post('/api/downtime-categories', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({ code: requiredTextSchema, name: requiredTextSchema })
      .parse(request.body);
    reply.status(201);
    return createDowntimeCategory(pool, input, user.id);
  });

  app.get('/api/cadence-standards', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listCadenceStandards(pool, inactifs);
  });

  app.post('/api/cadence-standards', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        speciesId: uuidSchema.nullable(),
        productId: uuidSchema.nullable(),
        activityType: z.enum(CADENCE_ACTIVITIES),
        format: z.string().trim().min(1).nullable(),
        piecesPerCan: z.number().int().positive().nullable(),
        measurementUnit: z.enum(MEASUREMENT_UNITS),
        standardCadence: z
          .string()
          .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Cadence standard invalide.'),
        validFrom: z.iso.date().nullish().transform((value) => value ?? null),
        validTo: z.iso.date().nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createCadenceStandard(pool, input, user.id);
  });

  app.get('/api/equipment', async (request) => {
    requirePermission(request, 'masterdata:read');
    const query = z
      .object({ inactifs: includeInactiveSchema.shape.inactifs, type: z.enum(EQUIPMENT_TYPES).nullish() })
      .parse(request.query);
    return listEquipment(pool, query.inactifs, query.type ?? null);
  });

  app.post('/api/equipment', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        equipmentType: z.enum(EQUIPMENT_TYPES),
        locationId: uuidSchema.nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createEquipment(pool, input, user.id);
  });

  app.get('/api/filling-media', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listFillingMedia(pool, inactifs);
  });

  app.post('/api/filling-media', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({ code: requiredTextSchema, name: requiredTextSchema })
      .parse(request.body);
    reply.status(201);
    return createFillingMedium(pool, input, user.id);
  });

  app.get('/api/filling-specs', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listFillingSpecs(pool, inactifs);
  });

  app.post('/api/filling-specs', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        productId: uuidSchema,
        format: z.string().trim().min(1).nullable(),
        piecesPerCan: z.number().int().positive().nullable(),
        targetNetWeightG: decimalSchema,
        minWeightG: weightGramsSchema,
        maxWeightG: weightGramsSchema,
        targetFishWeightG: decimalSchema,
        targetMediumWeightG: decimalSchema,
        validFrom: z.iso.date().nullish().transform((value) => value ?? null),
        validTo: z.iso.date().nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createFillingSpec(pool, input, user.id);
  });

  app.get('/api/seaming-parameters', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listSeamingParameters(pool, inactifs);
  });

  app.post('/api/seaming-parameters', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        defaultUnit: requiredTextSchema,
      })
      .parse(request.body);
    reply.status(201);
    return createSeamingParameter(pool, input, user.id);
  });

  app.get('/api/seaming-specifications', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listSeamingSpecs(pool, inactifs);
  });

  app.post('/api/seaming-specifications', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        seamingParameterId: uuidSchema,
        productId: uuidSchema.nullable(),
        format: z.string().trim().min(1).nullable(),
        minValue: decimalSchema,
        maxValue: decimalSchema,
        targetValue: decimalSchema,
        unit: requiredTextSchema,
        validFrom: z.iso.date().nullish().transform((value) => value ?? null),
        validTo: z.iso.date().nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createSeamingSpec(pool, input, user.id);
  });

  app.get('/api/sterilization-programs', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listSterilizationPrograms(pool, inactifs);
  });

  app.post('/api/sterilization-programs', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({
        code: requiredTextSchema,
        name: requiredTextSchema,
        productId: uuidSchema.nullable(),
        format: z.string().trim().min(1).nullable(),
        targetTemperatureC: decimalSchema,
        targetPressureBar: decimalSchema,
        targetF0: decimalSchema,
        minimumF0: decimalSchema,
        maximumF0: decimalSchema,
        holdingTimeSeconds: z.number().int().positive().nullable(),
        validFrom: z.iso.date().nullish().transform((value) => value ?? null),
        validTo: z.iso.date().nullish().transform((value) => value ?? null),
      })
      .parse(request.body);
    reply.status(201);
    return createSterilizationProgram(pool, input, user.id);
  });

  app.get('/api/marking-verification-items', async (request) => {
    requirePermission(request, 'masterdata:read');
    const { inactifs } = includeInactiveSchema.parse(request.query);
    return listMarkingVerificationItems(pool, inactifs);
  });

  app.post('/api/marking-verification-items', async (request, reply) => {
    const user = requirePermission(request, 'masterdata:write');
    const input = z
      .object({ code: requiredTextSchema, name: requiredTextSchema })
      .parse(request.body);
    reply.status(201);
    return createMarkingVerificationItem(pool, input, user.id);
  });

  app.post('/api/masterdata/:target/:id/activation', async (request) => {
    const user = requirePermission(request, 'masterdata:write');
    const { target, id } = activationSchema.parse(request.params);
    const { isActive } = z.object({ isActive: z.boolean() }).parse(request.body);
    await setActivation(pool, target, id, isActive, user.id);
    return { status: 'ok' };
  });
}
