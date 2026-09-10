-- OCEAMIC IMS - Phase 8
-- Ingredients and production consumables, part 6: consumption standards
-- (section 40). A CONSUMPTION STANDARD is an expected process usage
-- reference (section 75), distinct from the actual consumption it is later
-- compared against - never invented, always configured, and left absent
-- (STANDARD_NON_DEFINI) rather than guessed when no row applies.
CREATE TABLE ingredient_consumption_standards (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id         UUID NOT NULL REFERENCES ingredients (id),
    product_id            UUID REFERENCES products (id),
    format                VARCHAR(32),
    filling_medium_id     UUID REFERENCES filling_media (id),
    target_per_1000_units NUMERIC(10, 3) NOT NULL,
    min_per_1000_units    NUMERIC(10, 3),
    max_per_1000_units    NUMERIC(10, 3),
    valid_from            DATE NOT NULL,
    valid_to              DATE,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL REFERENCES users (id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ingredient_standards_target_positive CHECK (target_per_1000_units > 0),
    CONSTRAINT ingredient_standards_min_max CHECK (
        min_per_1000_units IS NULL OR max_per_1000_units IS NULL OR max_per_1000_units >= min_per_1000_units
    ),
    CONSTRAINT ingredient_standards_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX ingredient_standards_ingredient_idx ON ingredient_consumption_standards (ingredient_id);
CREATE INDEX ingredient_standards_product_idx ON ingredient_consumption_standards (product_id);
CREATE INDEX ingredient_standards_active_idx ON ingredient_consumption_standards (is_active);
