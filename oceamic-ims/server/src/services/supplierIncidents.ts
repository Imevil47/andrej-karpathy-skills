import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { QmsSeverity, SupplierIncidentStatus } from '../domain/types.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';

// Supplier quality incident (section 19): histamine, temperature, incorrect
// mould, missing document... `category` stays free text (the spec's own
// examples span too many domains for one configurable table with clear
// benefit, unlike the NCR categories reused across the whole QMS).

export type SupplierIncident = Readonly<{ id: string; incidentCode: string; status: SupplierIncidentStatus }>;

export async function requireSupplierIncident(client: DatabaseClient, id: string): Promise<SupplierIncident> {
  const result = await client.query<{ id: string; incident_code: string; status: SupplierIncidentStatus }>(
    'SELECT id, incident_code, status FROM supplier_quality_incidents WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Incident fournisseur', id);
  }
  return { id: row.id, incidentCode: row.incident_code, status: row.status };
}

export type CreateSupplierIncidentInput = Readonly<{
  supplierId: string;
  rawMaterialLotId: string | null;
  receptionId: string | null;
  detectedAt: Date;
  category: string;
  description: string;
  severity: QmsSeverity;
}>;

export async function createSupplierIncident(
  pool: pg.Pool,
  input: CreateSupplierIncidentInput,
  actorId: string,
): Promise<SupplierIncident> {
  return withTransaction(pool, async (client) => {
    const supplier = await client.query('SELECT id FROM suppliers WHERE id = $1', [input.supplierId]);
    if (supplier.rows.length === 0) {
      throw notFoundError('Fournisseur', input.supplierId);
    }
    const code = await nextOperationalCode(client, 'INC', input.detectedAt);
    const inserted = await client.query<{ id: string; status: SupplierIncidentStatus }>(
      `INSERT INTO supplier_quality_incidents (incident_code, supplier_id, raw_material_lot_id,
                                                reception_id, detected_at, category, description,
                                                severity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, status`,
      [
        code,
        input.supplierId,
        input.rawMaterialLotId,
        input.receptionId,
        input.detectedAt,
        input.category,
        input.description,
        input.severity,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'incident fournisseur n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'INCIDENT_FOURNISSEUR_CREATION',
      entityType: 'supplier_quality_incidents',
      entityId: row.id,
      oldValues: null,
      newValues: { incidentCode: code, supplierId: input.supplierId, category: input.category },
      context: null,
    });
    return { id: row.id, incidentCode: code, status: row.status };
  });
}

export async function updateSupplierIncidentStatus(
  pool: pg.Pool,
  incidentId: string,
  status: SupplierIncidentStatus,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const incident = await requireSupplierIncident(client, incidentId);
    if (incident.status === 'CLOTUREE' || incident.status === 'ANNULEE') {
      throw conflictError(`L'incident ${incident.incidentCode} est déjà close.`, {
        incidentId: incident.id,
        status: incident.status,
      });
    }
    await client.query('UPDATE supplier_quality_incidents SET status = $2, updated_at = now() WHERE id = $1', [
      incident.id,
      status,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action:
        status === 'CLOTUREE' ? 'INCIDENT_FOURNISSEUR_CLOTURE' : 'INCIDENT_FOURNISSEUR_STATUT_MODIFICATION',
      entityType: 'supplier_quality_incidents',
      entityId: incident.id,
      oldValues: { status: incident.status },
      newValues: { status },
      context: null,
    });
  });
}
