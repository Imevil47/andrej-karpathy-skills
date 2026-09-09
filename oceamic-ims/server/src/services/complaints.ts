import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { CustomerComplaintStatus, CustomerComplaintType, QmsSeverity } from '../domain/types.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { createNonconformity, type Nonconformity } from './nonconformities.ts';

// Customer complaint: a customer-originated quality event (section 70),
// never a CRM (section 16) - shipping/quality traceability usage only.

export type Complaint = Readonly<{ id: string; complaintCode: string; status: CustomerComplaintStatus }>;

export async function requireComplaint(client: DatabaseClient, id: string): Promise<Complaint> {
  const result = await client.query<{ id: string; complaint_code: string; status: CustomerComplaintStatus }>(
    'SELECT id, complaint_code, status FROM customer_complaints WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Réclamation', id);
  }
  return { id: row.id, complaintCode: row.complaint_code, status: row.status };
}

export type CreateComplaintInput = Readonly<{
  receivedAt: Date;
  customerId: string;
  shipmentId: string | null;
  finishedGoodLotId: string | null;
  palletId: string | null;
  complaintType: CustomerComplaintType;
  description: string;
  severity: QmsSeverity;
  ownerUserId: string | null;
}>;

export async function createComplaint(
  pool: pg.Pool,
  input: CreateComplaintInput,
  actorId: string,
): Promise<Complaint> {
  return withTransaction(pool, async (client) => {
    const customer = await client.query('SELECT id FROM customers WHERE id = $1', [input.customerId]);
    if (customer.rows.length === 0) {
      throw notFoundError('Client', input.customerId);
    }
    const code = await nextOperationalCode(client, 'RECL', input.receivedAt);
    const inserted = await client.query<{ id: string; status: CustomerComplaintStatus }>(
      `INSERT INTO customer_complaints (complaint_code, received_at, customer_id, shipment_id,
                                        finished_good_lot_id, pallet_id, complaint_type, description,
                                        severity, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, status`,
      [
        code,
        input.receivedAt,
        input.customerId,
        input.shipmentId,
        input.finishedGoodLotId,
        input.palletId,
        input.complaintType,
        input.description,
        input.severity,
        input.ownerUserId,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("La réclamation n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'RECLAMATION_CREATION',
      entityType: 'customer_complaints',
      entityId: row.id,
      oldValues: null,
      newValues: { complaintCode: code, customerId: input.customerId, complaintType: input.complaintType },
      context: null,
    });
    return { id: row.id, complaintCode: code, status: row.status };
  });
}

export async function updateComplaintStatus(
  pool: pg.Pool,
  complaintId: string,
  status: CustomerComplaintStatus,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const complaint = await requireComplaint(client, complaintId);
    if (complaint.status === 'CLOTUREE' || complaint.status === 'ANNULEE') {
      throw conflictError(`La réclamation ${complaint.complaintCode} est déjà close.`, {
        complaintId: complaint.id,
        status: complaint.status,
      });
    }
    await client.query('UPDATE customer_complaints SET status = $2, updated_at = now() WHERE id = $1', [
      complaint.id,
      status,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: status === 'CLOTUREE' ? 'RECLAMATION_CLOTURE' : 'RECLAMATION_STATUT_MODIFICATION',
      entityType: 'customer_complaints',
      entityId: complaint.id,
      oldValues: { status: complaint.status },
      newValues: { status },
      context: null,
    });
  });
}

export type NonconformityFromComplaintInput = Readonly<{
  detectedAt: Date;
  categoryId: string;
  title: string;
  description: string;
  severity: QmsSeverity;
  ownerUserId: string | null;
}>;

/**
 * Creates a non-conformity from a complaint (section 18), linking rather
 * than duplicating the investigation: the complaint's own record stays the
 * customer-facing fact, the NCR carries the quality workflow.
 */
export async function createNonconformityFromComplaint(
  pool: pg.Pool,
  complaintId: string,
  input: NonconformityFromComplaintInput,
  actorId: string,
): Promise<Nonconformity> {
  const client = await pool.connect();
  let complaint: Complaint;
  try {
    complaint = await requireComplaint(client, complaintId);
  } finally {
    client.release();
  }

  const ncr = await createNonconformity(
    pool,
    {
      detectedAt: input.detectedAt,
      sourceType: 'CUSTOMER_COMPLAINT',
      sourceId: complaint.id,
      categoryId: input.categoryId,
      title: input.title,
      description: input.description,
      severity: input.severity,
      // Same reasoning as audits.ts: a critical complaint-derived NCR must
      // not silently land at normal priority (section 7.3).
      priority: input.severity === 'CRITIQUE' ? 'HAUTE' : 'NORMALE',
      ownerUserId: input.ownerUserId,
      dueAt: null,
      qualityBlockRequired: false,
      confirmSeverityPriority: true,
      detectedBy: actorId,
      links: [],
    },
    actorId,
  );

  await withTransaction(pool, async (transactionClient) => {
    await transactionClient.query(
      'UPDATE customer_complaints SET resulting_nonconformity_id = $2, updated_at = now() WHERE id = $1',
      [complaint.id, ncr.id],
    );
    await recordAudit(transactionClient, {
      userId: actorId,
      action: 'RECLAMATION_NCR_LIEE',
      entityType: 'customer_complaints',
      entityId: complaint.id,
      oldValues: null,
      newValues: { nonconformityId: ncr.id },
      context: null,
    });
  });

  return ncr;
}

export async function linkComplaintToCapa(
  pool: pg.Pool,
  complaintId: string,
  capaId: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const complaint = await requireComplaint(client, complaintId);
    const capa = await client.query('SELECT id FROM capa_records WHERE id = $1', [capaId]);
    if (capa.rows.length === 0) {
      throw notFoundError('CAPA', capaId);
    }
    await client.query('UPDATE customer_complaints SET resulting_capa_id = $2, updated_at = now() WHERE id = $1', [
      complaint.id,
      capaId,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'RECLAMATION_CAPA_LIEE',
      entityType: 'customer_complaints',
      entityId: complaint.id,
      oldValues: null,
      newValues: { capaId },
      context: null,
    });
  });
}
