// Display helpers only: no business calculation happens in the frontend.

export function formatQuantity(quantityKg: string): string {
  const [whole, decimals] = quantityKg.replace('-', '').split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = quantityKg.startsWith('-') ? '-' : '';
  return `${sign}${grouped},${(decimals ?? '').padEnd(3, '0')}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Africa/Casablanca',
  });
}

export function formatDate(value: string | null): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleDateString('fr-FR', { timeZone: 'Africa/Casablanca' });
}

export function nowLocalInput(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

/** Formats a duration in seconds the French way: "27 min" or "1 h 05". */
export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) {
    return '-';
  }
  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return `${hours} h ${remainingMinutes.toString().padStart(2, '0')}`;
}

const LABELS: Readonly<Record<string, string>> = {
  INTERNE: 'Interne',
  EXTERNE: 'Externe',
  ACTIF: 'Actif',
  BLOQUE: 'Bloqué',
  EPUISE: 'Épuisé',
  FRACTIONNE: 'Fractionné',
  CLOTURE: 'Clôturé',
  LEVE: 'Levé',
  ANNULE: 'Annulé',
  EN_COURS: 'En cours',
  RECEPTION: 'Réception',
  TRANSFERT: 'Transfert',
  CONSOMMATION: 'Consommation',
  SOUS_TRAITANCE: 'Sous-traitance',
  SOUS_TRAITANCE_RESULTAT: 'Résultat sous-traitance',
  RETOUR: 'Retour',
  PERTE: 'Perte',
  AJUSTEMENT: 'Ajustement',
  FRACTIONNEMENT: 'Fractionnement',
  ANNULATION: 'Annulation',
  FOURNISSEUR: 'Fournisseur',
  STOCK_EXISTANT: 'Stock existant',
  RETOUR_SOUS_TRAITANCE: 'Retour sous-traitance',
  TRANSFERT_ENTRANT: 'Transfert entrant',
  RETOUR_PRODUCTION: 'Retour production',
  AUTRE: 'Autre',
  CONFORME: 'Conforme',
  NON_CONFORME: 'Non conforme',
  A_SURVEILLER: 'À surveiller',
  ACCEPTE: 'Accepté',
  ACCEPTE_SOUS_RESERVE: 'Accepté sous réserve',
  REJETE: 'Rejeté',
  RECONTROLE_REQUIS: 'Recontrôle requis',
  LIBERE: 'Libéré',
  PRODUIT: 'Produit',
  STOCKAGE: 'Stockage',
  RECONTROLE: 'Recontrôle',
  USINE: 'Usine',
  ENTREPOT: 'Entrepôt',
  SOUS_TRAITANT: 'Sous-traitant',
  ZONE_TRANSIT: 'Zone de transit',
  PLANIFIE: 'Planifié',
  SUSPENDU: 'Suspendu',
  TERMINE: 'Terminé',
  VALIDE: 'Validé',
  SORTIE_UTILE: 'Sortie utile',
  SOUS_PRODUIT: 'Sous-produit',
  REWORK: 'Rework',
  RECLASSEMENT: 'Reclassement',
  PERTE_REELLE: 'Perte réelle',
  ECART_INEXPLIQUE: 'Écart inexpliqué',
  EQUILIBRE: 'Équilibré',
  A_CONTROLER: 'À contrôler',
  ECART_A_JUSTIFIER: 'Écart à justifier',
  GRATTAGE: 'Grattage',
  REMPLISSAGE: 'Remplissage',
  GRATTAGE_REMPLISSAGE: 'Grattage + remplissage',
  TRAITEMENT: 'Traitement',
  INACTIVE: 'Inactive',
  RUN: 'Ordre de production',
  ADMIN: 'Administrateur',
  QUALITE: 'Qualité',
  STOCK: 'Stock',
  PRODUCTION: 'Production',
  LECTURE: 'Lecture seule',
  // Phase 3: workforce cadence
  SOUS_STANDARD: 'Sous standard',
  COMPLET: 'Contrôle complet',
  INCOMPLET: 'Contrôle incomplet',
  BOITES: 'Boîtes',
  PIECES: 'Pièces',
  KG: 'Kg',
  UNITES: 'Unités',
  PANNE_MACHINE: 'Panne machine',
  MANQUE_MATIERE: 'Manque de matière',
  MANQUE_PERSONNEL: 'Manque de personnel',
  NETTOYAGE: 'Nettoyage',
  CHANGEMENT_PRODUIT: 'Changement de produit',
  REGLAGE: 'Réglage',
  ATTENTE_QUALITE: 'Attente qualité',
  COUPURE: 'Coupure électrique',
  // Phase 4: filling, seaming, marking, sterilization, CCP, deviations
  SOUS_POIDS: 'Sous-poids',
  SURPOIDS: 'Surpoids',
  A_CORRIGER: 'À corriger',
  A_VERIFIER: 'À vérifier',
  VERIFIE: 'Vérifié',
  EN_CHARGEMENT: 'En chargement',
  RETENU: 'Retenu',
  DEVIATION: 'Déviation',
  OUVERTE: 'Ouverte',
  EN_ANALYSE: 'En analyse',
  ACTION_REQUISE: 'Action requise',
  CLOTUREE: 'Clôturée',
  MINEURE: 'Mineure',
  MAJEURE: 'Majeure',
  CRITIQUE: 'Critique',
  TERMINEE: 'Terminée',
  MANUEL: 'Saisie manuelle',
  EQUIPEMENT: 'Donnée équipement',
  IMPORT: 'Import',
  SERTISSEUSE: 'Sertisseuse',
  AUTOCLAVE: 'Autoclave',
  REMPLISSEUSE: 'Remplisseuse',
  HUILE: 'Huile',
  HUILE_OLIVE: "Huile d'olive",
  HUILE_TOURNESOL: 'Huile de tournesol',
  HUILE_EXTRA_VIERGE: "Huile d'olive extra vierge",
  HUILE_EXTRA_VIERGE_BIO: "Huile d'olive extra vierge bio",
  SAUCE_TOMATE: 'Sauce tomate',
  SAUMURE: 'Saumure',
  EAU: 'Eau',
  GRAMMES: 'g',
  // Phase 5: packaging, finished goods, pallets, PF stock, shipments
  MP: 'Matières premières',
  PF: 'Produits finis',
  MIXTE: 'Mixte',
  EN_PREPARATION: 'En préparation',
  EN_STOCK: 'En stock',
  RESERVEE: 'Réservée',
  EXPEDIEE: 'Expédiée',
  ANNULEE: 'Annulée',
  PLANIFIEE: 'Planifiée',
  CONSOMMEE: 'Consommée',
  ENTREE_PRODUCTION: 'Entrée production',
  BLOCAGE_LOGISTIQUE: 'Blocage logistique',
  PACKAGING: 'Emballage',
  EXPEDITION: 'Expédition',
  FINISHED_GOOD_LOT: 'Lot PF',
  PALLET: 'Palette',
  LOT_PF: 'Lot PF',
  PALETTE: 'Palette',
  CONTENEUR: 'Conteneur',
  CLIENT: 'Client',
  CONFORME_ETIQUETTE: 'Conforme',
  NON_CONFORME_ETIQUETTE: 'Non conforme',
};

export function label(code: string | null): string {
  if (!code) {
    return '-';
  }
  return LABELS[code] ?? code;
}
