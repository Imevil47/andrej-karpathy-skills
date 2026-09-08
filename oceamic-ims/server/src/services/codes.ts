import type { DatabaseClient } from '../db/pool.ts';

export type CodePrefix = 'LOT' | 'REC' | 'MVT' | 'ST' | 'INS' | 'RUN' | 'CTRL';

const CODE_WIDTH: Readonly<Record<CodePrefix, number>> = {
  LOT: 3,
  REC: 3,
  MVT: 5,
  ST: 3,
  INS: 3,
  RUN: 3,
  CTRL: 3,
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
