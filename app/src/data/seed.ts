/**
 * Jeu de démonstration: une journée d'exploitation complète.
 *
 * Il sert à la fois d'exemple de saisie et de garantie que tous les écrans
 * affichent des chiffres cohérents dès la première ouverture.
 *
 *  - LOT-…-001 Sardine   : chaîne complète, réception → palettes
 *  - LOT-…-002 Maquereau : somerage / mise en boîte, en cours de production
 *  - LOT-…-003 Thon      : zone filet
 */

import type { Database, Employee, Line, Machine, Product, Recipe } from '../domain/types';
import { CATEGORIE_PAR_MOTIF, EMPTY_DB } from '../domain/types';

const id = (prefixe: string, n: number | string) => `${prefixe}-${n}`;

/** Date du jour, au format ISO court. */
function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Horodatage "aujourd'hui à HH:MM" au format attendu par les <input datetime-local>. */
function h(date: string, heure: string): string {
  return `${date}T${heure}`;
}

export function seedDatabase(): Database {
  const date = aujourdhui();
  const anneeMois = date.slice(0, 7).replace('-', '-');

  /* --- Référentiels -------------------------------------------------- */

  const products: Product[] = [
    { id: id('prd', 1), code: 'SAR-125-H', nom: 'Sardine à l’huile 125 g', espece: 'Sardine', formatBoite: '1/4 club', poidsCibleG: 90, boitesParCarton: 50, cartonsParPalette: 60 },
    { id: id('prd', 2), code: 'MAQ-125-S', nom: 'Maquereau sauce tomate 125 g', espece: 'Maquereau', formatBoite: '1/4 club', poidsCibleG: 88, boitesParCarton: 50, cartonsParPalette: 60 },
    { id: id('prd', 3), code: 'THO-160-H', nom: 'Thon filet à l’huile 160 g', espece: 'Thon', formatBoite: '1/2 haut', poidsCibleG: 120, boitesParCarton: 48, cartonsParPalette: 50 },
    { id: id('prd', 4), code: 'SAR-125-E', nom: 'Sardine au naturel 125 g', espece: 'Sardine', formatBoite: '1/4 club', poidsCibleG: 90, boitesParCarton: 50, cartonsParPalette: 60 },
  ];

  const lines: Line[] = [
    ...[1, 2, 3, 4].map((n) => ({ id: id('lgn-trt', n), nom: `Ligne Traitement ${n}`, zone: 'Traitement' as const, active: true })),
    ...[1, 2, 3, 4].map((n) => ({ id: id('lgn-grt', n), nom: `Grattage Ligne ${n}`, zone: 'Grattage' as const, active: true })),
    ...[1, 2].map((n) => ({ id: id('lgn-rmp', n), nom: `Remplissage Ligne ${n}`, zone: 'Remplissage' as const, active: true })),
    { id: id('lgn-emb', 1), nom: 'Emballage Ligne 1', zone: 'Emballage', active: true },
  ];

  const machines: Machine[] = [
    ...[1, 2, 3].map((n) => ({ id: id('mch-fil', n), nom: `Machine Filet ${n}`, zone: 'Filet' as const, etat: 'Disponible' as const, actif: true })),
    ...[1, 2].map((n) => ({ id: id('mch-cui', n), nom: `Cuiseur ${n}`, zone: 'Cuisson' as const, etat: 'Disponible' as const, actif: true })),
    ...[1, 2].map((n) => ({ id: id('mch-srt', n), nom: `Sertisseuse ${n}`, zone: 'Sertissage' as const, etat: 'Disponible' as const, actif: true })),
    { id: id('mch-mrq', 1), nom: 'Marqueuse 1', zone: 'Marquage', etat: 'Disponible', actif: true },
    ...[1, 2].map((n) => ({ id: id('mch-aut', n), nom: `Autoclave ${n}`, zone: 'Stérilisation' as const, etat: 'Disponible' as const, actif: true })),
  ];

  const nomsOperatrices = [
    'Amina Bouzid', 'Fatima Zahra El Idrissi', 'Khadija Naciri', 'Rachida Benali',
    'Samira Ouhadi', 'Naima Tazi', 'Latifa Chakir', 'Malika Berrada',
    'Souad El Amrani', 'Hafida Mansouri', 'Zineb Alaoui', 'Karima Sbai',
  ];

  const employees: Employee[] = [
    ...nomsOperatrices.map((nom, i) => ({
      id: id('emp', i + 1),
      matricule: `OP-${String(i + 1).padStart(3, '0')}`,
      nom,
      poste: 'Opératrice grattage',
      equipe: 'Matin' as const,
      actif: true,
    })),
    { id: id('emp', 20), matricule: 'CHF-001', nom: 'Youssef Haddad', poste: 'Chef de ligne', equipe: 'Matin', actif: true },
    { id: id('emp', 21), matricule: 'CHF-002', nom: 'Mohammed Idrissi', poste: 'Chef de zone', equipe: 'Matin', actif: true },
    { id: id('emp', 22), matricule: 'QLT-001', nom: 'Salma Bennani', poste: 'Contrôle qualité', equipe: 'Matin', actif: true },
    { id: id('emp', 23), matricule: 'REC-001', nom: 'Abdelaziz Fassi', poste: 'Réception', equipe: 'Matin', actif: true },
  ];

  const recipes: Recipe[] = [
    { id: id('rcp', 1), productId: id('prd', 1), typeLiquide: 'Huile', reference: 'Huile de tournesol', dosageTheorique: 25, unite: 'ml' },
    { id: id('rcp', 2), productId: id('prd', 2), typeLiquide: 'Sauce', reference: 'Sauce tomate 12 %', dosageTheorique: 40, unite: 'g' },
    { id: id('rcp', 3), productId: id('prd', 3), typeLiquide: 'Huile', reference: 'Huile d’olive vierge', dosageTheorique: 30, unite: 'ml' },
    { id: id('rcp', 4), productId: id('prd', 4), typeLiquide: 'Eau', reference: 'Saumure 2 %', dosageTheorique: 28, unite: 'ml' },
  ];

  /* --- Lots ----------------------------------------------------------- */

  const lotA = { id: id('lot', 1), code: `LOT-${anneeMois}-001`, date, espece: 'Sardine', productId: id('prd', 1), equipe: 'Matin' as const, statut: 'Clôturé' as const };
  const lotB = { id: id('lot', 2), code: `LOT-${anneeMois}-002`, date, espece: 'Maquereau', productId: id('prd', 2), equipe: 'Matin' as const, statut: 'En production' as const };
  const lotC = { id: id('lot', 3), code: `LOT-${anneeMois}-003`, date, espece: 'Thon', productId: id('prd', 3), equipe: 'Après-midi' as const, statut: 'En production' as const };

  /* --- Réceptions ------------------------------------------------------ */

  const receptions: Database['receptions'] = [
    { id: id('rec', 1), numero: 'REC-001', lotId: lotA.id, date, heureArrivee: h(date, '05:20'), camion: '12345-A-6', fournisseur: 'Armement Atlas — Safi', espece: 'Sardine', quantiteRecue: 12000, temperature: 2, quantiteAcceptee: 11500, quantiteRefusee: 500, chambreDestination: 'CP-1', operateurId: id('emp', 23), observations: '500 kg refusés: température caisse non conforme.' },
    { id: id('rec', 2), numero: 'REC-002', lotId: lotB.id, date, heureArrivee: h(date, '06:10'), camion: '78901-B-2', fournisseur: 'Pêcherie Oualidia', espece: 'Maquereau', quantiteRecue: 8000, temperature: 1, quantiteAcceptee: 8000, quantiteRefusee: 0, chambreDestination: 'CP-2', operateurId: id('emp', 23) },
    { id: id('rec', 3), numero: 'REC-003', lotId: lotC.id, date, heureArrivee: h(date, '11:40'), camion: '44556-C-1', fournisseur: 'Atlantic Fish — Agadir', espece: 'Thon', quantiteRecue: 5000, temperature: 3, quantiteAcceptee: 4850, quantiteRefusee: 150, chambreDestination: 'CP-1', operateurId: id('emp', 23) },
  ];

  /* --- Mouvements de chambre positive ---------------------------------- */

  const stockMovements: Database['stockMovements'] = [
    { id: id('mvt', 1), lotId: lotA.id, productId: lotA.productId, espece: 'Sardine', chambre: 'CP-1', sens: 'ENTREE', quantite: 11500, date, heure: h(date, '05:50'), reference: 'REC-001' },
    { id: id('mvt', 2), lotId: lotB.id, productId: lotB.productId, espece: 'Maquereau', chambre: 'CP-2', sens: 'ENTREE', quantite: 8000, date, heure: h(date, '06:35'), reference: 'REC-002' },
    { id: id('mvt', 3), lotId: lotC.id, productId: lotC.productId, espece: 'Thon', chambre: 'CP-1', sens: 'ENTREE', quantite: 4850, date, heure: h(date, '12:05'), reference: 'REC-003' },
    { id: id('mvt', 4), lotId: lotA.id, productId: lotA.productId, espece: 'Sardine', chambre: 'CP-1', sens: 'SORTIE', quantite: 9000, date, heure: h(date, '07:00'), destination: 'Grattage', reference: 'Zone Traitement' },
    { id: id('mvt', 5), lotId: lotB.id, productId: lotB.productId, espece: 'Maquereau', chambre: 'CP-2', sens: 'SORTIE', quantite: 6000, date, heure: h(date, '07:15'), destination: 'Somerage/Mise en boîte', reference: 'Zone Traitement' },
    { id: id('mvt', 6), lotId: lotC.id, productId: lotC.productId, espece: 'Thon', chambre: 'CP-1', sens: 'SORTIE', quantite: 3000, date, heure: h(date, '13:00'), destination: 'Filet', reference: 'Zone Filet' },
  ];

  /* --- Zone Traitement -------------------------------------------------- */
  // LOT A: 9 000 kg répartis sur 4 lignes, rendement ~80 %.

  const repartitionA = [2400, 2400, 2200, 2000];
  const treatmentOperations: Database['treatmentOperations'] = repartitionA.map((entree, i) => {
    const sortie = Math.round(entree * (i === 2 ? 0.76 : 0.8));
    return {
      id: id('trt', i + 1),
      lotId: lotA.id,
      productId: lotA.productId,
      date,
      equipe: 'Matin' as const,
      heureDebut: h(date, '07:10'),
      heureFin: h(date, i === 2 ? '11:40' : '11:00'),
      lineId: id('lgn-trt', i + 1),
      destination: 'Grattage' as const,
      quantiteEntree: entree,
      quantiteSortie: sortie,
      pertes: entree - sortie,
      nbPersonnel: 8,
      operateurId: id('emp', 20),
    };
  });

  // LOT B: somerage / mise en boîte directe, 2 lignes.
  treatmentOperations.push(
    ...[3000, 3000].map((entree, i) => ({
      id: id('trt', 10 + i),
      lotId: lotB.id,
      productId: lotB.productId,
      date,
      equipe: 'Matin' as const,
      heureDebut: h(date, '07:30'),
      heureFin: h(date, '12:00'),
      lineId: id('lgn-trt', i + 1),
      destination: 'Somerage/Mise en boîte' as const,
      quantiteEntree: entree,
      quantiteSortie: Math.round(entree * 0.82),
      pertes: entree - Math.round(entree * 0.82),
      nbPersonnel: 7,
      operateurId: id('emp', 21),
    })),
  );

  /* --- Zone Filet -------------------------------------------------------- */

  const filetOperations: Database['filetOperations'] = [1500, 1500].map((entree, i) => {
    const sortie = Math.round(entree * (i === 0 ? 0.62 : 0.58));
    return {
      id: id('flt', i + 1),
      lotId: lotC.id,
      productId: lotC.productId,
      date,
      equipe: 'Après-midi' as const,
      heureDebut: h(date, '13:15'),
      heureFin: h(date, '17:30'),
      machineId: id('mch-fil', i + 1),
      quantiteEntree: entree,
      quantiteSortie: sortie,
      pertes: entree - sortie,
      nbPersonnel: 4,
    };
  });

  /* --- Cuisson (lot A, destination grattage) ---------------------------- */

  const entreeCuisson = treatmentOperations
    .filter((o) => o.lotId === lotA.id)
    .reduce((t, o) => t + o.quantiteSortie, 0);
  // La cuisson perd beaucoup d'eau: le rendement retenu ferme le bilan matière
  // avec la production de grattage déclarée plus bas.
  const sortieCuisson = Math.round(entreeCuisson * 0.672);

  const cuissonOperations: Database['cuissonOperations'] = [
    {
      id: id('cui', 1),
      lotId: lotA.id,
      productId: lotA.productId,
      date,
      equipe: 'Matin',
      heureDebut: h(date, '08:30'),
      heureFin: h(date, '12:30'),
      machineId: id('mch-cui', 1),
      nombreGrilles: 240,
      quantiteEntree: entreeCuisson,
      quantiteSortie: sortieCuisson,
      temperature: 102,
      dureeConsigneMin: 35,
      pertes: entreeCuisson - sortieCuisson,
      nbPersonnel: 5,
    },
  ];

  /* --- Grattage (4 lignes, suivi individuel) ---------------------------- */

  const entreeGrattageParLigne = Math.round(sortieCuisson / 4);
  const grattageOperations: Database['grattageOperations'] = [1, 2, 3, 4].map((n) => {
    const operatrices = employees
      .slice((n - 1) * 3, (n - 1) * 3 + 3)
      .map((e, k) => ({
        employeeId: e.id,
        heureDebut: h(date, '09:00'),
        heureFin: h(date, '16:00'),
        // Cadences volontairement différentes: le suivi individuel doit les faire ressortir.
        nombreBoites: 4200 + k * 350 - (n - 1) * 200,
      }));
    return {
      id: id('grt', n),
      lotId: lotA.id,
      productId: lotA.productId,
      date,
      equipe: 'Matin' as const,
      heureDebut: h(date, '09:00'),
      heureFin: h(date, '16:00'),
      lineId: id('lgn-grt', n),
      quantiteEntree: entreeGrattageParLigne,
      nombreBoites: operatrices.reduce((t, o) => t + o.nombreBoites, 0),
      poidsMoyenG: 90,
      quantiteRejetee: 40 + n * 5,
      operatrices,
      operateurId: id('emp', 20),
    };
  });

  const boitesGrattees = grattageOperations.reduce((t, o) => t + o.nombreBoites, 0);

  /* --- Remplissage ------------------------------------------------------- */

  const boitesRemplies = boitesGrattees - 400; // 400 boîtes écartées avant remplissage
  const rebutRemplissage = 260;

  const fillingOperations: Database['fillingOperations'] = [
    {
      id: id('rmp', 1),
      lotId: lotA.id,
      productId: lotA.productId,
      date,
      equipe: 'Matin',
      heureDebut: h(date, '09:30'),
      heureFin: h(date, '17:00'),
      lineId: id('lgn-rmp', 1),
      nombreBoites: boitesRemplies,
      poidsCibleG: 90,
      poidsReelMoyenG: 91.4,
      poidsMinG: 86,
      poidsMaxG: 95,
      boitesSousPoids: 320,
      boitesSurPoids: 540,
      rebut: rebutRemplissage,
      quantiteMatiereConsommee: Math.round((boitesRemplies * 91.4) / 1000),
      nbPersonnel: 6,
      operateurId: id('emp', 20),
    },
  ];

  const boitesDisponibles = boitesRemplies - rebutRemplissage;

  // LOT B — somerage / mise en boîte, encore en production: remplissage et
  // sertissage seulement, pas encore de marquage ni de stérilisation.
  const boitesLotB = 28000;
  const rebutLotB = 140;
  fillingOperations.push({
    id: id('rmp', 2),
    lotId: lotB.id,
    productId: lotB.productId,
    date,
    equipe: 'Matin',
    heureDebut: h(date, '10:00'),
    heureFin: h(date, '16:30'),
    lineId: id('lgn-rmp', 2),
    nombreBoites: boitesLotB,
    poidsCibleG: 88,
    poidsReelMoyenG: 88.6,
    poidsMinG: 84,
    poidsMaxG: 93,
    boitesSousPoids: 150,
    boitesSurPoids: 220,
    rebut: rebutLotB,
    quantiteMatiereConsommee: Math.round((boitesLotB * 88.6) / 1000),
    nbPersonnel: 5,
    operateurId: id('emp', 21),
  });

  /* --- Liquides ---------------------------------------------------------- */

  const liquidConsumptions: Database['liquidConsumptions'] = [
    {
      id: id('liq', 1),
      lotId: lotA.id,
      productId: lotA.productId,
      recipeId: id('rcp', 1),
      date,
      lineId: id('lgn-rmp', 1),
      typeLiquide: 'Huile',
      reference: 'Huile de tournesol',
      nombreBoites: boitesRemplies,
      dosageTheorique: 25,
      unite: 'ml',
      // Surconsommation volontaire: doit apparaître comme écart positif.
      quantiteReelle: Math.round((boitesRemplies * 25) / 1000) + 22,
      observations: 'Réglage doseuse ligne 1 à revoir.',
    },
    {
      id: id('liq', 2),
      lotId: lotB.id,
      productId: lotB.productId,
      recipeId: id('rcp', 2),
      date,
      lineId: id('lgn-rmp', 2),
      typeLiquide: 'Sauce',
      reference: 'Sauce tomate 12 %',
      nombreBoites: boitesLotB,
      dosageTheorique: 40,
      unite: 'g',
      quantiteReelle: Math.round((boitesLotB * 40) / 1000) - 8,
    },
  ];

  /* --- Sertissage --------------------------------------------------------- */

  const boitesNonConformes = 180;
  const rebutSertissage = 180;
  const boitesSerties = boitesDisponibles - rebutSertissage;

  const sertissageOperations: Database['sertissageOperations'] = [
    {
      id: id('srt', 1),
      lotId: lotA.id,
      productId: lotA.productId,
      date,
      equipe: 'Matin',
      heureDebut: h(date, '09:45'),
      heureFin: h(date, '17:15'),
      machineId: id('mch-srt', 1),
      boitesAvant: boitesDisponibles,
      boitesApres: boitesSerties,
      boitesConformes: boitesSerties - boitesNonConformes,
      boitesNonConformes,
      rebut: rebutSertissage,
      reglages: 'Contrôle serti toutes les 30 min — conforme.',
    },
    {
      id: id('srt', 2),
      lotId: lotB.id,
      productId: lotB.productId,
      date,
      equipe: 'Matin',
      heureDebut: h(date, '10:20'),
      heureFin: h(date, '16:45'),
      machineId: id('mch-srt', 2),
      boitesAvant: boitesLotB - rebutLotB,
      boitesApres: boitesLotB - rebutLotB - 160,
      boitesConformes: boitesLotB - rebutLotB - 160 - 90,
      boitesNonConformes: 90,
      rebut: 160,
    },
  ];

  /* --- Marquage ------------------------------------------------------------ */

  const erreursMarquage = 90;
  const marquageOperations: Database['marquageOperations'] = [
    {
      id: id('mrq', 1),
      lotId: lotA.id,
      productId: lotA.productId,
      date,
      equipe: 'Matin',
      heureDebut: h(date, '10:00'),
      heureFin: h(date, '17:30'),
      machineId: id('mch-mrq', 1),
      codeMarquage: `${lotA.code} / L1`,
      dateProduction: date,
      dateReglementaire: new Date(new Date(date).setFullYear(new Date(date).getFullYear() + 4))
        .toISOString()
        .slice(0, 10),
      nombreBoites: boitesSerties,
      erreursMarquage,
      rebut: erreursMarquage,
    },
  ];

  /* --- Stérilisation -------------------------------------------------------- */

  const boitesAStériliser = boitesSerties - erreursMarquage;
  const parCycle = Math.floor(boitesAStériliser / 2);

  const sterilisationCycles: Database['sterilisationCycles'] = [1, 2].map((n) => ({
    id: id('ste', n),
    lotId: lotA.id,
    productId: lotA.productId,
    date,
    equipe: 'Matin' as const,
    numeroCycle: `CYC-${date.replace(/-/g, '')}-${String(n).padStart(2, '0')}`,
    autoclaveId: id('mch-aut', n),
    nombreBoites: n === 1 ? parCycle : boitesAStériliser - parCycle,
    heureDebut: h(date, n === 1 ? '11:00' : '13:00'),
    heureFin: h(date, n === 1 ? '12:30' : '14:30'),
    temperature: 118,
    pression: 2.1,
    valeurSterilisatrice: 8.4,
    resultat: 'Conforme' as const,
    rejets: n === 1 ? 60 : 45,
  }));

  const rejetsSterilisation = sterilisationCycles.reduce((t, c) => t + c.rejets, 0);

  /* --- Emballage -------------------------------------------------------------- */

  const boitesAEmballer = boitesAStériliser - rejetsSterilisation - 120;
  const boitesParCarton = 50;
  const cartonsParPalette = 60;
  const nombreCartons = Math.floor(boitesAEmballer / boitesParCarton);

  const packagingOperations: Database['packagingOperations'] = [
    {
      id: id('emb', 1),
      lotId: lotA.id,
      productId: lotA.productId,
      date,
      equipe: 'Après-midi',
      heureDebut: h(date, '15:00'),
      heureFin: h(date, '19:00'),
      lineId: id('lgn-emb', 1),
      nombreBoites: boitesAEmballer,
      boitesParCarton,
      cartonsParPalette,
      nombreCartons,
      nombrePalettes: Math.ceil(nombreCartons / cartonsParPalette),
      rebut: 120,
      nbPersonnel: 6,
    },
  ];

  /* --- Arrêts ------------------------------------------------------------------ */

  const arret = (
    n: number,
    zone: Database['stops'][number]['zone'],
    motif: Database['stops'][number]['motif'],
    debut: string,
    fin: string,
    extra: Partial<Database['stops'][number]> = {},
  ): Database['stops'][number] => ({
    id: id('stp', n),
    zone,
    date,
    heureDebut: h(date, debut),
    heureFin: h(date, fin),
    motif,
    categorie: CATEGORIE_PAR_MOTIF[motif],
    ...extra,
  });

  const stops: Database['stops'] = [
    arret(1, 'Traitement', 'Manque matière', '09:20', '09:50', { lineId: id('lgn-trt', 3), lotId: lotA.id, commentaire: 'Attente sortie chambre CP-1.' }),
    arret(2, 'Traitement', 'Panne machine', '10:10', '10:55', { lineId: id('lgn-trt', 3), lotId: lotA.id, commentaire: 'Convoyeur bloqué.', actionCorrective: 'Remplacement galet — maintenance.' }),
    arret(3, 'Grattage', 'Nettoyage', '12:00', '12:30', { lineId: id('lgn-grt', 1), lotId: lotA.id }),
    arret(4, 'Grattage', 'Manque personnel', '14:00', '14:25', { lineId: id('lgn-grt', 4), lotId: lotA.id }),
    arret(5, 'Sertissage', 'Réglage', '11:15', '11:40', { machineId: id('mch-srt', 1), lotId: lotA.id, commentaire: 'Reprise réglage molette.' }),
    arret(6, 'Sertissage', 'Problème qualité', '15:05', '15:35', { machineId: id('mch-srt', 1), lotId: lotA.id, commentaire: 'Sertis non conformes détectés au contrôle.', actionCorrective: 'Isolement de 180 boîtes.' }),
    arret(7, 'Remplissage', 'Changement produit', '13:30', '14:00', { lineId: id('lgn-rmp', 1), lotId: lotA.id }),
    arret(8, 'Filet', 'Panne machine', '15:00', '15:40', { machineId: id('mch-fil', 2), lotId: lotC.id, commentaire: 'Lame filet à changer.' }),
    arret(9, 'Stérilisation', 'Attente stérilisation', '12:30', '13:00', { machineId: id('mch-aut', 2), lotId: lotA.id }),
    arret(10, 'Emballage', 'Manque emballage', '16:20', '17:05', { lineId: id('lgn-emb', 1), lotId: lotA.id, commentaire: 'Rupture cartons format 1/4.' }),
    arret(11, 'Remplissage', 'Panne machine', '11:20', '12:05', { lineId: id('lgn-rmp', 2), lotId: lotB.id, commentaire: 'Doseuse sauce bloquée.', actionCorrective: 'Purge et redémarrage.' }),
    arret(12, 'Traitement', 'Réglage', '08:15', '08:35', { lineId: id('lgn-trt', 1), lotId: lotA.id }),
  ];

  /* --- Contrôles qualité --------------------------------------------------------- */

  const qualityControls: Database['qualityControls'] = [
    { id: id('qlt', 1), lotId: lotA.id, productId: lotA.productId, zone: 'Réception', date, heure: h(date, '05:30'), type: 'Température matière', valeur: 2, unite: '°C', resultat: 'Conforme', controleurId: id('emp', 22) },
    { id: id('qlt', 2), lotId: lotA.id, productId: lotA.productId, zone: 'Remplissage', date, heure: h(date, '11:00'), type: 'Poids net égoutté', valeur: 91.4, unite: 'g', resultat: 'Conforme', controleurId: id('emp', 22) },
    { id: id('qlt', 3), lotId: lotA.id, productId: lotA.productId, zone: 'Sertissage', date, heure: h(date, '15:10'), type: 'Contrôle serti', resultat: 'Non conforme', controleurId: id('emp', 22), observations: 'Crochet corps insuffisant — machine arrêtée pour réglage.' },
    { id: id('qlt', 4), lotId: lotA.id, productId: lotA.productId, zone: 'Stérilisation', date, heure: h(date, '12:35'), type: 'Valeur stérilisatrice F0', valeur: 8.4, unite: 'min', resultat: 'Conforme', controleurId: id('emp', 22) },
  ];

  return {
    ...EMPTY_DB,
    products,
    lines,
    machines,
    employees,
    recipes,
    lots: [lotA, lotB, lotC],
    receptions,
    stockMovements,
    treatmentOperations,
    filetOperations,
    cuissonOperations,
    grattageOperations,
    fillingOperations,
    liquidConsumptions,
    sertissageOperations,
    marquageOperations,
    sterilisationCycles,
    packagingOperations,
    stops,
    qualityControls,
  };
}
