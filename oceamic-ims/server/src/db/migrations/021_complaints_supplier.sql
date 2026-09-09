-- OCEAMIC IMS - Phase 6
-- Customer complaints and supplier quality incidents: two customer/supplier-
-- originated QMS event types (section 70), never a CRM/supplier portal
-- (section 68) - shipping/traceability/quality usage only.

CREATE TABLE customer_complaints (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_code        VARCHAR(32) NOT NULL UNIQUE,
    received_at           TIMESTAMPTZ NOT NULL,
    customer_id           UUID NOT NULL REFERENCES customers (id),
    shipment_id           UUID REFERENCES shipments (id),
    finished_good_lot_id  UUID REFERENCES finished_good_lots (id),
    pallet_id             UUID REFERENCES pallets (id),
    complaint_type        VARCHAR(24) NOT NULL,
    description           TEXT NOT NULL,
    severity              VARCHAR(16) NOT NULL,
    status                VARCHAR(16) NOT NULL DEFAULT 'OUVERTE',
    owner_user_id         UUID REFERENCES users (id),
    -- Denormalized references to the NCR/CAPA the complaint gave rise to
    -- (section 18): the investigation itself is never duplicated, only linked.
    resulting_nonconformity_id UUID REFERENCES nonconformities (id),
    resulting_capa_id          UUID REFERENCES capa_records (id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL REFERENCES users (id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT customer_complaints_type_allowed
        CHECK (complaint_type IN ('QUALITE', 'POIDS', 'SERTISSAGE', 'BOITE_DEFORMEE',
                                  'MARQUAGE', 'ODEUR', 'GOUT', 'CORPS_ETRANGER',
                                  'QUANTITE', 'DOCUMENTATION', 'AUTRE')),
    CONSTRAINT customer_complaints_severity_allowed
        CHECK (severity IN ('MINEURE', 'MAJEURE', 'CRITIQUE')),
    CONSTRAINT customer_complaints_status_allowed
        CHECK (status IN ('OUVERTE', 'EN_ANALYSE', 'ACTION_REQUISE', 'CLOTUREE', 'ANNULEE'))
);

CREATE INDEX customer_complaints_customer_idx ON customer_complaints (customer_id);
CREATE INDEX customer_complaints_shipment_idx ON customer_complaints (shipment_id);
CREATE INDEX customer_complaints_status_idx ON customer_complaints (status);
CREATE INDEX customer_complaints_code_search_idx
    ON customer_complaints (upper(complaint_code) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- Supplier quality incident (section 19). `category` stays free text: the
-- spec's own examples (histamine, température, moule incorrect, document
-- manquant...) span too many domains for one configurable table without
-- clear benefit over a required text field, unlike NCR categories which are
-- reused everywhere across the QMS.
-- ---------------------------------------------------------------------------
CREATE TABLE supplier_quality_incidents (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_code        VARCHAR(32) NOT NULL UNIQUE,
    supplier_id          UUID NOT NULL REFERENCES suppliers (id),
    raw_material_lot_id  UUID REFERENCES raw_material_lots (id),
    reception_id         UUID REFERENCES raw_material_receptions (id),
    detected_at          TIMESTAMPTZ NOT NULL,
    category             VARCHAR(120) NOT NULL,
    description          TEXT NOT NULL,
    severity             VARCHAR(16) NOT NULL,
    status               VARCHAR(16) NOT NULL DEFAULT 'OUVERTE',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           UUID NOT NULL REFERENCES users (id),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT supplier_quality_incidents_severity_allowed
        CHECK (severity IN ('MINEURE', 'MAJEURE', 'CRITIQUE')),
    CONSTRAINT supplier_quality_incidents_status_allowed
        CHECK (status IN ('OUVERTE', 'EN_ANALYSE', 'CLOTUREE', 'ANNULEE'))
);

CREATE INDEX supplier_quality_incidents_supplier_idx ON supplier_quality_incidents (supplier_id);
CREATE INDEX supplier_quality_incidents_status_idx ON supplier_quality_incidents (status);
