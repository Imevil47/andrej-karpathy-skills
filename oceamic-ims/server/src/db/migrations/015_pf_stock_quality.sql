-- OCEAMIC IMS - Phase 5
-- Finished Goods stock ledger and quality decisions/blocks. The stock ledger
-- is a new registry, deliberately not the Phase 1 stock_movements table
-- (section 15: raw-material kilograms and finished-goods cartons/units are
-- different domains, and mixing them would confuse both).

-- ---------------------------------------------------------------------------
-- Finished Goods stock ledger. Design decision (documented, scoped): every
-- real physical movement is tracked at PALLET granularity, exactly mirroring
-- how stock_movements tracks raw material at LOT + LOCATION granularity in
-- Phase 1. A Finished Goods Lot never has its own independent stock position
-- (section 5): its stock is always the sum, across every pallet that
-- contains it (pallet_contents), of that pallet's current location and
-- quantity. finished_good_lot_id is kept on this table only as an
-- informational, denormalized reference (populated when a pallet is
-- mono-lot); the balance-by-lot views always derive from pallet_contents,
-- never from this column, so there is exactly one source of truth.
--
-- RESERVATION and LIBERATION_RESERVATION are deliberately absent from
-- movement_type: a reservation never changes a physical location (see
-- stock_reservations in 016_shipments.sql), and section 16 itself warns
-- against confusing a quality block with a stock movement "unless physical
-- location changes" - the same principle excludes reservation here.
-- ---------------------------------------------------------------------------
CREATE TABLE finished_goods_stock_movements (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_code            VARCHAR(32) NOT NULL UNIQUE,
    occurred_at              TIMESTAMPTZ NOT NULL,
    pallet_id                UUID NOT NULL REFERENCES pallets (id),
    finished_good_lot_id     UUID REFERENCES finished_good_lots (id),
    movement_type            VARCHAR(24) NOT NULL,
    source_location_id       UUID REFERENCES locations (id),
    destination_location_id  UUID REFERENCES locations (id),
    quantity_cartons         BIGINT NOT NULL,
    quantity_units           BIGINT NOT NULL,
    reference_type           VARCHAR(32) NOT NULL,
    reference_id              UUID,
    reason                    TEXT,
    notes                     TEXT,
    reverses_movement_id      UUID UNIQUE REFERENCES finished_goods_stock_movements (id),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                 UUID NOT NULL REFERENCES users (id),
    CONSTRAINT fg_movements_quantities_positive
        CHECK (quantity_cartons > 0 AND quantity_units > 0),
    CONSTRAINT fg_movements_type_allowed
        CHECK (movement_type IN ('ENTREE_PRODUCTION', 'TRANSFERT', 'EXPEDITION', 'RETOUR',
                                 'AJUSTEMENT', 'BLOCAGE_LOGISTIQUE')),
    CONSTRAINT fg_movements_reference_type_allowed
        CHECK (reference_type IN ('PACKAGING', 'TRANSFERT', 'EXPEDITION', 'RETOUR',
                                  'AJUSTEMENT', 'BLOCAGE_LOGISTIQUE', 'ANNULATION')),
    CONSTRAINT fg_movements_has_direction
        CHECK (source_location_id IS NOT NULL OR destination_location_id IS NOT NULL),
    CONSTRAINT fg_movements_source_differs_from_destination
        CHECK (source_location_id IS NULL
               OR destination_location_id IS NULL
               OR source_location_id <> destination_location_id),
    -- Direction rules per movement type, the same discipline as stock_movements
    -- in Phase 1 (section 16).
    CONSTRAINT fg_movements_entry_is_inbound
        CHECK (movement_type <> 'ENTREE_PRODUCTION'
               OR (source_location_id IS NULL AND destination_location_id IS NOT NULL)),
    CONSTRAINT fg_movements_transfer_is_two_sided
        CHECK (movement_type NOT IN ('TRANSFERT', 'BLOCAGE_LOGISTIQUE')
               OR (source_location_id IS NOT NULL AND destination_location_id IS NOT NULL)),
    CONSTRAINT fg_movements_shipment_is_outbound
        CHECK (movement_type <> 'EXPEDITION'
               OR (source_location_id IS NOT NULL AND destination_location_id IS NULL)),
    CONSTRAINT fg_movements_return_is_inbound
        CHECK (movement_type <> 'RETOUR' OR destination_location_id IS NOT NULL),
    CONSTRAINT fg_movements_adjustment_has_reason
        CHECK (movement_type <> 'AJUSTEMENT' OR reason IS NOT NULL),
    CONSTRAINT fg_movements_block_has_reason
        CHECK (movement_type <> 'BLOCAGE_LOGISTIQUE' OR reason IS NOT NULL)
);

CREATE INDEX fg_movements_pallet_idx ON finished_goods_stock_movements (pallet_id);
CREATE INDEX fg_movements_lot_idx ON finished_goods_stock_movements (finished_good_lot_id);
CREATE INDEX fg_movements_source_idx ON finished_goods_stock_movements (source_location_id);
CREATE INDEX fg_movements_destination_idx ON finished_goods_stock_movements (destination_location_id);
CREATE INDEX fg_movements_occurred_at_idx ON finished_goods_stock_movements (occurred_at);
CREATE INDEX fg_movements_reference_idx
    ON finished_goods_stock_movements (reference_type, reference_id);

-- ---------------------------------------------------------------------------
-- Finished Goods quality decisions and blocks: one shared, polymorphic
-- mechanism for both new Phase 5 entity types (FINISHED_GOOD_LOT, PALLET)
-- rather than duplicating the Phase 1 quality_decisions/lot_blocks logic
-- twice over (section 20). The existing Phase 1 tables are untouched - they
-- stay raw-material-lot-specific exactly as built, and this pair of tables
-- follows their lifecycle shape (decision -> optional block -> release) by
-- convention, not by a shared foreign key: a generic entity_id cannot carry
-- a real foreign key across two different target tables, so entity_type is
-- validated in the service layer, the same pattern already used for
-- process_deviations' dual optional scope in Phase 4.
-- ---------------------------------------------------------------------------
CREATE TABLE finished_goods_quality_decisions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         VARCHAR(24) NOT NULL,
    entity_id           UUID NOT NULL,
    decision_type       VARCHAR(16) NOT NULL,
    reason              TEXT NOT NULL,
    decided_at          TIMESTAMPTZ NOT NULL,
    decided_by          UUID NOT NULL REFERENCES users (id),
    notes               TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fg_decisions_entity_type_allowed
        CHECK (entity_type IN ('FINISHED_GOOD_LOT', 'PALLET')),
    CONSTRAINT fg_decisions_type_allowed
        CHECK (decision_type IN ('ACCEPTE', 'BLOQUE', 'REJETE', 'LIBERE'))
);

CREATE INDEX fg_decisions_entity_idx ON finished_goods_quality_decisions (entity_type, entity_id);

CREATE TABLE finished_goods_quality_blocks (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type           VARCHAR(24) NOT NULL,
    entity_id             UUID NOT NULL,
    blocked_at            TIMESTAMPTZ NOT NULL,
    blocked_by            UUID REFERENCES users (id),
    reason                TEXT NOT NULL,
    block_decision_id     UUID REFERENCES finished_goods_quality_decisions (id),
    status                VARCHAR(16) NOT NULL DEFAULT 'ACTIF',
    released_at           TIMESTAMPTZ,
    released_by           UUID REFERENCES users (id),
    release_reason        TEXT,
    release_decision_id   UUID REFERENCES finished_goods_quality_decisions (id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fg_blocks_entity_type_allowed
        CHECK (entity_type IN ('FINISHED_GOOD_LOT', 'PALLET')),
    CONSTRAINT fg_blocks_status_allowed CHECK (status IN ('ACTIF', 'LEVE')),
    CONSTRAINT fg_blocks_release_is_documented
        CHECK (status <> 'LEVE'
               OR (released_at IS NOT NULL AND release_reason IS NOT NULL))
);

-- At most one active block per entity, exactly like lot_blocks in Phase 1.
CREATE UNIQUE INDEX fg_blocks_one_active_per_entity
    ON finished_goods_quality_blocks (entity_type, entity_id)
    WHERE status = 'ACTIF';

CREATE INDEX fg_blocks_entity_idx ON finished_goods_quality_blocks (entity_type, entity_id);
