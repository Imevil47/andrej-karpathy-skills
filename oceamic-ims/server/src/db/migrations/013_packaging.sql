-- OCEAMIC IMS - Phase 5
-- Packaging and Finished Goods Lot identity. Extends Phase 1-4 without
-- touching any existing table. A Finished Goods Lot always traces back to a
-- sterilization cycle and a production Run (section 2): there is no
-- disconnected PF traceability.

-- ---------------------------------------------------------------------------
-- Packaging batch: the packaging process event (section 62), never merged
-- with the Finished Goods Lot identity it produces.
-- ---------------------------------------------------------------------------
CREATE TABLE packaging_batches (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_code               VARCHAR(32) NOT NULL UNIQUE,
    production_run_id        UUID NOT NULL REFERENCES production_runs (id),
    sterilization_cycle_id   UUID REFERENCES sterilization_cycles (id),
    product_id               UUID NOT NULL REFERENCES products (id),
    format                   VARCHAR(32),
    started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at                 TIMESTAMPTZ,
    status                   VARCHAR(16) NOT NULL DEFAULT 'PLANIFIE',
    responsible_user_id      UUID REFERENCES users (id),
    notes                    TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID NOT NULL REFERENCES users (id),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT packaging_batches_status_allowed
        CHECK (status IN ('PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE')),
    CONSTRAINT packaging_batches_end_after_start
        CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX packaging_batches_run_idx ON packaging_batches (production_run_id);
CREATE INDEX packaging_batches_status_idx ON packaging_batches (status);

-- ---------------------------------------------------------------------------
-- Finished Goods Lot: the finished-product traceability identity
-- (section 62), never the stock ledger itself (section 5: "do not store
-- current PF stock directly here" - see finished_goods_stock_movements in
-- 015_pf_stock.sql). quality_status is never automatically LIBERE just
-- because packaging is complete (section 19): every lot starts A_VERIFIER,
-- or BLOQUE outright if it inherits an unresolved upstream hold (section 68
-- of docs/regles-metier.md), and only an explicit Quality decision moves it
-- further.
-- ---------------------------------------------------------------------------
CREATE TABLE finished_good_lots (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_code              VARCHAR(32) NOT NULL UNIQUE,
    packaging_batch_id    UUID NOT NULL REFERENCES packaging_batches (id),
    production_run_id     UUID NOT NULL REFERENCES production_runs (id),
    product_id            UUID NOT NULL REFERENCES products (id),
    format                VARCHAR(32),
    pieces_per_can        SMALLINT,
    production_date       DATE NOT NULL,
    best_before_date      DATE,
    quality_status        VARCHAR(16) NOT NULL DEFAULT 'A_VERIFIER',
    commercial_status     VARCHAR(32),
    notes                 TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID NOT NULL REFERENCES users (id),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT finished_good_lots_quality_status_allowed
        CHECK (quality_status IN ('BLOQUE', 'A_VERIFIER', 'LIBERE', 'REJETE')),
    CONSTRAINT finished_good_lots_pieces_per_can_positive
        CHECK (pieces_per_can IS NULL OR pieces_per_can > 0),
    CONSTRAINT finished_good_lots_best_before_after_production
        CHECK (best_before_date IS NULL OR best_before_date >= production_date)
);

CREATE INDEX finished_good_lots_run_idx ON finished_good_lots (production_run_id);
CREATE INDEX finished_good_lots_batch_idx ON finished_good_lots (packaging_batch_id);
CREATE INDEX finished_good_lots_product_idx ON finished_good_lots (product_id);
CREATE INDEX finished_good_lots_quality_status_idx ON finished_good_lots (quality_status);
CREATE INDEX finished_good_lots_code_search_idx
    ON finished_good_lots (upper(lot_code) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- Finished Goods Lot sources: which sterilization cycle(s) and Run(s) fed a
-- given Lot PF (section 7). A relation table rather than a single FK, so one
-- Lot PF aggregating several sterilization cycles is never forced into a
-- single-cycle shape.
-- ---------------------------------------------------------------------------
CREATE TABLE finished_good_lot_sources (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finished_good_lot_id     UUID NOT NULL REFERENCES finished_good_lots (id),
    sterilization_cycle_id   UUID NOT NULL REFERENCES sterilization_cycles (id),
    production_run_id        UUID NOT NULL REFERENCES production_runs (id),
    quantity_units           BIGINT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT finished_good_lot_sources_quantity_positive
        CHECK (quantity_units IS NULL OR quantity_units > 0),
    CONSTRAINT finished_good_lot_sources_unique_cycle_per_lot
        UNIQUE (finished_good_lot_id, sterilization_cycle_id)
);

CREATE INDEX finished_good_lot_sources_lot_idx
    ON finished_good_lot_sources (finished_good_lot_id);
CREATE INDEX finished_good_lot_sources_cycle_idx
    ON finished_good_lot_sources (sterilization_cycle_id);
CREATE INDEX finished_good_lot_sources_run_idx
    ON finished_good_lot_sources (production_run_id);

-- ---------------------------------------------------------------------------
-- Packaging output: the packaged quantity, in aggregate lines rather than one
-- row per physical carton (section 8/9) - the simplest model that preserves
-- the traceability the specification actually requires.
-- ---------------------------------------------------------------------------
CREATE TABLE packaging_outputs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packaging_batch_id    UUID NOT NULL REFERENCES packaging_batches (id),
    finished_good_lot_id  UUID NOT NULL REFERENCES finished_good_lots (id),
    quantity_cans         BIGINT NOT NULL,
    quantity_cartons      BIGINT NOT NULL,
    units_per_carton      INTEGER NOT NULL,
    occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes                 TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID NOT NULL REFERENCES users (id),
    CONSTRAINT packaging_outputs_quantities_positive
        CHECK (quantity_cans > 0 AND quantity_cartons > 0 AND units_per_carton > 0)
);

CREATE INDEX packaging_outputs_batch_idx ON packaging_outputs (packaging_batch_id);
CREATE INDEX packaging_outputs_lot_idx ON packaging_outputs (finished_good_lot_id);

-- ---------------------------------------------------------------------------
-- Packaging label check: verification of the packaging/carton label
-- (section 10), distinct from the can-marking verification of Phase 4
-- (section 25 there): different subject, different point in the process.
-- `result` is a GENERATED column, never a manual selection (the same rule
-- applied to weight/seaming classification in Phase 4, section 16 there).
-- ---------------------------------------------------------------------------
CREATE TABLE packaging_label_checks (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packaging_batch_id     UUID NOT NULL REFERENCES packaging_batches (id),
    finished_good_lot_id   UUID NOT NULL REFERENCES finished_good_lots (id),
    checked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    product_correct        BOOLEAN NOT NULL,
    lot_correct             BOOLEAN NOT NULL,
    date_correct            BOOLEAN NOT NULL,
    label_correct           BOOLEAN NOT NULL,
    result VARCHAR(16) GENERATED ALWAYS AS (
        CASE WHEN product_correct AND lot_correct AND date_correct AND label_correct
             THEN 'CONFORME' ELSE 'NON_CONFORME' END
    ) STORED,
    checked_by              UUID NOT NULL REFERENCES users (id),
    notes                   TEXT
);

CREATE INDEX packaging_label_checks_lot_idx ON packaging_label_checks (finished_good_lot_id);
