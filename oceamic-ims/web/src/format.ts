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
  ADMIN: 'Administrateur',
  QUALITE: 'Qualité',
  STOCK: 'Stock',
  PRODUCTION: 'Production',
  LECTURE: 'Lecture seule',
};

export function label(code: string | null): string {
  if (!code) {
    return '-';
  }
  return LABELS[code] ?? code;
}
