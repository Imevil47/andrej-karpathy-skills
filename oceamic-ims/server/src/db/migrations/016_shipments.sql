-- OCEAMIC IMS - Phase 5
-- Customers, shipments, shipment lines and stock reservations. A shipment is
-- a customer logistics event (section 62), never merged with the container
-- concept (its own identity columns on this table) or with the reservation
-- mechanism that protects it from double allocation.

-- ---------------------------------------------------------------------------
-- Customer master data (section 22): shipping/traceability reference only,
-- never a CRM.
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    country     VARCHAR(64),
    city        VARCHAR(64),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Shipment: the customer logistics event. Container/transport identity
-- (section 29) lives directly on the shipment - Phase 5 ships one container
-- per shipment operationally, so a separate containers table would only add
-- an unused join; every field OCEAMIC actually asked for (n° conteneur,
-- n° scellé, température consigne, GENSET) stays nullable, since none of
-- them applies to every shipment.
-- ---------------------------------------------------------------------------
CREATE TABLE shipments (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_code          VARCHAR(32) NOT NULL UNIQUE,
    planned_date           DATE NOT NULL,
    shipped_at             TIMESTAMPTZ,
    customer_id            UUID NOT NULL REFERENCES customers (id),
    destination             VARCHAR(128) NOT NULL,
    container_number        VARCHAR(32),
    seal_number              VARCHAR(32),
    vehicle_registration     VARCHAR(32),
    target_temperature_c    NUMERIC(5, 2),
    genset_required          BOOLEAN,
    status                   VARCHAR(16) NOT NULL DEFAULT 'PLANIFIEE',
    cancellation_reason      TEXT,
    notes                    TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID NOT NULL REFERENCES users (id),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shipments_status_allowed
        CHECK (status IN ('PLANIFIEE', 'EN_PREPARATION', 'EN_CHARGEMENT', 'EXPEDIEE', 'ANNULEE')),
    CONSTRAINT shipments_shipped_has_timestamp
        CHECK (status <> 'EXPEDIEE' OR shipped_at IS NOT NULL),
    CONSTRAINT shipments_cancelled_has_reason
        CHECK (status <> 'ANNULEE' OR cancellation_reason IS NOT NULL)
);

CREATE INDEX shipments_customer_idx ON shipments (customer_id);
CREATE INDEX shipments_status_idx ON shipments (status);
CREATE INDEX shipments_planned_date_idx ON shipments (planned_date);
CREATE INDEX shipments_code_search_idx ON shipments (upper(shipment_code) varchar_pattern_ops);
CREATE INDEX shipments_container_search_idx
    ON shipments (upper(container_number) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- Shipment line: the confirmed content plan of a shipment (section 23),
-- always pallet-based - real warehouse picking works pallet by pallet.
-- finished_good_lot_id is kept only as an informational, denormalized
-- reference (populated when the pallet is mono-lot); the authoritative Lot
-- PF composition of any pallet always comes from pallet_contents.
-- ---------------------------------------------------------------------------
CREATE TABLE shipment_lines (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id            UUID NOT NULL REFERENCES shipments (id),
    pallet_id              UUID NOT NULL REFERENCES pallets (id),
    finished_good_lot_id   UUID REFERENCES finished_good_lots (id),
    quantity_cartons       BIGINT NOT NULL,
    quantity_units         BIGINT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by              UUID NOT NULL REFERENCES users (id),
    CONSTRAINT shipment_lines_quantities_positive
        CHECK (quantity_cartons > 0 AND quantity_units > 0),
    CONSTRAINT shipment_lines_unique_pallet_per_shipment UNIQUE (shipment_id, pallet_id)
);

CREATE INDEX shipment_lines_shipment_idx ON shipment_lines (shipment_id);
CREATE INDEX shipment_lines_pallet_idx ON shipment_lines (pallet_id);

-- ---------------------------------------------------------------------------
-- Stock reservation: future allocation of available inventory (section 62),
-- structurally separate from both the physical stock ledger and the
-- shipment's confirmed line. Adding a pallet to a shipment opens a
-- reservation in the same transaction; the partial unique index below is
-- what makes double-booking (section 24) and loading the same pallet twice
-- (section 28) impossible at the database level, not just in application
-- logic.
-- ---------------------------------------------------------------------------
CREATE TABLE stock_reservations (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id            UUID NOT NULL REFERENCES shipments (id),
    pallet_id              UUID NOT NULL REFERENCES pallets (id),
    finished_good_lot_id   UUID REFERENCES finished_good_lots (id),
    quantity_cartons       BIGINT NOT NULL,
    quantity_units         BIGINT NOT NULL,
    reserved_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    status                 VARCHAR(16) NOT NULL DEFAULT 'ACTIF',
    released_at            TIMESTAMPTZ,
    created_by              UUID NOT NULL REFERENCES users (id),
    CONSTRAINT stock_reservations_quantities_positive
        CHECK (quantity_cartons > 0 AND quantity_units > 0),
    CONSTRAINT stock_reservations_status_allowed
        CHECK (status IN ('ACTIF', 'CONSOMMEE', 'ANNULEE'))
);

-- A pallet can never carry two simultaneous active reservations, whether for
-- the same shipment or a different one.
CREATE UNIQUE INDEX stock_reservations_one_active_per_pallet
    ON stock_reservations (pallet_id)
    WHERE status = 'ACTIF';

CREATE INDEX stock_reservations_shipment_idx ON stock_reservations (shipment_id);
CREATE INDEX stock_reservations_pallet_idx ON stock_reservations (pallet_id);
