-- OCEAMIC IMS - Phase 1
-- Foundation: reference/master data, users and roles, readable operational codes.

-- ---------------------------------------------------------------------------
-- Readable operational codes (LOT-20260907-001, MVT-20260907-00001, ...).
-- The counter row is locked by the UPSERT, so concurrent transactions can never
-- obtain the same sequence number for the same prefix and day.
-- ---------------------------------------------------------------------------
CREATE TABLE code_counters (
    prefix       VARCHAR(8) NOT NULL,
    counter_day  DATE       NOT NULL,
    last_number  INTEGER    NOT NULL,
    PRIMARY KEY (prefix, counter_day)
);

CREATE FUNCTION next_operational_code(p_prefix VARCHAR, p_day DATE, p_width INTEGER)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_number INTEGER;
BEGIN
    INSERT INTO code_counters (prefix, counter_day, last_number)
    VALUES (p_prefix, p_day, 1)
    ON CONFLICT (prefix, counter_day)
    DO UPDATE SET last_number = code_counters.last_number + 1
    RETURNING last_number INTO v_number;

    RETURN p_prefix || '-' || to_char(p_day, 'YYYYMMDD') || '-'
           || lpad(v_number::TEXT, p_width, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- Users and roles
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT roles_code_allowed
        CHECK (code IN ('ADMIN', 'QUALITE', 'STOCK', 'PRODUCTION', 'LECTURE'))
);

CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username       VARCHAR(64) NOT NULL UNIQUE,
    full_name      VARCHAR(128) NOT NULL,
    password_hash  TEXT NOT NULL,
    role_id        UUID NOT NULL REFERENCES roles (id),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_role_id_idx ON users (role_id);

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
CREATE TABLE species (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    country     VARCHAR(64),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vessels (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code              VARCHAR(32) NOT NULL UNIQUE,
    name              VARCHAR(128) NOT NULL,
    registration      VARCHAR(64),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Locations carry the stock configuration. Internal / external classification
-- is NEVER entered on a transaction: it is derived from the location.
CREATE TABLE locations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code           VARCHAR(32) NOT NULL UNIQUE,
    name           VARCHAR(128) NOT NULL,
    stock_type     VARCHAR(16) NOT NULL,
    location_type  VARCHAR(24) NOT NULL,
    can_receive    BOOLEAN NOT NULL DEFAULT TRUE,
    can_store      BOOLEAN NOT NULL DEFAULT TRUE,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT locations_stock_type_allowed
        CHECK (stock_type IN ('INTERNE', 'EXTERNE')),
    CONSTRAINT locations_location_type_allowed
        CHECK (location_type IN ('USINE', 'ENTREPOT', 'SOUS_TRAITANT', 'ZONE_TRANSIT', 'AUTRE'))
);

CREATE INDEX locations_stock_type_idx ON locations (stock_type);

-- A subcontractor owns exactly one stock location: material physically held by
-- the subcontractor stays OCEAMIC stock, stored at that external location.
CREATE TABLE subcontractors (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code         VARCHAR(32) NOT NULL UNIQUE,
    name         VARCHAR(128) NOT NULL,
    location_id  UUID NOT NULL UNIQUE REFERENCES locations (id),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
