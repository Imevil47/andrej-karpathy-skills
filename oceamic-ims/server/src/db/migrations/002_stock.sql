-- OCEAMIC IMS - Phase 1
-- Raw material identity (lots), reception events and the stock movement ledger.

-- ---------------------------------------------------------------------------
-- A lot is an IDENTITY. It never carries a quantity: quantities only exist in
-- the stock movement ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE raw_material_lots (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_code                 VARCHAR(48) NOT NULL UNIQUE,
    species_id               UUID NOT NULL REFERENCES species (id),
    supplier_id              UUID REFERENCES suppliers (id),
    vessel_id                UUID REFERENCES vessels (id),
    origin                   VARCHAR(128),
    tide_number              VARCHAR(48),
    capture_date             DATE,
    initial_reception_date   DATE,
    parent_lot_id            UUID REFERENCES raw_material_lots (id),
    status                   VARCHAR(16) NOT NULL DEFAULT 'ACTIF',
    notes                    TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               UUID NOT NULL REFERENCES users (id),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT raw_material_lots_status_allowed
        CHECK (status IN ('ACTIF', 'BLOQUE', 'EPUISE', 'FRACTIONNE', 'CLOTURE')),
    CONSTRAINT raw_material_lots_parent_not_self
        CHECK (parent_lot_id IS NULL OR parent_lot_id <> id)
);

CREATE INDEX raw_material_lots_species_idx ON raw_material_lots (species_id);
CREATE INDEX raw_material_lots_supplier_idx ON raw_material_lots (supplier_id);
CREATE INDEX raw_material_lots_parent_idx ON raw_material_lots (parent_lot_id);
CREATE INDEX raw_material_lots_status_idx ON raw_material_lots (status);
CREATE INDEX raw_material_lots_code_search_idx ON raw_material_lots (upper(lot_code) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- A reception is an EVENT on a lot. It always produces one stock movement.
-- ---------------------------------------------------------------------------
CREATE TABLE raw_material_receptions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reception_code              VARCHAR(32) NOT NULL UNIQUE,
    received_at                 TIMESTAMPTZ NOT NULL,
    raw_material_lot_id         UUID NOT NULL REFERENCES raw_material_lots (id),
    supplier_id                 UUID REFERENCES suppliers (id),
    vessel_id                   UUID REFERENCES vessels (id),
    tide_number                 VARCHAR(48),
    truck_registration          VARCHAR(48),
    quantity_kg                 NUMERIC(14, 3) NOT NULL,
    destination_location_id     UUID NOT NULL REFERENCES locations (id),
    reception_type              VARCHAR(32) NOT NULL,
    external_source_location_id UUID REFERENCES locations (id),
    document_reference          VARCHAR(64),
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                  UUID NOT NULL REFERENCES users (id),
    CONSTRAINT receptions_quantity_positive CHECK (quantity_kg > 0),
    CONSTRAINT receptions_type_allowed
        CHECK (reception_type IN ('FOURNISSEUR', 'RETOUR_SOUS_TRAITANCE',
                                  'TRANSFERT_ENTRANT', 'RETOUR_PRODUCTION', 'AUTRE'))
);

CREATE INDEX receptions_lot_idx ON raw_material_receptions (raw_material_lot_id);
CREATE INDEX receptions_received_at_idx ON raw_material_receptions (received_at DESC);
CREATE INDEX receptions_destination_idx ON raw_material_receptions (destination_location_id);
CREATE INDEX receptions_truck_idx ON raw_material_receptions (upper(truck_registration));

-- ---------------------------------------------------------------------------
-- The single inventory ledger. Quantity is always positive; the direction of
-- the movement comes from source_location_id / destination_location_id.
-- Movements are immutable: a mistake is corrected by a reversal movement.
-- ---------------------------------------------------------------------------
CREATE TABLE stock_movements (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_code           VARCHAR(32) NOT NULL UNIQUE,
    occurred_at             TIMESTAMPTZ NOT NULL,
    raw_material_lot_id     UUID NOT NULL REFERENCES raw_material_lots (id),
    movement_type           VARCHAR(24) NOT NULL,
    source_location_id      UUID REFERENCES locations (id),
    destination_location_id UUID REFERENCES locations (id),
    quantity_kg             NUMERIC(14, 3) NOT NULL,
    reference_type          VARCHAR(32) NOT NULL,
    reference_id            UUID,
    reason                  TEXT,
    notes                   TEXT,
    reverses_movement_id    UUID UNIQUE REFERENCES stock_movements (id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by              UUID NOT NULL REFERENCES users (id),
    CONSTRAINT movements_quantity_positive CHECK (quantity_kg > 0),
    CONSTRAINT movements_type_allowed
        CHECK (movement_type IN ('RECEPTION', 'TRANSFERT', 'CONSOMMATION', 'SOUS_TRAITANCE',
                                 'RETOUR', 'PERTE', 'AJUSTEMENT', 'FRACTIONNEMENT')),
    CONSTRAINT movements_reference_type_allowed
        CHECK (reference_type IN ('RECEPTION', 'TRANSFERT', 'SOUS_TRAITANCE',
                                  'SOUS_TRAITANCE_RESULTAT', 'PERTE', 'AJUSTEMENT',
                                  'FRACTIONNEMENT', 'ANNULATION')),
    -- A movement must move material somewhere: at least one side is set.
    CONSTRAINT movements_has_direction
        CHECK (source_location_id IS NOT NULL OR destination_location_id IS NOT NULL),
    CONSTRAINT movements_source_differs_from_destination
        CHECK (source_location_id IS NULL
               OR destination_location_id IS NULL
               OR source_location_id <> destination_location_id),
    -- Direction rules per movement type (section 16 of the specification).
    CONSTRAINT movements_reception_is_inbound
        CHECK (movement_type <> 'RECEPTION'
               OR (source_location_id IS NULL AND destination_location_id IS NOT NULL)),
    CONSTRAINT movements_transfer_is_two_sided
        CHECK (movement_type NOT IN ('TRANSFERT', 'SOUS_TRAITANCE', 'RETOUR')
               OR (source_location_id IS NOT NULL AND destination_location_id IS NOT NULL)),
    CONSTRAINT movements_loss_is_outbound
        CHECK (movement_type <> 'PERTE'
               OR (source_location_id IS NOT NULL AND destination_location_id IS NULL)),
    CONSTRAINT movements_loss_requires_reason
        CHECK (movement_type <> 'PERTE' OR reason IS NOT NULL),
    CONSTRAINT movements_adjustment_requires_reason
        CHECK (movement_type <> 'AJUSTEMENT' OR reason IS NOT NULL),
    CONSTRAINT movements_consumption_is_outbound
        CHECK (movement_type <> 'CONSOMMATION' OR source_location_id IS NOT NULL)
);

CREATE INDEX movements_lot_idx ON stock_movements (raw_material_lot_id);
CREATE INDEX movements_source_idx ON stock_movements (source_location_id);
CREATE INDEX movements_destination_idx ON stock_movements (destination_location_id);
CREATE INDEX movements_occurred_at_idx ON stock_movements (occurred_at DESC);
CREATE INDEX movements_reference_idx ON stock_movements (reference_type, reference_id);
