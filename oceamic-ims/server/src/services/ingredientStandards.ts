import type pg from 'pg';
import { withTransaction } from '../db/pool.ts';
import { compareToStandard, consumptionPer1000Units, type StandardComparisonStatus } from '../domain/types.ts';
import { validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';

// CONSUMPTION STANDARD is an expected process usage reference (section
// 75), distinct from the actual consumption it is later compared against -
// never invented (section 40), always configured.

export type CreateStandardInput = Readonly<{
  ingredientId: string;
  productId: string | null;
  format: string | null;
  fillingMediumId: string | null;
  targetPer1000Units: string;
  minPer1000Units: string | null;
  maxPer1000Units: string | null;
  validFrom: string;
  validTo: string | null;
}>;

export async function createIngredientConsumptionStandard(
  pool: pg.Pool,
  input: CreateStandardInput,
  actorId: string,
): Promise<{ id: string }> {
  if (Number(input.targetPer1000Units) <= 0) {
    throw validationError('La valeur cible doit être strictement positive.', { target: input.targetPer1000Units });
  }
  return withTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ingredient_consumption_standards
           (ingredient_id, product_id, format, filling_medium_id, target_per_1000_units, min_per_1000_units,
            max_per_1000_units, valid_from, valid_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        input.ingredientId,
        input.productId,
        input.format,
        input.fillingMediumId,
        input.targetPer1000Units,
        input.minPer1000Units,
        input.maxPer1000Units,
        input.validFrom,
        input.validTo,
        actorId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le standard de consommation n'a pas pu être créé.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'INGREDIENT_STANDARD_CREATION',
      entityType: 'ingredient_consumption_standards',
      entityId: id,
      oldValues: null,
      newValues: { ...input },
      context: null,
    });
    return { id };
  });
}

export type IngredientStandardRow = Readonly<{
  id: string;
  ingredientId: string;
  ingredientCode: string;
  productId: string | null;
  productCode: string | null;
  format: string | null;
  targetPer1000Units: string;
  minPer1000Units: string | null;
  maxPer1000Units: string | null;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
}>;

export async function listIngredientConsumptionStandards(pool: pg.Pool, ingredientId: string | null): Promise<readonly IngredientStandardRow[]> {
  const result = await pool.query<IngredientStandardRow>(
    `SELECT s.id AS "id", s.ingredient_id AS "ingredientId", i.ingredient_code AS "ingredientCode",
            s.product_id AS "productId", p.code AS "productCode", s.format AS "format",
            s.target_per_1000_units::text AS "targetPer1000Units", s.min_per_1000_units::text AS "minPer1000Units",
            s.max_per_1000_units::text AS "maxPer1000Units", s.valid_from::text AS "validFrom",
            s.valid_to::text AS "validTo", s.is_active AS "isActive"
       FROM ingredient_consumption_standards s
       JOIN ingredients i ON i.id = s.ingredient_id
       LEFT JOIN products p ON p.id = s.product_id
      WHERE ($1::uuid IS NULL OR s.ingredient_id = $1)
      ORDER BY i.ingredient_code, s.valid_from DESC`,
    [ingredientId],
  );
  return result.rows;
}

/**
 * Picks the most specific active standard for a given ingredient/product/
 * format valid at a date (section 41): a product+format match outranks a
 * product-only match, which outranks a purely ingredient-level standard.
 * Returns null - never a fabricated one - when nothing applies.
 */
export async function findApplicableStandard(
  pool: pg.Pool,
  input: Readonly<{ ingredientId: string; productId: string | null; format: string | null; atDate: string }>,
): Promise<Readonly<{ targetPer1000: number; minPer1000: number | null; maxPer1000: number | null }> | null> {
  const result = await pool.query<{ target: string; min_value: string | null; max_value: string | null }>(
    `SELECT target_per_1000_units AS target, min_per_1000_units AS min_value, max_per_1000_units AS max_value
       FROM ingredient_consumption_standards
      WHERE ingredient_id = $1 AND is_active
        AND valid_from <= $4::date AND (valid_to IS NULL OR valid_to >= $4::date)
        AND (product_id IS NULL OR product_id = $2)
        AND (format IS NULL OR format = $3)
      ORDER BY (product_id IS NOT NULL) DESC, (format IS NOT NULL) DESC
      LIMIT 1`,
    [input.ingredientId, input.productId, input.format, input.atDate],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    targetPer1000: Number(row.target),
    minPer1000: row.min_value === null ? null : Number(row.min_value),
    maxPer1000: row.max_value === null ? null : Number(row.max_value),
  };
}

export type ActualVsStandard = Readonly<{
  actualPer1000: number | null;
  standard: Readonly<{ targetPer1000: number; minPer1000: number | null; maxPer1000: number | null }> | null;
  // null when no cans have been produced yet: there is no actual figure to
  // compare, a different fact from "no standard is configured"
  // (STANDARD_NON_DEFINI), so the two are never conflated.
  status: StandardComparisonStatus | null;
}>;

export async function compareConsumptionToStandard(
  pool: pg.Pool,
  input: Readonly<{ ingredientId: string; productId: string | null; format: string | null; atDate: string; quantity: number; unitsProduced: number }>,
): Promise<ActualVsStandard> {
  const standard = await findApplicableStandard(pool, input);
  const actualPer1000 = consumptionPer1000Units(input.quantity, input.unitsProduced);
  const status = actualPer1000 === null ? null : compareToStandard(actualPer1000, standard);
  return { actualPer1000, standard, status };
}
