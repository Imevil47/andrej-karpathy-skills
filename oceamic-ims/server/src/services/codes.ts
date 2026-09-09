import type { DatabaseClient } from '../db/pool.ts';

export type CodePrefix =
  | 'LOT'
  | 'REC'
  | 'MVT'
  | 'ST'
  | 'INS'
  | 'RUN'
  | 'CTRL'
  | 'RMP'
  | 'CP'
  | 'SRT'
  | 'STE'
  | 'DEV'
  | 'EMB'
  | 'PF'
  | 'PAL'
  | 'MVP'
  | 'EXP'
  | 'NC'
  | 'CAPA'
  | 'RECL'
  | 'INC'
  | 'AUD'
  | 'CST'
  | 'RAP'
  | 'PAN'
  | 'OT'
  | 'MP';

const CODE_WIDTH: Readonly<Record<CodePrefix, number>> = {
  LOT: 3,
  REC: 3,
  MVT: 5,
  ST: 3,
  INS: 3,
  RUN: 3,
  CTRL: 3,
  // Filling operation. RMP (remplissage), never ST: ST is already the
  // subcontracting operation prefix (section 6 deviation).
  RMP: 3,
  // Filling weight control (section 18: "CP-20260908-001").
  CP: 3,
  // Seaming operation (section 20).
  SRT: 3,
  // Sterilization cycle. STE, never ST for the same reason as RMP above: the
  // spec's own example ("ST-20260908-003", section 51) collides with the
  // existing subcontracting prefix, so a distinct one is used instead
  // (section 27 deviation).
  STE: 3,
  // Process deviation (section 37).
  DEV: 3,
  // Packaging batch (section 4).
  EMB: 3,
  // Finished Goods Lot (section 6: "PF-20260908-001").
  PF: 3,
  // Pallet (section 11: "PAL-20260908-001").
  PAL: 3,
  // Finished Goods stock movement. MVP, never MVT: MVT is already the
  // raw-material movement prefix, and the two ledgers are deliberately
  // separate registries (section 15).
  MVP: 5,
  // Shipment (section 21).
  EXP: 3,
  // Phase 6: horizontal QMS.
  // Non-conformity (section 4: "NC-20260909-001").
  NC: 3,
  // CAPA record (section 63: "NC-20260909-001" sources a CAPA - the CAPA
  // itself gets its own, distinct prefix).
  CAPA: 3,
  // Customer complaint. RECL (réclamation), never REC: REC is already the
  // Phase 1 reception prefix.
  RECL: 3,
  // Supplier quality incident.
  INC: 3,
  // Audit.
  AUD: 3,
  // Audit finding. CST (constat).
  CST: 3,
  // Recall / withdrawal / traceability exercise event (section 31). RAP
  // covers all three event_type values - they share one identity space.
  RAP: 3,
  // Phase 7: maintenance / CMMS.
  // Failure report. PAN (panne), never AVR or DEF: PAN is unambiguous and
  // matches the French vocabulary used throughout the module.
  PAN: 3,
  // Maintenance work order ("OT-20260909-001" per section 65's example).
  OT: 3,
  // Preventive maintenance plan.
  MP: 3,
};

/**
 * Generates the next readable operational code (LOT-20260907-001).
 * The counter row is locked inside the caller's transaction, so two concurrent
 * operations can never receive the same code.
 */
export async function nextOperationalCode(
  client: DatabaseClient,
  prefix: CodePrefix,
  day: Date,
): Promise<string> {
  const result = await client.query<{ code: string }>(
    'SELECT next_operational_code($1, $2::date, $3) AS code',
    [prefix, day, CODE_WIDTH[prefix]],
  );
  const code = result.rows[0]?.code;
  if (!code) {
    throw new Error(`Generation du code ${prefix} impossible.`);
  }
  return code;
}
