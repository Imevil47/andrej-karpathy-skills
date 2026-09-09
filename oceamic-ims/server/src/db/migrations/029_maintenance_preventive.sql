-- OCEAMIC IMS - Phase 7
-- Maintenance / CMMS layer, part 4: preventive maintenance (sections 24-31).
-- PREVENTIVE PLAN is the recurring requirement; PREVENTIVE TASK is one
-- scheduled occurrence of it (section 66) - never collapsed into one table,
-- the same way a cadence_standard is distinct from each cadence_control.

-- frequency_interval_days drives automatic "next due" and "en retard"
-- calculation for calendar-based frequencies (DAILY..ANNUAL): next_due =
-- last completed task's due_at + interval. OPERATING_HOURS and CUSTOM leave
-- it NULL on purpose - Phase 7 has no operating-hours meter integration, so
-- those plans are scheduled manually (section 28: never fake a meter that
-- does not exist) rather than have the system silently invent a date.
CREATE TABLE maintenance_plans (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code                 VARCHAR(32) NOT NULL UNIQUE,
    equipment_id              UUID NOT NULL REFERENCES equipment (id),
    name                      VARCHAR(200) NOT NULL,
    frequency_type            VARCHAR(16) NOT NULL,
    frequency_interval_days   INTEGER,
    is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
    created_by                UUID NOT NULL REFERENCES users (id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT maintenance_plans_frequency_allowed
        CHECK (frequency_type IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY',
                                  'SEMIANNUAL', 'ANNUAL', 'OPERATING_HOURS', 'CUSTOM')),
    CONSTRAINT maintenance_plans_interval_positive
        CHECK (frequency_interval_days IS NULL OR frequency_interval_days > 0)
);

CREATE INDEX maintenance_plans_equipment_idx ON maintenance_plans (equipment_id);

CREATE TABLE maintenance_plan_checklist_items (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maintenance_plan_id    UUID NOT NULL REFERENCES maintenance_plans (id),
    display_order          INTEGER NOT NULL,
    label                  TEXT NOT NULL,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT maintenance_plan_checklist_items_unique_order
        UNIQUE (maintenance_plan_id, display_order)
);

CREATE INDEX maintenance_plan_checklist_items_plan_idx ON maintenance_plan_checklist_items (maintenance_plan_id);

-- "En retard" is never stored: it is always (status = 'PLANIFIEE' AND
-- due_at < now()), computed in services/preventiveTasks.ts and the
-- overdue-preventive view (031), exactly like CAPA/audit-action overdue
-- detection in Phase 6 - section 56 explicitly requires this never be a
-- manually selected value.
CREATE TABLE preventive_tasks (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maintenance_plan_id    UUID NOT NULL REFERENCES maintenance_plans (id),
    due_at                 TIMESTAMPTZ NOT NULL,
    status                 VARCHAR(16) NOT NULL DEFAULT 'PLANIFIEE',
    technician_user_id     UUID REFERENCES users (id),
    work_order_id          UUID REFERENCES maintenance_work_orders (id),
    completed_at           TIMESTAMPTZ,
    completed_by           UUID REFERENCES users (id),
    notes                  TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT preventive_tasks_status_allowed
        CHECK (status IN ('PLANIFIEE', 'TERMINEE', 'ANNULEE'))
);

CREATE INDEX preventive_tasks_plan_idx ON preventive_tasks (maintenance_plan_id);
CREATE INDEX preventive_tasks_due_at_idx ON preventive_tasks (due_at);
CREATE INDEX preventive_tasks_status_idx ON preventive_tasks (status);

CREATE TABLE preventive_task_checklist_responses (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    preventive_task_id    UUID NOT NULL REFERENCES preventive_tasks (id),
    checklist_item_id     UUID NOT NULL REFERENCES maintenance_plan_checklist_items (id),
    completed             BOOLEAN NOT NULL DEFAULT FALSE,
    comment               TEXT,
    responded_by          UUID REFERENCES users (id),
    responded_at          TIMESTAMPTZ,
    CONSTRAINT preventive_task_checklist_responses_unique_item
        UNIQUE (preventive_task_id, checklist_item_id)
);

CREATE INDEX preventive_task_checklist_responses_task_idx ON preventive_task_checklist_responses (preventive_task_id);
