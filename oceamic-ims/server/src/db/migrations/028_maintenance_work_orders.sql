-- OCEAMIC IMS - Phase 7
-- Maintenance / CMMS layer, part 3: work orders and interventions
-- (sections 23/33). WORK ORDER is the authorized job; INTERVENTION is the
-- actual execution - a work order may carry several interventions, never
-- forced into a 1:1 relationship (section 34).

-- One table for every work-order type (section 22): CORRECTIVE, PREVENTIVE,
-- INSPECTION, REGLAGE, AMELIORATION, URGENCE all share the same lifecycle
-- and the same closure rules, so splitting them into separate tables would
-- only duplicate that logic.
--
-- Return to service (restored_at/restored_by/verification_result) is
-- deliberately its own set of columns, never folded into `status`: a
-- technician finishing the repair work is not the same fact as the
-- equipment being released for production (section 15) - for
-- HAUTE/CRITIQUE-criticality equipment, closure requires a verification
-- result, not just a status flip (enforced in services/workOrders.ts).
CREATE TABLE maintenance_work_orders (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_code      VARCHAR(32) NOT NULL UNIQUE,
    failure_report_id    UUID REFERENCES failure_reports (id),
    equipment_id         UUID NOT NULL REFERENCES equipment (id),
    work_order_type      VARCHAR(16) NOT NULL,
    priority             VARCHAR(16) NOT NULL,
    status               VARCHAR(24) NOT NULL DEFAULT 'OUVERT',
    title                VARCHAR(200) NOT NULL,
    description          TEXT,
    requested_by         UUID NOT NULL REFERENCES users (id),
    requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_to          UUID REFERENCES users (id),
    due_at               TIMESTAMPTZ,
    restored_at          TIMESTAMPTZ,
    restored_by          UUID REFERENCES users (id),
    verification_result  VARCHAR(16),
    closed_at            TIMESTAMPTZ,
    closed_by            UUID REFERENCES users (id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT work_orders_type_allowed
        CHECK (work_order_type IN ('CORRECTIVE', 'PREVENTIVE', 'INSPECTION',
                                   'REGLAGE', 'AMELIORATION', 'URGENCE')),
    CONSTRAINT work_orders_priority_allowed
        CHECK (priority IN ('BASSE', 'NORMALE', 'HAUTE', 'URGENTE')),
    CONSTRAINT work_orders_status_allowed
        CHECK (status IN ('OUVERT', 'PLANIFIE', 'EN_COURS', 'EN_ATTENTE_PIECE',
                          'EN_ATTENTE_PRODUCTION', 'TERMINE', 'ANNULE')),
    CONSTRAINT work_orders_verification_result_allowed
        CHECK (verification_result IS NULL OR verification_result IN ('CONFORME', 'NON_CONFORME'))
);

CREATE INDEX work_orders_equipment_idx ON maintenance_work_orders (equipment_id);
CREATE INDEX work_orders_status_idx ON maintenance_work_orders (status);
CREATE INDEX work_orders_assigned_to_idx ON maintenance_work_orders (assigned_to);
CREATE INDEX work_orders_failure_report_idx ON maintenance_work_orders (failure_report_id);

-- One intervention = one technician's continuous work session on a work
-- order. duration_seconds mirrors downtime_events.duration_seconds exactly
-- (007_workforce.sql): a generated, stored column so it can never disagree
-- with started_at/ended_at, and is NULL while the intervention is open.
-- diagnostic/action_performed/failure_mode_id/failure_cause_id are captured
-- per intervention (section 46's rapid technician flow), not on the work
-- order itself, since a work order can carry several interventions.
CREATE TABLE maintenance_interventions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id        UUID NOT NULL REFERENCES maintenance_work_orders (id),
    technician_user_id   UUID NOT NULL REFERENCES users (id),
    started_at           TIMESTAMPTZ NOT NULL,
    ended_at             TIMESTAMPTZ,
    duration_seconds INTEGER GENERATED ALWAYS AS (
        CASE WHEN ended_at IS NULL THEN NULL
             ELSE EXTRACT(EPOCH FROM (ended_at - started_at))::integer
        END
    ) STORED,
    diagnostic           TEXT,
    action_performed     TEXT,
    failure_mode_id      UUID REFERENCES failure_modes (id),
    failure_cause_id     UUID REFERENCES failure_causes (id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT interventions_end_after_start
        CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX interventions_work_order_idx ON maintenance_interventions (work_order_id);
CREATE INDEX interventions_technician_idx ON maintenance_interventions (technician_user_id);
