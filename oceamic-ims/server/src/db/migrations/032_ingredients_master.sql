-- OCEAMIC IMS - Phase 8
-- Ingredients and production consumables, part 1: master data. Ingredient
-- stock is a traceable material flow of its own (section 2), entirely
-- separate from the Phase 1 raw-fish stock engine - its own tables, its own
-- movement vocabulary, no shared code.

-- Ingredient locations (MAGASIN_INGREDIENTS, cuves, zone de préparation...)
-- reuse the existing locations table (section 10) rather than a parallel
-- location concept - INGREDIENT is simply a new stock_domain value, so
-- existing MP/PF domain checks (fgStock.ts) continue to reject ingredient
-- locations exactly as before, and ingredient locations never enter the
-- fish/finished-goods stock calculations.
ALTER TABLE locations DROP CONSTRAINT locations_stock_domain_allowed;
ALTER TABLE locations ADD CONSTRAINT locations_stock_domain_allowed
    CHECK (stock_domain IN ('MP', 'PF', 'MIXTE', 'INGREDIENT'));

-- Ingredient type is genuine configuration data (section 6: "do not hardcode
-- into UI logic"), a reference table like failure_modes/downtime_categories,
-- never a CHECK-constrained enum requiring a migration to extend.
CREATE TABLE ingredient_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ingredient_loss_reasons (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ingredient identity (section 5). filling_medium_id is the explicit,
-- optional link back to Phase 4's filling_media (section 16): a filling
-- operation already carries a filling_medium_id, so a real join
-- (filling_operations -> filling_media <- ingredients -> ingredient_lots)
-- resolves which ingredient lot fed a given filling operation, without a
-- second, disconnected medium identity.
CREATE TABLE ingredients (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_code             VARCHAR(32) NOT NULL UNIQUE,
    name                        VARCHAR(128) NOT NULL,
    ingredient_type_id          UUID NOT NULL REFERENCES ingredient_types (id),
    default_unit                VARCHAR(8) NOT NULL,
    filling_medium_id           UUID REFERENCES filling_media (id),
    requires_lot_traceability   BOOLEAN NOT NULL DEFAULT TRUE,
    is_recoverable              BOOLEAN NOT NULL DEFAULT FALSE,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ingredients_default_unit_allowed
        CHECK (default_unit IN ('L', 'KG', 'G', 'ML', 'UNITE'))
);

CREATE INDEX ingredients_type_idx ON ingredients (ingredient_type_id);

-- Ingredient lot: a traceable supplier batch (section 8), the same
-- discipline as raw_material_lots - never a bare running total. quality_status
-- is this entity's own quality truth (section 9): lot_blocks (Phase 1) is
-- hardwired to raw_material_lot_id and finished_goods_quality_blocks (Phase
-- 5) to Lot PF/pallet, neither is polymorphic, so restructuring either to
-- fit ingredients would risk Phase 1/5 behaviour for a "where practical"
-- instruction. This mirrors the same choice Phase 5 already made for
-- finished-goods quality (its own status, its own decisions) rather than
-- forcing a foreign entity through lot_blocks.
CREATE TABLE ingredient_lots (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_code             VARCHAR(32) NOT NULL UNIQUE,
    ingredient_id        UUID NOT NULL REFERENCES ingredients (id),
    supplier_id          UUID REFERENCES suppliers (id),
    supplier_lot_code    VARCHAR(64),
    received_at          TIMESTAMPTZ,
    manufacture_date     DATE,
    expiry_date          DATE,
    quality_status       VARCHAR(16) NOT NULL DEFAULT 'LIBERE',
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           UUID NOT NULL REFERENCES users (id),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ingredient_lots_quality_status_allowed
        CHECK (quality_status IN ('LIBERE', 'BLOQUE', 'A_VERIFIER', 'REJETE')),
    CONSTRAINT ingredient_lots_expiry_after_manufacture
        CHECK (expiry_date IS NULL OR manufacture_date IS NULL OR expiry_date >= manufacture_date)
);

CREATE INDEX ingredient_lots_ingredient_idx ON ingredient_lots (ingredient_id);
CREATE INDEX ingredient_lots_quality_status_idx ON ingredient_lots (quality_status);
CREATE INDEX ingredient_lots_expiry_idx ON ingredient_lots (expiry_date);
