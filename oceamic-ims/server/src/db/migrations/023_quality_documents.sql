-- OCEAMIC IMS - Phase 6
-- Document control: a quality document is a controlled identity (section
-- 70), a revision is its controlled historical version - a revision is never
-- overwritten (section 27), and an obsolete revision is never exposed as
-- current (section 28).

CREATE TABLE quality_documents (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_code        VARCHAR(32) NOT NULL UNIQUE,
    title                VARCHAR(200) NOT NULL,
    document_type        VARCHAR(24) NOT NULL,
    department           VARCHAR(120),
    owner_user_id        UUID NOT NULL REFERENCES users (id),
    -- Set only after the first revision exists (circular with the table
    -- below), so the FK is added by ALTER TABLE further down.
    current_revision_id  UUID,
    -- Cached, never hand-edited (section 26 style throughout OCEAMIC IMS):
    -- always the status of current_revision_id, recomputed by the service.
    status               VARCHAR(16) NOT NULL DEFAULT 'BROUILLON',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           UUID NOT NULL REFERENCES users (id),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT quality_documents_type_allowed
        CHECK (document_type IN ('PROCEDURE', 'INSTRUCTION', 'FORMULAIRE', 'PLAN',
                                 'SPECIFICATION', 'MANUEL', 'POLITIQUE',
                                 'ENREGISTREMENT_MODELE', 'AUTRE')),
    CONSTRAINT quality_documents_status_allowed
        CHECK (status IN ('BROUILLON', 'EN_REVISION', 'APPROUVE', 'EN_VIGUEUR',
                          'OBSOLETE', 'ANNULE'))
);

CREATE INDEX quality_documents_status_idx ON quality_documents (status);
CREATE INDEX quality_documents_code_search_idx
    ON quality_documents (upper(document_code) varchar_pattern_ops);

-- ---------------------------------------------------------------------------
-- Document revision: never overwritten, always appended. `revision_number`
-- is sequential per document (01, 02, 03...); at most one revision per
-- document can be EN_VIGUEUR at a time (partial unique index below).
-- ---------------------------------------------------------------------------
CREATE TABLE quality_document_revisions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quality_document_id   UUID NOT NULL REFERENCES quality_documents (id),
    revision_number       INTEGER NOT NULL,
    effective_date        DATE,
    status                VARCHAR(16) NOT NULL DEFAULT 'BROUILLON',
    change_summary        TEXT NOT NULL,
    file_reference        TEXT,
    created_by            UUID NOT NULL REFERENCES users (id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by           UUID REFERENCES users (id),
    approved_at           TIMESTAMPTZ,
    CONSTRAINT quality_document_revisions_status_allowed
        CHECK (status IN ('BROUILLON', 'EN_REVISION', 'APPROUVE', 'EN_VIGUEUR',
                          'OBSOLETE', 'ANNULE')),
    CONSTRAINT quality_document_revisions_approval_pairing
        CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
    CONSTRAINT quality_document_revisions_unique_number
        UNIQUE (quality_document_id, revision_number)
);

CREATE UNIQUE INDEX quality_document_revisions_one_current
    ON quality_document_revisions (quality_document_id)
    WHERE status = 'EN_VIGUEUR';

CREATE INDEX quality_document_revisions_document_idx
    ON quality_document_revisions (quality_document_id);

ALTER TABLE quality_documents
    ADD CONSTRAINT quality_documents_current_revision_fk
    FOREIGN KEY (current_revision_id) REFERENCES quality_document_revisions (id);

-- ---------------------------------------------------------------------------
-- Training acknowledgment foundation (section 30): a lightweight record of
-- who acknowledged a controlled revision, never a full LMS.
-- ---------------------------------------------------------------------------
CREATE TABLE document_acknowledgments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_revision_id  UUID NOT NULL REFERENCES quality_document_revisions (id),
    user_id               UUID NOT NULL REFERENCES users (id),
    assigned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at       TIMESTAMPTZ,
    status                VARCHAR(16) NOT NULL DEFAULT 'ASSIGNEE',
    CONSTRAINT document_acknowledgments_status_allowed
        CHECK (status IN ('ASSIGNEE', 'ACQUITTEE', 'ANNULEE')),
    CONSTRAINT document_acknowledgments_unique
        UNIQUE (document_revision_id, user_id)
);

CREATE INDEX document_acknowledgments_revision_idx ON document_acknowledgments (document_revision_id);
CREATE INDEX document_acknowledgments_user_idx ON document_acknowledgments (user_id);
