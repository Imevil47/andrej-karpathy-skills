-- OCEAMIC IMS - Phase 6
-- CAPA: systematic actions addressing a root cause or a risk (section 70),
-- structurally distinct from the immediate correction already captured on
-- nonconformity_investigations. `source_nonconformity_id` is nullable
-- (section 50): a preventive action may originate from an audit observation,
-- a trend or a management decision, with no existing NCR to point to.

CREATE TABLE capa_records (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capa_code               VARCHAR(32) NOT NULL UNIQUE,
    source_nonconformity_id UUID REFERENCES nonconformities (id),
    title                   VARCHAR(200) NOT NULL,
    description             TEXT NOT NULL,
    capa_type               VARCHAR(24) NOT NULL,
    priority                VARCHAR(16) NOT NULL DEFAULT 'NORMALE',
    owner_user_id           UUID NOT NULL REFERENCES users (id),
    opened_at               TIMESTAMPTZ NOT NULL,
    due_at                  TIMESTAMPTZ,
    status                  VARCHAR(16) NOT NULL DEFAULT 'OUVERTE',
    effectiveness_required  BOOLEAN NOT NULL DEFAULT TRUE,
    closed_at               TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by              UUID NOT NULL REFERENCES users (id),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT capa_records_type_allowed
        CHECK (capa_type IN ('CORRECTIVE', 'PREVENTIVE', 'CORRECTIVE_PREVENTIVE')),
    CONSTRAINT capa_records_priority_allowed
        CHECK (priority IN ('BASSE', 'NORMALE', 'HAUTE', 'URGENTE')),
    CONSTRAINT capa_records_status_allowed
        CHECK (status IN ('OUVERTE', 'EN_COURS', 'EN_VERIFICATION', 'CLOTUREE', 'ANNULEE')),
    CONSTRAINT capa_records_closed_pairing
        CHECK ((status <> 'CLOTUREE') OR (closed_at IS NOT NULL))
);

CREATE INDEX capa_records_status_idx ON capa_records (status);
CREATE INDEX capa_records_owner_idx ON capa_records (owner_user_id);
CREATE INDEX capa_records_source_ncr_idx ON capa_records (source_nonconformity_id);
CREATE INDEX capa_records_code_search_idx ON capa_records (upper(capa_code) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- CAPA actions (section 13). action_type keeps CORRECTION available at this
-- level too (a CAPA can bundle its own immediate correction alongside the
-- corrective/preventive actions), but it is still never the same concept as
-- an ACTION_CORRECTIVE (section 49): the type column makes the distinction
-- explicit on every row instead of relying on which table it lives in.
-- ---------------------------------------------------------------------------
CREATE TABLE capa_actions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capa_id               UUID NOT NULL REFERENCES capa_records (id),
    action_type           VARCHAR(24) NOT NULL,
    description           TEXT NOT NULL,
    responsible_user_id   UUID NOT NULL REFERENCES users (id),
    planned_date          DATE,
    due_date              DATE,
    completed_at          TIMESTAMPTZ,
    status                VARCHAR(16) NOT NULL DEFAULT 'OUVERTE',
    completion_evidence   TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT capa_actions_type_allowed
        CHECK (action_type IN ('CORRECTION', 'ACTION_CORRECTIVE', 'ACTION_PREVENTIVE', 'VERIFICATION')),
    CONSTRAINT capa_actions_status_allowed
        CHECK (status IN ('OUVERTE', 'EN_COURS', 'TERMINEE', 'ANNULEE')),
    CONSTRAINT capa_actions_completed_pairing
        CHECK ((status <> 'TERMINEE') OR (completed_at IS NOT NULL))
);

CREATE INDEX capa_actions_capa_idx ON capa_actions (capa_id);
CREATE INDEX capa_actions_responsible_idx ON capa_actions (responsible_user_id);
CREATE INDEX capa_actions_status_idx ON capa_actions (status);

-- ---------------------------------------------------------------------------
-- Effectiveness verification (section 14): evidence that an action actually
-- worked, never assumed just because every action row is TERMINEE.
-- ---------------------------------------------------------------------------
CREATE TABLE capa_effectiveness_checks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capa_id     UUID NOT NULL REFERENCES capa_records (id),
    checked_at  TIMESTAMPTZ NOT NULL,
    checked_by  UUID NOT NULL REFERENCES users (id),
    method      VARCHAR(120) NOT NULL,
    result      TEXT NOT NULL,
    effective   BOOLEAN NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX capa_effectiveness_checks_capa_idx ON capa_effectiveness_checks (capa_id);
