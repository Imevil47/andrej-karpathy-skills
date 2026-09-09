import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type {
  QmsSeverity,
  RecallAffectedEntityType,
  RecallEventType,
  RecallImpactType,
  RecallStatus,
  RecallTargetEntityType,
} from '../domain/types.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { forwardTraceabilityFromRawMaterialLot, traceabilityFromFinishedGoodLot } from './fgQueries.ts';

// Recall / withdrawal (section 70): a controlled market/stock traceability
// event, real or a mock exercise, always starting from one concrete entity
// and computed from existing relational traceability - never a manually
// typed list (section 32).

export type RecallEvent = Readonly<{ id: string; recallCode: string; status: RecallStatus }>;

export async function requireRecallEvent(client: DatabaseClient, id: string): Promise<RecallEvent> {
  const result = await client.query<{ id: string; recall_code: string; status: RecallStatus }>(
    'SELECT id, recall_code, status FROM recall_events WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Retrait / rappel', id);
  }
  return { id: row.id, recallCode: row.recall_code, status: row.status };
}

type AffectedRow = Readonly<{
  entityType: RecallAffectedEntityType;
  entityId: string;
  impactType: RecallImpactType;
  quantity: number | null;
}>;

/**
 * Computes the impact set from existing traceability (sections 32-34):
 * every affected Run, Lot PF, pallet, shipment and customer, deduplicated by
 * (entityType, entityId). Never asks anyone to build this list by hand.
 */
async function computeImpact(
  pool: pg.Pool,
  targetEntityType: RecallTargetEntityType,
  targetEntityId: string,
): Promise<readonly AffectedRow[]> {
  const rows = new Map<string, AffectedRow>();
  const add = (entityType: RecallAffectedEntityType, entityId: string | null, impactType: RecallImpactType, quantity: number | null) => {
    if (entityId === null) {
      return;
    }
    const key = `${entityType}:${entityId}`;
    if (!rows.has(key)) {
      rows.set(key, { entityType, entityId, impactType, quantity });
    }
  };

  if (targetEntityType === 'RAW_MATERIAL_LOT') {
    add('RAW_MATERIAL_LOT', targetEntityId, 'ORIGINE', null);
    const chain = await forwardTraceabilityFromRawMaterialLot(pool, targetEntityId);
    for (const row of chain) {
      add('PRODUCTION_RUN', row.productionRunId, 'AFFECTE', null);
      add('STERILIZATION_CYCLE', row.sterilizationCycleId, 'AFFECTE', null);
      add('FINISHED_GOOD_LOT', row.finishedGoodLotId, 'AFFECTE', null);
      add('PALLET', row.palletId, 'AFFECTE', row.quantityCartons);
      add('SHIPMENT', row.shipmentId, 'AFFECTE', null);
      add('CUSTOMER', row.customerId, 'AFFECTE', null);
    }
  } else {
    add('FINISHED_GOOD_LOT', targetEntityId, 'ORIGINE', null);
    const chain = await traceabilityFromFinishedGoodLot(pool, targetEntityId);
    for (const row of chain) {
      add('PRODUCTION_RUN', row.productionRunId, 'AFFECTE', null);
      add('STERILIZATION_CYCLE', row.sterilizationCycleId, 'AFFECTE', null);
      add('PALLET', row.palletId, 'AFFECTE', row.quantityCartons);
      add('SHIPMENT', row.shipmentId, 'AFFECTE', null);
      add('CUSTOMER', row.customerId, 'AFFECTE', null);
    }
  }

  return Array.from(rows.values());
}

export type CreateRecallEventInput = Readonly<{
  eventType: RecallEventType;
  targetEntityType: RecallTargetEntityType;
  targetEntityId: string;
  reason: string;
  severity: QmsSeverity;
  scopeDescription: string | null;
}>;

/**
 * Opens a recall/withdrawal/traceability-exercise event and immediately
 * computes its impact set (section 35): the exercise record is the snapshot
 * found at this moment, not a claim of live, ever-current completeness.
 */
export async function createRecallEvent(
  pool: pg.Pool,
  input: CreateRecallEventInput,
  actorId: string,
): Promise<Readonly<{ id: string; recallCode: string; affectedCount: number }>> {
  const targetTable = input.targetEntityType === 'RAW_MATERIAL_LOT' ? 'raw_material_lots' : 'finished_good_lots';
  const targetExists = await pool.query(`SELECT id FROM ${targetTable} WHERE id = $1`, [input.targetEntityId]);
  if (targetExists.rows.length === 0) {
    throw notFoundError(
      input.targetEntityType === 'RAW_MATERIAL_LOT' ? 'Lot matière première' : 'Lot PF',
      input.targetEntityId,
    );
  }

  const impact = await computeImpact(pool, input.targetEntityType, input.targetEntityId);

  return withTransaction(pool, async (client) => {
    const openedAt = new Date();
    const code = await nextOperationalCode(client, 'RAP', openedAt);
    const inserted = await client.query<{ id: string; status: RecallStatus }>(
      `INSERT INTO recall_events (recall_code, event_type, target_entity_type, target_entity_id, opened_at,
                                  reason, severity, initiated_by, scope_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, status`,
      [
        code,
        input.eventType,
        input.targetEntityType,
        input.targetEntityId,
        openedAt,
        input.reason,
        input.severity,
        actorId,
        input.scopeDescription,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'événement de retrait/rappel n'a pas pu être créé.");
    }

    for (const affected of impact) {
      await client.query(
        `INSERT INTO recall_affected_entities (recall_event_id, entity_type, entity_id, impact_type, quantity)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (recall_event_id, entity_type, entity_id) DO NOTHING`,
        [row.id, affected.entityType, affected.entityId, affected.impactType, affected.quantity],
      );
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'RECALL_OUVERTURE',
      entityType: 'recall_events',
      entityId: row.id,
      oldValues: null,
      newValues: {
        recallCode: code,
        eventType: input.eventType,
        targetEntityType: input.targetEntityType,
        targetEntityId: input.targetEntityId,
        affectedCount: impact.length,
      },
      context: null,
    });

    return { id: row.id, recallCode: code, affectedCount: impact.length };
  });
}

/** Re-runs the traceability search and merges any newly found entity into
 * the impact set - used when working an open recall, never to shrink it. */
export async function refreshRecallImpact(pool: pg.Pool, recallEventId: string, actorId: string): Promise<number> {
  const client = await pool.connect();
  let event: Readonly<{ targetEntityType: RecallTargetEntityType; targetEntityId: string }>;
  try {
    const result = await client.query<{ target_entity_type: RecallTargetEntityType; target_entity_id: string }>(
      'SELECT target_entity_type, target_entity_id FROM recall_events WHERE id = $1',
      [recallEventId],
    );
    const row = result.rows[0];
    if (!row) {
      throw notFoundError('Retrait / rappel', recallEventId);
    }
    event = { targetEntityType: row.target_entity_type, targetEntityId: row.target_entity_id };
  } finally {
    client.release();
  }

  const impact = await computeImpact(pool, event.targetEntityType, event.targetEntityId);

  return withTransaction(pool, async (transactionClient) => {
    let added = 0;
    for (const affected of impact) {
      const result = await transactionClient.query(
        `INSERT INTO recall_affected_entities (recall_event_id, entity_type, entity_id, impact_type, quantity)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (recall_event_id, entity_type, entity_id) DO NOTHING
         RETURNING id`,
        [recallEventId, affected.entityType, affected.entityId, affected.impactType, affected.quantity],
      );
      added += result.rows.length;
    }
    if (added > 0) {
      await recordAudit(transactionClient, {
        userId: actorId,
        action: 'RECALL_IMPACT_ACTUALISE',
        entityType: 'recall_events',
        entityId: recallEventId,
        oldValues: null,
        newValues: { newlyIdentified: added },
        context: null,
      });
    }
    return added;
  });
}

export async function updateRecallEventStatus(
  pool: pg.Pool,
  recallEventId: string,
  status: RecallStatus,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const event = await requireRecallEvent(client, recallEventId);
    if (event.status === 'CLOTURE' || event.status === 'ANNULE') {
      throw conflictError(`L'événement ${event.recallCode} est déjà close.`, {
        recallEventId: event.id,
        status: event.status,
      });
    }
    await client.query('UPDATE recall_events SET status = $2, updated_at = now() WHERE id = $1', [
      event.id,
      status,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'RECALL_STATUT_MODIFICATION',
      entityType: 'recall_events',
      entityId: event.id,
      oldValues: { status: event.status },
      newValues: { status },
      context: null,
    });
  });
}

/**
 * Closes the recall/exercise (section 35), recording the observations
 * gathered while it was worked - `closed_at` is what makes the exercise
 * duration computable, never claimed complete before this.
 */
export async function closeRecallEvent(
  pool: pg.Pool,
  recallEventId: string,
  observations: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const event = await requireRecallEvent(client, recallEventId);
    if (event.status === 'CLOTURE' || event.status === 'ANNULE') {
      throw conflictError(`L'événement ${event.recallCode} est déjà close.`, {
        recallEventId: event.id,
        status: event.status,
      });
    }
    await client.query(
      "UPDATE recall_events SET status = 'CLOTURE', observations = $2, closed_at = now(), updated_at = now() WHERE id = $1",
      [event.id, observations],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'RECALL_CLOTURE',
      entityType: 'recall_events',
      entityId: event.id,
      oldValues: { status: event.status },
      newValues: { status: 'CLOTURE' },
      context: null,
    });
  });
}

export type MassBalance = Readonly<{
  producedCartons: number;
  inStockCartons: number;
  blockedCartons: number;
  shippedCartons: number;
  adjustedCartons: number;
  unexplainedCartons: number;
}>;

/**
 * Mass balance for a Lot PF (section 36): produced / in stock / shipped /
 * blocked / adjusted, with the residual reported as unexplained rather than
 * silently hidden - never claimed as a perfect reconciliation when the
 * underlying data does not support one (e.g. a pallet never fully accounted
 * for). `shippedCartons` is attributed via `pallet_contents`, which is
 * immutable once set (section 25): a lot's share of a pallet's cartons never
 * changes, so "was that pallet ever expedited" is a safe, precise test.
 */
export async function massBalanceForFinishedGoodLot(pool: pg.Pool, finishedGoodLotId: string): Promise<MassBalance> {
  const result = await pool.query<{
    produced: string | null;
    in_stock: string | null;
    blocked: string | null;
    shipped: string | null;
    adjusted: string | null;
  }>(
    `SELECT
        (SELECT COALESCE(SUM(quantity_cartons), 0) FROM packaging_outputs
          WHERE finished_good_lot_id = $1) AS produced,
        (SELECT COALESCE(physical_cartons, 0) FROM finished_good_lot_stock_summary
          WHERE finished_good_lot_id = $1) AS in_stock,
        (SELECT COALESCE(blocked_cartons, 0) FROM finished_good_lot_stock_summary
          WHERE finished_good_lot_id = $1) AS blocked,
        (SELECT COALESCE(SUM(pc.quantity_cartons), 0)
           FROM pallet_contents pc
          WHERE pc.finished_good_lot_id = $1
            AND EXISTS (SELECT 1 FROM finished_goods_stock_movements m
                         WHERE m.pallet_id = pc.pallet_id AND m.movement_type = 'EXPEDITION')) AS shipped,
        (SELECT COALESCE(SUM(pc.quantity_cartons), 0)
           FROM pallet_contents pc
          WHERE pc.finished_good_lot_id = $1
            AND EXISTS (SELECT 1 FROM finished_goods_stock_movements m
                         WHERE m.pallet_id = pc.pallet_id AND m.movement_type = 'AJUSTEMENT')) AS adjusted`,
    [finishedGoodLotId],
  );
  const row = result.rows[0];
  const produced = Number(row?.produced ?? 0);
  const inStock = Number(row?.in_stock ?? 0);
  const blocked = Number(row?.blocked ?? 0);
  const shipped = Number(row?.shipped ?? 0);
  const adjusted = Number(row?.adjusted ?? 0);
  return {
    producedCartons: produced,
    inStockCartons: inStock,
    blockedCartons: blocked,
    shippedCartons: shipped,
    adjustedCartons: adjusted,
    unexplainedCartons: produced - inStock - shipped,
  };
}

export async function updateAffectedEntityStatus(
  pool: pg.Pool,
  affectedEntityId: string,
  status: 'IDENTIFIE' | 'EN_TRAITEMENT' | 'TRAITE',
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const result = await client.query<{ id: string; recall_event_id: string; status: string }>(
      'SELECT id, recall_event_id, status FROM recall_affected_entities WHERE id = $1',
      [affectedEntityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw notFoundError('Entité affectée', affectedEntityId);
    }
    await client.query('UPDATE recall_affected_entities SET status = $2 WHERE id = $1', [
      affectedEntityId,
      status,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'RECALL_ENTITE_STATUT_MODIFICATION',
      entityType: 'recall_affected_entities',
      entityId: affectedEntityId,
      oldValues: { status: row.status },
      newValues: { status },
      context: { recallEventId: row.recall_event_id },
    });
  });
}

