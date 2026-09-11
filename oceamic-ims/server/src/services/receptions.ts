import type pg from 'pg';
import { withTransaction } from '../db/pool.ts';
import type { QuantityKg } from '../domain/quantity.ts';
import type { InspectionResult, ReceptionType } from '../domain/types.ts';
import { validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { createLot, refreshLotStatus, requireLot } from './lots.ts';
import { createInspection } from './quality.ts';
import { createStockMovement } from './stock.ts';

export type ReceptionLotInput =
  | Readonly<{
      mode: 'NOUVEAU';
      lotCode: string | null;
      speciesId: string;
      origin: string | null;
      captureDate: string | null;
      notes: string | null;
    }>
  | Readonly<{ mode: 'EXISTANT'; lotId: string }>;

export type QuickInspectionInput = Readonly<{
  temperatureC: string | null;
  qualityGrade: string | null;
  sizeGrade: string | null;
  result: InspectionResult;
  notes: string | null;
}>;

export type ReceptionInput = Readonly<{
  receivedAt: Date;
  lot: ReceptionLotInput;
  supplierId: string | null;
  vesselId: string | null;
  tideNumber: string | null;
  truckRegistration: string | null;
  quantityKg: QuantityKg;
  destinationLocationId: string;
  receptionType: ReceptionType;
  externalSourceLocationId: string | null;
  documentReference: string | null;
  notes: string | null;
  quickInspection: QuickInspectionInput | null;
}>;

export type ReceptionResult = Readonly<{
  receptionId: string;
  receptionCode: string;
  lotId: string;
  lotCode: string;
  movementCode: string;
}>;

/**
 * Single reception workflow: the operator fills one screen and the system
 * creates (or reuses) the lot, the reception event, the inbound stock movement
 * and the optional quality control inside ONE transaction. Any failure rolls
 * everything back, so no orphan lot or reception can survive.
 */
export async function registerReception(
  pool: pg.Pool,
  input: ReceptionInput,
  actorId: string,
): Promise<ReceptionResult> {
  return withTransaction(pool, async (client) => {
    const lot =
      input.lot.mode === 'NOUVEAU'
        ? await createLot(
            client,
            {
              lotCode: input.lot.lotCode,
              speciesId: input.lot.speciesId,
              // Traceability entered once on the reception screen is reused as
              // the identity of the new lot: the operator never types it twice.
              supplierId: input.supplierId,
              vesselId: input.vesselId,
              origin: input.lot.origin,
              tideNumber: input.tideNumber,
              captureDate: input.lot.captureDate,
              initialReceptionDate: input.receivedAt.toISOString().slice(0, 10),
              parentLotId: null,
              notes: input.lot.notes,
            },
            actorId,
          )
        : await requireLot(client, input.lot.lotId);

    const receptionCode = await nextOperationalCode(client, 'REC', input.receivedAt);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO raw_material_receptions (reception_code, received_at, raw_material_lot_id,
                                            supplier_id, vessel_id, tide_number, truck_registration,
                                            quantity_kg, destination_location_id, reception_type,
                                            external_source_location_id, document_reference,
                                            notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        receptionCode,
        input.receivedAt,
        lot.id,
        input.supplierId,
        input.vesselId,
        input.tideNumber,
        input.truckRegistration,
        input.quantityKg,
        input.destinationLocationId,
        input.receptionType,
        input.externalSourceLocationId,
        input.documentReference,
        input.notes,
        actorId,
      ],
    );
    const receptionId = inserted.rows[0]?.id;
    if (!receptionId) {
      throw new Error("La réception n'a pas pu être créée.");
    }

    const movement = await createStockMovement(
      client,
      {
        lotId: lot.id,
        movementType: 'RECEPTION',
        sourceLocationId: null,
        destinationLocationId: input.destinationLocationId,
        quantityKg: input.quantityKg,
        referenceType: 'RECEPTION',
        referenceId: receptionId,
        reason: null,
        notes: null,
        occurredAt: input.receivedAt,
        reversesMovementId: null,
      },
      actorId,
    );

    if (input.quickInspection) {
      await createInspection(
        client,
        {
          rawMaterialLotId: lot.id,
          inspectedAt: input.receivedAt,
          inspectionType: 'RECEPTION',
          processStage: 'RECEPTION',
          locationId: input.destinationLocationId,
          temperatureC: input.quickInspection.temperatureC,
          histaminePpm: null,
          abvt: null,
          qualityGrade: input.quickInspection.qualityGrade,
          sizeGrade: input.quickInspection.sizeGrade,
          result: input.quickInspection.result,
          notes: input.quickInspection.notes,
        },
        actorId,
      );
    }

    await refreshLotStatus(client, lot.id);

    await recordAudit(client, {
      userId: actorId,
      action: 'RECEPTION_CREATION',
      entityType: 'raw_material_receptions',
      entityId: receptionId,
      oldValues: null,
      newValues: {
        receptionCode,
        lotCode: lot.lotCode,
        quantityKg: input.quantityKg,
        destinationLocationId: input.destinationLocationId,
        receptionType: input.receptionType,
      },
      context: { movementCode: movement.movementCode },
    });

    return {
      receptionId,
      receptionCode,
      lotId: lot.id,
      lotCode: lot.lotCode,
      movementCode: movement.movementCode,
    };
  });
}

export type ReceptionListFilters = Readonly<{
  search: string | null;
  fromDate: string | null;
  toDate: string | null;
  limit: number;
}>;

export type ReceptionRow = Readonly<{
  id: string;
  receptionCode: string;
  receivedAt: Date;
  quantityKg: string;
  receptionType: ReceptionType;
  truckRegistration: string | null;
  tideNumber: string | null;
  documentReference: string | null;
  lotId: string;
  lotCode: string;
  speciesCode: string;
  supplierName: string | null;
  vesselName: string | null;
  destinationLocationCode: string;
  destinationStockType: string;
  createdByName: string;
}>;

export async function listReceptions(
  pool: pg.Pool,
  filters: ReceptionListFilters,
): Promise<readonly ReceptionRow[]> {
  if (filters.limit <= 0 || filters.limit > 500) {
    throw validationError('La limite doit être comprise entre 1 et 500.', { limit: filters.limit });
  }
  const result = await pool.query<ReceptionRow>(
    `SELECT r.id                  AS "id",
            r.reception_code      AS "receptionCode",
            r.received_at         AS "receivedAt",
            r.quantity_kg         AS "quantityKg",
            r.reception_type      AS "receptionType",
            r.truck_registration  AS "truckRegistration",
            r.tide_number         AS "tideNumber",
            r.document_reference  AS "documentReference",
            lot.id                AS "lotId",
            lot.lot_code          AS "lotCode",
            sp.code               AS "speciesCode",
            sup.name              AS "supplierName",
            v.name                AS "vesselName",
            loc.code              AS "destinationLocationCode",
            loc.stock_type        AS "destinationStockType",
            u.full_name           AS "createdByName"
       FROM raw_material_receptions r
       JOIN raw_material_lots lot ON lot.id = r.raw_material_lot_id
       JOIN species sp ON sp.id = lot.species_id
       JOIN locations loc ON loc.id = r.destination_location_id
       JOIN users u ON u.id = r.created_by
       LEFT JOIN suppliers sup ON sup.id = r.supplier_id
       LEFT JOIN vessels v ON v.id = r.vessel_id
      WHERE ($1::text IS NULL
             OR lot.lot_code ILIKE '%' || $1 || '%'
             OR r.reception_code ILIKE '%' || $1 || '%'
             OR r.truck_registration ILIKE '%' || $1 || '%')
        AND ($2::date IS NULL OR r.received_at >= $2::date)
        AND ($3::date IS NULL OR r.received_at < ($3::date + INTERVAL '1 day'))
      ORDER BY r.received_at DESC
      LIMIT $4`,
    [filters.search, filters.fromDate, filters.toDate, filters.limit],
  );
  return result.rows;
}

export async function countReceptionsToday(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM raw_material_receptions
      WHERE received_at >= date_trunc('day', now())`,
  );
  return Number(result.rows[0]?.count ?? '0');
}
