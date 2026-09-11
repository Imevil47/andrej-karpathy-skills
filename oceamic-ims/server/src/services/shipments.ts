import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { shipmentAcceptsEntries, type ShipmentStatus } from '../domain/types.ts';
import { conflictError, notFoundError, validationError, AppError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { createFgStockMovement, palletBalanceAt } from './fgStock.ts';
import { requirePallet } from './pallets.ts';

// Shipment: the customer logistics event (section 62), kept structurally
// separate from the reservation mechanism (stock_reservations) and from the
// physical stock ledger (finished_goods_stock_movements).

export type Shipment = Readonly<{
  id: string;
  shipmentCode: string;
  status: ShipmentStatus;
  customerId: string;
}>;

export async function requireShipment(client: DatabaseClient, id: string): Promise<Shipment> {
  const result = await client.query<{
    id: string;
    shipment_code: string;
    status: ShipmentStatus;
    customer_id: string;
  }>('SELECT id, shipment_code, status, customer_id FROM shipments WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Expédition', id);
  }
  return { id: row.id, shipmentCode: row.shipment_code, status: row.status, customerId: row.customer_id };
}

function assertAcceptsEntries(shipment: Shipment): void {
  if (!shipmentAcceptsEntries(shipment.status)) {
    throw conflictError(
      `L'expédition ${shipment.shipmentCode} n'accepte plus de modification (statut : ${shipment.status}).`,
      { shipmentId: shipment.id, status: shipment.status },
    );
  }
}

/**
 * "Expédition impossible." errors: a Quality block on the pallet or on any
 * Lot PF it carries prevents shipment (section 25's exact wording).
 */
function shipmentBlockedError(message: string, details: Readonly<Record<string, unknown>>): AppError {
  return conflictError(`Expédition impossible.\n${message}`, details);
}

export type CreateShipmentInput = Readonly<{
  customerId: string;
  plannedDate: string;
  destination: string;
  containerNumber: string | null;
  sealNumber: string | null;
  vehicleRegistration: string | null;
  targetTemperatureC: string | null;
  gensetRequired: boolean | null;
  notes: string | null;
}>;

export async function createShipment(
  pool: pg.Pool,
  input: CreateShipmentInput,
  actorId: string,
): Promise<Shipment> {
  return withTransaction(pool, async (client) => {
    const customer = await client.query('SELECT id FROM customers WHERE id = $1', [input.customerId]);
    if (customer.rows.length === 0) {
      throw notFoundError('Client', input.customerId);
    }

    const shipmentCode = await nextOperationalCode(client, 'EXP', new Date());
    const inserted = await client.query<{ id: string; status: ShipmentStatus }>(
      `INSERT INTO shipments (shipment_code, planned_date, customer_id, destination, container_number,
                              seal_number, vehicle_registration, target_temperature_c, genset_required,
                              status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PLANIFIEE', $10, $11)
       RETURNING id, status`,
      [
        shipmentCode,
        input.plannedDate,
        input.customerId,
        input.destination,
        input.containerNumber,
        input.sealNumber,
        input.vehicleRegistration,
        input.targetTemperatureC,
        input.gensetRequired,
        input.notes,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'expédition n'a pas pu être créée.");
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'SHIPMENT_CREATION',
      entityType: 'shipments',
      entityId: row.id,
      oldValues: null,
      newValues: { shipmentCode, customerId: input.customerId, destination: input.destination },
      context: null,
    });

    return { id: row.id, shipmentCode, status: row.status, customerId: input.customerId };
  });
}

export type UpdateShipmentContainerInfoInput = Readonly<{
  containerNumber: string | null;
  sealNumber: string | null;
  vehicleRegistration: string | null;
  targetTemperatureC: string | null;
  gensetRequired: boolean | null;
}>;

export async function updateShipmentContainerInfo(
  pool: pg.Pool,
  id: string,
  input: UpdateShipmentContainerInfoInput,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const shipment = await requireShipment(client, id);
    assertAcceptsEntries(shipment);

    await client.query(
      `UPDATE shipments
          SET container_number = $2, seal_number = $3, vehicle_registration = $4,
              target_temperature_c = $5, genset_required = $6, updated_at = now()
        WHERE id = $1`,
      [
        shipment.id,
        input.containerNumber,
        input.sealNumber,
        input.vehicleRegistration,
        input.targetTemperatureC,
        input.gensetRequired,
      ],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'SHIPMENT_CONTENEUR_MAJ',
      entityType: 'shipments',
      entityId: shipment.id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
  });
}

/**
 * Loads a pallet onto a shipment (section 27): opens the reservation and the
 * confirmed shipment line in the same transaction. The advisory lock plus the
 * partial unique index on stock_reservations together make double-booking
 * (section 24) and loading the same pallet twice (section 28) impossible.
 */
export async function addPalletToShipment(
  pool: pg.Pool,
  shipmentId: string,
  palletId: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const shipment = await requireShipment(client, shipmentId);
    assertAcceptsEntries(shipment);

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`pallet:${palletId}`]);

    const pallet = await requirePallet(client, palletId);

    // Checked before the status: the reservation is the direct cause of a
    // RESERVEE pallet, so it gets the specific, spec-mandated message
    // (section 28) rather than the generic "not available" one below.
    const existingReservation = await client.query(
      "SELECT id FROM stock_reservations WHERE pallet_id = $1 AND status = 'ACTIF'",
      [pallet.id],
    );
    if (existingReservation.rows.length > 0) {
      throw conflictError('Cette palette est déjà affectée à une expédition.', { palletId: pallet.id });
    }

    if (pallet.status !== 'EN_STOCK') {
      throw conflictError(
        `La palette ${pallet.palletCode} n'est pas disponible en stock (statut : ${pallet.status}).`,
        { palletId: pallet.id, status: pallet.status },
      );
    }

    const balance = await client.query<{
      location_id: string;
      quantity_cartons: string;
      quantity_units: string;
    }>('SELECT location_id, quantity_cartons, quantity_units FROM pallet_stock_balance WHERE pallet_id = $1', [
      pallet.id,
    ]);
    const balanceRow = balance.rows[0];
    if (!balanceRow || Number(balanceRow.quantity_cartons) <= 0) {
      throw conflictError('Stock disponible insuffisant.', { palletId: pallet.id });
    }

    const mono = await client.query<{ finished_good_lot_id: string }>(
      'SELECT finished_good_lot_id FROM pallet_contents WHERE pallet_id = $1',
      [pallet.id],
    );
    const finishedGoodLotId =
      mono.rows.length === 1 ? mono.rows[0]?.finished_good_lot_id ?? null : null;

    await client.query(
      `INSERT INTO shipment_lines (shipment_id, pallet_id, finished_good_lot_id, quantity_cartons,
                                   quantity_units, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [shipment.id, pallet.id, finishedGoodLotId, balanceRow.quantity_cartons, balanceRow.quantity_units, actorId],
    );

    await client.query(
      `INSERT INTO stock_reservations (shipment_id, pallet_id, finished_good_lot_id, quantity_cartons,
                                       quantity_units, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'ACTIF', $6)`,
      [shipment.id, pallet.id, finishedGoodLotId, balanceRow.quantity_cartons, balanceRow.quantity_units, actorId],
    );

    await client.query("UPDATE pallets SET status = 'RESERVEE', updated_at = now() WHERE id = $1", [
      pallet.id,
    ]);

    // First pallet loaded moves the shipment out of pure planning (section
    // 23): a shipment with at least one reserved pallet is in preparation.
    if (shipment.status === 'PLANIFIEE') {
      await client.query("UPDATE shipments SET status = 'EN_PREPARATION', updated_at = now() WHERE id = $1", [
        shipment.id,
      ]);
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'SHIPMENT_CHARGEMENT_PALETTE',
      entityType: 'shipment_lines',
      entityId: shipment.id,
      oldValues: null,
      newValues: {
        shipmentCode: shipment.shipmentCode,
        palletCode: pallet.palletCode,
        quantityCartons: balanceRow.quantity_cartons,
      },
      context: null,
    });
  });
}

export async function removePalletFromShipment(
  pool: pg.Pool,
  shipmentId: string,
  palletId: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const shipment = await requireShipment(client, shipmentId);
    assertAcceptsEntries(shipment);

    const line = await client.query(
      'DELETE FROM shipment_lines WHERE shipment_id = $1 AND pallet_id = $2 RETURNING id',
      [shipment.id, palletId],
    );
    if (line.rows.length === 0) {
      throw notFoundError('Ligne d\'expédition', palletId);
    }

    await client.query(
      "UPDATE stock_reservations SET status = 'ANNULEE', released_at = now() WHERE shipment_id = $1 AND pallet_id = $2 AND status = 'ACTIF'",
      [shipment.id, palletId],
    );

    await client.query("UPDATE pallets SET status = 'EN_STOCK', updated_at = now() WHERE id = $1", [
      palletId,
    ]);

    await recordAudit(client, {
      userId: actorId,
      action: 'SHIPMENT_RETRAIT_PALETTE',
      entityType: 'shipment_lines',
      entityId: shipment.id,
      oldValues: null,
      newValues: { shipmentCode: shipment.shipmentCode, palletId },
      context: null,
    });
  });
}

/**
 * Confirms the shipment execution as one transaction (section 30): validate
 * stock, quality release and reservation validity for every pallet, then
 * close reservations, create the outbound movements, mark every pallet
 * EXPEDIEE, and stamp shipped_at - or roll back entirely.
 */
export async function confirmShipment(
  pool: pg.Pool,
  shipmentId: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const shipment = await requireShipment(client, shipmentId);
    assertAcceptsEntries(shipment);

    const lines = await client.query<{
      pallet_id: string;
      pallet_code: string;
      quantity_cartons: string;
      quantity_units: string;
      pallet_quality_status: string;
    }>(
      `SELECT sl.pallet_id, p.pallet_code, sl.quantity_cartons, sl.quantity_units, p.quality_status AS pallet_quality_status
         FROM shipment_lines sl
         JOIN pallets p ON p.id = sl.pallet_id
        WHERE sl.shipment_id = $1
        ORDER BY p.pallet_code`,
      [shipment.id],
    );
    if (lines.rows.length === 0) {
      throw validationError("Cette expédition n'a aucune palette chargée.", { shipmentId: shipment.id });
    }

    const sourceLocationByPallet = new Map<string, string>();

    for (const line of lines.rows) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `pallet:${line.pallet_id}`,
      ]);

      const reservation = await client.query<{ id: string }>(
        "SELECT id FROM stock_reservations WHERE shipment_id = $1 AND pallet_id = $2 AND status = 'ACTIF'",
        [shipment.id, line.pallet_id],
      );
      if (reservation.rows.length === 0) {
        throw conflictError(`La palette ${line.pallet_code} n'a plus de réservation active.`, {
          shipmentId: shipment.id,
          palletId: line.pallet_id,
        });
      }

      if (line.pallet_quality_status === 'BLOQUE') {
        throw shipmentBlockedError('La palette est bloquée par le service Qualité.', {
          palletId: line.pallet_id,
        });
      }

      const lotBlock = await client.query<{ lot_code: string }>(
        `SELECT fgl.lot_code
           FROM pallet_contents pc
           JOIN finished_good_lots fgl ON fgl.id = pc.finished_good_lot_id
          WHERE pc.pallet_id = $1 AND fgl.quality_status = 'BLOQUE'
          LIMIT 1`,
        [line.pallet_id],
      );
      if (lotBlock.rows.length > 0) {
        throw shipmentBlockedError('Le lot PF est bloqué par le service Qualité.', {
          palletId: line.pallet_id,
          lotCode: lotBlock.rows[0]?.lot_code,
        });
      }

      if (line.pallet_quality_status !== 'LIBERE') {
        throw shipmentBlockedError('La palette n\'a pas été libérée par le service Qualité.', {
          palletId: line.pallet_id,
        });
      }

      const unreleasedLot = await client.query<{ lot_code: string }>(
        `SELECT fgl.lot_code
           FROM pallet_contents pc
           JOIN finished_good_lots fgl ON fgl.id = pc.finished_good_lot_id
          WHERE pc.pallet_id = $1 AND fgl.quality_status <> 'LIBERE'
          LIMIT 1`,
        [line.pallet_id],
      );
      if (unreleasedLot.rows.length > 0) {
        throw shipmentBlockedError('Le lot PF n\'a pas été libéré par le service Qualité.', {
          palletId: line.pallet_id,
          lotCode: unreleasedLot.rows[0]?.lot_code,
        });
      }

      const location = await client.query<{ location_id: string }>(
        'SELECT location_id FROM pallet_stock_balance WHERE pallet_id = $1',
        [line.pallet_id],
      );
      const sourceLocationId = location.rows[0]?.location_id;
      if (!sourceLocationId) {
        throw conflictError('Stock disponible insuffisant.', { palletId: line.pallet_id });
      }
      const balance = await palletBalanceAt(client, line.pallet_id, sourceLocationId);
      if (
        balance.quantityCartons < Number(line.quantity_cartons) ||
        balance.quantityUnits < Number(line.quantity_units)
      ) {
        throw conflictError('Stock disponible insuffisant.', { palletId: line.pallet_id });
      }
      sourceLocationByPallet.set(line.pallet_id, sourceLocationId);
    }

    for (const line of lines.rows) {
      const sourceLocationId = sourceLocationByPallet.get(line.pallet_id);
      if (!sourceLocationId) {
        throw conflictError('Stock disponible insuffisant.', { palletId: line.pallet_id });
      }

      await createFgStockMovement(
        client,
        {
          palletId: line.pallet_id,
          movementType: 'EXPEDITION',
          sourceLocationId,
          destinationLocationId: null,
          quantityCartons: Number(line.quantity_cartons),
          quantityUnits: Number(line.quantity_units),
          referenceType: 'EXPEDITION',
          referenceId: shipment.id,
          reason: null,
          notes: null,
          occurredAt: new Date(),
          reversesMovementId: null,
        },
        actorId,
      );

      await client.query(
        "UPDATE stock_reservations SET status = 'CONSOMMEE', released_at = now() WHERE shipment_id = $1 AND pallet_id = $2 AND status = 'ACTIF'",
        [shipment.id, line.pallet_id],
      );

      await client.query("UPDATE pallets SET status = 'EXPEDIEE', updated_at = now() WHERE id = $1", [
        line.pallet_id,
      ]);
    }

    await client.query(
      "UPDATE shipments SET status = 'EXPEDIEE', shipped_at = now(), updated_at = now() WHERE id = $1",
      [shipment.id],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'SHIPMENT_CONFIRMATION',
      entityType: 'shipments',
      entityId: shipment.id,
      oldValues: { status: shipment.status },
      newValues: { status: 'EXPEDIEE', palletCount: lines.rows.length },
      context: null,
    });
  });
}

export async function cancelShipment(
  pool: pg.Pool,
  id: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const shipment = await requireShipment(client, id);
    if (shipment.status === 'EXPEDIEE') {
      throw conflictError(`L'expédition ${shipment.shipmentCode} est déjà expédiée et ne peut plus être annulée.`, {
        shipmentId: shipment.id,
      });
    }
    if (shipment.status === 'ANNULEE') {
      throw conflictError(`L'expédition ${shipment.shipmentCode} est déjà annulée.`, {
        shipmentId: shipment.id,
      });
    }

    const lines = await client.query<{ pallet_id: string }>(
      'SELECT pallet_id FROM shipment_lines WHERE shipment_id = $1',
      [shipment.id],
    );
    for (const line of lines.rows) {
      await client.query(
        "UPDATE stock_reservations SET status = 'ANNULEE', released_at = now() WHERE shipment_id = $1 AND pallet_id = $2 AND status = 'ACTIF'",
        [shipment.id, line.pallet_id],
      );
      await client.query("UPDATE pallets SET status = 'EN_STOCK', updated_at = now() WHERE id = $1", [
        line.pallet_id,
      ]);
    }

    await client.query(
      "UPDATE shipments SET status = 'ANNULEE', cancellation_reason = $2, updated_at = now() WHERE id = $1",
      [shipment.id, reason],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'SHIPMENT_ANNULATION',
      entityType: 'shipments',
      entityId: shipment.id,
      oldValues: { status: shipment.status },
      newValues: { status: 'ANNULEE', reason },
      context: null,
    });
  });
}
