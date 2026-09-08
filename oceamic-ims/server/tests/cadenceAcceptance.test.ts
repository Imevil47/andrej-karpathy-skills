import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestContext, type TestContext } from './support/context.ts';

// The ten Phase 3 acceptance scenarios, played through the HTTP API exactly
// as the terrain interface does.

let context: TestContext;
let productionCookie: string;

async function createRunWithLines(
  lines: readonly { productionLineId: string; activityType: string }[],
): Promise<{ runId: string; runLines: Readonly<Record<string, string>> }> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/production/runs',
    headers: { cookie: productionCookie },
    payload: {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: context.fixtures.productSardineId,
      format: null,
      piecesPerCan: null,
      responsibleUserId: null,
      lines,
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

  const detail = await context.app.inject({
    method: 'GET',
    url: `/api/production/runs/${runId}`,
    headers: { cookie: productionCookie },
  });
  const payload = detail.json() as { lines: readonly { id: string; lineCode: string }[] };
  const runLines: Record<string, string> = {};
  for (const line of payload.lines) {
    runLines[line.lineCode] = line.id;
  }
  return { runId, runLines };
}

async function present(runId: string, runLineId: string, employeeNumbers: readonly string[]) {
  for (const number of employeeNumbers) {
    const employee = await context.app.inject({
      method: 'GET',
      url: '/api/employees',
      headers: { cookie: productionCookie },
    });
    const employeeId = (employee.json() as readonly { id: string; employeeNumber: string }[]).find(
      (row) => row.employeeNumber === number,
    )?.id;
    assert.ok(employeeId, `matricule ${number} introuvable`);
    const response = await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${runId}/personnel`,
      headers: { cookie: productionCookie },
      payload: { productionRunLineId: runLineId, employeeId, isPresent: true },
    });
    assert.equal(response.statusCode, 201, response.body);
  }
}

async function startRound(runId: string): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: `/api/production/runs/${runId}/tours-controle`,
    headers: { cookie: productionCookie },
    payload: { notes: null },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

async function openLine(roundId: string, runLineId: string): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: `/api/cadence/control-rounds/${roundId}/lignes`,
    headers: { cookie: productionCookie },
    payload: { productionRunLineId: runLineId },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

async function record(
  lineControlId: string,
  employeeNumber: string,
  quantityCompleted: string,
  measurementDurationSeconds: number,
  confirmCrossLine = false,
) {
  return context.app.inject({
    method: 'POST',
    url: `/api/cadence/line-controls/${lineControlId}/employes`,
    headers: { cookie: productionCookie },
    payload: {
      employeeNumber,
      quantityCompleted,
      measurementUnit: 'BOITES',
      measurementDurationSeconds,
      controlledAt: new Date().toISOString(),
      confirmCrossLine,
    },
  });
}

describe("Scénarios d'acceptation Phase 3", () => {
  before(async () => {
    context = await createTestContext();
    productionCookie = await context.login('production');
  });
  after(async () => {
    await context.close();
  });

  it('1. contrôle complet de ligne : couverture 12 / 12 = 100 %, contrôle complet', async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
    ]);
    for (let i = 5; i <= 12; i += 1) {
      await context.pool.query(
        'INSERT INTO employees (employee_number, first_name, last_name) VALUES ($1, $2, $3)',
        [`30${i.toString().padStart(2, '0')}`, `Prénom${i}`, `Nom${i}`],
      );
    }
    const numbers = [
      '1001', '1002', '1003', '1004',
      '3005', '3006', '3007', '3008', '3009', '3010', '3011', '3012',
    ];
    await present(runId, runLines['L1'] ?? '', numbers);

    const roundId = await startRound(runId);
    const lineControlId = await openLine(roundId, runLines['L1'] ?? '');
    for (const number of numbers) {
      const response = await record(lineControlId, number, '10', 600);
      assert.equal(response.statusCode, 201, response.body);
    }

    const closeResponse = await context.app.inject({
      method: 'POST',
      url: `/api/cadence/line-controls/${lineControlId}/cloture`,
      headers: { cookie: productionCookie },
    });
    assert.equal(closeResponse.statusCode, 200, closeResponse.body);
    const coverage = closeResponse.json() as {
      expectedEmployeeCount: number;
      controlledEmployeeCount: number;
      coveragePercent: string;
      coverageStatus: string;
    };
    assert.equal(coverage.expectedEmployeeCount, 12);
    assert.equal(coverage.controlledEmployeeCount, 12);
    assert.equal(coverage.coveragePercent, '100.00');
    assert.equal(coverage.coverageStatus, 'COMPLET');
  });

  it('2. contrôle incomplet : 10 / 12 = 83.33 %, contrôle incomplet, rien inventé pour les absents', async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
    ]);
    for (let i = 5; i <= 12; i += 1) {
      await context.pool.query(
        'INSERT INTO employees (employee_number, first_name, last_name) VALUES ($1, $2, $3)',
        [`40${i.toString().padStart(2, '0')}`, `Prénom${i}`, `Nom${i}`],
      );
    }
    const numbers = [
      '1001', '1002', '1003', '1004',
      '4005', '4006', '4007', '4008', '4009', '4010', '4011', '4012',
    ];
    await present(runId, runLines['L1'] ?? '', numbers);

    const roundId = await startRound(runId);
    const lineControlId = await openLine(roundId, runLines['L1'] ?? '');
    for (const number of numbers.slice(0, 10)) {
      const response = await record(lineControlId, number, '10', 600);
      assert.equal(response.statusCode, 201, response.body);
    }

    const closeResponse = await context.app.inject({
      method: 'POST',
      url: `/api/cadence/line-controls/${lineControlId}/cloture`,
      headers: { cookie: productionCookie },
    });
    const coverage = closeResponse.json() as {
      expectedEmployeeCount: number;
      controlledEmployeeCount: number;
      coveragePercent: string;
      coverageStatus: string;
    };
    assert.equal(coverage.expectedEmployeeCount, 12);
    assert.equal(coverage.controlledEmployeeCount, 10);
    assert.equal(coverage.coveragePercent, '83.33');
    assert.equal(coverage.coverageStatus, 'INCOMPLET');
  });

  it('3. cadence individuelle : 18 boîtes en 10 minutes = 108/h, performance 90 % contre un standard de 120/h', async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
    ]);
    await present(runId, runLines['L1'] ?? '', ['1001']);
    const roundId = await startRound(runId);
    const lineControlId = await openLine(roundId, runLines['L1'] ?? '');

    const response = await record(lineControlId, '1001', '18', 600);
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json() as { cadencePerHour: string; performancePercent: string };
    assert.equal(body.cadencePerHour, '108.00');
    assert.equal(body.performancePercent, '90.00');
  });

  it('4. deux employées mesurées sur des durées différentes : 120/h et 180/h', async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
    ]);
    await present(runId, runLines['L1'] ?? '', ['1001', '1002']);
    const roundId = await startRound(runId);
    const lineControlId = await openLine(roundId, runLines['L1'] ?? '');

    const a = await record(lineControlId, '1001', '20', 600);
    const b = await record(lineControlId, '1002', '15', 300);
    assert.equal((a.json() as { cadencePerHour: string }).cadencePerHour, '120.00');
    assert.equal((b.json() as { cadencePerHour: string }).cadencePerHour, '180.00');
  });

  it('5. un même matricule ne peut pas être enregistré deux fois sur la même ligne du même tour', async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
    ]);
    await present(runId, runLines['L1'] ?? '', ['1001']);
    const roundId = await startRound(runId);
    const lineControlId = await openLine(roundId, runLines['L1'] ?? '');

    const first = await record(lineControlId, '1001', '18', 600);
    assert.equal(first.statusCode, 201, first.body);

    const duplicate = await record(lineControlId, '1001', '19', 600);
    assert.equal(duplicate.statusCode, 409);
    const body = duplicate.json() as { message: string };
    assert.equal(
      body.message,
      'Ce matricule est déjà enregistré pour cette ligne dans ce tour de contrôle.',
    );
  });

  it("6. activité combinée sardine : un seul contrôle employée pour GRATTAGE_REMPLISSAGE", async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
    ]);
    await present(runId, runLines['L1'] ?? '', ['1001']);
    const roundId = await startRound(runId);
    const lineControlId = await openLine(roundId, runLines['L1'] ?? '');
    await record(lineControlId, '1001', '18', 600);

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/cadence/control-rounds/${roundId}`,
      headers: { cookie: productionCookie },
    });
    const payload = detail.json() as {
      lines: readonly { activityType: string }[];
      employeeControls: readonly { employeeNumber: string }[];
    };
    assert.equal(payload.lines.length, 1);
    assert.equal(payload.lines[0]?.activityType, 'GRATTAGE_REMPLISSAGE');
    // Exactly one measurement for the employee: no split GRATTAGE + REMPLISSAGE rows.
    assert.equal(payload.employeeControls.filter((c) => c.employeeNumber === '1001').length, 1);
  });

  it('7. activité séparée maquereau : les lignes suivent la configuration réelle du Run, pas une règle universelle', async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE' },
      { productionLineId: context.fixtures.lineL2Id, activityType: 'REMPLISSAGE' },
    ]);
    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/production/runs/${runId}`,
      headers: { cookie: productionCookie },
    });
    const payload = detail.json() as { lines: readonly { lineCode: string; activityType: string }[] };
    assert.equal(payload.lines.find((l) => l.lineCode === 'L1')?.activityType, 'GRATTAGE');
    assert.equal(payload.lines.find((l) => l.lineCode === 'L2')?.activityType, 'REMPLISSAGE');
    assert.notEqual(runLines['L1'], runLines['L2']);
  });

  it('8. arrêt de 27 minutes pour panne machine, visible dans l historique', async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL2Id, activityType: 'GRATTAGE_REMPLISSAGE' },
    ]);
    const started = new Date(Date.now() - 27 * 60 * 1000);
    const start = await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${runId}/arrets`,
      headers: { cookie: productionCookie },
      payload: {
        productionRunLineId: runLines['L2'],
        downtimeCategoryId: context.fixtures.downtimeCategoryId,
        reasonText: 'Panne machine (test)',
        planned: false,
        startedAt: started.toISOString(),
      },
    });
    assert.equal(start.statusCode, 201, start.body);
    const downtimeId = (start.json() as { id: string }).id;

    const close = await context.app.inject({
      method: 'POST',
      url: `/api/downtime/${downtimeId}/cloture`,
      headers: { cookie: productionCookie },
      payload: { endedAt: new Date().toISOString() },
    });
    assert.equal(close.statusCode, 201, close.body);
    assert.equal((close.json() as { durationSeconds: number }).durationSeconds, 27 * 60);

    const history = await context.app.inject({
      method: 'GET',
      url: `/api/downtime?run=${runId}`,
      headers: { cookie: productionCookie },
    });
    const rows = history.json() as readonly { categoryCode: string; durationSeconds: number }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.categoryCode, 'PANNE_MACHINE');
    assert.equal(rows[0]?.durationSeconds, 27 * 60);
  });

  it("9. un changement de standard ultérieur ne réécrit pas une performance déjà mesurée", async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
    ]);
    await present(runId, runLines['L1'] ?? '', ['1001']);
    const roundId = await startRound(runId);
    const lineControlId = await openLine(roundId, runLines['L1'] ?? '');

    const response = await record(lineControlId, '1001', '18', 600);
    assert.equal((response.json() as { performancePercent: string }).performancePercent, '90.00');

    // The standard changes from 120/h to 110/h after the measurement.
    await context.pool.query('UPDATE cadence_standards SET standard_cadence = 110 WHERE id = $1', [
      context.fixtures.cadenceStandardId,
    ]);

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/cadence/control-rounds/${roundId}`,
      headers: { cookie: productionCookie },
    });
    const payload = detail.json() as {
      employeeControls: readonly { performancePercent: string; standardCadenceSnapshot: string }[];
    };
    assert.equal(payload.employeeControls[0]?.performancePercent, '90.00');
    assert.equal(payload.employeeControls[0]?.standardCadenceSnapshot, '120.00');
  });

  it('10. une employée change de ligne : les contrôles passés restent liés à l ancienne ligne', async () => {
    const { runId, runLines } = await createRunWithLines([
      { productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' },
      { productionLineId: context.fixtures.lineL2Id, activityType: 'GRATTAGE_REMPLISSAGE' },
    ]);
    await present(runId, runLines['L1'] ?? '', ['1001']);

    const roundOnL1 = await startRound(runId);
    const lineControlL1 = await openLine(roundOnL1, runLines['L1'] ?? '');
    const controlOnL1 = await record(lineControlL1, '1001', '18', 600);
    assert.equal(controlOnL1.statusCode, 201, controlOnL1.body);
    await context.app.inject({
      method: 'POST',
      url: `/api/cadence/control-rounds/${roundOnL1}/cloture`,
      headers: { cookie: productionCookie },
    });

    // The employee moves to L2.
    const employees = await context.app.inject({
      method: 'GET',
      url: '/api/employees',
      headers: { cookie: productionCookie },
    });
    const employeeId = (employees.json() as readonly { id: string; employeeNumber: string }[]).find(
      (row) => row.employeeNumber === '1001',
    )?.id;
    await context.app.inject({
      method: 'POST',
      url: `/api/production/runs/${runId}/personnel`,
      headers: { cookie: productionCookie },
      payload: { productionRunLineId: runLines['L2'], employeeId, isPresent: true },
    });

    const roundOnL2 = await startRound(runId);
    const lineControlL2 = await openLine(roundOnL2, runLines['L2'] ?? '');
    const controlOnL2 = await record(lineControlL2, '1001', '10', 600);
    assert.equal(controlOnL2.statusCode, 201, controlOnL2.body);

    const detailL1 = await context.app.inject({
      method: 'GET',
      url: `/api/cadence/control-rounds/${roundOnL1}`,
      headers: { cookie: productionCookie },
    });
    const detailL2 = await context.app.inject({
      method: 'GET',
      url: `/api/cadence/control-rounds/${roundOnL2}`,
      headers: { cookie: productionCookie },
    });
    const payloadL1 = detailL1.json() as { lines: readonly { productionRunLineId: string }[] };
    const payloadL2 = detailL2.json() as { lines: readonly { productionRunLineId: string }[] };
    assert.equal(payloadL1.lines[0]?.productionRunLineId, runLines['L1']);
    assert.equal(payloadL2.lines[0]?.productionRunLineId, runLines['L2']);
  });
});
