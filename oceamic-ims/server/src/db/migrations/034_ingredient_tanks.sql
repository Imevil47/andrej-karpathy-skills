-- OCEAMIC IMS - Phase 8
-- Ingredients and production consumables, part 3: tanks (cuves) and their
-- batch genealogy. A tank is a physical vessel (section 19); a tank batch
-- is a traceable content event (section 75) - never fused together, and a
-- tank is never permanently bound to one ingredient (section 20):
-- ingredient_type_id here is only the usual/expected product, never
-- enforced against what a batch actually contains.
CREATE TABLE ingredient_tanks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tank_code           VARCHAR(32) NOT NULL UNIQUE,
    name                VARCHAR(128) NOT NULL,
    ingredient_type_id  UUID REFERENCES ingredient_types (id),
    capacity_liters     NUMERIC(10, 2),
    location_id         UUID REFERENCES locations (id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ingredient_tanks_capacity_positive
        CHECK (capacity_liters IS NULL OR capacity_liters > 0)
);

-- One tank load (section 21): a batch stays OUVERT while it can still
-- receive input and be consumed from, CLOTURE once the tank is emptied and
-- cleaned for its next load. A batch may carry more than one ingredient lot
-- (section 22's mixing traceability) via tank_batch_inputs below - the
-- genealogy is never collapsed into an untraceable "mixed oil" record.
CREATE TABLE tank_batches (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_code   VARCHAR(32) NOT NULL UNIQUE,
    tank_id      UUID NOT NULL REFERENCES ingredient_tanks (id),
    started_at   TIMESTAMPTZ NOT NULL,
    closed_at    TIMESTAMPTZ,
    status       VARCHAR(16) NOT NULL DEFAULT 'OUVERT',
    created_by   UUID NOT NULL REFERENCES users (id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tank_batches_status_allowed CHECK (status IN ('OUVERT', 'CLOTURE')),
    CONSTRAINT tank_batches_closed_after_started CHECK (closed_at IS NULL OR closed_at >= started_at)
);

CREATE INDEX tank_batches_tank_idx ON tank_batches (tank_id);
CREATE INDEX tank_batches_status_idx ON tank_batches (status);

-- Every lot fed into a tank batch (section 21/22), each row its own
-- ALIMENTATION_CUVE ingredient_stock_movement so the ledger and the
-- genealogy can never disagree about what actually went in.
CREATE TABLE tank_batch_inputs (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tank_batch_id               UUID NOT NULL REFERENCES tank_batches (id),
    ingredient_lot_id           UUID NOT NULL REFERENCES ingredient_lots (id),
    quantity                    NUMERIC(14, 3) NOT NULL,
    unit                        VARCHAR(8) NOT NULL,
    added_at                    TIMESTAMPTZ NOT NULL,
    ingredient_stock_movement_id UUID NOT NULL UNIQUE REFERENCES ingredient_stock_movements (id),
    created_by                  UUID NOT NULL REFERENCES users (id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tank_batch_inputs_quantity_positive CHECK (quantity > 0),
    CONSTRAINT tank_batch_inputs_unit_allowed CHECK (unit IN ('L', 'KG', 'G', 'ML', 'UNITE'))
);

CREATE INDEX tank_batch_inputs_batch_idx ON tank_batch_inputs (tank_batch_id);
CREATE INDEX tank_batch_inputs_lot_idx ON tank_batch_inputs (ingredient_lot_id);

-- A physical measurement (section 45), kept strictly separate from the
-- movement-derived theoretical stock: "Stock théorique" and "Mesure
-- physique" are two different facts, never merged into one number.
CREATE TABLE tank_measurements (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tank_id               UUID NOT NULL REFERENCES ingredient_tanks (id),
    measured_at           TIMESTAMPTZ NOT NULL,
    quantity              NUMERIC(14, 3) NOT NULL,
    unit                  VARCHAR(8) NOT NULL,
    measurement_method    VARCHAR(64),
    created_by            UUID NOT NULL REFERENCES users (id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tank_measurements_quantity_not_negative CHECK (quantity >= 0),
    CONSTRAINT tank_measurements_unit_allowed CHECK (unit IN ('L', 'KG', 'G', 'ML', 'UNITE'))
);

CREATE INDEX tank_measurements_tank_idx ON tank_measurements (tank_id, measured_at DESC);

-- A movement now concerns either one lot or one tank batch's blended
-- content (section 22/68), never both and never neither - completing the
-- nullable ingredient_lot_id left open in 033_ingredient_stock.sql.
ALTER TABLE ingredient_stock_movements ADD COLUMN tank_batch_id UUID REFERENCES tank_batches (id);
ALTER TABLE ingredient_stock_movements ADD CONSTRAINT ingredient_movements_lot_xor_tank_batch
    CHECK ((ingredient_lot_id IS NULL) <> (tank_batch_id IS NULL));

CREATE INDEX ingredient_movements_tank_batch_idx ON ingredient_stock_movements (tank_batch_id);
