import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { subtract, type QuantityKg } from '../domain/quantity.ts';
import type {
  SubcontractingResultType,
  SubcontractingSourceType,
  SubcontractingStatus,
} from '../domain/types.ts';
import { blockedLotError, conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { createLot, refreshLotStatus, requireLot } from './lots.ts';
import { activeBlockOf, createStockMovement } from './stock.ts';

type SubcontractorRow = { id: string; code: string; name: string; location_id: string };

async function requireSubcontractor(
  client: DatabaseClient,
  subcontractorId: string,
): Promise<SubcontractorRow> {
  const result = await client.query<SubcontractorRow>(
    'SELECT id, code, name, location_id FROM subcontractors WHERE id = $1 AND is_active = TRUE',
    [subcontractorId],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Sous-traitant', subcontractorId);
  }
  return row;
}

export type SubcontractingInput = Readonly<{
  sentAt: Date;
  subcontractorId: string;
  sourceType: SubcontractingSourceType;
  sourceLotId: string | null;
  sourceLocationId: string | null;
  supplierId: string | null;
  speciesId: string | null;
  newLotCode: string | null;
  quantitySentKg: QuantityKg;
  incomingQuality: string | null;
  incomingSizeGrade: string | null;
  notes: string | null;
}>;

export type SubcontractingOperation = Readonly<{
  id: string;
  operationCode: string;
  lotId: string;
  lotCode: string;
}>;

/**
 * Sends material to a subcontractor.
 *
 * STOCK_EXISTANT: the quantity leaves the real OCEAMIC location and arrives at
 * the subcontractor location. Nothing disappears, the material changed place.
 *
 * FOURNISSEUR: the material goes straight from the supplier to the
 * subcontractor. No OCEAMIC location is reduced; the material enters the
 * inventory as external stock held at the subcontractor.
 */
export async function sendToSubcontractor(
  pool: pg.Pool,
  input: SubcontractingInput,
  actorId: string,
): Promise<SubcontractingOperation> {
  return withTransaction(pool, async (client) => {
    const subcontractor = await requireSubcontractor(client, input.subcontractorId);
    const operationCode = await nextOperationalCode(client, 'ST', input.sentAt);

    const lot =
      input.sourceType === 'STOCK_EXISTANT'
        ? await resolveExistingStockSource(client, input)
        : await createSupplierDirectLot(client, input, actorId);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO subcontracting_operations (operation_code, sent_at, subcontractor_id, source_type,
                                              source_lot_id, source_location_id, supplier_id,
                                              quantity_sent_kg, incoming_quality,
                                              incoming_size_grade, status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'EN_COURS', $11, $12)
       RETURNING id`,
      [
        operationCode,
        input.sentAt,
        subcontractor.id,
        input.sourceType,
        lot.id,
        input.sourceType === 'STOCK_EXISTANT' ? input.sourceLocationId : null,
        input.supplierId,
        input.quantitySentKg,
        input.incomingQuality,
        input.incomingSizeGrade,
        input.notes,
        actorId,
      ],
    );
    const operationId = inserted.rows[0]?.id;
    if (!operationId) {
      throw new Error("L'opération de sous-traitance n'a pas pu être créée.");
    }

    if (input.sourceType === 'STOCK_EXISTANT') {
      await createStockMovement(
        client,
        {
          lotId: lot.id,
          movementType: 'SOUS_TRAITANCE',
          sourceLocationId: input.sourceLocationId,
          destinationLocationId: subcontractor.location_id,
          quantityKg: input.quantitySentKg,
          referenceType: 'SOUS_TRAITANCE',
          referenceId: operationId,
          reason: null,
          notes: input.notes,
          occurredAt: input.sentAt,
          reversesMovementId: null,
        },
        actorId,
      );
    } else {
      // Supplier -> subcontractor: the material enters OCEAMIC inventory
      // directly at the external subcontractor location.
      await createStockMovement(
        client,
        {
          lotId: lot.id,
          movementType: 'RECEPTION',
          sourceLocationId: null,
          destinationLocationId: subcontractor.location_id,
          quantityKg: input.quantitySentKg,
          referenceType: 'SOUS_TRAITANCE',
          referenceId: operationId,
          reason: null,
          notes: input.notes,
          occurredAt: input.sentAt,
          reversesMovementId: null,
        },
        actorId,
      );
    }

    await refreshLotStatus(client, lot.id);

    await recordAudit(client, {
      userId: actorId,
      action: 'SOUS_TRAITANCE_ENVOI',
      entityType: 'subcontracting_operations',
      entityId: operationId,
      oldValues: null,
      newValues: {
        operationCode,
        sourceType: input.sourceType,
        lotCode: lot.lotCode,
        subcontractorCode: subcontractor.code,
        quantitySentKg: input.quantitySentKg,
        sourceLocationId: input.sourceLocationId,
      },
      context: null,
    });

    return { id: operationId, operationCode, lotId: lot.id, lotCode: lot.lotCode };
  });
}

async function resolveExistingStockSource(client: DatabaseClient, input: SubcontractingInput) {
  if (!input.sourceLotId || !input.sourceLocationId) {
    throw validationError(
      "Le lot source et l'emplacement source sont obligatoires pour une sous-traitance sur stock existant.",
      { sourceType: input.sourceType },
    );
  }
  const lot = await requireLot(client, input.sourceLotId);
  const block = await activeBlockOf(client, lot.id);
  if (block) {
    throw blockedLotError(block.lotCode, block.reason);
  }
  return lot;
}

async function createSupplierDirectLot(
  client: DatabaseClient,
  input: SubcontractingInput,
  actorId: string,
) {
  if (input.sourceLotId) {
    return requireLot(client, input.sourceLotId);
  }
  if (!input.speciesId) {
    throw validationError(
      "L'espèce est obligatoire pour créer le lot d'une sous-traitance directe fournisseur.",
      { sourceType: input.sourceType },
    );
  }
  return createLot(
    client,
    {
      lotCode: input.newLotCode,
      speciesId: input.speciesId,
      supplierId: input.supplierId,
      vesselId: null,
      origin: null,
      tideNumber: null,
      captureDate: null,
      initialReceptionDate: input.sentAt.toISOString().slice(0, 10),
      parentLotId: null,
      notes: input.notes,
    },
    actorId,
  );
}

export type SubcontractingResultInput = Readonly<{
  resultType: SubcontractingResultType;
  resultLotMode: 'MEME_LOT' | 'NOUVEAU_LOT';
  newLotCode: string | null;
  quantityKg: QuantityKg;
  outgoingQuality: string | null;
  outgoingSizeGrade: string | null;
  destinationLocationId: string | null;
  qualityStatus: string | null;
}>;

/**
 * Registers one output of a subcontracting operation. One operation may produce
 * several outputs (qualities, size grades, destinations) plus losses; each one
 * moves its own quantity out of the subcontractor location.
 */
export async function addSubcontractingResult(
  pool: pg.Pool,
  operationId: string,
  input: SubcontractingResultInput,
  actorId: string,
): Promise<{ resultId: string; differenceKg: QuantityKg }> {
  return withTransaction(pool, async (client) => {
    const operation = await client.query<{
      id: string;
      operation_code: string;
      status: string;
      source_lot_id: string | null;
      quantity_sent_kg: string;
      subcontractor_location_id: string;
      species_id: string;
      supplier_id: string | null;
    }>(
      `SELECT o.id, o.operation_code, o.status, o.source_lot_id, o.quantity_sent_kg,
              s.location_id AS subcontractor_location_id,
              lot.species_id, o.supplier_id
         FROM subcontracting_operations o
         JOIN subcontractors s ON s.id = o.subcontractor_id
         JOIN raw_material_lots lot ON lot.id = o.source_lot_id
        WHERE o.id = $1`,
      [operationId],
    );
    const row = operation.rows[0];
    if (!row) {
      throw notFoundError('Opération de sous-traitance', operationId);
    }
    if (row.status !== 'EN_COURS') {
      throw conflictError("Cette opération de sous-traitance n'est plus en cours.", {
        operationId,
        status: row.status,
      });
    }
    if (!row.source_lot_id) {
      throw validationError("L'opération de sous-traitance n'a pas de lot source.", { operationId });
    }

    const resultLotId =
      input.resultType === 'PERTE' || input.resultLotMode === 'MEME_LOT'
        ? row.source_lot_id
        : (
            await createLot(
              client,
              {
                lotCode: input.newLotCode,
                speciesId: row.species_id,
                supplierId: row.supplier_id,
                vesselId: null,
                origin: null,
                tideNumber: null,
                captureDate: null,
                initialReceptionDate: new Date().toISOString().slice(0, 10),
                parentLotId: row.source_lot_id,
                notes: null,
              },
              actorId,
            )
          ).id;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO subcontracting_results (subcontracting_operation_id, result_type, result_lot_id,
                                           quantity_kg, outgoing_quality, outgoing_size_grade,
                                           destination_location_id, quality_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        operationId,
        input.resultType,
        input.resultType === 'PERTE' ? null : resultLotId,
        input.quantityKg,
        input.outgoingQuality,
        input.outgoingSizeGrade,
        input.destinationLocationId,
        input.qualityStatus,
        actorId,
      ],
    );
    const resultId = inserted.rows[0]?.id;
    if (!resultId) {
      throw new Error("Le résultat de sous-traitance n'a pas pu être enregistré.");
    }

    const occurredAt = new Date();
    if (input.resultType === 'PERTE') {
      await createStockMovement(
        client,
        {
          lotId: row.source_lot_id,
          movementType: 'PERTE',
          sourceLocationId: row.subcontractor_location_id,
          destinationLocationId: null,
          quantityKg: input.quantityKg,
          referenceType: 'SOUS_TRAITANCE_RESULTAT',
          referenceId: resultId,
          reason: `Perte sous-traitance ${row.operation_code}`,
          notes: null,
          occurredAt,
          reversesMovementId: null,
        },
        actorId,
      );
    } else if (resultLotId === row.source_lot_id) {
      await createStockMovement(
        client,
        {
          lotId: row.source_lot_id,
          movementType: 'RETOUR',
          sourceLocationId: row.subcontractor_location_id,
          destinationLocationId: input.destinationLocationId,
          quantityKg: input.quantityKg,
          referenceType: 'SOUS_TRAITANCE_RESULTAT',
          referenceId: resultId,
          reason: null,
          notes: null,
          occurredAt,
          reversesMovementId: null,
        },
        actorId,
      );
    } else {
      // A new output lot: the quantity leaves the source lot at the
      // subcontractor and enters the new lot at its destination.
      await createStockMovement(
        client,
        {
          lotId: row.source_lot_id,
          movementType: 'FRACTIONNEMENT',
          sourceLocationId: row.subcontractor_location_id,
          destinationLocationId: null,
          quantityKg: input.quantityKg,
          referenceType: 'SOUS_TRAITANCE_RESULTAT',
          referenceId: resultId,
          reason: `Sortie vers lot résultat (${row.operation_code})`,
          notes: null,
          occurredAt,
          reversesMovementId: null,
        },
        actorId,
      );
      await createStockMovement(
        client,
        {
          lotId: resultLotId,
          movementType: 'FRACTIONNEMENT',
          sourceLocationId: null,
          destinationLocationId: input.destinationLocationId,
          quantityKg: input.quantityKg,
          referenceType: 'SOUS_TRAITANCE_RESULTAT',
          referenceId: resultId,
          reason: `Résultat sous-traitance ${row.operation_code}`,
          notes: null,
          occurredAt,
          reversesMovementId: null,
        },
        actorId,
      );
      await refreshLotStatus(client, resultLotId);
    }

    await refreshLotStatus(client, row.source_lot_id);

    const balance = await client.query<{ difference_kg: string }>(
      'SELECT difference_kg FROM subcontracting_material_balance WHERE subcontracting_operation_id = $1',
      [operationId],
    );
    const differenceKg = balance.rows[0]?.difference_kg ?? subtract(row.quantity_sent_kg, '0');

    await recordAudit(client, {
      userId: actorId,
      action: 'SOUS_TRAITANCE_RESULTAT',
      entityType: 'subcontracting_results',
      entityId: resultId,
      oldValues: null,
      newValues: {
        operationCode: row.operation_code,
        resultType: input.resultType,
        quantityKg: input.quantityKg,
        destinationLocationId: input.destinationLocationId,
      },
      context: { differenceKg },
    });

    return { resultId, differenceKg };
  });
}

export async function closeSubcontractingOperation(
  pool: pg.Pool,
  operationId: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const updated = await client.query<{ operation_code: string }>(
      `UPDATE subcontracting_operations
          SET status = 'CLOTURE'
        WHERE id = $1 AND status = 'EN_COURS'
        RETURNING operation_code`,
      [operationId],
    );
    const row = updated.rows[0];
    if (!row) {
      throw conflictError("Cette opération de sous-traitance n'est plus en cours.", { operationId });
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'SOUS_TRAITANCE_CLOTURE',
      entityType: 'subcontracting_operations',
      entityId: operationId,
      oldValues: { status: 'EN_COURS' },
      newValues: { status: 'CLOTURE' },
      context: { operationCode: row.operation_code },
    });
  });
}

// Shared projection of a subcontracting operation and its material balance.
const SUBCONTRACTING_OPERATION_QUERY = `SELECT o.id                  AS "id",
            o.operation_code      AS "operationCode",
            o.sent_at             AS "sentAt",
            o.source_type         AS "sourceType",
            o.quantity_sent_kg    AS "quantitySentKg",
            o.incoming_quality    AS "incomingQuality",
            o.incoming_size_grade AS "incomingSizeGrade",
            o.status              AS "status",
            o.notes               AS "notes",
            sc.code               AS "subcontractorCode",
            sc.name               AS "subcontractorName",
            lot.id                AS "lotId",
            lot.lot_code          AS "lotCode",
            src.code              AS "sourceLocationCode",
            bal.results_kg        AS "resultsKg",
            bal.difference_kg     AS "differenceKg"
       FROM subcontracting_operations o
       JOIN subcontractors sc ON sc.id = o.subcontractor_id
       JOIN subcontracting_material_balance bal ON bal.subcontracting_operation_id = o.id
       LEFT JOIN raw_material_lots lot ON lot.id = o.source_lot_id
       LEFT JOIN locations src ON src.id = o.source_location_id`;

export type SubcontractingOperationRow = Readonly<{
  id: string;
  operationCode: string;
  sentAt: Date;
  sourceType: SubcontractingSourceType;
  quantitySentKg: string;
  incomingQuality: string | null;
  incomingSizeGrade: string | null;
  status: SubcontractingStatus;
  notes: string | null;
  subcontractorCode: string;
  subcontractorName: string;
  lotId: string | null;
  lotCode: string | null;
  sourceLocationCode: string | null;
  resultsKg: string;
  differenceKg: string;
}>;

export type SubcontractingResultRow = Readonly<{
  id: string;
  resultType: SubcontractingResultType;
  quantityKg: string;
  outgoingQuality: string | null;
  outgoingSizeGrade: string | null;
  qualityStatus: string | null;
  createdAt: Date;
  resultLotCode: string | null;
  destinationLocationCode: string | null;
}>;

export async function listSubcontractingOperations(
  pool: pg.Pool,
  status: SubcontractingStatus | null,
): Promise<readonly SubcontractingOperationRow[]> {
  const result = await pool.query<SubcontractingOperationRow>(
    `${SUBCONTRACTING_OPERATION_QUERY}
      WHERE ($1::text IS NULL OR o.status = $1)
      ORDER BY o.sent_at DESC`,
    [status],
  );
  return result.rows;
}

export async function getSubcontractingOperation(
  pool: pg.Pool,
  operationId: string,
): Promise<{
  operation: SubcontractingOperationRow;
  results: readonly SubcontractingResultRow[];
}> {
  const operations = await pool.query<SubcontractingOperationRow>(
    `${SUBCONTRACTING_OPERATION_QUERY} WHERE o.id = $1`,
    [operationId],
  );
  const operation = operations.rows[0];
  if (!operation) {
    throw notFoundError('Opération de sous-traitance', operationId);
  }
  const results = await pool.query<SubcontractingResultRow>(
    `SELECT r.id                      AS "id",
            r.result_type             AS "resultType",
            r.quantity_kg             AS "quantityKg",
            r.outgoing_quality        AS "outgoingQuality",
            r.outgoing_size_grade     AS "outgoingSizeGrade",
            r.quality_status          AS "qualityStatus",
            r.created_at              AS "createdAt",
            lot.lot_code              AS "resultLotCode",
            loc.code                  AS "destinationLocationCode"
       FROM subcontracting_results r
       LEFT JOIN raw_material_lots lot ON lot.id = r.result_lot_id
       LEFT JOIN locations loc ON loc.id = r.destination_location_id
      WHERE r.subcontracting_operation_id = $1
      ORDER BY r.created_at`,
    [operationId],
  );
  return { operation, results: results.rows };
}
