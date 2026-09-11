import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { createFgStockMovement } from './fgStock.ts';

// Pallet: the logistics handling unit (section 62), distinct from both the
// Finished Goods Lot identity and the stock ledger. Composition is set once
// at creation and never edited afterwards (section 11): a mistake is
// corrected by cancelling the pallet and creating a new one.

export type Pallet = Readonly<{
  id: string;
  palletCode: string;
  status: string;
  qualityStatus: string;
}>;

export async function requirePallet(client: DatabaseClient, id: string): Promise<Pallet> {
  const result = await client.query<{
    id: string;
    pallet_code: string;
    status: string;
    quality_status: string;
  }>('SELECT id, pallet_code, status, quality_status FROM pallets WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Palette', id);
  }
  return { id: row.id, palletCode: row.pallet_code, status: row.status, qualityStatus: row.quality_status };
}

export type PalletContentInput = Readonly<{
  finishedGoodLotId: string;
  quantityCartons: number;
  quantityUnits: number;
}>;

export type CreatePalletInput = Readonly<{
  destinationLocationId: string;
  occurredAt: Date;
  notes: string | null;
  contents: readonly PalletContentInput[];
}>;

/**
 * Creates a pallet with its full composition and records the corresponding
 * ENTREE_PRODUCTION stock movement in one transaction (section 15): a pallet
 * never exists without a physical position.
 */
export async function createPallet(
  pool: pg.Pool,
  input: CreatePalletInput,
  actorId: string,
): Promise<Pallet> {
  return withTransaction(pool, async (client) => {
    if (input.contents.length === 0) {
      throw validationError('Une palette doit contenir au moins un Lot PF.', {});
    }
    const seenLots = new Set<string>();
    for (const content of input.contents) {
      if (content.quantityCartons <= 0 || !Number.isInteger(content.quantityCartons)) {
        throw validationError('La quantité de cartons doit être un entier strictement positif.', {
          finishedGoodLotId: content.finishedGoodLotId,
        });
      }
      if (content.quantityUnits <= 0 || !Number.isInteger(content.quantityUnits)) {
        throw validationError("La quantité d'unités doit être un entier strictement positif.", {
          finishedGoodLotId: content.finishedGoodLotId,
        });
      }
      if (seenLots.has(content.finishedGoodLotId)) {
        throw validationError('Un Lot PF ne peut apparaître qu\'une seule fois sur une palette.', {
          finishedGoodLotId: content.finishedGoodLotId,
        });
      }
      seenLots.add(content.finishedGoodLotId);

      const lot = await client.query('SELECT id FROM finished_good_lots WHERE id = $1', [
        content.finishedGoodLotId,
      ]);
      if (lot.rows.length === 0) {
        throw notFoundError('Lot PF', content.finishedGoodLotId);
      }
    }

    const palletCode = await nextOperationalCode(client, 'PAL', input.occurredAt);
    const inserted = await client.query<{ id: string; status: string; quality_status: string }>(
      `INSERT INTO pallets (pallet_code, status, notes, created_by)
       VALUES ($1, 'EN_PREPARATION', $2, $3)
       RETURNING id, status, quality_status`,
      [palletCode, input.notes, actorId],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("La palette n'a pas pu être créée.");
    }

    let totalCartons = 0;
    let totalUnits = 0;
    for (const content of input.contents) {
      await client.query(
        `INSERT INTO pallet_contents (pallet_id, finished_good_lot_id, quantity_cartons,
                                      quantity_units, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.id, content.finishedGoodLotId, content.quantityCartons, content.quantityUnits, actorId],
      );
      totalCartons += content.quantityCartons;
      totalUnits += content.quantityUnits;
    }

    await createFgStockMovement(
      client,
      {
        palletId: row.id,
        movementType: 'ENTREE_PRODUCTION',
        sourceLocationId: null,
        destinationLocationId: input.destinationLocationId,
        quantityCartons: totalCartons,
        quantityUnits: totalUnits,
        referenceType: 'PACKAGING',
        referenceId: null,
        reason: null,
        notes: input.notes,
        occurredAt: input.occurredAt,
        reversesMovementId: null,
      },
      actorId,
    );

    await client.query(
      "UPDATE pallets SET status = 'EN_STOCK', updated_at = now() WHERE id = $1",
      [row.id],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'PALLET_CREATION',
      entityType: 'pallets',
      entityId: row.id,
      oldValues: null,
      newValues: {
        palletCode,
        destinationLocationId: input.destinationLocationId,
        totalCartons,
        totalUnits,
        lotCount: input.contents.length,
      },
      context: null,
    });

    return { id: row.id, palletCode, status: 'EN_STOCK', qualityStatus: row.quality_status };
  });
}

export async function cancelPallet(
  pool: pg.Pool,
  id: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const pallet = await requirePallet(client, id);
    if (pallet.status === 'EXPEDIEE' || pallet.status === 'ANNULEE') {
      throw conflictError(`La palette ${pallet.palletCode} ne peut plus être annulée (statut : ${pallet.status}).`, {
        palletId: pallet.id,
        status: pallet.status,
      });
    }
    const reservation = await client.query(
      "SELECT id FROM stock_reservations WHERE pallet_id = $1 AND status = 'ACTIF'",
      [pallet.id],
    );
    if (reservation.rows.length > 0) {
      throw conflictError(`La palette ${pallet.palletCode} est réservée pour une expédition et ne peut pas être annulée.`, {
        palletId: pallet.id,
      });
    }

    const balance = await client.query<{
      location_id: string;
      quantity_cartons: string;
      quantity_units: string;
    }>('SELECT location_id, quantity_cartons, quantity_units FROM pallet_stock_balance WHERE pallet_id = $1', [
      pallet.id,
    ]);
    const balanceRow = balance.rows[0];
    if (balanceRow) {
      await createFgStockMovement(
        client,
        {
          palletId: pallet.id,
          movementType: 'AJUSTEMENT',
          sourceLocationId: balanceRow.location_id,
          destinationLocationId: null,
          quantityCartons: Number(balanceRow.quantity_cartons),
          quantityUnits: Number(balanceRow.quantity_units),
          referenceType: 'ANNULATION',
          referenceId: null,
          reason: `Annulation de la palette : ${reason}`,
          notes: null,
          occurredAt: new Date(),
          reversesMovementId: null,
        },
        actorId,
      );
    }

    await client.query(
      "UPDATE pallets SET status = 'ANNULEE', notes = COALESCE(notes || ' — ', '') || $2, updated_at = now() WHERE id = $1",
      [pallet.id, `Annulée : ${reason}`],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'PALLET_ANNULATION',
      entityType: 'pallets',
      entityId: pallet.id,
      oldValues: { status: pallet.status },
      newValues: { status: 'ANNULEE', reason },
      context: null,
    });
  });
}
