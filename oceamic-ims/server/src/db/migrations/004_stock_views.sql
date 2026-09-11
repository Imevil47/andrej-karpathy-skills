-- OCEAMIC IMS - Phase 1
-- Inventory is never stored: it is always derived from the stock movement
-- ledger. These views are the single source of truth for every stock figure
-- displayed or validated by the application.

-- One signed line per movement side. This is the only place where a movement
-- is turned into a debit / credit.
CREATE VIEW stock_ledger_entries AS
SELECT m.raw_material_lot_id,
       m.destination_location_id AS location_id,
       m.quantity_kg             AS signed_quantity_kg,
       m.occurred_at
  FROM stock_movements m
 WHERE m.destination_location_id IS NOT NULL
UNION ALL
SELECT m.raw_material_lot_id,
       m.source_location_id,
       -m.quantity_kg,
       m.occurred_at
  FROM stock_movements m
 WHERE m.source_location_id IS NOT NULL;

-- Physical stock per LOT + EMPLACEMENT (inbound - outbound).
CREATE VIEW current_stock_by_lot_location AS
SELECT e.raw_material_lot_id,
       e.location_id,
       SUM(e.signed_quantity_kg) AS quantity_kg
  FROM stock_ledger_entries e
 GROUP BY e.raw_material_lot_id, e.location_id
HAVING SUM(e.signed_quantity_kg) <> 0;

-- Physical stock per lot, all locations together.
CREATE VIEW current_stock_by_lot AS
SELECT s.raw_material_lot_id,
       SUM(s.quantity_kg) AS quantity_kg
  FROM current_stock_by_lot_location s
 GROUP BY s.raw_material_lot_id
HAVING SUM(s.quantity_kg) <> 0;

-- Lots currently blocked by the quality department.
CREATE VIEW blocked_lots AS
SELECT b.raw_material_lot_id,
       b.id AS lot_block_id,
       b.blocked_at,
       b.blocked_by,
       b.reason
  FROM lot_blocks b
 WHERE b.status = 'ACTIF';

-- Physical / blocked / available stock per LOT + EMPLACEMENT.
-- Phase 1 blocks the whole lot, so a blocked lot has no available quantity.
CREATE VIEW available_stock AS
SELECT s.raw_material_lot_id,
       s.location_id,
       s.quantity_kg AS physical_quantity_kg,
       CASE WHEN b.raw_material_lot_id IS NULL THEN 0 ELSE s.quantity_kg END::numeric(14,3)
            AS blocked_quantity_kg,
       CASE WHEN b.raw_material_lot_id IS NULL THEN s.quantity_kg ELSE 0 END::numeric(14,3)
            AS available_quantity_kg,
       (b.raw_material_lot_id IS NOT NULL) AS is_blocked
  FROM current_stock_by_lot_location s
  LEFT JOIN blocked_lots b ON b.raw_material_lot_id = s.raw_material_lot_id;

-- Internal / external classification always comes from the location.
CREATE VIEW internal_stock_summary AS
SELECT l.id AS location_id,
       l.code AS location_code,
       l.name AS location_name,
       SUM(s.quantity_kg) AS quantity_kg
  FROM current_stock_by_lot_location s
  JOIN locations l ON l.id = s.location_id
 WHERE l.stock_type = 'INTERNE'
 GROUP BY l.id, l.code, l.name;

CREATE VIEW external_stock_summary AS
SELECT l.id AS location_id,
       l.code AS location_code,
       l.name AS location_name,
       SUM(s.quantity_kg) AS quantity_kg
  FROM current_stock_by_lot_location s
  JOIN locations l ON l.id = s.location_id
 WHERE l.stock_type = 'EXTERNE'
 GROUP BY l.id, l.code, l.name;

-- Material balance of a subcontracting operation: sent - sum(results).
CREATE VIEW subcontracting_material_balance AS
SELECT o.id AS subcontracting_operation_id,
       o.quantity_sent_kg,
       COALESCE(r.results_kg, 0) AS results_kg,
       o.quantity_sent_kg - COALESCE(r.results_kg, 0) AS difference_kg
  FROM subcontracting_operations o
  LEFT JOIN (
        SELECT subcontracting_operation_id, SUM(quantity_kg) AS results_kg
          FROM subcontracting_results
         GROUP BY subcontracting_operation_id
  ) r ON r.subcontracting_operation_id = o.id;
