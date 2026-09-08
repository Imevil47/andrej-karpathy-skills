-- OCEAMIC IMS - Phase 4
-- Filling operations, filling configuration and filling weight control.
-- Extends Phase 1/2/3 without touching any existing table. A filling
-- operation always belongs to an existing Production Run: there is no
-- disconnected downstream process (section 3).

-- ---------------------------------------------------------------------------
-- Filling media: configurable master data, never hardcoded in components.
-- ---------------------------------------------------------------------------
CREATE TABLE filling_media (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Product filling configuration: weight thresholds are configurable and
-- historical, never hardcoded (section 8). A later change to a spec must
-- never rewrite a control already recorded against it (section 54) - see the
-- snapshot columns on filling_weight_controls and filling_weight_samples.
-- ---------------------------------------------------------------------------
CREATE TABLE product_filling_specs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id              UUID NOT NULL REFERENCES products (id),
    format                  VARCHAR(32),
    pieces_per_can          SMALLINT,
    target_net_weight_g     NUMERIC(8, 2),
    min_weight_g            NUMERIC(8, 2) NOT NULL,
    max_weight_g            NUMERIC(8, 2) NOT NULL,
    target_fish_weight_g    NUMERIC(8, 2),
    target_medium_weight_g  NUMERIC(8, 2),
    valid_from              DATE,
    valid_to                DATE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT filling_specs_max_above_min CHECK (max_weight_g > min_weight_g),
    CONSTRAINT filling_specs_pieces_positive
        CHECK (pieces_per_can IS NULL OR pieces_per_can > 0),
    CONSTRAINT filling_specs_valid_range
        CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX filling_specs_product_idx ON product_filling_specs (product_id);
CREATE INDEX filling_specs_active_idx ON product_filling_specs (is_active);

-- ---------------------------------------------------------------------------
-- Filling operation: the production filling context. Always attached to an
-- existing Run (section 6); the line and medium are optional.
-- ---------------------------------------------------------------------------
CREATE TABLE filling_operations (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_code        VARCHAR(32) NOT NULL UNIQUE,
    production_run_id     UUID NOT NULL REFERENCES production_runs (id),
    production_line_id    UUID REFERENCES production_lines (id),
    product_id            UUID NOT NULL REFERENCES products (id),
    started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at              TIMESTAMPTZ,
    format                VARCHAR(32),
    pieces_per_can        SMALLINT,
    filling_medium_id     UUID REFERENCES filling_media (id),
    status                VARCHAR(16) NOT NULL DEFAULT 'PLANIFIE',
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL REFERENCES users (id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT filling_ops_status_allowed
        CHECK (status IN ('PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE')),
    CONSTRAINT filling_ops_pieces_positive
        CHECK (pieces_per_can IS NULL OR pieces_per_can > 0),
    CONSTRAINT filling_ops_end_after_start
        CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX filling_ops_run_idx ON filling_operations (production_run_id);
CREATE INDEX filling_ops_status_idx ON filling_operations (status);
CREATE INDEX filling_ops_started_at_idx ON filling_operations (started_at DESC);

-- ---------------------------------------------------------------------------
-- Weight control: one sampling event, belonging to a Run + a filling
-- operation (section 9). The specification's critical limits are snapshotted
-- here so a later change to product_filling_specs never rewrites this
-- control's classification (section 54).
-- ---------------------------------------------------------------------------
CREATE TABLE filling_weight_controls (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    control_code                  VARCHAR(32) NOT NULL UNIQUE,
    filling_operation_id          UUID NOT NULL REFERENCES filling_operations (id),
    production_run_id             UUID NOT NULL REFERENCES production_runs (id),
    controlled_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    controller_user_id            UUID NOT NULL REFERENCES users (id),
    -- Configurable sample size (section 11): a control currently expects 20,
    -- but the number is never hardcoded into the schema.
    sample_size                   SMALLINT NOT NULL,
    specification_id              UUID REFERENCES product_filling_specs (id),
    min_weight_g_snapshot         NUMERIC(8, 2),
    max_weight_g_snapshot         NUMERIC(8, 2),
    target_net_weight_g_snapshot  NUMERIC(8, 2),
    notes                         TEXT,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT filling_weight_controls_sample_size_positive CHECK (sample_size > 0)
);

CREATE INDEX filling_weight_controls_operation_idx
    ON filling_weight_controls (filling_operation_id);
CREATE INDEX filling_weight_controls_run_idx ON filling_weight_controls (production_run_id);
CREATE INDEX filling_weight_controls_controlled_at_idx
    ON filling_weight_controls (controlled_at DESC);

-- ---------------------------------------------------------------------------
-- Individual can weights: one row per measured can (section 10), never fixed
-- weight_1..weight_20 columns. min_weight_g/max_weight_g are copied from the
-- control's snapshot at insert time so `status` (the weight classification,
-- section 12) is a same-row GENERATED column (PostgreSQL forbids a generated
-- column from reading another table), which makes the classification
-- structurally impossible to type manually or to get out of sync with the
-- limits used to compute it.
--
-- `record_status` is a different concept: the correction lifecycle
-- (section 58). A validated sample is never edited in place - a mistyped
-- entry is cancelled (record_status = 'ANNULE') and a replacement row is
-- inserted, exactly the reversal-and-replace policy already used for
-- consumption (Phase 2) and cadence controls (Phase 3).
-- ---------------------------------------------------------------------------
CREATE TABLE filling_weight_samples (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    weight_control_id     UUID NOT NULL REFERENCES filling_weight_controls (id),
    sample_number         SMALLINT NOT NULL,
    measured_weight_g     NUMERIC(8, 2) NOT NULL,
    min_weight_g          NUMERIC(8, 2) NOT NULL,
    max_weight_g          NUMERIC(8, 2) NOT NULL,
    status VARCHAR(16) GENERATED ALWAYS AS (
        CASE WHEN measured_weight_g < min_weight_g THEN 'SOUS_POIDS'
             WHEN measured_weight_g > max_weight_g THEN 'SURPOIDS'
             ELSE 'CONFORME'
        END
    ) STORED,
    -- Signed distance from the nearest breached limit; 0 when conforming.
    deviation_g NUMERIC(8, 2) GENERATED ALWAYS AS (
        CASE WHEN measured_weight_g < min_weight_g THEN measured_weight_g - min_weight_g
             WHEN measured_weight_g > max_weight_g THEN measured_weight_g - max_weight_g
             ELSE 0
        END
    ) STORED,
    record_status         VARCHAR(16) NOT NULL DEFAULT 'VALIDE',
    cancelled_at          TIMESTAMPTZ,
    cancelled_by          UUID REFERENCES users (id),
    cancellation_reason   TEXT,
    replaces_id           UUID UNIQUE REFERENCES filling_weight_samples (id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL REFERENCES users (id),
    CONSTRAINT filling_samples_weight_positive CHECK (measured_weight_g > 0),
    CONSTRAINT filling_samples_record_status_allowed CHECK (record_status IN ('VALIDE', 'ANNULE')),
    CONSTRAINT filling_samples_not_self_replacing CHECK (replaces_id IS NULL OR replaces_id <> id),
    CONSTRAINT filling_samples_cancelled_is_documented
        CHECK (record_status <> 'ANNULE'
               OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
                   AND cancellation_reason IS NOT NULL)),
    CONSTRAINT filling_samples_valid_is_open
        CHECK (record_status <> 'VALIDE' OR (cancelled_at IS NULL AND cancelled_by IS NULL))
);

-- A sample number is used at most once while valid; a correction cancels the
-- row and inserts its replacement under the same number.
CREATE UNIQUE INDEX filling_samples_one_valid_per_number
    ON filling_weight_samples (weight_control_id, sample_number)
    WHERE record_status = 'VALIDE';

CREATE INDEX filling_samples_control_idx ON filling_weight_samples (weight_control_id);
CREATE INDEX filling_samples_status_idx ON filling_weight_samples (status);
