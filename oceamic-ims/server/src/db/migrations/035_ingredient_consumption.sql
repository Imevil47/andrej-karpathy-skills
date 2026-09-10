-- OCEAMIC IMS - Phase 8
-- Ingredients and production consumables, part 4: material consumed by
-- production (section 75). Never a second, manually re-typed total
-- (section 15): each row is created together with the ingredient_stock_movements
-- CONSOMMATION row it represents, in the same transaction.
--
-- Exactly one of ingredient_lot_id / tank_batch_id is set, the same shape as
-- ingredient_stock_movements: a direct addition (e.g. sauce poured straight
-- from its lot) points at the lot; a filling line drawing from a cuve
-- points at the tank batch, and section 23's genealogy
-- (Run -> tank batch -> ingredient lots) is resolved through
-- tank_batch_inputs, never guessed at the consumption row itself.
CREATE TABLE production_run_ingredient_consumptions (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id             UUID NOT NULL REFERENCES production_runs (id),
    filling_operation_id          UUID REFERENCES filling_operations (id),
    ingredient_lot_id             UUID REFERENCES ingredient_lots (id),
    tank_batch_id                 UUID REFERENCES tank_batches (id),
    source_location_id            UUID REFERENCES locations (id),
    quantity                      NUMERIC(14, 3) NOT NULL,
    unit                          VARCHAR(8) NOT NULL,
    consumed_at                   TIMESTAMPTZ NOT NULL,
    ingredient_stock_movement_id  UUID NOT NULL UNIQUE REFERENCES ingredient_stock_movements (id),
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                    UUID NOT NULL REFERENCES users (id),
    CONSTRAINT run_ingredient_consumptions_quantity_positive CHECK (quantity > 0),
    CONSTRAINT run_ingredient_consumptions_unit_allowed CHECK (unit IN ('L', 'KG', 'G', 'ML', 'UNITE')),
    CONSTRAINT run_ingredient_consumptions_lot_xor_tank_batch
        CHECK ((ingredient_lot_id IS NULL) <> (tank_batch_id IS NULL))
);

CREATE INDEX run_ingredient_consumptions_run_idx ON production_run_ingredient_consumptions (production_run_id);
CREATE INDEX run_ingredient_consumptions_filling_op_idx ON production_run_ingredient_consumptions (filling_operation_id);
CREATE INDEX run_ingredient_consumptions_lot_idx ON production_run_ingredient_consumptions (ingredient_lot_id);
CREATE INDEX run_ingredient_consumptions_tank_batch_idx ON production_run_ingredient_consumptions (tank_batch_id);

-- Process utilities (section 33): water, steam - relevant operationally but
-- never forced through full lot traceability the way an oil or sauce lot
-- is. A separate, deliberately simple table so ordinary process water never
-- inflates the ingredient lot/tank genealogy above.
CREATE TABLE process_utility_consumptions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id    UUID NOT NULL REFERENCES production_runs (id),
    utility_type         VARCHAR(16) NOT NULL,
    quantity             NUMERIC(14, 3) NOT NULL,
    unit                 VARCHAR(8) NOT NULL,
    occurred_at          TIMESTAMPTZ NOT NULL,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           UUID NOT NULL REFERENCES users (id),
    CONSTRAINT process_utility_consumptions_type_allowed CHECK (utility_type IN ('EAU', 'VAPEUR', 'AUTRE')),
    CONSTRAINT process_utility_consumptions_quantity_positive CHECK (quantity > 0),
    CONSTRAINT process_utility_consumptions_unit_allowed CHECK (unit IN ('L', 'KG', 'G', 'ML', 'UNITE'))
);

CREATE INDEX process_utility_consumptions_run_idx ON process_utility_consumptions (production_run_id);
