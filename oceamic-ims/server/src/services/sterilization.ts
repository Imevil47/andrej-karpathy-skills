import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { sterilizationCycleAcceptsEntries, type SterilizationCycleStatus } from '../domain/types.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';
import { requireRun } from './production.ts';

// Sterilization cycle: the thermal process event (section 27), one of the
// most important Phase 4 entities. A cycle never assumes exactly one Run: the
// relationship always goes through sterilization_cycle_loads (section 29).

export type SterilizationCycle = Readonly<{
  id: string;
  cycleCode: string;
  status: SterilizationCycleStatus;
}>;

async function requireCycle(client: DatabaseClient, id: string): Promise<SterilizationCycle> {
  const result = await client.query<{ id: string; cycle_code: string; status: SterilizationCycleStatus }>(
    'SELECT id, cycle_code, status FROM sterilization_cycles WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('Cycle de stérilisation', id);
  }
  return { id: row.id, cycleCode: row.cycle_code, status: row.status };
}

function assertCycleAcceptsEntries(cycle: SterilizationCycle): void {
  if (!sterilizationCycleAcceptsEntries(cycle.status)) {
    throw conflictError(
      `Le cycle ${cycle.cycleCode} n'accepte plus de saisie (statut : ${cycle.status}).`,
      { sterilizationCycleId: cycle.id, status: cycle.status },
    );
  }
}

export type CycleLoadInput = Readonly<{
  productionRunId: string;
  quantityUnits: number | null;
  basketReference: string | null;
  notes: string | null;
}>;

export type CreateCycleInput = Readonly<{
  autoclaveId: string;
  sterilizationProgramId: string;
  startedAt: Date;
  operatorUserId: string | null;
  notes: string | null;
  loads: readonly CycleLoadInput[];
}>;

async function insertCycleLoad(
  client: DatabaseClient,
  cycleId: string,
  input: CycleLoadInput,
  actorId: string,
): Promise<string> {
  const run = await requireRun(client, input.productionRunId);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO sterilization_cycle_loads (sterilization_cycle_id, production_run_id, quantity_units,
                                            basket_reference, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [cycleId, run.id, input.quantityUnits, input.basketReference, input.notes],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("Le chargement n'a pas pu être enregistré.");
  }
  await recordAudit(client, {
    userId: actorId,
    action: 'STERILIZATION_LOAD_CREATION',
    entityType: 'sterilization_cycle_loads',
    entityId: id,
    oldValues: null,
    newValues: { sterilizationCycleId: cycleId, runCode: run.runCode },
    context: null,
  });
  return id;
}

/** Creates a cycle in the loading phase. Snapshots the program's critical limits (section 54). */
export async function createSterilizationCycle(
  pool: pg.Pool,
  input: CreateCycleInput,
  actorId: string,
): Promise<SterilizationCycle> {
  return withTransaction(pool, async (client) => {
    if (input.loads.length === 0) {
      throw validationError('Un cycle de stérilisation doit charger au moins un Run.', {});
    }
    const program = await client.query<{
      target_f0: string | null;
      minimum_f0: string | null;
      maximum_f0: string | null;
      target_temperature_c: string | null;
      target_pressure_bar: string | null;
      holding_time_seconds: number | null;
    }>(
      `SELECT target_f0::text, minimum_f0::text, maximum_f0::text, target_temperature_c::text,
              target_pressure_bar::text, holding_time_seconds
         FROM sterilization_programs WHERE id = $1 AND is_active = TRUE`,
      [input.sterilizationProgramId],
    );
    const programRow = program.rows[0];
    if (!programRow) {
      throw notFoundError('Programme de stérilisation', input.sterilizationProgramId);
    }

    const cycleCode = await nextOperationalCode(client, 'STE', input.startedAt);
    const inserted = await client.query<{ id: string; status: SterilizationCycleStatus }>(
      `INSERT INTO sterilization_cycles (cycle_code, autoclave_id, started_at, sterilization_program_id,
                                         target_f0_snapshot, minimum_f0_snapshot, maximum_f0_snapshot,
                                         target_temperature_c_snapshot, target_pressure_bar_snapshot,
                                         holding_time_seconds_snapshot, status, operator_user_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'EN_CHARGEMENT', $11, $12)
       RETURNING id, status`,
      [
        cycleCode,
        input.autoclaveId,
        input.startedAt,
        input.sterilizationProgramId,
        programRow.target_f0,
        programRow.minimum_f0,
        programRow.maximum_f0,
        programRow.target_temperature_c,
        programRow.target_pressure_bar,
        programRow.holding_time_seconds,
        input.operatorUserId,
        input.notes,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Le cycle de stérilisation n'a pas pu être créé.");
    }
    for (const load of input.loads) {
      await insertCycleLoad(client, row.id, load, actorId);
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'STERILIZATION_CYCLE_CREATION',
      entityType: 'sterilization_cycles',
      entityId: row.id,
      oldValues: null,
      newValues: { cycleCode, autoclaveId: input.autoclaveId, loadCount: input.loads.length },
      context: null,
    });
    return { id: row.id, cycleCode, status: row.status };
  });
}

export async function addCycleLoad(
  pool: pg.Pool,
  cycleId: string,
  input: CycleLoadInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const cycle = await requireCycle(client, cycleId);
    assertCycleAcceptsEntries(cycle);
    const id = await insertCycleLoad(client, cycle.id, input, actorId);
    return { id };
  });
}

/** Moves a cycle from loading into the running phase. */
export async function beginSterilizationCycle(
  pool: pg.Pool,
  cycleId: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const cycle = await requireCycle(client, cycleId);
    if (cycle.status !== 'PLANIFIE' && cycle.status !== 'EN_CHARGEMENT') {
      throw conflictError(`Le cycle ${cycle.cycleCode} n'est plus en chargement.`, {
        sterilizationCycleId: cycle.id,
        status: cycle.status,
      });
    }
    await client.query("UPDATE sterilization_cycles SET status = 'EN_COURS', updated_at = now() WHERE id = $1", [
      cycle.id,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'STERILIZATION_CYCLE_DEMARRAGE',
      entityType: 'sterilization_cycles',
      entityId: cycle.id,
      oldValues: { status: cycle.status },
      newValues: { status: 'EN_COURS' },
      context: null,
    });
  });
}

export type RecordMeasurementInput = Readonly<{
  measuredAt: Date;
  temperatureC: string | null;
  pressureBar: string | null;
  f0Value: string | null;
  phase: string | null;
  sourceType: string;
}>;

export async function recordSterilizationMeasurement(
  pool: pg.Pool,
  cycleId: string,
  input: RecordMeasurementInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const cycle = await requireCycle(client, cycleId);
    assertCycleAcceptsEntries(cycle);
    if (input.temperatureC === null && input.pressureBar === null && input.f0Value === null) {
      throw validationError('Au moins une valeur mesurée est requise (température, pression ou F0).', {
        sterilizationCycleId: cycleId,
      });
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sterilization_measurements (sterilization_cycle_id, measured_at, temperature_c,
                                                pressure_bar, f0_value, phase, source_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        cycle.id,
        input.measuredAt,
        input.temperatureC,
        input.pressureBar,
        input.f0Value,
        input.phase,
        input.sourceType,
        actorId,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La mesure n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'STERILIZATION_MEASUREMENT_CREATION',
      entityType: 'sterilization_measurements',
      entityId: id,
      oldValues: null,
      newValues: { sterilizationCycleId: cycleId, ...input },
      context: null,
    });
    return { id };
  });
}

/** Corrects a validated measurement: reversal-and-replace (section 58). */
export async function correctSterilizationMeasurement(
  pool: pg.Pool,
  measurementId: string,
  corrected: RecordMeasurementInput | null,
  reason: string,
  actorId: string,
): Promise<Readonly<{ cancelledId: string; replacementId: string | null }>> {
  return withTransaction(pool, async (client) => {
    const original = await client.query<{
      id: string;
      sterilization_cycle_id: string;
      record_status: string;
    }>(
      'SELECT id, sterilization_cycle_id, record_status FROM sterilization_measurements WHERE id = $1',
      [measurementId],
    );
    const row = original.rows[0];
    if (!row) {
      throw notFoundError('Mesure', measurementId);
    }
    if (row.record_status !== 'VALIDE') {
      throw conflictError('Cette mesure a déjà été annulée.', { measurementId });
    }
    await client.query(
      `UPDATE sterilization_measurements
          SET record_status = 'ANNULE', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3
        WHERE id = $1`,
      [row.id, actorId, reason],
    );

    let replacementId: string | null = null;
    if (corrected !== null) {
      const replacement = await client.query<{ id: string }>(
        `INSERT INTO sterilization_measurements (sterilization_cycle_id, measured_at, temperature_c,
                                                  pressure_bar, f0_value, phase, source_type, replaces_id,
                                                  created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          row.sterilization_cycle_id,
          corrected.measuredAt,
          corrected.temperatureC,
          corrected.pressureBar,
          corrected.f0Value,
          corrected.phase,
          corrected.sourceType,
          row.id,
          actorId,
        ],
      );
      replacementId = replacement.rows[0]?.id ?? null;
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'STERILIZATION_MEASUREMENT_CORRECTION',
      entityType: 'sterilization_measurements',
      entityId: row.id,
      oldValues: { recordStatus: 'VALIDE' },
      newValues: { recordStatus: 'ANNULE', reason },
      context: { replacementId },
    });
    return { cancelledId: row.id, replacementId };
  });
}

export type RecordCcpInput = Readonly<{
  controlledAt: Date;
  ccpType: string;
  result: string;
  decision: string;
  notes: string | null;
}>;

/**
 * Records a CCP decision (section 32). Route-level permission (`ccp:validate`,
 * Quality/Admin only) is what keeps an ordinary Production user from ever
 * calling this on their own (section 36) - there is no secondary in-band
 * check here, exactly like quality:release gates lot release in Phase 1.
 *
 * A RETENU decision opens a hold on every Run loaded in this cycle
 * (section 41); a LIBERE decision never auto-releases an existing hold -
 * releasing one is always a deliberate, separately-audited action
 * (releaseRunHold), matching the block/release symmetry already used for lot
 * blocking.
 */
export async function recordCcpControl(
  pool: pg.Pool,
  cycleId: string,
  input: RecordCcpInput,
  actorId: string,
): Promise<Readonly<{ id: string; heldRunIds: readonly string[] }>> {
  return withTransaction(pool, async (client) => {
    const cycle = await requireCycle(client, cycleId);
    assertCycleAcceptsEntries(cycle);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ccp_controls (sterilization_cycle_id, controlled_at, ccp_type, result, decision,
                                 controller_user_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [cycle.id, input.controlledAt, input.ccpType, input.result, input.decision, actorId, input.notes],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le contrôle CCP n'a pas pu être enregistré.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'CCP_CONTROL_CREATION',
      entityType: 'ccp_controls',
      entityId: id,
      oldValues: null,
      newValues: { sterilizationCycleId: cycleId, ccpType: input.ccpType, result: input.result, decision: input.decision },
      context: null,
    });

    const heldRunIds: string[] = [];
    if (input.decision === 'RETENU') {
      const loads = await client.query<{ production_run_id: string }>(
        'SELECT production_run_id FROM sterilization_cycle_loads WHERE sterilization_cycle_id = $1',
        [cycle.id],
      );
      for (const load of loads.rows) {
        const held = await openRunHold(
          client,
          load.production_run_id,
          cycle.id,
          `Décision CCP retenue sur le cycle ${cycle.cycleCode} (${input.ccpType}).`,
          actorId,
        );
        if (held) {
          heldRunIds.push(load.production_run_id);
        }
      }
    }

    return { id, heldRunIds };
  });
}

/** Corrects a validated CCP decision: reversal-and-replace (section 58). */
export async function correctCcpControl(
  pool: pg.Pool,
  ccpControlId: string,
  corrected: RecordCcpInput | null,
  reason: string,
  actorId: string,
): Promise<Readonly<{ cancelledId: string; replacementId: string | null }>> {
  return withTransaction(pool, async (client) => {
    const original = await client.query<{
      id: string;
      sterilization_cycle_id: string;
      record_status: string;
    }>('SELECT id, sterilization_cycle_id, record_status FROM ccp_controls WHERE id = $1', [
      ccpControlId,
    ]);
    const row = original.rows[0];
    if (!row) {
      throw notFoundError('Contrôle CCP', ccpControlId);
    }
    if (row.record_status !== 'VALIDE') {
      throw conflictError('Ce contrôle CCP a déjà été annulé.', { ccpControlId });
    }
    await client.query(
      `UPDATE ccp_controls
          SET record_status = 'ANNULE', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3
        WHERE id = $1`,
      [row.id, actorId, reason],
    );

    let replacementId: string | null = null;
    if (corrected !== null) {
      const replacement = await client.query<{ id: string }>(
        `INSERT INTO ccp_controls (sterilization_cycle_id, controlled_at, ccp_type, result, decision,
                                   controller_user_id, notes, replaces_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          row.sterilization_cycle_id,
          corrected.controlledAt,
          corrected.ccpType,
          corrected.result,
          corrected.decision,
          actorId,
          corrected.notes,
          row.id,
        ],
      );
      replacementId = replacement.rows[0]?.id ?? null;
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'CCP_CONTROL_CORRECTION',
      entityType: 'ccp_controls',
      entityId: row.id,
      oldValues: { recordStatus: 'VALIDE' },
      newValues: { recordStatus: 'ANNULE', reason },
      context: { replacementId },
    });
    return { cancelledId: row.id, replacementId };
  });
}

/**
 * Closes a cycle (section 39/56). Never a blind TERMINE:
 *  - missing CCP data or missing process measurements -> A_VERIFIER, with the
 *    exact message the spec requires;
 *  - the latest CCP decision is RETENU -> BLOQUE: the process physically
 *    finished (ended_at is set) but the material stays held, because process
 *    completion and quality disposition are never the same thing
 *    (section 56);
 *  - otherwise -> TERMINE.
 */
export async function closeSterilizationCycle(
  pool: pg.Pool,
  cycleId: string,
  actorId: string,
): Promise<Readonly<{ status: SterilizationCycleStatus; message: string | null }>> {
  return withTransaction(pool, async (client) => {
    const cycle = await requireCycle(client, cycleId);
    assertCycleAcceptsEntries(cycle);

    const summary = await client.query<{
      measurement_count: number;
      missing_critical_data: boolean;
    }>(
      'SELECT measurement_count, missing_critical_data FROM sterilization_cycle_summary WHERE sterilization_cycle_id = $1',
      [cycle.id],
    );
    const summaryRow = summary.rows[0];

    if (!summaryRow || summaryRow.missing_critical_data) {
      await client.query(
        "UPDATE sterilization_cycles SET status = 'A_VERIFIER', ended_at = now(), updated_at = now() WHERE id = $1",
        [cycle.id],
      );
      const message = 'Cycle incomplet.\nDes données CCP obligatoires sont manquantes.';
      await recordAudit(client, {
        userId: actorId,
        action: 'STERILIZATION_CYCLE_CLOTURE',
        entityType: 'sterilization_cycles',
        entityId: cycle.id,
        oldValues: { status: cycle.status },
        newValues: { status: 'A_VERIFIER' },
        context: { reason: 'donnees_ccp_manquantes' },
      });
      return { status: 'A_VERIFIER', message };
    }

    const ccpStatus = await client.query<{ latest_decision: string | null }>(
      'SELECT latest_decision FROM sterilization_cycle_ccp_status WHERE sterilization_cycle_id = $1',
      [cycle.id],
    );
    const finalStatus: SterilizationCycleStatus =
      ccpStatus.rows[0]?.latest_decision === 'RETENU' ? 'BLOQUE' : 'TERMINE';

    await client.query(
      'UPDATE sterilization_cycles SET status = $2, ended_at = now(), updated_at = now() WHERE id = $1',
      [cycle.id, finalStatus],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'STERILIZATION_CYCLE_CLOTURE',
      entityType: 'sterilization_cycles',
      entityId: cycle.id,
      oldValues: { status: cycle.status },
      newValues: { status: finalStatus },
      context: null,
    });
    return { status: finalStatus, message: null };
  });
}

export async function cancelSterilizationCycle(
  pool: pg.Pool,
  cycleId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const cycle = await requireCycle(client, cycleId);
    assertCycleAcceptsEntries(cycle);
    await client.query(
      "UPDATE sterilization_cycles SET status = 'ANNULE', ended_at = now(), notes = COALESCE(notes || ' — ', '') || $2, updated_at = now() WHERE id = $1",
      [cycle.id, `Annulé : ${reason}`],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'STERILIZATION_CYCLE_ANNULATION',
      entityType: 'sterilization_cycles',
      entityId: cycle.id,
      oldValues: { status: cycle.status },
      newValues: { status: 'ANNULE', reason },
      context: null,
    });
  });
}

// --- Cooling (section 42/43) ------------------------------------------------

export type StartCoolingInput = Readonly<{
  startedAt: Date;
  coolingMethod: string | null;
  waterTemperatureC: string | null;
}>;

export async function startCoolingEvent(
  pool: pg.Pool,
  cycleId: string,
  input: StartCoolingInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    await requireCycle(client, cycleId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO cooling_events (sterilization_cycle_id, started_at, cooling_method,
                                   water_temperature_c, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [cycleId, input.startedAt, input.coolingMethod, input.waterTemperatureC, actorId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le refroidissement n'a pas pu être enregistré.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'COOLING_EVENT_CREATION',
      entityType: 'cooling_events',
      entityId: id,
      oldValues: null,
      newValues: { sterilizationCycleId: cycleId },
      context: null,
    });
    return { id };
  });
}

export type EndCoolingInput = Readonly<{
  endedAt: Date;
  finalProductTemperatureC: string | null;
  result: string | null;
}>;

export async function endCoolingEvent(
  pool: pg.Pool,
  coolingEventId: string,
  input: EndCoolingInput,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const existing = await client.query<{ started_at: Date; ended_at: Date | null }>(
      'SELECT started_at, ended_at FROM cooling_events WHERE id = $1',
      [coolingEventId],
    );
    const row = existing.rows[0];
    if (!row) {
      throw notFoundError('Refroidissement', coolingEventId);
    }
    if (row.ended_at !== null) {
      throw conflictError('Ce refroidissement est déjà terminé.', { coolingEventId });
    }
    if (input.endedAt < row.started_at) {
      throw validationError("L'heure de fin ne peut pas précéder l'heure de début.", { coolingEventId });
    }
    await client.query(
      `UPDATE cooling_events
          SET ended_at = $2, final_product_temperature_c = $3, result = $4
        WHERE id = $1`,
      [coolingEventId, input.endedAt, input.finalProductTemperatureC, input.result],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'COOLING_EVENT_CLOTURE',
      entityType: 'cooling_events',
      entityId: coolingEventId,
      oldValues: { endedAt: null },
      newValues: { endedAt: input.endedAt, result: input.result },
      context: null,
    });
  });
}

export type RecordCoolingMeasurementInput = Readonly<{
  measuredAt: Date;
  parameter: string;
  value: string;
  unit: string;
  status: string | null;
}>;

export async function recordCoolingMeasurement(
  pool: pg.Pool,
  coolingEventId: string,
  input: RecordCoolingMeasurementInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query('SELECT id FROM cooling_events WHERE id = $1', [
      coolingEventId,
    ]);
    if (existing.rows.length === 0) {
      throw notFoundError('Refroidissement', coolingEventId);
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO cooling_measurements (cooling_event_id, measured_at, parameter, value, unit, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [coolingEventId, input.measuredAt, input.parameter, input.value, input.unit, input.status],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("La mesure de refroidissement n'a pas pu être enregistrée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'COOLING_MEASUREMENT_CREATION',
      entityType: 'cooling_measurements',
      entityId: id,
      oldValues: null,
      newValues: { coolingEventId, ...input },
      context: null,
    });
    return { id };
  });
}

// --- Production Run hold (section 41) ---------------------------------------

/** Opens a hold on a Run if it doesn't already carry an active one. Returns false when one already exists. */
async function openRunHold(
  client: DatabaseClient,
  runId: string,
  sterilizationCycleId: string | null,
  reason: string,
  actorId: string,
): Promise<boolean> {
  const existing = await client.query(
    "SELECT id FROM production_run_holds WHERE production_run_id = $1 AND status = 'ACTIF'",
    [runId],
  );
  if (existing.rows.length > 0) {
    return false;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO production_run_holds (production_run_id, sterilization_cycle_id, held_by, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [runId, sterilizationCycleId, actorId, reason],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error("La retenue n'a pas pu être enregistrée.");
  }
  await recordAudit(client, {
    userId: actorId,
    action: 'RUN_HOLD_OUVERTURE',
    entityType: 'production_run_holds',
    entityId: id,
    oldValues: null,
    newValues: { productionRunId: runId, reason },
    context: null,
  });
  return true;
}

/** Releases an active hold. Mirrors closeActiveBlock in quality.ts (`quality:release`-gated). */
export async function releaseRunHold(
  pool: pg.Pool,
  holdId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const updated = await client.query<{ id: string; production_run_id: string }>(
      `UPDATE production_run_holds
          SET status = 'LEVE', released_at = now(), released_by = $2, release_reason = $3, updated_at = now()
        WHERE id = $1 AND status = 'ACTIF'
        RETURNING id, production_run_id`,
      [holdId, actorId, reason],
    );
    const row = updated.rows[0];
    if (!row) {
      throw notFoundError('Retenue', holdId);
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'RUN_HOLD_LEVEE',
      entityType: 'production_run_holds',
      entityId: row.id,
      oldValues: { status: 'ACTIF' },
      newValues: { status: 'LEVE', releaseReason: reason },
      context: { productionRunId: row.production_run_id },
    });
  });
}
