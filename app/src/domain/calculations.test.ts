import { describe, expect, it } from 'vitest';
import {
  cadenceHoraire,
  consommationParBoite,
  consommationTheorique,
  dureeMinutes,
  ecartLiquide,
  ecartMatiere,
  fmtDuree,
  perte,
  productivite,
  rendement,
  surconsommationKg,
  tauxConformite,
  tauxPerte,
  tempsArretCumuleMin,
  tempsNet,
} from './calculations';
import type { Stop } from './types';

const stop = (heureDebut: string, heureFin?: string): Stop => ({
  id: crypto.randomUUID(),
  zone: 'Grattage',
  date: '2026-08-16',
  heureDebut,
  heureFin,
  motif: 'Panne machine',
  categorie: 'Technique',
});

describe('durées', () => {
  it('calcule la durée brute en minutes', () => {
    expect(dureeMinutes('2026-08-16T08:00', '2026-08-16T10:30')).toBe(150);
  });

  it('renvoie null si une borne manque', () => {
    expect(dureeMinutes('2026-08-16T08:00', undefined)).toBeNull();
    expect(dureeMinutes(undefined, '2026-08-16T08:00')).toBeNull();
  });

  it('renvoie une durée négative si fin < début (détecté par les contrôles)', () => {
    expect(dureeMinutes('2026-08-16T10:00', '2026-08-16T09:00')).toBe(-60);
  });

  it('formate les durées en heures/minutes', () => {
    expect(fmtDuree(155)).toBe('2 h 35');
    expect(fmtDuree(45)).toBe('45 min');
    expect(fmtDuree(null)).toBe('—');
  });
});

describe('rendement et pertes', () => {
  it('calcule le rendement', () => {
    expect(rendement(1000, 750)).toBe(75);
  });

  it('renvoie null quand l’entrée est nulle', () => {
    expect(rendement(0, 100)).toBeNull();
    expect(tauxPerte(0, 0)).toBeNull();
  });

  it('calcule la perte et le taux de perte', () => {
    expect(perte(1000, 750)).toBe(250);
    expect(tauxPerte(1000, 750)).toBe(25);
  });

  it('calcule l’écart matière = entrée − sortie − pertes déclarées', () => {
    expect(ecartMatiere(1000, 750, 250)).toBe(0);
    expect(ecartMatiere(1000, 700, 250)).toBe(50);
  });
});

describe('temps net et cadence', () => {
  it('soustrait les arrêts du temps brut', () => {
    expect(tempsNet(480, 60)).toBe(420);
  });

  it('ne renvoie jamais un temps net négatif', () => {
    expect(tempsNet(60, 90)).toBe(0);
  });

  it('calcule la cadence horaire', () => {
    expect(cadenceHoraire(4200, 420)).toBe(600);
  });

  it('renvoie null quand le temps net est nul', () => {
    expect(cadenceHoraire(100, 0)).toBeNull();
    expect(cadenceHoraire(100, null)).toBeNull();
  });

  it('calcule la productivité par opérateur et par heure', () => {
    expect(productivite(1200, 10, 120)).toBe(60);
    expect(productivite(1200, 0, 120)).toBeNull();
  });
});

describe('temps d’arrêt cumulé', () => {
  it('additionne des arrêts disjoints', () => {
    const total = tempsArretCumuleMin([
      stop('2026-08-16T08:00', '2026-08-16T08:30'),
      stop('2026-08-16T10:00', '2026-08-16T10:15'),
    ]);
    expect(total).toBe(45);
  });

  it('fusionne les arrêts qui se chevauchent (pas de double comptage)', () => {
    const total = tempsArretCumuleMin([
      stop('2026-08-16T08:00', '2026-08-16T09:00'),
      stop('2026-08-16T08:30', '2026-08-16T09:30'),
    ]);
    expect(total).toBe(90);
  });

  it('ignore les arrêts non clôturés', () => {
    expect(tempsArretCumuleMin([stop('2026-08-16T08:00')])).toBe(0);
  });
});

describe('remplissage', () => {
  it('calcule le taux de conformité', () => {
    expect(tauxConformite(1000, 20, 30, 0)).toBe(95);
    expect(tauxConformite(0, 0, 0)).toBeNull();
  });

  it('calcule la surconsommation liée au surpoids', () => {
    // 10 000 boîtes à +2 g = +20 kg
    expect(surconsommationKg(10000, 82, 80)).toBe(20);
  });
});

describe('liquides', () => {
  it('applique l’exemple du cahier des charges', () => {
    // 10 000 boîtes × 25 ml = 250 L théorique ; réel 270 L ⇒ écart +20 L
    expect(consommationTheorique(10000, 25)).toBe(250);
    expect(ecartLiquide(10000, 25, 270)).toBe(20);
  });

  it('calcule la consommation par boîte', () => {
    expect(consommationParBoite(270, 10000)).toBe(27);
    expect(consommationParBoite(270, 0)).toBeNull();
  });
});
