-- OCEAMIC IMS - Phase 4
-- Weight control, seaming control and sterilization cycle summaries are never
-- typed by a user: they are derived from validated records, exactly like the
-- Phase 3 cadence/coverage views. These views are the single place the
-- formulas live.

-- Weight control summary (section 14): average/min/max, counts per status,
-- percentages, and the derived control status (section 16). expected < 0 can
-- never happen (sample_size > 0 is a CHECK constraint) so there is no
-- division-by-zero guard needed beyond the empty-sample case, handled below.
--
-- Control status rule (a scoped design decision, matching the spec's
-- explicit priority in section 15: underweight is the critical risk):
--   INCOMPLET    fewer samples recorded than the configured sample size
--   NON_CONFORME at least one underweight can
--   A_CORRIGER   no underweight, but at least one overweight can
--   CONFORME     every recorded sample within range, and enough samples
CREATE VIEW filling_weight_control_summary AS
SELECT wc.id AS weight_control_id,
       wc.sample_size,
       COUNT(s.id)::integer AS sample_count,
       CASE WHEN COUNT(s.id) = 0 THEN NULL
            ELSE round(AVG(s.measured_weight_g), 2) END AS average_weight_g,
       MIN(s.measured_weight_g) AS min_measured_weight_g,
       MAX(s.measured_weight_g) AS max_measured_weight_g,
       COUNT(*) FILTER (WHERE s.status = 'SOUS_POIDS')::integer AS underweight_count,
       COUNT(*) FILTER (WHERE s.status = 'CONFORME')::integer AS conforme_count,
       COUNT(*) FILTER (WHERE s.status = 'SURPOIDS')::integer AS overweight_count,
       CASE WHEN COUNT(s.id) = 0 THEN NULL
            ELSE round(COUNT(*) FILTER (WHERE s.status = 'SOUS_POIDS')::numeric
                       / COUNT(s.id) * 100, 2) END AS underweight_percent,
       CASE WHEN COUNT(s.id) = 0 THEN NULL
            ELSE round(COUNT(*) FILTER (WHERE s.status = 'CONFORME')::numeric
                       / COUNT(s.id) * 100, 2) END AS conforme_percent,
       CASE WHEN COUNT(s.id) = 0 THEN NULL
            ELSE round(COUNT(*) FILTER (WHERE s.status = 'SURPOIDS')::numeric
                       / COUNT(s.id) * 100, 2) END AS overweight_percent,
       CASE WHEN COUNT(s.id) < wc.sample_size THEN 'INCOMPLET'
            WHEN COUNT(*) FILTER (WHERE s.status = 'SOUS_POIDS') > 0 THEN 'NON_CONFORME'
            WHEN COUNT(*) FILTER (WHERE s.status = 'SURPOIDS') > 0 THEN 'A_CORRIGER'
            ELSE 'CONFORME'
       END AS control_status
  FROM filling_weight_controls wc
  LEFT JOIN filling_weight_samples s
         ON s.weight_control_id = wc.id AND s.record_status = 'VALIDE'
 GROUP BY wc.id, wc.sample_size;

-- Seaming control result (section 22/23): derived from its measurements,
-- never stored (see the note on seaming_controls in the migration). A control
-- with no measurement yet is INCOMPLET; any out-of-range measurement makes
-- the whole control NON_CONFORME.
CREATE VIEW seaming_control_result AS
SELECT sc.id AS seaming_control_id,
       COUNT(m.id)::integer AS measurement_count,
       COUNT(*) FILTER (WHERE m.status = 'NON_CONFORME')::integer AS non_conforme_count,
       CASE WHEN COUNT(m.id) = 0 THEN 'INCOMPLET'
            WHEN COUNT(*) FILTER (WHERE m.status = 'NON_CONFORME') > 0 THEN 'NON_CONFORME'
            ELSE 'CONFORME'
       END AS result
  FROM seaming_controls sc
  LEFT JOIN seaming_measurements m
         ON m.seaming_control_id = sc.id AND m.record_status = 'VALIDE'
 GROUP BY sc.id;

-- Latest CCP decision per sterilization cycle, plus whether any decision on
-- the cycle ever required a hold (RETENU). Sterilization status must never be
-- confused with this: a cycle can be operationally TERMINE while its CCP
-- decision still reads RETENU (section 56).
CREATE VIEW sterilization_cycle_ccp_status AS
SELECT cy.id AS sterilization_cycle_id,
       COUNT(c.id)::integer AS ccp_control_count,
       (SELECT c2.result FROM ccp_controls c2
         WHERE c2.sterilization_cycle_id = cy.id AND c2.record_status = 'VALIDE'
         ORDER BY c2.controlled_at DESC, c2.created_at DESC LIMIT 1) AS latest_result,
       (SELECT c2.decision FROM ccp_controls c2
         WHERE c2.sterilization_cycle_id = cy.id AND c2.record_status = 'VALIDE'
         ORDER BY c2.controlled_at DESC, c2.created_at DESC LIMIT 1) AS latest_decision,
       COUNT(*) FILTER (WHERE c.decision = 'RETENU') > 0 AS has_retained_decision
  FROM sterilization_cycles cy
  LEFT JOIN ccp_controls c ON c.sterilization_cycle_id = cy.id AND c.record_status = 'VALIDE'
 GROUP BY cy.id;

-- Cycle summary: measurement coverage, F0 range actually recorded, active
-- deviations and cooling completion, for the sterilization list and detail
-- screens (sections 50/51). A cycle "à vérifier" per section 39 is one that
-- lacks a program (impossible: NOT NULL FK), lacks any CCP control, or lacks
-- any process measurement.
CREATE VIEW sterilization_cycle_summary AS
SELECT cy.id AS sterilization_cycle_id,
       COUNT(DISTINCT me.id)::integer AS measurement_count,
       MAX(me.f0_value) AS max_f0_value,
       COUNT(DISTINCT dv.id) FILTER (WHERE dv.status NOT IN ('CLOTUREE', 'ANNULEE'))::integer
           AS open_deviation_count,
       COUNT(DISTINCT co.id)::integer AS cooling_event_count,
       COUNT(DISTINCT co.id) FILTER (WHERE co.ended_at IS NOT NULL)::integer
           AS cooling_completed_count,
       (COUNT(DISTINCT me.id) = 0 OR ccp.ccp_control_count = 0) AS missing_critical_data
  FROM sterilization_cycles cy
  LEFT JOIN sterilization_measurements me
         ON me.sterilization_cycle_id = cy.id AND me.record_status = 'VALIDE'
  LEFT JOIN process_deviations dv ON dv.sterilization_cycle_id = cy.id
  LEFT JOIN cooling_events co ON co.sterilization_cycle_id = cy.id
  LEFT JOIN sterilization_cycle_ccp_status ccp ON ccp.sterilization_cycle_id = cy.id
 GROUP BY cy.id, ccp.ccp_control_count;

-- Runs currently held by an unresolved critical process issue (section 41).
-- A future Phase 5 finished-goods lot creation reads this view rather than
-- reimplementing the hold rule.
CREATE VIEW run_hold_status AS
SELECT production_run_id, id AS hold_id, reason, held_at
  FROM production_run_holds
 WHERE status = 'ACTIF';
