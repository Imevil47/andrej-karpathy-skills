-- OCEAMIC IMS - Phase 7
-- Maintenance / CMMS layer, part 5: spare parts (sections 38-40). A
-- separate inventory identity from the fish/raw-material stock engine
-- (Phase 1) - its own tables, its own movement types, no shared code.
--
-- current_stock is never a cached column: the same discipline as
-- raw_material_lots (Phase 1, balances read from stock_movements), spare
-- part stock is always SUM(quantity_delta) over spare_part_stock_movements
-- (see 031_maintenance_views.sql's spare_part_stock view) so it can never
-- drift out of sync with its own ledger.
CREATE TABLE spare_parts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_code        VARCHAR(32) NOT NULL UNIQUE,
    name             VARCHAR(200) NOT NULL,
    description      TEXT,
    unit             VARCHAR(16) NOT NULL DEFAULT 'PIECE',
    minimum_stock    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    location_id      UUID REFERENCES locations (id),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_by       UUID NOT NULL REFERENCES users (id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT spare_parts_minimum_stock_not_negative CHECK (minimum_stock >= 0)
);

-- quantity_delta is signed and computed by the service layer (positive for
-- RECEPTION/RETOUR, negative for SORTIE_INTERVENTION, either sign for a
-- RESPONSABLE_MAINTENANCE-authorized AJUSTEMENT). TRANSFERT only changes
-- spare_parts.location_id - Phase 7 does not model per-location spare-part
-- stock (out of scope, section 64), so a transfer is net-zero on the
-- quantity ledger and is the only movement type allowed a zero delta.
CREATE TABLE spare_part_stock_movements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spare_part_id    UUID NOT NULL REFERENCES spare_parts (id),
    movement_type    VARCHAR(24) NOT NULL,
    quantity_delta   NUMERIC(12, 2) NOT NULL,
    reason           TEXT,
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID NOT NULL REFERENCES users (id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT spare_part_movements_type_allowed
        CHECK (movement_type IN ('RECEPTION', 'SORTIE_INTERVENTION', 'TRANSFERT', 'RETOUR', 'AJUSTEMENT')),
    CONSTRAINT spare_part_movements_delta_nonzero
        CHECK (movement_type = 'TRANSFERT' OR quantity_delta <> 0)
);

CREATE INDEX spare_part_stock_movements_part_idx ON spare_part_stock_movements (spare_part_id);

-- Parts consumed by an intervention (section 39/46). stock_movement_id is
-- UNIQUE and NOT NULL: every part usage produces exactly one
-- SORTIE_INTERVENTION movement, created in the same transaction, so a part
-- can never be subtracted from stock twice for the same usage (section 55).
CREATE TABLE maintenance_part_usage (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intervention_id     UUID NOT NULL REFERENCES maintenance_interventions (id),
    spare_part_id       UUID NOT NULL REFERENCES spare_parts (id),
    quantity            NUMERIC(12, 2) NOT NULL,
    stock_movement_id   UUID NOT NULL UNIQUE REFERENCES spare_part_stock_movements (id),
    created_by          UUID NOT NULL REFERENCES users (id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT maintenance_part_usage_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX maintenance_part_usage_intervention_idx ON maintenance_part_usage (intervention_id);
CREATE INDEX maintenance_part_usage_spare_part_idx ON maintenance_part_usage (spare_part_id);
