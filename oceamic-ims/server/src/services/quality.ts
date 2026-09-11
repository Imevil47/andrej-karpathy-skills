import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { DecisionType, InspectionResult, InspectionType, ProcessStage } from '../domain/types.ts';
import { conflictError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { refreshLotStatus, requireLot } from './lots.ts';

export type InspectionInput = Readonly<{
  rawMaterialLotId: string;
  inspectedAt: Date;
  inspectionType: InspectionType;
  processStage: ProcessStage;
  locationId: string | null;
  temperatureC: string | null;
  histaminePpm: string | null;
  abvt: string | null;
  qualityGrade: string | null;
  sizeGrade: string | null;
  result: InspectionResult;
  notes: string | null;
}>;

export type Inspection = Readonly<{ id: string; inspectionCode: string }>;

/**
 * Records an OBSERVATION. Measurements are historical facts: they are never
 * modified by a later quality decision.
 */
export async function createInspection(
  client: DatabaseClient,
  input: InspectionInput,
  inspectorId: string,
): Promise<Inspection> {
  await requireLot(client, input.rawMaterialLotId);
  const inspectionCode = await nextOperationalCode(client, 'INS', input.inspectedAt);

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO quality_inspections (inspection_code, raw_material_lot_id, inspected_at,
                                      inspection_type, process_stage, location_id, temperature_c,
                                      histamine_ppm, abvt, quality_grade, size_grade, result,
                                      notes, inspector_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      inspectionCode,
      input.rawMaterialLotId,
      input.inspectedAt,
      input.inspectionType,
      input.processStage,
      input.locationId,
      input.temperatureC,
      input.histaminePpm,
      input.abvt,
      input.qualityGrade,
      input.sizeGrade,
      input.result,
      input.notes,
      inspectorId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("Le contrôle qualité n'a pas pu être enregistré.");
  }

  await recordAudit(client, {
    userId: inspectorId,
    action: 'QUALITE_CONTROLE',
    entityType: 'quality_inspections',
    entityId: id,
    oldValues: null,
    newValues: { inspectionCode, lotId: input.rawMaterialLotId, result: input.result },
    context: null,
  });

  return { id, inspectionCode };
}

async function insertDecision(
  client: DatabaseClient,
  lotId: string,
  inspectionId: string | null,
  decisionType: DecisionType,
  reason: string,
  notes: string | null,
  decidedBy: string,
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO quality_decisions (inspection_id, raw_material_lot_id, decision_type, reason,
                                    decided_at, decided_by, notes)
     VALUES ($1, $2, $3, $4, now(), $5, $6)
     RETURNING id`,
    [inspectionId, lotId, decisionType, reason, decidedBy, notes],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("La décision qualité n'a pas pu être enregistrée.");
  }
  return id;
}

export type DecisionInput = Readonly<{
  rawMaterialLotId: string;
  inspectionId: string | null;
  decisionType: DecisionType;
  reason: string;
  notes: string | null;
}>;

/**
 * Records a quality DECISION. `BLOQUE` opens an operational block on the lot and
 * `LIBERE` closes the active one; both keep their full history.
 */
export async function decideQuality(
  pool: pg.Pool,
  input: DecisionInput,
  actorId: string,
): Promise<{ decisionId: string; lotStatus: string }> {
  return withTransaction(pool, async (client) => {
    const lot = await requireLot(client, input.rawMaterialLotId);
    const decisionId = await insertDecision(
      client,
      lot.id,
      input.inspectionId,
      input.decisionType,
      input.reason,
      input.notes,
      actorId,
    );

    if (input.decisionType === 'BLOQUE') {
      await openBlock(client, lot.id, input.reason, input.inspectionId, decisionId, actorId);
    }
    if (input.decisionType === 'LIBERE') {
      await closeActiveBlock(client, lot.id, input.reason, decisionId, actorId);
    }

    const lotStatus = await refreshLotStatus(client, lot.id);

    await recordAudit(client, {
      userId: actorId,
      action: 'QUALITE_DECISION',
      entityType: 'quality_decisions',
      entityId: decisionId,
      oldValues: null,
      newValues: {
        lotCode: lot.lotCode,
        decisionType: input.decisionType,
        reason: input.reason,
        inspectionId: input.inspectionId,
      },
      context: { lotStatus },
    });

    return { decisionId, lotStatus };
  });
}

async function openBlock(
  client: DatabaseClient,
  lotId: string,
  reason: string,
  inspectionId: string | null,
  decisionId: string,
  actorId: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM lot_blocks WHERE raw_material_lot_id = $1 AND status = $2',
    [lotId, 'ACTIF'],
  );
  if (existing.rows.length > 0) {
    throw conflictError('Ce lot est déjà bloqué par le service Qualité.', { lotId });
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO lot_blocks (raw_material_lot_id, blocked_at, blocked_by, reason,
                             source_inspection_id, block_decision_id, status)
     VALUES ($1, now(), $2, $3, $4, $5, 'ACTIF')
     RETURNING id`,
    [lotId, actorId, reason, inspectionId, decisionId],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("Le blocage du lot n'a pas pu être enregistré.");
  }

  await recordAudit(client, {
    userId: actorId,
    action: 'QUALITE_BLOCAGE',
    entityType: 'lot_blocks',
    entityId: id,
    oldValues: null,
    newValues: { lotId, reason, sourceInspectionId: inspectionId },
    context: null,
  });

  return id;
}

/**
 * Closes the active block. The block row is kept: history of who blocked, when
 * and why is never deleted.
 */
async function closeActiveBlock(
  client: DatabaseClient,
  lotId: string,
  releaseReason: string,
  decisionId: string,
  actorId: string,
): Promise<string> {
  const updated = await client.query<{ id: string; reason: string }>(
    `UPDATE lot_blocks
        SET status = 'LEVE',
            released_at = now(),
            released_by = $2,
            release_reason = $3,
            release_decision_id = $4,
            updated_at = now()
      WHERE raw_material_lot_id = $1 AND status = 'ACTIF'
      RETURNING id, reason`,
    [lotId, actorId, releaseReason, decisionId],
  );
  const row = updated.rows[0];
  if (!row) {
    throw conflictError("Ce lot n'a aucun blocage qualité actif.", { lotId });
  }

  await recordAudit(client, {
    userId: actorId,
    action: 'QUALITE_LIBERATION',
    entityType: 'lot_blocks',
    entityId: row.id,
    oldValues: { status: 'ACTIF', reason: row.reason },
    newValues: { status: 'LEVE', releaseReason },
    context: { lotId },
  });

  return row.id;
}

export async function recordInspection(
  pool: pg.Pool,
  input: InspectionInput,
  inspectorId: string,
): Promise<Inspection> {
  return withTransaction(pool, (client) => createInspection(client, input, inspectorId));
}

export type InspectionRow = Readonly<{
  id: string;
  inspectionCode: string;
  inspectedAt: Date;
  inspectionType: InspectionType;
  processStage: ProcessStage;
  temperatureC: string | null;
  histaminePpm: string | null;
  abvt: string | null;
  qualityGrade: string | null;
  sizeGrade: string | null;
  result: InspectionResult;
  notes: string | null;
  lotId: string;
  lotCode: string;
  locationCode: string | null;
  inspectorName: string;
}>;

export type BlockedLotRow = Readonly<{
  lotBlockId: string;
  lotId: string;
  lotCode: string;
  speciesCode: string;
  blockedAt: Date;
  reason: string;
  blockedByName: string;
  sourceInspectionCode: string | null;
  blockedQuantityKg: string;
}>;

export async function listInspections(
  pool: pg.Pool,
  lotId: string | null,
  limit: number,
): Promise<readonly InspectionRow[]> {
  const result = await pool.query<InspectionRow>(
    `SELECT i.id                AS "id",
            i.inspection_code   AS "inspectionCode",
            i.inspected_at      AS "inspectedAt",
            i.inspection_type   AS "inspectionType",
            i.process_stage     AS "processStage",
            i.temperature_c     AS "temperatureC",
            i.histamine_ppm     AS "histaminePpm",
            i.abvt              AS "abvt",
            i.quality_grade     AS "qualityGrade",
            i.size_grade        AS "sizeGrade",
            i.result            AS "result",
            i.notes             AS "notes",
            lot.id              AS "lotId",
            lot.lot_code        AS "lotCode",
            loc.code            AS "locationCode",
            u.full_name         AS "inspectorName"
       FROM quality_inspections i
       JOIN raw_material_lots lot ON lot.id = i.raw_material_lot_id
       JOIN users u ON u.id = i.inspector_id
       LEFT JOIN locations loc ON loc.id = i.location_id
      WHERE ($1::uuid IS NULL OR i.raw_material_lot_id = $1)
      ORDER BY i.inspected_at DESC
      LIMIT $2`,
    [lotId, limit],
  );
  return result.rows;
}

export async function listBlockedLots(pool: pg.Pool): Promise<readonly BlockedLotRow[]> {
  const result = await pool.query<BlockedLotRow>(
    `SELECT b.id                AS "lotBlockId",
            lot.id              AS "lotId",
            lot.lot_code        AS "lotCode",
            sp.code             AS "speciesCode",
            b.blocked_at        AS "blockedAt",
            b.reason            AS "reason",
            u.full_name         AS "blockedByName",
            i.inspection_code   AS "sourceInspectionCode",
            COALESCE(stock.quantity_kg, 0)::numeric(14,3) AS "blockedQuantityKg"
       FROM blocked_lots bl
       JOIN lot_blocks b ON b.id = bl.lot_block_id
       JOIN raw_material_lots lot ON lot.id = b.raw_material_lot_id
       JOIN species sp ON sp.id = lot.species_id
       JOIN users u ON u.id = b.blocked_by
       LEFT JOIN quality_inspections i ON i.id = b.source_inspection_id
       LEFT JOIN current_stock_by_lot stock ON stock.raw_material_lot_id = lot.id
      ORDER BY b.blocked_at DESC`,
  );
  return result.rows;
}
