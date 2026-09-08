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
  QUALITE: [...READ_ONLY, 'quality:inspect', 'quality:decide', 'quality:release', 'audit:read'],
  // Stock runs receptions, movements and subcontracting logistics, but can
  // never release a quality block and can never adjust stock on its own.
  STOCK: [
    ...READ_ONLY,
    'reception:create',
    'stock:transfer',
    'stock:loss',
    'subcontracting:create',
    'subcontracting:result',
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
  ],
  LECTURE: READ_ONLY,
};

export function permissionsForRole(role: RoleCode): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: RoleCode, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
