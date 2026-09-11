import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { FgMovementType, FgReferenceType } from '../domain/types.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';

// Finished Goods stock ledger (section 15): a new registry, tracked at
// PALLET granularity exclusively - never by Lot PF (finished_good_lot_stock_summary
// always derives a Lot PF's position through pallet_contents). A pallet is
// never split across two locations: every movement always carries its full
// current quantity, so "available stock at the source" is simply "is the
// pallet currently there".

export type FgStockMovement = Readonly<{
  id: string;
  movementCode: string;
  palletId: string;
  movementType: FgMovementType;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantityCartons: number;
  quantityUnits: number;
}>;

type MovementRow = {
  id: string;
  movement_code: string;
  pallet_id: string;
  movement_type: FgMovementType;
  source_location_id: string | null;
  destination_location_id: string | null;
  quantity_cartons: string;
  quantity_units: string;
};

function toMovement(row: MovementRow): FgStockMovement {
  return {
    id: row.id,
    movementCode: row.movement_code,
    palletId: row.pallet_id,
    movementType: row.movement_type,
    sourceLocationId: row.source_location_id,
    destinationLocationId: row.destination_location_id,
    quantityCartons: Number(row.quantity_cartons),
    quantityUnits: Number(row.quantity_units),
  };
}

/**
 * Serialises every concurrent movement of a given pallet: a stock check and
 * the movement it authorises can never be interleaved with another one.
 */
async function lockPallet(client: DatabaseClient, palletId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `pallet:${palletId}`,
  ]);
}

async function assertDestinationCanReceiveFg(
  client: DatabaseClient,
  locationId: string,
): Promise<void> {
  const result = await client.query<{
    code: string;
    can_receive: boolean;
    is_active: boolean;
    stock_domain: string;
  }>('SELECT code, can_receive, is_active, stock_domain FROM locations WHERE id = $1', [
    locationId,
  ]);
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
  if (location.stock_domain !== 'PF' && location.stock_domain !== 'MIXTE') {
    throw validationError(
      `L'emplacement ${location.code} n'est pas configuré pour le stock Produits Finis.`,
      { locationId },
    );
  }
}

export async function palletBalanceAt(
  client: DatabaseClient,
  palletId: string,
  locationId: string,
): Promise<Readonly<{ quantityCartons: number; quantityUnits: number }>> {
  const result = await client.query<{ quantity_cartons: string; quantity_units: string }>(
    `SELECT COALESCE(quantity_cartons, 0)::bigint AS quantity_cartons,
            COALESCE(quantity_units, 0)::bigint   AS quantity_units
       FROM pallet_stock_balance
      WHERE pallet_id = $1 AND location_id = $2`,
    [palletId, locationId],
  );
  const row = result.rows[0];
  return {
    quantityCartons: row ? Number(row.quantity_cartons) : 0,
    quantityUnits: row ? Number(row.quantity_units) : 0,
  };
}

export type FgStockMovementInput = Readonly<{
  palletId: string;
  movementType: FgMovementType;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantityCartons: number;
  quantityUnits: number;
  referenceType: FgReferenceType;
  referenceId: string | null;
  reason: string | null;
  notes: string | null;
  occurredAt: Date;
  reversesMovementId: string | null;
}>;

/**
 * Single entry point of the Finished Goods ledger. A movement carrying a
 * source location must move exactly the pallet's current full balance there
 * (section 12: a pallet is never split), so the check is "is the pallet
 * currently at this location with this quantity", not a partial-availability
 * check.
 */
export async function createFgStockMovement(
  client: DatabaseClient,
  input: FgStockMovementInput,
  actorId: string,
): Promise<FgStockMovement> {
  if (!Number.isInteger(input.quantityCartons) || input.quantityCartons <= 0) {
    throw validationError('La quantité de cartons doit être un entier strictement positif.', {
      quantityCartons: input.quantityCartons,
    });
  }
  if (!Number.isInteger(input.quantityUnits) || input.quantityUnits <= 0) {
    throw validationError('La quantité d\'unités doit être un entier strictement positif.', {
      quantityUnits: input.quantityUnits,
    });
  }
  if (input.sourceLocationId === null && input.destinationLocationId === null) {
    throw validationError(
      'Un mouvement doit avoir un emplacement source ou un emplacement de destination.',
      { movementType: input.movementType },
    );
  }
  if (input.sourceLocationId !== null && input.sourceLocationId === input.destinationLocationId) {
    throw validationError(
      "L'emplacement source et l'emplacement de destination doivent être différents.",
      { locationId: input.sourceLocationId },
    );
  }

  await lockPallet(client, input.palletId);

  if (input.destinationLocationId !== null) {
    await assertDestinationCanReceiveFg(client, input.destinationLocationId);
  }

  if (input.sourceLocationId !== null) {
    const balance = await palletBalanceAt(client, input.palletId, input.sourceLocationId);
    if (
      balance.quantityCartons !== input.quantityCartons ||
      balance.quantityUnits !== input.quantityUnits
    ) {
      throw conflictError(
        "La palette n'est pas présente à cet emplacement pour la quantité indiquée.",
        {
          palletId: input.palletId,
          locationId: input.sourceLocationId,
          available: balance,
          requested: { quantityCartons: input.quantityCartons, quantityUnits: input.quantityUnits },
        },
      );
    }
  }

  const movementCode = await nextOperationalCode(client, 'MVP', input.occurredAt);
  const inserted = await client.query<MovementRow>(
    `INSERT INTO finished_goods_stock_movements (movement_code, occurred_at, pallet_id, movement_type,
                                                  source_location_id, destination_location_id,
                                                  quantity_cartons, quantity_units,
                                                  reference_type, reference_id, reason, notes,
                                                  reverses_movement_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id, movement_code, pallet_id, movement_type, source_location_id,
               destination_location_id, quantity_cartons, quantity_units`,
    [
      movementCode,
      input.occurredAt,
      input.palletId,
      input.movementType,
      input.sourceLocationId,
      input.destinationLocationId,
      input.quantityCartons,
      input.quantityUnits,
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
    throw new Error("Le mouvement de stock PF n'a pas pu être créé.");
  }
  return toMovement(row);
}

export type TransferPalletInput = Readonly<{
  palletId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  occurredAt: Date;
  notes: string | null;
}>;

export async function transferPallet(
  pool: pg.Pool,
  input: TransferPalletInput,
  actorId: string,
): Promise<FgStockMovement> {
  return withTransaction(pool, async (client) => {
    const balance = await palletBalanceAt(client, input.palletId, input.sourceLocationId);
    const movement = await createFgStockMovement(
      client,
      {
        palletId: input.palletId,
        movementType: 'TRANSFERT',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        quantityCartons: balance.quantityCartons,
        quantityUnits: balance.quantityUnits,
        referenceType: 'TRANSFERT',
        referenceId: null,
        reason: null,
        notes: input.notes,
        occurredAt: input.occurredAt,
        reversesMovementId: null,
      },
      actorId,
    );

    await client.query("UPDATE pallets SET status = 'EN_STOCK', updated_at = now() WHERE id = $1", [
      input.palletId,
    ]);

    await recordAudit(client, {
      userId: actorId,
      action: 'FG_STOCK_TRANSFERT',
      entityType: 'finished_goods_stock_movements',
      entityId: movement.id,
      oldValues: null,
      newValues: {
        movementCode: movement.movementCode,
        palletId: input.palletId,
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
      },
      context: null,
    });

    return movement;
  });
}

export type AdjustPalletStockInput = Readonly<{
  palletId: string;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantityCartons: number;
  quantityUnits: number;
  reason: string;
  occurredAt: Date;
  notes: string | null;
}>;

/**
 * Stock adjustment: a correction tool, always justified and always audited,
 * never a way to silently rewrite the current position.
 */
export async function adjustPalletStock(
  pool: pg.Pool,
  input: AdjustPalletStockInput,
  actorId: string,
): Promise<FgStockMovement> {
  return withTransaction(pool, async (client) => {
    const movement = await createFgStockMovement(
      client,
      {
        palletId: input.palletId,
        movementType: 'AJUSTEMENT',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        quantityCartons: input.quantityCartons,
        quantityUnits: input.quantityUnits,
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
      action: 'FG_STOCK_AJUSTEMENT',
      entityType: 'finished_goods_stock_movements',
      entityId: movement.id,
      oldValues: null,
      newValues: {
        movementCode: movement.movementCode,
        palletId: input.palletId,
        reason: input.reason,
      },
      context: null,
    });

    return movement;
  });
}

export type BlockPalletLogisticsInput = Readonly<{
  palletId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  reason: string;
  occurredAt: Date;
  notes: string | null;
}>;

/**
 * Physical relocation to a logistics-hold area (section 16): distinct from a
 * Quality block (finished_goods_quality_blocks), which never moves a pallet
 * on its own.
 */
export async function blockPalletLogistics(
  pool: pg.Pool,
  input: BlockPalletLogisticsInput,
  actorId: string,
): Promise<FgStockMovement> {
  return withTransaction(pool, async (client) => {
    const balance = await palletBalanceAt(client, input.palletId, input.sourceLocationId);
    const movement = await createFgStockMovement(
      client,
      {
        palletId: input.palletId,
        movementType: 'BLOCAGE_LOGISTIQUE',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        quantityCartons: balance.quantityCartons,
        quantityUnits: balance.quantityUnits,
        referenceType: 'BLOCAGE_LOGISTIQUE',
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
      action: 'FG_STOCK_BLOCAGE_LOGISTIQUE',
      entityType: 'finished_goods_stock_movements',
      entityId: movement.id,
      oldValues: null,
      newValues: { movementCode: movement.movementCode, palletId: input.palletId, reason: input.reason },
      context: null,
    });

    return movement;
  });
}

export type ReturnPalletInput = Readonly<{
  palletId: string;
  destinationLocationId: string;
  quantityCartons: number;
  quantityUnits: number;
  reason: string;
  occurredAt: Date;
  notes: string | null;
}>;

export async function returnPallet(
  pool: pg.Pool,
  input: ReturnPalletInput,
  actorId: string,
): Promise<FgStockMovement> {
  return withTransaction(pool, async (client) => {
    const movement = await createFgStockMovement(
      client,
      {
        palletId: input.palletId,
        movementType: 'RETOUR',
        sourceLocationId: null,
        destinationLocationId: input.destinationLocationId,
        quantityCartons: input.quantityCartons,
        quantityUnits: input.quantityUnits,
        referenceType: 'RETOUR',
        referenceId: null,
        reason: input.reason,
        notes: input.notes,
        occurredAt: input.occurredAt,
        reversesMovementId: null,
      },
      actorId,
    );

    await client.query("UPDATE pallets SET status = 'EN_STOCK', updated_at = now() WHERE id = $1", [
      input.palletId,
    ]);

    await recordAudit(client, {
      userId: actorId,
      action: 'FG_STOCK_RETOUR',
      entityType: 'finished_goods_stock_movements',
      entityId: movement.id,
      oldValues: null,
      newValues: { movementCode: movement.movementCode, palletId: input.palletId, reason: input.reason },
      context: null,
    });

    return movement;
  });
}
