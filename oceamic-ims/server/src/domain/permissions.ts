import type { RoleCode } from './types.ts';

// Phase 1 permission set. Future modules add new permissions here without
// changing the way routes declare what they require.
export const PERMISSIONS = [
  'masterdata:read',
  'masterdata:write',
  'reception:create',
  'stock:read',
  'stock:transfer',
  'stock:loss',
  'stock:adjust',
  'stock:reverse',
  'subcontracting:read',
  'subcontracting:create',
  'subcontracting:result',
  'quality:read',
  'quality:inspect',
  'quality:decide',
  'quality:release',
  'traceability:read',
  'audit:read',
  'users:manage',
  // Phase 2: production
  'production:read',
  'production:run',
  'production:material',
  'production:output',
  'production:correct',
  // Phase 3: workforce cadence
  'workforce:manage',
  'cadence:control',
  'downtime:record',
  // Phase 4: filling, seaming, marking, sterilization, CCP, deviations
  'filling:manage',
  'weight:control',
  'seaming:operate',
  'seaming:control',
  'marking:record',
  'marking:verify',
  'sterilization:operate',
  'ccp:validate',
  'deviation:manage',
  // Phase 5: packaging, finished goods, pallets, PF stock, shipments
  'packaging:manage',
  'fgstock:manage',
  'fgquality:decide',
  'shipment:manage',
  // Phase 6: horizontal QMS - non-conformities, CAPA, complaints, supplier
  // incidents, audits, documents, recall. Read access joins the shared
  // READ_ONLY bundle below. Every "approve" permission is deliberately
  // separate from its "manage" counterpart (section 54): the same role that
  // raises a critical non-conformity or drafts a CAPA/document/recall must
  // never be the one that alone closes it.
  'qms:read',
  'ncr:manage',
  'ncr:approve',
  'capa:manage',
  'capa:approve',
  'complaint:manage',
  'supplierincident:manage',
  'audit:plan',
  'audit:conduct',
  'document:manage',
  'document:approve',
  'recall:exercise',
  'recall:manage',
  'action:complete',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: readonly Permission[] = [
  'masterdata:read',
  'stock:read',
  'subcontracting:read',
  'quality:read',
  'traceability:read',
  'production:read',
  'qms:read',
];

const ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly Permission[]>> = {
  ADMIN: PERMISSIONS,
  // Quality inspects, decides, blocks and releases. It does not run logistics.
  QUALITE: [
    ...READ_ONLY,
    'quality:inspect',
    'quality:decide',
    'quality:release',
    'audit:read',
    // Weight, seaming and marking are Quality inspections of a Production
    // process, the same way quality:inspect covers raw material (section 59).
    'weight:control',
    'seaming:control',
    'marking:verify',
    // CCP validation and deviation management stay Quality/Admin-only: an
    // ordinary Production user can never authorize a critical-limit decision
    // on their own (section 36).
    'ccp:validate',
    'deviation:manage',
    // Blocking/releasing a Finished Goods Lot or a pallet is the same kind
    // of authority as releasing a raw-material lot (section 20): reserved to
    // Quality/Admin.
    'fgquality:decide',
    // Phase 6: QUALITE raises and manages non-conformities, CAPA,
    // complaints, supplier incidents, conducts audits, drafts documents and
    // runs traceability exercises - but the approval gates below
    // (validating a root cause, closing a CAPA, approving a document
    // revision, initiating a real recall) stay with RESPONSABLE_QUALITE
    // (section 53/54).
    'ncr:manage',
    'capa:manage',
    'complaint:manage',
    'supplierincident:manage',
    'audit:plan',
    'audit:conduct',
    'document:manage',
    'recall:exercise',
  ],
  // Full QA authority: everything QUALITE holds, plus the approval gates
  // section 54 reserves so the same broad role never both raises a critical
  // issue and alone closes it.
  RESPONSABLE_QUALITE: [
    ...READ_ONLY,
    'quality:inspect',
    'quality:decide',
    'quality:release',
    'audit:read',
    'weight:control',
    'seaming:control',
    'marking:verify',
    'ccp:validate',
    'deviation:manage',
    'fgquality:decide',
    'ncr:manage',
    'ncr:approve',
    'capa:manage',
    'capa:approve',
    'complaint:manage',
    'supplierincident:manage',
    'audit:plan',
    'audit:conduct',
    'document:manage',
    'document:approve',
    'recall:exercise',
    'recall:manage',
  ],
  // Conducts assigned audits and records findings only - never creates or
  // plans an audit, never decides a non-conformity or a block on its own.
  AUDITEUR: [...READ_ONLY, 'audit:conduct'],
  // Stock runs receptions, movements and subcontracting logistics, but can
  // never release a quality block and can never adjust stock on its own.
  STOCK: [
    ...READ_ONLY,
    'reception:create',
    'stock:transfer',
    'stock:loss',
    'subcontracting:create',
    'subcontracting:result',
    // Finished Goods stock and shipments are logistics, the same domain as
    // raw-material stock: transfers, reservations, container loading and
    // shipment confirmation stay with STOCK, never with PRODUCTION or
    // QUALITE (section 45).
    'fgstock:manage',
    'shipment:manage',
    // Phase 6: STOCK can complete a CAPA action or audit finding action
    // assigned to it, but can never close a Quality non-conformity, CAPA,
    // audit finding or document on its own (section 53).
    'action:complete',
  ],
  // Production runs the transformation: runs, consumption, outputs and losses.
  // Corrections stay available because they are reversals, fully audited, and a
  // shift cannot wait for an administrator to fix a mistyped quantity.
  PRODUCTION: [
    ...READ_ONLY,
    'production:run',
    'production:material',
    'production:output',
    'production:correct',
    // Manages Run workforce, runs control rounds, enters cadence and records
    // downtime. Employees, cadence standards and downtime categories stay
    // administrator-only, through masterdata:write.
    'workforce:manage',
    'cadence:control',
    'downtime:record',
    // Production runs the filling, seaming and sterilization operations and
    // records the process measurements taken on the floor (section 59). The
    // quality inspection of what came out of each of these operations -
    // weight controls, seaming controls, marking verification, CCP decisions -
    // stays with Quality.
    'filling:manage',
    'seaming:operate',
    'marking:record',
    'sterilization:operate',
    // Packaging is a Production activity, the same way filling, seaming and
    // sterilization are: creating packaging batches, Finished Goods Lots and
    // pallets stays with PRODUCTION (section 45's "EMBALLAGE / PRODUCTION").
    'packaging:manage',
    // Phase 6: PRODUCTION can complete a CAPA action or audit finding
    // action assigned to it, same reasoning as STOCK above.
    'action:complete',
  ],
  LECTURE: READ_ONLY,
};

export function permissionsForRole(role: RoleCode): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: RoleCode, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
