-- OCEAMIC IMS - Phase 5
-- Finished Goods stock is never stored, only computed - the same discipline
-- as the Phase 1 raw-material ledger (section 17: "do not allow users to
-- manually type Stock actuel PF").

-- Every movement turned into signed ledger lines, exactly like
-- stock_ledger_entries in Phase 1.
CREATE VIEW fg_stock_ledger_entries AS
SELECT m.pallet_id,
       m.destination_location_id AS location_id,
       m.quantity_cartons        AS signed_quantity_cartons,
       m.quantity_units          AS signed_quantity_units,
       m.occurred_at
  FROM finished_goods_stock_movements m
 WHERE m.destination_location_id IS NOT NULL
UNION ALL
SELECT m.pallet_id,
       m.source_location_id,
       -m.quantity_cartons,
       -m.quantity_units,
       m.occurred_at
  FROM finished_goods_stock_movements m
 WHERE m.source_location_id IS NOT NULL;

-- Physical position of each pallet: at most one location carries a nonzero
-- balance for a given pallet, since every movement always carries that
-- pallet's full quantity (a pallet is never split across two locations).
CREATE VIEW pallet_stock_balance AS
SELECT e.pallet_id,
       e.location_id,
       SUM(e.signed_quantity_cartons)::bigint AS quantity_cartons,
       SUM(e.signed_quantity_units)::bigint   AS quantity_units
  FROM fg_stock_ledger_entries e
 GROUP BY e.pallet_id, e.location_id
HAVING SUM(e.signed_quantity_cartons) <> 0;

-- Pallet summary: physical position, reservation and quality state in one
-- row, for the pallet list and detail screens.
CREATE VIEW pallet_summary AS
SELECT p.id AS pallet_id,
       p.pallet_code,
       p.status,
       p.quality_status,
       bal.location_id,
       loc.code AS location_code,
       COALESCE(bal.quantity_cartons, 0) AS quantity_cartons,
       COALESCE(bal.quantity_units, 0)   AS quantity_units,
       (r.id IS NOT NULL)                AS is_reserved,
       r.shipment_id                     AS reserved_for_shipment_id
  FROM pallets p
  LEFT JOIN pallet_stock_balance bal ON bal.pallet_id = p.id
  LEFT JOIN locations loc ON loc.id = bal.location_id
  LEFT JOIN stock_reservations r ON r.pallet_id = p.id AND r.status = 'ACTIF';

-- Finished Goods Lot stock summary (section 17/25): physical, blocked and
-- reserved cartons/units, always derived by attributing each pallet's
-- physical position through pallet_contents - a Lot PF never carries its own
-- stock position (section 5).
--
-- A pallet's cartons count as blocked when either the pallet itself or the
-- specific Lot PF on it is BLOQUE: a pallet-level block is a handling issue
-- affecting everything on it, a lot-level block is a product issue affecting
-- only that lot's cartons wherever they physically are.
CREATE VIEW finished_good_lot_stock_summary AS
SELECT fgl.id AS finished_good_lot_id,
       COALESCE(SUM(pc.quantity_cartons) FILTER (WHERE bal.pallet_id IS NOT NULL), 0)::bigint
           AS physical_cartons,
       COALESCE(SUM(pc.quantity_units) FILTER (WHERE bal.pallet_id IS NOT NULL), 0)::bigint
           AS physical_units,
       COALESCE(SUM(pc.quantity_cartons)
                FILTER (WHERE bal.pallet_id IS NOT NULL
                         AND (p.quality_status = 'BLOQUE' OR fgl.quality_status = 'BLOQUE')), 0)::bigint
           AS blocked_cartons,
       COALESCE(SUM(pc.quantity_cartons)
                FILTER (WHERE bal.pallet_id IS NOT NULL AND res.id IS NOT NULL), 0)::bigint
           AS reserved_cartons,
       COALESCE(SUM(pc.quantity_units)
                FILTER (WHERE bal.pallet_id IS NOT NULL AND res.id IS NOT NULL), 0)::bigint
           AS reserved_units
  FROM finished_good_lots fgl
  LEFT JOIN pallet_contents pc ON pc.finished_good_lot_id = fgl.id
  LEFT JOIN pallets p ON p.id = pc.pallet_id
  LEFT JOIN pallet_stock_balance bal ON bal.pallet_id = pc.pallet_id
  LEFT JOIN stock_reservations res ON res.pallet_id = pc.pallet_id AND res.status = 'ACTIF'
 GROUP BY fgl.id;

-- Finished Goods stock per location and product, for the Stock PF summary
-- cards and the location-based filters.
CREATE VIEW fg_stock_by_location AS
SELECT bal.location_id,
       loc.code AS location_code,
       fgl.product_id,
       pr.code AS product_code,
       COALESCE(SUM(pc.quantity_cartons), 0)::bigint AS quantity_cartons,
       COALESCE(SUM(pc.quantity_units), 0)::bigint   AS quantity_units
  FROM pallet_stock_balance bal
  JOIN locations loc ON loc.id = bal.location_id
  JOIN pallet_contents pc ON pc.pallet_id = bal.pallet_id
  JOIN finished_good_lots fgl ON fgl.id = pc.finished_good_lot_id
  JOIN products pr ON pr.id = fgl.product_id
 GROUP BY bal.location_id, loc.code, fgl.product_id, pr.code;
