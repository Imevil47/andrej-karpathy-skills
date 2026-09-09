import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type {
  AuditFindingStatus,
  AuditFindingType,
  AuditResponseResult,
  AuditStatus,
  AuditType,
  QmsSeverity,
} from '../domain/types.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { createNonconformity, type Nonconformity } from './nonconformities.ts';

// Audit: a planned evaluation (section 70), structurally separate from its
// findings below.

export type Audit = Readonly<{ id: string; auditCode: string; status: AuditStatus }>;

export async function requireAudit(client: DatabaseClient, id: string): Promise<Audit> {
  const result = await client.query<{ id: string; audit_code: string; status: AuditStatus }>(
    'SELECT id, audit_code, status FROM audits WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Audit', id);
  }
  return { id: row.id, auditCode: row.audit_code, status: row.status };
}

function assertNotFinal(audit: Audit): void {
  if (audit.status === 'TERMINE' || audit.status === 'ANNULE') {
    throw conflictError(
      `L'audit ${audit.auditCode} est déjà ${audit.status === 'TERMINE' ? 'terminé' : 'annulé'}.`,
      { auditId: audit.id, status: audit.status },
    );
  }
}

export type CreateAuditInput = Readonly<{
  auditType: AuditType;
  title: string;
  auditChecklistId: string | null;
  plannedDate: string;
  scope: string;
  leadAuditorUserId: string;
  notes: string | null;
}>;

export async function createAudit(pool: pg.Pool, input: CreateAuditInput, actorId: string): Promise<Audit> {
  return withTransaction(pool, async (client) => {
    if (input.auditChecklistId !== null) {
      const checklist = await client.query('SELECT id FROM audit_checklists WHERE id = $1', [
        input.auditChecklistId,
      ]);
      if (checklist.rows.length === 0) {
        throw notFoundError('Checklist audit', input.auditChecklistId);
      }
    }
    const code = await nextOperationalCode(client, 'AUD', new Date(input.plannedDate));
    const inserted = await client.query<{ id: string; status: AuditStatus }>(
      `INSERT INTO audits (audit_code, audit_type, title, audit_checklist_id, planned_date, scope,
                           lead_auditor_user_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, status`,
      [
        code,
        input.auditType,
        input.title,
        input.auditChecklistId,
        input.plannedDate,
        input.scope,
        input.leadAuditorUserId,
        input.notes,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'audit n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'AUDIT_CREATION',
      entityType: 'audits',
      entityId: row.id,
      oldValues: null,
      newValues: { auditCode: code, auditType: input.auditType },
      context: null,
    });
    return { id: row.id, auditCode: code, status: row.status };
  });
}

export async function startAudit(pool: pg.Pool, auditId: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const audit = await requireAudit(client, auditId);
    assertNotFinal(audit);
    await client.query("UPDATE audits SET status = 'EN_COURS', started_at = now(), updated_at = now() WHERE id = $1", [
      audit.id,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'AUDIT_DEMARRAGE',
      entityType: 'audits',
      entityId: audit.id,
      oldValues: { status: audit.status },
      newValues: { status: 'EN_COURS' },
      context: null,
    });
  });
}

export async function completeAudit(pool: pg.Pool, auditId: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const audit = await requireAudit(client, auditId);
    assertNotFinal(audit);
    await client.query(
      "UPDATE audits SET status = 'TERMINE', completed_at = now(), updated_at = now() WHERE id = $1",
      [audit.id],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'AUDIT_CLOTURE',
      entityType: 'audits',
      entityId: audit.id,
      oldValues: { status: audit.status },
      newValues: { status: 'TERMINE' },
      context: null,
    });
  });
}

export async function cancelAudit(pool: pg.Pool, auditId: string, reason: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const audit = await requireAudit(client, auditId);
    assertNotFinal(audit);
    await client.query("UPDATE audits SET status = 'ANNULE', updated_at = now() WHERE id = $1", [audit.id]);
    await recordAudit(client, {
      userId: actorId,
      action: 'AUDIT_ANNULATION',
      entityType: 'audits',
      entityId: audit.id,
      oldValues: { status: audit.status },
      newValues: { status: 'ANNULE', reason },
      context: null,
    });
  });
}

export type AuditResponseInput = Readonly<{
  checklistItemId: string;
  result: AuditResponseResult;
  observation: string | null;
  evidenceReference: string | null;
}>;

/**
 * Records one checklist item response (section 23). A measured observation,
 * structurally distinct from a finding: recording NON_CONFORME here does not
 * by itself create a finding - the auditor decides that explicitly below,
 * the same separation as a CCP measurement versus a CCP decision in Phase 4.
 */
export async function recordAuditResponse(
  pool: pg.Pool,
  auditId: string,
  input: AuditResponseInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const audit = await requireAudit(client, auditId);
    assertNotFinal(audit);
    const item = await client.query('SELECT id FROM audit_checklist_items WHERE id = $1', [
      input.checklistItemId,
    ]);
    if (item.rows.length === 0) {
      throw notFoundError('Point de contrôle', input.checklistItemId);
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO audit_responses (audit_id, checklist_item_id, result, observation, evidence_reference,
                                    responded_by, responded_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (audit_id, checklist_item_id)
       DO UPDATE SET result = EXCLUDED.result, observation = EXCLUDED.observation,
                     evidence_reference = EXCLUDED.evidence_reference,
                     responded_by = EXCLUDED.responded_by, responded_at = now()
       RETURNING id`,
      [audit.id, input.checklistItemId, input.result, input.observation, input.evidenceReference, actorId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La réponse d'audit n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'AUDIT_REPONSE_ENREGISTREE',
      entityType: 'audit_responses',
      entityId: id,
      oldValues: null,
      newValues: { auditId: audit.id, checklistItemId: input.checklistItemId, result: input.result },
      context: null,
    });
    return { id };
  });
}

export type CreateFindingInput = Readonly<{
  findingType: AuditFindingType;
  description: string;
  severity: QmsSeverity;
  ownerUserId: string | null;
  dueAt: Date | null;
}>;

export async function createAuditFinding(
  pool: pg.Pool,
  auditId: string,
  input: CreateFindingInput,
  actorId: string,
): Promise<Readonly<{ id: string; findingCode: string }>> {
  return withTransaction(pool, async (client) => {
    const audit = await requireAudit(client, auditId);
    const code = await nextOperationalCode(client, 'CST', new Date());
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO audit_findings (audit_id, finding_code, finding_type, description, severity,
                                   owner_user_id, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [audit.id, code, input.findingType, input.description, input.severity, input.ownerUserId, input.dueAt],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le constat d'audit n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'AUDIT_CONSTAT_CREATION',
      entityType: 'audit_findings',
      entityId: id,
      oldValues: null,
      newValues: { auditId: audit.id, findingCode: code, findingType: input.findingType, severity: input.severity },
      context: null,
    });
    return { id, findingCode: code };
  });
}

export async function updateAuditFindingStatus(
  pool: pg.Pool,
  findingId: string,
  status: AuditFindingStatus,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const finding = await client.query<{ id: string; status: AuditFindingStatus; finding_code: string }>(
      'SELECT id, status, finding_code FROM audit_findings WHERE id = $1',
      [findingId],
    );
    const row = finding.rows[0];
    if (!row) {
      throw notFoundError('Constat audit', findingId);
    }
    if (row.status === 'CLOTUREE' || row.status === 'ANNULEE') {
      throw conflictError(`Le constat ${row.finding_code} est déjà close.`, { findingId, status: row.status });
    }
    await client.query('UPDATE audit_findings SET status = $2, updated_at = now() WHERE id = $1', [
      findingId,
      status,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: status === 'CLOTUREE' ? 'AUDIT_CONSTAT_CLOTURE' : 'AUDIT_CONSTAT_STATUT_MODIFICATION',
      entityType: 'audit_findings',
      entityId: findingId,
      oldValues: { status: row.status },
      newValues: { status },
      context: null,
    });
  });
}

export type NonconformityFromFindingInput = Readonly<{
  detectedAt: Date;
  categoryId: string;
  title: string;
  severity: QmsSeverity;
  ownerUserId: string | null;
}>;

/**
 * Generates a non-conformity from an audit finding (section 24) without
 * duplicating the finding's own description - the NCR links back to the
 * finding (`resulting_nonconformity_id`) instead of re-typing it.
 */
export async function createNonconformityFromFinding(
  pool: pg.Pool,
  findingId: string,
  input: NonconformityFromFindingInput,
  actorId: string,
): Promise<Nonconformity> {
  const client = await pool.connect();
  let finding: { id: string; description: string; auditId: string };
  try {
    const result = await client.query<{ id: string; description: string; audit_id: string }>(
      'SELECT id, description, audit_id FROM audit_findings WHERE id = $1',
      [findingId],
    );
    const row = result.rows[0];
    if (!row) {
      throw notFoundError('Constat audit', findingId);
    }
    finding = { id: row.id, description: row.description, auditId: row.audit_id };
  } finally {
    client.release();
  }

  const ncr = await createNonconformity(
    pool,
    {
      detectedAt: input.detectedAt,
      sourceType: 'AUDIT_FINDING',
      sourceId: finding.id,
      categoryId: input.categoryId,
      title: input.title,
      description: finding.description,
      severity: input.severity,
      priority: 'NORMALE',
      ownerUserId: input.ownerUserId,
      dueAt: null,
      qualityBlockRequired: false,
      detectedBy: actorId,
      links: [{ entityType: 'AUDIT', entityId: finding.auditId, relationshipType: 'DETECTE_SUR' }],
    },
    actorId,
  );

  await withTransaction(pool, async (transactionClient) => {
    await transactionClient.query(
      'UPDATE audit_findings SET resulting_nonconformity_id = $2, updated_at = now() WHERE id = $1',
      [finding.id, ncr.id],
    );
    await recordAudit(transactionClient, {
      userId: actorId,
      action: 'AUDIT_CONSTAT_NCR_LIEE',
      entityType: 'audit_findings',
      entityId: finding.id,
      oldValues: null,
      newValues: { nonconformityId: ncr.id },
      context: null,
    });
  });

  return ncr;
}
