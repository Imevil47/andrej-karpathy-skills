import { describe, expect, it } from 'vitest';
import { controlerCoherence } from '../domain/coherence';
import { bilanLot, kpisDashboard, stockChambre } from '../domain/selectors';
import { seedDatabase } from './seed';

describe('jeu de démonstration', () => {
  const db = seedDatabase();

  it('ne contient aucune anomalie de cohérence', () => {
    const anomalies = controlerCoherence(db);
    expect(anomalies.map((a) => `${a.regle}: ${a.message}`)).toEqual([]);
  });

  it('respecte la cascade remplissage ≥ sertissage ≥ emballage', () => {
    const bilan = bilanLot(db, db.lots[0].id);
    expect(bilan.boitesRemplies).toBeGreaterThan(bilan.boitesSerties);
    expect(bilan.boitesSerties).toBeGreaterThan(bilan.boitesEmballees);
  });

  it('laisse du stock en chambre positive', () => {
    const stock = stockChambre(db);
    expect(stock.length).toBeGreaterThan(0);
    expect(stock.every((l) => l.stock >= 0)).toBe(true);
  });

  it('ferme le bilan matière du lot clôturé', () => {
    const bilan = bilanLot(db, db.lots[0].id);
    // Écart = sortie chambre − matière retrouvée − pertes déclarées.
    // Sur un lot terminé et cohérent il doit rester marginal (< 2 % du sorti).
    expect(Math.abs(bilan.ecartMatiereKg)).toBeLessThan(bilan.sortieChambreKg * 0.02);
  });

  it('produit des indicateurs exploitables au dashboard', () => {
    const kpis = kpisDashboard(db);
    expect(kpis.boitesProduites).toBeGreaterThan(0);
    expect(kpis.cadenceBoitesH).not.toBeNull();
    expect(kpis.rendementMatierePct).not.toBeNull();
    expect(kpis.nbArrets).toBeGreaterThan(0);
    expect(kpis.topCauses.length).toBeGreaterThan(0);
  });
});
