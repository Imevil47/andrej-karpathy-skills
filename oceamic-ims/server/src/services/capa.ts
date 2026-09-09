import type pg from 'pg';
import { withTransaction, type DatabaseClient } from '../db/pool.ts';
import type { CapaActionType, CapaStatus, CapaType, QmsPriority } from '../domain/types.ts';
import { conflictError, notFoundError } from '../errors.ts';
import { recordAudit } from './audit.ts';
import { nextOperationalCode } from './codes.ts';

// CAPA: systematic actions addressing a root cause or a risk (section 70),
// never the same concept as the immediate correction already captured on
// nonconformity_investigations (section 49).

export type Capa = Readonly<{ id: string; capaCode: string; status: CapaStatus }>;

export async function requireCapa(client: DatabaseClient, id: string): Promise<Capa> {
  const result = await client.query<{ id: string; capa_code: string; status: CapaStatus }>(
    'SELECT id, capa_code, status FROM capa_records WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFoundError('CAPA', id);
  }
  return { id: row.id, capaCode: row.capa_code, status: row.status };
}

function assertOpen(capa: Capa): void {
  if (capa.status === 'CLOTUREE' || capa.status === 'ANNULEE') {
    throw conflictError(
      `Le CAPA ${capa.capaCode} est déjà ${capa.status === 'CLOTUREE' ? 'clôturé' : 'annulé'}.`,
      { capaId: capa.id, status: capa.status },
    );
  }
}

/**
 * Recomputes the cached CAPA status from its actions and effectiveness
 * checks (never hand-typed, the same discipline as everywhere else in
 * OCEAMIC IMS): OUVERTE with no action yet, EN_COURS while actions remain
 * open, EN_VERIFICATION once every action is done but closure is not yet
 * granted, CLOTUREE/ANNULEE only through their own explicit, gated
 * operations below.
 */
async function refreshCapaStatus(client: DatabaseClient, capaId: string): Promise<void> {
  const summary = await client.query<{ status: CapaStatus; open_actions: number; total_actions: number }>(
    `SELECT c.status, s.open_actions, s.total_actions
       FROM capa_records c
       JOIN capa_summary s ON s.capa_id = c.id
      WHERE c.id = $1`,
    [capaId],
  );
  const row = summary.rows[0];
  if (!row || row.status === 'CLOTUREE' || row.status === 'ANNULEE') {
    return;
  }
  const next: CapaStatus =
    row.total_actions === 0 ? 'OUVERTE' : row.open_actions > 0 ? 'EN_COURS' : 'EN_VERIFICATION';
  if (next !== row.status) {
    await client.query('UPDATE capa_records SET status = $2, updated_at = now() WHERE id = $1', [
      capaId,
      next,
    ]);
  }
}

export type CreateCapaInput = Readonly<{
  sourceNonconformityId: string | null;
  title: string;
  description: string;
  capaType: CapaType;
  priority: QmsPriority;
  ownerUserId: string;
  openedAt: Date;
  dueAt: Date | null;
  effectivenessRequired: boolean;
}>;

/**
 * Creates a CAPA (section 12). `sourceNonconformityId` is nullable
 * (section 50): a preventive action may originate from an audit
 * observation, a trend or a management decision with no existing NCR.
 */
export async function createCapa(pool: pg.Pool, input: CreateCapaInput, actorId: string): Promise<Capa> {
  return withTransaction(pool, async (client) => {
    if (input.sourceNonconformityId !== null) {
      const ncr = await client.query('SELECT id FROM nonconformities WHERE id = $1', [
        input.sourceNonconformityId,
      ]);
      if (ncr.rows.length === 0) {
        throw notFoundError('Non-conformité', input.sourceNonconformityId);
      }
    }

    const code = await nextOperationalCode(client, 'CAPA', input.openedAt);
    const inserted = await client.query<{ id: string; status: CapaStatus }>(
      `INSERT INTO capa_records (capa_code, source_nonconformity_id, title, description, capa_type,
                                 priority, owner_user_id, opened_at, due_at, effectiveness_required,
                                 created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, status`,
      [
        code,
        input.sourceNonconformityId,
        input.title,
        input.description,
        input.capaType,
        input.priority,
        input.ownerUserId,
        input.openedAt,
        input.dueAt,
        input.effectivenessRequired,
        actorId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error("Le CAPA n'a pas pu être créé.");
    }

    await recordAudit(client, {
      userId: actorId,
      action: 'CAPA_CREATION',
      entityType: 'capa_records',
      entityId: row.id,
      oldValues: null,
      newValues: { capaCode: code, capaType: input.capaType, sourceNonconformityId: input.sourceNonconformityId },
      context: null,
    });

    return { id: row.id, capaCode: code, status: row.status };
  });
}

export type CapaActionInput = Readonly<{
  actionType: CapaActionType;
  description: string;
  responsibleUserId: string;
  plannedDate: string | null;
  dueDate: string | null;
}>;

export async function addCapaAction(
  pool: pg.Pool,
  capaId: string,
  input: CapaActionInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const capa = await requireCapa(client, capaId);
    assertOpen(capa);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO capa_actions (capa_id, action_type, description, responsible_user_id, planned_date, due_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [capa.id, input.actionType, input.description, input.responsibleUserId, input.plannedDate, input.dueDate],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("L'action CAPA n'a pas pu être créée.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'CAPA_ACTION_CREATION',
      entityType: 'capa_actions',
      entityId: id,
      oldValues: null,
      newValues: { capaId: capa.id, actionType: input.actionType },
      context: null,
    });
    await refreshCapaStatus(client, capa.id);
    return { id };
  });
}

/**
 * Completes a CAPA action (section 13). Open to `action:complete` as well as
 * `capa:manage` (section 53): the user assigned to an action must be able to
 * mark it done without holding full CAPA authority.
 */
export async function completeCapaAction(
  pool: pg.Pool,
  actionId: string,
  evidence: string | null,
  actorId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const action = await client.query<{ id: string; capa_id: string; status: string }>(
      'SELECT id, capa_id, status FROM capa_actions WHERE id = $1',
      [actionId],
    );
    const row = action.rows[0];
    if (!row) {
      throw notFoundError('Action CAPA', actionId);
    }
    if (row.status === 'TERMINEE' || row.status === 'ANNULEE') {
      throw conflictError('Cette action CAPA est déjà close.', { actionId, status: row.status });
    }
    await client.query(
      `UPDATE capa_actions
          SET status = 'TERMINEE', completed_at = now(), completion_evidence = $2, updated_at = now()
        WHERE id = $1`,
      [actionId, evidence],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'CAPA_ACTION_COMPLETION',
      entityType: 'capa_actions',
      entityId: actionId,
      oldValues: { status: row.status },
      newValues: { status: 'TERMINEE' },
      context: { capaId: row.capa_id },
    });
    await refreshCapaStatus(client, row.capa_id);
  });
}

export async function cancelCapaAction(pool: pg.Pool, actionId: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const action = await client.query<{ id: string; capa_id: string; status: string }>(
      'SELECT id, capa_id, status FROM capa_actions WHERE id = $1',
      [actionId],
    );
    const row = action.rows[0];
    if (!row) {
      throw notFoundError('Action CAPA', actionId);
    }
    if (row.status === 'TERMINEE' || row.status === 'ANNULEE') {
      throw conflictError('Cette action CAPA est déjà close.', { actionId, status: row.status });
    }
    await client.query("UPDATE capa_actions SET status = 'ANNULEE', updated_at = now() WHERE id = $1", [
      actionId,
    ]);
    await recordAudit(client, {
      userId: actorId,
      action: 'CAPA_ACTION_ANNULATION',
      entityType: 'capa_actions',
      entityId: actionId,
      oldValues: { status: row.status },
      newValues: { status: 'ANNULEE' },
      context: { capaId: row.capa_id },
    });
    await refreshCapaStatus(client, row.capa_id);
  });
}

export type EffectivenessCheckInput = Readonly<{
  checkedAt: Date;
  method: string;
  result: string;
  effective: boolean;
  notes: string | null;
}>;

/**
 * Records effectiveness evidence (section 14): a CAPA is never considered
 * effective just because its actions are TERMINEE.
 */
export async function recordEffectivenessCheck(
  pool: pg.Pool,
  capaId: string,
  input: EffectivenessCheckInput,
  actorId: string,
): Promise<Readonly<{ id: string }>> {
  return withTransaction(pool, async (client) => {
    const capa = await requireCapa(client, capaId);
    assertOpen(capa);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO capa_effectiveness_checks (capa_id, checked_at, checked_by, method, result, effective, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [capa.id, input.checkedAt, actorId, input.method, input.result, input.effective, input.notes],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Le contrôle d'efficacité n'a pas pu être enregistré.");
    }
    await recordAudit(client, {
      userId: actorId,
      action: 'CAPA_EFFICACITE_CONTROLE',
      entityType: 'capa_effectiveness_checks',
      entityId: id,
      oldValues: null,
      newValues: { capaId: capa.id, effective: input.effective },
      context: null,
    });
    await refreshCapaStatus(client, capa.id);
    return { id };
  });
}

/**
 * Closes a CAPA (section 15/53): `capa:approve`, reserved to
 * RESPONSABLE_QUALITE. Validates every required action is complete and, when
 * required, that the latest effectiveness check found the CAPA effective -
 * `capa_summary.can_close` is the single source of truth for this gate, read
 * by both this hard check and the CAPA screens' explanation of what remains.
 */
export async function closeCapa(pool: pg.Pool, capaId: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const capa = await requireCapa(client, capaId);
    assertOpen(capa);
    const summary = await client.query<{ can_close: boolean; open_actions: number; latest_effective: boolean | null }>(
      'SELECT can_close, open_actions, latest_effective FROM capa_summary WHERE capa_id = $1',
      [capa.id],
    );
    const row = summary.rows[0];
    if (!row || !row.can_close) {
      throw conflictError('Clôture impossible.\nDes actions obligatoires restent ouvertes.', {
        capaId: capa.id,
        openActions: row?.open_actions ?? 0,
        latestEffective: row?.latest_effective ?? null,
      });
    }
    await client.query(
      "UPDATE capa_records SET status = 'CLOTUREE', closed_at = now(), updated_at = now() WHERE id = $1",
      [capa.id],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'CAPA_CLOTURE',
      entityType: 'capa_records',
      entityId: capa.id,
      oldValues: { status: capa.status },
      newValues: { status: 'CLOTUREE' },
      context: null,
    });
  });
}

export async function cancelCapa(pool: pg.Pool, capaId: string, reason: string, actorId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const capa = await requireCapa(client, capaId);
    assertOpen(capa);
    await client.query(
      "UPDATE capa_records SET status = 'ANNULEE', closed_at = now(), updated_at = now() WHERE id = $1",
      [capa.id],
    );
    await recordAudit(client, {
      userId: actorId,
      action: 'CAPA_ANNULATION',
      entityType: 'capa_records',
      entityId: capa.id,
      oldValues: { status: capa.status },
      newValues: { status: 'ANNULEE', reason },
      context: null,
    });
  });
}
