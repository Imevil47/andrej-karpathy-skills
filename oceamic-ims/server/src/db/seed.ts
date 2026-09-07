import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadConfig } from '../config.ts';
import { ROLE_CODES, type RoleCode } from '../domain/types.ts';
import { hashPassword } from '../services/auth.ts';
import { decideQuality } from '../services/quality.ts';
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
