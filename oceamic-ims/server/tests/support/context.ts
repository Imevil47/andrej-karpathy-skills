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
  // Phase 8: ingredients, consumables, oil tracking, consumption and
  // recovery - most dependent tables first, mirroring the rest of this list.
  'ingredient_consumption_standards',
  'recovered_ingredient_reuse',
  'recovered_ingredient_batches',
  'ingredient_reuse_policies',
  'ingredient_containers',
  'process_utility_consumptions',
  'production_run_ingredient_consumptions',
  'tank_measurements',
  'tank_batch_inputs',
  'tank_batches',
  'ingredient_tanks',
  'ingredient_stock_movements',
  'ingredient_lots',
  'ingredients',
  'ingredient_loss_reasons',
  'ingredient_types',
  // Phase 7: maintenance / CMMS - most dependent tables first, mirroring
  // the rest of this list.
  'maintenance_part_usage',
  'spare_part_stock_movements',
  'spare_parts',
  'preventive_task_checklist_responses',
  'preventive_tasks',
  'maintenance_plan_checklist_items',
  'maintenance_plans',
  'maintenance_interventions',
  'maintenance_work_orders',
  'failure_reports',
  'failure_causes',
  'failure_modes',
  // Phase 6: horizontal QMS - most dependent tables first, mirroring the
  // rest of this list.
  'recall_affected_entities',
  'recall_events',
  'document_acknowledgments',
  'quality_document_revisions',
  'quality_documents',
  'audit_findings',
  'audit_responses',
  'audit_checklist_items',
  'audit_checklists',
  'audits',
  'capa_effectiveness_checks',
  'capa_actions',
  'capa_records',
  'customer_complaints',
  'supplier_quality_incidents',
  'root_cause_analyses',
  'nonconformity_investigations',
  'nonconformity_links',
  'nonconformities',
  'nonconformity_categories',
  // Phase 5: packaging, finished goods, pallets, PF stock, shipments - most
  // dependent tables first, mirroring the rest of this list.
  'stock_reservations',
  'shipment_lines',
  'shipments',
  'customers',
  'finished_goods_quality_blocks',
  'finished_goods_quality_decisions',
  'finished_goods_stock_movements',
  'pallet_contents',
  'pallets',
  'packaging_label_checks',
  'packaging_outputs',
  'finished_good_lot_sources',
  'finished_good_lots',
  'packaging_batches',
  'audit_log',
  'employee_cadence_controls',
  'line_controls',
  'control_rounds',
  'production_run_employee_assignments',
  'downtime_events',
  'downtime_categories',
  'cadence_standards',
  'employees',
  'process_corrective_actions',
  'process_deviations',
  'cooling_measurements',
  'cooling_events',
  'ccp_controls',
  'sterilization_measurements',
  'production_run_holds',
  'sterilization_cycle_loads',
  'sterilization_cycles',
  'sterilization_programs',
  'marking_event_checks',
  'marking_events',
  'marking_verification_items',
  'seaming_measurements',
  'seaming_controls',
  'seaming_specifications',
  'seaming_parameters',
  'seaming_operations',
  'filling_weight_samples',
  'filling_weight_controls',
  'product_filling_specs',
  'filling_operations',
  'filling_media',
  'equipment',
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
  autoclave1Id: string;
  autoclave2Id: string;
  sertisseuse1Id: string;
  fillingMediumId: string;
  fillingSpecId: string;
  seamingParameterEpaisseurId: string;
  seamingParameterCrochetId: string;
  seamingSpecEpaisseurId: string;
  sterilizationProgramId: string;
  markingItemIds: readonly string[];
  stockPfALocationId: string;
  customerId: string;
  nonconformityCategoryId: string;
  auditChecklistId: string;
  auditChecklistItemIds: readonly string[];
  sertisseuse2Id: string;
  failureModeBourrageId: string;
  failureCauseDefautPieceId: string;
  sparePartId: string;
  ingredientLocationId: string;
  tankLocationId: string;
  ingredientTypeHuileId: string;
  ingredientHuileId: string;
  ingredientLossReasonId: string;
  ingredientTankId: string;
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
  const roles: readonly RoleCode[] = [
    'ADMIN',
    'QUALITE',
    'STOCK',
    'PRODUCTION',
    'LECTURE',
    'RESPONSABLE_QUALITE',
    'AUDITEUR',
    'MAINTENANCE',
    'RESPONSABLE_MAINTENANCE',
  ];
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
    `INSERT INTO locations (code, name, stock_type, location_type, stock_domain)
     VALUES ('OCEAMIC-2', 'OCEAMIC 2', 'INTERNE', 'USINE', 'MP'),
            ('DAMSA', 'DAMSA', 'EXTERNE', 'ENTREPOT', 'MP'),
            ('SARMA', 'SARMA', 'EXTERNE', 'SOUS_TRAITANT', 'MP'),
            ('STOCK-PF-A', 'Stock PF A', 'INTERNE', 'ENTREPOT', 'PF'),
            ('MAGASIN-INGREDIENTS-TEST', 'Magasin ingrédients (test)', 'INTERNE', 'ENTREPOT', 'INGREDIENT'),
            ('ZONE-CUVES-TEST', 'Zone des cuves (test)', 'INTERNE', 'USINE', 'INGREDIENT')
     RETURNING id, code`,
  );
  const customer = await pool.query<{ id: string }>(
    `INSERT INTO customers (code, name, country, city) VALUES ('CLIENT-TEST', 'Client Test', 'France', 'Marseille')
     RETURNING id`,
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

  const equipment = await pool.query<{ id: string; code: string }>(
    `INSERT INTO equipment (code, name, equipment_type, criticality)
     VALUES ('AUTOCLAVE-1', 'Autoclave 1', 'AUTOCLAVE', 'CRITIQUE'),
            ('AUTOCLAVE-2', 'Autoclave 2', 'AUTOCLAVE', 'CRITIQUE'),
            ('SERT-1', 'Sertisseuse 1', 'SERTISSEUSE', 'MOYENNE'),
            ('SERT-2', 'Sertisseuse 2', 'SERTISSEUSE', 'HAUTE')
     RETURNING id, code`,
  );
  const failureMode = await pool.query<{ id: string }>(
    `INSERT INTO failure_modes (code, name) VALUES ('BOURRAGE', 'Bourrage') RETURNING id`,
  );
  const failureCause = await pool.query<{ id: string }>(
    `INSERT INTO failure_causes (code, name) VALUES ('DEFAUT_PIECE', 'Défaut de pièce') RETURNING id`,
  );
  const sparePart = await pool.query<{ id: string }>(
    `INSERT INTO spare_parts (part_code, name, minimum_stock, created_by)
     VALUES ('BRG-TEST', 'Roulement test', 2, $1) RETURNING id`,
    [users.ADMIN],
  );
  const fillingMedium = await pool.query<{ id: string }>(
    `INSERT INTO filling_media (code, name) VALUES ('HUILE_OLIVE', 'Huile olive') RETURNING id`,
  );
  const fillingSpec = await pool.query<{ id: string }>(
    `INSERT INTO product_filling_specs (product_id, format, min_weight_g, max_weight_g)
     VALUES ($1, 'CLUB', 120, 130)
     RETURNING id`,
    [productSardineId],
  );
  const seamingParameters = await pool.query<{ id: string; code: string }>(
    `INSERT INTO seaming_parameters (code, name, default_unit)
     VALUES ('EPAISSEUR', 'Épaisseur', 'MM'), ('CROCHET_CORPS', 'Crochet corps', 'MM')
     RETURNING id, code`,
  );
  const seamingParameterEpaisseurId =
    seamingParameters.rows.find((row) => row.code === 'EPAISSEUR')?.id ?? '';
  const seamingSpec = await pool.query<{ id: string }>(
    `INSERT INTO seaming_specifications (seaming_parameter_id, product_id, min_value, max_value, unit)
     VALUES ($1, $2, 0.090, 0.110, 'MM')
     RETURNING id`,
    [seamingParameterEpaisseurId, productSardineId],
  );
  const sterilizationProgram = await pool.query<{ id: string }>(
    `INSERT INTO sterilization_programs (code, name, product_id, target_f0, minimum_f0, maximum_f0)
     VALUES ('STE-TEST', 'Barème test', $1, 8, 6, 12)
     RETURNING id`,
    [productSardineId],
  );
  const markingItems = await pool.query<{ id: string }>(
    `INSERT INTO marking_verification_items (code, name)
     VALUES ('CODE_LISIBLE', 'Code lisible'), ('CODE_CORRECT', 'Code correct')
     RETURNING id`,
  );

  const nonconformityCategory = await pool.query<{ id: string }>(
    `INSERT INTO nonconformity_categories (code, name) VALUES ('POIDS', 'Poids') RETURNING id`,
  );
  const auditChecklist = await pool.query<{ id: string }>(
    `INSERT INTO audit_checklists (code, name, audit_type) VALUES ('CHK-TEST', 'Checklist test', 'HYGIENE')
     RETURNING id`,
  );
  const auditChecklistId = auditChecklist.rows[0]?.id ?? '';
  const auditChecklistItems = await pool.query<{ id: string }>(
    `INSERT INTO audit_checklist_items (audit_checklist_id, display_order, question)
     VALUES ($1, 1, 'Question test 1'), ($1, 2, 'Question test 2')
     RETURNING id`,
    [auditChecklistId],
  );

  // Phase 8: ingredients, oil tracking, consumption and recovery - minimal
  // master data (one recoverable oil ingredient, one tank, one loss reason,
  // the global reuse policy).
  const ingredientLocationId = locations.rows.find((row) => row.code === 'MAGASIN-INGREDIENTS-TEST')?.id ?? '';
  const tankLocationId = locations.rows.find((row) => row.code === 'ZONE-CUVES-TEST')?.id ?? '';
  const ingredientType = await pool.query<{ id: string }>(
    `INSERT INTO ingredient_types (code, name) VALUES ('HUILE_TEST', 'Huile test') RETURNING id`,
  );
  const ingredientTypeHuileId = ingredientType.rows[0]?.id ?? '';
  const ingredient = await pool.query<{ id: string }>(
    `INSERT INTO ingredients (ingredient_code, name, ingredient_type_id, default_unit, filling_medium_id, is_recoverable)
     VALUES ('HUILE-TEST', 'Huile test', $1, 'L', $2, TRUE)
     RETURNING id`,
    [ingredientTypeHuileId, fillingMedium.rows[0]?.id ?? null],
  );
  const ingredientLossReason = await pool.query<{ id: string }>(
    `INSERT INTO ingredient_loss_reasons (code, name) VALUES ('DEVERSEMENT', 'Déversement') RETURNING id`,
  );
  const ingredientTank = await pool.query<{ id: string }>(
    `INSERT INTO ingredient_tanks (tank_code, name, ingredient_type_id, capacity_liters, location_id)
     VALUES ('CUVE-TEST', 'Cuve test', $1, 1000, $2)
     RETURNING id`,
    [ingredientTypeHuileId, tankLocationId],
  );
  await pool.query(
    `INSERT INTO ingredient_reuse_policies (ingredient_type_id, max_reuse_hours, allow_mixing) VALUES (NULL, 48, FALSE)`,
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
    autoclave1Id: equipment.rows.find((row) => row.code === 'AUTOCLAVE-1')?.id ?? '',
    autoclave2Id: equipment.rows.find((row) => row.code === 'AUTOCLAVE-2')?.id ?? '',
    sertisseuse1Id: equipment.rows.find((row) => row.code === 'SERT-1')?.id ?? '',
    fillingMediumId: fillingMedium.rows[0]?.id ?? '',
    fillingSpecId: fillingSpec.rows[0]?.id ?? '',
    seamingParameterEpaisseurId,
    seamingParameterCrochetId: seamingParameters.rows.find((row) => row.code === 'CROCHET_CORPS')?.id ?? '',
    seamingSpecEpaisseurId: seamingSpec.rows[0]?.id ?? '',
    sterilizationProgramId: sterilizationProgram.rows[0]?.id ?? '',
    markingItemIds: markingItems.rows.map((row) => row.id),
    stockPfALocationId: locations.rows.find((row) => row.code === 'STOCK-PF-A')?.id ?? '',
    customerId: customer.rows[0]?.id ?? '',
    nonconformityCategoryId: nonconformityCategory.rows[0]?.id ?? '',
    auditChecklistId,
    auditChecklistItemIds: auditChecklistItems.rows.map((row) => row.id),
    sertisseuse2Id: equipment.rows.find((row) => row.code === 'SERT-2')?.id ?? '',
    failureModeBourrageId: failureMode.rows[0]?.id ?? '',
    failureCauseDefautPieceId: failureCause.rows[0]?.id ?? '',
    sparePartId: sparePart.rows[0]?.id ?? '',
    ingredientLocationId,
    tankLocationId,
    ingredientTypeHuileId,
    ingredientHuileId: ingredient.rows[0]?.id ?? '',
    ingredientLossReasonId: ingredientLossReason.rows[0]?.id ?? '',
    ingredientTankId: ingredientTank.rows[0]?.id ?? '',
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
