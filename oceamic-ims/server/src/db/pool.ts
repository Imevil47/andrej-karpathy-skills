import pg from 'pg';

export type DatabaseClient = pg.PoolClient;

// NUMERIC values are kept as strings end to end: raw material quantities must
// never pass through a JavaScript floating point number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => value);

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

/**
 * Runs `work` inside a single database transaction. Any thrown error rolls the
 * whole business transaction back: no orphan lot, reception or movement.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
