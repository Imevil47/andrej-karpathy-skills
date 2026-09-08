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
import { registerReception } from '../services/receptions.ts';
import { transferStock } from '../services/stock.ts';
import { sendToSubcontractor } from '../services/subcontracting.ts';
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

const VESSELS: readonly Readonly<{ code: string; name: string; registration: string }>[] = [
  { code: 'BAT-001', name: 'Al Amine (démo)', registration: 'AG-1245' },
  { code: 'BAT-002', name: 'Nour El Bahr (démo)', registration: 'AG-3378' },
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
