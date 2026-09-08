-- OCEAMIC IMS - Phase 4
-- Sterilization programs and cycles, CCP controls, process deviations,
-- corrective actions, cooling, and the production Run hold used to keep
-- unresolved critical process issues from silently reaching finished goods.

-- ---------------------------------------------------------------------------
-- Sterilization program: the controlled process specification (section 30).
-- Never hardcoded inside the sterilization screen.
-- ---------------------------------------------------------------------------
CREATE TABLE sterilization_programs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                   VARCHAR(32) NOT NULL UNIQUE,
    name                   VARCHAR(128) NOT NULL,
    product_id             UUID REFERENCES products (id),
    format                 VARCHAR(32),
    target_temperature_c   NUMERIC(6, 2),
    target_pressure_bar    NUMERIC(6, 2),
    target_f0              NUMERIC(8, 2),
    minimum_f0             NUMERIC(8, 2),
    maximum_f0             NUMERIC(8, 2),
    holding_time_seconds   INTEGER,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    valid_from             DATE,
    valid_to               DATE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sterilization_programs_f0_range
        CHECK (minimum_f0 IS NULL OR maximum_f0 IS NULL OR maximum_f0 >= minimum_f0),
    CONSTRAINT sterilization_programs_holding_time_positive
        CHECK (holding_time_seconds IS NULL OR holding_time_seconds > 0),
    CONSTRAINT sterilization_programs_valid_range
        CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX sterilization_programs_product_idx ON sterilization_programs (product_id);

-- ---------------------------------------------------------------------------
-- Sterilization cycle: the thermal process event (section 27), one of the
-- most important Phase 4 entities.
--
-- Deviation from the literal field list of section 27: there is no direct
-- production_run_id column here. Section 29 asks, architecturally, not to
-- assume a cycle forever holds a single Run, and to prefer a relation table -
-- so the Run relationship lives exclusively in sterilization_cycle_loads
-- below. A single legacy column would either duplicate that relation or grow
-- stale the day a cycle carries more than one Run's material.
--
-- The program's critical limits are snapshotted at cycle start (section 54):
-- a later edit to sterilization_programs must never rewrite an
-- already-evaluated CCP decision.
-- ---------------------------------------------------------------------------
CREATE TABLE sterilization_cycles (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_code                      VARCHAR(32) NOT NULL UNIQUE,
    autoclave_id                    UUID NOT NULL REFERENCES equipment (id),
    started_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at                        TIMESTAMPTZ,
    sterilization_program_id        UUID NOT NULL REFERENCES sterilization_programs (id),
    target_f0_snapshot              NUMERIC(8, 2),
    minimum_f0_snapshot             NUMERIC(8, 2),
    maximum_f0_snapshot             NUMERIC(8, 2),
    target_temperature_c_snapshot   NUMERIC(6, 2),
    target_pressure_bar_snapshot    NUMERIC(6, 2),
    holding_time_seconds_snapshot   INTEGER,
    status                          VARCHAR(16) NOT NULL DEFAULT 'PLANIFIE',
    operator_user_id                UUID REFERENCES users (id),
    notes                           TEXT,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sterilization_cycles_status_allowed
        CHECK (status IN ('PLANIFIE', 'EN_CHARGEMENT', 'EN_COURS', 'TERMINE', 'A_VERIFIER',
                          'BLOQUE', 'ANNULE')),
    CONSTRAINT sterilization_cycles_end_after_start
        CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX sterilization_cycles_autoclave_idx ON sterilization_cycles (autoclave_id);
CREATE INDEX sterilization_cycles_status_idx ON sterilization_cycles (status);
CREATE INDEX sterilization_cycles_started_at_idx ON sterilization_cycles (started_at DESC);

-- ---------------------------------------------------------------------------
-- Sterilization cycle loads: which Run(s) a cycle sterilizes (section 29).
-- Future-safe by construction: nothing elsewhere assumes exactly one row.
-- ---------------------------------------------------------------------------
CREATE TABLE sterilization_cycle_loads (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sterilization_cycle_id   UUID NOT NULL REFERENCES sterilization_cycles (id),
    production_run_id        UUID NOT NULL REFERENCES production_runs (id),
    quantity_units           INTEGER,
    basket_reference         VARCHAR(64),
    notes                    TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sterilization_loads_quantity_positive
        CHECK (quantity_units IS NULL OR quantity_units > 0),
    CONSTRAINT sterilization_loads_unique_run_per_cycle
        UNIQUE (sterilization_cycle_id, production_run_id)
);

CREATE INDEX sterilization_loads_cycle_idx ON sterilization_cycle_loads (sterilization_cycle_id);
CREATE INDEX sterilization_loads_run_idx ON sterilization_cycle_loads (production_run_id);

-- ---------------------------------------------------------------------------
-- Process measurements: distinct from a CCP decision (section 31/33).
-- source_type never pretends an unconnected autoclave is feeding live data
-- (section 52): MANUEL is the only source Phase 4 actually produces, but the
-- columns exist so a future integration writes into the same table without a
-- migration and without ever overwriting a manual record (section 53).
-- ---------------------------------------------------------------------------
-- record_status/cancelled_*/replaces_id: same correction policy as every
-- other Phase 4 measurement table (section 58) - a validated reading is
-- cancelled and replaced, never edited.
CREATE TABLE sterilization_measurements (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sterilization_cycle_id   UUID NOT NULL REFERENCES sterilization_cycles (id),
    measured_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    temperature_c            NUMERIC(6, 2),
    pressure_bar             NUMERIC(6, 2),
    f0_value                 NUMERIC(8, 2),
    phase                    VARCHAR(32),
    source_type              VARCHAR(16) NOT NULL DEFAULT 'MANUEL',
    source_reference         VARCHAR(64),
    imported_at              TIMESTAMPTZ,
    record_status            VARCHAR(16) NOT NULL DEFAULT 'VALIDE',
    cancelled_at             TIMESTAMPTZ,
    cancelled_by             UUID REFERENCES users (id),
    cancellation_reason      TEXT,
    replaces_id              UUID UNIQUE REFERENCES sterilization_measurements (id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID NOT NULL REFERENCES users (id),
    CONSTRAINT sterilization_measurements_source_allowed
        CHECK (source_type IN ('MANUEL', 'EQUIPEMENT', 'IMPORT')),
    CONSTRAINT sterilization_measurements_has_value
        CHECK (temperature_c IS NOT NULL OR pressure_bar IS NOT NULL OR f0_value IS NOT NULL),
    CONSTRAINT sterilization_measurements_record_status_allowed
        CHECK (record_status IN ('VALIDE', 'ANNULE')),
    CONSTRAINT sterilization_measurements_not_self_replacing
        CHECK (replaces_id IS NULL OR replaces_id <> id),
    CONSTRAINT sterilization_measurements_cancelled_is_documented
        CHECK (record_status <> 'ANNULE'
               OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
                   AND cancellation_reason IS NOT NULL))
);

CREATE INDEX sterilization_measurements_cycle_idx
    ON sterilization_measurements (sterilization_cycle_id);
CREATE INDEX sterilization_measurements_measured_at_idx
    ON sterilization_measurements (measured_at DESC);

-- ---------------------------------------------------------------------------
-- CCP control: the food-safety critical-control decision (section 32),
-- structurally distinct from the raw process measurements above. Only a
-- controller holding ccp:validate (Quality/Admin - never Production on its
-- own) can create this row (section 36).
-- ---------------------------------------------------------------------------
-- record_status/cancelled_*/replaces_id: same correction policy (section 58).
-- A CCP decision is never edited: a mistaken entry is cancelled and a
-- replacement recorded, both kept in the audited history.
CREATE TABLE ccp_controls (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sterilization_cycle_id   UUID NOT NULL REFERENCES sterilization_cycles (id),
    controlled_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    ccp_type                 VARCHAR(32) NOT NULL,
    result                   VARCHAR(16) NOT NULL,
    decision                 VARCHAR(16) NOT NULL,
    controller_user_id       UUID NOT NULL REFERENCES users (id),
    notes                    TEXT,
    record_status            VARCHAR(16) NOT NULL DEFAULT 'VALIDE',
    cancelled_at             TIMESTAMPTZ,
    cancelled_by             UUID REFERENCES users (id),
    cancellation_reason      TEXT,
    replaces_id              UUID UNIQUE REFERENCES ccp_controls (id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ccp_controls_result_allowed
        CHECK (result IN ('CONFORME', 'NON_CONFORME', 'DEVIATION', 'A_VERIFIER')),
    CONSTRAINT ccp_controls_decision_allowed
        CHECK (decision IN ('LIBERE', 'RETENU', 'A_VERIFIER')),
    CONSTRAINT ccp_controls_record_status_allowed CHECK (record_status IN ('VALIDE', 'ANNULE')),
    CONSTRAINT ccp_controls_not_self_replacing CHECK (replaces_id IS NULL OR replaces_id <> id),
    CONSTRAINT ccp_controls_cancelled_is_documented
        CHECK (record_status <> 'ANNULE'
               OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
                   AND cancellation_reason IS NOT NULL))
);

CREATE INDEX ccp_controls_cycle_idx ON ccp_controls (sterilization_cycle_id);
CREATE INDEX ccp_controls_controlled_at_idx ON ccp_controls (controlled_at DESC);

-- ---------------------------------------------------------------------------
-- Process deviations and lightweight corrective actions (section 37/38). Full
-- CAPA is explicitly out of scope for Phase 4.
-- ---------------------------------------------------------------------------
CREATE TABLE process_deviations (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deviation_code           VARCHAR(32) NOT NULL UNIQUE,
    production_run_id        UUID REFERENCES production_runs (id),
    sterilization_cycle_id   UUID REFERENCES sterilization_cycles (id),
    process_stage             VARCHAR(32) NOT NULL,
    detected_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    deviation_type             VARCHAR(64) NOT NULL,
    description                TEXT NOT NULL,
    severity                   VARCHAR(16) NOT NULL,
    status                     VARCHAR(16) NOT NULL DEFAULT 'OUVERTE',
    detected_by                UUID NOT NULL REFERENCES users (id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT deviations_severity_allowed CHECK (severity IN ('MINEURE', 'MAJEURE', 'CRITIQUE')),
    CONSTRAINT deviations_status_allowed
        CHECK (status IN ('OUVERTE', 'EN_ANALYSE', 'ACTION_REQUISE', 'CLOTUREE', 'ANNULEE')),
    CONSTRAINT deviations_has_scope
        CHECK (production_run_id IS NOT NULL OR sterilization_cycle_id IS NOT NULL)
);

CREATE INDEX deviations_run_idx ON process_deviations (production_run_id);
CREATE INDEX deviations_cycle_idx ON process_deviations (sterilization_cycle_id);
CREATE INDEX deviations_status_idx ON process_deviations (status);

CREATE TABLE process_corrective_actions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_deviation_id     UUID NOT NULL REFERENCES process_deviations (id),
    action_description       TEXT NOT NULL,
    responsible_user_id      UUID REFERENCES users (id),
    due_at                   TIMESTAMPTZ,
    completed_at             TIMESTAMPTZ,
    verification_notes       TEXT,
    status                   VARCHAR(16) NOT NULL DEFAULT 'OUVERTE',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT corrective_actions_status_allowed
        CHECK (status IN ('OUVERTE', 'EN_COURS', 'TERMINEE', 'ANNULEE')),
    CONSTRAINT corrective_actions_completed_is_documented
        CHECK (status <> 'TERMINEE' OR completed_at IS NOT NULL)
);

CREATE INDEX corrective_actions_deviation_idx
    ON process_corrective_actions (process_deviation_id);

-- ---------------------------------------------------------------------------
-- Cooling: post-sterilization cooling process (section 42), separate table,
-- never merged into the cycle itself.
-- ---------------------------------------------------------------------------
CREATE TABLE cooling_events (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sterilization_cycle_id        UUID NOT NULL REFERENCES sterilization_cycles (id),
    started_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at                      TIMESTAMPTZ,
    cooling_method                VARCHAR(32),
    water_temperature_c           NUMERIC(6, 2),
    final_product_temperature_c   NUMERIC(6, 2),
    result                        VARCHAR(16),
    notes                         TEXT,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                     UUID NOT NULL REFERENCES users (id),
    CONSTRAINT cooling_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT cooling_result_allowed
        CHECK (result IS NULL OR result IN ('CONFORME', 'NON_CONFORME', 'A_VERIFIER'))
);

CREATE INDEX cooling_events_cycle_idx ON cooling_events (sterilization_cycle_id);

CREATE TABLE cooling_measurements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cooling_event_id    UUID NOT NULL REFERENCES cooling_events (id),
    measured_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    parameter            VARCHAR(32) NOT NULL,
    value                NUMERIC(10, 3) NOT NULL,
    unit                 VARCHAR(16) NOT NULL,
    status                VARCHAR(16),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cooling_measurements_status_allowed
        CHECK (status IS NULL OR status IN ('CONFORME', 'NON_CONFORME', 'A_VERIFIER'))
);

CREATE INDEX cooling_measurements_event_idx ON cooling_measurements (cooling_event_id);

-- ---------------------------------------------------------------------------
-- Production Run hold: reuses the Quality lot-block lifecycle (ACTIF -> LEVE,
-- reason, audited) instead of inventing an unrelated truth (section 41). A
-- hold on a Run keeps that Run's material from silently continuing towards a
-- future finished-goods release while a critical CCP decision is unresolved.
-- ---------------------------------------------------------------------------
CREATE TABLE production_run_holds (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id        UUID NOT NULL REFERENCES production_runs (id),
    sterilization_cycle_id   UUID REFERENCES sterilization_cycles (id),
    process_deviation_id     UUID REFERENCES process_deviations (id),
    held_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    held_by                  UUID NOT NULL REFERENCES users (id),
    reason                   TEXT NOT NULL,
    status                   VARCHAR(16) NOT NULL DEFAULT 'ACTIF',
    released_at              TIMESTAMPTZ,
    released_by              UUID REFERENCES users (id),
    release_reason           TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT run_holds_status_allowed CHECK (status IN ('ACTIF', 'LEVE')),
    CONSTRAINT run_holds_release_is_documented
        CHECK (status <> 'LEVE'
               OR (released_at IS NOT NULL AND released_by IS NOT NULL
                   AND release_reason IS NOT NULL))
);

-- At most one active hold per Run: released history is preserved, never
-- overwritten, exactly like lot_blocks_one_active_per_lot in Phase 1.
CREATE UNIQUE INDEX run_holds_one_active_per_run
    ON production_run_holds (production_run_id)
    WHERE status = 'ACTIF';

CREATE INDEX run_holds_run_idx ON production_run_holds (production_run_id);
