-- OCEAMIC IMS - Phase 8
-- Ingredients and production consumables, part 2: the stock movement
-- ledger. Current stock is never a stored, editable total (section 13): it
-- is always derived from this ledger, exactly the same discipline as
-- stock_movements (Phase 1) - source_location_id/destination_location_id
-- and a computed signed-ledger view (038_ingredient_views.sql), not a
-- separate signed quantity_delta column.
--
-- ingredient_lot_id is nullable on purpose: a consumption drawn from a
-- mixed tank batch (section 22/68) concerns the batch's blended content,
-- not one single lot - inventing a lot for that movement would misrepresent
-- a real blend as a false single-source withdrawal. 034_ingredient_tanks.sql
-- adds the sibling tank_batch_id column and the constraint requiring
-- exactly one of the two once tank_batches exists.
--
-- RECUPERATION and REUTILISATION are deliberately NOT movement types here,
-- even though an early reading of section 12 suggests they might be:
-- section 75's own domain separation lists RECOVERED INGREDIENT BATCH and
-- REUSE EVENT as distinct concepts from an inventory event, each already
-- has its own complete, purpose-built table (recovered_ingredient_batches /
-- recovered_ingredient_reuse, 036_ingredient_recovery.sql) with the
-- genealogy, age and partial-depletion logic those events actually need.
-- Recording them a second time as a generic lot-or-tank-batch movement here
-- would be a second, competing source of truth for the same event - the
-- consumption that sent oil to the filling line is already a CONSOMMATION
-- row; what a recovery batch captures afterwards is a genuinely new
-- material identity, not a reversal of that consumption.
CREATE TABLE ingredient_stock_movements (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_code             VARCHAR(32) NOT NULL UNIQUE,
    ingredient_lot_id         UUID REFERENCES ingredient_lots (id),
    movement_type             VARCHAR(24) NOT NULL,
    source_location_id        UUID REFERENCES locations (id),
    destination_location_id   UUID REFERENCES locations (id),
    quantity                  NUMERIC(14, 3) NOT NULL,
    unit                      VARCHAR(8) NOT NULL,
    occurred_at               TIMESTAMPTZ NOT NULL,
    reference_type            VARCHAR(32),
    reference_id              UUID,
    loss_reason_id            UUID REFERENCES ingredient_loss_reasons (id),
    reason                    TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID NOT NULL REFERENCES users (id),
    CONSTRAINT ingredient_movements_quantity_positive CHECK (quantity > 0),
    CONSTRAINT ingredient_movements_type_allowed
        CHECK (movement_type IN ('RECEPTION', 'TRANSFERT', 'ALIMENTATION_CUVE', 'CONSOMMATION',
                                 'PERTE', 'AJUSTEMENT', 'RETOUR')),
    CONSTRAINT ingredient_movements_unit_allowed
        CHECK (unit IN ('L', 'KG', 'G', 'ML', 'UNITE')),
    -- A loss reason only makes sense on a PERTE movement (section 34): never
    -- hidden inside an AJUSTEMENT.
    CONSTRAINT ingredient_movements_loss_reason_only_on_perte
        CHECK (loss_reason_id IS NULL OR movement_type = 'PERTE'),
    -- At least one side is required, the same shape as Phase 1's
    -- stock_movements: RECEPTION has a destination only, CONSOMMATION/PERTE
    -- a source only, TRANSFERT/ALIMENTATION_CUVE both.
    CONSTRAINT ingredient_movements_at_least_one_side
        CHECK (source_location_id IS NOT NULL OR destination_location_id IS NOT NULL)
);

CREATE INDEX ingredient_movements_lot_idx ON ingredient_stock_movements (ingredient_lot_id);
CREATE INDEX ingredient_movements_type_idx ON ingredient_stock_movements (movement_type);
CREATE INDEX ingredient_movements_occurred_at_idx ON ingredient_stock_movements (occurred_at DESC);
CREATE INDEX ingredient_movements_source_idx ON ingredient_stock_movements (source_location_id);
CREATE INDEX ingredient_movements_destination_idx ON ingredient_stock_movements (destination_location_id);
