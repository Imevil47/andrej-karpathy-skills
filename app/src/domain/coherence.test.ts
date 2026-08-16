import { describe, expect, it } from 'vitest';
import { controlerCoherence } from './coherence';
import { EMPTY_DB, type Database, type Lot } from './types';

const LOT: Lot = {
  id: 'lot-1',
  code: 'LOT-2026-08-001',
  date: '2026-08-16',
  espece: 'Sardine',
  statut: 'En production',
};

/** Base minimale valide: un lot, une entrée et une sortie de chambre. */
function base(patch: Partial<Database> = {}): Database {
  return {
    ...EMPTY_DB,
    lots: [LOT],
    stockMovements: [
      {
        id: 'mvt-in',
        lotId: LOT.id,
        espece: 'Sardine',
        chambre: 'CP-1',
        sens: 'ENTREE',
        quantite: 1000,
        date: '2026-08-16',
        heure: '2026-08-16T06:00',
      },
      {
        id: 'mvt-out',
        lotId: LOT.id,
        espece: 'Sardine',
        chambre: 'CP-1',
        sens: 'SORTIE',
        quantite: 800,
        date: '2026-08-16',
        heure: '2026-08-16T07:00',
      },
    ],
    ...patch,
  };
}

const regles = (db: Database) => controlerCoherence(db).map((a) => a.regle);

describe('contrôles de cohérence', () => {
  it('ne signale rien sur une base cohérente', () => {
    expect(controlerCoherence(base())).toEqual([]);
  });

  it('détecte une sortie supérieure à l’entrée', () => {
    const db = base({
      treatmentOperations: [
        {
          id: 'trt-1',
          lotId: LOT.id,
          date: '2026-08-16',
          heureDebut: '2026-08-16T08:00',
          heureFin: '2026-08-16T12:00',
          lineId: 'ligne-1',
          destination: 'Grattage',
          quantiteEntree: 800,
          quantiteSortie: 900,
          pertes: 0,
        },
      ],
    });
    expect(regles(db)).toContain('Sortie > Entrée');
  });

  it('détecte une perte négative', () => {
    const db = base({
      treatmentOperations: [
        {
          id: 'trt-1',
          lotId: LOT.id,
          date: '2026-08-16',
          heureDebut: '2026-08-16T08:00',
          heureFin: '2026-08-16T12:00',
          lineId: 'ligne-1',
          destination: 'Grattage',
          quantiteEntree: 800,
          quantiteSortie: 700,
          pertes: -10,
        },
      ],
    });
    expect(regles(db)).toContain('Perte négative');
  });

  it('détecte un stock négatif', () => {
    const db = base();
    db.stockMovements[1].quantite = 1500;
    expect(regles(db)).toContain('Stock négatif');
  });

  it('détecte une heure de fin antérieure au début', () => {
    const db = base({
      stops: [
        {
          id: 'stop-1',
          zone: 'Grattage',
          date: '2026-08-16',
          heureDebut: '2026-08-16T10:00',
          heureFin: '2026-08-16T09:00',
          motif: 'Réglage',
          categorie: 'Technique',
        },
      ],
    });
    expect(regles(db)).toContain('Temps fin < temps début');
  });

  it('détecte des arrêts qui se chevauchent sur la même machine', () => {
    const db = base({
      stops: [
        {
          id: 'stop-1',
          zone: 'Sertissage',
          machineId: 'sert-1',
          date: '2026-08-16',
          heureDebut: '2026-08-16T09:00',
          heureFin: '2026-08-16T10:00',
          motif: 'Panne machine',
          categorie: 'Technique',
        },
        {
          id: 'stop-2',
          zone: 'Sertissage',
          machineId: 'sert-1',
          date: '2026-08-16',
          heureDebut: '2026-08-16T09:30',
          heureFin: '2026-08-16T10:30',
          motif: 'Réglage',
          categorie: 'Technique',
        },
      ],
    });
    expect(regles(db)).toContain('Arrêts qui se chevauchent');
  });

  it('ne signale pas deux arrêts consécutifs sur des machines différentes', () => {
    const db = base({
      stops: [
        {
          id: 'stop-1',
          zone: 'Sertissage',
          machineId: 'sert-1',
          date: '2026-08-16',
          heureDebut: '2026-08-16T09:00',
          heureFin: '2026-08-16T10:00',
          motif: 'Panne machine',
          categorie: 'Technique',
        },
        {
          id: 'stop-2',
          zone: 'Sertissage',
          machineId: 'sert-2',
          date: '2026-08-16',
          heureDebut: '2026-08-16T09:30',
          heureFin: '2026-08-16T10:30',
          motif: 'Réglage',
          categorie: 'Technique',
        },
      ],
    });
    expect(regles(db)).not.toContain('Arrêts qui se chevauchent');
  });

  it('détecte plus de boîtes serties que de boîtes remplies', () => {
    const db = base({
      fillingOperations: [
        {
          id: 'rmp-1',
          lotId: LOT.id,
          date: '2026-08-16',
          heureDebut: '2026-08-16T08:00',
          heureFin: '2026-08-16T12:00',
          lineId: 'ligne-1',
          nombreBoites: 1000,
          poidsCibleG: 80,
          poidsReelMoyenG: 81,
          boitesSousPoids: 5,
          boitesSurPoids: 5,
          rebut: 10,
          quantiteMatiereConsommee: 82,
        },
      ],
      sertissageOperations: [
        {
          id: 'srt-1',
          lotId: LOT.id,
          date: '2026-08-16',
          heureDebut: '2026-08-16T08:30',
          heureFin: '2026-08-16T12:30',
          machineId: 'sert-1',
          boitesAvant: 1000,
          boitesApres: 1200,
          boitesConformes: 1200,
          boitesNonConformes: 0,
          rebut: 0,
        },
      ],
    });
    expect(regles(db)).toContain('Quantité sertie > quantité remplie');
  });

  it('détecte plus de boîtes emballées que de boîtes serties', () => {
    const db = base({
      fillingOperations: [
        {
          id: 'rmp-1',
          lotId: LOT.id,
          date: '2026-08-16',
          heureDebut: '2026-08-16T08:00',
          heureFin: '2026-08-16T12:00',
          lineId: 'ligne-1',
          nombreBoites: 1000,
          poidsCibleG: 80,
          poidsReelMoyenG: 81,
          boitesSousPoids: 0,
          boitesSurPoids: 0,
          rebut: 0,
          quantiteMatiereConsommee: 82,
        },
      ],
      sertissageOperations: [
        {
          id: 'srt-1',
          lotId: LOT.id,
          date: '2026-08-16',
          heureDebut: '2026-08-16T08:30',
          heureFin: '2026-08-16T12:30',
          machineId: 'sert-1',
          boitesAvant: 1000,
          boitesApres: 990,
          boitesConformes: 990,
          boitesNonConformes: 10,
          rebut: 10,
        },
      ],
      packagingOperations: [
        {
          id: 'emb-1',
          lotId: LOT.id,
          date: '2026-08-16',
          heureDebut: '2026-08-16T14:00',
          heureFin: '2026-08-16T16:00',
          nombreBoites: 1050,
          boitesParCarton: 50,
          cartonsParPalette: 60,
          nombreCartons: 21,
          nombrePalettes: 1,
          rebut: 0,
        },
      ],
    });
    expect(regles(db)).toContain('Quantité emballée > quantité sertie');
  });

  it('détecte une production sans sortie de chambre', () => {
    const db = base({ stockMovements: [] });
    db.grattageOperations = [
      {
        id: 'grt-1',
        lotId: LOT.id,
        date: '2026-08-16',
        heureDebut: '2026-08-16T08:00',
        heureFin: '2026-08-16T12:00',
        lineId: 'ligne-g1',
        quantiteEntree: 500,
        nombreBoites: 4000,
        quantiteRejetee: 20,
        operatrices: [],
      },
    ];
    expect(regles(db)).toContain('Production sans matière disponible');
  });

  it('détecte un enregistrement rattaché à un lot inexistant', () => {
    const db = base();
    db.stockMovements[0].lotId = 'lot-fantome';
    expect(regles(db)).toContain('Lot inexistant');
  });

  it('détecte une consommation matière supérieure à la matière sortie', () => {
    const db = base({
      fillingOperations: [
        {
          id: 'rmp-1',
          lotId: LOT.id,
          date: '2026-08-16',
          heureDebut: '2026-08-16T08:00',
          heureFin: '2026-08-16T12:00',
          lineId: 'ligne-1',
          nombreBoites: 1000,
          poidsCibleG: 80,
          poidsReelMoyenG: 80,
          boitesSousPoids: 0,
          boitesSurPoids: 0,
          rebut: 0,
          // 900 kg consommés pour 800 kg sortis de chambre
          quantiteMatiereConsommee: 900,
        },
      ],
    });
    expect(regles(db)).toContain('Quantité produite > quantité disponible');
  });
});
