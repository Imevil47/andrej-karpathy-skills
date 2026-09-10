import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { IngredientQualityStatus, IngredientUnit } from '../domain/types.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';

// Ingredients are traceable production materials (section 2), entirely
// separate from the Phase 1 raw-fish stock engine: their own master data,
// their own lot identity, their own ledger (services/ingredientStock.ts).

export type IngredientTypeRow = Readonly<{ id: string; code: string; name: string; isActive: boolean }>;

export async function listIngredientTypes(pool: pg.Pool, includeInactive: boolean): Promise<readonly IngredientTypeRow[]> {
  const result = await pool.query<IngredientTypeRow>(
    `SELECT id AS "id", code AS "code", name AS "name", is_active AS "isActive"
       FROM ingredient_types
      WHERE ($1::boolean IS TRUE OR is_active IS TRUE)
      ORDER BY code`,
    [includeInactive],
  );
  return result.rows;
}

export async function createIngredientType(
  pool: pg.Pool,
  input: Readonly<{ code: string; name: string }>,
  actorId: string,
): Promise<{ id: string }> {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM ingredient_types WHERE code = $1', [input.code]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le type d'ingrédient ${input.code} existe déjà.`, { code: input.code });
    }
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO ingredient_types (code, name) VALUES ($1, $2) RETURNING id',
      [input.code.toUpperCase(), input.name],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le type d'ingrédient n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'ingredient_types',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type Ingredient = Readonly<{
  id: string;
  ingredientCode: string;
  name: string;
  ingredientTypeId: string;
  defaultUnit: IngredientUnit;
  fillingMediumId: string | null;
  requiresLotTraceability: boolean;
  isRecoverable: boolean;
  isActive: boolean;
}>;

export async function requireIngredient(client: DatabaseClient, id: string): Promise<Ingredient> {
  const result = await client.query<{
    id: string;
    ingredient_code: string;
    name: string;
    ingredient_type_id: string;
    default_unit: IngredientUnit;
    filling_medium_id: string | null;
    requires_lot_traceability: boolean;
    is_recoverable: boolean;
    is_active: boolean;
  }>(
    `SELECT id, ingredient_code, name, ingredient_type_id, default_unit, filling_medium_id,
            requires_lot_traceability, is_recoverable, is_active
       FROM ingredients WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Ingrédient', id);
  }
  return {
    id: row.id,
    ingredientCode: row.ingredient_code,
    name: row.name,
    ingredientTypeId: row.ingredient_type_id,
    defaultUnit: row.default_unit,
    fillingMediumId: row.filling_medium_id,
    requiresLotTraceability: row.requires_lot_traceability,
    isRecoverable: row.is_recoverable,
    isActive: row.is_active,
  };
}

export type IngredientRow = Ingredient & Readonly<{ ingredientTypeName: string; fillingMediumCode: string | null }>;

export async function listIngredients(pool: pg.Pool, includeInactive: boolean): Promise<readonly IngredientRow[]> {
  const result = await pool.query<IngredientRow>(
    `SELECT i.id AS "id", i.ingredient_code AS "ingredientCode", i.name AS "name",
            i.ingredient_type_id AS "ingredientTypeId", t.name AS "ingredientTypeName",
            i.default_unit AS "defaultUnit", i.filling_medium_id AS "fillingMediumId",
            fm.code AS "fillingMediumCode", i.requires_lot_traceability AS "requiresLotTraceability",
            i.is_recoverable AS "isRecoverable", i.is_active AS "isActive"
       FROM ingredients i
       JOIN ingredient_types t ON t.id = i.ingredient_type_id
       LEFT JOIN filling_media fm ON fm.id = i.filling_medium_id
      WHERE ($1::boolean IS TRUE OR i.is_active IS TRUE)
      ORDER BY t.code, i.name`,
    [includeInactive],
  );
  return result.rows;
}

export type CreateIngredientInput = Readonly<{
  ingredientCode: string;
  name: string;
  ingredientTypeId: string;
  defaultUnit: IngredientUnit;
  fillingMediumId: string | null;
  requiresLotTraceability: boolean;
  isRecoverable: boolean;
}>;

export async function createIngredient(pool: pg.Pool, input: CreateIngredientInput, actorId: string): Promise<{ id: string }> {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM ingredients WHERE ingredient_code = $1', [input.ingredientCode]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`L'ingrédient ${input.ingredientCode} existe déjà.`, { code: input.ingredientCode });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ingredients (ingredient_code, name, ingredient_type_id, default_unit, filling_medium_id,
                                requires_lot_traceability, is_recoverable)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        input.ingredientCode.toUpperCase(),
        input.name,
        input.ingredientTypeId,
        input.defaultUnit,
        input.fillingMediumId,
        input.requiresLotTraceability,
        input.isRecoverable,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'ingrédient n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'MASTERDATA_CREATION',
      entityType: 'ingredients',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type IngredientLot = Readonly<{
  id: string;
  lotCode: string;
  ingredientId: string;
  qualityStatus: IngredientQualityStatus;
}>;

export async function requireIngredientLot(client: DatabaseClient, id: string): Promise<IngredientLot> {
  const result = await client.query<{ id: string; lot_code: string; ingredient_id: string; quality_status: IngredientQualityStatus }>(
    'SELECT id, lot_code, ingredient_id, quality_status FROM ingredient_lots WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Lot ingrédient', id);
  }
  return { id: row.id, lotCode: row.lot_code, ingredientId: row.ingredient_id, qualityStatus: row.quality_status };
}

/** Blocked/rejected/under-review ingredient lots may never feed a tank or a
 * Run (section 66): the same principle as Phase 1's blocked raw-material
 * lots, checked before any outgoing movement is created. */
export function assertIngredientLotAvailableForUse(lot: IngredientLot): void {
  if (lot.qualityStatus !== 'LIBERE') {
    throw conflictError(
      `Le lot ${lot.lotCode} n'est pas disponible à l'utilisation (statut qualité : ${lot.qualityStatus}).`,
      { lotId: lot.id, qualityStatus: lot.qualityStatus },
    );
  }
}

export type CreateIngredientLotInput = Readonly<{
  lotCode: string;
  ingredientId: string;
  supplierId: string | null;
  supplierLotCode: string | null;
  receivedAt: Date | null;
  manufactureDate: string | null;
  expiryDate: string | null;
  notes: string | null;
}>;

export async function createIngredientLot(
  pool: pg.Pool,
  input: CreateIngredientLotInput,
  actorId: string,
): Promise<IngredientLot> {
  return withTransaction(pool, async (client) => {
    const duplicate = await client.query('SELECT id FROM ingredient_lots WHERE lot_code = $1', [input.lotCode]);
    if (duplicate.rows.length > 0) {
      throw conflictError(`Le lot ${input.lotCode} existe déjà.`, { lotCode: input.lotCode });
    }
    const inserted = await client.query<{ id: string; quality_status: IngredientQualityStatus }>(
      `INSERT INTO ingredient_lots (lot_code, ingredient_id, supplier_id, supplier_lot_code, received_at,
                                    manufacture_date, expiry_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, quality_status`,
      [
        input.lotCode.toUpperCase(),
        input.ingredientId,
        input.supplierId,
        input.supplierLotCode,
        input.receivedAt,
        input.manufactureDate,
        input.expiryDate,
        input.notes,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Le lot ingrédient n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'INGREDIENT_LOT_CREATION',
      entityType: 'ingredient_lots',
      entityId: row.id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id: row.id, lotCode: input.lotCode.toUpperCase(), ingredientId: input.ingredientId, qualityStatus: row.quality_status };
  });
}

/** Ingredient lot quality (section 9): its own status column, updated only
 * through this function so every change is audited - the same discipline
 * as a raw-material lot block/release, without forcing ingredients through
 * a table that is not polymorphic (see migration 032's comment). */
export async function updateIngredientLotQualityStatus(
  pool: pg.Pool,
  lotId: string,
  status: IngredientQualityStatus,
  reason: string,
  actorId: string,
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const lot = await requireIngredientLot(client, lotId);
    if (lot.qualityStatus === status) {
      return;
    }
    await client.query('UPDATE ingredient_lots SET quality_status = $2, updated_at = now() WHERE id = $1', [
      lotId,
      status,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'INGREDIENT_LOT_QUALITY_STATUS',
      entityType: 'ingredient_lots',
      entityId: lotId,
      oldValues: { qualityStatus: lot.qualityStatus },
      newValues: { qualityStatus: status, reason },
      context: null,
    });
  });
}

export type IngredientLotRow = Readonly<{
  id: string;
  lotCode: string;
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierLotCode: string | null;
  receivedAt: Date | null;
  manufactureDate: string | null;
  expiryDate: string | null;
  qualityStatus: IngredientQualityStatus;
}>;

export async function listIngredientLots(
  pool: pg.Pool,
  filters: Readonly<{ ingredientId: string | null; qualityStatus: IngredientQualityStatus | null }>,
): Promise<readonly IngredientLotRow[]> {
  const result = await pool.query<IngredientLotRow>(
    `SELECT l.id AS "id", l.lot_code AS "lotCode", l.ingredient_id AS "ingredientId",
            i.ingredient_code AS "ingredientCode", i.name AS "ingredientName",
            l.supplier_id AS "supplierId", s.name AS "supplierName", l.supplier_lot_code AS "supplierLotCode",
            l.received_at AS "receivedAt", l.manufacture_date AS "manufactureDate", l.expiry_date AS "expiryDate",
            l.quality_status AS "qualityStatus"
       FROM ingredient_lots l
       JOIN ingredients i ON i.id = l.ingredient_id
       LEFT JOIN suppliers s ON s.id = l.supplier_id
      WHERE ($1::uuid IS NULL OR l.ingredient_id = $1)
        AND ($2::text IS NULL OR l.quality_status = $2)
      ORDER BY l.received_at DESC NULLS LAST, l.created_at DESC`,
    [filters.ingredientId, filters.qualityStatus],
  );
  return result.rows;
}

export async function getIngredientLotDetail(pool: pg.Pool, id: string): Promise<IngredientLotRow> {
  const result = await pool.query<IngredientLotRow>(
    `SELECT l.id AS "id", l.lot_code AS "lotCode", l.ingredient_id AS "ingredientId",
            i.ingredient_code AS "ingredientCode", i.name AS "ingredientName",
            l.supplier_id AS "supplierId", s.name AS "supplierName", l.supplier_lot_code AS "supplierLotCode",
            l.received_at AS "receivedAt", l.manufacture_date AS "manufactureDate", l.expiry_date AS "expiryDate",
            l.quality_status AS "qualityStatus"
       FROM ingredient_lots l
       JOIN ingredients i ON i.id = l.ingredient_id
       LEFT JOIN suppliers s ON s.id = l.supplier_id
      WHERE l.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Lot ingrédient', id);
  }
  return row;
}
