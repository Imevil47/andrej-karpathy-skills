-- OCEAMIC IMS - Phase 6
-- Recall / withdrawal: a controlled market/stock traceability event (section
-- 70). Every recall - real or a mock exercise - starts from one concrete
-- entity (a raw-material lot, a finished-good lot...) and its impact is
-- always computed from existing relational traceability (sections 32-36),
-- never a manually typed list.

CREATE TABLE recall_events (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recall_code          VARCHAR(32) NOT NULL UNIQUE,
    event_type           VARCHAR(24) NOT NULL,
    target_entity_type   VARCHAR(24) NOT NULL,
    target_entity_id     UUID NOT NULL,
    opened_at            TIMESTAMPTZ NOT NULL,
    reason               TEXT NOT NULL,
    severity             VARCHAR(16) NOT NULL,
    status               VARCHAR(16) NOT NULL DEFAULT 'OUVERT',
    initiated_by         UUID NOT NULL REFERENCES users (id),
    scope_description    TEXT,
    -- Section 35's exercise record: results found, quantities reconciled and
    -- observations, filled in as the exercise/recall is worked and reviewed
    -- at closure - never claimed complete before closed_at is set.
    observations         TEXT,
    closed_at            TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT recall_events_type_allowed
        CHECK (event_type IN ('EXERCICE_TRACABILITE', 'RETRAIT', 'RAPPEL')),
    CONSTRAINT recall_events_target_type_allowed
        CHECK (target_entity_type IN ('RAW_MATERIAL_LOT', 'FINISHED_GOOD_LOT')),
    CONSTRAINT recall_events_severity_allowed
        CHECK (severity IN ('MINEURE', 'MAJEURE', 'CRITIQUE')),
    CONSTRAINT recall_events_status_allowed
        CHECK (status IN ('OUVERT', 'EN_COURS', 'CLOTURE', 'ANNULE')),
    CONSTRAINT recall_events_closed_pairing
        CHECK ((status NOT IN ('CLOTURE', 'ANNULE')) OR (closed_at IS NOT NULL))
);

CREATE INDEX recall_events_status_idx ON recall_events (status);
CREATE INDEX recall_events_target_idx ON recall_events (target_entity_type, target_entity_id);
CREATE INDEX recall_events_code_search_idx ON recall_events (upper(recall_code) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- Recall impact analysis (section 32): a snapshot of every entity the
-- traceability chain identified at the time the recall/exercise was worked,
-- so the exercise record stays meaningful even if later stock movements
-- change the live picture. `quantity` is filled where the entity carries a
-- natural quantity (cartons on a pallet, kilograms on a lot); left NULL
-- where the entity is purely an identity (a Run, a customer).
-- ---------------------------------------------------------------------------
CREATE TABLE recall_affected_entities (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recall_event_id   UUID NOT NULL REFERENCES recall_events (id),
    entity_type       VARCHAR(24) NOT NULL,
    entity_id         UUID NOT NULL,
    impact_type       VARCHAR(16) NOT NULL,
    quantity          NUMERIC(14, 3),
    status            VARCHAR(16) NOT NULL DEFAULT 'IDENTIFIE',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT recall_affected_entities_type_allowed
        CHECK (entity_type IN ('RAW_MATERIAL_LOT', 'PRODUCTION_RUN', 'STERILIZATION_CYCLE',
                               'FINISHED_GOOD_LOT', 'PALLET', 'SHIPMENT', 'CUSTOMER')),
    CONSTRAINT recall_affected_entities_impact_allowed
        CHECK (impact_type IN ('ORIGINE', 'AFFECTE')),
    CONSTRAINT recall_affected_entities_status_allowed
        CHECK (status IN ('IDENTIFIE', 'EN_TRAITEMENT', 'TRAITE')),
    CONSTRAINT recall_affected_entities_unique
        UNIQUE (recall_event_id, entity_type, entity_id)
);

CREATE INDEX recall_affected_entities_event_idx ON recall_affected_entities (recall_event_id);
CREATE INDEX recall_affected_entities_entity_idx ON recall_affected_entities (entity_type, entity_id);
