-- OCEAMIC IMS - Phase 7
-- Maintenance / CMMS layer, part 2: failure reporting (section 10).
-- FAILURE REPORT is the observed breakdown/event, a distinct concept from
-- the work order that later authorizes repairing it (section 66) - the two
-- are never collapsed into one table.

CREATE TABLE failure_modes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE failure_causes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Failure severity is how bad THIS event is; equipment.criticality (added in
-- 026) is how important the ASSET is - a FAIBLE-criticality machine can still
-- have a CRITIQUE failure, and the two columns are never merged (section 9).
--
-- downtime_event_id is a genuine link, never a duplicate record: a failure
-- that stops an active Run reuses services/downtime.ts's startDowntime/
-- endDowntime exactly as production does, and this column just points at
-- that same row (section 20/49) - it stays NULL when no active Run exists
-- to stop (e.g. the equipment was already idle).
--
-- failure_mode_id/failure_cause_id start NULL and are filled in once known
-- (during or after the intervention); "cause non déterminée" is a real row
-- in failure_causes, never a forced fake pick (section 46).
CREATE TABLE failure_reports (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    failure_code             VARCHAR(32) NOT NULL UNIQUE,
    equipment_id             UUID NOT NULL REFERENCES equipment (id),
    production_run_id        UUID REFERENCES production_runs (id),
    production_run_line_id   UUID REFERENCES production_run_lines (id),
    downtime_event_id        UUID REFERENCES downtime_events (id),
    severity                 VARCHAR(16) NOT NULL,
    status                   VARCHAR(24) NOT NULL DEFAULT 'DECLAREE',
    description               TEXT NOT NULL,
    failure_mode_id          UUID REFERENCES failure_modes (id),
    failure_cause_id         UUID REFERENCES failure_causes (id),
    reported_by               UUID NOT NULL REFERENCES users (id),
    reported_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at               TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT failure_reports_severity_allowed
        CHECK (severity IN ('FAIBLE', 'MOYENNE', 'HAUTE', 'CRITIQUE')),
    CONSTRAINT failure_reports_status_allowed
        CHECK (status IN ('DECLAREE', 'PRISE_EN_CHARGE', 'RESOLUE', 'ANNULEE'))
);

CREATE INDEX failure_reports_equipment_idx ON failure_reports (equipment_id);
CREATE INDEX failure_reports_run_idx ON failure_reports (production_run_id);
CREATE INDEX failure_reports_status_idx ON failure_reports (status);
CREATE INDEX failure_reports_reported_at_idx ON failure_reports (reported_at);
