-- OCEAMIC IMS - Phase 3
-- Coverage, cadence and downtime are never typed by a user: they are derived
-- from validated records. These views are the single place the formulas live.

-- Coverage per line control: controlled / expected, with a status derived
-- from the count, never chosen by a user. expected = 0 counts as complete
-- (nothing was expected, so nothing is missing) and never divides by zero.
CREATE VIEW line_control_coverage AS
SELECT lc.id AS line_control_id,
       lc.expected_employee_count,
       COALESCE(e.controlled_employee_count, 0) AS controlled_employee_count,
       CASE WHEN lc.expected_employee_count = 0 THEN NULL
            ELSE round(COALESCE(e.controlled_employee_count, 0)::numeric
                       / lc.expected_employee_count * 100, 2)
       END AS coverage_percent,
       CASE WHEN lc.expected_employee_count = 0 THEN 'COMPLET'
            WHEN COALESCE(e.controlled_employee_count, 0) >= lc.expected_employee_count THEN 'COMPLET'
            ELSE 'INCOMPLET'
       END AS coverage_status
  FROM line_controls lc
  LEFT JOIN (
        SELECT line_control_id, COUNT(*)::integer AS controlled_employee_count
          FROM employee_cadence_controls
         WHERE status = 'VALIDE'
         GROUP BY line_control_id
  ) e ON e.line_control_id = lc.id;

-- Cadence of one line control: quantity produced by the group over the
-- group's total measured labour-hours (not wall-clock line time). This is
-- what makes the figure directly comparable to an individual cadence
-- standard even when employees were each measured for a different duration
-- (section 29): summing per-employee rates would be wrong, but combining raw
-- quantity over combined labour-hours is not.
CREATE VIEW line_control_cadence AS
SELECT lc.id AS line_control_id,
       lc.production_run_id,
       lc.production_run_line_id,
       lc.activity_type,
       COALESCE(SUM(ecc.quantity_completed), 0)::numeric(12,3) AS total_quantity,
       COALESCE(SUM(ecc.measurement_duration_seconds), 0) / 3600.0 AS total_labor_hours,
       CASE WHEN COALESCE(SUM(ecc.measurement_duration_seconds), 0) = 0 THEN NULL
            ELSE round(SUM(ecc.quantity_completed)
                       / (SUM(ecc.measurement_duration_seconds) / 3600.0), 2)
       END AS line_cadence_per_hour
  FROM line_controls lc
  LEFT JOIN employee_cadence_controls ecc
         ON ecc.line_control_id = lc.id AND ecc.status = 'VALIDE'
 GROUP BY lc.id, lc.production_run_id, lc.production_run_line_id, lc.activity_type;

-- Round-level summary: lines and employees expected versus controlled,
-- restricted to the lines actually visited during the round.
CREATE VIEW control_round_summary AS
SELECT cr.id AS control_round_id,
       cr.production_run_id,
       COUNT(lc.id)::integer AS lines_visited,
       COUNT(lc.id) FILTER (WHERE lc.status = 'TERMINE')::integer AS lines_completed,
       COALESCE(SUM(lc.expected_employee_count), 0)::integer AS employees_expected,
       COALESCE(SUM(cov.controlled_employee_count), 0)::integer AS employees_controlled,
       CASE WHEN COALESCE(SUM(lc.expected_employee_count), 0) = 0 THEN NULL
            ELSE round(COALESCE(SUM(cov.controlled_employee_count), 0)::numeric
                       / SUM(lc.expected_employee_count) * 100, 2)
       END AS coverage_percent
  FROM control_rounds cr
  LEFT JOIN line_controls lc ON lc.control_round_id = cr.id
  LEFT JOIN line_control_coverage cov ON cov.line_control_id = lc.id
 GROUP BY cr.id, cr.production_run_id;

-- Total closed downtime per Run, plus whether a downtime event is currently
-- open. An open event has no duration yet: it is excluded from the total and
-- surfaced separately so a live counter can be built in the interface without
-- writing a changing duration to the database every second.
CREATE VIEW run_downtime_summary AS
SELECT r.id AS production_run_id,
       COALESCE(SUM(d.duration_seconds) FILTER (WHERE d.ended_at IS NOT NULL), 0)::integer
           AS total_downtime_seconds,
       COUNT(d.id) FILTER (WHERE d.ended_at IS NOT NULL)::integer AS closed_downtime_count,
       COUNT(d.id) FILTER (WHERE d.ended_at IS NULL)::integer AS active_downtime_count
  FROM production_runs r
  LEFT JOIN downtime_events d ON d.production_run_id = r.id
 GROUP BY r.id;

-- Reusable history feed for the employee, line and cadence screens: one row
-- per valid measurement with everything needed for display already joined.
CREATE VIEW employee_cadence_history AS
SELECT ecc.id                       AS id,
       ecc.controlled_at,
       ecc.production_run_id,
       r.run_code,
       r.production_date,
       p.code                       AS product_code,
       p.name                       AS product_name,
       sp.code                      AS species_code,
       ecc.production_run_line_id,
       pl.code                      AS line_code,
       pl.name                      AS line_name,
       lc.activity_type,
       ecc.employee_id,
       emp.employee_number,
       COALESCE(emp.display_name, emp.first_name || ' ' || emp.last_name) AS employee_name,
       ecc.quantity_completed,
       ecc.measurement_unit,
       ecc.measurement_duration_seconds,
       ecc.cadence_per_hour,
       ecc.standard_cadence_snapshot,
       ecc.performance_percent
  FROM employee_cadence_controls ecc
  JOIN line_controls lc ON lc.id = ecc.line_control_id
  JOIN production_runs r ON r.id = ecc.production_run_id
  JOIN products p ON p.id = r.product_id
  JOIN species sp ON sp.id = r.species_id
  JOIN production_run_lines rl ON rl.id = ecc.production_run_line_id
  JOIN production_lines pl ON pl.id = rl.production_line_id
  JOIN employees emp ON emp.id = ecc.employee_id
 WHERE ecc.status = 'VALIDE';
