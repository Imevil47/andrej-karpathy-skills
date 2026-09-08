import type pg from 'pg';
import { withTransaction } from '../db/pool.ts';
import type { LocationStockDomain, LocationType, StockType } from '../domain/types.ts';
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
  stockDomain: LocationStockDomain;
}>;

export type CustomerRow = Readonly<{
  id: string;
  code: string;
  name: string;
  country: string | null;
  city: string | null;
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
            can_store AS "canStore", is_active AS "isActive", stock_domain AS "stockDomain"
       FROM locations
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY stock_type, code`,
    [includeInactive],
  );
  return result.rows;
}

export async function listCustomers(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly CustomerRow[]> {
  const result = await pool.query<CustomerRow>(
    `SELECT id AS "id", code AS "code", name AS "name", country AS "country", city AS "city",
            is_active AS "isActive"
       FROM customers
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY name`,
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
  stockDomain: LocationStockDomain;
}>;

export async function createLocation(pool: pg.Pool, input: LocationInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM locations WHERE code = $1', [input.code]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`L'emplacement ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO locations (code, name, stock_type, location_type, can_receive, can_store, stock_domain)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        input.code.toUpperCase(),
        input.name,
        input.stockType,
        input.locationType,
        input.canReceive,
        input.canStore,
        input.stockDomain,
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

export type CustomerInput = Readonly<{
  code: string;
  name: string;
  country: string | null;
  city: string | null;
}>;

export async function createCustomer(pool: pg.Pool, input: CustomerInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM customers WHERE code = $1', [input.code]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le client ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO customers (code, name, country, city) VALUES ($1, $2, $3, $4) RETURNING id',
      [input.code.toUpperCase(), input.name, input.country, input.city],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le client n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'customers',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type ActivationTarget =
  | 'species'
  | 'suppliers'
  | 'vessels'
  | 'locations'
  | 'subcontractors'
  | 'products'
  | 'production_lines'
  | 'production_loss_reasons'
  | 'employees'
  | 'cadence_standards'
  | 'downtime_categories'
  | 'equipment'
  | 'filling_media'
  | 'product_filling_specs'
  | 'seaming_parameters'
  | 'seaming_specifications'
  | 'sterilization_programs'
  | 'marking_verification_items'
  | 'customers';

// The table name never comes from the request: it is looked up in this map,
// keyed by a validated union.
const ACTIVATION_TABLES: Readonly<Record<ActivationTarget, string>> = {
  species: 'species',
  suppliers: 'suppliers',
  vessels: 'vessels',
  locations: 'locations',
  subcontractors: 'subcontractors',
  products: 'products',
  production_lines: 'production_lines',
  production_loss_reasons: 'production_loss_reasons',
  employees: 'employees',
  cadence_standards: 'cadence_standards',
  downtime_categories: 'downtime_categories',
  equipment: 'equipment',
  filling_media: 'filling_media',
  product_filling_specs: 'product_filling_specs',
  seaming_parameters: 'seaming_parameters',
  seaming_specifications: 'seaming_specifications',
  sterilization_programs: 'sterilization_programs',
  marking_verification_items: 'marking_verification_items',
  customers: 'customers',
};

export async function setActivation(
  pool: pg.Pool,
  target: ActivationTarget,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  const table = ACTIVATION_TABLES[target];
  // Every activatable table has a "code" column except employees (identified
  // by employee_number instead) and the two Phase 4 specification tables,
  // which have no natural business code (they are scoped by product/format,
  // not named) and fall back to their id for the audit context.
  const codeColumn =
    target === 'employees'
      ? 'employee_number'
      : target === 'product_filling_specs' || target === 'seaming_specifications'
        ? 'id'
        : 'code';
  await withTransaction(pool, async (client) => {
    const updated = await client.query<{ code: string; is_active: boolean }>(
      `UPDATE ${table} SET is_active = $2, updated_at = now()
        WHERE id = $1 RETURNING ${codeColumn} AS code, is_active`,
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

// --- Phase 2: production master data ---------------------------------------

export type ProductRow = Readonly<{
  id: string;
  code: string;
  name: string;
  speciesId: string;
  speciesCode: string;
  productFamily: string | null;
  format: string | null;
  piecesPerCan: number | null;
  isActive: boolean;
}>;

export async function listProducts(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly ProductRow[]> {
  const result = await pool.query<ProductRow>(
    `SELECT p.id AS "id", p.code AS "code", p.name AS "name",
            p.species_id AS "speciesId", s.code AS "speciesCode",
            p.product_family AS "productFamily", p.format AS "format",
            p.pieces_per_can AS "piecesPerCan", p.is_active AS "isActive"
       FROM products p
       JOIN species s ON s.id = p.species_id
      WHERE ($1::boolean IS TRUE OR p.is_active IS TRUE)
      ORDER BY p.code`,
    [includeInactive],
  );
  return result.rows;
}

export type ProductInput = Readonly<{
  code: string;
  name: string;
  speciesId: string;
  productFamily: string | null;
  format: string | null;
  piecesPerCan: number | null;
}>;

export async function createProduct(pool: pg.Pool, input: ProductInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM products WHERE code = $1', [input.code]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le produit ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO products (code, name, species_id, product_family, format, pieces_per_can)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        input.code.toUpperCase(),
        input.name,
        input.speciesId,
        input.productFamily,
        input.format,
        input.piecesPerCan,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le produit n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'products',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type ProductionLineRow = Readonly<{
  id: string;
  code: string;
  name: string;
  area: string | null;
  displayOrder: number;
  isActive: boolean;
}>;

export async function listProductionLines(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly ProductionLineRow[]> {
  const result = await pool.query<ProductionLineRow>(
    `SELECT id AS "id", code AS "code", name AS "name", area AS "area",
            display_order AS "displayOrder", is_active AS "isActive"
       FROM production_lines
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY display_order, code`,
    [includeInactive],
  );
  return result.rows;
}

export type ProductionLineInput = Readonly<{
  code: string;
  name: string;
  area: string | null;
  displayOrder: number;
}>;

export async function createProductionLine(
  pool: pg.Pool,
  input: ProductionLineInput,
  actorId: string,
) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM production_lines WHERE code = $1', [
      input.code,
    ]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`La ligne ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO production_lines (code, name, area, display_order) VALUES ($1, $2, $3, $4) RETURNING id',
      [input.code.toUpperCase(), input.name, input.area, input.displayOrder],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La ligne de production n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'production_lines',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type ProductionStageRow = Readonly<{
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}>;

export async function listProductionStages(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly ProductionStageRow[]> {
  const result = await pool.query<ProductionStageRow>(
    `SELECT id AS "id", code AS "code", name AS "name",
            display_order AS "displayOrder", is_active AS "isActive"
       FROM production_stages
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY display_order, code`,
    [includeInactive],
  );
  return result.rows;
}

export type LossReasonRow = Readonly<{
  id: string;
  code: string;
  name: string;
  outputType: string;
  isActive: boolean;
}>;

export async function listLossReasons(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly LossReasonRow[]> {
  const result = await pool.query<LossReasonRow>(
    `SELECT id AS "id", code AS "code", name AS "name",
            output_type AS "outputType", is_active AS "isActive"
       FROM production_loss_reasons
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY output_type, name`,
    [includeInactive],
  );
  return result.rows;
}

export type LossReasonInput = Readonly<{ code: string; name: string; outputType: string }>;

export async function createLossReason(pool: pg.Pool, input: LossReasonInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query(
      'SELECT id FROM production_loss_reasons WHERE code = $1',
      [input.code],
    );
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le motif ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO production_loss_reasons (code, name, output_type) VALUES ($1, $2, $3) RETURNING id',
      [input.code.toUpperCase(), input.name, input.outputType],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le motif n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'production_loss_reasons',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

// --- Phase 3: workforce master data -----------------------------------------

export type EmployeeRow = Readonly<{
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  displayName: string;
  department: string | null;
  isActive: boolean;
}>;

export async function listEmployees(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly EmployeeRow[]> {
  const result = await pool.query<EmployeeRow>(
    `SELECT id AS "id", employee_number AS "employeeNumber", first_name AS "firstName",
            last_name AS "lastName",
            COALESCE(display_name, first_name || ' ' || last_name) AS "displayName",
            department AS "department", is_active AS "isActive"
       FROM employees
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY employee_number`,
    [includeInactive],
  );
  return result.rows;
}

export type EmployeeInput = Readonly<{
  employeeNumber: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  department: string | null;
}>;

export async function createEmployee(pool: pg.Pool, input: EmployeeInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM employees WHERE employee_number = $1', [
      input.employeeNumber,
    ]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le matricule ${input.employeeNumber} existe déjà.`, {
        employeeNumber: input.employeeNumber,
      });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO employees (employee_number, first_name, last_name, display_name, department)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.employeeNumber, input.firstName, input.lastName, input.displayName, input.department],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'employée n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'employees',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type DowntimeCategoryRow = Readonly<{
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}>;

export async function listDowntimeCategories(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly DowntimeCategoryRow[]> {
  const result = await pool.query<DowntimeCategoryRow>(
    `SELECT id AS "id", code AS "code", name AS "name", is_active AS "isActive"
       FROM downtime_categories
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY name`,
    [includeInactive],
  );
  return result.rows;
}

export type DowntimeCategoryInput = Readonly<{ code: string; name: string }>;

export async function createDowntimeCategory(
  pool: pg.Pool,
  input: DowntimeCategoryInput,
  actorId: string,
) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM downtime_categories WHERE code = $1', [
      input.code,
    ]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`La catégorie ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO downtime_categories (code, name) VALUES ($1, $2) RETURNING id',
      [input.code.toUpperCase(), input.name],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La catégorie d'arrêt n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'downtime_categories',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type CadenceStandardRow = Readonly<{
  id: string;
  speciesId: string | null;
  speciesCode: string | null;
  productId: string | null;
  productCode: string | null;
  activityType: string;
  sizeGrade: string | null;
  format: string | null;
  piecesPerCan: number | null;
  measurementUnit: string;
  standardCadence: string;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}>;

export async function listCadenceStandards(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly CadenceStandardRow[]> {
  const result = await pool.query<CadenceStandardRow>(
    `SELECT cs.id AS "id", cs.species_id AS "speciesId", sp.code AS "speciesCode",
            cs.product_id AS "productId", pr.code AS "productCode",
            cs.activity_type AS "activityType", cs.size_grade AS "sizeGrade",
            cs.format AS "format", cs.pieces_per_can AS "piecesPerCan",
            cs.measurement_unit AS "measurementUnit",
            cs.standard_cadence::numeric(10,2)::text AS "standardCadence",
            cs.valid_from AS "validFrom", cs.valid_to AS "validTo", cs.is_active AS "isActive"
       FROM cadence_standards cs
       LEFT JOIN species sp ON sp.id = cs.species_id
       LEFT JOIN products pr ON pr.id = cs.product_id
      WHERE ($1::boolean IS TRUE OR cs.is_active IS TRUE)
      ORDER BY cs.activity_type, pr.code NULLS FIRST, sp.code NULLS FIRST`,
    [includeInactive],
  );
  return result.rows;
}

export type CadenceStandardInput = Readonly<{
  speciesId: string | null;
  productId: string | null;
  activityType: string;
  format: string | null;
  piecesPerCan: number | null;
  measurementUnit: string;
  standardCadence: string;
  validFrom: string | null;
  validTo: string | null;
}>;

export async function createCadenceStandard(
  pool: pg.Pool,
  input: CadenceStandardInput,
  actorId: string,
) {
  return withTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO cadence_standards (species_id, product_id, activity_type, format,
                                      pieces_per_can, measurement_unit, standard_cadence,
                                      valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.speciesId,
        input.productId,
        input.activityType,
        input.format,
        input.piecesPerCan,
        input.measurementUnit,
        input.standardCadence,
        input.validFrom,
        input.validTo,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le standard de cadence n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'CADENCE_STANDARD_CREATION',
      entityType: 'cadence_standards',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

// --- Phase 4: equipment, filling, seaming and marking master data ---------

export type EquipmentRow = Readonly<{
  id: string;
  code: string;
  name: string;
  equipmentType: string;
  locationId: string | null;
  locationCode: string | null;
  isActive: boolean;
}>;

export async function listEquipment(
  pool: pg.Pool,
  includeInactive: boolean,
  equipmentType: string | null,
): Promise<readonly EquipmentRow[]> {
  const result = await pool.query<EquipmentRow>(
    `SELECT e.id AS "id", e.code AS "code", e.name AS "name",
            e.equipment_type AS "equipmentType", e.location_id AS "locationId",
            l.code AS "locationCode", e.is_active AS "isActive"
       FROM equipment e
       LEFT JOIN locations l ON l.id = e.location_id
      WHERE ($1::boolean IS TRUE OR e.is_active IS TRUE)
        AND ($2::text IS NULL OR e.equipment_type = $2)
      ORDER BY e.equipment_type, e.code`,
    [includeInactive, equipmentType],
  );
  return result.rows;
}

export type EquipmentInput = Readonly<{
  code: string;
  name: string;
  equipmentType: string;
  locationId: string | null;
}>;

export async function createEquipment(pool: pg.Pool, input: EquipmentInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM equipment WHERE code = $1', [input.code]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`L'équipement ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO equipment (code, name, equipment_type, location_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.code.toUpperCase(), input.name, input.equipmentType, input.locationId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'équipement n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'equipment',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type FillingMediumRow = Readonly<{ id: string; code: string; name: string; isActive: boolean }>;

export async function listFillingMedia(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly FillingMediumRow[]> {
  const result = await pool.query<FillingMediumRow>(
    `SELECT id AS "id", code AS "code", name AS "name", is_active AS "isActive"
       FROM filling_media
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY name`,
    [includeInactive],
  );
  return result.rows;
}

export type FillingMediumInput = Readonly<{ code: string; name: string }>;

export async function createFillingMedium(
  pool: pg.Pool,
  input: FillingMediumInput,
  actorId: string,
) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM filling_media WHERE code = $1', [
      input.code,
    ]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le milieu de couverture ${input.code} existe déjà.`, {
        code: input.code,
      });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO filling_media (code, name) VALUES ($1, $2) RETURNING id',
      [input.code.toUpperCase(), input.name],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le milieu de couverture n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'filling_media',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type FillingSpecRow = Readonly<{
  id: string;
  productId: string;
  productCode: string;
  format: string | null;
  piecesPerCan: number | null;
  targetNetWeightG: string | null;
  minWeightG: string;
  maxWeightG: string;
  targetFishWeightG: string | null;
  targetMediumWeightG: string | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}>;

export async function listFillingSpecs(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly FillingSpecRow[]> {
  const result = await pool.query<FillingSpecRow>(
    `SELECT s.id AS "id", s.product_id AS "productId", p.code AS "productCode",
            s.format AS "format", s.pieces_per_can AS "piecesPerCan",
            s.target_net_weight_g::text AS "targetNetWeightG",
            s.min_weight_g::text AS "minWeightG", s.max_weight_g::text AS "maxWeightG",
            s.target_fish_weight_g::text AS "targetFishWeightG",
            s.target_medium_weight_g::text AS "targetMediumWeightG",
            s.valid_from AS "validFrom", s.valid_to AS "validTo", s.is_active AS "isActive"
       FROM product_filling_specs s
       JOIN products p ON p.id = s.product_id
      WHERE ($1::boolean IS TRUE OR s.is_active IS TRUE)
      ORDER BY p.code, s.format NULLS FIRST`,
    [includeInactive],
  );
  return result.rows;
}

export type FillingSpecInput = Readonly<{
  productId: string;
  format: string | null;
  piecesPerCan: number | null;
  targetNetWeightG: string | null;
  minWeightG: string;
  maxWeightG: string;
  targetFishWeightG: string | null;
  targetMediumWeightG: string | null;
  validFrom: string | null;
  validTo: string | null;
}>;

export async function createFillingSpec(pool: pg.Pool, input: FillingSpecInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO product_filling_specs (product_id, format, pieces_per_can, target_net_weight_g,
                                          min_weight_g, max_weight_g, target_fish_weight_g,
                                          target_medium_weight_g, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        input.productId,
        input.format,
        input.piecesPerCan,
        input.targetNetWeightG,
        input.minWeightG,
        input.maxWeightG,
        input.targetFishWeightG,
        input.targetMediumWeightG,
        input.validFrom,
        input.validTo,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La spécification de remplissage n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'product_filling_specs',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type SeamingParameterRow = Readonly<{
  id: string;
  code: string;
  name: string;
  defaultUnit: string;
  isActive: boolean;
}>;

export async function listSeamingParameters(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly SeamingParameterRow[]> {
  const result = await pool.query<SeamingParameterRow>(
    `SELECT id AS "id", code AS "code", name AS "name", default_unit AS "defaultUnit",
            is_active AS "isActive"
       FROM seaming_parameters
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY name`,
    [includeInactive],
  );
  return result.rows;
}

export type SeamingParameterInput = Readonly<{ code: string; name: string; defaultUnit: string }>;

export async function createSeamingParameter(
  pool: pg.Pool,
  input: SeamingParameterInput,
  actorId: string,
) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM seaming_parameters WHERE code = $1', [
      input.code,
    ]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le paramètre de sertissage ${input.code} existe déjà.`, {
        code: input.code,
      });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO seaming_parameters (code, name, default_unit) VALUES ($1, $2, $3) RETURNING id',
      [input.code.toUpperCase(), input.name, input.defaultUnit],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le paramètre de sertissage n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'seaming_parameters',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type SeamingSpecRow = Readonly<{
  id: string;
  seamingParameterId: string;
  parameterName: string;
  productId: string | null;
  productCode: string | null;
  format: string | null;
  minValue: string | null;
  maxValue: string | null;
  targetValue: string | null;
  unit: string;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}>;

export async function listSeamingSpecs(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly SeamingSpecRow[]> {
  const result = await pool.query<SeamingSpecRow>(
    `SELECT s.id AS "id", s.seaming_parameter_id AS "seamingParameterId",
            sp.name AS "parameterName", s.product_id AS "productId", p.code AS "productCode",
            s.format AS "format", s.min_value::text AS "minValue", s.max_value::text AS "maxValue",
            s.target_value::text AS "targetValue", s.unit AS "unit",
            s.valid_from AS "validFrom", s.valid_to AS "validTo", s.is_active AS "isActive"
       FROM seaming_specifications s
       JOIN seaming_parameters sp ON sp.id = s.seaming_parameter_id
       LEFT JOIN products p ON p.id = s.product_id
      WHERE ($1::boolean IS TRUE OR s.is_active IS TRUE)
      ORDER BY sp.name, p.code NULLS FIRST`,
    [includeInactive],
  );
  return result.rows;
}

export type SeamingSpecInput = Readonly<{
  seamingParameterId: string;
  productId: string | null;
  format: string | null;
  minValue: string | null;
  maxValue: string | null;
  targetValue: string | null;
  unit: string;
  validFrom: string | null;
  validTo: string | null;
}>;

export async function createSeamingSpec(pool: pg.Pool, input: SeamingSpecInput, actorId: string) {
  return withTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO seaming_specifications (seaming_parameter_id, product_id, format, min_value,
                                           max_value, target_value, unit, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.seamingParameterId,
        input.productId,
        input.format,
        input.minValue,
        input.maxValue,
        input.targetValue,
        input.unit,
        input.validFrom,
        input.validTo,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La spécification de sertissage n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'seaming_specifications',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type SterilizationProgramRow = Readonly<{
  id: string;
  code: string;
  name: string;
  productId: string | null;
  productCode: string | null;
  format: string | null;
  targetTemperatureC: string | null;
  targetPressureBar: string | null;
  targetF0: string | null;
  minimumF0: string | null;
  maximumF0: string | null;
  holdingTimeSeconds: number | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}>;

export async function listSterilizationPrograms(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly SterilizationProgramRow[]> {
  const result = await pool.query<SterilizationProgramRow>(
    `SELECT sp.id AS "id", sp.code AS "code", sp.name AS "name", sp.product_id AS "productId",
            p.code AS "productCode", sp.format AS "format",
            sp.target_temperature_c::text AS "targetTemperatureC",
            sp.target_pressure_bar::text AS "targetPressureBar",
            sp.target_f0::text AS "targetF0", sp.minimum_f0::text AS "minimumF0",
            sp.maximum_f0::text AS "maximumF0", sp.holding_time_seconds AS "holdingTimeSeconds",
            sp.valid_from AS "validFrom", sp.valid_to AS "validTo", sp.is_active AS "isActive"
       FROM sterilization_programs sp
       LEFT JOIN products p ON p.id = sp.product_id
      WHERE ($1::boolean IS TRUE OR sp.is_active IS TRUE)
      ORDER BY sp.code`,
    [includeInactive],
  );
  return result.rows;
}

export type SterilizationProgramInput = Readonly<{
  code: string;
  name: string;
  productId: string | null;
  format: string | null;
  targetTemperatureC: string | null;
  targetPressureBar: string | null;
  targetF0: string | null;
  minimumF0: string | null;
  maximumF0: string | null;
  holdingTimeSeconds: number | null;
  validFrom: string | null;
  validTo: string | null;
}>;

export async function createSterilizationProgram(
  pool: pg.Pool,
  input: SterilizationProgramInput,
  actorId: string,
) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM sterilization_programs WHERE code = $1', [
      input.code,
    ]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le programme de stérilisation ${input.code} existe déjà.`, {
        code: input.code,
      });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sterilization_programs (code, name, product_id, format, target_temperature_c,
                                           target_pressure_bar, target_f0, minimum_f0, maximum_f0,
                                           holding_time_seconds, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        input.code.toUpperCase(),
        input.name,
        input.productId,
        input.format,
        input.targetTemperatureC,
        input.targetPressureBar,
        input.targetF0,
        input.minimumF0,
        input.maximumF0,
        input.holdingTimeSeconds,
        input.validFrom,
        input.validTo,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le programme de stérilisation n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'sterilization_programs',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type MarkingVerificationItemRow = Readonly<{
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}>;

export async function listMarkingVerificationItems(
  pool: pg.Pool,
  includeInactive: boolean,
): Promise<readonly MarkingVerificationItemRow[]> {
  const result = await pool.query<MarkingVerificationItemRow>(
    `SELECT id AS "id", code AS "code", name AS "name", is_active AS "isActive"
       FROM marking_verification_items
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY name`,
    [includeInactive],
  );
  return result.rows;
}

export type MarkingVerificationItemInput = Readonly<{ code: string; name: string }>;

export async function createMarkingVerificationItem(
  pool: pg.Pool,
  input: MarkingVerificationItemInput,
  actorId: string,
) {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query(
      'SELECT id FROM marking_verification_items WHERE code = $1',
      [input.code],
    );
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le point de vérification ${input.code} existe déjà.`, {
        code: input.code,
      });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO marking_verification_items (code, name) VALUES ($1, $2) RETURNING id',
      [input.code.toUpperCase(), input.name],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le point de vérification n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'marking_verification_items',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}
