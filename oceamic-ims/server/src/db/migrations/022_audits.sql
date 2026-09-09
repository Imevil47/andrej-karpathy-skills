-- OCEAMIC IMS - Phase 6
-- Audits: a planned evaluation (section 70), structurally separate from its
-- findings (audit result requiring follow-up). Checklists are configurable
-- data, never hardcoded into a screen (section 22): one checklist template
-- can be reused across many audits of the same department/process/type.

CREATE TABLE audit_checklists (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code         VARCHAR(32) NOT NULL UNIQUE,
    name         VARCHAR(200) NOT NULL,
    department   VARCHAR(120),
    process      VARCHAR(120),
    audit_type   VARCHAR(24),
    standard     VARCHAR(120),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_checklist_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_checklist_id    UUID NOT NULL REFERENCES audit_checklists (id),
    display_order         INTEGER NOT NULL,
    question              TEXT NOT NULL,
    expected_reference    TEXT,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT audit_checklist_items_unique_order
        UNIQUE (audit_checklist_id, display_order)
);

CREATE INDEX audit_checklist_items_checklist_idx ON audit_checklist_items (audit_checklist_id);

-- ---------------------------------------------------------------------------
-- Audit: the event itself. `audit_checklist_id` is nullable - an audit can
-- run against a configured checklist template, or record only findings
-- without a formal checklist (e.g. a short client visit).
-- ---------------------------------------------------------------------------
CREATE TABLE audits (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_code             VARCHAR(32) NOT NULL UNIQUE,
    audit_type             VARCHAR(24) NOT NULL,
    title                  VARCHAR(200) NOT NULL,
    audit_checklist_id     UUID REFERENCES audit_checklists (id),
    planned_date           DATE NOT NULL,
    started_at             TIMESTAMPTZ,
    completed_at           TIMESTAMPTZ,
    scope                  TEXT NOT NULL,
    lead_auditor_user_id   UUID NOT NULL REFERENCES users (id),
    status                 VARCHAR(16) NOT NULL DEFAULT 'PLANIFIE',
    notes                  TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID NOT NULL REFERENCES users (id),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT audits_type_allowed
        CHECK (audit_type IN ('INTERNE', 'CLIENT', 'CERTIFICATION', 'AUTORITE',
                              'FOURNISSEUR', 'HYGIENE', 'PROCESS', 'AUTRE')),
    CONSTRAINT audits_status_allowed
        CHECK (status IN ('PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE')),
    CONSTRAINT audits_completed_after_started
        CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX audits_status_idx ON audits (status);
CREATE INDEX audits_planned_date_idx ON audits (planned_date);
CREATE INDEX audits_code_search_idx ON audits (upper(audit_code) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- Audit execution: one response per checklist item (section 23). A measured
-- observation, structurally distinct from a finding below the same way a
-- Phase 4 CCP measurement is distinct from a CCP decision.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_responses (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id             UUID NOT NULL REFERENCES audits (id),
    checklist_item_id    UUID NOT NULL REFERENCES audit_checklist_items (id),
    result               VARCHAR(16) NOT NULL,
    observation          TEXT,
    evidence_reference   TEXT,
    responded_by         UUID NOT NULL REFERENCES users (id),
    responded_at         TIMESTAMPTZ NOT NULL,
    CONSTRAINT audit_responses_result_allowed
        CHECK (result IN ('CONFORME', 'NON_CONFORME', 'OBSERVATION', 'NON_APPLICABLE')),
    CONSTRAINT audit_responses_unique_item
        UNIQUE (audit_id, checklist_item_id)
);

CREATE INDEX audit_responses_audit_idx ON audit_responses (audit_id);

-- ---------------------------------------------------------------------------
-- Audit finding: the result requiring follow-up (section 24). May generate a
-- non-conformity (`resulting_nonconformity_id`, denormalized reference, same
-- split as elsewhere) rather than re-typing the same description twice.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_findings (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id                    UUID NOT NULL REFERENCES audits (id),
    finding_code                VARCHAR(32) NOT NULL UNIQUE,
    finding_type                VARCHAR(24) NOT NULL,
    description                 TEXT NOT NULL,
    severity                    VARCHAR(16) NOT NULL,
    owner_user_id               UUID REFERENCES users (id),
    due_at                      TIMESTAMPTZ,
    status                      VARCHAR(16) NOT NULL DEFAULT 'OUVERTE',
    resulting_nonconformity_id  UUID REFERENCES nonconformities (id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT audit_findings_type_allowed
        CHECK (finding_type IN ('NON_CONFORMITE', 'OBSERVATION', 'POINT_FORT')),
    CONSTRAINT audit_findings_severity_allowed
        CHECK (severity IN ('MINEURE', 'MAJEURE', 'CRITIQUE')),
    CONSTRAINT audit_findings_status_allowed
        CHECK (status IN ('OUVERTE', 'ACTION_REQUISE', 'CLOTUREE', 'ANNULEE'))
);

CREATE INDEX audit_findings_audit_idx ON audit_findings (audit_id);
CREATE INDEX audit_findings_status_idx ON audit_findings (status);
CREATE INDEX audit_findings_code_search_idx
    ON audit_findings (upper(finding_code) varchar_pattern_ops);
