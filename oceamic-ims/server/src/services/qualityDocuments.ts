import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { QualityDocumentStatus, QualityDocumentType } from '../domain/types.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';

// Document control (section 70): a quality document is a controlled
// identity, a revision is its controlled historical version - a revision is
// never overwritten (section 27), and an obsolete revision is never exposed
// as current (section 28).

export type QualityDocument = Readonly<{ id: string; documentCode: string; status: QualityDocumentStatus }>;

export async function requireQualityDocument(client: DatabaseClient, id: string): Promise<QualityDocument> {
  const result = await client.query<{ id: string; document_code: string; status: QualityDocumentStatus }>(
    'SELECT id, document_code, status FROM quality_documents WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Document qualité', id);
  }
  return { id: row.id, documentCode: row.document_code, status: row.status };
}

/**
 * Mirrors the document's cached status from its current revision (never
 * hand-edited): BROUILLON when no revision has ever been activated.
 */
async function refreshDocumentStatus(client: DatabaseClient, documentId: string): Promise<void> {
  const result = await client.query<{ status: QualityDocumentStatus | null }>(
    `SELECT r.status
       FROM quality_documents d
       LEFT JOIN quality_document_revisions r ON r.id = d.current_revision_id
      WHERE d.id = $1`,
    [documentId],
  );
  const status = result.rows[0]?.status ?? 'BROUILLON';
  await client.query('UPDATE quality_documents SET status = $2, updated_at = now() WHERE id = $1', [
    documentId,
    status,
  ]);
}

export type CreateQualityDocumentInput = Readonly<{
  documentCode: string;
  title: string;
  documentType: QualityDocumentType;
  department: string | null;
  ownerUserId: string;
  changeSummary: string;
}>;

/**
 * Creates a document together with its first revision (section 26/27): a
 * controlled document identity is meaningless without at least one revision,
 * so both are created atomically.
 */
export async function createQualityDocument(
  pool: pg.Pool,
  input: CreateQualityDocumentInput,
  actorId: string,
): Promise<Readonly<{ id: string; revisionId: string }>> {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM quality_documents WHERE document_code = $1', [
      input.documentCode,
    ]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le document ${input.documentCode} existe déjà.`, { code: input.documentCode });
    }

    const document = await client.query<{ id: string }>(
      `INSERT INTO quality_documents (document_code, title, document_type, department, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [input.documentCode.toUpperCase(), input.title, input.documentType, input.department, input.ownerUserId, actorId],
    );
    const documentId = document.rows[0]?.id;
    if (!documentId) {
      throw new Error("Le document qualité n'a pas pu être créé.");
    }

    const revision = await client.query<{ id: string }>(
      `INSERT INTO quality_document_revisions (quality_document_id, revision_number, change_summary, created_by)
       VALUES ($1, 1, $2, $3)
       RETURNING id`,
      [documentId, input.changeSummary, actorId],
    );
    const revisionId = revision.rows[0]?.id;
    if (!revisionId) {
      throw new Error("La révision initiale n'a pas pu être créée.");
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'DOCUMENT_CREATION',
      entityType: 'quality_documents',
      entityId: documentId,
      oldValues: null,
      newValues: { documentCode: input.documentCode, documentType: input.documentType, revisionId },
      context: null,
    });

    return { id: documentId, revisionId };
  });
}

export type CreateRevisionInput = Readonly<{ changeSummary: string; fileReference: string | null }>;

/**
 * Drafts a new revision (section 27): never overwrites the previous one -
 * revision 01 stays exactly as it was, whatever happens to this new draft.
 */
export async function createRevision(
  pool: pg.Pool,
  documentId: string,
  input: CreateRevisionInput,
  actorId: string,
): Promise<Readonly<{ id: string; revisionNumber: number }>> {
  return withTransaction(pool, async (client) => {
    const document = await requireQualityDocument(client, documentId);
    if (document.status === 'ANNULE') {
      throw conflictError(`Le document ${document.documentCode} est annulé.`, { documentId: document.id });
    }
    const maxRevision = await client.query<{ max: number | null }>(
      'SELECT MAX(revision_number) AS max FROM quality_document_revisions WHERE quality_document_id = $1',
      [document.id],
    );
    const nextNumber = (maxRevision.rows[0]?.max ?? 0) + 1;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO quality_document_revisions (quality_document_id, revision_number, change_summary, file_reference, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [document.id, nextNumber, input.changeSummary, input.fileReference, actorId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La révision n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'DOCUMENT_REVISION_CREATION',
      entityType: 'quality_document_revisions',
      entityId: id,
      oldValues: null,
      newValues: { documentId: document.id, revisionNumber: nextNumber },
      context: null,
    });
    return { id, revisionNumber: nextNumber };
  });
}

async function requireRevision(
  client: DatabaseClient,
  id: string,
): Promise<Readonly<{ id: string; documentId: string; status: QualityDocumentStatus; revisionNumber: number }>> {
  const result = await client.query<{
    id: string;
    quality_document_id: string;
    status: QualityDocumentStatus;
    revision_number: number;
  }>('SELECT id, quality_document_id, status, revision_number FROM quality_document_revisions WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Révision', id);
  }
  return { id: row.id, documentId: row.quality_document_id, status: row.status, revisionNumber: row.revision_number };
}

export async function submitRevisionForReview(pool: pg.Pool, revisionId: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const revision = await requireRevision(client, revisionId);
    if (revision.status !== 'BROUILLON') {
      throw conflictError('Seul un brouillon peut être soumis en révision.', {
        revisionId,
        status: revision.status,
      });
    }
    await client.query(
      "UPDATE quality_document_revisions SET status = 'EN_REVISION' WHERE id = $1",
      [revisionId],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'DOCUMENT_REVISION_SOUMISE',
      entityType: 'quality_document_revisions',
      entityId: revisionId,
      oldValues: { status: revision.status },
      newValues: { status: 'EN_REVISION' },
      context: null,
    });
    await refreshDocumentStatus(client, revision.documentId);
  });
}

/**
 * Approves a revision (section 29): `document:approve`, reserved to
 * RESPONSABLE_QUALITE - never every user. Approval alone does not yet make
 * the revision current; `activateRevision` below does that explicitly.
 */
export async function approveRevision(pool: pg.Pool, revisionId: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const revision = await requireRevision(client, revisionId);
    if (revision.status !== 'BROUILLON' && revision.status !== 'EN_REVISION') {
      throw conflictError('Cette révision ne peut plus être approuvée.', {
        revisionId,
        status: revision.status,
      });
    }
    await client.query(
      "UPDATE quality_document_revisions SET status = 'APPROUVE', approved_by = $2, approved_at = now() WHERE id = $1",
      [revisionId, actorId],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'DOCUMENT_REVISION_APPROBATION',
      entityType: 'quality_document_revisions',
      entityId: revisionId,
      oldValues: { status: revision.status },
      newValues: { status: 'APPROUVE', approvedBy: actorId },
      context: null,
    });
    await refreshDocumentStatus(client, revision.documentId);
  });
}

/**
 * Activates an approved revision as the document's current, EN_VIGUEUR
 * version (section 29): the previously active revision, if any, becomes
 * OBSOLETE - it is never deleted, still inspectable through the document's
 * revision history (section 43).
 */
export async function activateRevision(pool: pg.Pool, revisionId: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const revision = await requireRevision(client, revisionId);
    if (revision.status !== 'APPROUVE') {
      throw conflictError('Seule une révision approuvée peut être mise en vigueur.', {
        revisionId,
        status: revision.status,
      });
    }

    const previous = await client.query<{ id: string }>(
      "SELECT id FROM quality_document_revisions WHERE quality_document_id = $1 AND status = 'EN_VIGUEUR'",
      [revision.documentId],
    );
    const previousId = previous.rows[0]?.id ?? null;
    if (previousId !== null) {
      await client.query("UPDATE quality_document_revisions SET status = 'OBSOLETE' WHERE id = $1", [
        previousId,
      ]);
    }

    await client.query(
      "UPDATE quality_document_revisions SET status = 'EN_VIGUEUR', effective_date = COALESCE(effective_date, CURRENT_DATE) WHERE id = $1",
      [revisionId],
    );
    await client.query('UPDATE quality_documents SET current_revision_id = $2 WHERE id = $1', [
      revision.documentId,
      revisionId,
    ]);

    await recordAudit(client, {
      userId: actorId,
      action: 'DOCUMENT_REVISION_MISE_EN_VIGUEUR',
      entityType: 'quality_document_revisions',
      entityId: revisionId,
      oldValues: { previousCurrentRevisionId: previousId },
      newValues: { status: 'EN_VIGUEUR' },
      context: { documentId: revision.documentId },
    });

    await refreshDocumentStatus(client, revision.documentId);
  });
}

export async function cancelRevision(
  pool: pg.Pool,
  revisionId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const revision = await requireRevision(client, revisionId);
    if (revision.status === 'EN_VIGUEUR' || revision.status === 'OBSOLETE') {
      throw conflictError('Une révision en vigueur ou historique ne peut pas être annulée.', {
        revisionId,
        status: revision.status,
      });
    }
    await client.query("UPDATE quality_document_revisions SET status = 'ANNULE' WHERE id = $1", [revisionId]);
    await recordAudit(client, {
      userId: actorId,
      action: 'DOCUMENT_REVISION_ANNULATION',
      entityType: 'quality_document_revisions',
      entityId: revisionId,
      oldValues: { status: revision.status },
      newValues: { status: 'ANNULE', reason },
      context: null,
    });
    await refreshDocumentStatus(client, revision.documentId);
  });
}

export async function assignAcknowledgment(
  pool: pg.Pool,
  documentRevisionId: string,
  userId: string,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const revision = await requireRevision(client, documentRevisionId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO document_acknowledgments (document_revision_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (document_revision_id, user_id) DO UPDATE SET status = document_acknowledgments.status
       RETURNING id`,
      [revision.id, userId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'acquittement n'a pas pu être assigné.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'DOCUMENT_ACQUITTEMENT_ASSIGNATION',
      entityType: 'document_acknowledgments',
      entityId: id,
      oldValues: null,
      newValues: { documentRevisionId: revision.id, userId },
      context: null,
    });
    return { id };
  });
}

/**
 * The assigned user acknowledges the revision - self-service, so the actor
 * must be the same user the acknowledgment was assigned to (section 30).
 */
export async function acknowledgeDocument(pool: pg.Pool, acknowledgmentId: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const result = await client.query<{ id: string; user_id: string; status: string }>(
      'SELECT id, user_id, status FROM document_acknowledgments WHERE id = $1',
      [acknowledgmentId],
    );
    const row = result.rows[0];
    if (!row) {
      throw notFoundError('Acquittement', acknowledgmentId);
    }
    if (row.user_id !== actorId) {
      throw validationError("Seul l'utilisateur assigné peut acquitter cette révision.", { acknowledgmentId });
    }
    if (row.status !== 'ASSIGNEE') {
      throw conflictError('Cet acquittement a déjà été traité.', { acknowledgmentId, status: row.status });
    }
    await client.query(
      "UPDATE document_acknowledgments SET status = 'ACQUITTEE', acknowledged_at = now() WHERE id = $1",
      [acknowledgmentId],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'DOCUMENT_ACQUITTEMENT',
      entityType: 'document_acknowledgments',
      entityId: acknowledgmentId,
      oldValues: { status: 'ASSIGNEE' },
      newValues: { status: 'ACQUITTEE' },
      context: null,
    });
  });
}
