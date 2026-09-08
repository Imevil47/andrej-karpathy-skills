-- OCEAMIC IMS - Phase 2
-- Production runs, raw material consumption, material outputs and losses.
-- Phase 1 structures are extended, never replaced: consumption goes through the
-- existing stock_movements ledger and the existing quality blocking rules.

-- Production consumption is a new origin of stock movements.
ALTER TABLE stock_movements DROP CONSTRAINT movements_reference_type_allowed;
ALTER TABLE stock_movements ADD CONSTRAINT movements_reference_type_allowed
    CHECK (reference_type IN ('RECEPTION', 'TRANSFERT', 'SOUS_TRAITANCE',
                              'SOUS_TRAITANCE_RESULTAT', 'PERTE', 'AJUSTEMENT',
                              'FRACTIONNEMENT', 'ANNULATION', 'PRODUCTION'));

-- ---------------------------------------------------------------------------
-- Production master data
-- ---------------------------------------------------------------------------

-- A product is a production / commercial reference. It is NOT a species:
-- the species is the raw material family, the product is what is produced.
CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(32) NOT NULL UNIQUE,
    name            VARCHAR(128) NOT NULL,
    species_id      UUID NOT NULL REFERENCES species (id),
    product_family  VARCHAR(64),
    format          VARCHAR(32),
    pieces_per_can  SMALLINT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT products_pieces_per_can_positive
        CHECK (pieces_per_can IS NULL OR pieces_per_can > 0)
);

CREATE INDEX products_species_idx ON products (species_id);

CREATE TABLE production_lines (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code           VARCHAR(32) NOT NULL UNIQUE,
    name           VARCHAR(128) NOT NULL,
    area           VARCHAR(64),
    display_order  SMALLINT NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Production stages are configuration, not an enum: later stages (sertissage,
-- stérilisation, emballage) are added as data, without a migration.
CREATE TABLE production_stages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code           VARCHAR(32) NOT NULL UNIQUE,
    name           VARCHAR(128) NOT NULL,
    display_order  SMALLINT NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reasons attached to a material disposition. Operational reasons are data,
-- never hardcoded in the application.
CREATE TABLE production_loss_reasons (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code         VARCHAR(32) NOT NULL UNIQUE,
    name         VARCHAR(128) NOT NULL,
    output_type  VARCHAR(24) NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT loss_reasons_output_type_allowed
        CHECK (output_type IN ('PERTE_REELLE', 'SOUS_PRODUIT', 'REWORK', 'RECLASSEMENT'))
);

CREATE INDEX loss_reasons_output_type_idx ON production_loss_reasons (output_type);

-- ---------------------------------------------------------------------------
-- Production run: the transformation context. It carries no quantity and no
-- raw material identity of its own.
-- ---------------------------------------------------------------------------
CREATE TABLE production_runs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_code              VARCHAR(32) NOT NULL UNIQUE,
    production_date       DATE NOT NULL,
    started_at            TIMESTAMPTZ,
    ended_at              TIMESTAMPTZ,
    species_id            UUID NOT NULL REFERENCES species (id),
    product_id            UUID NOT NULL REFERENCES products (id),
    format                VARCHAR(32),
    pieces_per_can        SMALLINT,
    status                VARCHAR(16) NOT NULL DEFAULT 'PLANIFIE',
    responsible_user_id   UUID REFERENCES users (id),
    -- Justification of an out-of-tolerance material difference. A run whose
    -- difference must be justified cannot be closed while this is empty.
    difference_justification TEXT,
    justified_by          UUID REFERENCES users (id),
    justified_at          TIMESTAMPTZ,
    cancellation_reason   TEXT,
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL REFERENCES users (id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT runs_status_allowed
        CHECK (status IN ('PLANIFIE', 'EN_COURS', 'SUSPENDU', 'TERMINE', 'ANNULE')),
    CONSTRAINT runs_pieces_per_can_positive
        CHECK (pieces_per_can IS NULL OR pieces_per_can > 0),
    CONSTRAINT runs_end_requires_start
        CHECK (ended_at IS NULL OR started_at IS NOT NULL),
    CONSTRAINT runs_end_after_start
        CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT runs_finished_has_end
        CHECK (status <> 'TERMINE' OR ended_at IS NOT NULL),
    CONSTRAINT runs_cancelled_has_reason
        CHECK (status <> 'ANNULE' OR cancellation_reason IS NOT NULL),
    CONSTRAINT runs_justification_is_complete
        CHECK ((difference_justification IS NULL AND justified_by IS NULL AND justified_at IS NULL)
               OR (difference_justification IS NOT NULL AND justified_by IS NOT NULL
                   AND justified_at IS NOT NULL))
);

CREATE INDEX runs_production_date_idx ON production_runs (production_date DESC);
CREATE INDEX runs_status_idx ON production_runs (status);
CREATE INDEX runs_product_idx ON production_runs (product_id);
CREATE INDEX runs_species_idx ON production_runs (species_id);

-- Which lines take part in the run, and what they do there. The activity is
-- configured per run: no species-wide assumption is encoded.
CREATE TABLE production_run_lines (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id  UUID NOT NULL REFERENCES production_runs (id),
    production_line_id UUID NOT NULL REFERENCES production_lines (id),
    activity_type      VARCHAR(32) NOT NULL,
    is_active_for_run  BOOLEAN NOT NULL DEFAULT TRUE,
    started_at         TIMESTAMPTZ,
    ended_at           TIMESTAMPTZ,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID NOT NULL REFERENCES users (id),
    CONSTRAINT run_lines_activity_allowed
        CHECK (activity_type IN ('GRATTAGE', 'REMPLISSAGE', 'GRATTAGE_REMPLISSAGE',
                                 'TRAITEMENT', 'INACTIVE', 'AUTRE')),
    CONSTRAINT run_lines_end_after_start
        CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at),
    CONSTRAINT run_lines_unique_per_run UNIQUE (production_run_id, production_line_id)
);

CREATE INDEX run_lines_run_idx ON production_run_lines (production_run_id);

-- ---------------------------------------------------------------------------
-- Raw material consumption: the many-to-many relation between runs and lots.
-- One run consumes several lots; one lot feeds several runs.
-- Every validated row owns exactly one stock movement of the Phase 1 ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE production_run_materials (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id          UUID NOT NULL REFERENCES production_runs (id),
    raw_material_lot_id        UUID NOT NULL REFERENCES raw_material_lots (id),
    source_location_id         UUID NOT NULL REFERENCES locations (id),
    quantity_kg                NUMERIC(14, 3) NOT NULL,
    consumed_at                TIMESTAMPTZ NOT NULL,
    stock_movement_id          UUID NOT NULL UNIQUE REFERENCES stock_movements (id),
    status                     VARCHAR(16) NOT NULL DEFAULT 'VALIDE',
    -- A validated consumption is never edited: it is cancelled by a reversal
    -- movement and, when correcting, replaced by a new row.
    reversal_stock_movement_id UUID UNIQUE REFERENCES stock_movements (id),
    cancelled_at               TIMESTAMPTZ,
    cancelled_by               UUID REFERENCES users (id),
    cancellation_reason        TEXT,
    replaces_id                UUID UNIQUE REFERENCES production_run_materials (id),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                 UUID NOT NULL REFERENCES users (id),
    CONSTRAINT run_materials_quantity_positive CHECK (quantity_kg > 0),
    CONSTRAINT run_materials_status_allowed CHECK (status IN ('VALIDE', 'ANNULE')),
    CONSTRAINT run_materials_cancelled_is_documented
        CHECK (status <> 'ANNULE'
               OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
                   AND cancellation_reason IS NOT NULL
                   AND reversal_stock_movement_id IS NOT NULL)),
    CONSTRAINT run_materials_valid_is_open
        CHECK (status <> 'VALIDE'
               OR (cancelled_at IS NULL AND cancelled_by IS NULL
                   AND reversal_stock_movement_id IS NULL)),
    CONSTRAINT run_materials_not_self_replacing CHECK (replaces_id IS NULL OR replaces_id <> id)
);

CREATE INDEX run_materials_run_idx ON production_run_materials (production_run_id);
CREATE INDEX run_materials_lot_idx ON production_run_materials (raw_material_lot_id);
CREATE INDEX run_materials_consumed_at_idx ON production_run_materials (consumed_at DESC);
CREATE INDEX run_materials_status_idx ON production_run_materials (status);

-- ---------------------------------------------------------------------------
-- Material leaving the transformation. One typed ledger holds every material
-- disposition: useful output, by-product, rework, reclassification and real
-- loss. The unexplained difference is NEVER stored here — it is calculated,
-- so that an unexplained gap can never be disguised as a declared loss.
-- Phase 2 outputs are internal production material flow events: they do not
-- create warehouse stock records, since the material is not held as inventory
-- at these stages.
-- ---------------------------------------------------------------------------
CREATE TABLE production_outputs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id       UUID NOT NULL REFERENCES production_runs (id),
    output_type             VARCHAR(24) NOT NULL,
    quantity_kg             NUMERIC(14, 3) NOT NULL,
    occurred_at             TIMESTAMPTZ NOT NULL,
    production_line_id      UUID REFERENCES production_lines (id),
    destination_stage_id    UUID REFERENCES production_stages (id),
    destination_location_id UUID REFERENCES locations (id),
    derived_lot_id          UUID REFERENCES raw_material_lots (id),
    loss_reason_id          UUID REFERENCES production_loss_reasons (id),
    reason_text             TEXT,
    notes                   TEXT,
    status                  VARCHAR(16) NOT NULL DEFAULT 'VALIDE',
    cancelled_at            TIMESTAMPTZ,
    cancelled_by            UUID REFERENCES users (id),
    cancellation_reason     TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by              UUID NOT NULL REFERENCES users (id),
    CONSTRAINT outputs_quantity_positive CHECK (quantity_kg > 0),
    CONSTRAINT outputs_type_allowed
        CHECK (output_type IN ('SORTIE_UTILE', 'SOUS_PRODUIT', 'REWORK',
                               'RECLASSEMENT', 'PERTE_REELLE', 'AUTRE')),
    CONSTRAINT outputs_status_allowed CHECK (status IN ('VALIDE', 'ANNULE')),
    -- A real loss must always say why.
    CONSTRAINT outputs_real_loss_requires_reason
        CHECK (output_type <> 'PERTE_REELLE'
               OR loss_reason_id IS NOT NULL OR reason_text IS NOT NULL),
    CONSTRAINT outputs_cancelled_is_documented
        CHECK (status <> 'ANNULE'
               OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
                   AND cancellation_reason IS NOT NULL)),
    CONSTRAINT outputs_valid_is_open
        CHECK (status <> 'VALIDE' OR (cancelled_at IS NULL AND cancelled_by IS NULL))
);

CREATE INDEX outputs_run_idx ON production_outputs (production_run_id);
CREATE INDEX outputs_type_idx ON production_outputs (output_type);
CREATE INDEX outputs_occurred_at_idx ON production_outputs (occurred_at DESC);
CREATE INDEX outputs_status_idx ON production_outputs (status);
CREATE INDEX outputs_line_idx ON production_outputs (production_line_id);
