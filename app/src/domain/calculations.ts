/**
 * Calculs obligatoires (section 17).
 *
 * Toutes ces fonctions sont pures: l'utilisateur ne saisit jamais un résultat
 * que le système peut déduire.
 *
 * Convention: une valeur non calculable (division par zéro, donnée manquante)
 * renvoie `null` — jamais 0, qui serait interprété comme une vraie mesure.
 */

import type { DateTimeISO, Stop } from './types';

/** Durée brute en minutes entre deux horodatages. `null` si incalculable. */
export function dureeMinutes(
  debut?: DateTimeISO,
  fin?: DateTimeISO,
): number | null {
  if (!debut || !fin) return null;
  const t0 = new Date(debut).getTime();
  const t1 = new Date(fin).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return (t1 - t0) / 60000;
}

/** Rendement (%) = Sortie / Entrée × 100 */
export function rendement(entree: number, sortie: number): number | null {
  if (!entree) return null;
  return (sortie / entree) * 100;
}

/** Perte = Entrée − Sortie */
export function perte(entree: number, sortie: number): number {
  return entree - sortie;
}

/** Taux de perte (%) = Perte / Entrée × 100 */
export function tauxPerte(entree: number, sortie: number): number | null {
  if (!entree) return null;
  return (perte(entree, sortie) / entree) * 100;
}

/** Temps net = Temps brut − Temps d'arrêt (minutes, jamais négatif). */
export function tempsNet(
  tempsBrutMin: number | null,
  tempsArretMin: number,
): number | null {
  if (tempsBrutMin === null) return null;
  return Math.max(0, tempsBrutMin - tempsArretMin);
}

/** Cadence = Production / Temps net, ramenée à l'heure. */
export function cadenceHoraire(
  production: number,
  tempsNetMin: number | null,
): number | null {
  if (!tempsNetMin) return null;
  return production / (tempsNetMin / 60);
}

/** Productivité = Production / Nombre opérateurs / Temps net (par heure). */
export function productivite(
  production: number,
  nbOperateurs: number | undefined,
  tempsNetMin: number | null,
): number | null {
  if (!nbOperateurs || !tempsNetMin) return null;
  return production / nbOperateurs / (tempsNetMin / 60);
}

/** Écart matière = Entrée − Sorties − Pertes déclarées */
export function ecartMatiere(
  entree: number,
  sortie: number,
  pertesDeclarees: number,
): number {
  return entree - sortie - pertesDeclarees;
}

/**
 * Temps d'arrêt cumulé (minutes) sur une liste d'arrêts.
 * Les arrêts qui se chevauchent sont fusionnés pour ne pas compter deux fois
 * la même minute d'immobilisation.
 */
export function tempsArretCumuleMin(stops: Stop[]): number {
  const intervalles = stops
    .map((s) => {
      const t0 = new Date(s.heureDebut).getTime();
      const t1 = s.heureFin ? new Date(s.heureFin).getTime() : NaN;
      return { t0, t1 };
    })
    .filter((i) => !Number.isNaN(i.t0) && !Number.isNaN(i.t1) && i.t1 > i.t0)
    .sort((a, b) => a.t0 - b.t0);

  let total = 0;
  let courantDebut: number | null = null;
  let courantFin = 0;

  for (const { t0, t1 } of intervalles) {
    if (courantDebut === null) {
      courantDebut = t0;
      courantFin = t1;
    } else if (t0 <= courantFin) {
      courantFin = Math.max(courantFin, t1);
    } else {
      total += courantFin - courantDebut;
      courantDebut = t0;
      courantFin = t1;
    }
  }
  if (courantDebut !== null) total += courantFin - courantDebut;

  return total / 60000;
}

/* ------------------------------------------------------------------ */
/* Remplissage (section 10)                                            */
/* ------------------------------------------------------------------ */

/** Écart moyen de poids par boîte (g): réel − cible. */
export function ecartPoidsMoyen(poidsReelG: number, poidsCibleG: number): number {
  return poidsReelG - poidsCibleG;
}

/** Taux de conformité (%) = boîtes dans la tolérance / boîtes produites × 100 */
export function tauxConformite(
  nombreBoites: number,
  sousPoids: number,
  surPoids: number,
  rebut = 0,
): number | null {
  if (!nombreBoites) return null;
  const conformes = nombreBoites - sousPoids - surPoids - rebut;
  return (conformes / nombreBoites) * 100;
}

/**
 * Surconsommation matière (kg) due au surpoids moyen.
 * Positive = matière donnée en trop au client.
 */
export function surconsommationKg(
  nombreBoites: number,
  poidsReelG: number,
  poidsCibleG: number,
): number {
  return (nombreBoites * ecartPoidsMoyen(poidsReelG, poidsCibleG)) / 1000;
}

/* ------------------------------------------------------------------ */
/* Liquides (section 11)                                               */
/* ------------------------------------------------------------------ */

/**
 * Consommation théorique de liquide, exprimée dans l'unité de suivi
 * (L pour un dosage en ml, kg pour un dosage en g).
 * Ex: 10 000 boîtes × 25 ml = 250 L.
 */
export function consommationTheorique(
  nombreBoites: number,
  dosageParBoite: number,
): number {
  return (nombreBoites * dosageParBoite) / 1000;
}

/** Écart liquide = réel − théorique (positif = surconsommation). */
export function ecartLiquide(
  nombreBoites: number,
  dosageParBoite: number,
  quantiteReelle: number,
): number {
  return quantiteReelle - consommationTheorique(nombreBoites, dosageParBoite);
}

/** Consommation réelle par boîte, dans l'unité du dosage (ml ou g). */
export function consommationParBoite(
  quantiteReelle: number,
  nombreBoites: number,
): number | null {
  if (!nombreBoites) return null;
  return (quantiteReelle * 1000) / nombreBoites;
}

/* ------------------------------------------------------------------ */
/* Formatage                                                           */
/* ------------------------------------------------------------------ */

export function fmt(valeur: number | null | undefined, decimales = 1): string {
  if (valeur === null || valeur === undefined || Number.isNaN(valeur)) return '—';
  return valeur.toLocaleString('fr-FR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

export function fmtInt(valeur: number | null | undefined): string {
  if (valeur === null || valeur === undefined || Number.isNaN(valeur)) return '—';
  return Math.round(valeur).toLocaleString('fr-FR');
}

/** Minutes → "2 h 35". */
export function fmtDuree(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
