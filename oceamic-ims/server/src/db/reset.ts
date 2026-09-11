import { loadConfig } from '../config.ts';
import { createPool } from './pool.ts';
import { runMigrations } from './migrate.ts';

/**
 * Drops and rebuilds the whole schema. Development and test databases only:
 * it refuses to run when NODE_ENV is production.
 */
const config = loadConfig(process.env);

if (config.nodeEnv === 'production') {
  throw new Error("db:reset est interdit en production.");
}

const pool = createPool(config.databaseUrl);
try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const executed = await runMigrations(pool);
  console.log(`Schéma réinitialisé. Migrations appliquées: ${executed.join(', ')}`);
} finally {
  await pool.end();
}
