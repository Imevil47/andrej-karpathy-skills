import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestContext, type TestContext } from './support/context.ts';

// Phase 6 — QMS horizontal layer: closure gates (sections 15/57), role
// separation (sections 53-54), document control lifecycle (sections 27-29),
// complaint/recall traceability recovered from existing relations rather than
// manual entry (sections 17/32-36). Played through the HTTP API, mirroring
// the phase5.test.ts pattern.

let context: TestContext;
let qualiteCookie: string;
let rqCookie: string;
let auditeurCookie: string;
let productionCookie: string;
let stockCookie: string;

async function newRun(): Promise<string> {
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
      lines: [{ productionLineId: context.fixtures.lineL1Id, activityType: 'GRATTAGE_REMPLISSAGE' }],
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
  return runId;
}

async function newCycle(runId: string): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/sterilization-cycles',
    headers: { cookie: productionCookie },
    payload: {
      autoclaveId: context.fixtures.autoclave1Id,
      sterilizationProgramId: context.fixtures.sterilizationProgramId,
      startedAt: new Date().toISOString(),
      operatorUserId: null,
      notes: null,
      loads: [{ productionRunId: runId, quantityUnits: 480, basketReference: 'A1', notes: null }],
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

async function newPackagingBatch(runId: string, cycleId: string): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/packaging-batches',
    headers: { cookie: productionCookie },
    payload: {
      productionRunId: runId,
      sterilizationCycleId: cycleId,
      format: 'CLUB',
      responsibleUserId: null,
      notes: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

async function newFinishedGoodLot(
  batchId: string,
  runId: string,
  cycleId: string,
): Promise<Readonly<{ id: string; lotCode: string }>> {
  const response = await context.app.inject({
    method: 'POST',
    url: `/api/packaging-batches/${batchId}/lots-pf`,
    headers: { cookie: productionCookie },
    payload: {
      format: 'CLUB',
      piecesPerCan: 4,
      productionDate: new Date().toISOString().slice(0, 10),
      bestBeforeDate: null,
      notes: null,
      sources: [{ sterilizationCycleId: cycleId, productionRunId: runId, quantityUnits: 480 }],
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string; lotCode: string };
}

async function newPallet(lotId: string, quantityCartons: number, quantityUnits: number): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/pallets',
    headers: { cookie: productionCookie },
    payload: {
      destinationLocationId: context.fixtures.stockPfALocationId,
      occurredAt: new Date().toISOString(),
      notes: null,
      contents: [{ finishedGoodLotId: lotId, quantityCartons, quantityUnits }],
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

async function releaseFgQuality(entityType: 'FINISHED_GOOD_LOT' | 'PALLET', entityId: string): Promise<void> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/fg-quality/decisions',
    headers: { cookie: qualiteCookie },
    payload: { entityType, entityId, decisionType: 'ACCEPTE', reason: 'Conforme (test).', notes: null },
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function newRawMaterialLot(lotCode: string): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/receptions',
    headers: { cookie: stockCookie },
    payload: {
      receivedAt: new Date().toISOString(),
      lot: {
        mode: 'NOUVEAU',
        lotCode,
        speciesId: context.fixtures.speciesSardineId,
        origin: null,
        captureDate: null,
        notes: null,
      },
      supplierId: context.fixtures.supplierId,
      vesselId: null,
      tideNumber: null,
      truckRegistration: null,
      quantityKg: '2000.000',
      destinationLocationId: context.fixtures.oceamic2Id,
      receptionType: 'FOURNISSEUR',
      externalSourceLocationId: null,
      documentReference: null,
      notes: null,
      quickInspection: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { lotId: string }).lotId;
}

async function receiveAndConsume(runId: string, lotCode: string): Promise<string> {
  const lotId = await newRawMaterialLot(lotCode);
  const consumption = await context.app.inject({
    method: 'POST',
    url: `/api/production/runs/${runId}/consommations`,
    headers: { cookie: productionCookie },
    payload: {
      rawMaterialLotId: lotId,
      sourceLocationId: context.fixtures.oceamic2Id,
      quantityKg: '2000.000',
      consumedAt: new Date().toISOString(),
      notes: null,
    },
  });
  assert.equal(consumption.statusCode, 201, consumption.body);
  return lotId;
}

async function newShipment(containerNumber: string): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/shipments',
    headers: { cookie: stockCookie },
    payload: {
      customerId: context.fixtures.customerId,
      plannedDate: new Date().toISOString().slice(0, 10),
      destination: 'Port de test',
      containerNumber,
      sealNumber: null,
      vehicleRegistration: null,
      targetTemperatureC: null,
      gensetRequired: null,
      notes: null,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

describe('Phase 6 — QMS : non-conformités, CAPA, réclamations, audits, documents, retraits', () => {
  before(async () => {
    context = await createTestContext();
    qualiteCookie = await context.login('qualite');
    rqCookie = await context.login('responsable_qualite');
    auditeurCookie = await context.login('auditeur');
    productionCookie = await context.login('production');
    stockCookie = await context.login('stock');
  });
  after(async () => {
    await context.close();
  });

  it("une non-conformité se crée avec ses liens vers l'entité source, jamais un enregistrement isolé (sections 8-9, 57)", async () => {
    const lotId = await newRawMaterialLot('LOT-MP-NCR-001');

    const forbidden = await context.app.inject({
      method: 'POST',
      url: '/api/nonconformities',
      headers: { cookie: auditeurCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        sourceType: 'RAW_MATERIAL_LOT',
        sourceId: lotId,
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Poids hors tolérance',
        description: 'Détecté lors du contrôle de réception.',
        severity: 'MAJEURE',
        priority: 'HAUTE',
        ownerUserId: null,
        dueAt: null,
        qualityBlockRequired: true,
        links: [],
      },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/nonconformities',
      headers: { cookie: qualiteCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        sourceType: 'RAW_MATERIAL_LOT',
        sourceId: lotId,
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Poids hors tolérance',
        description: 'Détecté lors du contrôle de réception.',
        severity: 'MAJEURE',
        priority: 'HAUTE',
        ownerUserId: null,
        dueAt: null,
        qualityBlockRequired: true,
        links: [],
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const ncr = created.json() as { id: string; nonconformityCode: string; status: string };
    assert.match(ncr.nonconformityCode, /^NC-/);
    assert.equal(ncr.status, 'OUVERTE');

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/nonconformities/${ncr.id}`,
      headers: { cookie: qualiteCookie },
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const payload = detail.json() as {
      nonconformity: { sourceLabel: string | null };
      links: readonly { entityType: string; relationshipType: string; label: string | null }[];
    };
    assert.equal(payload.nonconformity.sourceLabel, 'LOT-MP-NCR-001');
    const sourceLink = payload.links.find((link) => link.relationshipType === 'SOURCE');
    assert.equal(sourceLink?.entityType, 'RAW_MATERIAL_LOT');
    assert.equal(sourceLink?.label, 'LOT-MP-NCR-001');

    const auditLog = await context.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM audit_log WHERE entity_type = 'nonconformities' AND entity_id = $1 AND action = 'NCR_CREATION'",
      [ncr.id],
    );
    assert.equal(auditLog.rows[0]?.count, '1');
  });

  it('une non-conformité peut déclencher le blocage qualité existant (lot_blocks, sans nouveau système) - section 9', async () => {
    const lotId = await newRawMaterialLot('LOT-MP-NCR-002');
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/nonconformities',
      headers: { cookie: qualiteCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        sourceType: 'RAW_MATERIAL_LOT',
        sourceId: lotId,
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Anomalie détectée',
        description: 'Nécessite un blocage.',
        severity: 'CRITIQUE',
        priority: 'URGENTE',
        ownerUserId: null,
        dueAt: null,
        qualityBlockRequired: true,
        links: [],
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const ncrId = (created.json() as { id: string }).id;

    const block = await context.app.inject({
      method: 'POST',
      url: `/api/nonconformities/${ncrId}/blocage`,
      headers: { cookie: qualiteCookie },
      payload: { entityType: 'RAW_MATERIAL_LOT', entityId: lotId, reason: 'Non-conformité en cours (test).' },
    });
    assert.equal(block.statusCode, 201, block.body);

    const activeBlock = await context.pool.query<{ status: string }>(
      "SELECT status FROM lot_blocks WHERE raw_material_lot_id = $1 AND status = 'ACTIF'",
      [lotId],
    );
    assert.equal(activeBlock.rows.length, 1);

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/nonconformities/${ncrId}`,
      headers: { cookie: qualiteCookie },
    });
    const payload = detail.json() as { nonconformity: { blockEntityType: string | null; blockReferenceId: string | null } };
    assert.equal(payload.nonconformity.blockEntityType, 'RAW_MATERIAL_LOT');
    assert.ok(payload.nonconformity.blockReferenceId);
  });

  it('la clôture d\'une non-conformité est bloquée tant qu\'un CAPA lié reste ouvert, jamais un contournement (section 57)', async () => {
    const lotId = await newRawMaterialLot('LOT-MP-NCR-003');
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/nonconformities',
      headers: { cookie: qualiteCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        sourceType: 'RAW_MATERIAL_LOT',
        sourceId: lotId,
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Écart process',
        description: 'Nécessite un CAPA.',
        severity: 'MAJEURE',
        priority: 'NORMALE',
        ownerUserId: null,
        dueAt: null,
        qualityBlockRequired: false,
        links: [],
      },
    });
    const ncrId = (created.json() as { id: string }).id;

    const capa = await context.app.inject({
      method: 'POST',
      url: '/api/capa',
      headers: { cookie: qualiteCookie },
      payload: {
        sourceNonconformityId: ncrId,
        title: 'Réglage machine',
        description: 'Corriger le réglage.',
        capaType: 'CORRECTIVE',
        priority: 'NORMALE',
        ownerUserId: context.fixtures.users.QUALITE,
        openedAt: new Date().toISOString(),
        dueAt: null,
        effectivenessRequired: false,
      },
    });
    assert.equal(capa.statusCode, 201, capa.body);
    const capaId = (capa.json() as { id: string }).id;

    // Walk the NCR to A_VERIFIER first: the workflow never lets an OUVERTE
    // record jump straight to CLOTUREE (section 7.1).
    for (const status of ['EN_ANALYSE', 'ACTION_REQUISE', 'A_VERIFIER']) {
      const step = await context.app.inject({
        method: 'POST',
        url: `/api/nonconformities/${ncrId}/statut`,
        headers: { cookie: qualiteCookie },
        payload: { status, reason: null },
      });
      assert.equal(step.statusCode, 200, step.body);
    }

    const closeAttempt = await context.app.inject({
      method: 'POST',
      url: `/api/nonconformities/${ncrId}/statut`,
      headers: { cookie: rqCookie },
      payload: { status: 'CLOTUREE', reason: null },
    });
    assert.equal(closeAttempt.statusCode, 409, closeAttempt.body);
    assert.match((closeAttempt.json() as { message: string }).message, /CAPA/);

    // PRODUCTION never closes a Quality NCR, whatever its own state (section 53).
    const productionAttempt = await context.app.inject({
      method: 'POST',
      url: `/api/nonconformities/${ncrId}/statut`,
      headers: { cookie: productionCookie },
      payload: { status: 'CLOTUREE', reason: null },
    });
    assert.equal(productionAttempt.statusCode, 403, productionAttempt.body);

    const closeCapa = await context.app.inject({
      method: 'POST',
      url: `/api/capa/${capaId}/cloture`,
      headers: { cookie: rqCookie },
    });
    assert.equal(closeCapa.statusCode, 200, closeCapa.body);

    const closeNcr = await context.app.inject({
      method: 'POST',
      url: `/api/nonconformities/${ncrId}/statut`,
      headers: { cookie: rqCookie },
      payload: { status: 'CLOTUREE', reason: null },
    });
    assert.equal(closeNcr.statusCode, 200, closeNcr.body);
  });

  it("un CAPA reste ouvert tant que le contrôle d'efficacité requis n'a pas conclu positivement (sections 14-15, 58)", async () => {
    const capa = await context.app.inject({
      method: 'POST',
      url: '/api/capa',
      headers: { cookie: qualiteCookie },
      payload: {
        sourceNonconformityId: null,
        title: 'CAPA formation opérateur',
        description: 'Former opérateur et vérifier les 3 productions suivantes.',
        capaType: 'CORRECTIVE_PREVENTIVE',
        priority: 'HAUTE',
        ownerUserId: context.fixtures.users.QUALITE,
        openedAt: new Date().toISOString(),
        dueAt: null,
        effectivenessRequired: true,
      },
    });
    assert.equal(capa.statusCode, 201, capa.body);
    const capaId = (capa.json() as { id: string }).id;

    const action = await context.app.inject({
      method: 'POST',
      url: `/api/capa/${capaId}/actions`,
      headers: { cookie: qualiteCookie },
      payload: {
        actionType: 'ACTION_CORRECTIVE',
        description: 'Former opérateur',
        responsibleUserId: context.fixtures.users.PRODUCTION,
        plannedDate: null,
        dueDate: null,
      },
    });
    assert.equal(action.statusCode, 201, action.body);
    const actionId = (action.json() as { id: string }).id;

    // STOCK/PRODUCTION can complete an action assigned to them, but only
    // RESPONSABLE_QUALITE can approve the CAPA closure (section 53).
    const complete = await context.app.inject({
      method: 'POST',
      url: `/api/capa-actions/${actionId}/completion`,
      headers: { cookie: productionCookie },
      payload: { evidence: 'Formation réalisée le jour même.' },
    });
    assert.equal(complete.statusCode, 200, complete.body);

    const closeWithoutCheck = await context.app.inject({
      method: 'POST',
      url: `/api/capa/${capaId}/cloture`,
      headers: { cookie: rqCookie },
    });
    assert.equal(closeWithoutCheck.statusCode, 409, closeWithoutCheck.body);
    assert.match(
      (closeWithoutCheck.json() as { message: string }).message,
      /Clôture impossible\.\nDes actions obligatoires restent ouvertes\./,
    );

    const negativeCheck = await context.app.inject({
      method: 'POST',
      url: `/api/capa/${capaId}/efficacite`,
      headers: { cookie: qualiteCookie },
      payload: {
        checkedAt: new Date().toISOString(),
        method: 'Vérification des 3 productions suivantes',
        result: 'Écart encore observé sur la 2e production.',
        effective: false,
        notes: null,
      },
    });
    assert.equal(negativeCheck.statusCode, 201, negativeCheck.body);

    const closeAfterNegative = await context.app.inject({
      method: 'POST',
      url: `/api/capa/${capaId}/cloture`,
      headers: { cookie: rqCookie },
    });
    assert.equal(closeAfterNegative.statusCode, 409, closeAfterNegative.body);

    const positiveCheck = await context.app.inject({
      method: 'POST',
      url: `/api/capa/${capaId}/efficacite`,
      headers: { cookie: qualiteCookie },
      payload: {
        checkedAt: new Date().toISOString(),
        method: 'Vérification des 3 productions suivantes',
        result: 'Aucun écart sur les 3 productions suivantes.',
        effective: true,
        notes: null,
      },
    });
    assert.equal(positiveCheck.statusCode, 201, positiveCheck.body);

    // QUALITE can never approve its own CAPA's closure (section 54).
    const qualiteCloseAttempt = await context.app.inject({
      method: 'POST',
      url: `/api/capa/${capaId}/cloture`,
      headers: { cookie: qualiteCookie },
    });
    assert.equal(qualiteCloseAttempt.statusCode, 403, qualiteCloseAttempt.body);

    const closeAfterPositive = await context.app.inject({
      method: 'POST',
      url: `/api/capa/${capaId}/cloture`,
      headers: { cookie: rqCookie },
    });
    assert.equal(closeAfterPositive.statusCode, 200, closeAfterPositive.body);
  });

  it("une révision de document n'est jamais écrasée : la 01 reste en vigueur jusqu'à la mise en vigueur de la 02, puis devient historique (sections 27-29, 59)", async () => {
    const document = await context.app.inject({
      method: 'POST',
      url: '/api/quality-documents',
      headers: { cookie: qualiteCookie },
      payload: {
        documentCode: 'PR-QA-TEST',
        title: 'Procédure de contrôle qualité (test)',
        documentType: 'PROCEDURE',
        department: 'Qualité',
        ownerUserId: context.fixtures.users.QUALITE,
        changeSummary: 'Version initiale.',
      },
    });
    assert.equal(document.statusCode, 201, document.body);
    const { id: documentId, revisionId: revision1Id } = document.json() as { id: string; revisionId: string };

    await context.app.inject({
      method: 'POST',
      url: `/api/document-revisions/${revision1Id}/soumission`,
      headers: { cookie: qualiteCookie },
    });

    // Approval/activation are document:approve, reserved to RESPONSABLE_QUALITE.
    const qualiteApproveAttempt = await context.app.inject({
      method: 'POST',
      url: `/api/document-revisions/${revision1Id}/approbation`,
      headers: { cookie: qualiteCookie },
    });
    assert.equal(qualiteApproveAttempt.statusCode, 403, qualiteApproveAttempt.body);

    const approve1 = await context.app.inject({
      method: 'POST',
      url: `/api/document-revisions/${revision1Id}/approbation`,
      headers: { cookie: rqCookie },
    });
    assert.equal(approve1.statusCode, 200, approve1.body);
    const activate1 = await context.app.inject({
      method: 'POST',
      url: `/api/document-revisions/${revision1Id}/mise-en-vigueur`,
      headers: { cookie: rqCookie },
    });
    assert.equal(activate1.statusCode, 200, activate1.body);

    const afterFirstActivation = await context.app.inject({
      method: 'GET',
      url: `/api/quality-documents/${documentId}`,
      headers: { cookie: qualiteCookie },
    });
    const detailAfterFirst = afterFirstActivation.json() as {
      document: { status: string; currentRevisionNumber: number };
      revisions: readonly { revisionNumber: number; status: string; changeSummary: string }[];
    };
    assert.equal(detailAfterFirst.document.status, 'EN_VIGUEUR');
    assert.equal(detailAfterFirst.document.currentRevisionNumber, 1);

    const revision2 = await context.app.inject({
      method: 'POST',
      url: `/api/quality-documents/${documentId}/revisions`,
      headers: { cookie: qualiteCookie },
      payload: { changeSummary: 'Ajout d\'une étape de vérification.', fileReference: null },
    });
    assert.equal(revision2.statusCode, 201, revision2.body);
    const { id: revision2Id, revisionNumber } = revision2.json() as { id: string; revisionNumber: number };
    assert.equal(revisionNumber, 2);

    await context.app.inject({
      method: 'POST',
      url: `/api/document-revisions/${revision2Id}/soumission`,
      headers: { cookie: qualiteCookie },
    });
    await context.app.inject({
      method: 'POST',
      url: `/api/document-revisions/${revision2Id}/approbation`,
      headers: { cookie: rqCookie },
    });
    await context.app.inject({
      method: 'POST',
      url: `/api/document-revisions/${revision2Id}/mise-en-vigueur`,
      headers: { cookie: rqCookie },
    });

    const afterSecondActivation = await context.app.inject({
      method: 'GET',
      url: `/api/quality-documents/${documentId}`,
      headers: { cookie: qualiteCookie },
    });
    const detailAfterSecond = afterSecondActivation.json() as {
      document: { status: string; currentRevisionNumber: number };
      revisions: readonly { revisionNumber: number; status: string; changeSummary: string }[];
    };
    assert.equal(detailAfterSecond.document.status, 'EN_VIGUEUR');
    assert.equal(detailAfterSecond.document.currentRevisionNumber, 2);

    const revisionOne = detailAfterSecond.revisions.find((revision) => revision.revisionNumber === 1);
    const revisionTwo = detailAfterSecond.revisions.find((revision) => revision.revisionNumber === 2);
    assert.equal(revisionOne?.status, 'OBSOLETE');
    assert.equal(revisionOne?.changeSummary, 'Version initiale.');
    assert.equal(revisionTwo?.status, 'EN_VIGUEUR');

    const currentActive = await context.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM quality_document_revisions WHERE quality_document_id = $1 AND status = 'EN_VIGUEUR'",
      [documentId],
    );
    assert.equal(currentActive.rows[0]?.count, '1');
  });

  it("une réclamation client retrouve sa traçabilité (palettes/lot PF/stérilisation/run/lot MP) sans ressaisie manuelle (sections 17-18, 60)", async () => {
    const runId = await newRun();
    const rawMaterialLotId = await receiveAndConsume(runId, 'LOT-MP-RECL-001');
    const cycleId = await newCycle(runId);
    const batchId = await newPackagingBatch(runId, cycleId);
    const lot = await newFinishedGoodLot(batchId, runId, cycleId);
    const palletId = await newPallet(lot.id, 60, 720);
    await releaseFgQuality('FINISHED_GOOD_LOT', lot.id);
    await releaseFgQuality('PALLET', palletId);

    const shipmentId = await newShipment('CONT-RECL-001');
    await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/palettes`,
      headers: { cookie: stockCookie },
      payload: { palletId },
    });
    await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/confirmation`,
      headers: { cookie: stockCookie },
    });

    const complaint = await context.app.inject({
      method: 'POST',
      url: '/api/complaints',
      headers: { cookie: qualiteCookie },
      payload: {
        receivedAt: new Date().toISOString(),
        customerId: context.fixtures.customerId,
        shipmentId,
        finishedGoodLotId: lot.id,
        palletId: null,
        complaintType: 'QUALITE',
        description: 'Odeur inhabituelle signalée par le client.',
        severity: 'MAJEURE',
        ownerUserId: null,
      },
    });
    assert.equal(complaint.statusCode, 201, complaint.body);
    const complaintId = (complaint.json() as { id: string }).id;

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/complaints/${complaintId}`,
      headers: { cookie: qualiteCookie },
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const payload = detail.json() as {
      traceability: readonly {
        palletCode: string;
        finishedGoodLotCode: string;
        runCode: string;
        cycleCode: string;
        rawMaterialLotCode: string;
      }[];
    };
    assert.equal(payload.traceability.length, 1);
    assert.equal(payload.traceability[0]?.finishedGoodLotCode, lot.lotCode);
    assert.equal(payload.traceability[0]?.rawMaterialLotCode, 'LOT-MP-RECL-001');
    void rawMaterialLotId;

    const ncrFromComplaint = await context.app.inject({
      method: 'POST',
      url: `/api/complaints/${complaintId}/non-conformite`,
      headers: { cookie: qualiteCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Réclamation client - odeur',
        description: 'Investiguer la cause.',
        severity: 'MAJEURE',
        ownerUserId: null,
      },
    });
    assert.equal(ncrFromComplaint.statusCode, 201, ncrFromComplaint.body);
    const ncrId = (ncrFromComplaint.json() as { id: string }).id;

    const ncrDetail = await context.app.inject({
      method: 'GET',
      url: `/api/nonconformities/${ncrId}`,
      headers: { cookie: qualiteCookie },
    });
    const ncrPayload = ncrDetail.json() as { nonconformity: { sourceType: string | null; sourceId: string | null } };
    assert.equal(ncrPayload.nonconformity.sourceType, 'CUSTOMER_COMPLAINT');
    assert.equal(ncrPayload.nonconformity.sourceId, complaintId);
  });

  it('un exercice de traçabilité depuis un lot MP retrouve les runs/cycles/lots PF/palettes/expéditions/clients affectés, calculé et jamais saisi à la main (sections 32-36, 61)', async () => {
    const runId = await newRun();
    const rawMaterialLotId = await receiveAndConsume(runId, 'LOT-MP-001');
    const cycleId = await newCycle(runId);
    const batchId = await newPackagingBatch(runId, cycleId);
    const lot = await newFinishedGoodLot(batchId, runId, cycleId);
    const palletId = await newPallet(lot.id, 60, 720);
    await releaseFgQuality('FINISHED_GOOD_LOT', lot.id);
    await releaseFgQuality('PALLET', palletId);

    const shipmentId = await newShipment('CONT-RECALL-001');
    await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/palettes`,
      headers: { cookie: stockCookie },
      payload: { palletId },
    });
    await context.app.inject({
      method: 'POST',
      url: `/api/shipments/${shipmentId}/confirmation`,
      headers: { cookie: stockCookie },
    });

    // A routine traceability exercise is recall:exercise (QUALITE); STOCK
    // does not hold it (section 53/54).
    const forbidden = await context.app.inject({
      method: 'POST',
      url: '/api/recall-events',
      headers: { cookie: stockCookie },
      payload: {
        eventType: 'EXERCICE_TRACABILITE',
        targetEntityType: 'RAW_MATERIAL_LOT',
        targetEntityId: rawMaterialLotId,
        reason: 'Exercice annuel de traçabilité.',
        severity: 'MINEURE',
        scopeDescription: null,
      },
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const started = new Date();
    const recall = await context.app.inject({
      method: 'POST',
      url: '/api/recall-events',
      headers: { cookie: qualiteCookie },
      payload: {
        eventType: 'EXERCICE_TRACABILITE',
        targetEntityType: 'RAW_MATERIAL_LOT',
        targetEntityId: rawMaterialLotId,
        reason: 'EXERCICE DE TRACABILITE',
        severity: 'MINEURE',
        scopeDescription: null,
      },
    });
    assert.equal(recall.statusCode, 201, recall.body);
    const { id: recallId } = recall.json() as { id: string; recallCode: string; affectedCount: number };

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/recall-events/${recallId}`,
      headers: { cookie: qualiteCookie },
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const payload = detail.json() as {
      affected: readonly { entityType: string; entityId: string; impactType: string }[];
    };
    const byType = (entityType: string) => payload.affected.filter((row) => row.entityType === entityType);
    assert.equal(byType('RAW_MATERIAL_LOT').length, 1);
    assert.equal(byType('RAW_MATERIAL_LOT')[0]?.impactType, 'ORIGINE');
    assert.equal(byType('PRODUCTION_RUN').length, 1);
    assert.equal(byType('PRODUCTION_RUN')[0]?.entityId, runId);
    assert.equal(byType('STERILIZATION_CYCLE')[0]?.entityId, cycleId);
    assert.equal(byType('FINISHED_GOOD_LOT')[0]?.entityId, lot.id);
    assert.equal(byType('PALLET')[0]?.entityId, palletId);
    assert.equal(byType('SHIPMENT')[0]?.entityId, shipmentId);
    assert.equal(byType('CUSTOMER').length, 1);

    const close = await context.app.inject({
      method: 'POST',
      url: `/api/recall-events/${recallId}/cloture`,
      headers: { cookie: qualiteCookie },
      payload: { observations: 'Exercice terminé avec succès.' },
    });
    assert.equal(close.statusCode, 200, close.body);

    const closedEvent = await context.pool.query<{ opened_at: Date; closed_at: Date | null }>(
      'SELECT opened_at, closed_at FROM recall_events WHERE id = $1',
      [recallId],
    );
    assert.ok(closedEvent.rows[0]?.closed_at);
    assert.ok((closedEvent.rows[0]?.closed_at as Date).getTime() >= started.getTime());

    const massBalance = await context.app.inject({
      method: 'GET',
      url: `/api/finished-good-lots/${lot.id}/bilan-matiere`,
      headers: { cookie: qualiteCookie },
    });
    assert.equal(massBalance.statusCode, 200, massBalance.body);
    const balance = massBalance.json() as { producedCartons: number; shippedCartons: number };
    assert.equal(balance.shippedCartons, 60);
  });

  it("un audit interne : l'auditeur assigné consigne réponses et constats, un constat majeur crée une non-conformité (sections 21-24, 62)", async () => {
    const forbiddenPlan = await context.app.inject({
      method: 'POST',
      url: '/api/audits',
      headers: { cookie: auditeurCookie },
      payload: {
        auditType: 'INTERNE',
        title: 'Audit hygiène interne',
        auditChecklistId: context.fixtures.auditChecklistId,
        plannedDate: new Date().toISOString().slice(0, 10),
        scope: 'Ligne 1',
        leadAuditorUserId: context.fixtures.users.AUDITEUR,
        notes: null,
      },
    });
    assert.equal(forbiddenPlan.statusCode, 403, forbiddenPlan.body);

    const audit = await context.app.inject({
      method: 'POST',
      url: '/api/audits',
      headers: { cookie: qualiteCookie },
      payload: {
        auditType: 'INTERNE',
        title: 'Audit hygiène interne',
        auditChecklistId: context.fixtures.auditChecklistId,
        plannedDate: new Date().toISOString().slice(0, 10),
        scope: 'Ligne 1',
        leadAuditorUserId: context.fixtures.users.AUDITEUR,
        notes: null,
      },
    });
    assert.equal(audit.statusCode, 201, audit.body);
    const auditId = (audit.json() as { id: string }).id;

    const start = await context.app.inject({
      method: 'POST',
      url: `/api/audits/${auditId}/demarrage`,
      headers: { cookie: auditeurCookie },
    });
    assert.equal(start.statusCode, 200, start.body);

    const [itemOneId] = context.fixtures.auditChecklistItemIds;
    const response = await context.app.inject({
      method: 'POST',
      url: `/api/audits/${auditId}/reponses`,
      headers: { cookie: auditeurCookie },
      payload: { checklistItemId: itemOneId, result: 'NON_CONFORME', observation: 'Zone mal nettoyée.', evidenceReference: null },
    });
    assert.equal(response.statusCode, 201, response.body);

    const finding = await context.app.inject({
      method: 'POST',
      url: `/api/audits/${auditId}/constats`,
      headers: { cookie: auditeurCookie },
      payload: {
        findingType: 'NON_CONFORMITE',
        description: 'Nettoyage insuffisant en fin de poste.',
        severity: 'MAJEURE',
        ownerUserId: null,
        dueAt: null,
      },
    });
    assert.equal(finding.statusCode, 201, finding.body);
    const findingId = (finding.json() as { id: string }).id;

    const ncrFromFinding = await context.app.inject({
      method: 'POST',
      url: `/api/audit-findings/${findingId}/non-conformite`,
      headers: { cookie: auditeurCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Constat audit - nettoyage',
        severity: 'MAJEURE',
        ownerUserId: null,
      },
    });
    assert.equal(ncrFromFinding.statusCode, 201, ncrFromFinding.body);

    const complete = await context.app.inject({
      method: 'POST',
      url: `/api/audits/${auditId}/cloture`,
      headers: { cookie: auditeurCookie },
    });
    assert.equal(complete.statusCode, 200, complete.body);

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/audits/${auditId}`,
      headers: { cookie: qualiteCookie },
    });
    const payload = detail.json() as {
      audit: { status: string; openFindingCount: number };
      findings: readonly { resultingNonconformityId: string | null }[];
    };
    assert.equal(payload.audit.status, 'TERMINE');
    assert.ok(payload.findings[0]?.resultingNonconformityId);
    // Audit execution status and finding follow-up status are two different
    // things (section 7.7): an audit can be TERMINE while its finding is
    // still open - this is what the "Audit terminé - N actions ouvertes"
    // UI wording relies on, never silently implying everything is closed.
    // (Also a numeric-typing regression test: audit_progress's COUNT(*)
    // columns must be cast to ::integer, or the pg driver returns them as
    // strings and this comparison would silently fail.)
    assert.equal(payload.audit.openFindingCount, 1);

    const listing = await context.app.inject({
      method: 'GET',
      url: '/api/audits',
      headers: { cookie: qualiteCookie },
    });
    const auditRow = (listing.json() as readonly { id: string; status: string; openFindingCount: number }[]).find(
      (row) => row.id === auditId,
    );
    assert.equal(auditRow?.status, 'TERMINE');
    assert.equal(auditRow?.openFindingCount, 1);
  });

  it('une transition de statut de non-conformité invalide est refusée (section 7.1)', async () => {
    const lotId = await newRawMaterialLot('LOT-MP-NCR-004');
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/nonconformities',
      headers: { cookie: qualiteCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        sourceType: 'RAW_MATERIAL_LOT',
        sourceId: lotId,
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Test transition',
        description: 'Test transition de statut.',
        severity: 'MINEURE',
        priority: 'NORMALE',
        ownerUserId: null,
        dueAt: null,
        qualityBlockRequired: false,
        links: [],
      },
    });
    const ncrId = (created.json() as { id: string }).id;

    // A fresh OUVERTE record can never jump straight to CLOTUREE.
    const invalid = await context.app.inject({
      method: 'POST',
      url: `/api/nonconformities/${ncrId}/statut`,
      headers: { cookie: qualiteCookie },
      payload: { status: 'CLOTUREE', reason: null },
    });
    assert.equal(invalid.statusCode, 409, invalid.body);
    assert.match((invalid.json() as { message: string }).message, /Transition de statut invalide/);

    // Nor can it jump to ACTION_REQUISE, skipping the investigation step.
    const skipped = await context.app.inject({
      method: 'POST',
      url: `/api/nonconformities/${ncrId}/statut`,
      headers: { cookie: qualiteCookie },
      payload: { status: 'ACTION_REQUISE', reason: null },
    });
    assert.equal(skipped.statusCode, 409, skipped.body);

    // The one allowed next step succeeds.
    const valid = await context.app.inject({
      method: 'POST',
      url: `/api/nonconformities/${ncrId}/statut`,
      headers: { cookie: qualiteCookie },
      payload: { status: 'EN_ANALYSE', reason: null },
    });
    assert.equal(valid.statusCode, 200, valid.body);
  });

  it("une non-conformité critique avec une priorité basse exige une confirmation explicite (section 7.3)", async () => {
    const lotId = await newRawMaterialLot('LOT-MP-NCR-005');
    const attempt = await context.app.inject({
      method: 'POST',
      url: '/api/nonconformities',
      headers: { cookie: qualiteCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        sourceType: 'RAW_MATERIAL_LOT',
        sourceId: lotId,
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Anomalie critique',
        description: 'Gravité critique avec priorité basse (test).',
        severity: 'CRITIQUE',
        priority: 'BASSE',
        ownerUserId: null,
        dueAt: null,
        qualityBlockRequired: false,
        links: [],
      },
    });
    assert.equal(attempt.statusCode, 409, attempt.body);
    assert.equal((attempt.json() as { code: string }).code, 'CONFIRMATION_REQUISE');

    const confirmed = await context.app.inject({
      method: 'POST',
      url: '/api/nonconformities',
      headers: { cookie: qualiteCookie },
      payload: {
        detectedAt: new Date().toISOString(),
        sourceType: 'RAW_MATERIAL_LOT',
        sourceId: lotId,
        categoryId: context.fixtures.nonconformityCategoryId,
        title: 'Anomalie critique',
        description: 'Gravité critique avec priorité basse (test).',
        severity: 'CRITIQUE',
        priority: 'BASSE',
        ownerUserId: null,
        dueAt: null,
        qualityBlockRequired: false,
        links: [],
        confirmSeverityPriority: true,
      },
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
  });

  it('un CAPA en retard est détecté correctement et remonte dans le tableau de bord qualité (section 7.4)', async () => {
    const pastDue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const capa = await context.app.inject({
      method: 'POST',
      url: '/api/capa',
      headers: { cookie: qualiteCookie },
      payload: {
        sourceNonconformityId: null,
        title: 'CAPA en retard (test)',
        description: 'Test de détection de retard.',
        capaType: 'PREVENTIVE',
        priority: 'HAUTE',
        ownerUserId: context.fixtures.users.QUALITE,
        openedAt: pastDue,
        dueAt: pastDue,
        effectivenessRequired: false,
      },
    });
    assert.equal(capa.statusCode, 201, capa.body);
    const capaId = (capa.json() as { id: string }).id;

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/capa/${capaId}`,
      headers: { cookie: qualiteCookie },
    });
    assert.equal((detail.json() as { capa: { isOverdue: boolean } }).capa.isOverdue, true);

    const summary = await context.app.inject({
      method: 'GET',
      url: '/api/qms/home-summary',
      headers: { cookie: qualiteCookie },
    });
    assert.ok((summary.json() as { overdueCapa: number }).overdueCapa >= 1);
  });
});
