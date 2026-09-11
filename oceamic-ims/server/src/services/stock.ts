import type { DatabaseClient } from '../db/pool.ts';
import { isValidQuantity, toGrams, type QuantityKg } from '../domain/quantity.ts';
import { isBlockedByQuality, type MovementType, type ReferenceType } from '../domain/types.ts';
import {
  blockedLotError,
  conflictError,
  insufficientStockError,
  notFoundError,
  validationError,
} from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';

export type StockMovementInput = Readonly<{
  lotId: string;
  movementType: MovementType;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantityKg: QuantityKg;
  referenceType: ReferenceType;
  referenceId: string | null;
  reason: string | null;
  notes: string | null;
  occurredAt: Date;
  reversesMovementId: string | null;
}>;

export type StockMovement = Readonly<{
  id: string;
  movementCode: string;
  occurredAt: Date;
  rawMaterialLotId: string;
  movementType: MovementType;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantityKg: QuantityKg;
  referenceType: ReferenceType;
  referenceId: string | null;
  reason: string | null;
  notes: string | null;
}>;

type MovementRow = {
  id: string;
  movement_code: string;
  occurred_at: Date;
  raw_material_lot_id: string;
  movement_type: MovementType;
  source_location_id: string | null;
  destination_location_id: string | null;
  quantity_kg: string;
  reference_type: ReferenceType;
  reference_id: string | null;
  reason: string | null;
  notes: string | null;
};

function toMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    movementCode: row.movement_code,
    occurredAt: row.occurred_at,
    rawMaterialLotId: row.raw_material_lot_id,
    movementType: row.movement_type,
    sourceLocationId: row.source_location_id,
    destinationLocationId: row.destination_location_id,
    quantityKg: row.quantity_kg,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    reason: row.reason,
    notes: row.notes,
  };
}

/**
 * Serialises every concurrent operation touching the same LOT + EMPLACEMENT.
 * The lock is held until the transaction ends, so a stock check and the
 * movement it authorises can never be interleaved with another operation.
 */
async function lockLotLocation(
  client: DatabaseClient,
  lotId: string,
  locationId: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${lotId}:${locationId}`,
  ]);
}

export async function physicalStockAt(
  client: DatabaseClient,
  lotId: string,
  locationId: string,
): Promise<QuantityKg> {
  const result = await client.query<{ quantity_kg: string }>(
    `SELECT COALESCE((SELECT quantity_kg
                        FROM current_stock_by_lot_location
                       WHERE raw_material_lot_id = $1 AND location_id = $2), 0)::numeric(14,3)
            AS quantity_kg`,
    [lotId, locationId],
  );
  return result.rows[0]?.quantity_kg ?? '0.000';
}

export async function activeBlockOf(
  client: DatabaseClient,
  lotId: string,
): Promise<{ lotCode: string; reason: string } | null> {
  const result = await client.query<{ lot_code: string; reason: string }>(
    `SELECT l.lot_code, b.reason
       FROM blocked_lots b
       JOIN raw_material_lots l ON l.id = b.raw_material_lot_id
      WHERE b.raw_material_lot_id = $1`,
    [lotId],
  );
  const row = result.rows[0];
  return row ? { lotCode: row.lot_code, reason: row.reason } : null;
}

async function assertDestinationCanReceive(
  client: DatabaseClient,
  locationId: string,
): Promise<void> {
  const result = await client.query<{ code: string; can_receive: boolean; is_active: boolean }>(
    'SELECT code, can_receive, is_active FROM locations WHERE id = $1',
    [locationId],
  );
  const location = result.rows[0];
  if (!location) {
    throw notFoundError('Emplacement de destination', locationId);
  }
  if (!location.is_active) {
    throw validationError(`L'emplacement ${location.code} est désactivé.`, { locationId });
  }
  if (!location.can_receive) {
    throw validationError(`L'emplacement ${location.code} ne peut pas recevoir de marchandise.`, {
      locationId,
    });
  }
}

/**
 * Single entry point of the inventory ledger. Every quantity change of Phase 1
 * — reception, transfer, loss, subcontracting, adjustment — goes through here,
 * inside the caller's transaction.
 */
export async function createStockMovement(
  client: DatabaseClient,
  input: StockMovementInput,
  actorId: string,
): Promise<StockMovement> {
  if (!isValidQuantity(input.quantityKg) || toGrams(input.quantityKg) <= 0n) {
    throw validationError('La quantité doit être strictement positive.', {
      quantityKg: input.quantityKg,
    });
  }
  if (input.sourceLocationId === null && input.destinationLocationId === null) {
    throw validationError(
      'Un mouvement doit avoir un emplacement source ou un emplacement de destination.',
      { movementType: input.movementType },
    );
  }
  if (
    input.sourceLocationId !== null &&
    input.sourceLocationId === input.destinationLocationId
  ) {
    throw validationError(
      "L'emplacement source et l'emplacement de destination doivent être différents.",
      { locationId: input.sourceLocationId },
    );
  }

  if (input.destinationLocationId !== null) {
    await assertDestinationCanReceive(client, input.destinationLocationId);
  }

  if (input.sourceLocationId !== null) {
    if (isBlockedByQuality(input.movementType)) {
      const block = await activeBlockOf(client, input.lotId);
      if (block) {
        throw blockedLotError(block.lotCode, block.reason);
      }
    }

    await lockLotLocation(client, input.lotId, input.sourceLocationId);
    const available = await physicalStockAt(client, input.lotId, input.sourceLocationId);
    if (toGrams(available) < toGrams(input.quantityKg)) {
      throw insufficientStockError(available, input.quantityKg, {
        lotId: input.lotId,
        locationId: input.sourceLocationId,
        movementType: input.movementType,
      });
    }
  }

  const movementCode = await nextOperationalCode(client, 'MVT', input.occurredAt);
  const inserted = await client.query<MovementRow>(
    `INSERT INTO stock_movements (movement_code, occurred_at, raw_material_lot_id, movement_type,
                                  source_location_id, destination_location_id, quantity_kg,
                                  reference_type, reference_id, reason, notes,
                                  reverses_movement_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      movementCode,
      input.occurredAt,
      input.lotId,
      input.movementType,
      input.sourceLocationId,
      input.destinationLocationId,
      input.quantityKg,
      input.referenceType,
      input.referenceId,
      input.reason,
      input.notes,
      input.reversesMovementId,
      actorId,
    ],
  );

  const row = inserted.rows[0];
  if (!row) {
    throw new Error("Le mouvement de stock n'a pas pu être créé.");
  }
  return toMovement(row);
}

export type TransferInput = Readonly<{
  lotId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  quantityKg: QuantityKg;
  occurredAt: Date;
  notes: string | null;
}>;

export async function transferStock(
  client: DatabaseClient,
  input: TransferInput,
  actorId: string,
): Promise<StockMovement> {
  const movement = await createStockMovement(
    client,
    {
      lotId: input.lotId,
      movementType: 'TRANSFERT',
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      quantityKg: input.quantityKg,
      referenceType: 'TRANSFERT',
      referenceId: null,
      reason: null,
      notes: input.notes,
      occurredAt: input.occurredAt,
      reversesMovementId: null,
    },
    actorId,
  );

  await recordAudit(client, {
    userId: actorId,
    action: 'STOCK_TRANSFERT',
    entityType: 'stock_movements',
    entityId: movement.id,
    oldValues: null,
    newValues: {
      movementCode: movement.movementCode,
      lotId: input.lotId,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      quantityKg: input.quantityKg,
    },
    context: null,
  });

  return movement;
}

export type LossInput = Readonly<{
  lotId: string;
  sourceLocationId: string;
  quantityKg: QuantityKg;
  reason: string;
  occurredAt: Date;
  notes: string | null;
}>;

export async function registerLoss(
  client: DatabaseClient,
  input: LossInput,
  actorId: string,
): Promise<StockMovement> {
  const movement = await createStockMovement(
    client,
    {
      lotId: input.lotId,
      movementType: 'PERTE',
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: null,
      quantityKg: input.quantityKg,
      referenceType: 'PERTE',
      referenceId: null,
      reason: input.reason,
      notes: input.notes,
      occurredAt: input.occurredAt,
      reversesMovementId: null,
    },
    actorId,
  );

  await recordAudit(client, {
    userId: actorId,
    action: 'STOCK_PERTE',
    entityType: 'stock_movements',
    entityId: movement.id,
    oldValues: null,
    newValues: {
      movementCode: movement.movementCode,
      lotId: input.lotId,
      sourceLocationId: input.sourceLocationId,
      quantityKg: input.quantityKg,
      reason: input.reason,
    },
    context: null,
  });

  return movement;
}

export type AdjustmentInput = Readonly<{
  lotId: string;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantityKg: QuantityKg;
  reason: string;
  occurredAt: Date;
  notes: string | null;
}>;

/**
 * Stock adjustment. Restricted to administrators, always justified and always
 * audited: it is a correction tool, not a way to edit current stock.
 */
export async function adjustStock(
  client: DatabaseClient,
  input: AdjustmentInput,
  actorId: string,
): Promise<StockMovement> {
  const movement = await createStockMovement(
    client,
    {
      lotId: input.lotId,
      movementType: 'AJUSTEMENT',
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      quantityKg: input.quantityKg,
      referenceType: 'AJUSTEMENT',
      referenceId: null,
      reason: input.reason,
      notes: input.notes,
      occurredAt: input.occurredAt,
      reversesMovementId: null,
    },
    actorId,
  );

  await recordAudit(client, {
    userId: actorId,
    action: 'STOCK_AJUSTEMENT',
    entityType: 'stock_movements',
    entityId: movement.id,
    oldValues: null,
    newValues: {
      movementCode: movement.movementCode,
      lotId: input.lotId,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      quantityKg: input.quantityKg,
      reason: input.reason,
    },
    context: null,
  });

  return movement;
}

/**
 * Correction policy: a validated movement is never deleted or edited. It is
 * cancelled by a mirror movement referencing it, so both the mistake and its
 * correction stay visible in the lot history.
 */
export async function reverseStockMovement(
  client: DatabaseClient,
  movementId: string,
  reason: string,
  actorId: string,
): Promise<StockMovement> {
  const original = await client.query<MovementRow>(
    'SELECT * FROM stock_movements WHERE id = $1',
    [movementId],
  );
  const row = original.rows[0];
  if (!row) {
    throw notFoundError('Mouvement de stock', movementId);
  }

  const alreadyReversed = await client.query<{ id: string }>(
    'SELECT id FROM stock_movements WHERE reverses_movement_id = $1',
    [movementId],
  );
  if (alreadyReversed.rows.length > 0) {
    throw conflictError('Ce mouvement a déjà été annulé.', { movementId });
  }

  const reversal = await createStockMovement(
    client,
    {
      lotId: row.raw_material_lot_id,
      movementType: 'AJUSTEMENT',
      sourceLocationId: row.destination_location_id,
      destinationLocationId: row.source_location_id,
      quantityKg: row.quantity_kg,
      referenceType: 'ANNULATION',
      referenceId: row.id,
      reason,
      notes: `Annulation du mouvement ${row.movement_code}`,
      occurredAt: new Date(),
      reversesMovementId: row.id,
    },
    actorId,
  );

  await recordAudit(client, {
    userId: actorId,
    action: 'STOCK_ANNULATION',
    entityType: 'stock_movements',
    entityId: reversal.id,
    oldValues: { movementCode: row.movement_code, quantityKg: row.quantity_kg },
    newValues: { movementCode: reversal.movementCode, reason },
    context: { reversedMovementId: row.id },
  });

  return reversal;
}
