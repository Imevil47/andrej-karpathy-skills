import type pg from 'pg';

// Cross-cutting Ingredients read models: home KPIs and the per-Run
// ingredient material balance (sections 37-39/48). Every figure is derived
// from the ledger/event tables already written by the other Phase 8
// services, never a separately typed total.

export type IngredientHomeSummary = Readonly<{
  oilStockLiters: number;
  blockedLots: number;
  recoveredOilAvailable: number;
  recoveredOilExpiringSoon: number;
  runsWithUnexplainedDifference: number;
}>;

/** Section 48: five focused counts, no decorative analytics. "Huile" scope
 * is every ingredient whose type code starts with HUILE - a data-driven
 * filter, never a hardcoded ingredient id. */
export async function ingredientHomeSummary(pool: pg.Pool): Promise<IngredientHomeSummary> {
  const result = await pool.query<{
    oil_stock: string;
    blocked_lots: string;
    recovered_available: string;
    recovered_expiring_soon: string;
  }>(
    `SELECT
        (SELECT COALESCE(SUM(s.quantity), 0) FROM current_ingredient_stock_by_lot s
           JOIN ingredient_lots l ON l.id = s.ingredient_lot_id
           JOIN ingredients i ON i.id = l.ingredient_id
           JOIN ingredient_types t ON t.id = i.ingredient_type_id
          WHERE t.code LIKE 'HUILE%')::text AS oil_stock,
        (SELECT COUNT(*) FROM ingredient_lots WHERE quality_status = 'BLOQUE')::text AS blocked_lots,
        (SELECT COUNT(*) FROM recovered_batch_status WHERE effective_status IN ('DISPONIBLE', 'UTILISE_PARTIELLEMENT'))::text
            AS recovered_available,
        (SELECT COUNT(*) FROM recovered_ingredient_batches b
           JOIN recovered_batch_status s ON s.recovered_batch_id = b.id
          WHERE s.effective_status IN ('DISPONIBLE', 'UTILISE_PARTIELLEMENT')
            AND b.reuse_deadline <= now() + interval '24 hours')::text AS recovered_expiring_soon`,
  );
  const row = result.rows[0];
  const runsWithUnexplainedDifference = await countRunsWithUnexplainedDifference(pool);
  return {
    oilStockLiters: Number(row?.oil_stock ?? '0'),
    blockedLots: Number(row?.blocked_lots ?? '0'),
    recoveredOilAvailable: Number(row?.recovered_available ?? '0'),
    recoveredOilExpiringSoon: Number(row?.recovered_expiring_soon ?? '0'),
    runsWithUnexplainedDifference,
  };
}

export type RunIngredientBalance = Readonly<{
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  suppliedQuantity: number;
  consumedQuantity: number;
  recoveredQuantity: number;
  lossQuantity: number;
  difference: number;
  unit: string;
  toleranceExceeded: boolean;
}>;

// A difference within this fraction of the consumed quantity is treated as
// ordinary measurement slack, never displayed as "to justify" (section
// 38). Centralized here rather than repeated per screen.
const MATERIAL_BALANCE_TOLERANCE_RATIO = 0.02;

/** Runs (last 30 days) whose ingredient balance exceeds tolerance - the
 * home KPI's "Écarts à justifier" (section 48), same formula and tolerance
 * as runIngredientMaterialBalance, applied across every recent Run. */
async function countRunsWithUnexplainedDifference(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `WITH consumptions AS (
        SELECT c.production_run_id, c.tank_batch_id, c.quantity,
               COALESCE(l.ingredient_id,
                        (SELECT il.ingredient_id FROM tank_batch_inputs tbi
                           JOIN ingredient_lots il ON il.id = tbi.ingredient_lot_id
                          WHERE tbi.tank_batch_id = c.tank_batch_id LIMIT 1)) AS ingredient_id
          FROM production_run_ingredient_consumptions c
          LEFT JOIN ingredient_lots l ON l.id = c.ingredient_lot_id
         WHERE c.consumed_at >= now() - interval '30 days'
     ),
     consumed AS (
        SELECT production_run_id, ingredient_id, SUM(quantity) AS consumed
          FROM consumptions GROUP BY production_run_id, ingredient_id
     ),
     supplied AS (
        SELECT c.production_run_id, c.ingredient_id, SUM(tbs.total_input_quantity) AS supplied
          FROM (SELECT DISTINCT production_run_id, ingredient_id, tank_batch_id FROM consumptions WHERE tank_batch_id IS NOT NULL) c
          JOIN tank_batch_stock tbs ON tbs.tank_batch_id = c.tank_batch_id
         GROUP BY c.production_run_id, c.ingredient_id
     ),
     recovered AS (
        SELECT source_production_run_id AS production_run_id, ingredient_id, SUM(quantity) AS recovered
          FROM recovered_ingredient_batches
         WHERE recovered_at >= now() - interval '30 days'
         GROUP BY source_production_run_id, ingredient_id
     ),
     loss AS (
        SELECT m.reference_id::uuid AS production_run_id,
               COALESCE(l.ingredient_id,
                        (SELECT il.ingredient_id FROM tank_batch_inputs tbi
                           JOIN ingredient_lots il ON il.id = tbi.ingredient_lot_id
                          WHERE tbi.tank_batch_id = m.tank_batch_id LIMIT 1)) AS ingredient_id,
               SUM(m.quantity) AS loss
          FROM ingredient_stock_movements m
          LEFT JOIN ingredient_lots l ON l.id = m.ingredient_lot_id
         WHERE m.movement_type = 'PERTE' AND m.reference_type = 'PRODUCTION_RUN'
         GROUP BY m.reference_id,
                  COALESCE(l.ingredient_id,
                           (SELECT il.ingredient_id FROM tank_batch_inputs tbi
                              JOIN ingredient_lots il ON il.id = tbi.ingredient_lot_id
                             WHERE tbi.tank_batch_id = m.tank_batch_id LIMIT 1))
     )
     SELECT COUNT(DISTINCT c.production_run_id)::text AS count
       FROM consumed c
       LEFT JOIN supplied s ON s.production_run_id = c.production_run_id AND s.ingredient_id = c.ingredient_id
       LEFT JOIN recovered r ON r.production_run_id = c.production_run_id AND r.ingredient_id = c.ingredient_id
       LEFT JOIN loss ls ON ls.production_run_id = c.production_run_id AND ls.ingredient_id = c.ingredient_id
      WHERE ABS(COALESCE(s.supplied, c.consumed) - c.consumed - COALESCE(r.recovered, 0) - COALESCE(ls.loss, 0))
            > c.consumed * ${MATERIAL_BALANCE_TOLERANCE_RATIO}`,
  );
  return Number(result.rows[0]?.count ?? '0');
}

/**
 * Per-Run ingredient material balance (section 37/39): Supplied - Consumed
 * - Recovered - Loss = Difference. "Supplied" is the total fed into the
 * tank batch(es) this Run's consumption actually drew from
 * (tank_batch_inputs); for a direct-lot consumption with no tank, supplied
 * equals consumed - there is no intermediate stage to measure separately.
 * If a tank batch legitimately served more than one Run, its full input is
 * reported identically for each - exact per-run allocation is not
 * physically measurable and is never fabricated (the same principle as the
 * mixed-tank genealogy).
 */
export async function runIngredientMaterialBalance(pool: pg.Pool, runId: string): Promise<readonly RunIngredientBalance[]> {
  const result = await pool.query<{
    ingredient_id: string;
    ingredient_code: string;
    ingredient_name: string;
    default_unit: string;
    consumed: string;
    supplied: string;
    recovered: string;
    loss: string;
  }>(
    `WITH consumptions AS (
        SELECT c.id, c.tank_batch_id, c.ingredient_lot_id, c.quantity,
               COALESCE(l.ingredient_id,
                        (SELECT il.ingredient_id FROM tank_batch_inputs tbi
                           JOIN ingredient_lots il ON il.id = tbi.ingredient_lot_id
                          WHERE tbi.tank_batch_id = c.tank_batch_id LIMIT 1)) AS ingredient_id
          FROM production_run_ingredient_consumptions c
          LEFT JOIN ingredient_lots l ON l.id = c.ingredient_lot_id
         WHERE c.production_run_id = $1
     ),
     consumed_by_ingredient AS (
        SELECT ingredient_id, SUM(quantity) AS consumed FROM consumptions GROUP BY ingredient_id
     ),
     supplied_by_ingredient AS (
        SELECT c.ingredient_id, SUM(tbs.total_input_quantity) AS supplied
          FROM (SELECT DISTINCT ingredient_id, tank_batch_id FROM consumptions WHERE tank_batch_id IS NOT NULL) c
          JOIN tank_batch_stock tbs ON tbs.tank_batch_id = c.tank_batch_id
         GROUP BY c.ingredient_id
     ),
     recovered_by_ingredient AS (
        SELECT ingredient_id, SUM(quantity) AS recovered
          FROM recovered_ingredient_batches WHERE source_production_run_id = $1 GROUP BY ingredient_id
     ),
     loss_by_ingredient AS (
        SELECT COALESCE(l.ingredient_id,
                         (SELECT il.ingredient_id FROM tank_batch_inputs tbi
                            JOIN ingredient_lots il ON il.id = tbi.ingredient_lot_id
                           WHERE tbi.tank_batch_id = m.tank_batch_id LIMIT 1)) AS ingredient_id,
               SUM(m.quantity) AS loss
          FROM ingredient_stock_movements m
          LEFT JOIN ingredient_lots l ON l.id = m.ingredient_lot_id
         WHERE m.movement_type = 'PERTE' AND m.reference_type = 'PRODUCTION_RUN' AND m.reference_id = $1
         GROUP BY COALESCE(l.ingredient_id,
                            (SELECT il.ingredient_id FROM tank_batch_inputs tbi
                               JOIN ingredient_lots il ON il.id = tbi.ingredient_lot_id
                              WHERE tbi.tank_batch_id = m.tank_batch_id LIMIT 1))
     )
     SELECT i.id AS ingredient_id, i.ingredient_code, i.name AS ingredient_name, i.default_unit,
            COALESCE(cbi.consumed, 0)::text AS consumed,
            COALESCE(sbi.supplied, cbi.consumed, 0)::text AS supplied,
            COALESCE(rbi.recovered, 0)::text AS recovered,
            COALESCE(lbi.loss, 0)::text AS loss
       FROM consumed_by_ingredient cbi
       JOIN ingredients i ON i.id = cbi.ingredient_id
       LEFT JOIN supplied_by_ingredient sbi ON sbi.ingredient_id = cbi.ingredient_id
       LEFT JOIN recovered_by_ingredient rbi ON rbi.ingredient_id = cbi.ingredient_id
       LEFT JOIN loss_by_ingredient lbi ON lbi.ingredient_id = cbi.ingredient_id
      ORDER BY i.ingredient_code`,
    [runId],
  );

  return result.rows.map((row) => {
    const supplied = Number(row.supplied);
    const consumed = Number(row.consumed);
    const recovered = Number(row.recovered);
    const loss = Number(row.loss);
    const difference = supplied - consumed - recovered - loss;
    const tolerance = consumed * MATERIAL_BALANCE_TOLERANCE_RATIO;
    return {
      ingredientId: row.ingredient_id,
      ingredientCode: row.ingredient_code,
      ingredientName: row.ingredient_name,
      suppliedQuantity: supplied,
      consumedQuantity: consumed,
      recoveredQuantity: recovered,
      lossQuantity: loss,
      difference,
      unit: row.default_unit,
      toleranceExceeded: Math.abs(difference) > tolerance,
    };
  });
}

export type IngredientTraceabilityForRun = Readonly<{
  ingredientLotsUsed: readonly Readonly<{ ingredientCode: string; lotCode: string; quantity: string; unit: string }>[];
  recoveredOilReused: readonly Readonly<{ recoveryCode: string; sourceRunCode: string; quantity: string; unit: string }>[];
}>;

/** Resolves ingredient traceability through Run genealogy (sections 56/71):
 * a Finished Goods Lot never carries manually copied ingredient fields -
 * everything is read back through finished_good_lot_sources -> Run. */
export async function ingredientTraceabilityForRun(pool: pg.Pool, runId: string): Promise<IngredientTraceabilityForRun> {
  const lotsUsed = await pool.query<{ ingredientCode: string; lotCode: string; quantity: string; unit: string }>(
    `SELECT i.ingredient_code AS "ingredientCode", l.lot_code AS "lotCode", c.quantity::text AS "quantity", c.unit AS "unit"
       FROM production_run_ingredient_consumptions c
       LEFT JOIN ingredient_lots l ON l.id = c.ingredient_lot_id
       LEFT JOIN ingredients i ON i.id = l.ingredient_id
      WHERE c.production_run_id = $1 AND c.ingredient_lot_id IS NOT NULL
      UNION ALL
      SELECT i.ingredient_code AS "ingredientCode", l.lot_code AS "lotCode", tbi.quantity::text AS "quantity", tbi.unit AS "unit"
        FROM production_run_ingredient_consumptions c
        JOIN tank_batch_inputs tbi ON tbi.tank_batch_id = c.tank_batch_id
        JOIN ingredient_lots l ON l.id = tbi.ingredient_lot_id
        JOIN ingredients i ON i.id = l.ingredient_id
       WHERE c.production_run_id = $1 AND c.tank_batch_id IS NOT NULL
       ORDER BY 1, 2`,
    [runId],
  );
  const recoveredReused = await pool.query<{ recoveryCode: string; sourceRunCode: string; quantity: string; unit: string }>(
    `SELECT b.recovery_code AS "recoveryCode", r.run_code AS "sourceRunCode", u.quantity::text AS "quantity", u.unit AS "unit"
       FROM recovered_ingredient_reuse u
       JOIN recovered_ingredient_batches b ON b.id = u.recovered_batch_id
       JOIN production_runs r ON r.id = b.source_production_run_id
      WHERE u.destination_production_run_id = $1
      ORDER BY u.reused_at`,
    [runId],
  );
  return { ingredientLotsUsed: lotsUsed.rows, recoveredOilReused: recoveredReused.rows };
}
