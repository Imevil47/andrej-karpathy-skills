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
  // Phase 7: maintenance / CMMS layer. Read access joins the shared
  // READ_ONLY bundle below. Equipment master data is deliberately its own
  // permission (equipment:manage), never masterdata:write, so
  // RESPONSABLE_MAINTENANCE gains it without picking up unrelated Phase
  // 1-6 master data rights. workorder:approve mirrors the ncr:approve /
  // capa:approve split (section 52): closing an "important" work order
  // (HAUTE/CRITIQUE equipment, or an URGENCE work order - see
  // workOrderClosureRequiresApproval) needs it; any other closure only
  // needs workorder:manage.
  'maintenance:read',
  'failure:report',
  'failure:manage',
  'workorder:manage',
  'workorder:approve',
  'intervention:manage',
  'preventive:complete',
  'preventive:manage',
  'sparepart:consume',
  'sparepart:adjust',
  'equipment:manage',
  // Phase 8: ingredients and production consumables. Read access joins the
  // shared READ_ONLY bundle below. Mirrors the Phase 1 stock split
  // (reception/transfer with STOCK, adjustment ADMIN-only) rather than one
  // catch-all permission, so the same separation of duties applies to
  // ingredient stock as to raw-material stock.
  'ingredient:read',
  'ingredient:reception',
  'ingredient:transfer',
  'ingredient:adjust',
  'ingredient:consume',
  'ingredient:quality',
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
  'maintenance:read',
  'ingredient:read',
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
    // Phase 8: QUALITE inspects, blocks and releases ingredient lots -
    // the same authority it already holds over raw-material lots (section
    // 54), never a parallel Quality truth for ingredients.
    'ingredient:quality',
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
    'ingredient:quality',
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
    // Phase 8: STOCK/magasin receives ingredient lots and transfers them
    // (including feeding a cuve) - ingredient stock adjustment stays
    // ADMIN-only, the same separation as stock:adjust for raw material
    // (section 59).
    'ingredient:reception',
    'ingredient:transfer',
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
    // Phase 7: PRODUCTION reports a breakdown it observes on the floor
    // (section 52) and reads maintenance/equipment status through
    // maintenance:read (READ_ONLY above), but never edits a failure,
    // intervention or work order - that stays with MAINTENANCE.
    'failure:report',
    // Phase 8: PRODUCTION records what it actually consumes and recovers
    // on the floor - Run ingredient consumption, tank-batch draw, oil
    // recovery and reuse (section 59) - but never receives, transfers or
    // adjusts ingredient stock, and never overrides an ingredient lot's
    // quality status.
    'ingredient:consume',
  ],
  // Works failures, work orders, interventions, preventive tasks and
  // spare-part consumption (section 52) - but cannot close an "important"
  // work order, configure preventive plans, manage equipment master data
  // or authorize a stock adjustment; those stay with RESPONSABLE_MAINTENANCE.
  MAINTENANCE: [
    ...READ_ONLY,
    'failure:report',
    'failure:manage',
    'workorder:manage',
    'intervention:manage',
    'preventive:complete',
    'sparepart:consume',
  ],
  // Full maintenance authority: everything MAINTENANCE holds, plus the
  // approval/configuration gates section 52 reserves so the same role that
  // works a job is never the only one that can close an important one or
  // change master data underneath it.
  RESPONSABLE_MAINTENANCE: [
    ...READ_ONLY,
    'failure:report',
    'failure:manage',
    'workorder:manage',
    'workorder:approve',
    'intervention:manage',
    'preventive:complete',
    'preventive:manage',
    'sparepart:consume',
    'sparepart:adjust',
    'equipment:manage',
  ],
  LECTURE: READ_ONLY,
};

export function permissionsForRole(role: RoleCode): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: RoleCode, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
