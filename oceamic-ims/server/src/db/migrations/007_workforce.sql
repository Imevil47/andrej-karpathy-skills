-- OCEAMIC IMS - Phase 3
-- Workforce cadence: employees, Run workforce assignment, hourly control
-- rounds, employee cadence measurements, cadence standards and downtime.
-- Extends Phase 1/2 without touching any existing table.

-- ---------------------------------------------------------------------------
-- Employees. Never deleted: is_active preserves historical cadence records.
-- ---------------------------------------------------------------------------
CREATE TABLE employees (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_number  VARCHAR(32) NOT NULL UNIQUE,
    first_name       VARCHAR(64) NOT NULL,
    last_name        VARCHAR(64) NOT NULL,
    display_name     VARCHAR(128),
    department       VARCHAR(64),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX employees_number_search_idx ON employees (upper(employee_number) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- Run workforce: who is expected/present on which Run line, and when.
--
-- Deviation from a literal reading of the brief: this table carries no
-- activity_type of its own. The activity is a property of the Run line
-- (production_run_lines.activity_type), never of the person performing it;
-- storing it twice would let the two disagree. An employee's activity is
-- always read through production_run_line_id.
-- ---------------------------------------------------------------------------
CREATE TABLE production_run_employee_assignments (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id      UUID NOT NULL REFERENCES production_runs (id),
    production_run_line_id UUID NOT NULL REFERENCES production_run_lines (id),
    employee_id            UUID NOT NULL REFERENCES employees (id),
    assigned_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_until         TIMESTAMPTZ,
    is_present             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID NOT NULL REFERENCES users (id),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT run_assignments_until_after_from
        CHECK (assigned_until IS NULL OR assigned_until >= assigned_from)
);

-- An employee has at most one OPEN assignment per Run at any time. Moving a
-- person to another line closes the old assignment (assigned_until) and opens
-- a new one: history is never overwritten (section 50).
CREATE UNIQUE INDEX run_assignments_one_open_per_employee_per_run
    ON production_run_employee_assignments (production_run_id, employee_id)
    WHERE assigned_until IS NULL;

CREATE INDEX run_assignments_run_line_idx
    ON production_run_employee_assignments (production_run_line_id);
CREATE INDEX run_assignments_employee_idx
    ON production_run_employee_assignments (employee_id);

-- ---------------------------------------------------------------------------
-- Control round: one controller pass through the production area for a Run.
-- ---------------------------------------------------------------------------
CREATE TABLE control_rounds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_code          VARCHAR(32) NOT NULL UNIQUE,
    production_run_id   UUID NOT NULL REFERENCES production_runs (id),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    controller_user_id  UUID NOT NULL REFERENCES users (id),
    status              VARCHAR(16) NOT NULL DEFAULT 'EN_COURS',
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT control_rounds_status_allowed
        CHECK (status IN ('EN_COURS', 'TERMINE', 'ANNULE')),
    CONSTRAINT control_rounds_end_after_start
        CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX control_rounds_run_idx ON control_rounds (production_run_id);
CREATE INDEX control_rounds_status_idx ON control_rounds (status);
CREATE INDEX control_rounds_started_at_idx ON control_rounds (started_at DESC);

-- ---------------------------------------------------------------------------
-- Line control: one line visited during a control round.
-- expected_employee_count is a snapshot taken when the line is opened for
-- control (current present assignments on that line): attendance recorded
-- later must never silently rewrite an already-controlled coverage figure.
-- controlled_employee_count is deliberately NOT stored: it is always the live
-- count of valid employee controls, computed by the coverage view.
-- ---------------------------------------------------------------------------
CREATE TABLE line_controls (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    control_round_id         UUID NOT NULL REFERENCES control_rounds (id),
    production_run_id        UUID NOT NULL REFERENCES production_runs (id),
    production_run_line_id   UUID NOT NULL REFERENCES production_run_lines (id),
    controlled_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    activity_type            VARCHAR(32) NOT NULL,
    expected_employee_count  INTEGER NOT NULL DEFAULT 0,
    status                   VARCHAR(16) NOT NULL DEFAULT 'EN_COURS',
    notes                    TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               UUID NOT NULL REFERENCES users (id),
    CONSTRAINT line_controls_status_allowed CHECK (status IN ('EN_COURS', 'TERMINE')),
    CONSTRAINT line_controls_expected_not_negative CHECK (expected_employee_count >= 0),
    -- One line is visited at most once per round: reselecting the same line
    -- continues its existing control instead of creating a duplicate.
    CONSTRAINT line_controls_unique_per_round UNIQUE (control_round_id, production_run_line_id)
);

CREATE INDEX line_controls_round_idx ON line_controls (control_round_id);
CREATE INDEX line_controls_run_idx ON line_controls (production_run_id);
CREATE INDEX line_controls_run_line_idx ON line_controls (production_run_line_id);

-- ---------------------------------------------------------------------------
-- Cadence standards: expected performance references, configuration only.
-- size_grade is reserved for a future phase: Phase 3 Run context never
-- carries a single unambiguous size grade (a Run may consume several lots of
-- different grades), so matching never supplies one, and a standard scoped to
-- a size_grade is structurally excluded from every Phase 3 match.
-- ---------------------------------------------------------------------------
CREATE TABLE cadence_standards (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    species_id       UUID REFERENCES species (id),
    product_id       UUID REFERENCES products (id),
    activity_type    VARCHAR(32) NOT NULL,
    size_grade       VARCHAR(32),
    format           VARCHAR(32),
    pieces_per_can   SMALLINT,
    measurement_unit VARCHAR(16) NOT NULL,
    standard_cadence NUMERIC(10, 2) NOT NULL,
    valid_from       DATE,
    valid_to         DATE,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT standards_activity_allowed
        CHECK (activity_type IN ('GRATTAGE', 'REMPLISSAGE', 'GRATTAGE_REMPLISSAGE',
                                 'TRAITEMENT', 'AUTRE')),
    CONSTRAINT standards_unit_allowed
        CHECK (measurement_unit IN ('BOITES', 'PIECES', 'KG', 'UNITES')),
    CONSTRAINT standards_cadence_positive CHECK (standard_cadence > 0),
    CONSTRAINT standards_pieces_per_can_positive
        CHECK (pieces_per_can IS NULL OR pieces_per_can > 0),
    CONSTRAINT standards_valid_range
        CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX standards_activity_idx ON cadence_standards (activity_type);
CREATE INDEX standards_product_idx ON cadence_standards (product_id);
CREATE INDEX standards_species_idx ON cadence_standards (species_id);
CREATE INDEX standards_active_idx ON cadence_standards (is_active);

-- ---------------------------------------------------------------------------
-- Employee cadence control: one raw, measured performance record.
--
-- cadence_per_hour and performance_percent are STORED GENERATED columns: they
-- can never diverge from the raw quantity/duration/standard values that
-- produced them (PostgreSQL forbids typing a result directly and forbids a
-- generated column from drifting from its source columns).
--
-- standard_cadence_snapshot freezes the standard that applied at the moment
-- of measurement (section 51): a later change to cadence_standards never
-- rewrites this row's performance_percent, because the generated expression
-- reads the snapshot, never the live standards table.
-- ---------------------------------------------------------------------------
CREATE TABLE employee_cadence_controls (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_control_id               UUID NOT NULL REFERENCES line_controls (id),
    production_run_id             UUID NOT NULL REFERENCES production_runs (id),
    production_run_line_id        UUID NOT NULL REFERENCES production_run_lines (id),
    employee_id                   UUID NOT NULL REFERENCES employees (id),
    controlled_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    quantity_completed            NUMERIC(12, 3) NOT NULL,
    measurement_unit              VARCHAR(16) NOT NULL,
    measurement_duration_seconds  INTEGER NOT NULL,
    cadence_per_hour NUMERIC(12, 2) GENERATED ALWAYS AS (
        round(quantity_completed / (measurement_duration_seconds / 3600.0), 2)
    ) STORED,
    cadence_standard_id           UUID REFERENCES cadence_standards (id),
    standard_cadence_snapshot     NUMERIC(10, 2),
    performance_percent NUMERIC(6, 2) GENERATED ALWAYS AS (
        CASE
            WHEN standard_cadence_snapshot IS NULL OR standard_cadence_snapshot = 0 THEN NULL
            ELSE round(
                (quantity_completed / (measurement_duration_seconds / 3600.0))
                / standard_cadence_snapshot * 100,
                2
            )
        END
    ) STORED,
    status                 VARCHAR(16) NOT NULL DEFAULT 'VALIDE',
    -- Correction fields: same reversal-and-replace policy as
    -- production_run_materials. A validated measurement is never edited.
    cancelled_at           TIMESTAMPTZ,
    cancelled_by           UUID REFERENCES users (id),
    cancellation_reason    TEXT,
    replaces_id            UUID UNIQUE REFERENCES employee_cadence_controls (id),
    notes                  TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by              UUID NOT NULL REFERENCES users (id),
    CONSTRAINT cadence_controls_quantity_not_negative CHECK (quantity_completed >= 0),
    CONSTRAINT cadence_controls_duration_positive CHECK (measurement_duration_seconds > 0),
    CONSTRAINT cadence_controls_unit_allowed
        CHECK (measurement_unit IN ('BOITES', 'PIECES', 'KG', 'UNITES')),
    CONSTRAINT cadence_controls_status_allowed CHECK (status IN ('VALIDE', 'ANNULE')),
    CONSTRAINT cadence_controls_not_self_replacing CHECK (replaces_id IS NULL OR replaces_id <> id),
    CONSTRAINT cadence_controls_cancelled_is_documented
        CHECK (status <> 'ANNULE'
               OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
                   AND cancellation_reason IS NOT NULL)),
    CONSTRAINT cadence_controls_valid_is_open
        CHECK (status <> 'VALIDE' OR (cancelled_at IS NULL AND cancelled_by IS NULL))
);

-- An employee is controlled at most once per line control while the row is
-- valid. A correction cancels the row and may insert a replacement, which the
-- partial index allows because the cancelled row no longer counts.
CREATE UNIQUE INDEX cadence_controls_one_valid_per_employee_per_line
    ON employee_cadence_controls (line_control_id, employee_id)
    WHERE status = 'VALIDE';

CREATE INDEX cadence_controls_line_control_idx ON employee_cadence_controls (line_control_id);
CREATE INDEX cadence_controls_employee_idx ON employee_cadence_controls (employee_id);
CREATE INDEX cadence_controls_run_idx ON employee_cadence_controls (production_run_id);
CREATE INDEX cadence_controls_controlled_at_idx ON employee_cadence_controls (controlled_at DESC);
CREATE INDEX cadence_controls_status_idx ON employee_cadence_controls (status);

-- ---------------------------------------------------------------------------
-- Downtime: production interruptions, scoped to a Run or to one of its lines.
-- ---------------------------------------------------------------------------
CREATE TABLE downtime_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An open downtime has ended_at = NULL: that single field is the only source
-- of truth for "active", so there is no separate status column that could
-- disagree with it.
CREATE TABLE downtime_events (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id        UUID NOT NULL REFERENCES production_runs (id),
    production_run_line_id   UUID REFERENCES production_run_lines (id),
    started_at               TIMESTAMPTZ NOT NULL,
    ended_at                 TIMESTAMPTZ,
    duration_seconds INTEGER GENERATED ALWAYS AS (
        CASE WHEN ended_at IS NULL THEN NULL
             ELSE EXTRACT(EPOCH FROM (ended_at - started_at))::integer
        END
    ) STORED,
    downtime_category_id     UUID NOT NULL REFERENCES downtime_categories (id),
    reason_text              TEXT,
    planned                  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID NOT NULL REFERENCES users (id),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT downtime_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX downtime_run_idx ON downtime_events (production_run_id);
CREATE INDEX downtime_run_line_idx ON downtime_events (production_run_line_id);
CREATE INDEX downtime_started_at_idx ON downtime_events (started_at DESC);
CREATE INDEX downtime_category_idx ON downtime_events (downtime_category_id);
-- Fast lookup of currently active downtime events (ended_at IS NULL) for the
-- home page and the "Arrêt toujours en cours" alert.
CREATE INDEX downtime_active_idx ON downtime_events (production_run_id) WHERE ended_at IS NULL;
