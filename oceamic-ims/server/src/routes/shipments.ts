import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import { SHIPMENT_STATUSES } from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { decimalSchema, limitSchema, requiredTextSchema, uuidSchema } from '../http/schemas.ts';
import { listShipments, shipmentDetail } from '../services/fgQueries.ts';
import {
  addPalletToShipment,
  cancelShipment,
  confirmShipment,
  createShipment,
  removePalletFromShipment,
  updateShipmentContainerInfo,
} from '../services/shipments.ts';

export async function registerShipmentRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/shipments', async (request) => {
    requirePermission(request, 'stock:read');
    const query = z
      .object({
        recherche: z.string().trim().min(1).nullish(),
        client: uuidSchema.nullish(),
        statut: z.enum(SHIPMENT_STATUSES).nullish(),
        limite: limitSchema.nullish(),
      })
      .parse(request.query);
    return listShipments(pool, {
      search: query.recherche ?? null,
      customerId: query.client ?? null,
      status: query.statut ?? null,
      limit: query.limite ?? 100,
    });
  });

  app.get('/api/shipments/:id', async (request, reply) => {
    requirePermission(request, 'stock:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const detail = await shipmentDetail(pool, id);
    if (detail === null) {
      reply.status(404);
      return { code: 'INTROUVABLE', message: 'Expédition introuvable.' };
    }
    return detail;
  });

  app.post('/api/shipments', async (request, reply) => {
    const user = requirePermission(request, 'shipment:manage');
    const input = z
      .object({
        customerId: uuidSchema,
        plannedDate: z.iso.date(),
        destination: requiredTextSchema,
        containerNumber: z.string().trim().min(1).nullable(),
        sealNumber: z.string().trim().min(1).nullable(),
        vehicleRegistration: z.string().trim().min(1).nullable(),
        targetTemperatureC: decimalSchema,
        gensetRequired: z.boolean().nullable(),
        notes: z.string().trim().min(1).nullable(),
      })
      .parse(request.body);
    reply.status(201);
    return createShipment(pool, input, user.id);
  });

  app.post('/api/shipments/:id/conteneur', async (request) => {
    const user = requirePermission(request, 'shipment:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = z
      .object({
        containerNumber: z.string().trim().min(1).nullable(),
        sealNumber: z.string().trim().min(1).nullable(),
        vehicleRegistration: z.string().trim().min(1).nullable(),
        targetTemperatureC: decimalSchema,
        gensetRequired: z.boolean().nullable(),
      })
      .parse(request.body);
    await updateShipmentContainerInfo(pool, id, input, user.id);
    return { status: 'ok' };
  });

  app.post('/api/shipments/:id/palettes', async (request, reply) => {
    const user = requirePermission(request, 'shipment:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { palletId } = z.object({ palletId: uuidSchema }).parse(request.body);
    reply.status(201);
    await addPalletToShipment(pool, id, palletId, user.id);
    return { status: 'ok' };
  });

  app.delete('/api/shipments/:id/palettes/:palletId', async (request) => {
    const user = requirePermission(request, 'shipment:manage');
    const { id, palletId } = z.object({ id: uuidSchema, palletId: uuidSchema }).parse(request.params);
    await removePalletFromShipment(pool, id, palletId, user.id);
    return { status: 'ok' };
  });

  app.post('/api/shipments/:id/confirmation', async (request) => {
    const user = requirePermission(request, 'shipment:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await confirmShipment(pool, id, user.id);
    return { status: 'ok' };
  });

  app.post('/api/shipments/:id/annulation', async (request) => {
    const user = requirePermission(request, 'shipment:manage');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = z.object({ reason: requiredTextSchema }).parse(request.body);
    await cancelShipment(pool, id, reason, user.id);
    return { status: 'ok' };
  });
}
