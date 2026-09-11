-- OCEAMIC IMS - Phase 6
-- Two new roles for the horizontal QMS layer (section 53): RESPONSABLE_QUALITE
-- (approves root cause, CAPA closure, releases critical blocks, approves
-- documents, initiates recalls - authority QUALITE itself does not hold, so
-- the same broad role can never silently both raise and close a critical
-- issue) and AUDITEUR (conducts assigned audits and records findings only).
-- 001_foundation.sql is already applied everywhere, so its CHECK constraint
-- is widened here rather than edited in place.
ALTER TABLE roles DROP CONSTRAINT roles_code_allowed;
ALTER TABLE roles ADD CONSTRAINT roles_code_allowed
    CHECK (code IN ('ADMIN', 'QUALITE', 'STOCK', 'PRODUCTION', 'LECTURE',
                    'RESPONSABLE_QUALITE', 'AUDITEUR'));
