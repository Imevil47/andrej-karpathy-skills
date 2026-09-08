import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadConfig } from '../config.ts';
import { ROLE_CODES, type RoleCode } from '../domain/types.ts';
import { hashPassword } from '../services/auth.ts';
import { decideQuality } from '../services/quality.ts';
import {
  consumeRawMaterial,
  createRun,
  recordOutput,
  startRun,
} from '../services/production.ts';
import {
  closeLineControl,
  openLineControl,
  recordEmployeeCadenceControl,
  startControlRound,
} from '../services/cadence.ts';
import { endDowntime, startDowntime } from '../services/downtime.ts';
import { createDeviation, createCorrectiveAction } from '../services/deviations.ts';
import {
  createFillingOperation,
  recordWeightSample,
  startWeightControl,
} from '../services/filling.ts';
import { createMarkingEvent, verifyMarkingEvent } from '../services/marking.ts';
import { registerReception } from '../services/receptions.ts';
import { createSeamingControl, createSeamingOperation, recordSeamingMeasurement } from '../services/seaming.ts';
import { transferStock } from '../services/stock.ts';
import { sendToSubcontractor } from '../services/subcontracting.ts';
import {
  beginSterilizationCycle,
  closeSterilizationCycle,
  createSterilizationCycle,
  endCoolingEvent,
  recordCcpControl,
  recordSterilizationMeasurement,
  startCoolingEvent,
} from '../services/sterilization.ts';
import { assignEmployeeToLine } from '../services/workforce.ts';
import { createPool, withTransaction } from './pool.ts';

// Development / demonstration data only. Never run against production data:
// the demo lots below are clearly marked as such.

const ROLE_NAMES: Readonly<Record<RoleCode, string>> = {
  ADMIN: 'Administrateur',
  QUALITE: 'Service Qualité',
  STOCK: 'Service Stock',
  PRODUCTION: 'Production',
  LECTURE: 'Lecture seule',
};

const DEMO_USERS: readonly Readonly<{
  username: string;
  fullName: string;
  role: RoleCode;
  password: string;
}>[] = [
  { username: 'admin', fullName: 'Administrateur OCEAMIC', role: 'ADMIN', password: 'admin123' },
  { username: 'qualite', fullName: 'Responsable Qualité', role: 'QUALITE', password: 'qualite123' },
  { username: 'stock', fullName: 'Responsable Stock', role: 'STOCK', password: 'stock123' },
  { username: 'production', fullName: 'Chef de Production', role: 'PRODUCTION', password: 'production123' },
  { username: 'lecture', fullName: 'Consultation', role: 'LECTURE', password: 'lecture123' },
];

const SPECIES: readonly Readonly<{ code: string; name: string }>[] = [
  { code: 'SARDINE', name: 'Sardine' },
  { code: 'MAQUEREAU', name: 'Maquereau' },
  { code: 'THON', name: 'Thon' },
];

type SeedLocation = Readonly<{
  code: string;
  name: string;
  stockType: 'INTERNE' | 'EXTERNE';
  locationType: 'USINE' | 'ENTREPOT' | 'SOUS_TRAITANT' | 'ZONE_TRANSIT' | 'AUTRE';
  isSubcontractor: boolean;
}>;

// Internal / external behaviour is configuration, never a rule derived from the
// name of the site.
const LOCATIONS: readonly SeedLocation[] = [
  { code: 'OCEAMIC-2', name: 'OCEAMIC 2', stockType: 'INTERNE', locationType: 'USINE', isSubcontractor: false },
  { code: 'OCEAMIC-1', name: 'OCEAMIC 1', stockType: 'INTERNE', locationType: 'USINE', isSubcontractor: false },
  { code: 'COFRIGOP', name: 'COFRIGOP', stockType: 'EXTERNE', locationType: 'ENTREPOT', isSubcontractor: false },
  { code: 'COFRIGOB', name: 'COFRIGOB', stockType: 'EXTERNE', locationType: 'ENTREPOT', isSubcontractor: false },
  { code: 'DAMSA', name: 'DAMSA', stockType: 'EXTERNE', locationType: 'SOUS_TRAITANT', isSubcontractor: true },
  { code: 'SARMA', name: 'SARMA', stockType: 'EXTERNE', locationType: 'SOUS_TRAITANT', isSubcontractor: true },
  { code: 'FOURSEASEN', name: 'FOURSEASEN', stockType: 'EXTERNE', locationType: 'SOUS_TRAITANT', isSubcontractor: true },
  { code: 'ATLANTIC', name: 'ATLANTIC', stockType: 'EXTERNE', locationType: 'SOUS_TRAITANT', isSubcontractor: true },
  { code: 'WILL-FISHING', name: 'WILL FISHING', stockType: 'EXTERNE', locationType: 'SOUS_TRAITANT', isSubcontractor: true },
  { code: 'KJ-FISH', name: 'KJ FISH', stockType: 'EXTERNE', locationType: 'SOUS_TRAITANT', isSubcontractor: true },
];

// Production references. A product is a commercial / production reference, it
// is never a species.
const PRODUCTS: readonly Readonly<{
  code: string;
  name: string;
  speciesCode: string;
  productFamily: string;
  format: string;
  piecesPerCan: number;
}>[] = [
  { code: 'SPSA-HO', name: 'Sardine pilchardus huile olive', speciesCode: 'SARDINE', productFamily: 'SARDINE', format: 'CLUB', piecesPerCan: 4 },
  { code: 'SPSA-HOEV-BIO', name: 'Sardine huile olive extra vierge bio', speciesCode: 'SARDINE', productFamily: 'SARDINE', format: 'CLUB', piecesPerCan: 3 },
  { code: 'FMHT', name: 'Filet de maquereau huile de tournesol', speciesCode: 'MAQUEREAU', productFamily: 'MAQUEREAU', format: '1/4', piecesPerCan: 2 },
  { code: 'FMHOEV-BIO', name: 'Filet de maquereau huile olive extra vierge bio', speciesCode: 'MAQUEREAU', productFamily: 'MAQUEREAU', format: '1/4', piecesPerCan: 2 },
];

const PRODUCTION_LINES: readonly Readonly<{ code: string; name: string; area: string }>[] = [
  { code: 'L1', name: 'Ligne 1', area: 'Atelier A' },
  { code: 'L2', name: 'Ligne 2', area: 'Atelier A' },
  { code: 'L3', name: 'Ligne 3', area: 'Atelier A' },
  { code: 'L4', name: 'Ligne 4', area: 'Atelier B' },
  { code: 'L5', name: 'Ligne 5', area: 'Atelier B' },
  { code: 'L6', name: 'Ligne 6', area: 'Atelier B' },
  { code: 'L7', name: 'Ligne 7', area: 'Atelier C' },
  { code: 'L8', name: 'Ligne 8', area: 'Atelier C' },
];

// Stages are data: later stages (sertissage, stérilisation, emballage) are added
// here without touching the schema.
const PRODUCTION_STAGES: readonly Readonly<{ code: string; name: string }>[] = [
  { code: 'TRAITEMENT', name: 'Traitement' },
  { code: 'GRATTAGE', name: 'Grattage' },
  { code: 'REMPLISSAGE', name: 'Remplissage' },
];

const LOSS_REASONS: readonly Readonly<{ code: string; name: string; outputType: string }>[] = [
  { code: 'PR-QUAL', name: 'Matière non conforme', outputType: 'PERTE_REELLE' },
  { code: 'PR-MANIP', name: 'Casse / manipulation', outputType: 'PERTE_REELLE' },
  { code: 'SP-TETE', name: 'Têtes et viscères', outputType: 'SOUS_PRODUIT' },
  { code: 'SP-ARETE', name: 'Arêtes et chutes', outputType: 'SOUS_PRODUIT' },
  { code: 'RW-CALIB', name: 'Calibre à retraiter', outputType: 'REWORK' },
  { code: 'RC-GRADE', name: 'Déclassement de grade', outputType: 'RECLASSEMENT' },
];

const SUPPLIERS: readonly Readonly<{ code: string; name: string; country: string }>[] = [
  { code: 'FRN-001', name: 'Pêcherie Atlantique Sud (démo)', country: 'Maroc' },
  { code: 'FRN-002', name: 'Comptoir Maritime Agadir (démo)', country: 'Maroc' },
];

// Phase 3: workforce cadence demonstration data.
const EMPLOYEES: readonly Readonly<{ number: string; first: string; last: string }>[] = [
  { number: '1001', first: 'Amal', last: 'Benali' },
  { number: '1002', first: 'Ilham', last: 'Chraibi' },
  { number: '1003', first: 'Nadia', last: 'Fassi' },
  { number: '1004', first: 'Samira', last: 'Guerraoui' },
  { number: '1005', first: 'Zineb', last: 'Haddad' },
  { number: '1006', first: 'Karima', last: 'Idrissi' },
];

const DOWNTIME_CATEGORIES: readonly Readonly<{ code: string; name: string }>[] = [
  { code: 'PANNE_MACHINE', name: 'Panne machine' },
  { code: 'MANQUE_MATIERE', name: 'Manque de matière' },
  { code: 'MANQUE_PERSONNEL', name: 'Manque de personnel' },
  { code: 'NETTOYAGE', name: 'Nettoyage' },
  { code: 'CHANGEMENT_PRODUIT', name: 'Changement de produit' },
  { code: 'REGLAGE', name: 'Réglage' },
  { code: 'ATTENTE_QUALITE', name: 'Attente qualité' },
  { code: 'COUPURE', name: 'Coupure électrique' },
  { code: 'AUTRE', name: 'Autre' },
];

const VESSELS: readonly Readonly<{ code: string; name: string; registration: string }>[] = [
  { code: 'BAT-001', name: 'Al Amine (démo)', registration: 'AG-1245' },
  { code: 'BAT-002', name: 'Nour El Bahr (démo)', registration: 'AG-3378' },
];

// Phase 4: filling, seaming, sterilization and marking demonstration data.
const EQUIPMENT: readonly Readonly<{ code: string; name: string; equipmentType: string }>[] = [
  { code: 'AUTOCLAVE-1', name: 'Autoclave 1', equipmentType: 'AUTOCLAVE' },
  { code: 'AUTOCLAVE-2', name: 'Autoclave 2', equipmentType: 'AUTOCLAVE' },
  { code: 'SERT-1', name: 'Sertisseuse 1', equipmentType: 'SERTISSEUSE' },
  { code: 'SERT-2', name: 'Sertisseuse 2', equipmentType: 'SERTISSEUSE' },
  { code: 'REMPL-1', name: 'Remplisseuse 1', equipmentType: 'REMPLISSEUSE' },
];

const FILLING_MEDIA: readonly Readonly<{ code: string; name: string }>[] = [
  { code: 'HUILE_OLIVE', name: "Huile d'olive" },
  { code: 'HUILE_TOURNESOL', name: 'Huile de tournesol' },
  { code: 'SAUCE_TOMATE', name: 'Sauce tomate' },
  { code: 'SAUMURE', name: 'Saumure' },
  { code: 'EAU', name: 'Eau' },
];

const SEAMING_PARAMETERS: readonly Readonly<{ code: string; name: string; defaultUnit: string }>[] = [
  { code: 'CROCHET_CORPS', name: 'Crochet corps', defaultUnit: 'MM' },
  { code: 'CROCHET_COUVERCLE', name: 'Crochet couvercle', defaultUnit: 'MM' },
  { code: 'EPAISSEUR', name: 'Épaisseur', defaultUnit: 'MM' },
  { code: 'SERRAGE', name: 'Serrage', defaultUnit: 'POURCENT' },
];

const MARKING_VERIFICATION_ITEMS: readonly Readonly<{ code: string; name: string }>[] = [
  { code: 'CODE_LISIBLE', name: 'Code lisible' },
  { code: 'CODE_CORRECT', name: 'Code correct' },
  { code: 'DATE_CORRECTE', name: 'Date correcte' },
  { code: 'LOT_CORRECT', name: 'Lot correct' },
  { code: 'PRODUIT_CORRECT', name: 'Produit correct' },
];

async function insertReferenceData(pool: pg.Pool): Promise<void> {
  await withTransaction(pool, async (client) => {
    for (const role of ROLE_CODES) {
      await client.query('INSERT INTO roles (code, name) VALUES ($1, $2)', [role, ROLE_NAMES[role]]);
    }
    for (const user of DEMO_USERS) {
      await client.query(
        `INSERT INTO users (username, full_name, password_hash, role_id)
         VALUES ($1, $2, $3, (SELECT id FROM roles WHERE code = $4))`,
        [user.username, user.fullName, await hashPassword(user.password), user.role],
      );
    }
    for (const item of SPECIES) {
      await client.query('INSERT INTO species (code, name) VALUES ($1, $2)', [item.code, item.name]);
    }
    for (const supplier of SUPPLIERS) {
      await client.query('INSERT INTO suppliers (code, name, country) VALUES ($1, $2, $3)', [
        supplier.code,
        supplier.name,
        supplier.country,
      ]);
    }
    for (const vessel of VESSELS) {
      await client.query('INSERT INTO vessels (code, name, registration) VALUES ($1, $2, $3)', [
        vessel.code,
        vessel.name,
        vessel.registration,
      ]);
    }
    for (const product of PRODUCTS) {
      await client.query(
        `INSERT INTO products (code, name, species_id, product_family, format, pieces_per_can)
         VALUES ($1, $2, (SELECT id FROM species WHERE code = $3), $4, $5, $6)`,
        [
          product.code,
          product.name,
          product.speciesCode,
          product.productFamily,
          product.format,
          product.piecesPerCan,
        ],
      );
    }
    for (const [index, line] of PRODUCTION_LINES.entries()) {
      await client.query(
        'INSERT INTO production_lines (code, name, area, display_order) VALUES ($1, $2, $3, $4)',
        [line.code, line.name, line.area, index + 1],
      );
    }
    for (const [index, stage] of PRODUCTION_STAGES.entries()) {
      await client.query(
        'INSERT INTO production_stages (code, name, display_order) VALUES ($1, $2, $3)',
        [stage.code, stage.name, index + 1],
      );
    }
    for (const reason of LOSS_REASONS) {
      await client.query(
        'INSERT INTO production_loss_reasons (code, name, output_type) VALUES ($1, $2, $3)',
        [reason.code, reason.name, reason.outputType],
      );
    }
    for (const location of LOCATIONS) {
      await client.query(
        `INSERT INTO locations (code, name, stock_type, location_type) VALUES ($1, $2, $3, $4)`,
        [location.code, location.name, location.stockType, location.locationType],
      );
      if (location.isSubcontractor) {
        await client.query(
          `INSERT INTO subcontractors (code, name, location_id)
           VALUES ($1, $2, (SELECT id FROM locations WHERE code = $3))`,
          [location.code, location.name, location.code],
        );
      }
    }
    for (const employee of EMPLOYEES) {
      await client.query(
        'INSERT INTO employees (employee_number, first_name, last_name) VALUES ($1, $2, $3)',
        [employee.number, employee.first, employee.last],
      );
    }
    for (const category of DOWNTIME_CATEGORIES) {
      await client.query('INSERT INTO downtime_categories (code, name) VALUES ($1, $2)', [
        category.code,
        category.name,
      ]);
    }
    // A cadence standard for the demo sardine product: 120 boxes/hour on the
    // combined grattage/remplissage activity, unscoped by format so it applies
    // regardless of the Run's exact packaging.
    await client.query(
      `INSERT INTO cadence_standards (product_id, activity_type, measurement_unit, standard_cadence)
       VALUES ((SELECT id FROM products WHERE code = 'SPSA-HO'), 'GRATTAGE_REMPLISSAGE', 'BOITES', 120)`,
    );

    for (const item of EQUIPMENT) {
      await client.query('INSERT INTO equipment (code, name, equipment_type) VALUES ($1, $2, $3)', [
        item.code,
        item.name,
        item.equipmentType,
      ]);
    }
    for (const medium of FILLING_MEDIA) {
      await client.query('INSERT INTO filling_media (code, name) VALUES ($1, $2)', [
        medium.code,
        medium.name,
      ]);
    }
    for (const parameter of SEAMING_PARAMETERS) {
      await client.query(
        'INSERT INTO seaming_parameters (code, name, default_unit) VALUES ($1, $2, $3)',
        [parameter.code, parameter.name, parameter.defaultUnit],
      );
    }
    for (const item of MARKING_VERIFICATION_ITEMS) {
      await client.query('INSERT INTO marking_verification_items (code, name) VALUES ($1, $2)', [
        item.code,
        item.name,
      ]);
    }

    // Filling specification for the demo sardine product: the exact 120 g /
    // 130 g reference used by the Phase 4 acceptance scenario.
    await client.query(
      `INSERT INTO product_filling_specs (product_id, format, target_net_weight_g, min_weight_g, max_weight_g)
       VALUES ((SELECT id FROM products WHERE code = 'SPSA-HO'), 'CLUB', 125, 120, 130)`,
    );

    // Seaming specification: only "Épaisseur" is configured for the demo
    // product, deliberately narrow so the demo measurement below falls
    // outside it and shows a real NON_CONFORME control.
    await client.query(
      `INSERT INTO seaming_specifications (seaming_parameter_id, product_id, min_value, max_value, target_value, unit)
       VALUES ((SELECT id FROM seaming_parameters WHERE code = 'EPAISSEUR'),
               (SELECT id FROM products WHERE code = 'SPSA-HO'), 0.090, 0.110, 0.100, 'MM')`,
    );
    await client.query(
      `INSERT INTO seaming_specifications (seaming_parameter_id, product_id, min_value, max_value, target_value, unit)
       VALUES ((SELECT id FROM seaming_parameters WHERE code = 'CROCHET_CORPS'),
               (SELECT id FROM products WHERE code = 'SPSA-HO'), 1.00, 1.30, 1.15, 'MM')`,
    );

    // Sterilization program: OCEAMIC's validated scheduled process for the
    // demo product (illustrative figures only).
    await client.query(
      `INSERT INTO sterilization_programs (code, name, product_id, target_temperature_c,
                                           target_pressure_bar, target_f0, minimum_f0, maximum_f0,
                                           holding_time_seconds)
       VALUES ('STE-SPSA-HO', 'Barème SPSA-HO', (SELECT id FROM products WHERE code = 'SPSA-HO'),
               121.10, 1.80, 8.00, 6.00, 12.00, 2400)`,
    );
  });
}

async function idOf(pool: pg.Pool, table: string, code: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`SELECT id FROM ${table} WHERE code = $1`, [code]);
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`Donnée de référence introuvable: ${table}.${code}`);
  }
  return id;
}

/**
 * Demo operations, all created through the real services so the seeded data is
 * always consistent with the business rules.
 */
async function insertDemoOperations(pool: pg.Pool): Promise<void> {
  const users = await pool.query<{ id: string; username: string }>(
    'SELECT id, username FROM users WHERE username = ANY($1)',
    [['stock', 'qualite']],
  );
  const stockUserId = users.rows.find((row) => row.username === 'stock')?.id;
  const qualityUserId = users.rows.find((row) => row.username === 'qualite')?.id;
  if (!stockUserId || !qualityUserId) {
    throw new Error('Utilisateurs de démonstration introuvables.');
  }

  const oceamic2 = await idOf(pool, 'locations', 'OCEAMIC-2');
  const damsa = await idOf(pool, 'locations', 'DAMSA');
  const sardine = await idOf(pool, 'species', 'SARDINE');
  const maquereau = await idOf(pool, 'species', 'MAQUEREAU');
  const thon = await idOf(pool, 'species', 'THON');
  const supplier = await idOf(pool, 'suppliers', 'FRN-001');
  const vessel = await idOf(pool, 'vessels', 'BAT-001');
  const sarma = await idOf(pool, 'subcontractors', 'SARMA');

  // 1. Sardine reception at OCEAMIC 2, then part of it stored externally.
  const sardineReception = await registerReception(
    pool,
    {
      receivedAt: new Date(),
      lot: {
        mode: 'NOUVEAU',
        lotCode: 'LOT-MP-001',
        speciesId: sardine,
        origin: 'Atlantique Sud (démo)',
        captureDate: null,
        notes: 'Lot de démonstration',
      },
      supplierId: supplier,
      vesselId: vessel,
      tideNumber: 'MAREE-2026-014',
      truckRegistration: '12345-A-6',
      quantityKg: '5000.000',
      destinationLocationId: oceamic2,
      receptionType: 'FOURNISSEUR',
      externalSourceLocationId: null,
      documentReference: 'BL-DEMO-001',
      notes: null,
      quickInspection: {
        temperatureC: '2.50',
        qualityGrade: 'A',
        sizeGrade: 'CALIBRE-2',
        result: 'CONFORME',
        notes: null,
      },
    },
    stockUserId,
  );

  await withTransaction(pool, (client) =>
    transferStock(
      client,
      {
        lotId: sardineReception.lotId,
        sourceLocationId: oceamic2,
        destinationLocationId: damsa,
        quantityKg: '2000.000',
        occurredAt: new Date(),
        notes: 'Stockage externe de démonstration',
      },
      stockUserId,
    ),
  );

  // 2. Maquereau reception, partly sent to a subcontractor.
  const maquereauReception = await registerReception(
    pool,
    {
      receivedAt: new Date(),
      lot: {
        mode: 'NOUVEAU',
        lotCode: 'LOT-MP-002',
        speciesId: maquereau,
        origin: null,
        captureDate: null,
        notes: 'Lot de démonstration',
      },
      supplierId: supplier,
      vesselId: vessel,
      tideNumber: 'MAREE-2026-015',
      truckRegistration: '55321-B-6',
      quantityKg: '10000.000',
      destinationLocationId: oceamic2,
      receptionType: 'FOURNISSEUR',
      externalSourceLocationId: null,
      documentReference: 'BL-DEMO-002',
      notes: null,
      quickInspection: null,
    },
    stockUserId,
  );

  await sendToSubcontractor(
    pool,
    {
      sentAt: new Date(),
      subcontractorId: sarma,
      sourceType: 'STOCK_EXISTANT',
      sourceLotId: maquereauReception.lotId,
      sourceLocationId: oceamic2,
      supplierId: null,
      speciesId: null,
      newLotCode: null,
      quantitySentKg: '4000.000',
      incomingQuality: 'B',
      incomingSizeGrade: 'CALIBRE-3',
      notes: 'Étêtage / éviscérage (démo)',
    },
    stockUserId,
  );

  // 3. Thon reception blocked by the quality department.
  const thonReception = await registerReception(
    pool,
    {
      receivedAt: new Date(),
      lot: {
        mode: 'NOUVEAU',
        lotCode: 'LOT-MP-003',
        speciesId: thon,
        origin: null,
        captureDate: null,
        notes: 'Lot de démonstration bloqué',
      },
      supplierId: supplier,
      vesselId: null,
      tideNumber: null,
      truckRegistration: '77412-C-6',
      quantityKg: '3000.000',
      destinationLocationId: oceamic2,
      receptionType: 'FOURNISSEUR',
      externalSourceLocationId: null,
      documentReference: 'BL-DEMO-003',
      notes: null,
      quickInspection: {
        temperatureC: '6.80',
        qualityGrade: 'C',
        sizeGrade: null,
        result: 'NON_CONFORME',
        notes: 'Température de réception hors tolérance (démo)',
      },
    },
    stockUserId,
  );

  await decideQuality(
    pool,
    {
      rawMaterialLotId: thonReception.lotId,
      inspectionId: null,
      decisionType: 'BLOQUE',
      reason: 'Température de réception hors tolérance (démo)',
      notes: null,
    },
    qualityUserId,
  );

  // 4. Demonstration production run on the sardine lot: consumption, useful
  //    output towards filling, by-product and a small real loss.
  const productionUserId = (
    await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1', ['production'])
  ).rows[0]?.id;
  if (!productionUserId) {
    throw new Error('Utilisateur de production de démonstration introuvable.');
  }

  const sardineProduct = await idOf(pool, 'products', 'SPSA-HO');
  const lines = await pool.query<{ id: string; code: string }>(
    "SELECT id, code FROM production_lines WHERE code IN ('L1', 'L2') ORDER BY code",
  );
  const fillingStage = await idOf(pool, 'production_stages', 'REMPLISSAGE');
  const byProductReason = await idOf(pool, 'production_loss_reasons', 'SP-TETE');
  const lossReason = await idOf(pool, 'production_loss_reasons', 'PR-MANIP');

  const run = await createRun(
    pool,
    {
      productionDate: new Date().toISOString().slice(0, 10),
      productId: sardineProduct,
      format: null,
      piecesPerCan: null,
      responsibleUserId: productionUserId,
      lines: lines.rows.map((line) => ({
        productionLineId: line.id,
        // Same operator scrapes and fills on this sardine process.
        activityType: 'GRATTAGE_REMPLISSAGE' as const,
      })),
      notes: 'Ordre de production de démonstration',
    },
    productionUserId,
  );
  await startRun(pool, run.id, productionUserId);

  await consumeRawMaterial(
    pool,
    run.id,
    {
      rawMaterialLotId: sardineReception.lotId,
      sourceLocationId: oceamic2,
      quantityKg: '2000.000',
      consumedAt: new Date(),
      notes: null,
    },
    productionUserId,
  );

  await recordOutput(
    pool,
    run.id,
    {
      outputType: 'SORTIE_UTILE',
      quantityKg: '1240.000',
      occurredAt: new Date(),
      productionLineId: lines.rows[0]?.id ?? null,
      destinationStageId: fillingStage,
      destinationLocationId: null,
      lossReasonId: null,
      reasonText: null,
      notes: 'Sortie vers remplissage (démo)',
    },
    productionUserId,
  );
  await recordOutput(
    pool,
    run.id,
    {
      outputType: 'SOUS_PRODUIT',
      quantityKg: '700.000',
      occurredAt: new Date(),
      productionLineId: null,
      destinationStageId: null,
      destinationLocationId: null,
      lossReasonId: byProductReason,
      reasonText: null,
      notes: null,
    },
    productionUserId,
  );
  await recordOutput(
    pool,
    run.id,
    {
      outputType: 'PERTE_REELLE',
      quantityKg: '60.000',
      occurredAt: new Date(),
      productionLineId: lines.rows[0]?.id ?? null,
      destinationStageId: null,
      destinationLocationId: null,
      lossReasonId: lossReason,
      reasonText: null,
      notes: null,
    },
    productionUserId,
  );

  // 5. Workforce cadence demonstration: four employees assigned to L1 of the
  //    demo Run, an hourly control round measuring three of them (one
  //    incomplete coverage, on purpose, so the home page and the round screen
  //    show something real), and a 27-minute machine breakdown on L2.
  const runLines = await pool.query<{ id: string; line_code: string }>(
    `SELECT rl.id, l.code AS line_code
       FROM production_run_lines rl
       JOIN production_lines l ON l.id = rl.production_line_id
      WHERE rl.production_run_id = $1
      ORDER BY l.code`,
    [run.id],
  );
  const runLineL1 = runLines.rows.find((row) => row.line_code === 'L1')?.id;
  const runLineL2 = runLines.rows.find((row) => row.line_code === 'L2')?.id;
  if (!runLineL1 || !runLineL2) {
    throw new Error('Lignes de Run de démonstration introuvables.');
  }

  const employees = await pool.query<{ id: string; employee_number: string }>(
    "SELECT id, employee_number FROM employees WHERE employee_number IN ('1001','1002','1003','1004') ORDER BY employee_number",
  );

  for (const employee of employees.rows) {
    await assignEmployeeToLine(
      pool,
      run.id,
      { productionRunLineId: runLineL1, employeeId: employee.id, isPresent: true },
      productionUserId,
    );
  }

  const round = await startControlRound(pool, run.id, 'Tour de démonstration', productionUserId);
  const lineControl = await openLineControl(pool, round.id, runLineL1, productionUserId);

  // Matricule 1001: 18 boîtes en 10 minutes -> 108/h, soit 90 % du standard
  // (120/h), exactement l'exemple de référence de la Phase 3.
  await recordEmployeeCadenceControl(
    pool,
    lineControl.id,
    {
      employeeNumber: '1001',
      quantityCompleted: '18',
      measurementUnit: 'BOITES',
      measurementDurationSeconds: 600,
      controlledAt: new Date(),
      confirmCrossLine: false,
    },
    productionUserId,
  );
  await recordEmployeeCadenceControl(
    pool,
    lineControl.id,
    {
      employeeNumber: '1002',
      quantityCompleted: '20',
      measurementUnit: 'BOITES',
      measurementDurationSeconds: 600,
      controlledAt: new Date(),
      confirmCrossLine: false,
    },
    productionUserId,
  );
  await recordEmployeeCadenceControl(
    pool,
    lineControl.id,
    {
      employeeNumber: '1003',
      quantityCompleted: '15',
      measurementUnit: 'BOITES',
      measurementDurationSeconds: 300,
      controlledAt: new Date(),
      confirmCrossLine: false,
    },
    productionUserId,
  );
  // Matricule 1004 is present but deliberately left uncontrolled: coverage
  // shows 3 / 4 (75 %) rather than an invented full count.
  await closeLineControl(pool, lineControl.id, productionUserId);

  const machinePanne = await idOf(pool, 'downtime_categories', 'PANNE_MACHINE');
  const downtimeStart = new Date(Date.now() - 27 * 60 * 1000);
  const downtime = await startDowntime(
    pool,
    run.id,
    {
      productionRunLineId: runLineL2,
      downtimeCategoryId: machinePanne,
      reasonText: 'Bourrage convoyeur (démo)',
      planned: false,
      startedAt: downtimeStart,
    },
    productionUserId,
  );
  await endDowntime(pool, downtime.id, new Date(), productionUserId);

  // 6. Phase 4: filling, weight control, seaming, marking, sterilization,
  //    CCP, cooling and a deviation, all on the same demonstration Run so the
  //    full downstream genealogy (raw material -> ... -> cooling) is real and
  //    traceable end to end.
  const demoLineL1 = lines.rows.find((line) => line.code === 'L1')?.id;
  if (!demoLineL1) {
    throw new Error('Ligne L1 de démonstration introuvable.');
  }

  const fillingOperation = await createFillingOperation(
    pool,
    {
      productionRunId: run.id,
      productionLineId: demoLineL1,
      format: 'CLUB',
      piecesPerCan: null,
      fillingMediumId: await idOf(pool, 'filling_media', 'HUILE_OLIVE'),
      notes: 'Remplissage de démonstration',
    },
    productionUserId,
  );

  // 20-can weight control against the 120 g / 130 g demo specification:
  // exactly 2 sous-poids, 17 conformes, 1 surpoids (Phase 4 acceptance
  // scenario, section 71).
  const weightControl = await startWeightControl(
    pool,
    fillingOperation.id,
    { sampleSize: 20, controlledAt: new Date() },
    qualityUserId,
  );
  const demoWeights = [
    118, 119, 121, 122, 123, 124, 125, 125, 126, 126, 127, 127, 128, 128, 129, 129, 124, 123, 122, 132,
  ];
  for (const [index, weight] of demoWeights.entries()) {
    await recordWeightSample(
      pool,
      weightControl.id,
      { sampleNumber: index + 1, measuredWeightG: weight.toFixed(2) },
      qualityUserId,
    );
  }

  // Seaming: one control with two measurements, one of which is deliberately
  // out of the configured specification so the demo control shows a real
  // NON_CONFORME result (Phase 4 acceptance scenario, section 72) without
  // losing the original out-of-range measurement.
  const seamingOperation = await createSeamingOperation(
    pool,
    {
      productionRunId: run.id,
      fillingOperationId: fillingOperation.id,
      machineId: await idOf(pool, 'equipment', 'SERT-1'),
      productionLineId: demoLineL1,
      notes: 'Sertissage de démonstration',
    },
    productionUserId,
  );
  const seamingControl = await createSeamingControl(
    pool,
    seamingOperation.id,
    { machineId: await idOf(pool, 'equipment', 'SERT-1'), controlledAt: new Date(), notes: null },
    qualityUserId,
  );
  await recordSeamingMeasurement(
    pool,
    seamingControl.id,
    {
      seamingParameterId: await idOf(pool, 'seaming_parameters', 'CROCHET_CORPS'),
      sampleNumber: 1,
      measuredValue: '1.15',
      unit: 'MM',
      productId: sardineProduct,
      format: 'CLUB',
    },
    qualityUserId,
  );
  await recordSeamingMeasurement(
    pool,
    seamingControl.id,
    {
      seamingParameterId: await idOf(pool, 'seaming_parameters', 'EPAISSEUR'),
      sampleNumber: 1,
      measuredValue: '0.115',
      unit: 'MM',
      productId: sardineProduct,
      format: 'CLUB',
    },
    qualityUserId,
  );

  // Marking: coded and verified against the configured check items.
  const markingEvent = await createMarkingEvent(
    pool,
    {
      productionRunId: run.id,
      seamingOperationId: seamingOperation.id,
      markedAt: new Date(),
      markingCode: `${run.runCode}-L1`,
      lotCodePrinted: run.runCode,
      machineId: null,
      notes: null,
    },
    productionUserId,
  );
  const markingItems = await pool.query<{ id: string }>('SELECT id FROM marking_verification_items');
  await verifyMarkingEvent(
    pool,
    markingEvent.id,
    { checks: markingItems.rows.map((item) => ({ itemId: item.id, passed: true, notes: null })) },
    qualityUserId,
  );

  // Sterilization: a complete cycle (loaded, run, measured, CCP-validated,
  // closed) followed by its cooling phase - the full chain from section 27
  // through section 42.
  const sterilizationCycle = await createSterilizationCycle(
    pool,
    {
      autoclaveId: await idOf(pool, 'equipment', 'AUTOCLAVE-1'),
      sterilizationProgramId: await idOf(pool, 'sterilization_programs', 'STE-SPSA-HO'),
      startedAt: new Date(Date.now() - 45 * 60 * 1000),
      operatorUserId: productionUserId,
      notes: 'Cycle de démonstration',
      loads: [
        {
          productionRunId: run.id,
          quantityUnits: 480,
          basketReference: 'PANIER-A1',
          notes: null,
        },
      ],
    },
    productionUserId,
  );
  await beginSterilizationCycle(pool, sterilizationCycle.id, productionUserId);
  await recordSterilizationMeasurement(
    pool,
    sterilizationCycle.id,
    {
      measuredAt: new Date(Date.now() - 20 * 60 * 1000),
      temperatureC: '121.30',
      pressureBar: '1.82',
      f0Value: null,
      phase: 'PALIER',
      sourceType: 'MANUEL',
    },
    productionUserId,
  );
  await recordSterilizationMeasurement(
    pool,
    sterilizationCycle.id,
    {
      measuredAt: new Date(),
      temperatureC: null,
      pressureBar: null,
      f0Value: '8.40',
      phase: 'FIN_PALIER',
      sourceType: 'MANUEL',
    },
    productionUserId,
  );
  await recordCcpControl(
    pool,
    sterilizationCycle.id,
    {
      controlledAt: new Date(),
      ccpType: 'F0_MINIMUM',
      result: 'CONFORME',
      decision: 'LIBERE',
      notes: 'F0 mesuré conforme au barème (démo).',
    },
    qualityUserId,
  );
  await closeSterilizationCycle(pool, sterilizationCycle.id, productionUserId);

  const coolingEvent = await startCoolingEvent(
    pool,
    sterilizationCycle.id,
    { startedAt: new Date(), coolingMethod: 'EAU_CHLOREE', waterTemperatureC: '18.00' },
    productionUserId,
  );
  await endCoolingEvent(
    pool,
    coolingEvent.id,
    { endedAt: new Date(), finalProductTemperatureC: '32.00', result: 'CONFORME' },
    productionUserId,
  );

  // A demonstration deviation with its corrective action, raised from the
  // out-of-spec seaming measurement above.
  const deviation = await createDeviation(
    pool,
    {
      productionRunId: run.id,
      sterilizationCycleId: null,
      processStage: 'SERTISSAGE',
      detectedAt: new Date(),
      deviationType: 'MESURE_HORS_SPECIFICATION',
      description: 'Épaisseur de sertissage hors spécification sur le contrôle de démonstration.',
      severity: 'MINEURE',
    },
    qualityUserId,
  );
  await createCorrectiveAction(
    pool,
    deviation.id,
    {
      actionDescription: 'Réglage de la sertisseuse SERT-1 et recontrôle.',
      responsibleUserId: productionUserId,
      dueAt: null,
    },
    qualityUserId,
  );
}

export async function seedDatabase(pool: pg.Pool): Promise<boolean> {
  const existing = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM roles');
  if (Number(existing.rows[0]?.count ?? '0') > 0) {
    return false;
  }
  await insertReferenceData(pool);
  await insertDemoOperations(pool);
  return true;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl);
  try {
    const seeded = await seedDatabase(pool);
    console.log(
      seeded
        ? 'Données de démonstration créées.'
        : 'Base déjà initialisée: aucune donnée de démonstration ajoutée.',
    );
  } finally {
    await pool.end();
  }
}
