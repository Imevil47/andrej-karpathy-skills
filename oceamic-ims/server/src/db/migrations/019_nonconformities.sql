-- OCEAMIC IMS - Phase 6
-- Non-conformities: the entry point of the QMS (section 4). A non-conformity
-- is a documented failure/deviation requiring quality handling - distinct
-- from an investigation (facts/impact), a root cause (underlying cause) and
-- a correction (immediate fix), each modelled as its own table below
-- (section 70): collapsing them into one generic "quality issue" row would
-- lose the very distinctions section 49/70 asks to preserve.

CREATE TABLE nonconformity_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Non-conformity. `source_type`/`source_id` is a denormalized, informational
-- pointer to the single record that triggered the NCR (a control, a run, a
-- shipment...) for fast display; the full, possibly multi-entity picture
-- always lives in nonconformity_links below - the same "denormalized
-- reference, link table is authoritative" split already used for
-- shipment_lines.finished_good_lot_id in Phase 5. No real foreign key here:
-- source_type spans a dozen unrelated tables, so it is validated in the
-- service layer, the same polymorphic pattern as finished_goods_quality_blocks.
-- ---------------------------------------------------------------------------
CREATE TABLE nonconformities (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nonconformity_code     VARCHAR(32) NOT NULL UNIQUE,
    detected_at            TIMESTAMPTZ NOT NULL,
    source_type            VARCHAR(32),
    source_id              UUID,
    category_id            UUID NOT NULL REFERENCES nonconformity_categories (id),
    title                  VARCHAR(200) NOT NULL,
    description            TEXT NOT NULL,
    severity               VARCHAR(16) NOT NULL,
    priority               VARCHAR(16) NOT NULL DEFAULT 'NORMALE',
    status                 VARCHAR(16) NOT NULL DEFAULT 'OUVERTE',
    detected_by            UUID NOT NULL REFERENCES users (id),
    owner_user_id          UUID REFERENCES users (id),
    due_at                 TIMESTAMPTZ,
    quality_block_required BOOLEAN NOT NULL DEFAULT FALSE,
    -- Denormalized reference to the block this NCR caused (section 9), opened
    -- through the existing Phase 1 (lot_blocks) or Phase 5
    -- (finished_goods_quality_blocks) architecture depending on entity type -
    -- never a second, independent block system.
    block_entity_type      VARCHAR(24),
    block_entity_id        UUID,
    block_reference_id     UUID,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID NOT NULL REFERENCES users (id),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT nonconformities_severity_allowed
        CHECK (severity IN ('MINEURE', 'MAJEURE', 'CRITIQUE')),
    CONSTRAINT nonconformities_priority_allowed
        CHECK (priority IN ('BASSE', 'NORMALE', 'HAUTE', 'URGENTE')),
    CONSTRAINT nonconformities_status_allowed
        CHECK (status IN ('OUVERTE', 'EN_ANALYSE', 'ACTION_REQUISE', 'EN_ATTENTE',
                          'A_VERIFIER', 'CLOTUREE', 'ANNULEE')),
    CONSTRAINT nonconformities_source_pairing
        CHECK ((source_type IS NULL) = (source_id IS NULL)),
    CONSTRAINT nonconformities_block_pairing
        CHECK ((block_entity_type IS NULL) = (block_entity_id IS NULL))
);

CREATE INDEX nonconformities_status_idx ON nonconformities (status);
CREATE INDEX nonconformities_severity_idx ON nonconformities (severity);
CREATE INDEX nonconformities_category_idx ON nonconformities (category_id);
CREATE INDEX nonconformities_owner_idx ON nonconformities (owner_user_id);
CREATE INDEX nonconformities_source_idx ON nonconformities (source_type, source_id);
CREATE INDEX nonconformities_code_search_idx
    ON nonconformities (upper(nonconformity_code) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- Links an NCR to every operational record it touches (section 5): source,
-- affected, detected-on, consequence. Chosen over dozens of nullable foreign
-- keys on nonconformities itself, which would neither scale to new entity
-- types nor allow more than one of each relationship.
-- ---------------------------------------------------------------------------
CREATE TABLE nonconformity_links (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nonconformity_id   UUID NOT NULL REFERENCES nonconformities (id),
    entity_type        VARCHAR(32) NOT NULL,
    entity_id          UUID NOT NULL,
    relationship_type  VARCHAR(16) NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID NOT NULL REFERENCES users (id),
    CONSTRAINT nonconformity_links_relationship_allowed
        CHECK (relationship_type IN ('SOURCE', 'AFFECTE', 'DETECTE_SUR', 'CONSEQUENCE')),
    CONSTRAINT nonconformity_links_unique
        UNIQUE (nonconformity_id, entity_type, entity_id, relationship_type)
);

CREATE INDEX nonconformity_links_ncr_idx ON nonconformity_links (nonconformity_id);
CREATE INDEX nonconformity_links_entity_idx ON nonconformity_links (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Investigation: facts and impact, structurally separate from the root cause
-- analysis below and from any corrective action (section 10). `correction`
-- vocabulary is deliberately its own field (immediate_correction), never
-- confused with `capa_actions` of type ACTION_CORRECTIVE (section 49).
-- ---------------------------------------------------------------------------
CREATE TABLE nonconformity_investigations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nonconformity_id     UUID NOT NULL REFERENCES nonconformities (id),
    started_at           TIMESTAMPTZ NOT NULL,
    completed_at         TIMESTAMPTZ,
    investigator_user_id UUID NOT NULL REFERENCES users (id),
    facts                TEXT NOT NULL,
    immediate_correction TEXT,
    impact_assessment    TEXT,
    root_cause_required  BOOLEAN NOT NULL DEFAULT TRUE,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX nonconformity_investigations_ncr_idx
    ON nonconformity_investigations (nonconformity_id);

-- ---------------------------------------------------------------------------
-- Root cause analysis (section 11): a flexible method, never forced to a
-- heavyweight technique for a minor NCR - ANALYSE_SIMPLE stays a first-class
-- option alongside 5 Pourquoi, Ishikawa and Pareto.
-- ---------------------------------------------------------------------------
CREATE TABLE root_cause_analyses (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nonconformity_id  UUID NOT NULL REFERENCES nonconformities (id),
    method            VARCHAR(24) NOT NULL,
    analysis_text     TEXT NOT NULL,
    root_cause        TEXT NOT NULL,
    validated_by      UUID REFERENCES users (id),
    validated_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT root_cause_analyses_method_allowed
        CHECK (method IN ('5_POURQUOI', 'ISHIKAWA', 'PARETO', 'ANALYSE_SIMPLE', 'AUTRE')),
    CONSTRAINT root_cause_analyses_validation_pairing
        CHECK ((validated_by IS NULL) = (validated_at IS NULL))
);

CREATE INDEX root_cause_analyses_ncr_idx ON root_cause_analyses (nonconformity_id);
