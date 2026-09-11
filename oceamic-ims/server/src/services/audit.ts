import type { DatabaseClient } from '../db/pool.ts';

export type AuditEntry = Readonly<{
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
}>;

/**
 * Appends a business event to the audit trail. Always called inside the
 * transaction of the operation it describes, so the trail can never disagree
 * with the data. Secrets are never passed to this function.
 */
export async function recordAudit(client: DatabaseClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.userId,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.oldValues,
      entry.newValues,
      entry.context,
    ],
  );
}
