import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.ts';
import { createPool } from './pool.ts';
import type pg from 'pg';

const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function listMigrationFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory);
  return entries.filter((entry) => entry.endsWith('.sql')).sort();
}

async function appliedMigrations(pool: pg.Pool): Promise<ReadonlySet<string>> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(128) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const result = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
}

export async function runMigrations(pool: pg.Pool): Promise<readonly string[]> {
  const files = await listMigrationFiles(MIGRATIONS_DIRECTORY);
  const already = await appliedMigrations(pool);
  const executed: string[] = [];

  for (const filename of files) {
    if (already.has(filename)) {
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIRECTORY, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      executed.push(filename);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Echec de la migration ${filename}: ${(error as Error).message}`, {
        cause: error,
      });
    } finally {
      client.release();
    }
  }

  return executed;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl);
  try {
    const executed = await runMigrations(pool);
    if (executed.length === 0) {
      console.log('Aucune migration a appliquer.');
    } else {
      console.log(`Migrations appliquees: ${executed.join(', ')}`);
    }
  } finally {
    await pool.end();
  }
}
