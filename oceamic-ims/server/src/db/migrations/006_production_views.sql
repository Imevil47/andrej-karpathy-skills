-- OCEAMIC IMS - Phase 2
-- Material balance and yield are never stored and never typed by a user: they
-- are derived from validated consumption and output records. These views are
-- the single place where the formulas live.

-- Raw material actually consumed by a run (cancelled consumptions excluded).
CREATE VIEW production_run_material_input AS
SELECT r.id AS production_run_id,
       COALESCE(SUM(m.quantity_kg) FILTER (WHERE m.status = 'VALIDE'), 0)::numeric(14,3)
           AS input_kg
  FROM production_runs r
  LEFT JOIN production_run_materials m ON m.production_run_id = r.id
 GROUP BY r.id;

-- Material dispositions declared by the run, one column per category.
CREATE VIEW production_run_output_totals AS
SELECT r.id AS production_run_id,
       COALESCE(SUM(o.quantity_kg) FILTER (WHERE o.output_type = 'SORTIE_UTILE'), 0)::numeric(14,3)
           AS useful_kg,
       COALESCE(SUM(o.quantity_kg) FILTER (WHERE o.output_type = 'SOUS_PRODUIT'), 0)::numeric(14,3)
           AS by_product_kg,
       COALESCE(SUM(o.quantity_kg) FILTER (WHERE o.output_type = 'REWORK'), 0)::numeric(14,3)
           AS rework_kg,
       COALESCE(SUM(o.quantity_kg) FILTER (WHERE o.output_type = 'RECLASSEMENT'), 0)::numeric(14,3)
           AS reclassified_kg,
       COALESCE(SUM(o.quantity_kg) FILTER (WHERE o.output_type = 'PERTE_REELLE'), 0)::numeric(14,3)
           AS real_loss_kg,
       COALESCE(SUM(o.quantity_kg) FILTER (WHERE o.output_type = 'AUTRE'), 0)::numeric(14,3)
           AS other_kg,
       COALESCE(SUM(o.quantity_kg), 0)::numeric(14,3) AS accounted_kg
  FROM production_runs r
  LEFT JOIN production_outputs o ON o.production_run_id = r.id AND o.status = 'VALIDE'
 GROUP BY r.id;

-- Material balance: input − everything accounted for = unexplained difference.
-- The difference is a calculated figure, never a stored declaration.
-- Tolerance (single definition): a run is balanced only when the difference is
-- exactly zero; up to 0.50 % of the input it must be checked; beyond that it
-- must be justified before the run can be closed.
CREATE VIEW production_run_material_balance AS
SELECT r.id AS production_run_id,
       i.input_kg,
       t.useful_kg,
       t.by_product_kg,
       t.rework_kg,
       t.reclassified_kg,
       t.real_loss_kg,
       t.other_kg,
       t.accounted_kg,
       (i.input_kg - t.accounted_kg)::numeric(14,3) AS difference_kg,
       CASE WHEN i.input_kg = 0 THEN NULL
            ELSE round((i.input_kg - t.accounted_kg) / i.input_kg * 100, 2)
       END AS difference_percent,
       CASE
           WHEN i.input_kg - t.accounted_kg = 0 THEN 'EQUILIBRE'
           WHEN i.input_kg = 0 THEN 'ECART_A_JUSTIFIER'
           WHEN abs(i.input_kg - t.accounted_kg) / i.input_kg * 100 <= 0.50 THEN 'A_CONTROLER'
           ELSE 'ECART_A_JUSTIFIER'
       END AS balance_status
  FROM production_runs r
  JOIN production_run_material_input i ON i.production_run_id = r.id
  JOIN production_run_output_totals t ON t.production_run_id = r.id;

-- Material yield. Only the useful output counts in the numerator: by-products,
-- rework, reclassification, real losses and the unexplained difference never do.
CREATE VIEW production_run_yield AS
SELECT b.production_run_id,
       b.input_kg,
       b.useful_kg,
       CASE WHEN b.input_kg = 0 THEN NULL
            ELSE round(b.useful_kg / b.input_kg * 100, 2)
       END AS yield_percent
  FROM production_run_material_balance b;

-- Forward traceability: where a raw material lot was used in production.
CREATE VIEW lot_production_usage AS
SELECT m.raw_material_lot_id,
       m.production_run_id,
       r.run_code,
       r.production_date,
       r.status AS run_status,
       p.code AS product_code,
       p.name AS product_name,
       SUM(m.quantity_kg)::numeric(14,3) AS consumed_kg
  FROM production_run_materials m
  JOIN production_runs r ON r.id = m.production_run_id
  JOIN products p ON p.id = r.product_id
 WHERE m.status = 'VALIDE'
 GROUP BY m.raw_material_lot_id, m.production_run_id, r.run_code, r.production_date,
          r.status, p.code, p.name;
