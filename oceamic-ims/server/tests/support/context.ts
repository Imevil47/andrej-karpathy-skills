import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../../src/app.ts';
import { loadConfig, type AppConfig } from '../../src/config.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { createPool } from '../../src/db/pool.ts';
import type { RoleCode } from '../../src/domain/types.ts';
import { hashPassword } from '../../src/services/auth.ts';

// Tests run against a real PostgreSQL database: the business rules under test
// live in transactions, constraints and locks, which mocks cannot exercise.

const TABLES_IN_TRUNCATION_ORDER = [
  'audit_log',
  'employee_cadence_controls',
  'line_controls',
  'control_rounds',
  'production_run_employee_assignments',
  'downtime_events',
  'downtime_categories',
  'cadence_standards',
  'employees',
  'production_outputs',
  'production_run_materials',
  'production_run_lines',
  'production_runs',
  'production_loss_reasons',
  'production_stages',
  'production_lines',
  'products',
  'subcontracting_results',
  'subcontracting_operations',
  'lot_blocks',
  'quality_decisions',
  'quality_inspections',
  'stock_movements',
  'raw_material_receptions',
  'raw_material_lots',
  'subcontractors',
  'locations',
  'vessels',
  'suppliers',
  'species',
  'users',
  'roles',
  'code_counters',
];

export type Fixtures = Readonly<{
  users: Readonly<Record<RoleCode, string>>;
  speciesSardineId: string;
  speciesThonId: string;
  supplierId: string;
  oceamic2Id: string;
  damsaId: string;
  sarmaLocationId: string;
  sarmaSubcontractorId: string;
  productSardineId: string;
  productThonId: string;
  lineL1Id: string;
  lineL2Id: string;
  fillingStageId: string;
  lossReasonId: string;
  byProductReasonId: string;
  employeeNumbers: readonly string[];
  cadenceStandardId: string;
  downtimeCategoryId: string;
}>;

export type TestContext = Readonly<{
  app: FastifyInstance;
  pool: pg.Pool;
  fixtures: Fixtures;
  login: (username: string) => Promise<string>;
  close: () => Promise<void>;
}>;

function testConfig(): AppConfig {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL est requis pour exécuter les tests (voir server/.env.example).',
    );
  }
  return loadConfig({
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'secret-de-test-oceamic-ims',
    PORT: '3001',
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    WEB_ORIGIN: 'http://localhost:5173',
  });
}

async function insertFixtures(pool: pg.Pool): Promise<Fixtures> {
  const roles: readonly RoleCode[] = ['ADMIN', 'QUALITE', 'STOCK', 'PRODUCTION', 'LECTURE'];
  const passwordHash = await hashPassword('test1234');
  const users: Record<string, string> = {};

  for (const role of roles) {
    const insertedRole = await pool.query<{ id: string }>(
      'INSERT INTO roles (code, name) VALUES ($1, $2) RETURNING id',
      [role, role],
    );
    const insertedUser = await pool.query<{ id: string }>(
      `INSERT INTO users (username, full_name, password_hash, role_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [role.toLowerCase(), `Utilisateur ${role}`, passwordHash, insertedRole.rows[0]?.id],
    );
    users[role] = insertedUser.rows[0]?.id ?? '';
  }

  const species = await pool.query<{ id: string; code: string }>(
    `INSERT INTO species (code, name) VALUES ('SARDINE', 'Sardine'), ('THON', 'Thon')
     RETURNING id, code`,
  );
  const supplier = await pool.query<{ id: string }>(
    `INSERT INTO suppliers (code, name) VALUES ('FRN-TEST', 'Fournisseur test') RETURNING id`,
  );
  const locations = await pool.query<{ id: string; code: string }>(
    `INSERT INTO locations (code, name, stock_type, location_type)
     VALUES ('OCEAMIC-2', 'OCEAMIC 2', 'INTERNE', 'USINE'),
            ('DAMSA', 'DAMSA', 'EXTERNE', 'ENTREPOT'),
            ('SARMA', 'SARMA', 'EXTERNE', 'SOUS_TRAITANT')
     RETURNING id, code`,
  );
  const sarmaLocationId = locations.rows.find((row) => row.code === 'SARMA')?.id ?? '';
  const subcontractor = await pool.query<{ id: string }>(
    `INSERT INTO subcontractors (code, name, location_id) VALUES ('SARMA', 'SARMA', $1) RETURNING id`,
    [sarmaLocationId],
  );

  const speciesSardineId = species.rows.find((row) => row.code === 'SARDINE')?.id ?? '';
  const speciesThonId = species.rows.find((row) => row.code === 'THON')?.id ?? '';

  const products = await pool.query<{ id: string; code: string }>(
    `INSERT INTO products (code, name, species_id, format, pieces_per_can)
     VALUES ('SPSA-HO', 'Sardine huile olive', $1, 'CLUB', 4),
            ('THON-NAT', 'Thon naturel', $2, '1/4', 1)
     RETURNING id, code`,
    [speciesSardineId, speciesThonId],
  );
  const lines = await pool.query<{ id: string; code: string }>(
    `INSERT INTO production_lines (code, name, display_order)
     VALUES ('L1', 'Ligne 1', 1), ('L2', 'Ligne 2', 2)
     RETURNING id, code`,
  );
  const stages = await pool.query<{ id: string; code: string }>(
    `INSERT INTO production_stages (code, name, display_order)
     VALUES ('REMPLISSAGE', 'Remplissage', 1)
     RETURNING id, code`,
  );
  const reasons = await pool.query<{ id: string; code: string }>(
    `INSERT INTO production_loss_reasons (code, name, output_type)
     VALUES ('PR-MANIP', 'Casse / manipulation', 'PERTE_REELLE'),
            ('SP-TETE', 'Têtes et viscères', 'SOUS_PRODUIT')
     RETURNING id, code`,
  );

  const productSardineId = products.rows.find((row) => row.code === 'SPSA-HO')?.id ?? '';
  const employees = await pool.query<{ employee_number: string }>(
    `INSERT INTO employees (employee_number, first_name, last_name)
     VALUES ('1001', 'Amal', 'Benali'), ('1002', 'Ilham', 'Chraibi'),
            ('1003', 'Nadia', 'Fassi'), ('1004', 'Samira', 'Guerraoui')
     RETURNING employee_number`,
  );
  const cadenceStandard = await pool.query<{ id: string }>(
    `INSERT INTO cadence_standards (product_id, activity_type, measurement_unit, standard_cadence)
     VALUES ($1, 'GRATTAGE_REMPLISSAGE', 'BOITES', 120)
     RETURNING id`,
    [productSardineId],
  );
  const downtimeCategory = await pool.query<{ id: string }>(
    `INSERT INTO downtime_categories (code, name) VALUES ('PANNE_MACHINE', 'Panne machine')
     RETURNING id`,
  );

  return {
    employeeNumbers: employees.rows.map((row) => row.employee_number),
    cadenceStandardId: cadenceStandard.rows[0]?.id ?? '',
    downtimeCategoryId: downtimeCategory.rows[0]?.id ?? '',
    users: users as Record<RoleCode, string>,
    productSardineId: products.rows.find((row) => row.code === 'SPSA-HO')?.id ?? '',
    productThonId: products.rows.find((row) => row.code === 'THON-NAT')?.id ?? '',
    lineL1Id: lines.rows.find((row) => row.code === 'L1')?.id ?? '',
    lineL2Id: lines.rows.find((row) => row.code === 'L2')?.id ?? '',
    fillingStageId: stages.rows[0]?.id ?? '',
    lossReasonId: reasons.rows.find((row) => row.code === 'PR-MANIP')?.id ?? '',
    byProductReasonId: reasons.rows.find((row) => row.code === 'SP-TETE')?.id ?? '',
    speciesSardineId,
    speciesThonId,
    supplierId: supplier.rows[0]?.id ?? '',
    oceamic2Id: locations.rows.find((row) => row.code === 'OCEAMIC-2')?.id ?? '',
    damsaId: locations.rows.find((row) => row.code === 'DAMSA')?.id ?? '',
    sarmaLocationId,
    sarmaSubcontractorId: subcontractor.rows[0]?.id ?? '',
  };
}

export async function createTestContext(): Promise<TestContext> {
  const config = testConfig();
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  await pool.query(`TRUNCATE TABLE ${TABLES_IN_TRUNCATION_ORDER.join(', ')} CASCADE`);
  const fixtures = await insertFixtures(pool);
  const app = await buildApp({ pool, config });

  const login = async (username: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: 'test1234' },
    });
    if (response.statusCode !== 200) {
      throw new Error(`Connexion impossible pour ${username}: ${response.body}`);
    }
    const cookie = response.cookies.find((entry) => entry.name === 'oceamic_session');
    if (!cookie) {
      throw new Error("Cookie de session absent de la réponse de connexion.");
    }
    return `oceamic_session=${cookie.value}`;
  };

  return {
    app,
    pool,
    fixtures,
    login,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export async function stockAt(
  pool: pg.Pool,
  lotId: string,
  locationId: string,
): Promise<string> {
  const result = await pool.query<{ quantity_kg: string }>(
    `SELECT COALESCE((SELECT quantity_kg FROM current_stock_by_lot_location
                       WHERE raw_material_lot_id = $1 AND location_id = $2), 0)::numeric(14,3)
            AS quantity_kg`,
    [lotId, locationId],
  );
  return result.rows[0]?.quantity_kg ?? '0.000';
}

export async function globalStock(pool: pg.Pool, lotId: string): Promise<string> {
  const result = await pool.query<{ quantity_kg: string }>(
    `SELECT COALESCE((SELECT quantity_kg FROM current_stock_by_lot
                       WHERE raw_material_lot_id = $1), 0)::numeric(14,3) AS quantity_kg`,
    [lotId],
  );
  return result.rows[0]?.quantity_kg ?? '0.000';
}

export async function employeeIdByNumber(pool: pg.Pool, employeeNumber: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM employees WHERE employee_number = $1',
    [employeeNumber],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`Employée introuvable dans les fixtures de test: ${employeeNumber}`);
  }
  return id;
}
