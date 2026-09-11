-- OCEAMIC IMS - Phase 6
-- Calculated QMS status, the same discipline as everywhere else in
-- OCEAMIC IMS: overdue and closure-readiness are never opinions typed by a
-- user, always derived from dates and linked records already on file.

-- CAPA action progress: total/open/overdue, `CURRENT_DATE` compared against
-- `due_date` on every action still open (section 44's overdue rule, applied
-- to CAPA actions).
CREATE VIEW capa_action_progress AS
SELECT capa_id,
       COUNT(*)::integer AS total_actions,
       COUNT(*) FILTER (WHERE status NOT IN ('TERMINEE', 'ANNULEE'))::integer AS open_actions,
       COUNT(*) FILTER (
             WHERE status NOT IN ('TERMINEE', 'ANNULEE') AND due_date IS NOT NULL
               AND due_date < CURRENT_DATE
       )::integer AS overdue_actions
  FROM capa_actions
 GROUP BY capa_id;

-- CAPA effectiveness: whether any check exists yet, and whether the latest
-- one found the CAPA effective - section 15's closure gate reads this
-- directly instead of re-deriving it inline in the service.
CREATE VIEW capa_effectiveness_status AS
SELECT DISTINCT ON (capa_id)
       capa_id,
       checked_at AS latest_checked_at,
       effective  AS latest_effective
  FROM capa_effectiveness_checks
 ORDER BY capa_id, checked_at DESC;

-- One row per CAPA: progress, effectiveness and a computed closure
-- eligibility flag, reused identically by the closure service (a hard gate)
-- and the CAPA list/detail screens (an explanation of what is still open).
CREATE VIEW capa_summary AS
SELECT c.id AS capa_id,
       c.status,
       c.effectiveness_required,
       COALESCE(p.total_actions, 0)   AS total_actions,
       COALESCE(p.open_actions, 0)    AS open_actions,
       COALESCE(p.overdue_actions, 0) AS overdue_actions,
       e.latest_effective,
       (COALESCE(p.open_actions, 0) = 0
        AND (NOT c.effectiveness_required OR e.latest_effective IS TRUE)) AS can_close
  FROM capa_records c
  LEFT JOIN capa_action_progress p ON p.capa_id = c.id
  LEFT JOIN capa_effectiveness_status e ON e.capa_id = c.id;

-- Audit progress: responses recorded against the checklist attached to the
-- audit (if any), and open findings - the "Constats / Actions ouvertes"
-- columns of the Audit screen (section 42).
-- Every count is cast to ::integer, the same discipline as
-- capa_action_progress above: left uncast, COUNT(*) is bigint and the pg
-- driver returns it as a string, silently breaking any numeric comparison
-- (`=== 3`) on the API response.
CREATE VIEW audit_progress AS
SELECT a.id AS audit_id,
       COALESCE(items.total_items, 0)::integer      AS total_checklist_items,
       COALESCE(responses.response_count, 0)::integer AS response_count,
       COALESCE(findings.finding_count, 0)::integer   AS finding_count,
       COALESCE(findings.open_finding_count, 0)::integer AS open_finding_count
  FROM audits a
  LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_items FROM audit_checklist_items i
         WHERE i.audit_checklist_id = a.audit_checklist_id AND i.is_active
  ) items ON TRUE
  LEFT JOIN LATERAL (
        SELECT COUNT(*) AS response_count FROM audit_responses r WHERE r.audit_id = a.id
  ) responses ON TRUE
  LEFT JOIN LATERAL (
        SELECT COUNT(*) AS finding_count,
               COUNT(*) FILTER (WHERE f.status NOT IN ('CLOTUREE', 'ANNULEE')) AS open_finding_count
          FROM audit_findings f WHERE f.audit_id = a.id
  ) findings ON TRUE;
