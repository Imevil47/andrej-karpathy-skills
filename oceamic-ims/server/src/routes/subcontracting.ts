import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDependencies } from '../app.ts';
import {
  SUBCONTRACTING_RESULT_TYPES,
  SUBCONTRACTING_SOURCE_TYPES,
  SUBCONTRACTING_STATUSES,
} from '../domain/types.ts';
import { requirePermission } from '../http/context.ts';
import { quantityKgSchema, uuidSchema } from '../http/schemas.ts';
import {
  addSubcontractingResult,
  closeSubcontractingOperation,
  getSubcontractingOperation,
  listSubcontractingOperations,
  sendToSubcontractor,
} from '../services/subcontracting.ts';

const operationSchema = z
  .object({
    sentAt: z.coerce.date(),
    subcontractorId: uuidSchema,
    sourceType: z.enum(SUBCONTRACTING_SOURCE_TYPES),
    sourceLotId: uuidSchema.nullable(),
    sourceLocationId: uuidSchema.nullable(),
    supplierId: uuidSchema.nullable(),
    speciesId: uuidSchema.nullable(),
    newLotCode: z.string().trim().min(1).nullable(),
    quantitySentKg: quantityKgSchema,
    incomingQuality: z.string().trim().min(1).nullable(),
    incomingSizeGrade: z.string().trim().min(1).nullable(),
    notes: z.string().trim().min(1).nullable(),
  })
  .refine(
    (value) =>
      value.sourceType !== 'STOCK_EXISTANT' ||
      (value.sourceLotId !== null && value.sourceLocationId !== null),
    "Sur stock existant, le lot source et l'emplacement source sont obligatoires.",
  )
  .refine(
    (value) => value.sourceType !== 'FOURNISSEUR' || value.sourceLocationId === null,
    "En mode fournisseur, aucun emplacement source OCEAMIC ne doit être renseigné.",
  );

const resultSchema = z
  .object({
    resultType: z.enum(SUBCONTRACTING_RESULT_TYPES),
    resultLotMode: z.enum(['MEME_LOT', 'NOUVEAU_LOT']),
    newLotCode: z.string().trim().min(1).nullable(),
    quantityKg: quantityKgSchema,
    outgoingQuality: z.string().trim().min(1).nullable(),
    outgoingSizeGrade: z.string().trim().min(1).nullable(),
    destinationLocationId: uuidSchema.nullable(),
    qualityStatus: z.string().trim().min(1).nullable(),
  })
  .refine(
    (value) => value.resultType !== 'PRODUIT' || value.destinationLocationId !== null,
    "Un résultat produit doit avoir un emplacement de destination.",
  )
  .refine(
    (value) => value.resultType !== 'PERTE' || value.destinationLocationId === null,
    "Une perte n'a pas d'emplacement de destination.",
  );

export async function registerSubcontractingRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): Promise<void> {
  const { pool } = dependencies;

  app.get('/api/subcontracting', async (request) => {
    requirePermission(request, 'subcontracting:read');
    const query = z
      .object({ statut: z.enum(SUBCONTRACTING_STATUSES).nullish() })
      .parse(request.query);
    return listSubcontractingOperations(pool, query.statut ?? null);
  });

  app.get('/api/subcontracting/:id', async (request) => {
    requirePermission(request, 'subcontracting:read');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return getSubcontractingOperation(pool, id);
  });

  app.post('/api/subcontracting', async (request, reply) => {
    const user = requirePermission(request, 'subcontracting:create');
    const input = operationSchema.parse(request.body);
    reply.status(201);
    return sendToSubcontractor(pool, input, user.id);
  });

  app.post('/api/subcontracting/:id/results', async (request, reply) => {
    const user = requirePermission(request, 'subcontracting:result');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = resultSchema.parse(request.body);
    reply.status(201);
    return addSubcontractingResult(pool, id, input, user.id);
  });

  app.post('/api/subcontracting/:id/cloture', async (request) => {
    const user = requirePermission(request, 'subcontracting:result');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await closeSubcontractingOperation(pool, id, user.id);
    return { status: 'ok' };
  });
}
