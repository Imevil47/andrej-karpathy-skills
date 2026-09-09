-- OCEAMIC IMS - Phase 7
-- Maintenance / CMMS layer, part 6: computed status, the same discipline as
-- 025_qms_views.sql - stock levels, overdue preventive tasks, active
-- failures and MTTR are never stored opinions, always derived from the
-- underlying ledger/event rows already on file.

-- Every spare part's running stock, from its own ledger only (never the
-- Phase 1 raw-material stock engine) - the same "balance is always summed,
-- never cached" discipline as raw_material_lots.
CREATE VIEW spare_part_stock AS
SELECT sp.id AS spare_part_id,
       sp.part_code,
       sp.minimum_stock,
       COALESCE(SUM(m.quantity_delta), 0) AS current_stock,
       COALESCE(SUM(m.quantity_delta), 0) < sp.minimum_stock AS below_minimum
  FROM spare_parts sp
  LEFT JOIN spare_part_stock_movements m ON m.spare_part_id = sp.id
 GROUP BY sp.id, sp.part_code, sp.minimum_stock;

-- "En retard" (section 56): never a manually selected value, always
-- (still PLANIFIEE and past its due date) at read time.
CREATE VIEW preventive_task_status AS
SELECT t.id AS preventive_task_id,
       t.maintenance_plan_id,
       t.due_at,
       t.status,
       (t.status = 'PLANIFIEE' AND t.due_at < now()) AS is_overdue
  FROM preventive_tasks t;

-- The most recent still-open failure per equipment (section 47: failure
-- visibility must not require visiting the Maintenance module to discover -
-- equipment/line/run pages join this view directly).
CREATE VIEW equipment_active_failure AS
SELECT DISTINCT ON (fr.equipment_id)
       fr.equipment_id,
       fr.id AS failure_report_id,
       fr.failure_code,
       fr.severity,
       fr.status,
       fr.reported_at
  FROM failure_reports fr
 WHERE fr.status IN ('DECLAREE', 'PRISE_EN_CHARGE')
 ORDER BY fr.equipment_id, fr.reported_at DESC;

-- MTTR (section 51): total corrective repair time / number of completed
-- corrective work orders, per equipment - only over work orders that are
-- actually TERMINE with at least one timed intervention. Equipment with no
-- completed corrective history has no row here; the caller shows "Données
-- insuffisantes" rather than a misleading average of zero.
CREATE VIEW equipment_mttr AS
SELECT wo.equipment_id,
       COUNT(*)::integer AS completed_corrective_count,
       SUM(iv.total_duration_seconds)::integer AS total_duration_seconds
  FROM maintenance_work_orders wo
  JOIN LATERAL (
        SELECT COALESCE(SUM(mi.duration_seconds), 0) AS total_duration_seconds
          FROM maintenance_interventions mi
         WHERE mi.work_order_id = wo.id AND mi.duration_seconds IS NOT NULL
  ) iv ON TRUE
 WHERE wo.work_order_type = 'CORRECTIVE' AND wo.status = 'TERMINE' AND iv.total_duration_seconds > 0
 GROUP BY wo.equipment_id;
