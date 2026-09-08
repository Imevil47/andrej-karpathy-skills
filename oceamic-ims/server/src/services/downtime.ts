import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import { conflictError, notFoundError, validationError } from '../errors.ts';
import { runAcceptsEntries } from '../domain/types.ts';
import { recordAudit } from './audit.ts';
import { requireRun } from './production.ts';
import { requireRunLine } from './workforce.ts';

// Downtime is a production interruption event, kept entirely separate from
// cadence controls (section 40): no employee's measured quantity is ever
// adjusted because a stop occurred. An open event has ended_at = NULL, the
// only source of truth for "active" — there is no separate status column
// that could disagree with it.

export type DowntimeEvent = Readonly<{
  id: string;
  productionRunId: string;
  productionRunLineId: string | null;
  startedAt: Date;
  endedAt: Date | null;
}>;

export type StartDowntimeInput = Readonly<{
  productionRunLineId: string | null;
  downtimeCategoryId: string;
  reasonText: string | null;
  planned: boolean;
  startedAt: Date;
}>;

export async function startDowntime(
  pool: pg.Pool,
  runId: string,
  input: StartDowntimeInput,
  actorId: string,
): Promise<DowntimeEvent> {
  return withTransaction(pool, async (client) => {
    const run = await requireRun(client, runId);
    if (!runAcceptsEntries(run.status)) {
      throw conflictError(
        `L'ordre de production ${run.runCode} n'est pas actif : aucun arrêt ne peut y être déclaré.`,
        { runId },
      );
    }
    if (input.productionRunLineId !== null) {
      await requireRunLine(client, run.id, input.productionRunLineId);
    }

    const inserted = await client.query<{ id: string; started_at: Date; ended_at: Date | null }>(
      `INSERT INTO downtime_events (production_run_id, production_run_line_id, started_at,
                                    downtime_category_id, reason_text, planned, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, started_at, ended_at`,
      [
        run.id,
        input.productionRunLineId,
        input.startedAt,
        input.downtimeCategoryId,
        input.reasonText,
        input.planned,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("L'arrêt n'a pas pu être enregistré.");
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'DOWNTIME_DEMARRAGE',
      entityType: 'downtime_events',
      entityId: row.id,
      oldValues: null,
      newValues: {
        runCode: run.runCode,
        productionRunLineId: input.productionRunLineId,
        downtimeCategoryId: input.downtimeCategoryId,
        planned: input.planned,
      },
      context: null,
    });

    return {
      id: row.id,
      productionRunId: run.id,
      productionRunLineId: input.productionRunLineId,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    };
  });
}

/**
 * Ends an active downtime. duration_seconds is a generated column: the
 * moment ended_at is written, the duration is derived automatically and can
 * never be typed inconsistently with the timestamps (section 39).
 */
export async function endDowntime(
  pool: pg.Pool,
  downtimeId: string,
  endedAt: Date,
  actorId: string,
): Promise<{ durationSeconds: number }> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{
      started_at: Date;
      ended_at: Date | null;
      production_run_id: string;
    }>('SELECT started_at, ended_at, production_run_id FROM downtime_events WHERE id = $1', [
      downtimeId,
    ]);
    const row = existing.rows[0];
    if (!row) {
      throw notFoundError('Arrêt', downtimeId);
    }
    if (row.ended_at !== null) {
      throw conflictError('Cet arrêt est déjà terminé.', { downtimeId });
    }
    if (endedAt < row.started_at) {
      throw validationError("L'heure de fin ne peut pas précéder l'heure de début.", {
        downtimeId,
        startedAt: row.started_at,
        endedAt,
      });
    }

    const updated = await client.query<{ duration_seconds: number }>(
      'UPDATE downtime_events SET ended_at = $2, updated_at = now() WHERE id = $1 RETURNING duration_seconds',
      [downtimeId, endedAt],
    );
    const durationSeconds = updated.rows[0]?.duration_seconds ?? 0;

    await recordAudit(client, {
      userId: actorId,
      action: 'DOWNTIME_CLOTURE',
      entityType: 'downtime_events',
      entityId: downtimeId,
      oldValues: { endedAt: null },
      newValues: { endedAt, durationSeconds },
      context: { runId: row.production_run_id },
    });

    return { durationSeconds };
  });
}

export type DowntimeEventRow = Readonly<{
  id: string;
  productionRunId: string;
  runCode: string;
  productionRunLineId: string | null;
  lineCode: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  categoryCode: string;
  categoryName: string;
  reasonText: string | null;
  planned: boolean;
  createdByName: string;
}>;

export type DowntimeListFilters = Readonly<{
  runId: string | null;
  runLineId: string | null;
  categoryId: string | null;
  activeOnly: boolean;
  limit: number;
}>;

export async function listDowntimeEvents(
  pool: pg.Pool,
  filters: DowntimeListFilters,
): Promise<readonly DowntimeEventRow[]> {
  const result = await pool.query<DowntimeEventRow>(
    `SELECT d.id                     AS "id",
            d.production_run_id      AS "productionRunId",
            r.run_code                AS "runCode",
            d.production_run_line_id AS "productionRunLineId",
            l.code                    AS "lineCode",
            d.started_at              AS "startedAt",
            d.ended_at                AS "endedAt",
            d.duration_seconds        AS "durationSeconds",
            c.code                    AS "categoryCode",
            c.name                    AS "categoryName",
            d.reason_text             AS "reasonText",
            d.planned                 AS "planned",
            u.full_name               AS "createdByName"
       FROM downtime_events d
       JOIN production_runs r ON r.id = d.production_run_id
       JOIN downtime_categories c ON c.id = d.downtime_category_id
       JOIN users u ON u.id = d.created_by
       LEFT JOIN production_run_lines rl ON rl.id = d.production_run_line_id
       LEFT JOIN production_lines l ON l.id = rl.production_line_id
      WHERE ($1::uuid IS NULL OR d.production_run_id = $1)
        AND ($2::uuid IS NULL OR d.production_run_line_id = $2)
        AND ($3::uuid IS NULL OR d.downtime_category_id = $3)
        AND ($4::boolean IS FALSE OR d.ended_at IS NULL)
      ORDER BY d.started_at DESC
      LIMIT $5`,
    [filters.runId, filters.runLineId, filters.categoryId, filters.activeOnly, filters.limit],
  );
  return result.rows;
}

export type RunDowntimeSummary = Readonly<{
  totalDowntimeSeconds: number;
  closedDowntimeCount: number;
  activeDowntimeCount: number;
}>;

export async function runDowntimeSummary(
  client: DatabaseClient | pg.Pool,
  runId: string,
): Promise<RunDowntimeSummary> {
  const result = await client.query<{
    total_downtime_seconds: string;
    closed_downtime_count: string;
    active_downtime_count: string;
  }>(
    `SELECT total_downtime_seconds::text, closed_downtime_count::text, active_downtime_count::text
       FROM run_downtime_summary WHERE production_run_id = $1`,
    [runId],
  );
  const row = result.rows[0];
  return {
    totalDowntimeSeconds: Number(row?.total_downtime_seconds ?? '0'),
    closedDowntimeCount: Number(row?.closed_downtime_count ?? '0'),
    activeDowntimeCount: Number(row?.active_downtime_count ?? '0'),
  };
}
