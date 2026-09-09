import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestContext, type TestContext } from './support/context.ts';

// Phase 7 — Maintenance / CMMS: failure→downtime integration (section 20),
// work order status transitions and closure gate (sections 21/45, the
// workorder:approve split for HAUTE/CRITIQUE equipment), intervention
// duration (section 39), spare part stock (section 40/55), preventive
// overdue detection (section 56) and repeated-failure analysis (section 44).
// Played through the HTTP API, mirroring the phase6.test.ts pattern.

let context: TestContext;
let maintenanceCookie: string;
let rmCookie: string;
let productionCookie: string;
let adminCookie: string;

async function newActiveRun(): Promise<{ runId: string; runLineL2Id: string }> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/production/runs',
    headers: { cookie: productionCookie },
    payload: {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: context.fixtures.productSardineId,
      format: 'CLUB',
      piecesPerCan: null,
      responsibleUserId: null,
      lines: [
        { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
        { productionLineId: context.fixtures.lineL2Id, activityType: 'GRATTAGE_REMPLISSAGE' },
      ],
      notes: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const runId = (response.json() as { id: string }).id;
  await context.app.inject({
    method: 'POST',
    url: `/api/production/runs/${runId}/demarrage`,
    headers: { cookie: productionCookie },
  });
  const runLineResult = await context.pool.query<{ id: string }>(
    'SELECT id FROM production_run_lines WHERE production_run_id = $1 AND production_line_id = $2',
    [runId, context.fixtures.lineL2Id],
  );
  const runLineL2Id = runLineResult.rows[0]?.id;
  if (!runLineL2Id) {
    throw new Error('Ligne de Run introuvable.');
  }
  return { runId, runLineL2Id };
}

async function reportFailure(
  equipmentId: string,
  overrides: Partial<{ severity: string; stopsProduction: boolean; productionRunId: string | null; productionRunLineId: string | null }> = {},
): Promise<{ id: string; status: string }> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/failures',
    headers: { cookie: productionCookie },
    payload: {
      equipmentId,
      severity: overrides.severity ?? 'HAUTE',
      description: 'Panne de démonstration (test).',
      productionRunId: overrides.productionRunId ?? null,
      productionRunLineId: overrides.productionRunLineId ?? null,
      stopsProduction: overrides.stopsProduction ?? false,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string; status: string };
}

async function newWorkOrder(equipmentId: string, failureReportId: string | null): Promise<{ id: string }> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/work-orders',
    headers: { cookie: maintenanceCookie },
    payload: {
      equipmentId,
      failureReportId,
      workOrderType: 'CORRECTIVE',
      priority: 'HAUTE',
      title: 'Réparation (test)',
      description: null,
      assignedTo: null,
      dueAt: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string };
}

describe('Phase 7 — Maintenance : pannes, ordres de travail, interventions, préventif, pièces', () => {
  before(async () => {
    context = await createTestContext();
    maintenanceCookie = await context.login('maintenance');
    rmCookie = await context.login('responsable_maintenance');
    productionCookie = await context.login('production');
    adminCookie = await context.login('admin');
  });
  after(async () => {
    await context.close();
  });

  it("une panne qui arrête la production ouvre un vrai arrêt (downtime), lié à l'équipement, la ligne et le Run (section 20)", async () => {
    const { runId, runLineL2Id } = await newActiveRun();
    const failure = await reportFailure(context.fixtures.sertisseuse2Id, {
      stopsProduction: true,
      productionRunId: runId,
      productionRunLineId: runLineL2Id,
    });
    assert.equal(failure.status, 'DECLAREE');

    const downtimeRow = await context.pool.query<{ id: string; ended_at: Date | null }>(
      'SELECT id, ended_at FROM downtime_events WHERE production_run_line_id = $1',
      [runLineL2Id],
    );
    assert.equal(downtimeRow.rows.length, 1);
    assert.equal(downtimeRow.rows[0]?.ended_at, null);

    const equipmentRow = await context.pool.query<{ status: string }>(
      'SELECT status FROM equipment WHERE id = $1',
      [context.fixtures.sertisseuse2Id],
    );
    assert.equal(equipmentRow.rows[0]?.status, 'EN_PANNE');

    // Same downtime is visible from the Run's own downtime listing - never
    // a second, duplicated record.
    const runDowntime = await context.app.inject({
      method: 'GET',
      url: `/api/downtime?run=${runId}`,
      headers: { cookie: productionCookie },
    });
    assert.equal(runDowntime.statusCode, 200);
    const rows = runDowntime.json() as readonly { id: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, downtimeRow.rows[0]?.id);
  });

  it("une panne sans arrêt de production n'exige pas d'ordre de production", async () => {
    const failure = await reportFailure(context.fixtures.sertisseuse1Id, { stopsProduction: false });
    assert.equal(failure.status, 'DECLAREE');
  });

  it("une transition de statut d'ordre de travail invalide est refusée (section 21)", async () => {
    const failure = await reportFailure(context.fixtures.sertisseuse1Id);
    const workOrder = await newWorkOrder(context.fixtures.sertisseuse1Id, failure.id);

    // OUVERT cannot jump directly to EN_ATTENTE_PIECE.
    const invalid = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/statut`,
      headers: { cookie: maintenanceCookie },
      payload: { statut: 'EN_ATTENTE_PIECE' },
    });
    assert.equal(invalid.statusCode, 409, invalid.body);

    const valid = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/statut`,
      headers: { cookie: maintenanceCookie },
      payload: { statut: 'EN_COURS' },
    });
    assert.equal(valid.statusCode, 200, valid.body);
  });

  it("créer un ordre de travail à partir d'une panne la fait passer à PRISE_EN_CHARGE (section 66)", async () => {
    const failure = await reportFailure(context.fixtures.sertisseuse1Id);
    await newWorkOrder(context.fixtures.sertisseuse1Id, failure.id);

    const failureRow = await context.pool.query<{ status: string }>(
      'SELECT status FROM failure_reports WHERE id = $1',
      [failure.id],
    );
    assert.equal(failureRow.rows[0]?.status, 'PRISE_EN_CHARGE');
  });

  it("la clôture d'un ordre de travail est refusée sans intervention avec action réalisée documentée (section 45)", async () => {
    const failure = await reportFailure(context.fixtures.sertisseuse1Id);
    const workOrder = await newWorkOrder(context.fixtures.sertisseuse1Id, failure.id);

    const closure = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/cloture`,
      headers: { cookie: maintenanceCookie },
      payload: {},
    });
    assert.equal(closure.statusCode, 409, closure.body);
  });

  it("clôturer un ordre de travail sur un équipement à criticité HAUTE exige workorder:approve (section 52)", async () => {
    const failure = await reportFailure(context.fixtures.sertisseuse2Id);
    const workOrder = await newWorkOrder(context.fixtures.sertisseuse2Id, failure.id);

    const start = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/interventions`,
      headers: { cookie: maintenanceCookie },
      payload: {},
    });
    assert.equal(start.statusCode, 201, start.body);
    const intervention = start.json() as { id: string };

    await context.app.inject({
      method: 'POST',
      url: `/api/interventions/${intervention.id}/cloture`,
      headers: { cookie: maintenanceCookie },
      payload: { actionPerformed: 'Remplacement du roulement (test).' },
    });

    // MAINTENANCE alone cannot close this "important" work order.
    const forbidden = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/cloture`,
      headers: { cookie: maintenanceCookie },
      payload: { verificationResult: 'CONFORME' },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    // A verification result is required for HAUTE/CRITIQUE equipment.
    const missingVerification = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/cloture`,
      headers: { cookie: rmCookie },
      payload: {},
    });
    assert.equal(missingVerification.statusCode, 400, missingVerification.body);

    const closed = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/cloture`,
      headers: { cookie: rmCookie },
      payload: { verificationResult: 'CONFORME' },
    });
    assert.equal(closed.statusCode, 200, closed.body);

    const failureRow = await context.pool.query<{ status: string }>(
      'SELECT status FROM failure_reports WHERE id = $1',
      [failure.id],
    );
    assert.equal(failureRow.rows[0]?.status, 'RESOLUE');
    const equipmentRow = await context.pool.query<{ status: string }>(
      'SELECT status FROM equipment WHERE id = $1',
      [context.fixtures.sertisseuse2Id],
    );
    assert.equal(equipmentRow.rows[0]?.status, 'EN_SERVICE');
  });

  it("la durée d'une intervention est calculée à partir de début/fin, jamais saisie (10:00→10:45 = 45 min, section 39)", async () => {
    const failure = await reportFailure(context.fixtures.sertisseuse1Id);
    const workOrder = await newWorkOrder(context.fixtures.sertisseuse1Id, failure.id);

    const startedAt = new Date('2026-01-01T10:00:00Z');
    const endedAt = new Date('2026-01-01T10:45:00Z');
    const start = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/interventions`,
      headers: { cookie: maintenanceCookie },
      payload: { startedAt: startedAt.toISOString() },
    });
    assert.equal(start.statusCode, 201, start.body);
    const intervention = start.json() as { id: string };

    const end = await context.app.inject({
      method: 'POST',
      url: `/api/interventions/${intervention.id}/cloture`,
      headers: { cookie: maintenanceCookie },
      payload: { endedAt: endedAt.toISOString(), actionPerformed: 'Réglage (test).' },
    });
    assert.equal(end.statusCode, 200, end.body);

    const list = await context.app.inject({
      method: 'GET',
      url: `/api/work-orders/${workOrder.id}/interventions`,
      headers: { cookie: maintenanceCookie },
    });
    const rows = list.json() as readonly { id: string; durationSeconds: number }[];
    const row = rows.find((r) => r.id === intervention.id);
    assert.equal(row?.durationSeconds, 45 * 60);
  });

  it("une intervention ne peut pas se terminer avant son heure de début", async () => {
    const failure = await reportFailure(context.fixtures.sertisseuse1Id);
    const workOrder = await newWorkOrder(context.fixtures.sertisseuse1Id, failure.id);
    const start = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/interventions`,
      headers: { cookie: maintenanceCookie },
      payload: { startedAt: new Date('2026-01-01T10:00:00Z').toISOString() },
    });
    const intervention = start.json() as { id: string };

    const end = await context.app.inject({
      method: 'POST',
      url: `/api/interventions/${intervention.id}/cloture`,
      headers: { cookie: maintenanceCookie },
      payload: { endedAt: new Date('2026-01-01T09:00:00Z').toISOString(), actionPerformed: 'Test.' },
    });
    assert.equal(end.statusCode, 400, end.body);
  });

  it('une intervention sans action réalisée documentée ne peut pas se terminer', async () => {
    const failure = await reportFailure(context.fixtures.sertisseuse1Id);
    const workOrder = await newWorkOrder(context.fixtures.sertisseuse1Id, failure.id);
    const start = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/interventions`,
      headers: { cookie: maintenanceCookie },
      payload: {},
    });
    const intervention = start.json() as { id: string };

    const end = await context.app.inject({
      method: 'POST',
      url: `/api/interventions/${intervention.id}/cloture`,
      headers: { cookie: maintenanceCookie },
      payload: {},
    });
    assert.equal(end.statusCode, 400, end.body);
  });

  it('la consommation de pièces réduit le stock exactement une fois par usage, sans double soustraction (10 → 2 → 8, section 55)', async () => {
    await context.app.inject({
      method: 'POST',
      url: `/api/spare-parts/${context.fixtures.sparePartId}/reception`,
      headers: { cookie: rmCookie },
      payload: { movementType: 'RECEPTION', quantity: '10' },
    });

    const failure = await reportFailure(context.fixtures.sertisseuse1Id);
    const workOrder = await newWorkOrder(context.fixtures.sertisseuse1Id, failure.id);
    const start = await context.app.inject({
      method: 'POST',
      url: `/api/work-orders/${workOrder.id}/interventions`,
      headers: { cookie: maintenanceCookie },
      payload: {},
    });
    const intervention = start.json() as { id: string };

    const usage = await context.app.inject({
      method: 'POST',
      url: `/api/interventions/${intervention.id}/pieces`,
      headers: { cookie: maintenanceCookie },
      payload: { sparePartId: context.fixtures.sparePartId, quantity: '2' },
    });
    assert.equal(usage.statusCode, 201, usage.body);

    const stock = await context.pool.query<{ current_stock: string }>(
      'SELECT current_stock FROM spare_part_stock WHERE spare_part_id = $1',
      [context.fixtures.sparePartId],
    );
    assert.equal(Number(stock.rows[0]?.current_stock), 8);

    const movementCount = await context.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM spare_part_stock_movements WHERE spare_part_id = $1 AND movement_type = 'SORTIE_INTERVENTION'",
      [context.fixtures.sparePartId],
    );
    assert.equal(movementCount.rows[0]?.count, '1');
  });

  it('un ajustement de stock nécessite sparepart:adjust (RESPONSABLE_MAINTENANCE uniquement, section 52)', async () => {
    const forbidden = await context.app.inject({
      method: 'POST',
      url: `/api/spare-parts/${context.fixtures.sparePartId}/ajustement`,
      headers: { cookie: maintenanceCookie },
      payload: { quantityDelta: '-1', reason: 'Correction (test).' },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const allowed = await context.app.inject({
      method: 'POST',
      url: `/api/spare-parts/${context.fixtures.sparePartId}/ajustement`,
      headers: { cookie: rmCookie },
      payload: { quantityDelta: '-1', reason: 'Correction (test).' },
    });
    assert.equal(allowed.statusCode, 201, allowed.body);
  });

  it('un plan préventif mensuel dont la première échéance est passée apparaît en retard, jamais sélectionné manuellement (section 56)', async () => {
    const plan = await context.app.inject({
      method: 'POST',
      url: '/api/maintenance-plans',
      headers: { cookie: rmCookie },
      payload: {
        equipmentId: context.fixtures.autoclave1Id,
        name: 'Entretien mensuel (test)',
        frequencyType: 'MONTHLY',
        checklistLabels: ['Vérifier les joints'],
        firstDueAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    assert.equal(plan.statusCode, 201, plan.body);
    const planId = (plan.json() as { id: string }).id;

    const overdue = await context.app.inject({
      method: 'GET',
      url: `/api/preventive-tasks?enRetardUniquement=true&equipement=${context.fixtures.autoclave1Id}`,
      headers: { cookie: maintenanceCookie },
    });
    assert.equal(overdue.statusCode, 200);
    const rows = overdue.json() as readonly { maintenancePlanId: string; isOverdue: boolean }[];
    assert.ok(rows.some((row) => row.maintenancePlanId === planId && row.isOverdue));

    const taskRow = await context.pool.query<{ id: string }>(
      'SELECT id FROM preventive_tasks WHERE maintenance_plan_id = $1',
      [planId],
    );
    const taskId = taskRow.rows[0]?.id;
    if (!taskId) {
      throw new Error('Tâche préventive introuvable.');
    }
    const completion = await context.app.inject({
      method: 'POST',
      url: `/api/preventive-tasks/${taskId}/completion`,
      headers: { cookie: maintenanceCookie },
      payload: { checklistResponses: [] },
    });
    assert.equal(completion.statusCode, 200, completion.body);

    // Completing it generates the next occurrence automatically - the plan
    // is never left without a next due date.
    const remainingTasks = await context.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM preventive_tasks WHERE maintenance_plan_id = $1',
      [planId],
    );
    assert.equal(remainingTasks.rows[0]?.count, '2');
  });

  it('quatre pannes similaires en 30 jours sur le même équipement sont regroupées par mode/cause, sans IA (section 44)', async () => {
    for (const daysAgo of [25, 15, 5, 1]) {
      const failure = await reportFailure(context.fixtures.sertisseuse1Id, { severity: 'MOYENNE' });
      const workOrder = await newWorkOrder(context.fixtures.sertisseuse1Id, failure.id);
      const start = await context.app.inject({
        method: 'POST',
        url: `/api/work-orders/${workOrder.id}/interventions`,
        headers: { cookie: maintenanceCookie },
        payload: { startedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString() },
      });
      const intervention = start.json() as { id: string };
      await context.app.inject({
        method: 'PATCH',
        url: `/api/interventions/${intervention.id}`,
        headers: { cookie: maintenanceCookie },
        payload: {
          failureModeId: context.fixtures.failureModeBourrageId,
          failureCauseId: context.fixtures.failureCauseDefautPieceId,
        },
      });
      await context.app.inject({
        method: 'POST',
        url: `/api/interventions/${intervention.id}/cloture`,
        headers: { cookie: maintenanceCookie },
        payload: { actionPerformed: 'Nettoyage et réglage (test).' },
      });
      await context.app.inject({
        method: 'POST',
        url: `/api/work-orders/${workOrder.id}/cloture`,
        headers: { cookie: maintenanceCookie },
        payload: {},
      });
    }

    const analysis = await context.app.inject({
      method: 'GET',
      url: `/api/equipment/${context.fixtures.sertisseuse1Id}/pannes-repetees?jours=30`,
      headers: { cookie: maintenanceCookie },
    });
    assert.equal(analysis.statusCode, 200, analysis.body);
    const groups = analysis.json() as readonly { failureModeCode: string | null; occurrenceCount: number }[];
    const group = groups.find((g) => g.failureModeCode === 'BOURRAGE');
    assert.equal(group?.occurrenceCount, 4);
  });

  it("une non-conformité peut se lier à une panne et à un ordre de travail (scénario 5, section 63)", async () => {
    const failure = await reportFailure(context.fixtures.sertisseuse2Id);
    const workOrder = await newWorkOrder(context.fixtures.sertisseuse2Id, failure.id);

    const ncr = await context.app.inject({
      method: 'POST',
      url: '/api/nonconformities',
      headers: { cookie: adminCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        sourceType: null,
        sourceId: null,
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Défaut de sertissage (test)',
        description: 'Investigation liée à une panne machine (test).',
        severity: 'MAJEURE',
        priority: 'HAUTE',
        ownerUserId: null,
        dueAt: null,
        qualityBlockRequired: false,
        links: [
          { entityType: 'EQUIPMENT', entityId: context.fixtures.sertisseuse2Id, relationshipType: 'SOURCE' },
          { entityType: 'FAILURE_REPORT', entityId: failure.id, relationshipType: 'SOURCE' },
        ],
      },
    });
    assert.equal(ncr.statusCode, 201, ncr.body);
    const ncrId = (ncr.json() as { id: string }).id;

    const link = await context.app.inject({
      method: 'POST',
      url: `/api/nonconformities/${ncrId}/liens`,
      headers: { cookie: adminCookie },
      payload: { entityType: 'MAINTENANCE_WORK_ORDER', entityId: workOrder.id, relationshipType: 'SOURCE' },
    });
    assert.equal(link.statusCode, 201, link.body);

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/nonconformities/${ncrId}`,
      headers: { cookie: adminCookie },
    });
    assert.equal(detail.statusCode, 200);
    const body = detail.json() as { links: readonly { entityType: string; label: string | null }[] };
    const failureLink = body.links.find((entry) => entry.entityType === 'FAILURE_REPORT');
    const workOrderLink = body.links.find((entry) => entry.entityType === 'MAINTENANCE_WORK_ORDER');
    assert.ok(failureLink?.label, 'le libellé de la panne doit être résolu');
    assert.ok(workOrderLink?.label, "le libellé de l'ordre de travail doit être résolu");
  });
});
