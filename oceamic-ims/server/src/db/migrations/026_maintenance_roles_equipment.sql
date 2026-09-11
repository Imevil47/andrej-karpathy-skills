-- OCEAMIC IMS - Phase 7
-- Maintenance / CMMS layer, part 1: two new roles (section 52) and the
-- equipment registry extension (section 8). Existing tables are extended,
-- never rebuilt - equipment, production_lines, downtime_events, audit_log
-- and RBAC from earlier phases are reused as-is.

-- MAINTENANCE manages failures, work orders, interventions, preventive
-- tasks and spare-part consumption. RESPONSABLE_MAINTENANCE additionally
-- configures preventive plans, closes important work orders, manages
-- equipment master data and authorizes stock adjustments - the same
-- manage/approve split already used for QUALITE/RESPONSABLE_QUALITE
-- (018_qms_roles.sql), so the role that opens or works a job is never the
-- only one that can close an important one.
ALTER TABLE roles DROP CONSTRAINT roles_code_allowed;
ALTER TABLE roles ADD CONSTRAINT roles_code_allowed
    CHECK (code IN ('ADMIN', 'QUALITE', 'STOCK', 'PRODUCTION', 'LECTURE',
                    'RESPONSABLE_QUALITE', 'AUDITEUR',
                    'MAINTENANCE', 'RESPONSABLE_MAINTENANCE'));

-- Equipment types (section 7): configurable vocabulary, not hardcoded
-- behaviour - the CHECK constraint is widened, no type gets special-cased
-- logic anywhere else.
ALTER TABLE equipment DROP CONSTRAINT equipment_type_allowed;
ALTER TABLE equipment ADD CONSTRAINT equipment_type_allowed
    CHECK (equipment_type IN ('SERTISSEUSE', 'AUTOCLAVE', 'REMPLISSEUSE',
                              'CONVOYEUR', 'POMPE', 'COMPRESSEUR', 'CHAUDIERE',
                              'CHAMBRE_FROIDE', 'BALANCE', 'DETECTEUR',
                              'MACHINE_TRAITEMENT', 'AUTRE'));

-- Equipment identity (section 8): manufacturer/model/serial for asset
-- identification, an optional link to the production line it sits on, an
-- optional parent for hierarchy (e.g. a sub-component of an autoclave),
-- criticality (business importance - section 9, deliberately separate from
-- failure severity) and status (operational state - section 12,
-- deliberately separate from work-order status).
ALTER TABLE equipment
    ADD COLUMN manufacturer     VARCHAR(128),
    ADD COLUMN model            VARCHAR(128),
    ADD COLUMN serial_number    VARCHAR(128),
    ADD COLUMN production_line_id  UUID REFERENCES production_lines (id),
    ADD COLUMN parent_equipment_id UUID REFERENCES equipment (id),
    ADD COLUMN criticality      VARCHAR(16) NOT NULL DEFAULT 'MOYENNE',
    ADD COLUMN commissioned_at  DATE,
    ADD COLUMN status           VARCHAR(24) NOT NULL DEFAULT 'EN_SERVICE';

ALTER TABLE equipment ADD CONSTRAINT equipment_criticality_allowed
    CHECK (criticality IN ('FAIBLE', 'MOYENNE', 'HAUTE', 'CRITIQUE'));
ALTER TABLE equipment ADD CONSTRAINT equipment_status_allowed
    CHECK (status IN ('EN_SERVICE', 'EN_PANNE', 'EN_MAINTENANCE',
                      'HORS_SERVICE', 'EN_ATTENTE_PIECE', 'INACTIF'));
ALTER TABLE equipment ADD CONSTRAINT equipment_parent_not_self
    CHECK (parent_equipment_id IS NULL OR parent_equipment_id <> id);

CREATE INDEX equipment_production_line_idx ON equipment (production_line_id);
CREATE INDEX equipment_parent_idx ON equipment (parent_equipment_id);
CREATE INDEX equipment_status_idx ON equipment (status);
CREATE INDEX equipment_criticality_idx ON equipment (criticality);
