import type pg from 'pg';
import { withTransaction } from '../db/pool.ts';
import type { LocationType, StockType } from '../domain/types.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';

// Master data is never deleted: records are deactivated so that historical
// operations keep pointing at a valid reference.

export type SpeciesRow = Readonly<{ id: string; code: string; name: string; isActive: boolean }>;

export type SupplierRow = Readonly<{
  id: string;
  code: string;
  name: string;
  country: string | null;
  isActive: boolean;
}>;

export type VesselRow = Readonly<{
  id: string;
  code: string;
  name: string;
  registration: string | null;
  isActive: boolean;
}>;

export type LocationRow = Readonly<{
  id: string;
  code: string;
  name: string;
  stockType: StockType;
  locationType: LocationType;
  canReceive: boolean;
  canStore: boolean;
  isActive: boolean;
}>;

export type SubcontractorRow = Readonly<{
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  locationId: string;
  locationCode: string;
}>;

export async function listSpecies(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly SpeciesRow[]> {
  const result = await pool.query<SpeciesRow>(
    `SELECT id AS "id", code AS "code", name AS "name", is_active AS "isActive"
       FROM species
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY code`,
    [includeInactive],
  );
  return result.rows;
}

export async function listSuppliers(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly SupplierRow[]> {
  const result = await pool.query<SupplierRow>(
    `SELECT id AS "id", code AS "code", name AS "name", country AS "country", is_active AS "isActive"
       FROM suppliers
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY name`,
    [includeInactive],
  );
  return result.rows;
}

export async function listVessels(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly VesselRow[]> {
  const result = await pool.query<VesselRow>(
    `SELECT id AS "id", code AS "code", name AS "name", registration AS "registration",
            is_active AS "isActive"
       FROM vessels
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY name`,
    [includeInactive],
  );
  return result.rows;
}

export async function listLocations(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly LocationRow[]> {
  const result = await pool.query<LocationRow>(
    `SELECT id AS "id", code AS "code", name AS "name", stock_type AS "stockType",
            location_type AS "locationType", can_receive AS "canReceive",
            can_store AS "canStore", is_active AS "isActive"
       FROM locations
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY stock_type, code`,
    [includeInactive],
  );
  return result.rows;
}

export async function listSubcontractors(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly SubcontractorRow[]> {
  const result = await pool.query<SubcontractorRow>(
    `SELECT s.id AS "id", s.code AS "code", s.name AS "name", s.is_active AS "isActive",
            l.id AS "locationId", l.code AS "locationCode"
       FROM subcontractors s
       JOIN locations l ON l.id = s.location_id
      WHERE ($1::boolean IS TRUE OR s.is_active IS TRUE)
      ORDER BY s.name`,
    [includeInactive],
  );
  return result.rows;
}

export type SpeciesInput = Readonly<{ code: string; name: string }>;

export async function createSpecies(pool: pg.Pool, input: SpeciesInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM species WHERE code = $1', [input.code]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`L'espèce ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO species (code, name) VALUES ($1, $2) RETURNING id',
      [input.code.toUpperCase(), input.name],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'espèce n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'species',
      entityId: id,
      oldValues: null,
      newValues: { code: input.code, name: input.name },
      context: null,
    });
    return { id };
  });
}

export type LocationInput = Readonly<{
  code: string;
  name: string;
  stockType: StockType;
  locationType: LocationType;
  canReceive: boolean;
  canStore: boolean;
}>;

export async function createLocation(pool: pg.Pool, input: LocationInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM locations WHERE code = $1', [input.code]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`L'emplacement ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO locations (code, name, stock_type, location_type, can_receive, can_store)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        input.code.toUpperCase(),
        input.name,
        input.stockType,
        input.locationType,
        input.canReceive,
        input.canStore,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'emplacement n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'locations',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type ActivationTarget = 'species' | 'suppliers' | 'vessels' | 'locations' | 'subcontractors';

const ACTIVATION_TABLES: Readonly<Record<ActivationTarget, string>> = {
  species: 'species',
  suppliers: 'suppliers',
  vessels: 'vessels',
  locations: 'locations',
  subcontractors: 'subcontractors',
};

export async function setActivation(
  pool: pg.Pool,
  target: ActivationTarget,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  const table = ACTIVATION_TABLES[target];
  await withTransaction(pool, async (client) => {
    const updated = await client.query<{ code: string; is_active: boolean }>(
      `UPDATE ${table} SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING code, is_active`,
      [id, isActive],
    );
    const row = updated.rows[0];
    if (!row) {
      throw notFoundError('Enregistrement', id);
    }
    await recordAudit(client, {
      userId: actorId,
      action: isActive ? 'MASTERDATA_ACTIVATION' : 'MASTERDATA_DESACTIVATION',
      entityType: table,
      entityId: id,
      oldValues: { isActive: !isActive },
      newValues: { isActive },
      context: { code: row.code },
    });
  });
}

export type SupplierInput = Readonly<{ code: string; name: string; country: string | null }>;

export async function createSupplier(pool: pg.Pool, input: SupplierInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM suppliers WHERE code = $1', [input.code]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le fournisseur ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO suppliers (code, name, country) VALUES ($1, $2, $3) RETURNING id',
      [input.code.toUpperCase(), input.name, input.country],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le fournisseur n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'suppliers',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type VesselInput = Readonly<{ code: string; name: string; registration: string | null }>;

export async function createVessel(pool: pg.Pool, input: VesselInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM vessels WHERE code = $1', [input.code]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le bateau ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO vessels (code, name, registration) VALUES ($1, $2, $3) RETURNING id',
      [input.code.toUpperCase(), input.name, input.registration],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le bateau n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'vessels',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type SubcontractorInput = Readonly<{ code: string; name: string; locationId: string }>;

/**
 * A subcontractor is always attached to one external stock location: material
 * held by the subcontractor stays visible in the single inventory engine.
 */
export async function createSubcontractor(
  pool: pg.Pool,
  input: SubcontractorInput,
  actorId: string,
) {
  return withTransaction(pool, async (client) => {
    const location = await client.query<{ stock_type: StockType }>(
      'SELECT stock_type FROM locations WHERE id = $1',
      [input.locationId],
    );
    const stockType = location.rows[0]?.stock_type;
    if (!stockType) {
      throw notFoundError('Emplacement', input.locationId);
    }
    if (stockType !== 'EXTERNE') {
      throw conflictError(
        "L'emplacement d'un sous-traitant doit être configuré en stock EXTERNE.",
        { locationId: input.locationId, stockType },
      );
    }
    const duplicate = await client.query('SELECT id FROM subcontractors WHERE code = $1', [
      input.code,
    ]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le sous-traitant ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO subcontractors (code, name, location_id) VALUES ($1, $2, $3) RETURNING id',
      [input.code.toUpperCase(), input.name, input.locationId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le sous-traitant n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'subcontractors',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}
