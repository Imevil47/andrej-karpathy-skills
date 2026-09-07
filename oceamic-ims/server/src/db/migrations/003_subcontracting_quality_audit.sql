-- OCEAMIC IMS - Phase 1
-- Subcontracting, quality (observations vs decisions), lot blocking, audit trail.

-- ---------------------------------------------------------------------------
-- Subcontracting
--   FOURNISSEUR     : the material never was in an OCEAMIC location. The
--                     incoming quantity is received directly at the
--                     subcontractor location (external stock).
--   STOCK_EXISTANT  : the material leaves an existing OCEAMIC location and is
--                     moved to the subcontractor location.
-- ---------------------------------------------------------------------------
CREATE TABLE subcontracting_operations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_code      VARCHAR(32) NOT NULL UNIQUE,
    sent_at             TIMESTAMPTZ NOT NULL,
    subcontractor_id    UUID NOT NULL REFERENCES subcontractors (id),
    source_type         VARCHAR(24) NOT NULL,
    source_lot_id       UUID REFERENCES raw_material_lots (id),
    source_location_id  UUID REFERENCES locations (id),
    supplier_id         UUID REFERENCES suppliers (id),
    quantity_sent_kg    NUMERIC(14, 3) NOT NULL,
    incoming_quality    VARCHAR(32),
    incoming_size_grade VARCHAR(32),
    status              VARCHAR(16) NOT NULL DEFAULT 'EN_COURS',
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID NOT NULL REFERENCES users (id),
    CONSTRAINT subcontracting_quantity_positive CHECK (quantity_sent_kg > 0),
    CONSTRAINT subcontracting_source_type_allowed
        CHECK (source_type IN ('FOURNISSEUR', 'STOCK_EXISTANT')),
    CONSTRAINT subcontracting_status_allowed
        CHECK (status IN ('EN_COURS', 'CLOTURE', 'ANNULE')),
    -- STOCK_EXISTANT consumes existing stock: lot and source location required.
    CONSTRAINT subcontracting_stock_existant_requires_source
        CHECK (source_type <> 'STOCK_EXISTANT'
               OR (source_lot_id IS NOT NULL AND source_location_id IS NOT NULL)),
    -- FOURNISSEUR never reduces an OCEAMIC location.
    CONSTRAINT subcontracting_fournisseur_has_no_source_location
        CHECK (source_type <> 'FOURNISSEUR' OR source_location_id IS NULL)
);

CREATE INDEX subcontracting_subcontractor_idx ON subcontracting_operations (subcontractor_id);
CREATE INDEX subcontracting_source_lot_idx ON subcontracting_operations (source_lot_id);
CREATE INDEX subcontracting_status_idx ON subcontracting_operations (status);
CREATE INDEX subcontracting_sent_at_idx ON subcontracting_operations (sent_at DESC);

-- One incoming quantity may generate several outputs, each with its own
-- quality, size grade, lot and destination.
CREATE TABLE subcontracting_results (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subcontracting_operation_id UUID NOT NULL REFERENCES subcontracting_operations (id),
    result_type                 VARCHAR(16) NOT NULL,
    result_lot_id               UUID REFERENCES raw_material_lots (id),
    quantity_kg                 NUMERIC(14, 3) NOT NULL,
    outgoing_quality            VARCHAR(32),
    outgoing_size_grade         VARCHAR(32),
    destination_location_id     UUID REFERENCES locations (id),
    quality_status              VARCHAR(24),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                  UUID NOT NULL REFERENCES users (id),
    CONSTRAINT subcontracting_results_quantity_positive CHECK (quantity_kg > 0),
    CONSTRAINT subcontracting_results_type_allowed
        CHECK (result_type IN ('PRODUIT', 'PERTE')),
    -- A usable output must land somewhere; a loss has no destination.
    CONSTRAINT subcontracting_results_destination_rule
        CHECK ((result_type = 'PRODUIT'
                AND destination_location_id IS NOT NULL AND result_lot_id IS NOT NULL)
               OR (result_type = 'PERTE'
                   AND destination_location_id IS NULL))
);

CREATE INDEX subcontracting_results_operation_idx
    ON subcontracting_results (subcontracting_operation_id);
CREATE INDEX subcontracting_results_lot_idx ON subcontracting_results (result_lot_id);

-- ---------------------------------------------------------------------------
-- Quality: inspections are OBSERVATIONS, decisions are BUSINESS DECISIONS.
-- Historical measurements are never overwritten by a later decision.
-- ---------------------------------------------------------------------------
CREATE TABLE quality_inspections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_code     VARCHAR(32) NOT NULL UNIQUE,
    raw_material_lot_id UUID NOT NULL REFERENCES raw_material_lots (id),
    inspected_at        TIMESTAMPTZ NOT NULL,
    inspection_type     VARCHAR(32) NOT NULL,
    process_stage       VARCHAR(32) NOT NULL,
    location_id         UUID REFERENCES locations (id),
    temperature_c       NUMERIC(6, 2),
    histamine_ppm       NUMERIC(8, 2),
    abvt                NUMERIC(8, 2),
    quality_grade       VARCHAR(32),
    size_grade          VARCHAR(32),
    result              VARCHAR(24) NOT NULL,
    notes               TEXT,
    inspector_id        UUID NOT NULL REFERENCES users (id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT inspections_type_allowed
        CHECK (inspection_type IN ('RECEPTION', 'STOCKAGE', 'SOUS_TRAITANCE',
                                   'RECONTROLE', 'AUTRE')),
    CONSTRAINT inspections_stage_allowed
        CHECK (process_stage IN ('RECEPTION', 'STOCKAGE', 'SOUS_TRAITANCE', 'AUTRE')),
    CONSTRAINT inspections_result_allowed
        CHECK (result IN ('CONFORME', 'NON_CONFORME', 'A_SURVEILLER'))
);

CREATE INDEX inspections_lot_idx ON quality_inspections (raw_material_lot_id);
CREATE INDEX inspections_inspected_at_idx ON quality_inspections (inspected_at DESC);

CREATE TABLE quality_decisions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id       UUID REFERENCES quality_inspections (id),
    raw_material_lot_id UUID NOT NULL REFERENCES raw_material_lots (id),
    decision_type       VARCHAR(32) NOT NULL,
    reason              TEXT NOT NULL,
    decided_at          TIMESTAMPTZ NOT NULL,
    decided_by          UUID NOT NULL REFERENCES users (id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT decisions_type_allowed
        CHECK (decision_type IN ('ACCEPTE', 'ACCEPTE_SOUS_RESERVE', 'BLOQUE',
                                 'REJETE', 'RECONTROLE_REQUIS', 'LIBERE'))
);

CREATE INDEX decisions_lot_idx ON quality_decisions (raw_material_lot_id);
CREATE INDEX decisions_inspection_idx ON quality_decisions (inspection_id);

-- ---------------------------------------------------------------------------
-- Lot blocking. Phase 1 blocks the whole lot; the quantity column is kept
-- absent on purpose so that a partial block can be added later without
-- reinterpreting existing rows.
-- ---------------------------------------------------------------------------
CREATE TABLE lot_blocks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_material_lot_id UUID NOT NULL REFERENCES raw_material_lots (id),
    blocked_at          TIMESTAMPTZ NOT NULL,
    blocked_by          UUID NOT NULL REFERENCES users (id),
    reason              TEXT NOT NULL,
    source_inspection_id UUID REFERENCES quality_inspections (id),
    block_decision_id   UUID REFERENCES quality_decisions (id),
    status              VARCHAR(16) NOT NULL DEFAULT 'ACTIF',
    released_at         TIMESTAMPTZ,
    released_by         UUID REFERENCES users (id),
    release_reason      TEXT,
    release_decision_id UUID REFERENCES quality_decisions (id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lot_blocks_status_allowed CHECK (status IN ('ACTIF', 'LEVE', 'ANNULE')),
    CONSTRAINT lot_blocks_closed_rows_are_documented
        CHECK (status = 'ACTIF'
               OR (released_at IS NOT NULL AND released_by IS NOT NULL
                   AND release_reason IS NOT NULL)),
    CONSTRAINT lot_blocks_active_rows_are_open
        CHECK (status <> 'ACTIF'
               OR (released_at IS NULL AND released_by IS NULL))
);

-- A lot can only carry one active block at a time.
CREATE UNIQUE INDEX lot_blocks_one_active_per_lot
    ON lot_blocks (raw_material_lot_id)
    WHERE status = 'ACTIF';

CREATE INDEX lot_blocks_lot_idx ON lot_blocks (raw_material_lot_id);

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id      UUID REFERENCES users (id),
    action       VARCHAR(64) NOT NULL,
    entity_type  VARCHAR(64) NOT NULL,
    entity_id    UUID,
    old_values   JSONB,
    new_values   JSONB,
    context      JSONB
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_user_idx ON audit_log (user_id);
