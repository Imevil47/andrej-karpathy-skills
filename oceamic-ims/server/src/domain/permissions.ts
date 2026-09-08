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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: readonly Permission[] = [
  'masterdata:read',
  'stock:read',
  'subcontracting:read',
  'quality:read',
  'traceability:read',
  'production:read',
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
  ],
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
  ],
  LECTURE: READ_ONLY,
};

export function permissionsForRole(role: RoleCode): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: RoleCode, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
