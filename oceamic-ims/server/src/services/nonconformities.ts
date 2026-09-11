import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import {
  NONCONFORMITY_ALLOWED_TRANSITIONS,
  type NonconformityLinkRelationship,
  type NonconformityStatus,
  type QmsBlockableEntityType,
  type QmsEntityType,
  type QmsPriority,
  type QmsSeverity,
  type RootCauseMethod,
} from '../domain/types.ts';
import { conflictError, confirmationRequiredError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { decideFgQuality } from './finishedGoodsQuality.ts';
import { decideQuality } from './quality.ts';

// Non-conformity: the entry point of the QMS (section 4) - a documented
// failure/deviation requiring quality handling, structurally distinct from
// its investigation, root cause and any CAPA it later gives rise to
// (section 70).

export type Nonconformity = Readonly<{
  id: string;
  nonconformityCode: string;
  status: NonconformityStatus;
  severity: QmsSeverity;
  priority: QmsPriority;
}>;

export async function requireNonconformity(
  client: DatabaseClient,
  id: string,
): Promise<Nonconformity> {
  const result = await client.query<{
    id: string;
    nonconformity_code: string;
    status: NonconformityStatus;
    severity: QmsSeverity;
    priority: QmsPriority;
  }>('SELECT id, nonconformity_code, status, severity, priority FROM nonconformities WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Non-conformité', id);
  }
  return {
    id: row.id,
    nonconformityCode: row.nonconformity_code,
    status: row.status,
    severity: row.severity,
    priority: row.priority,
  };
}

// A CRITIQUE severity should never silently coexist with a BASSE/NORMALE
// operational priority (section 7.3): not a hard block (a critical issue
// that is already fully contained can legitimately stay non-urgent), but a
// confirmation the operator must explicitly give, the same discipline as
// the cross-line confirmation in cadence.ts.
const LOW_PRIORITIES: readonly QmsPriority[] = ['BASSE', 'NORMALE'];

function assertSeverityPriorityConsistency(
  severity: QmsSeverity,
  priority: QmsPriority,
  confirmed: boolean,
): void {
  if (severity === 'CRITIQUE' && LOW_PRIORITIES.includes(priority) && !confirmed) {
    throw confirmationRequiredError(
      `Attention.\nGravité critique avec une priorité ${priority === 'BASSE' ? 'basse' : 'normale'} : la priorité recommandée pour une non-conformité critique est au moins « Haute ».`,
      { severity, priority },
    );
  }
}

async function insertLink(
  client: DatabaseClient,
  nonconformityId: string,
  entityType: QmsEntityType,
  entityId: string,
  relationshipType: NonconformityLinkRelationship,
  actorId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO nonconformity_links (nonconformity_id, entity_type, entity_id, relationship_type, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (nonconformity_id, entity_type, entity_id, relationship_type) DO NOTHING`,
    [nonconformityId, entityType, entityId, relationshipType, actorId],
  );
}

export type NonconformityLinkInput = Readonly<{
  entityType: QmsEntityType;
  entityId: string;
  relationshipType: NonconformityLinkRelationship;
}>;

export type CreateNonconformityInput = Readonly<{
  detectedAt: Date;
  sourceType: QmsEntityType | null;
  sourceId: string | null;
  categoryId: string;
  title: string;
  description: string;
  severity: QmsSeverity;
  priority: QmsPriority;
  ownerUserId: string | null;
  dueAt: Date | null;
  qualityBlockRequired: boolean;
  detectedBy: string;
  links: readonly NonconformityLinkInput[];
  confirmSeverityPriority: boolean;
}>;

/**
 * Creates a non-conformity (section 8): callable directly from an
 * operational record (a weight control, a seaming control...) so the run,
 * lot, product and date already known there are never re-typed - the caller
 * passes them as `sourceType`/`sourceId` plus any extra `links`.
 */
export async function createNonconformity(
  pool: pg.Pool,
  input: CreateNonconformityInput,
  actorId: string,
): Promise<Nonconformity> {
  assertSeverityPriorityConsistency(input.severity, input.priority, input.confirmSeverityPriority);
  return withTransaction(pool, async (client) => {
    const category = await client.query('SELECT id FROM nonconformity_categories WHERE id = $1', [
      input.categoryId,
    ]);
    if (category.rows.length === 0) {
      throw notFoundError('Catégorie de non-conformité', input.categoryId);
    }

    const code = await nextOperationalCode(client, 'NC', input.detectedAt);
    const inserted = await client.query<{ id: string; status: NonconformityStatus }>(
      `INSERT INTO nonconformities (nonconformity_code, detected_at, source_type, source_id, category_id,
                                    title, description, severity, priority, detected_by, owner_user_id,
                                    due_at, quality_block_required, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, status`,
      [
        code,
        input.detectedAt,
        input.sourceType,
        input.sourceId,
        input.categoryId,
        input.title,
        input.description,
        input.severity,
        input.priority,
        input.detectedBy,
        input.ownerUserId,
        input.dueAt,
        input.qualityBlockRequired,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("La non-conformité n'a pas pu être créée.");
    }

    if (input.sourceType !== null && input.sourceId !== null) {
      await insertLink(client, row.id, input.sourceType, input.sourceId, 'SOURCE', actorId);
    }
    for (const link of input.links) {
      await insertLink(client, row.id, link.entityType, link.entityId, link.relationshipType, actorId);
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'NCR_CREATION',
      entityType: 'nonconformities',
      entityId: row.id,
      oldValues: null,
      newValues: {
        nonconformityCode: code,
        severity: input.severity,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
      context: null,
    });

    return { id: row.id, nonconformityCode: code, status: row.status, severity: input.severity, priority: input.priority };
  });
}

export async function addNonconformityLink(
  pool: pg.Pool,
  nonconformityId: string,
  link: NonconformityLinkInput,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const ncr = await requireNonconformity(client, nonconformityId);
    await insertLink(client, ncr.id, link.entityType, link.entityId, link.relationshipType, actorId);
    await recordAudit(client, {
      userId: actorId,
      action: 'NCR_LIEN_AJOUT',
      entityType: 'nonconformity_links',
      entityId: ncr.id,
      oldValues: null,
      newValues: { ...link },
      context: null,
    });
  });
}

/**
 * Changes severity (section 52's explicit audit requirement): a distinct,
 * audited operation rather than a silent field update inside a generic PATCH.
 */
export async function updateNonconformitySeverity(
  pool: pg.Pool,
  nonconformityId: string,
  severity: QmsSeverity,
  confirmSeverityPriority: boolean,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const ncr = await requireNonconformity(client, nonconformityId);
    assertSeverityPriorityConsistency(severity, ncr.priority, confirmSeverityPriority);
    await client.query('UPDATE nonconformities SET severity = $2, updated_at = now() WHERE id = $1', [
      ncr.id,
      severity,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'NCR_GRAVITE_MODIFICATION',
      entityType: 'nonconformities',
      entityId: ncr.id,
      oldValues: { severity: ncr.severity },
      newValues: { severity },
      context: null,
    });
  });
}

export async function updateNonconformityOwner(
  pool: pg.Pool,
  nonconformityId: string,
  ownerUserId: string | null,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const ncr = await requireNonconformity(client, nonconformityId);
    const previous = await client.query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM nonconformities WHERE id = $1',
      [ncr.id],
    );
    await client.query('UPDATE nonconformities SET owner_user_id = $2, updated_at = now() WHERE id = $1', [
      ncr.id,
      ownerUserId,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'NCR_RESPONSABLE_MODIFICATION',
      entityType: 'nonconformities',
      entityId: ncr.id,
      oldValues: { ownerUserId: previous.rows[0]?.owner_user_id ?? null },
      newValues: { ownerUserId },
      context: null,
    });
  });
}

function assertNotFinal(ncr: Nonconformity): void {
  if (ncr.status === 'CLOTUREE' || ncr.status === 'ANNULEE') {
    throw conflictError(
      `La non-conformité ${ncr.nonconformityCode} est déjà ${ncr.status === 'CLOTUREE' ? 'clôturée' : 'annulée'}.`,
      { nonconformityId: ncr.id, status: ncr.status },
    );
  }
}

/**
 * Section 57's closure gate: a non-conformity cannot close while it still
 * has an open CAPA (one it caused, still working towards its own closure) -
 * the same "no closing while required actions remain open" discipline as
 * CAPA's own gate (section 15), applied one level up.
 */
async function assertNoOpenCapa(client: DatabaseClient, nonconformityId: string): Promise<void> {
  const open = await client.query<{ capa_code: string }>(
    `SELECT capa_code FROM capa_records
      WHERE source_nonconformity_id = $1 AND status NOT IN ('CLOTUREE', 'ANNULEE')`,
    [nonconformityId],
  );
  if (open.rows.length > 0) {
    throw conflictError(
      'Clôture impossible.\nDes CAPA liés restent ouverts.',
      { nonconformityId, openCapaCodes: open.rows.map((row) => row.capa_code) },
    );
  }
}

export async function updateNonconformityStatus(
  pool: pg.Pool,
  nonconformityId: string,
  status: NonconformityStatus,
  reason: string | null,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const ncr = await requireNonconformity(client, nonconformityId);
    assertNotFinal(ncr);
    const allowed = NONCONFORMITY_ALLOWED_TRANSITIONS[ncr.status];
    if (!allowed.includes(status)) {
      throw conflictError(
        `Transition de statut invalide.\nDepuis ${ncr.status}, seuls les statuts suivants sont autorisés : ${allowed.join(', ')}.`,
        { nonconformityId: ncr.id, from: ncr.status, to: status, allowed },
      );
    }
    if (status === 'CLOTUREE') {
      await assertNoOpenCapa(client, ncr.id);
    }
    await client.query('UPDATE nonconformities SET status = $2, updated_at = now() WHERE id = $1', [
      ncr.id,
      status,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: status === 'CLOTUREE' ? 'NCR_CLOTURE' : 'NCR_STATUT_MODIFICATION',
      entityType: 'nonconformities',
      entityId: ncr.id,
      oldValues: { status: ncr.status },
      newValues: { status, reason },
      context: null,
    });
  });
}

export type InvestigationInput = Readonly<{
  startedAt: Date;
  completedAt: Date | null;
  investigatorUserId: string;
  facts: string;
  immediateCorrection: string | null;
  impactAssessment: string | null;
  rootCauseRequired: boolean;
  notes: string | null;
}>;

/**
 * Records the investigation (section 10): facts and immediate correction,
 * never the corrective action itself (section 49).
 */
export async function recordInvestigation(
  pool: pg.Pool,
  nonconformityId: string,
  input: InvestigationInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const ncr = await requireNonconformity(client, nonconformityId);
    assertNotFinal(ncr);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO nonconformity_investigations (nonconformity_id, started_at, completed_at,
                                                  investigator_user_id, facts, immediate_correction,
                                                  impact_assessment, root_cause_required, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        ncr.id,
        input.startedAt,
        input.completedAt,
        input.investigatorUserId,
        input.facts,
        input.immediateCorrection,
        input.impactAssessment,
        input.rootCauseRequired,
        input.notes,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'investigation n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'NCR_INVESTIGATION_CREATION',
      entityType: 'nonconformity_investigations',
      entityId: id,
      oldValues: null,
      newValues: { nonconformityId: ncr.id },
      context: null,
    });
    return { id };
  });
}

export type RootCauseInput = Readonly<{
  method: RootCauseMethod;
  analysisText: string;
  rootCause: string;
}>;

export async function recordRootCauseAnalysis(
  pool: pg.Pool,
  nonconformityId: string,
  input: RootCauseInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const ncr = await requireNonconformity(client, nonconformityId);
    assertNotFinal(ncr);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO root_cause_analyses (nonconformity_id, method, analysis_text, root_cause)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [ncr.id, input.method, input.analysisText, input.rootCause],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'analyse de cause racine n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'NCR_CAUSE_RACINE_CREATION',
      entityType: 'root_cause_analyses',
      entityId: id,
      oldValues: null,
      newValues: { nonconformityId: ncr.id, method: input.method },
      context: null,
    });
    return { id };
  });
}

/**
 * Validates a root cause (section 53/54): `ncr:approve`, reserved to
 * RESPONSABLE_QUALITE - the analyst who proposed it is never the one who
 * alone validates it.
 */
export async function validateRootCause(
  pool: pg.Pool,
  rootCauseAnalysisId: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const existing = await client.query<{ id: string; nonconformity_id: string; validated_at: Date | null }>(
      'SELECT id, nonconformity_id, validated_at FROM root_cause_analyses WHERE id = $1',
      [rootCauseAnalysisId],
    );
    const row = existing.rows[0];
    if (!row) {
      throw notFoundError('Analyse de cause racine', rootCauseAnalysisId);
    }
    if (row.validated_at !== null) {
      throw conflictError('Cette analyse de cause racine est déjà validée.', { rootCauseAnalysisId });
    }
    await client.query(
      'UPDATE root_cause_analyses SET validated_by = $2, validated_at = now(), updated_at = now() WHERE id = $1',
      [row.id, actorId],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'NCR_CAUSE_RACINE_VALIDATION',
      entityType: 'root_cause_analyses',
      entityId: row.id,
      oldValues: { validatedAt: null },
      newValues: { validatedBy: actorId },
      context: { nonconformityId: row.nonconformity_id },
    });
  });
}

const BLOCK_TABLE_BY_ENTITY_TYPE: Readonly<Record<QmsBlockableEntityType, string>> = {
  RAW_MATERIAL_LOT: 'lot_blocks',
  FINISHED_GOOD_LOT: 'finished_goods_quality_blocks',
  PALLET: 'finished_goods_quality_blocks',
};

/**
 * Opens a quality block from a non-conformity (section 9), reusing the
 * existing Phase 1 (`lot_blocks`, raw material) or Phase 5
 * (`finished_goods_quality_blocks`, finished goods/pallet) architecture -
 * never a third, independent block system. Each underlying decision keeps
 * its own transaction (the established entry points only accept a pool), so
 * this runs in two steps: open the block through the existing service, then
 * record the resulting reference on the non-conformity.
 */
export async function openNcrQualityBlock(
  pool: pg.Pool,
  nonconformityId: string,
  entityType: QmsBlockableEntityType,
  entityId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  const client = await pool.connect();
  let ncr: Nonconformity;
  try {
    ncr = await requireNonconformity(client, nonconformityId);
  } finally {
    client.release();
  }
  assertNotFinal(ncr);

  let decisionId: string;
  if (entityType === 'RAW_MATERIAL_LOT') {
    const result = await decideQuality(
      pool,
      { rawMaterialLotId: entityId, inspectionId: null, decisionType: 'BLOQUE', reason, notes: null },
      actorId,
    );
    decisionId = result.decisionId;
  } else {
    const result = await decideFgQuality(
      pool,
      { entityType, entityId, decisionType: 'BLOQUE', reason, notes: null },
      actorId,
    );
    decisionId = result.decisionId;
  }

  await withTransaction(pool, async (client) => {
    const blockTable = BLOCK_TABLE_BY_ENTITY_TYPE[entityType];
    const block = await client.query<{ id: string }>(
      `SELECT id FROM ${blockTable} WHERE block_decision_id = $1`,
      [decisionId],
    );
    const blockId = block.rows[0]?.id ?? null;

    await client.query(
      `UPDATE nonconformities
          SET block_entity_type = $2, block_entity_id = $3, block_reference_id = $4,
              quality_block_required = TRUE, updated_at = now()
        WHERE id = $1`,
      [nonconformityId, entityType, entityId, blockId],
    );

    await recordAudit(client, {
      userId: actorId,
      action: 'NCR_BLOCAGE_DECLENCHE',
      entityType: 'nonconformities',
      entityId: nonconformityId,
      oldValues: null,
      newValues: { blockEntityType: entityType, blockEntityId: entityId, blockReferenceId: blockId },
      context: null,
    });
  });
}

