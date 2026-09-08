import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { FgDecisionType, FgEntityType, FgQualityStatus } from '../domain/types.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';

// Polymorphic Finished Goods quality decision/block mechanism (section 20):
// one shared lifecycle for FINISHED_GOOD_LOT and PALLET, following the exact
// decision -> optional block -> release shape of Phase 1's
// quality_decisions/lot_blocks, without a real foreign key to either target
// table (entity_type/entity_id is validated here, in the service layer, the
// same pattern already used for process_deviations in Phase 4).

const ENTITY_TABLES: Readonly<Record<FgEntityType, string>> = {
  FINISHED_GOOD_LOT: 'finished_good_lots',
  PALLET: 'pallets',
};

async function requireEntity(
  client: DatabaseClient,
  entityType: FgEntityType,
  entityId: string,
): Promise<void> {
  const table = ENTITY_TABLES[entityType];
  const result = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [entityId]);
  if (result.rows.length === 0) {
    throw notFoundError(
      entityType === 'FINISHED_GOOD_LOT' ? 'Lot PF' : 'Palette',
      entityId,
    );
  }
}

async function insertFgDecision(
  client: DatabaseClient,
  entityType: FgEntityType,
  entityId: string,
  decisionType: FgDecisionType,
  reason: string,
  notes: string | null,
  decidedBy: string,
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO finished_goods_quality_decisions (entity_type, entity_id, decision_type, reason,
                                                    decided_at, decided_by, notes)
     VALUES ($1, $2, $3, $4, now(), $5, $6)
     RETURNING id`,
    [entityType, entityId, decisionType, reason, decidedBy, notes],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("La décision qualité PF n'a pas pu être enregistrée.");
  }
  return id;
}

async function openFgBlock(
  client: DatabaseClient,
  entityType: FgEntityType,
  entityId: string,
  reason: string,
  blockDecisionId: string | null,
  actorId: string | null,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM finished_goods_quality_blocks WHERE entity_type = $1 AND entity_id = $2 AND status = $3',
    [entityType, entityId, 'ACTIF'],
  );
  if (existing.rows.length > 0) {
    throw conflictError(
      entityType === 'FINISHED_GOOD_LOT'
        ? 'Ce Lot PF est déjà bloqué par le service Qualité.'
        : 'Cette palette est déjà bloquée par le service Qualité.',
      { entityType, entityId },
    );
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO finished_goods_quality_blocks (entity_type, entity_id, blocked_at, blocked_by,
                                                 reason, block_decision_id, status)
     VALUES ($1, $2, now(), $3, $4, $5, 'ACTIF')
     RETURNING id`,
    [entityType, entityId, actorId, reason, blockDecisionId],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("Le blocage qualité PF n'a pas pu être enregistré.");
  }

  if (actorId) {
    await recordAudit(client, {
      userId: actorId,
      action: 'FG_QUALITE_BLOCAGE',
      entityType: 'finished_goods_quality_blocks',
      entityId: id,
      oldValues: null,
      newValues: { targetEntityType: entityType, targetEntityId: entityId, reason },
      context: null,
    });
  }

  return id;
}

async function closeActiveFgBlock(
  client: DatabaseClient,
  entityType: FgEntityType,
  entityId: string,
  releaseReason: string,
  releaseDecisionId: string,
  actorId: string,
): Promise<string> {
  const updated = await client.query<{ id: string; reason: string }>(
    `UPDATE finished_goods_quality_blocks
        SET status = 'LEVE',
            released_at = now(),
            released_by = $3,
            release_reason = $4,
            release_decision_id = $5,
            updated_at = now()
      WHERE entity_type = $1 AND entity_id = $2 AND status = 'ACTIF'
      RETURNING id, reason`,
    [entityType, entityId, actorId, releaseReason, releaseDecisionId],
  );
  const row = updated.rows[0];
  if (!row) {
    throw conflictError(
      entityType === 'FINISHED_GOOD_LOT'
        ? "Ce Lot PF n'a aucun blocage qualité actif."
        : "Cette palette n'a aucun blocage qualité actif.",
      { entityType, entityId },
    );
  }

  await recordAudit(client, {
    userId: actorId,
    action: 'FG_QUALITE_LIBERATION',
    entityType: 'finished_goods_quality_blocks',
    entityId: row.id,
    oldValues: { status: 'ACTIF', reason: row.reason },
    newValues: { status: 'LEVE', releaseReason },
    context: { targetEntityType: entityType, targetEntityId: entityId },
  });

  return row.id;
}

/**
 * Recomputes the cached quality_status column of a Lot PF or a pallet
 * (section 19). An active block always wins (BLOQUE); otherwise the most
 * recent decision decides (REJETE, or LIBERE for ACCEPTE/LIBERE); with no
 * decision at all the lot/pallet stays at its A_VERIFIER default. Packaging
 * completion never sets LIBERE on its own.
 */
export async function refreshFgQualityStatus(
  client: DatabaseClient,
  entityType: FgEntityType,
  entityId: string,
): Promise<FgQualityStatus> {
  const table = ENTITY_TABLES[entityType];
  const result = await client.query<{ status: FgQualityStatus }>(
    `WITH facts AS (
        SELECT EXISTS (
                 SELECT 1 FROM finished_goods_quality_blocks b
                  WHERE b.entity_type = $1 AND b.entity_id = $2 AND b.status = 'ACTIF'
               ) AS is_blocked,
               (SELECT d.decision_type
                  FROM finished_goods_quality_decisions d
                 WHERE d.entity_type = $1 AND d.entity_id = $2
                 ORDER BY d.decided_at DESC
                 LIMIT 1) AS last_decision
     )
     UPDATE ${table} t
        SET quality_status = CASE
                       WHEN facts.is_blocked THEN 'BLOQUE'
                       WHEN facts.last_decision = 'REJETE' THEN 'REJETE'
                       WHEN facts.last_decision IN ('ACCEPTE', 'LIBERE') THEN 'LIBERE'
                       ELSE t.quality_status
                     END,
            updated_at = now()
       FROM facts
      WHERE t.id = $2
      RETURNING t.quality_status AS status`,
    [entityType, entityId],
  );
  const status = result.rows[0]?.status;
  if (!status) {
    throw new Error('Le statut qualité PF n\'a pas pu être recalculé.');
  }
  return status;
}

export type FgQualityDecisionInput = Readonly<{
  entityType: FgEntityType;
  entityId: string;
  decisionType: FgDecisionType;
  reason: string;
  notes: string | null;
}>;

/**
 * Records a Finished Goods quality DECISION (section 20). BLOQUE opens a
 * block, LIBERE closes the active one; both keep their full history exactly
 * like Phase 1's decideQuality.
 */
export async function decideFgQuality(
  pool: pg.Pool,
  input: FgQualityDecisionInput,
  actorId: string,
): Promise<Readonly<{ decisionId: string; status: FgQualityStatus }>> {
  return withTransaction(pool, async (client) => {
    await requireEntity(client, input.entityType, input.entityId);

    const decisionId = await insertFgDecision(
      client,
      input.entityType,
      input.entityId,
      input.decisionType,
      input.reason,
      input.notes,
      actorId,
    );

    if (input.decisionType === 'BLOQUE') {
      await openFgBlock(client, input.entityType, input.entityId, input.reason, decisionId, actorId);
    }
    if (input.decisionType === 'LIBERE') {
      await closeActiveFgBlock(client, input.entityType, input.entityId, input.reason, decisionId, actorId);
    }

    const status = await refreshFgQualityStatus(client, input.entityType, input.entityId);

    await recordAudit(client, {
      userId: actorId,
      action: 'FG_QUALITE_DECISION',
      entityType: 'finished_goods_quality_decisions',
      entityId: decisionId,
      oldValues: null,
      newValues: {
        targetEntityType: input.entityType,
        targetEntityId: input.entityId,
        decisionType: input.decisionType,
        reason: input.reason,
      },
      context: { status },
    });

    return { decisionId, status };
  });
}

/**
 * Checks whether the production Run(s) behind a new Lot PF's sources carry an
 * unresolved Phase 4 CCP hold, and if so blocks the Lot PF immediately
 * (section 19's inheritance requirement) instead of leaving it at the
 * A_VERIFIER default set at INSERT time. Returns the resulting status, or
 * null when nothing was inherited and the caller should keep the default.
 */
export async function inheritUpstreamHold(
  client: DatabaseClient,
  finishedGoodLotId: string,
  actorId: string,
): Promise<FgQualityStatus | null> {
  const holds = await client.query<{ hold_id: string; reason: string }>(
    `SELECT DISTINCT h.hold_id, h.reason
       FROM finished_good_lot_sources s
       JOIN run_hold_status h ON h.production_run_id = s.production_run_id
      WHERE s.finished_good_lot_id = $1`,
    [finishedGoodLotId],
  );
  if (holds.rows.length === 0) {
    return null;
  }

  const reasons = holds.rows.map((row) => row.reason).join(' ; ');
  await openFgBlock(
    client,
    'FINISHED_GOOD_LOT',
    finishedGoodLotId,
    `Blocage hérité d'une retenue Production/CCP non levée : ${reasons}`,
    null,
    actorId,
  );

  return refreshFgQualityStatus(client, 'FINISHED_GOOD_LOT', finishedGoodLotId);
}
