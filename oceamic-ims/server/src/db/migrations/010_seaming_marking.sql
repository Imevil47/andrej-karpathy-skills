-- OCEAMIC IMS - Phase 4
-- Equipment foundation, seaming operations/controls/measurements, and
-- marking events. Extends Phase 1/2/3 without touching any existing table.

-- ---------------------------------------------------------------------------
-- Equipment: reusable foundation, not a maintenance CMMS (section 21). Autoclaves
-- and seamers are identifiable equipment, never free text (section 28).
-- ---------------------------------------------------------------------------
CREATE TABLE equipment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(32) NOT NULL UNIQUE,
    name            VARCHAR(128) NOT NULL,
    equipment_type  VARCHAR(32) NOT NULL,
    location_id     UUID REFERENCES locations (id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT equipment_type_allowed
        CHECK (equipment_type IN ('SERTISSEUSE', 'AUTOCLAVE', 'REMPLISSEUSE', 'AUTRE'))
);

CREATE INDEX equipment_type_idx ON equipment (equipment_type);

-- ---------------------------------------------------------------------------
-- Seaming operation: the seaming production context (section 20).
-- ---------------------------------------------------------------------------
CREATE TABLE seaming_operations (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_code         VARCHAR(32) NOT NULL UNIQUE,
    production_run_id      UUID NOT NULL REFERENCES production_runs (id),
    filling_operation_id   UUID REFERENCES filling_operations (id),
    machine_id             UUID REFERENCES equipment (id),
    production_line_id     UUID REFERENCES production_lines (id),
    started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at               TIMESTAMPTZ,
    status                 VARCHAR(16) NOT NULL DEFAULT 'PLANIFIE',
    notes                  TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by              UUID NOT NULL REFERENCES users (id),
    CONSTRAINT seaming_ops_status_allowed
        CHECK (status IN ('PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE')),
    CONSTRAINT seaming_ops_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX seaming_ops_run_idx ON seaming_operations (production_run_id);
CREATE INDEX seaming_ops_status_idx ON seaming_operations (status);

-- ---------------------------------------------------------------------------
-- Seaming parameters and specifications: configurable, never hardcoded
-- (section 23/24). A historical control must keep the limits that applied at
-- the time (section 24), preserved via the snapshot columns on
-- seaming_measurements below.
-- ---------------------------------------------------------------------------
CREATE TABLE seaming_parameters (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code           VARCHAR(32) NOT NULL UNIQUE,
    name           VARCHAR(128) NOT NULL,
    default_unit   VARCHAR(16) NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seaming_specifications (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seaming_parameter_id   UUID NOT NULL REFERENCES seaming_parameters (id),
    product_id             UUID REFERENCES products (id),
    format                 VARCHAR(32),
    min_value              NUMERIC(10, 3),
    max_value              NUMERIC(10, 3),
    target_value           NUMERIC(10, 3),
    unit                   VARCHAR(16) NOT NULL,
    valid_from             DATE,
    valid_to               DATE,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT seaming_specs_has_limit CHECK (min_value IS NOT NULL OR max_value IS NOT NULL),
    CONSTRAINT seaming_specs_range
        CHECK (min_value IS NULL OR max_value IS NULL OR max_value >= min_value),
    CONSTRAINT seaming_specs_valid_range
        CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX seaming_specs_parameter_idx ON seaming_specifications (seaming_parameter_id);
CREATE INDEX seaming_specs_product_idx ON seaming_specifications (product_id);

-- ---------------------------------------------------------------------------
-- Seaming control: a quality inspection of the seam (section 22).
--
-- Deviation from a literal reading of the brief: this table carries no
-- `result` column of its own. A control's overall result depends on every
-- measurement recorded under it, and PostgreSQL cannot generate a column from
-- another table's rows - the same reasoning that keeps
-- `controlled_employee_count` out of `line_controls` in Phase 3. `result` is
-- therefore always read live from `seaming_control_result`, never stored,
-- never manually set (section 16's "never make the controller select status
-- manually" applies here identically).
-- ---------------------------------------------------------------------------
CREATE TABLE seaming_controls (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seaming_operation_id    UUID NOT NULL REFERENCES seaming_operations (id),
    production_run_id       UUID NOT NULL REFERENCES production_runs (id),
    controlled_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    controller_user_id      UUID NOT NULL REFERENCES users (id),
    machine_id              UUID REFERENCES equipment (id),
    notes                   TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX seaming_controls_operation_idx ON seaming_controls (seaming_operation_id);
CREATE INDEX seaming_controls_run_idx ON seaming_controls (production_run_id);
CREATE INDEX seaming_controls_controlled_at_idx ON seaming_controls (controlled_at DESC);

-- ---------------------------------------------------------------------------
-- Seaming measurements: rows, never fixed columns per parameter (section 23).
-- min/max/target are copied from the matched specification at insert time so
-- `status` is a same-row GENERATED column, exactly the pattern used for
-- filling_weight_samples.
-- ---------------------------------------------------------------------------
-- record_status/cancelled_*/replaces_id implement the same correction policy
-- as filling_weight_samples (section 58): a validated measurement is never
-- edited, only cancelled and replaced.
CREATE TABLE seaming_measurements (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seaming_control_id       UUID NOT NULL REFERENCES seaming_controls (id),
    seaming_parameter_id     UUID NOT NULL REFERENCES seaming_parameters (id),
    sample_number            SMALLINT,
    measured_value           NUMERIC(10, 3) NOT NULL,
    unit                     VARCHAR(16) NOT NULL,
    specification_id         UUID REFERENCES seaming_specifications (id),
    min_value_snapshot       NUMERIC(10, 3),
    max_value_snapshot       NUMERIC(10, 3),
    target_value_snapshot    NUMERIC(10, 3),
    status VARCHAR(16) GENERATED ALWAYS AS (
        CASE WHEN min_value_snapshot IS NULL AND max_value_snapshot IS NULL THEN NULL
             WHEN min_value_snapshot IS NOT NULL AND measured_value < min_value_snapshot THEN 'NON_CONFORME'
             WHEN max_value_snapshot IS NOT NULL AND measured_value > max_value_snapshot THEN 'NON_CONFORME'
             ELSE 'CONFORME'
        END
    ) STORED,
    record_status         VARCHAR(16) NOT NULL DEFAULT 'VALIDE',
    cancelled_at          TIMESTAMPTZ,
    cancelled_by          UUID REFERENCES users (id),
    cancellation_reason   TEXT,
    replaces_id           UUID UNIQUE REFERENCES seaming_measurements (id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID NOT NULL REFERENCES users (id),
    CONSTRAINT seaming_measurements_record_status_allowed
        CHECK (record_status IN ('VALIDE', 'ANNULE')),
    CONSTRAINT seaming_measurements_not_self_replacing CHECK (replaces_id IS NULL OR replaces_id <> id),
    CONSTRAINT seaming_measurements_cancelled_is_documented
        CHECK (record_status <> 'ANNULE'
               OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
                   AND cancellation_reason IS NOT NULL))
);

CREATE INDEX seaming_measurements_control_idx ON seaming_measurements (seaming_control_id);
CREATE INDEX seaming_measurements_parameter_idx ON seaming_measurements (seaming_parameter_id);

-- ---------------------------------------------------------------------------
-- Marking: traceable coding before sterilization (section 25). Verification
-- uses configurable check items (section 26) rather than a fixed field per
-- possible check.
-- ---------------------------------------------------------------------------
CREATE TABLE marking_verification_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE marking_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id       UUID NOT NULL REFERENCES production_runs (id),
    seaming_operation_id    UUID REFERENCES seaming_operations (id),
    marked_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    marking_code            VARCHAR(64) NOT NULL,
    lot_code_printed        VARCHAR(64),
    machine_id              UUID REFERENCES equipment (id),
    status                  VARCHAR(16) NOT NULL DEFAULT 'A_VERIFIER',
    verified_by             UUID REFERENCES users (id),
    verified_at             TIMESTAMPTZ,
    notes                   TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               UUID NOT NULL REFERENCES users (id),
    CONSTRAINT marking_status_allowed CHECK (status IN ('A_VERIFIER', 'VERIFIE', 'NON_CONFORME')),
    CONSTRAINT marking_verification_is_documented
        CHECK (status = 'A_VERIFIER' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE INDEX marking_events_run_idx ON marking_events (production_run_id);
CREATE INDEX marking_events_status_idx ON marking_events (status);

CREATE TABLE marking_event_checks (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marking_event_id              UUID NOT NULL REFERENCES marking_events (id),
    marking_verification_item_id  UUID NOT NULL REFERENCES marking_verification_items (id),
    passed                        BOOLEAN NOT NULL,
    notes                         TEXT,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT marking_checks_unique_item UNIQUE (marking_event_id, marking_verification_item_id)
);

CREATE INDEX marking_checks_event_idx ON marking_event_checks (marking_event_id);
