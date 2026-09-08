-- OCEAMIC IMS - Phase 5
-- Pallets: the logistics handling unit (section 62), distinct from both the
-- Finished Goods Lot identity and the stock ledger.

-- ---------------------------------------------------------------------------
-- Reuse the existing location model (section 14): no parallel PF location
-- table. stock_domain records which stock a location is meant to hold, so
-- Finished Goods screens can offer only PF-capable locations without
-- inventing a second locations table. Existing Phase 1 locations default to
-- 'MP', preserving their current meaning exactly.
-- ---------------------------------------------------------------------------
ALTER TABLE locations ADD COLUMN stock_domain VARCHAR(16) NOT NULL DEFAULT 'MP';
ALTER TABLE locations ADD CONSTRAINT locations_stock_domain_allowed
    CHECK (stock_domain IN ('MP', 'PF', 'MIXTE'));

-- ---------------------------------------------------------------------------
-- Pallet: the logistics handling unit. Composition (pallet_contents) is set
-- once at creation and never edited afterwards - a mistake is corrected by
-- cancelling the pallet and creating a new one, the same "no destructive
-- edits, no silent rewrite" philosophy used everywhere else in OCEAMIC IMS.
--
-- `status` is the operational handling state; `quality_status` is a fully
-- separate, independently derived field (section 56 of the Phase 4 rules,
-- applied identically here): a pallet can be operationally EN_STOCK while
-- still BLOQUE for Quality. The two are never merged into one column.
-- ---------------------------------------------------------------------------
CREATE TABLE pallets (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pallet_code           VARCHAR(32) NOT NULL UNIQUE,
    status                VARCHAR(16) NOT NULL DEFAULT 'EN_PREPARATION',
    quality_status        VARCHAR(16) NOT NULL DEFAULT 'A_VERIFIER',
    notes                 TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID NOT NULL REFERENCES users (id),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pallets_status_allowed
        CHECK (status IN ('EN_PREPARATION', 'TERMINEE', 'EN_STOCK', 'RESERVEE',
                          'EXPEDIEE', 'ANNULEE')),
    CONSTRAINT pallets_quality_status_allowed
        CHECK (quality_status IN ('BLOQUE', 'A_VERIFIER', 'LIBERE', 'REJETE'))
);

CREATE INDEX pallets_status_idx ON pallets (status);
CREATE INDEX pallets_quality_status_idx ON pallets (quality_status);
CREATE INDEX pallets_code_search_idx ON pallets (upper(pallet_code) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- Pallet content: which Lot(s) PF, and how many cartons/units, ride on a
-- pallet (section 12). A pallet is not forced to a single Lot PF unless the
-- caller only ever gives it one - the schema allows several rows per pallet.
-- ---------------------------------------------------------------------------
CREATE TABLE pallet_contents (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pallet_id              UUID NOT NULL REFERENCES pallets (id),
    finished_good_lot_id   UUID NOT NULL REFERENCES finished_good_lots (id),
    quantity_cartons       BIGINT NOT NULL,
    quantity_units         BIGINT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by              UUID NOT NULL REFERENCES users (id),
    CONSTRAINT pallet_contents_quantities_positive
        CHECK (quantity_cartons > 0 AND quantity_units > 0),
    CONSTRAINT pallet_contents_unique_lot_per_pallet UNIQUE (pallet_id, finished_good_lot_id)
);

CREATE INDEX pallet_contents_pallet_idx ON pallet_contents (pallet_id);
CREATE INDEX pallet_contents_lot_idx ON pallet_contents (finished_good_lot_id);
