-- OCEAMIC IMS - Phase 8
-- Computed ingredient status - the same discipline as every other phase's
-- views: stock, tank batch remaining quantity and recovered-batch status
-- are always derived from the underlying ledger/event rows, never a stored
-- opinion.

-- One signed line per movement side, exactly the pattern of Phase 1's
-- stock_ledger_entries, scoped to movements that concern a specific lot
-- (tank-batch-sourced consumption has no ingredient_lot_id and is excluded
-- here on purpose - see tank_batch_stock below for that side of the ledger).
CREATE VIEW ingredient_stock_ledger_entries AS
SELECT m.ingredient_lot_id,
       m.destination_location_id AS location_id,
       m.quantity                AS signed_quantity,
       m.occurred_at
  FROM ingredient_stock_movements m
 WHERE m.ingredient_lot_id IS NOT NULL AND m.destination_location_id IS NOT NULL
UNION ALL
SELECT m.ingredient_lot_id,
       m.source_location_id,
       -m.quantity,
       m.occurred_at
  FROM ingredient_stock_movements m
 WHERE m.ingredient_lot_id IS NOT NULL AND m.source_location_id IS NOT NULL;

-- Physical stock per LOT + EMPLACEMENT.
CREATE VIEW current_ingredient_stock_by_lot_location AS
SELECT e.ingredient_lot_id,
       e.location_id,
       SUM(e.signed_quantity) AS quantity
  FROM ingredient_stock_ledger_entries e
 GROUP BY e.ingredient_lot_id, e.location_id
HAVING SUM(e.signed_quantity) <> 0;

-- Physical stock per lot, all locations together.
CREATE VIEW current_ingredient_stock_by_lot AS
SELECT s.ingredient_lot_id,
       SUM(s.quantity) AS quantity
  FROM current_ingredient_stock_by_lot_location s
 GROUP BY s.ingredient_lot_id
HAVING SUM(s.quantity) <> 0;

-- Tank batch content and remaining quantity (section 44): total fed in
-- (tank_batch_inputs) minus everything drawn out of the batch since
-- (CONSOMMATION/PERTE movements referencing this tank_batch_id). This is
-- the "Stock théorique" of a tank batch - a physical tank_measurements row
-- (section 45) is a separate, never-overwritten fact.
CREATE VIEW tank_batch_stock AS
SELECT tb.id AS tank_batch_id,
       tb.tank_id,
       COALESCE(inputs.total_input, 0)  AS total_input_quantity,
       COALESCE(outputs.total_output, 0) AS total_output_quantity,
       COALESCE(inputs.total_input, 0) - COALESCE(outputs.total_output, 0) AS remaining_quantity
  FROM tank_batches tb
  LEFT JOIN LATERAL (
        SELECT SUM(quantity) AS total_input FROM tank_batch_inputs i WHERE i.tank_batch_id = tb.id
  ) inputs ON TRUE
  LEFT JOIN LATERAL (
        SELECT SUM(quantity) AS total_output FROM ingredient_stock_movements m
         WHERE m.tank_batch_id = tb.id AND m.movement_type IN ('CONSOMMATION', 'PERTE')
  ) outputs ON TRUE;

-- Recovered-batch remaining quantity and effective status (sections 27-28):
-- the stored `status` column only ever holds DISPONIBLE/BLOQUE/ELIMINE (an
-- operator or QUALITE decision); UTILISE_PARTIELLEMENT, EPUISE and EXPIRE
-- are always computed here, so an operator can never make expired material
-- reusable again by simply not looking at the clock.
CREATE VIEW recovered_batch_status AS
SELECT b.id AS recovered_batch_id,
       b.quantity,
       COALESCE(r.reused_quantity, 0) AS reused_quantity,
       b.quantity - COALESCE(r.reused_quantity, 0) AS remaining_quantity,
       b.reuse_deadline,
       (now() > b.reuse_deadline) AS is_expired,
       CASE
           WHEN b.status IN ('BLOQUE', 'ELIMINE') THEN b.status
           WHEN b.quantity - COALESCE(r.reused_quantity, 0) <= 0 THEN 'EPUISE'
           WHEN now() > b.reuse_deadline THEN 'EXPIRE'
           WHEN COALESCE(r.reused_quantity, 0) > 0 THEN 'UTILISE_PARTIELLEMENT'
           ELSE 'DISPONIBLE'
       END AS effective_status
  FROM recovered_ingredient_batches b
  LEFT JOIN LATERAL (
        SELECT SUM(quantity) AS reused_quantity FROM recovered_ingredient_reuse u
         WHERE u.recovered_batch_id = b.id
  ) r ON TRUE;
