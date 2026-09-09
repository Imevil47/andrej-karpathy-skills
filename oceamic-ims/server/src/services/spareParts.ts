import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { SparePartMovementType } from '../domain/types.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { requireIntervention } from './interventions.ts';

// SPARE PART is its own maintenance-inventory identity (section 38),
// entirely separate from the Phase 1 fish/raw-material stock engine - its
// own tables, own movement vocabulary, no shared code. current_stock is
// never cached: always SUM(quantity_delta) through spare_part_stock (see
// 031_maintenance_views.sql), the same discipline as raw_material_lots.

export type SparePart = Readonly<{ id: string; partCode: string; name: string }>;

async function requireSparePart(client: DatabaseClient, id: string): Promise<SparePart> {
  const result = await client.query<{ id: string; part_code: string; name: string }>(
    'SELECT id, part_code, name FROM spare_parts WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Pièce de rechange', id);
  }
  return { id: row.id, partCode: row.part_code, name: row.name };
}

export type CreateSparePartInput = Readonly<{
  partCode: string;
  name: string;
  description: string | null;
  unit: string;
  minimumStock: string;
  locationId: string | null;
}>;

export async function createSparePart(pool: pg.Pool, input: CreateSparePartInput, actorId: string): Promise<SparePart> {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM spare_parts WHERE part_code = $1', [input.partCode]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`La pièce de rechange ${input.partCode} existe déjà.`, { partCode: input.partCode });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO spare_parts (part_code, name, description, unit, minimum_stock, location_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        input.partCode.toUpperCase(),
        input.name,
        input.description,
        input.unit,
        input.minimumStock,
        input.locationId,
        actorId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La pièce de rechange n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'spare_parts',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id, partCode: input.partCode.toUpperCase(), name: input.name };
  });
}

async function insertStockMovement(
  client: DatabaseClient,
  sparePartId: string,
  movementType: SparePartMovementType,
  quantityDelta: string,
  reason: string | null,
  actorId: string,
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO spare_part_stock_movements (spare_part_id, movement_type, quantity_delta, reason, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sparePartId, movementType, quantityDelta, reason, actorId],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("Le mouvement de stock n'a pas pu être enregistré.");
  }
  return id;
}

/** RECEPTION / RETOUR: stock entering the shelf. */
export async function receiveSparePartStock(
  pool: pg.Pool,
  sparePartId: string,
  movementType: Extract<SparePartMovementType, 'RECEPTION' | 'RETOUR'>,
  quantity: string,
  reason: string | null,
  actorId: string,
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const part = await requireSparePart(client, sparePartId);
    if (Number(quantity) <= 0) {
      throw validationError('La quantité doit être positive.', { sparePartId, quantity });
    }
    const movementId = await insertStockMovement(client, sparePartId, movementType, quantity, reason, actorId);
    await recordAudit(client, {
      userId: actorId,
      action: 'SPAREPART_MOUVEMENT',
      entityType: 'spare_part_stock_movements',
      entityId: movementId,
      oldValues: null,
      newValues: { partCode: part.partCode, movementType, quantity },
      context: null,
    });
  });
}

/**
 * A manual correction (section 40), gated at the route by sparepart:adjust
 * (RESPONSABLE_MAINTENANCE only) - quantityDelta is signed and can move
 * stock in either direction.
 */
export async function adjustSparePartStock(
  pool: pg.Pool,
  sparePartId: string,
  quantityDelta: string,
  reason: string,
  actorId: string,
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const part = await requireSparePart(client, sparePartId);
    if (Number(quantityDelta) === 0) {
      throw validationError('Un ajustement doit être non nul.', { sparePartId });
    }
    const movementId = await insertStockMovement(client, sparePartId, 'AJUSTEMENT', quantityDelta, reason, actorId);
    await recordAudit(client, {
      userId: actorId,
      action: 'SPAREPART_AJUSTEMENT',
      entityType: 'spare_part_stock_movements',
      entityId: movementId,
      oldValues: null,
      newValues: { partCode: part.partCode, quantityDelta, reason },
      context: null,
    });
  });
}

/**
 * Parts consumed by an intervention (section 39/46's "Pièces utilisées"
 * step). One SORTIE_INTERVENTION movement and one maintenance_part_usage
 * row are created together, in the same transaction, and
 * maintenance_part_usage.stock_movement_id is UNIQUE - a part usage can
 * never subtract stock twice (section 55).
 */
export async function recordPartUsage(
  pool: pg.Pool,
  interventionId: string,
  sparePartId: string,
  quantity: string,
  actorId: string,
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const intervention = await requireIntervention(client, interventionId);
    if (intervention.endedAt !== null) {
      throw conflictError('Cette intervention est déjà terminée, aucune pièce ne peut plus y être ajoutée.', {
        interventionId,
      });
    }
    const part = await requireSparePart(client, sparePartId);
    if (Number(quantity) <= 0) {
      throw validationError('La quantité doit être positive.', { sparePartId, quantity });
    }
    const movementId = await insertStockMovement(
      client,
      sparePartId,
      'SORTIE_INTERVENTION',
      `-${quantity}`,
      `Intervention ${interventionId}`,
      actorId,
    );
    const usage = await client.query<{ id: string }>(
      `INSERT INTO maintenance_part_usage (intervention_id, spare_part_id, quantity, stock_movement_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [interventionId, sparePartId, quantity, movementId, actorId],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'SPAREPART_CONSOMMATION',
      entityType: 'maintenance_part_usage',
      entityId: usage.rows[0]?.id ?? null,
      oldValues: null,
      newValues: { partCode: part.partCode, quantity, interventionId },
      context: null,
    });
  });
}

export type SparePartRow = Readonly<{
  id: string;
  partCode: string;
  name: string;
  description: string | null;
  unit: string;
  minimumStock: string;
  currentStock: string;
  belowMinimum: boolean;
  locationCode: string | null;
  isActive: boolean;
}>;

export async function listSpareParts(pool: pg.Pool, includeInactive: boolean, belowMinimumOnly: boolean): Promise<readonly SparePartRow[]> {
  const result = await pool.query<SparePartRow>(
    `SELECT sp.id AS "id", sp.part_code AS "partCode", sp.name AS "name",
            sp.description AS "description", sp.unit AS "unit",
            s.minimum_stock AS "minimumStock", s.current_stock AS "currentStock",
            s.below_minimum AS "belowMinimum", l.code AS "locationCode", sp.is_active AS "isActive"
       FROM spare_parts sp
       JOIN spare_part_stock s ON s.spare_part_id = sp.id
       LEFT JOIN locations l ON l.id = sp.location_id
      WHERE ($1::boolean IS TRUE OR sp.is_active IS TRUE)
        AND ($2::boolean IS FALSE OR s.below_minimum IS TRUE)
      ORDER BY sp.part_code`,
    [includeInactive, belowMinimumOnly],
  );
  return result.rows;
}

export type SparePartMovementRow = Readonly<{
  id: string;
  movementType: SparePartMovementType;
  quantityDelta: string;
  reason: string | null;
  occurredAt: Date;
  createdByName: string;
}>;

export async function listSparePartMovements(pool: pg.Pool, sparePartId: string): Promise<readonly SparePartMovementRow[]> {
  const result = await pool.query<SparePartMovementRow>(
    `SELECT m.id AS "id", m.movement_type AS "movementType", m.quantity_delta AS "quantityDelta",
            m.reason AS "reason", m.occurred_at AS "occurredAt", u.full_name AS "createdByName"
       FROM spare_part_stock_movements m
       JOIN users u ON u.id = m.created_by
      WHERE m.spare_part_id = $1
      ORDER BY m.occurred_at DESC`,
    [sparePartId],
  );
  return result.rows;
}
