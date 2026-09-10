-- OCEAMIC IMS - Phase 8
-- Ingredients and production consumables, part 5: recovered material
-- (sections 24-32). A recovered batch is a genuinely new material identity
-- born from a Production Run's process (section 66's RECOVERED INGREDIENT
-- BATCH), never a reversal entry against the ingredient_stock_movements
-- ledger - see 033_ingredient_stock.sql's note on why RECUPERATION/
-- REUTILISATION are not ledger movement types.

CREATE TABLE ingredient_containers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_code  VARCHAR(32) NOT NULL UNIQUE,
    container_type  VARCHAR(32) NOT NULL,
    capacity        NUMERIC(10, 2),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ingredient_containers_capacity_positive CHECK (capacity IS NULL OR capacity > 0)
);

-- The centralized reuse-age policy (section 25): "maximum reuse age" is
-- configuration, read from exactly one place
-- (services/recoveredIngredients.ts::getReusePolicy) rather than hardcoded
-- across screens. A row with ingredient_type_id NULL is the global default;
-- a specific ingredient type may override it. allow_mixing (section 32)
-- centralizes whether recovered batches of the same ingredient may be
-- merged - the operational rule is configuration, never invented in code.
CREATE TABLE ingredient_reuse_policies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_type_id  UUID REFERENCES ingredient_types (id),
    max_reuse_hours     INTEGER NOT NULL,
    allow_mixing        BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ingredient_reuse_policies_hours_positive CHECK (max_reuse_hours > 0)
);

CREATE UNIQUE INDEX ingredient_reuse_policies_one_per_type
    ON ingredient_reuse_policies (ingredient_type_id) WHERE ingredient_type_id IS NOT NULL;
CREATE UNIQUE INDEX ingredient_reuse_policies_one_global
    ON ingredient_reuse_policies ((ingredient_type_id IS NULL)) WHERE ingredient_type_id IS NULL;

-- status only stores the MANUAL states an operator/QUALITE can set
-- (DISPONIBLE, BLOQUE, ELIMINE - section 27); UTILISE_PARTIELLEMENT, EPUISE
-- and EXPIRE are always computed from reuse_deadline and remaining quantity
-- (038_ingredient_views.sql's recovered_batch_status view), never opinions
-- typed by a user (section 28: expired material must not be reachable by
-- simply flipping a status back to DISPONIBLE).
CREATE TABLE recovered_ingredient_batches (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recovery_code               VARCHAR(32) NOT NULL UNIQUE,
    ingredient_id               UUID NOT NULL REFERENCES ingredients (id),
    source_production_run_id    UUID NOT NULL REFERENCES production_runs (id),
    source_filling_operation_id UUID REFERENCES filling_operations (id),
    recovered_at                TIMESTAMPTZ NOT NULL,
    quantity                    NUMERIC(14, 3) NOT NULL,
    unit                        VARCHAR(8) NOT NULL,
    storage_location_id         UUID REFERENCES locations (id),
    container_id                UUID REFERENCES ingredient_containers (id),
    status                      VARCHAR(16) NOT NULL DEFAULT 'DISPONIBLE',
    reuse_deadline               TIMESTAMPTZ NOT NULL,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                  UUID NOT NULL REFERENCES users (id),
    CONSTRAINT recovered_batches_quantity_positive CHECK (quantity > 0),
    CONSTRAINT recovered_batches_unit_allowed CHECK (unit IN ('L', 'KG', 'G', 'ML', 'UNITE')),
    CONSTRAINT recovered_batches_status_allowed CHECK (status IN ('DISPONIBLE', 'BLOQUE', 'ELIMINE'))
);

CREATE INDEX recovered_batches_ingredient_idx ON recovered_ingredient_batches (ingredient_id);
CREATE INDEX recovered_batches_source_run_idx ON recovered_ingredient_batches (source_production_run_id);
CREATE INDEX recovered_batches_deadline_idx ON recovered_ingredient_batches (reuse_deadline);
CREATE INDEX recovered_batches_status_idx ON recovered_ingredient_batches (status);

-- Partial reuse (section 30): several reuse rows may deplete one recovered
-- batch; remaining quantity is always quantity - SUM(reuse.quantity), never
-- stored. There is no stock_movement_id column here - section 33's own
-- domain separation treats this as its own event, and inventing a ledger
-- movement for it would be a second, competing bookkeeping of the same
-- fact (see 033_ingredient_stock.sql).
CREATE TABLE recovered_ingredient_reuse (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recovered_batch_id              UUID NOT NULL REFERENCES recovered_ingredient_batches (id),
    destination_production_run_id   UUID NOT NULL REFERENCES production_runs (id),
    destination_filling_operation_id UUID REFERENCES filling_operations (id),
    quantity                        NUMERIC(14, 3) NOT NULL,
    unit                            VARCHAR(8) NOT NULL,
    reused_at                       TIMESTAMPTZ NOT NULL,
    created_by                      UUID NOT NULL REFERENCES users (id),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT recovered_reuse_quantity_positive CHECK (quantity > 0),
    CONSTRAINT recovered_reuse_unit_allowed CHECK (unit IN ('L', 'KG', 'G', 'ML', 'UNITE'))
);

CREATE INDEX recovered_reuse_batch_idx ON recovered_ingredient_reuse (recovered_batch_id);
CREATE INDEX recovered_reuse_destination_run_idx ON recovered_ingredient_reuse (destination_production_run_id);
